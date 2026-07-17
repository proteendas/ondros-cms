"""Prompt construction for all AI features.

Keep every prompt in this file so tone/behavior tuning happens in one place.
Each builder returns an OpenAI-style messages list ready for AIClient.chat().
"""
import json

from app.ai.retrieval import RetrievedChunk
from app.models import ContentType

# The base system prompt for all CMS AI operations. Edit to match your product voice.
CMS_SYSTEM_PROMPT = """\
You are the embedded content assistant of a headless CMS. You help editors
create, transform, and audit structured content.

Rules you must always follow:
1. Respect the content model: only produce values for the fields you are asked
   to produce, matching each field's type and validations (e.g. max_length).
2. Brand & editorial guidelines provided in the context are authoritative.
   When guidelines conflict with the user's brief, follow the guidelines and
   note the conflict rather than silently ignoring it.
3. Rich text fields expect clean semantic HTML (p, h2, h3, ul, ol, li, strong,
   em, a). No inline styles, no scripts, no wrapper <html>/<body> tags.
4. Plain text fields must not contain HTML.
5. Never invent facts, statistics, or quotes. If the brief lacks information,
   write around it or use clearly generic phrasing.
6. When asked for JSON, return ONLY valid JSON — no markdown fences, no prose.
"""


def _guidelines_block(chunks: list[RetrievedChunk]) -> str:
    if not chunks:
        return "No specific guidelines were retrieved. Use a clear, professional tone."
    parts = [
        f'[Guideline: "{c.document_title}" — excerpt {c.chunk_index + 1}]\n{c.text}'
        for c in chunks
    ]
    return "\n\n".join(parts)


def _schema_block(content_type: ContentType, field_ids: list[str] | None = None) -> str:
    """Serialize the content type schema (optionally a subset of fields) for the prompt."""
    fields = content_type.fields
    if field_ids:
        fields = [f for f in fields if f["id"] in field_ids]
    lines = []
    for f in fields:
        v = f.get("validations") or {}
        constraints = []
        if v.get("required"):
            constraints.append("required")
        if v.get("max_length"):
            constraints.append(f"max {v['max_length']} chars")
        if v.get("min_length"):
            constraints.append(f"min {v['min_length']} chars")
        if v.get("allowed_values"):
            constraints.append(f"one of {v['allowed_values']}")
        hint = f" Hint: {f['ai_hint']}" if f.get("ai_hint") else ""
        lines.append(
            f"- {f['id']} ({f['type']}{', ' + ', '.join(constraints) if constraints else ''}):"
            f" {f['name']}.{hint}"
        )
    return "\n".join(lines)


def build_generate_entry_messages(
    content_type: ContentType,
    brief: str,
    chunks: list[RetrievedChunk],
    field_ids: list[str] | None = None,
) -> list[dict]:
    user = f"""\
## Brand & editorial guidelines (authoritative)
{_guidelines_block(chunks)}

## Content type: {content_type.name} ({content_type.api_id})
Fields to generate:
{_schema_block(content_type, field_ids)}

## Editorial brief
{brief}

## Task
Write content for every field listed above. Respond with a single JSON object
mapping field id -> value. Use HTML only for richtext fields. Respect all
length constraints.
"""
    return [
        {"role": "system", "content": CMS_SYSTEM_PROMPT},
        {"role": "user", "content": user},
    ]


TRANSFORM_INSTRUCTIONS = {
    "rewrite": "Rewrite the text to improve clarity and flow while preserving meaning and approximate length.",
    "shorten": "Shorten the text significantly (aim for 50-60% of the original length) while keeping the key message.",
    "expand": "Expand the text with more detail and supporting sentences, staying factual to the original.",
    "seo": "Rewrite the text to be SEO-friendly: front-load keywords, use active voice, keep it compelling for search snippets.",
    "translate": "Translate the text into the target locale named in the editor's instruction. Preserve meaning, tone, formatting and any HTML structure; keep brand and product names untranslated.",
    "custom": "Follow the editor's instruction exactly.",
}


