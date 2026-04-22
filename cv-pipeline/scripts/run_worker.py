from __future__ import annotations

import asyncio
import signal

from src.config import load_settings
from src.worker.cv_worker import CVWorker, CVWorkerLifecycleRunner


async def main() -> None:
    settings = load_settings()
    stop_event = asyncio.Event()

    loop = asyncio.get_running_loop()
    for sig in (signal.SIGINT, signal.SIGTERM):
        try:
            loop.add_signal_handler(sig, stop_event.set)
        except NotImplementedError:
            pass

    runner = CVWorkerLifecycleRunner(settings)
    await runner.run(stop_event)


if __name__ == "__main__":
    asyncio.run(main())
