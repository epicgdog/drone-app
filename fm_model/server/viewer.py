"""Fan-out of pose results to browser viewers (GET /viewer, WS /viewer/ws).

Each viewer holds only the *latest* (jpeg, pose_json) pair. Publishing never
awaits a viewer, so a slow or stalled browser tab can't delay the phone's
stream; it just skips intermediate frames.
"""

from __future__ import annotations

import asyncio

from fastapi import WebSocket, WebSocketDisconnect


class _Viewer:
    def __init__(self, websocket: WebSocket) -> None:
        self.websocket = websocket
        self.latest: tuple[bytes, str] | None = None
        self.ready = asyncio.Event()

    def offer(self, jpeg: bytes, pose_json: str) -> None:
        self.latest = (jpeg, pose_json)
        self.ready.set()


class ViewerHub:
    def __init__(self) -> None:
        self._viewers: set[_Viewer] = set()

    @property
    def count(self) -> int:
        return len(self._viewers)

    def publish(self, jpeg: bytes, pose_json: str) -> None:
        """Non-blocking: hand the latest frame + pose to every viewer."""
        for viewer in self._viewers:
            viewer.offer(jpeg, pose_json)

    async def serve(self, websocket: WebSocket) -> None:
        """Run one viewer connection until the browser disconnects."""
        await websocket.accept()
        viewer = _Viewer(websocket)
        self._viewers.add(viewer)
        # Viewers never send anything meaningful; receiving only detects disconnects.
        disconnected = asyncio.create_task(self._wait_for_disconnect(websocket))
        try:
            while not disconnected.done():
                ready = asyncio.create_task(viewer.ready.wait())
                await asyncio.wait({ready, disconnected}, return_when=asyncio.FIRST_COMPLETED)
                if not ready.done():
                    ready.cancel()
                    break
                viewer.ready.clear()
                if viewer.latest is None:
                    continue
                jpeg, pose_json = viewer.latest
                # Binary frame first, then its pose, so the page can pair them.
                await websocket.send_bytes(jpeg)
                await websocket.send_text(pose_json)
        except (WebSocketDisconnect, RuntimeError):
            pass
        finally:
            self._viewers.discard(viewer)
            disconnected.cancel()

    @staticmethod
    async def _wait_for_disconnect(websocket: WebSocket) -> None:
        try:
            while True:
                await websocket.receive()
        except (WebSocketDisconnect, RuntimeError):
            return
