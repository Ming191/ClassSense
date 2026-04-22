from src.config import load_settings


from src.config import load_settings


def test_load_settings_defaults(monkeypatch):
    monkeypatch.delenv("LIVEKIT_URL", raising=False)

    settings = load_settings()
    assert settings.session_lifecycle_channel == "session:lifecycle"
    assert settings.web_base_url == "http://web:3000"
