from __future__ import annotations

import struct
from pathlib import Path

import cv2
import numpy as np
import pytest
from fastapi.testclient import TestClient

from server.app import app
from server.pose import PoseEngine

PHOTOS_DIR = Path(__file__).resolve().parents[2] / "photos"


@pytest.fixture(scope="module")
def engine() -> PoseEngine:
    return PoseEngine()


def _jpeg_bytes_of(img: np.ndarray) -> bytes:
    ok, encoded = cv2.imencode(".jpg", img, [cv2.IMWRITE_JPEG_QUALITY, 60])
    assert ok
    return encoded.tobytes()


def test_skateboarder_gives_ok_pose(engine: PoseEngine) -> None:
    img = cv2.imread(str(PHOTOS_DIR / "skateboarder.png"))
    assert img is not None
    msg = engine.infer(_jpeg_bytes_of(img), frame_id=1)

    assert msg.status == "ok"
    assert msg.joints is not None
    joints = np.array(msg.joints)
    assert joints.shape == (17, 3)
    assert np.isfinite(joints).all()


def test_black_frame_gives_no_person(engine: PoseEngine) -> None:
    img = np.zeros((480, 640, 3), dtype=np.uint8)
    msg = engine.infer(_jpeg_bytes_of(img), frame_id=2)
    assert msg.status == "no_person"


def test_garbage_bytes_gives_error(engine: PoseEngine) -> None:
    msg = engine.infer(b"not a jpeg", frame_id=3)
    assert msg.status == "error"


def test_websocket_round_trip() -> None:
    img = cv2.imread(str(PHOTOS_DIR / "skateboarder.png"))
    assert img is not None
    frame_bytes = struct.pack(">I", 7) + _jpeg_bytes_of(img)

    with TestClient(app) as client:
        with client.websocket_connect("/ws") as ws:
            ws.send_bytes(frame_bytes)
            response = ws.receive_json()

    assert response["frame_id"] == 7
    assert response["status"] == "ok"


def test_websocket_short_message_gives_error_and_stays_open() -> None:
    img = cv2.imread(str(PHOTOS_DIR / "skateboarder.png"))
    assert img is not None
    frame_bytes = struct.pack(">I", 9) + _jpeg_bytes_of(img)

    with TestClient(app) as client:
        with client.websocket_connect("/ws") as ws:
            ws.send_bytes(b"\x00\x01")
            response = ws.receive_json()
            assert response["status"] == "error"

            ws.send_bytes(frame_bytes)
            response = ws.receive_json()
            assert response["frame_id"] == 9
            assert response["status"] == "ok"


def test_viewer_receives_frame_then_pose() -> None:
    img = cv2.imread(str(PHOTOS_DIR / "skateboarder.png"))
    assert img is not None
    jpeg = _jpeg_bytes_of(img)

    with TestClient(app) as client:
        assert client.get("/viewer").status_code == 200
        with client.websocket_connect("/viewer/ws") as viewer:
            with client.websocket_connect("/ws") as phone:
                phone.send_bytes(struct.pack(">I", 11) + jpeg)
                assert phone.receive_json()["frame_id"] == 11

            assert viewer.receive_bytes() == jpeg
            pose = viewer.receive_json()
            assert pose["frame_id"] == 11
            assert pose["status"] == "ok"
