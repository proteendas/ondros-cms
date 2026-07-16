"""Application settings, loaded from environment variables (and a local .env file).

Extend by adding attributes here; they map 1:1 to env vars (case-insensitive).
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
    access_token_expire_minutes: int = 60 * 24

    # Shared secret used by the preview frontend to fetch draft content.
    # In production, replace with short-lived signed tokens minted per editor session.
    preview_secret: str = "dev-preview-secret"

    cors_origins: str = "http://localhost:3000,http://localhost:3001"
    media_root: str = "media"

    # Azure OpenAI. Leave blank to run the CMS without AI features.
    azure_openai_api_key: str = ""
    azure_openai_endpoint: str = ""
    azure_openai_api_version: str = "2024-06-01"
    azure_openai_chat_deployment: str = "gpt-4o"
    azure_openai_embedding_deployment: str = "text-embedding-3-small"

    # Must match the embedding model's output dimension. Changing it after the
    # guideline_chunks table exists requires a migration (the vector column is fixed-size).
    embedding_dim: int = 1536

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
