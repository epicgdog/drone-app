"""FastAPI app: health check + pose WebSocket (see docs/PROTOTYPE_SPEC.md §R3)."""

from __future__ import annotations

import asyncio
import struct
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse

from server.pose import PoseEngine
from server.protocol import PoseMessage, TimingMs
from server.viewer import ViewerHub

HEADER_LEN = 4
STATIC_DIR = Path(__file__).resolve().parent / "static"
AVATAR_PATH = Path(__file__).resolve().parents[2] / "mobile" / "assets" / "avatar.glb"


@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.engine = PoseEngine()
    app.state.infer_lock = asyncio.Lock()
    app.state.viewers = ViewerHub()
    yield


app = FastAPI(lifespan=lifespan)


@app.get("/health")
async def health() -> dict:
    engine: PoseEngine = app.state.engine
    return {
        "ok": True,
        "device": engine.device,
        "model_loaded": True,
        "viewers": app.state.viewers.count,
    }


@app.get("/viewer")
async def viewer_page() -> FileResponse:
    return FileResponse(STATIC_DIR / "viewer.html")


@app.get("/viewer/avatar.glb")
async def viewer_avatar() -> FileResponse:
    if not AVATAR_PATH.exists():
        raise HTTPException(status_code=404, detail="avatar.glb not found")
    return FileResponse(AVATAR_PATH, media_type="model/gltf-binary")


@app.websocket("/viewer/ws")
async def viewer_ws(websocket: WebSocket) -> None:
    await app.state.viewers.serve(websocket)


def _unpack_frame(data: bytes) -> tuple[int, bytes] | None:
    if len(data) < HEADER_LEN:
        return None
    frame_id = struct.unpack(">I", data[:HEADER_LEN])[0]
    return frame_id, data[HEADER_LEN:]


@app.websocket("/ws")
async def ws_pose(websocket: WebSocket) -> None:
    await websocket.accept()
    engine: PoseEngine = app.state.engine
    lock: asyncio.Lock = app.state.infer_lock
    viewers: ViewerHub = app.state.viewers

    while True:
        try:
            data = await websocket.receive_bytes()
        except WebSocketDisconnect:
            return

        unpacked = _unpack_frame(data)
        if unpacked is None:
            msg = PoseMessage(
                frame_id=0,
                status="error",
                timing_ms=TimingMs(decode=0.0, prepare_2d=0.0, pose_3d=0.0, total=0.0),
                error="message too short to contain a frame_id header",
            )
        else:
            frame_id, jpeg_bytes = unpacked
            async with lock:
                msg = await asyncio.to_thread(engine.infer, jpeg_bytes, frame_id)

        pose_json = msg.model_dump_json()
        await websocket.send_text(pose_json)
        if unpacked is not None:
            viewers.publish(unpacked[1], pose_json)
