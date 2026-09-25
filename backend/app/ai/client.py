"""Single point of contact with the LLM provider.

Everything else in the app calls `get_ai_client().chat(...)` / `.embed(...)`;
nothing outside this module imports the openai SDK.

Provider support (all via OpenAI-compatible APIs, so one code path):

  provider      base_url                                            free?
  ------------  --------------------------------------------------  --------------
  groq          https://api.groq.com/openai/v1                      free tier
  gemini        https://generativelanguage.googleapis.com/v1beta/openai/  free tier
  ollama        http://localhost:11434/v1                           fully local
  openrouter    https://openrouter.ai/api/v1                        free models
  openai        https://api.openai.com/v1                           paid
  azure_openai  (uses the azure sdk client + deployments)           paid

Chat-only providers (groq, openrouter) run fine: guideline retrieval falls
back to keyword search instead of vector search (see app.ai.retrieval).
"""
import asyncio
import logging
from functools import lru_cache

from openai import AsyncAzureOpenAI, AsyncOpenAI

from app.ai.models import discover_chat_model
from app.config import get_settings

logger = logging.getLogger(__name__)


class AIConfigurationError(RuntimeError):
    """Raised when AI endpoints are called but no provider is configured."""


class AIProviderError(RuntimeError):
    """The provider was reached but refused the request.

    Distinct from AIConfigurationError: the server is configured, the upstream
    said no. Surfaced as 502 rather than 500 so the editor can show the reason
    instead of a blank failure.
    """


# Per provider: base URL, and the model used when the provider cannot be asked
# what it offers (see app.ai.models — the chat model is normally discovered
# from the key, because these constants go stale as catalogs move).
PROVIDER_PRESETS: dict[str, dict[str, str]] = {
    "openai": {
        "base_url": "https://api.openai.com/v1",
        "chat_model": "gpt-4o-mini",
        "embedding_model": "text-embedding-3-small",  # 1536 dims
    },
    "groq": {
        "base_url": "https://api.groq.com/openai/v1",
        "chat_model": "llama-3.3-70b-versatile",
        "embedding_model": "",  # no embeddings API
    },
    "gemini": {
        "base_url": "https://generativelanguage.googleapis.com/v1beta/openai/",
        "chat_model": "gemini-2.0-flash",
        "embedding_model": "text-embedding-004",  # 768 dims -> set EMBEDDING_DIM=768
    },
    "openrouter": {
        "base_url": "https://openrouter.ai/api/v1",
        "chat_model": "meta-llama/llama-3.3-70b-instruct:free",
        "embedding_model": "",  # no embeddings API
    },
    "ollama": {
        "base_url": "http://localhost:11434/v1",
        "chat_model": "llama3.1",
        "embedding_model": "nomic-embed-text",  # 768 dims -> set EMBEDDING_DIM=768
    },
}


