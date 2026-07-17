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
import logging
from functools import lru_cache

from openai import AsyncAzureOpenAI, AsyncOpenAI

from app.config import get_settings

logger = logging.getLogger(__name__)


class AIConfigurationError(RuntimeError):
    """Raised when AI endpoints are called but no provider is configured."""


# Defaults per provider: base URL, chat model, embedding model ("" = none).
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
                self.chat_model = self._settings.ai_chat_model or preset["chat_model"]
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
        kwargs: dict = {
            "model": self.chat_model,
            "messages": messages,
            "temperature": temperature,
            "max_tokens": max_tokens,
        }
        if json_mode:
            kwargs["response_format"] = {"type": "json_object"}
        try:
            response = await client.chat.completions.create(**kwargs)
        except Exception:
            if not json_mode:
                raise
            # Some OpenAI-compatible providers reject response_format; retry
            # without it (the JSON parser in ai.services tolerates fenced output).
            kwargs.pop("response_format", None)
            response = await client.chat.completions.create(**kwargs)
        return response.choices[0].message.content or ""

    async def embed(self, texts: list[str]) -> list[list[float]]:
        client = self._require_client()
        if not self.embedding_model:
            raise AIConfigurationError(
                f"Provider '{self.provider}' has no embedding model configured; "
                "guideline retrieval will use keyword search instead."
            )
        response = await client.embeddings.create(model=self.embedding_model, input=texts)
        # API preserves input order.
        return [item.embedding for item in response.data]


@lru_cache
def get_ai_client() -> AIClient:
    return AIClient()
