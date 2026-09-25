"""AI provider resolution and upstream error reporting.

An API key sent to the wrong provider used to surface as a bare 500, which
tells an editor nothing and sends whoever debugs it looking at the wrong thing.
"""
import pytest

from app.ai.client import AIClient, AIProviderError
from app.config import get_settings


@pytest.mark.parametrize(
    "key,expected",
    [
        ("gsk_abc123", "groq"),          # Groq — the case that was misrouted
        ("sk-or-v1-abc", "openrouter"),  # before plain sk-, which it also matches
        ("AIzaSyAbc123", "gemini"),
        ("sk-proj-abc", "openai"),
        ("something-odd", "openai"),     # unknown shape: the old default stands
    ],
)
def test_provider_is_detected_from_the_key(monkeypatch, key, expected):
    monkeypatch.setenv("AI_PROVIDER", "")
    monkeypatch.setenv("AI_API_KEY", key)
    monkeypatch.setenv("AZURE_OPENAI_API_KEY", "")
    get_settings.cache_clear()
    try:
        assert get_settings().resolved_ai_provider == expected
    finally:
        get_settings.cache_clear()


def test_an_explicit_provider_always_wins(monkeypatch):
    monkeypatch.setenv("AI_PROVIDER", "openai")
    monkeypatch.setenv("AI_API_KEY", "gsk_looks_like_groq")
    get_settings.cache_clear()
    try:
        assert get_settings().resolved_ai_provider == "openai"
    finally:
        get_settings.cache_clear()


def test_no_key_means_no_provider(monkeypatch):
    monkeypatch.setenv("AI_PROVIDER", "")
    monkeypatch.setenv("AI_API_KEY", "")
    monkeypatch.setenv("AZURE_OPENAI_API_KEY", "")
    get_settings.cache_clear()
    try:
        assert get_settings().resolved_ai_provider == "none"
    finally:
        get_settings.cache_clear()


class _Status(Exception):
    def __init__(self, status_code, message=""):
        super().__init__(message)
        self.status_code = status_code
        self.message = message


@pytest.mark.parametrize(
    "status,fragment",
    [
        (401, "rejected the API key"),
        (403, "rejected the API key"),
        (404, "no model"),
        (429, "rate limit"),
        (500, "request failed"),
    ],
)
def test_provider_failures_become_readable_errors(monkeypatch, status, fragment):
    monkeypatch.setenv("AI_PROVIDER", "groq")
    monkeypatch.setenv("AI_API_KEY", "gsk_test")
    get_settings.cache_clear()
    try:
        client = AIClient()
        err = client._provider_error(_Status(status, "upstream said no"))
        assert isinstance(err, AIProviderError)
        assert fragment in str(err)
        # The provider is named, so nobody has to guess which one refused.
        assert "groq" in str(err)
    finally:
        get_settings.cache_clear()


def test_a_401_points_at_the_key_provider_mismatch(monkeypatch):
    """The exact failure the demo hit: a Groq key auto-routed to OpenAI."""
    monkeypatch.setenv("AI_PROVIDER", "openai")
    monkeypatch.setenv("AI_API_KEY", "gsk_wrong_provider")
    get_settings.cache_clear()
    try:
        message = str(AIClient()._provider_error(_Status(401)))
        assert "AI_PROVIDER" in message
        assert "openai" in message
    finally:
        get_settings.cache_clear()
