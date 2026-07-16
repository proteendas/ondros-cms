"""Single point of contact with the LLM provider (Azure OpenAI).

Everything else in the app calls `get_ai_client().chat(...)` / `.embed(...)`;
nothing outside this module imports the openai SDK. To switch providers or
route through LiteLLM, reimplement these two methods only, e.g.:

    from litellm import acompletion
    response = await acompletion(model="azure/<deployment>", messages=messages)
"""
from functools import lru_cache

from openai import AsyncAzureOpenAI

from app.config import get_settings


class AIConfigurationError(RuntimeError):
    """Raised when AI endpoints are called but Azure OpenAI is not configured."""


class AzureAIClient:
    def __init__(self) -> None:
        self._settings = get_settings()
        self._client: AsyncAzureOpenAI | None = None
        if self.is_configured:
            self._client = AsyncAzureOpenAI(
                api_key=self._settings.azure_openai_api_key,
                azure_endpoint=self._settings.azure_openai_endpoint,
                api_version=self._settings.azure_openai_api_version,
            )

    @property
    def is_configured(self) -> bool:
        return bool(self._settings.azure_openai_api_key and self._settings.azure_openai_endpoint)

    def _require_client(self) -> AsyncAzureOpenAI:
        if self._client is None:
            raise AIConfigurationError(
                "Azure OpenAI is not configured. Set AZURE_OPENAI_API_KEY and "
                "AZURE_OPENAI_ENDPOINT (see .env.example)."
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
        response = await client.chat.completions.create(
            model=self._settings.azure_openai_chat_deployment,
            messages=messages,
            temperature=temperature,
            max_tokens=max_tokens,
            response_format={"type": "json_object"} if json_mode else {"type": "text"},
        )
        return response.choices[0].message.content or ""

    async def embed(self, texts: list[str]) -> list[list[float]]:
        client = self._require_client()
        response = await client.embeddings.create(
            model=self._settings.azure_openai_embedding_deployment,
            input=texts,
        )
        # API preserves input order.
        return [item.embedding for item in response.data]


@lru_cache
def get_ai_client() -> AzureAIClient:
    return AzureAIClient()
