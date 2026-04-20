from __future__ import annotations

from dataclasses import dataclass

import requests


@dataclass(frozen=True)
class ClassSenseClientConfig:
    base_url: str
    session_id: str
    participant_name: str
    participant_email: str
    worker_secret: str | None = None


class ClassSenseSignalClient:
    def __init__(self, config: ClassSenseClientConfig, timeout: float = 10.0) -> None:
        self._config = config
        self._timeout = timeout

    def issue_token(self) -> dict:
        url = (
            f"{self._config.base_url.rstrip('/')}/api/sessions/"
            f"{self._config.session_id}/token"
        )
        payload = {
            "participantName": self._config.participant_name,
            "participantEmail": self._config.participant_email,
        }

        try:
            response = requests.post(url, json=payload, timeout=self._timeout)
            response.raise_for_status()
            return response.json()
        except requests.RequestException as exc:
            status = getattr(getattr(exc, "response", None), "status_code", "n/a")
            body = getattr(getattr(exc, "response", None), "text", "")
            raise RuntimeError(
                f"Failed to issue token via {url} (status={status}). "
                f"Error: {exc}. Response: {body[:500]}"
            ) from exc
        except ValueError as exc:
            raise RuntimeError(
                f"Token endpoint returned non-JSON response: {url}"
            ) from exc

    def issue_worker_token(
        self,
        worker_identity: str | None = None,
        worker_name: str | None = None,
    ) -> dict:
        url = (
            f"{self._config.base_url.rstrip('/')}/api/sessions/"
            f"{self._config.session_id}/worker-token"
        )
        payload = {
            "workerIdentity": worker_identity,
            "workerName": worker_name,
        }
        headers: dict[str, str] = {}
        if self._config.worker_secret:
            headers["Authorization"] = f"Bearer {self._config.worker_secret}"

        try:
            response = requests.post(
                url,
                json=payload,
                headers=headers if headers else None,
                timeout=self._timeout,
            )
            response.raise_for_status()
            return response.json()
        except requests.RequestException as exc:
            status = getattr(getattr(exc, "response", None), "status_code", "n/a")
            body = getattr(getattr(exc, "response", None), "text", "")
            raise RuntimeError(
                f"Failed to issue worker token via {url} (status={status}). "
                f"Error: {exc}. Response: {body[:500]}"
            ) from exc
        except ValueError as exc:
            raise RuntimeError(
                f"Worker token endpoint returned non-JSON response: {url}"
            ) from exc

    def publish_signal(
        self,
        participant_id: str,
        engagement_score: float,
        face_detected: bool,
        emotion: str | None = None,
        yaw: float | None = None,
        pitch: float | None = None,
        roll: float | None = None,
        camera_enabled: bool = True,
        microphone_enabled: bool = False,
    ) -> dict:
        url = (
            f"{self._config.base_url.rstrip('/')}/api/sessions/"
            f"{self._config.session_id}/signals"
        )
        payload = {
            "participantId": participant_id,
            "engagementScore": float(engagement_score),
            "faceDetected": bool(face_detected),
            "emotion": emotion,
            "yaw": yaw,
            "pitch": pitch,
            "roll": roll,
            "cameraEnabled": bool(camera_enabled),
            "microphoneEnabled": bool(microphone_enabled),
        }

        try:
            response = requests.post(url, json=payload, timeout=self._timeout)
            response.raise_for_status()
            if not response.content:
                return {}
            return response.json()
        except requests.RequestException as exc:
            status = getattr(getattr(exc, "response", None), "status_code", "n/a")
            body = getattr(getattr(exc, "response", None), "text", "")
            raise RuntimeError(
                f"Failed to publish signal via {url} for participant '{participant_id}' "
                f"(status={status}). Error: {exc}. Response: {body[:500]}"
            ) from exc
        except ValueError as exc:
            raise RuntimeError(
                f"Signal endpoint returned non-JSON response: {url}"
            ) from exc
