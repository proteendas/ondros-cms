"""In-memory WebSocket rooms, one room per entry id.

The REST layer broadcasts `entry.updated` / `entry.transitioned` events here so
every connected client (editor tabs, preview iframes) stays in sync.

NOTE: in-memory state only works for a single backend process. For multiple
workers/replicas, back this with Redis pub/sub: publish in `broadcast`, and run
a subscriber task per process that fans messages out to local sockets.
"""
import logging
from collections import defaultdict

from fastapi import WebSocket

logger = logging.getLogger(__name__)


class EntryWebSocketManager:
    def __init__(self) -> None:
        self._rooms: dict[str, set[WebSocket]] = defaultdict(set)

    async def connect(self, entry_id: str, websocket: WebSocket) -> None:
        await websocket.accept()
        self._rooms[entry_id].add(websocket)

    def disconnect(self, entry_id: str, websocket: WebSocket) -> None:
        self._rooms[entry_id].discard(websocket)
        if not self._rooms[entry_id]:
            self._rooms.pop(entry_id, None)

    async def broadcast(self, entry_id: str, payload: dict, exclude: WebSocket | None = None) -> None:
        dead: list[WebSocket] = []
        # Iterate a snapshot: send_json awaits, and a client connecting or
        # disconnecting mid-broadcast would otherwise mutate the live set.
        for ws in list(self._rooms.get(entry_id, ())):
            if ws is exclude:
                continue
            try:
                await ws.send_json(payload)
            except Exception:  # client went away mid-send
                dead.append(ws)
        for ws in dead:
            self.disconnect(entry_id, ws)


manager = EntryWebSocketManager()
