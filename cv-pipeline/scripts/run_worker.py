from __future__ import annotations

import asyncio
import signal

from src.config import load_settings
from src.worker.cv_worker import CVWorker


async def main() -> None:
    settings = load_settings()
    worker = CVWorker(settings)
    stop_event = asyncio.Event()

    loop = asyncio.get_running_loop()
    for sig in (signal.SIGINT, signal.SIGTERM):
        try:
            loop.add_signal_handler(sig, stop_event.set)
        except NotImplementedError:
            pass

    await worker.connect()
    try:
        await stop_event.wait()
    finally:
        await worker.close()


if __name__ == "__main__":
    asyncio.run(main())
