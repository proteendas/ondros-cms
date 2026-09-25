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
    # Pinned, so the 404 case is about reporting rather than model discovery
    # (which has its own tests below).
    monkeypatch.setenv("AI_CHAT_MODEL", "pinned-model")
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


# ---- Choosing a model ----------------------------------------------------
#
# The deployment hit "groq has no model 'llama-3.3-70b-versatile' (404)" for a
# constant that was the right default when it was written. The fix is to pick
# from what the key can actually use, so these fixtures are shaped like a real
# provider listing — chat models mixed with speech, safety and embeddings.

GROQ_CATALOG = [
    "llama-3.3-70b-versatile",
    "llama-3.1-8b-instant",
    "llama3-70b-8192",
    "llama3-8b-8192",
    "gemma2-9b-it",
    "qwen/qwen3-32b",
    "meta-llama/llama-4-scout-17b-16e-instruct",
    "meta-llama/llama-guard-4-12b",
    "openai/gpt-oss-120b",
    "whisper-large-v3",
    "whisper-large-v3-turbo",
    "distil-whisper-large-v3-en",
    "playai-tts",
]


def test_the_best_available_chat_model_is_chosen():
    from app.ai.models import choose_chat_model

    assert choose_chat_model(GROQ_CATALOG, "groq") == "llama-3.3-70b-versatile"


def test_a_retired_model_is_simply_not_chosen():
    """The reported failure: the preferred model is gone from the catalog.

    Nothing 404s, because nothing off the catalog is ever requested.
    """
    from app.ai.models import choose_chat_model

    catalog = [m for m in GROQ_CATALOG if "llama-3.3" not in m]
    chosen = choose_chat_model(catalog, "groq")
    assert chosen in catalog
    assert chosen == "meta-llama/llama-4-scout-17b-16e-instruct"


@pytest.mark.parametrize(
    "model_id",
    [
        "whisper-large-v3",
        "distil-whisper-large-v3-en",
        "playai-tts",
        "meta-llama/llama-guard-4-12b",
        "text-embedding-3-small",
        "omni-moderation-latest",
    ],
)
def test_models_that_cannot_chat_are_never_chosen(model_id):
    """A speech or safety model accepts a chat call and fails confusingly."""
    from app.ai.models import is_chat_model

    assert not is_chat_model(model_id)


def test_a_catalog_with_no_chat_model_chooses_nothing():
    """Better to keep the configured default than to send audio a prompt."""
    from app.ai.models import choose_chat_model

    assert choose_chat_model(["whisper-large-v3", "playai-tts"], "groq") == ""


def test_the_same_catalog_always_yields_the_same_model():
    """Two replicas must not disagree about which model they are using."""
    from app.ai.models import choose_chat_model

    first = choose_chat_model(GROQ_CATALOG, "groq")
    assert all(choose_chat_model(list(reversed(GROQ_CATALOG)), "groq") == first for _ in range(3))


def test_openai_and_gemini_catalogs_pick_their_own_families():
    from app.ai.models import choose_chat_model

    assert choose_chat_model(
        ["gpt-4o", "gpt-4o-mini", "gpt-3.5-turbo", "text-embedding-3-small", "dall-e-3"],
        "openai",
    ) == "gpt-4o-mini"
    assert choose_chat_model(
        ["gemini-2.0-flash", "gemini-1.5-pro", "text-embedding-004"], "gemini"
    ) == "gemini-2.0-flash"


@pytest.mark.asyncio
async def test_discovery_failing_leaves_the_configured_default_alone(monkeypatch):
    """A provider without /models must not take the AI features down."""
    from app.ai.models import discover_chat_model

    class _Broken:
        class models:
            @staticmethod
            async def list():
                raise RuntimeError("404 page not found")

    assert await discover_chat_model(_Broken(), "groq") == ""


def test_a_pinned_model_is_reported_differently_from_a_discovered_one(monkeypatch):
    """Telling someone to unset AI_CHAT_MODEL only helps if they set it."""
    monkeypatch.setenv("AI_PROVIDER", "groq")
    monkeypatch.setenv("AI_API_KEY", "gsk_test")
    monkeypatch.setenv("AI_CHAT_MODEL", "some-retired-model")
    get_settings.cache_clear()
    try:
        assert "Unset AI_CHAT_MODEL" in str(AIClient()._provider_error(_Status(404)))
    finally:
        get_settings.cache_clear()

    monkeypatch.setenv("AI_CHAT_MODEL", "")
    get_settings.cache_clear()
    try:
        message = str(AIClient()._provider_error(_Status(404)))
        assert "Unset AI_CHAT_MODEL" not in message
        assert "no usable chat model" in message
    finally:
        get_settings.cache_clear()
