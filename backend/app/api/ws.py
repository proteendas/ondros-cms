"""WebSocket endpoint for live entry updates.

Clients connect to /ws/entries/{entry_id}:
  - the editor page (to observe saves/transitions and show sync status)
  - the preview app's InlineEditingBridge (to refresh on entry.updated)

Server-originated events (broadcast from the REST layer):
  {type: "entry.updated", entryId, version, status, fields, changed}
  {type: "entry.transitioned", entryId, status, version}

Client-originated messages are relayed verbatim to the other members of the
room — used for ephemeral signals like {type: "field.focus"} (presence,
"someone is editing this field" indicators). Persisted changes must go through
the REST API, never through the socket.

Auth: pass ?token=<jwt> to bind the connection to a user. Connections without
a token are accepted read-only (the preview iframe has no JWT). Tighten this
for production, e.g. require either a JWT or the preview secret.
"""
import jwt as pyjwt
from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app.core.security import decode_access_token
from app.core.ws_manager import manager

router = APIRouter(tags=["websocket"])


@router.websocket("/ws/entries/{entry_id}")
async def entry_updates(websocket: WebSocket, entry_id: str, token: str | None = None):
    authenticated = False
    if token:
        try:
            decode_access_token(token)
            authenticated = True
        except pyjwt.PyJWTError:
            await websocket.close(code=4401)
            return

    await manager.connect(entry_id, websocket)
    try:
        while True:
            message = await websocket.receive_json()
            # Only authenticated clients may relay messages into the room.
            if authenticated and isinstance(message, dict):
                message.setdefault("type", "client.message")
                await manager.broadcast(entry_id, message, exclude=websocket)
    except WebSocketDisconnect:
        pass
    finally:
        manager.disconnect(entry_id, websocket)
