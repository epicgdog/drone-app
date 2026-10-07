"""Benchmark PoseEngine.infer() on the skateboarder test image (see docs/PROTOTYPE_SPEC.md §R2)."""

from __future__ import annotations

import sys
from pathlib import Path

import cv2
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from server.pose import PoseEngine

WARMUP_RUNS = 3
TIMED_RUNS = 30


def percentile(values: list[float], p: float) -> float:
    return float(np.percentile(values, p))


def main() -> None:
    image_path = Path(__file__).resolve().parents[2] / "photos" / "skateboarder.png"
    img = cv2.imread(str(image_path))
    if img is None:
        raise FileNotFoundError(f"Could not read {image_path}")

    h, w = img.shape[:2]
    long_edge = max(h, w)
    if long_edge > 640:
        scale = 640 / long_edge
        img = cv2.resize(img, (int(w * scale), int(h * scale)), interpolation=cv2.INTER_AREA)
    ok, encoded = cv2.imencode(".jpg", img, [cv2.IMWRITE_JPEG_QUALITY, 60])
    if not ok:
        raise RuntimeError("Failed to JPEG-encode benchmark image")
    jpeg_bytes = encoded.tobytes()

    engine = PoseEngine()
    print(f"device: {engine.device}")

    for _ in range(WARMUP_RUNS):
        engine.infer(jpeg_bytes, frame_id=0)

    prepare_2d_ms: list[float] = []
    pose_3d_ms: list[float] = []
    total_ms: list[float] = []

    for i in range(TIMED_RUNS):
        msg = engine.infer(jpeg_bytes, frame_id=i)
        if msg.status != "ok":
            raise RuntimeError(f"Benchmark frame did not produce a pose: {msg}")
        prepare_2d_ms.append(msg.timing_ms.prepare_2d)
        pose_3d_ms.append(msg.timing_ms.pose_3d)
        total_ms.append(msg.timing_ms.total)

    for name, values in (
        ("prepare_2d", prepare_2d_ms),
        ("pose_3d", pose_3d_ms),
        ("total", total_ms),
    ):
        p50 = percentile(values, 50)
        p95 = percentile(values, 95)
        print(f"{name}: p50={p50:.1f}ms p95={p95:.1f}ms")


if __name__ == "__main__":
    main()