def build_transform_messages(
    text: str,
    mode: str,
    instruction: str,
    chunks: list[RetrievedChunk],
    field_context: str = "",
) -> list[dict]:
    task = TRANSFORM_INSTRUCTIONS.get(mode, TRANSFORM_INSTRUCTIONS["rewrite"])
    extra = f"\nAdditional instruction from the editor: {instruction}" if instruction else ""
    context = f"\nField context: {field_context}" if field_context else ""
    user = f"""\
## Brand & editorial guidelines (authoritative)
{_guidelines_block(chunks)}

## Task
{task}{extra}{context}
If the input is HTML, return HTML with the same allowed tags; if plain text, return plain text.
Return ONLY the transformed text — no preamble, no quotes, no markdown fences.

## Input text
{text}
"""
    return [
        {"role": "system", "content": CMS_SYSTEM_PROMPT},
        {"role": "user", "content": user},
    ]


def build_suggest_titles_messages(body: str, count: int, locale: str | None, chunks: list[RetrievedChunk]) -> list[dict]:
    locale_line = f"Write the titles in the locale '{locale}'.\n" if locale else ""
    user = f"""\
## Brand & editorial guidelines (authoritative)
{_guidelines_block(chunks)}

## Task
Suggest {count} alternative titles/headlines for the content below.
{locale_line}Respond with ONLY a JSON object: {{"titles": ["...", "..."]}}.
Titles must respect the guidelines (casing, tone, banned words).

## Content
{body[:6000]}
"""
    return [
        {"role": "system", "content": CMS_SYSTEM_PROMPT},
        {"role": "user", "content": user},
    ]


def build_seo_meta_messages(
    title: str, body: str, locale: str | None, chunks: list[RetrievedChunk]
) -> list[dict]:
    locale_line = f"Write in the locale '{locale}'.\n" if locale else ""
    user = f"""\
## Brand & editorial guidelines (authoritative)
{_guidelines_block(chunks)}

## Task
Generate SEO metadata for the page below. {locale_line}Respond with ONLY a JSON object:
{{
  "seo_title": string,        // <= 60 chars, includes the primary topic
  "seo_description": string,  // 150-160 chars, compelling, includes primary keyword
  "keywords": [string]        // 3-8 focus keywords/phrases
}}

## Page title
{title or "(untitled)"}

## Page content
{body[:6000]}
"""
    return [
        {"role": "system", "content": CMS_SYSTEM_PROMPT},
        {"role": "user", "content": user},
    ]


def build_translate_messages(
    content_type: ContentType,
    fields: dict,
    source_locale: str,
    target_locale: str,
    chunks: list[RetrievedChunk],
) -> list[dict]:
    user = f"""\
## Brand & editorial guidelines (authoritative)
{_guidelines_block(chunks)}

## Content type: {content_type.name} ({content_type.api_id})
{_schema_block(content_type, list(fields.keys()))}

## Task
Translate the field values below from locale '{source_locale}' to locale '{target_locale}'.
- Preserve HTML structure exactly for richtext fields (translate only the text nodes).
- Keep placeholders, brand names and product names untranslated.
- Respect length constraints from the schema and the guidelines' tone.
Respond with ONLY a JSON object mapping field id -> translated value, with the
same keys as the input.

## Field values ({source_locale})
{json.dumps(fields, indent=2, ensure_ascii=False, default=str)}
"""
    return [
        {"role": "system", "content": CMS_SYSTEM_PROMPT},
        {"role": "user", "content": user},
    ]


def build_compliance_messages(
    content_type: ContentType,
    fields: dict,
    chunks: list[RetrievedChunk],
) -> list[dict]:
    user = f"""\
## Brand & editorial guidelines (authoritative)
{_guidelines_block(chunks)}

## Content type: {content_type.name} ({content_type.api_id})
{_schema_block(content_type)}

## Content to audit (field id -> value)
{json.dumps(fields, indent=2, ensure_ascii=False, default=str)}

## Task
Audit the content against the guidelines and the field constraints. Respond
with ONLY a JSON object of this exact shape:
{{
  "passed": boolean,            // true if no warning/error issues
  "issues": [
    {{
      "field_id": string,        // which field the issue is in
      "severity": "info" | "warning" | "error",
      "message": string,         // what is wrong
      "guideline_excerpt": string, // short quote of the violated guideline, or ""
      "suggestion": string       // concrete fix, or ""
    }}
  ]
}}
If everything complies, return {{"passed": true, "issues": []}}.
"""
    return [
        {"role": "system", "content": CMS_SYSTEM_PROMPT},
        {"role": "user", "content": user},
    ]
