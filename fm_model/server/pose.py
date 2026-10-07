"""PoseEngine: a reusable wrapper around FMPose3DInference (see docs/PROTOTYPE_SPEC.md §R2)."""

from __future__ import annotations

import logging
import os
import time

import cv2
import numpy as np
import torch
from fmpose3d import FMPose3DInference
from fmpose3d.common.config import InferenceConfig
from fmpose3d.inference_api.fmpose3d import ResultStatus

from server.protocol import PoseMessage, TimingMs

logger = logging.getLogger(__name__)

MAX_LONG_EDGE = 640


def _resolve_device() -> str:
    env_device = os.environ.get("FMPOSE_DEVICE")
    if env_device:
        return env_device
    if torch.backends.mps.is_available():
        return "mps"
    return "cpu"


def _build_inference_config() -> InferenceConfig:
    sample_steps = int(os.environ.get("FMPOSE_SAMPLE_STEPS", "3"))
    test_aug = os.environ.get("FMPOSE_TEST_AUG", "0") == "1"
    return InferenceConfig(
        sample_steps=sample_steps,
        test_augmentation=test_aug,
        hypothesis_num=1,
    )


class PoseEngine:
    """Loads FMPose3DInference once and runs single-frame inference."""

    def __init__(self) -> None:
        self.device = _resolve_device()
        self.inference_cfg = _build_inference_config()
        self._api = self._build_and_setup(self.device)

    def _build_and_setup(self, device: str) -> FMPose3DInference:
        api = FMPose3DInference(inference_cfg=self.inference_cfg, device=device)
        try:
            api.setup_runtime()
        except Exception:
            if device == "mps":
                logger.warning("MPS setup_runtime failed, rebuilding on cpu", exc_info=True)
                self.device = "cpu"
                api = FMPose3DInference(inference_cfg=self.inference_cfg, device="cpu")
                api.setup_runtime()
            else:
                raise
        return api

    def infer(self, jpeg_bytes: bytes, frame_id: int) -> PoseMessage:
        t_total_start = time.perf_counter()
        timing = {"decode": 0.0, "prepare_2d": 0.0, "pose_3d": 0.0, "total": 0.0}

        try:
            t0 = time.perf_counter()
            buf = np.frombuffer(jpeg_bytes, dtype=np.uint8)
            frame = cv2.imdecode(buf, cv2.IMREAD_COLOR)
            timing["decode"] = (time.perf_counter() - t0) * 1000

            if frame is None:
                return self._error(frame_id, "could not decode JPEG", timing, t_total_start)

            h, w = frame.shape[:2]
            long_edge = max(h, w)
            if long_edge > MAX_LONG_EDGE:
                scale = MAX_LONG_EDGE / long_edge
                frame = cv2.resize(
                    frame, (int(w * scale), int(h * scale)), interpolation=cv2.INTER_AREA
                )

            try:
                t0 = time.perf_counter()
                r2d = self._api.prepare_2d(frame)
                timing["prepare_2d"] = (time.perf_counter() - t0) * 1000

                if r2d.status in (ResultStatus.EMPTY, ResultStatus.INVALID):
                    return self._no_person(frame_id, timing, t_total_start)

                t0 = time.perf_counter()
                r3d = self._api.pose_3d(r2d.keypoints, r2d.image_size)
                timing["pose_3d"] = (time.perf_counter() - t0) * 1000

                joints = r3d.poses_3d_world[0]
                joints_root_rel = r3d.poses_3d[0]
                scores = r2d.scores[0, 0]
            except ValueError:
                return self._no_person(frame_id, timing, t_total_start)

            if np.isnan(joints).any() or np.isnan(joints_root_rel).any():
                return self._no_person(frame_id, timing, t_total_start)

            timing["total"] = (time.perf_counter() - t_total_start) * 1000
            return PoseMessage(
                frame_id=frame_id,
                status="ok",
                joints=joints.tolist(),
                joints_root_rel=joints_root_rel.tolist(),
                scores=scores.tolist(),
                image_size=r2d.image_size,
                timing_ms=TimingMs(**timing),
                error=None,
            )
        except Exception as exc:  # never raise to the caller
            logger.exception("PoseEngine.infer failed")
            return self._error(frame_id, str(exc), timing, t_total_start)

    def _no_person(self, frame_id: int, timing: dict, t_total_start: float) -> PoseMessage:
        timing["total"] = (time.perf_counter() - t_total_start) * 1000
        return PoseMessage(
            frame_id=frame_id,
            status="no_person",
            timing_ms=TimingMs(**timing),
        )

    def _error(self, frame_id: int, message: str, timing: dict, t_total_start: float) -> PoseMessage:
        timing["total"] = (time.perf_counter() - t_total_start) * 1000
        return PoseMessage(
            frame_id=frame_id,
            status="error",
            timing_ms=TimingMs(**timing),
            error=message,
        )