class AIClient:
    """Provider-agnostic chat + embeddings. See module docstring."""

    def __init__(self) -> None:
        self._settings = get_settings()
        self.provider = self._settings.resolved_ai_provider
        self._client: AsyncOpenAI | AsyncAzureOpenAI | None = None
        self.chat_model = ""
        self.embedding_model = ""
        # True when AI_CHAT_MODEL (or an Azure deployment) names the model, in
        # which case it is never second-guessed.
        self._model_pinned = True
        self._model_resolved = False
        self._model_lock = asyncio.Lock()

        if self.provider == "azure_openai":
            if self._settings.azure_openai_api_key and self._settings.azure_openai_endpoint:
                self._client = AsyncAzureOpenAI(
                    api_key=self._settings.azure_openai_api_key,
                    azure_endpoint=self._settings.azure_openai_endpoint,
                    api_version=self._settings.azure_openai_api_version,
                )
                self.chat_model = self._settings.azure_openai_chat_deployment
                self.embedding_model = self._settings.azure_openai_embedding_deployment
        elif self.provider in PROVIDER_PRESETS:
            preset = PROVIDER_PRESETS[self.provider]
            api_key = self._settings.ai_api_key or ("ollama" if self.provider == "ollama" else "")
            if api_key:
                self._client = AsyncOpenAI(
                    api_key=api_key,
                    base_url=self._settings.ai_base_url or preset["base_url"],
                )
                # Explicit config wins; otherwise this is a provisional value
                # that _ensure_chat_model() replaces with one the provider
                # actually lists. Discovery needs an await, and this is __init__.
                self.chat_model = self._settings.ai_chat_model or preset["chat_model"]
                self._model_pinned = bool(self._settings.ai_chat_model)
                embed = self._settings.ai_embedding_model or preset["embedding_model"]
                self.embedding_model = "" if embed == "none" else embed

    @property
    def is_configured(self) -> bool:
        return self._client is not None

    @property
    def supports_embeddings(self) -> bool:
        return self.is_configured and bool(self.embedding_model)

    def _require_client(self):
        if self._client is None:
            raise AIConfigurationError(
                "No AI provider configured. Set AI_PROVIDER (+ AI_API_KEY) — e.g. "
                "AI_PROVIDER=groq with a free key from console.groq.com, "
                "AI_PROVIDER=gemini with a free key from aistudio.google.com, or "
                "AI_PROVIDER=ollama for a fully local setup. See .env.example."
            )
        return self._client

    async def chat(
        self,
        messages: list[dict],
        temperature: float = 0.4,
        max_tokens: int = 2000,
        json_mode: bool = False,
    ) -> str:
        """messages: [{"role": "system"|"user"|"assistant", "content": "..."}]"""
        client = self._require_client()
        await self._ensure_chat_model()
        kwargs: dict = {
            "model": self.chat_model,
            "messages": messages,
            "temperature": temperature,
            "max_tokens": max_tokens,
        }
        if json_mode:
            kwargs["response_format"] = {"type": "json_object"}
        try:
            try:
                response = await client.chat.completions.create(**kwargs)
            except Exception:
                if not json_mode:
                    raise
                # Some OpenAI-compatible providers reject response_format; retry
                # without it (the JSON parser in ai.services tolerates fenced output).
                kwargs.pop("response_format", None)
                response = await client.chat.completions.create(**kwargs)
        except Exception as exc:  # noqa: BLE001 - re-raised as a typed error
            # A 404 here means the model went away under us — retired, renamed,
            # or never enabled for this key. Re-ask the provider and try once
            # more, so a catalog change heals instead of needing a redeploy.
            if getattr(exc, "status_code", None) == 404 and await self._rediscover_chat_model():
                kwargs["model"] = self.chat_model
                try:
                    response = await client.chat.completions.create(**kwargs)
                except Exception as retry_exc:  # noqa: BLE001
                    raise self._provider_error(retry_exc) from retry_exc
            else:
                raise self._provider_error(exc) from exc
        return response.choices[0].message.content or ""

    async def embed(self, texts: list[str]) -> list[list[float]]:
        client = self._require_client()
        if not self.embedding_model:
            raise AIConfigurationError(
                f"Provider '{self.provider}' has no embedding model configured; "
                "guideline retrieval will use keyword search instead."
            )
        try:
            response = await client.embeddings.create(model=self.embedding_model, input=texts)
        except Exception as exc:  # noqa: BLE001 - re-raised as a typed error
            raise self._provider_error(exc) from exc
        # API preserves input order.
        return [item.embedding for item in response.data]

    async def resolve_chat_model(self) -> str:
        """The model a chat call would actually use, resolving it if needed.

        /ai/status calls this so the editor never reports the provisional
        preset as the active model.
        """
        await self._ensure_chat_model()
        return self.chat_model

    async def _ensure_chat_model(self) -> None:
        """Replace the provisional model with one the provider lists.

        Runs once per process, on the first call that needs a model, because
        it costs a round trip and __init__ cannot await. Concurrent first
        calls share one lookup rather than each making their own.
        """
        if self._model_pinned or self._model_resolved or self._client is None:
            return
        async with self._model_lock:
            if self._model_resolved:
                return
            discovered = await discover_chat_model(self._client, self.provider)
            if discovered:
                self.chat_model = discovered
            self._model_resolved = True

    async def _rediscover_chat_model(self) -> bool:
        """Re-ask after a 404. True when it produced a different model to try."""
        if self._model_pinned or self._client is None:
            return False
        previous = self.chat_model
        discovered = await discover_chat_model(self._client, self.provider)
        self._model_resolved = True
        if discovered and discovered != previous:
            logger.warning(
                "AI: %s no longer serves '%s'; switched to '%s'",
                self.provider, previous, discovered,
            )
            self.chat_model = discovered
            return True
        return False

    def _provider_error(self, exc: Exception) -> "AIProviderError":
        """Turn a provider SDK failure into something an editor can act on.

        These used to escape as a 500, which tells the person nothing. The
        common case by far is a key that belongs to a different provider than
        the one configured, so that is called out by name.
        """
        status = getattr(exc, "status_code", None)
        detail = str(getattr(exc, "message", "") or exc).strip()
        if status in (401, 403):
            return AIProviderError(
                f"{self.provider} rejected the API key ({status}). Check AI_API_KEY "
                f"belongs to {self.provider} — set AI_PROVIDER explicitly if the key "
                f"is for a different one."
            )
        if status == 404:
            if self._model_pinned:
                return AIProviderError(
                    f"{self.provider} has no model '{self.chat_model}' ({status}). "
                    f"Unset AI_CHAT_MODEL to let Ondros pick one this key can use."
                )
            return AIProviderError(
                f"{self.provider} offers no usable chat model for this key ({status}). "
                f"Check the key is enabled for chat completions, or set AI_CHAT_MODEL."
            )
        if status == 429:
            return AIProviderError(f"{self.provider} rate limit reached. Try again shortly.")
        return AIProviderError(
            f"{self.provider} request failed"
            + (f" ({status})" if status else "")
            + (f": {detail[:300]}" if detail else "")
        )


@lru_cache
def get_ai_client() -> AIClient:
    return AIClient()
