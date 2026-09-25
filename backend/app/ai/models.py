"""Pick a chat model the provider actually offers.

A hardcoded default model is a bet that a provider's catalog will not move.
It always does: models get retired, renamed, or restricted to accounts that
enabled them, and the deployment then fails with

    groq has no model 'llama-3.3-70b-versatile' (404)

for a model that was the sensible default when the constant was written. The
person configuring the CMS has no reason to know what replaced it.

So the model is *discovered*: ask the key what it can use (``GET /models`` on
any OpenAI-compatible endpoint) and pick the best chat model from the answer.
The key already decides the provider (see ``AI_KEY_PREFIXES``); it decides the
model too.

Preference is still opinionated — something has to choose between a dozen
models — but every candidate comes from the live catalog, so a preference that
goes stale degrades to "second choice" rather than to a 404. ``AI_CHAT_MODEL``
still overrides everything, for anyone who wants a specific model.
"""
from __future__ import annotations

import logging
import re

logger = logging.getLogger(__name__)

#: Substrings that mark a model as not a chat model. Listing endpoints mix in
#: speech, embedding, moderation and safety models, which fail confusingly if
#: sent a chat completion.
NON_CHAT_MARKERS: tuple[str, ...] = (
    "whisper", "tts", "text-to-speech", "stt", "speech",
    "embed", "embedding",
    "moderation", "guard", "safety",
    "rerank", "dall-e", "image", "video", "diffusion",
    "search-", "-search", "transcribe", "realtime", "audio",
)

#: Families worth preferring, best first, per provider. Matched as substrings
#: against the model id, so "llama-3.3" covers every size and suffix. A model
#: matching none of these is still eligible — just ranked below one that does.
FAMILY_PREFERENCE: dict[str, tuple[str, ...]] = {
    "groq": ("llama-3.3", "llama-4", "llama-3.1", "llama3", "qwen", "mixtral", "gemma"),
    "openai": ("gpt-4.1-mini", "gpt-4o-mini", "gpt-4.1", "gpt-4o", "gpt-4", "gpt-3.5"),
    "gemini": ("gemini-2.0-flash", "gemini-2.5-flash", "gemini-1.5-flash", "gemini"),
    "openrouter": ("llama-3.3", "llama-3.1", "qwen", "mistral", "gemma"),
    "ollama": ("llama3.1", "llama3", "qwen", "mistral", "gemma", "phi"),
}

#: Suffixes that mark a variant as unsuitable as a default: previews change
#: without notice, and the speed-tuned variants trade away the output quality
#: this product's prompts depend on.
DISCOURAGED: tuple[str, ...] = ("preview", "experimental", "specdec", "deprecated", "beta")

#: Words that mark a model as instruction-tuned, which is what chat needs.
ENCOURAGED: tuple[str, ...] = ("instruct", "versatile", "chat", "-it")

#: Models above this many billion parameters are usually slower and dearer
#: than a CMS assistant warrants, so size stops counting in their favour.
PREFERRED_MAX_BILLIONS = 100


def _size_billions(model_id: str) -> float:
    """Parameter count parsed from the id (``llama-3.1-70b`` -> 70.0)."""
    match = re.search(r"(\d+(?:\.\d+)?)\s*b(?![a-z0-9])", model_id, re.IGNORECASE)
    return float(match.group(1)) if match else 0.0


def is_chat_model(model_id: str) -> bool:
    lowered = model_id.lower()
    return not any(marker in lowered for marker in NON_CHAT_MARKERS)


def score_model(model_id: str, provider: str) -> tuple:
    """Rank a candidate. Higher sorts first; ties break on the id for stability.

    Family rank dominates deliberately: a 8B model from the preferred family
    is a better default than a 405B one from a family we have not tuned
    prompts against.
    """
    lowered = model_id.lower()

    families = FAMILY_PREFERENCE.get(provider, ())
    family_rank = len(families)  # no match sorts last
    for index, family in enumerate(families):
        if family in lowered:
            family_rank = index
            break

    size = _size_billions(lowered)
    size_score = size if size <= PREFERRED_MAX_BILLIONS else PREFERRED_MAX_BILLIONS / size

    return (
        -family_rank,
        -sum(marker in lowered for marker in DISCOURAGED),
        any(word in lowered for word in ENCOURAGED),
        size_score,
        model_id,  # deterministic: the same catalog always yields the same pick
    )


def choose_chat_model(model_ids: list[str], provider: str) -> str:
    """The best chat model in a catalog, or "" if it holds none."""
    candidates = [m for m in model_ids if m and is_chat_model(m)]
    if not candidates:
        return ""
    return max(candidates, key=lambda m: score_model(m, provider))


async def discover_chat_model(client, provider: str) -> str:
    """Ask the provider what this key can use and pick one. "" if it cannot say.

    Never raises: discovery is an optimisation over the preset, and a provider
    that does not implement ``/models`` (or a network blip) must not take the
    AI features down with it.
    """
    try:
        response = await client.models.list()
        model_ids = [getattr(m, "id", "") for m in response.data]
    except Exception as exc:  # noqa: BLE001 - fall back to the preset
        logger.info("AI: could not list %s models (%s); using the configured default", provider, exc)
        return ""

    chosen = choose_chat_model(model_ids, provider)
    if chosen:
        logger.info("AI: chose %s from %d models offered by %s", chosen, len(model_ids), provider)
    return chosen
