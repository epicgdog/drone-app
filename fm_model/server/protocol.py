"""Pydantic models for the pose WebSocket protocol (see docs/PROTOTYPE_SPEC.md §R3)."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel

Status = Literal["ok", "no_person", "error"]


class TimingMs(BaseModel):
    decode: float
    prepare_2d: float
    pose_3d: float
    total: float


class PoseMessage(BaseModel):
    type: Literal["pose"] = "pose"
    frame_id: int
    status: Status
    joints: list[list[float]] | None = None
    joints_root_rel: list[list[float]] | None = None
    scores: list[float] | None = None
    image_size: tuple[int, int] | None = None
    timing_ms: TimingMs
    error: str | None = None
