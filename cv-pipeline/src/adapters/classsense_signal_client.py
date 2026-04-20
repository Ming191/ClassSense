from __future__ import annotations

import json
from datetime import date, datetime
from decimal import Decimal
from typing import Any


def _json_default(value: Any):
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    if isinstance(value, set):
        return sorted(value)
    if isinstance(value, Decimal):
        return float(value)
    if hasattr(value, "__dict__"):
        return value.__dict__
    return str(value)


def safe_json_dumps(payload: dict) -> str:
    return json.dumps(
        payload, default=_json_default, separators=(",", ":"), ensure_ascii=False
    )


class ClassSenseSignalClient:
    def __init__(self, redis_url: str) -> None:
        self._redis_url = redis_url
        self._redis = None

    async def connect(self) -> None:
        import redis.asyncio as redis

        self._redis = redis.from_url(self._redis_url, decode_responses=True)

    async def close(self) -> None:
        if self._redis is not None:
            aclose = getattr(self._redis, "aclose", None)
            if callable(aclose):
                await aclose()
            else:
                await self._redis.close()
            self._redis = None

    async def publish_score(self, session_id: str, payload: dict) -> int:
        return await self._publish(f"scores:{session_id}", payload)

    async def publish_hci(self, session_id: str, payload: dict) -> int:
        return await self._publish(f"hci:{session_id}", payload)

    async def publish_gaze(self, session_id: str, payload: dict) -> int:
        return await self._publish(f"gaze-{session_id}", payload)

    async def _publish(self, channel: str, payload: dict) -> int:
        if self._redis is None:
            raise RuntimeError("ClassSenseSignalClient is not connected")
        message = safe_json_dumps(payload)
        return await self._redis.publish(channel, message)
