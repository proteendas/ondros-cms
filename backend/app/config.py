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

    # Single change-point for the product brand (spec 007). Frontend twin:
    # editor/src/lib/brand.ts
    brand_name: str = "Ondros CMS"
    brand_short: str = "Ondros"

    app_name: str = "Ondros CMS"
    database_url: str = "postgresql+asyncpg://cms:cms@localhost:5432/cms"

    # Optional non-owner Postgres login that activates the RLS policies (spec
    # 001). Left blank, startup creates no role at all — set a *strong*
    # password to opt in, then point DATABASE_URL at the role. Managed
    # providers (Neon, Supabase, RDS) enforce their own password policy and
    # reject weak ones, so this is never defaulted.
    db_app_role: str = "cms_app"
    db_app_role_password: str = ""

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
    # Public base URL of this API — used to build OAuth redirect URIs
    # ({backend_url}/sso/{provider}/callback); set per environment (spec 012).
    backend_url: str = "http://localhost:8000"

    # --- Outbound email ----------------------------------------------------
    # MAIL_PROVIDER picks the transport. Leave it empty to auto-detect, in this
    # order: resend -> brevo -> smtp -> log.
    #   resend  HTTP API (api.resend.com) — free tier, no SMTP ports needed
    #   brevo   HTTP API (api.brevo.com)  — free tier
    #   smtp    any SMTP relay (Mailgun, SendGrid, Gmail, self-hosted)
    #   log     write the message to the log instead of sending (local dev)
    # HTTP providers are preferred on PaaS hosts, several of which block or
    # throttle outbound SMTP ports.
    mail_provider: str = ""
    resend_api_key: str = ""
    brevo_api_key: str = ""
    # Sender for every transport, e.g. "Ondros CMS <no-reply@yourdomain.com>".
    # The address's domain must be verified with the provider.
    mail_from: str = ""

    # SMTP (used when the provider resolves to "smtp").
    smtp_host: str = ""
    smtp_port: int = 587
    smtp_user: str = ""
    smtp_password: str = ""
    smtp_from: str = "Ondros CMS <prot.das15@gmail.com>"

    # Global social login (OIDC direct against Google / Microsoft).
    google_client_id: str = ""
    google_client_secret: str = ""
    microsoft_client_id: str = ""
    microsoft_client_secret: str = ""
    microsoft_tenant: str = "common"
    github_client_id: str = ""
    github_client_secret: str = ""

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
    def resolved_mail_provider(self) -> str:
        """Which transport send_email() will use, honouring explicit config."""
        explicit = (self.mail_provider or "").strip().lower()
        if explicit:
            return explicit
        if self.resend_api_key:
            return "resend"
        if self.brevo_api_key:
            return "brevo"
        if self.smtp_host:
            return "smtp"
        return "log"

    @property
    def mail_sender(self) -> str:
        """Unified From header — MAIL_FROM wins, SMTP_FROM kept for back-compat."""
        return self.mail_from or self.smtp_from

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
