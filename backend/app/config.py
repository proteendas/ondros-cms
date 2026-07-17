"""Application settings, loaded from environment variables (and a local .env file).

Extend by adding attributes here; they map 1:1 to env vars (case-insensitive).

AI providers — set AI_PROVIDER to one of:
  groq          free tier, fast (chat only -> guideline retrieval falls back to keyword search)
  gemini        free tier (chat + embeddings)
  ollama        fully local & free (chat + embeddings), needs `ollama serve`
  openrouter    free models available (chat only)
  openai        paid
  azure_openai  paid (uses the AZURE_OPENAI_* settings below)
  none          disable AI features (endpoints return 503)

Leave AI_PROVIDER empty to auto-detect: azure_openai if AZURE_OPENAI_API_KEY is
set, else groq/gemini/openai if AI_API_KEY is set with that provider... else none.
"""
from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    app_name: str = "Headless CMS"
    database_url: str = "postgresql+asyncpg://cms:cms@localhost:5432/cms"

    # Auth
    jwt_secret: str = "dev-jwt-secret-change-me"
    jwt_algorithm: str = "HS256"
    access_token_expire_minutes: int = 60  # short-lived; pair with refresh tokens
    refresh_token_expire_days: int = 30
    # Dev convenience: verification/reset links are logged AND their tokens are
    # returned in API responses (never enable in production).
    auth_dev_mode: bool = True

    # Base URL of the editor app (email links, SSO redirects).
    frontend_url: str = "http://localhost:3000"

    # SMTP (leave host empty to log emails instead of sending).
    smtp_host: str = ""
    smtp_port: int = 587
    smtp_user: str = ""
    smtp_password: str = ""
    smtp_from: str = "Compose CMS <no-reply@localhost>"

    # Global social login (OIDC direct against Google / Microsoft).
    google_client_id: str = ""
    google_client_secret: str = ""
    microsoft_client_id: str = ""
    microsoft_client_secret: str = ""
    microsoft_tenant: str = "common"

    # Billing
    stripe_secret_key: str = ""
    stripe_webhook_secret: str = ""
    # Allows activating plans without Stripe (local/dev).
    billing_dev_mode: bool = True

    cors_origins: str = "http://localhost:3000,http://localhost:3001"
    media_root: str = "media"

    log_level: str = "INFO"

    # --- AI (provider-agnostic) ---------------------------------------------
    # See module docstring. Any OpenAI-compatible endpoint works.
    ai_provider: str = ""          # groq | gemini | ollama | openrouter | openai | azure_openai | none
    ai_api_key: str = ""           # API key for the chosen provider (not needed for ollama)
    ai_base_url: str = ""          # override the provider's default base URL
    ai_chat_model: str = ""        # override the provider's default chat model
    ai_embedding_model: str = ""   # override; "none" disables embeddings for the provider

    # --- Azure OpenAI (only used when ai_provider == "azure_openai") ---------
    azure_openai_api_key: str = ""
    azure_openai_endpoint: str = ""
    azure_openai_api_version: str = "2024-06-01"
    azure_openai_chat_deployment: str = "gpt-4o"
    azure_openai_embedding_deployment: str = "text-embedding-3-small"

    # Must match the embedding model's output dimension. Changing it after the
    # guideline_chunks table exists requires dropping/recreating that table
    # (the pgvector column is fixed-size). 1536 = OpenAI text-embedding-3-small;
    # 768 = Gemini text-embedding-004 / Ollama nomic-embed-text.
    embedding_dim: int = 1536

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    @property
    def resolved_ai_provider(self) -> str:
        if self.ai_provider:
            return self.ai_provider.lower()
        if self.azure_openai_api_key and self.azure_openai_endpoint:
            return "azure_openai"
        if self.ai_api_key:
            return "openai"
        return "none"


@lru_cache
def get_settings() -> Settings:
    return Settings()
