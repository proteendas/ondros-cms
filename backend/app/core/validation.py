"""Entry field validation against a content type schema.

Pure functions only (no DB) — reference EXISTENCE checks live in
app.api.entries.validate_references because they need queries.

Localization: a field with ``localized: true`` stores {locale_code: value}.
Validation runs per locale; ``required`` is satisfied when the space's
default locale has a value.
"""
import re
import uuid
from datetime import datetime
from typing import Any

REFERENCE_TYPES = {"reference", "reference_many"}
MEDIA_TYPES = {"media", "media_many"}
MANY_TYPES = {"reference_many", "media_many"}
TEXT_TYPES = {"text", "longtext", "richtext", "slug", "select"}


def _is_empty(value: Any) -> bool:
    if value is None:
        return True
    if isinstance(value, str) and not value.strip():
        return True
    if isinstance(value, (list, dict)) and len(value) == 0:
        return True
    return False


def _is_uuid(value: Any) -> bool:
    try:
        uuid.UUID(str(value))
        return True
    except (ValueError, AttributeError, TypeError):
        return False


def _check_type(fd: dict, value: Any) -> str | None:
    """Type conformance for a single (non-empty) value. Returns an error or None."""
    ftype = fd.get("type", "text")
    fid = fd["id"]
    if ftype in TEXT_TYPES and not isinstance(value, str):
        return f"Field '{fid}' must be a string"
    if ftype == "number" and (isinstance(value, bool) or not isinstance(value, (int, float))):
        return f"Field '{fid}' must be a number"
    if ftype == "boolean" and not isinstance(value, bool):
        return f"Field '{fid}' must be a boolean"
    if ftype in ("datetime", "date"):
        if not isinstance(value, str):
            return f"Field '{fid}' must be an ISO-8601 string"
        try:
            datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError:
            return f"Field '{fid}' is not a valid ISO-8601 datetime"
    if ftype in ("media", "reference") and not _is_uuid(value):
        return f"Field '{fid}' must be an id (uuid string)"
    if ftype in MANY_TYPES:
        if not isinstance(value, list) or not all(_is_uuid(v) for v in value):
            return f"Field '{fid}' must be a list of ids (uuid strings)"
    return None


def _check_validations(fd: dict, value: Any) -> list[str]:
    errors: list[str] = []
    v = fd.get("validations") or {}
    fid = fd["id"]
    if isinstance(value, str):
        if v.get("min_length") and len(value) < v["min_length"]:
            errors.append(f"Field '{fid}' must be at least {v['min_length']} characters")
        if v.get("max_length") and len(value) > v["max_length"]:
            errors.append(f"Field '{fid}' must be at most {v['max_length']} characters")
        if v.get("pattern"):
            try:
                if not re.search(v["pattern"], value):
                    errors.append(f"Field '{fid}' does not match pattern {v['pattern']}")
            except re.error:
                pass  # invalid pattern in the model — don't block editors
        if v.get("allowed_values") and value not in v["allowed_values"]:
            errors.append(f"Field '{fid}' must be one of {v['allowed_values']}")
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        if v.get("min") is not None and value < v["min"]:
            errors.append(f"Field '{fid}' must be >= {v['min']}")
        if v.get("max") is not None and value > v["max"]:
            errors.append(f"Field '{fid}' must be <= {v['max']}")
    if isinstance(value, list):
        if v.get("min_items") is not None and len(value) < v["min_items"]:
            errors.append(f"Field '{fid}' needs at least {v['min_items']} items")
        if v.get("max_items") is not None and len(value) > v["max_items"]:
            errors.append(f"Field '{fid}' allows at most {v['max_items']} items")
    return errors


def validate_entry_fields(
    field_defs: list[dict],
    values: dict[str, Any],
    default_locale: str = "en-US",
    locale_codes: list[str] | None = None,
) -> list[str]:
    """Validate entry values against the content type schema.

    Drafts are allowed to be invalid (so editors can save partial work);
    this runs on publish. Returns a flat list of error strings.
    """
    errors: list[str] = []
    known_locales = set(locale_codes or [default_locale])

    for fd in field_defs:
        fid = fd["id"]
        required = bool((fd.get("validations") or {}).get("required"))
        raw = values.get(fid)

        if fd.get("localized"):
            per_locale = raw if isinstance(raw, dict) else ({} if raw is None else None)
            if per_locale is None:
                errors.append(f"Field '{fid}' is localized and must be an object of locale -> value")
                continue
            unknown = set(per_locale.keys()) - known_locales
            if unknown:
                errors.append(f"Field '{fid}' has values for unknown locales: {sorted(unknown)}")
            if required and _is_empty(per_locale.get(default_locale)):
                errors.append(f"Field '{fid}' is required in the default locale ({default_locale})")
            for locale, value in per_locale.items():
                if _is_empty(value):
                    continue
                type_err = _check_type(fd, value)
                if type_err:
                    errors.append(f"{type_err} (locale {locale})")
                    continue
                errors.extend(f"{e} (locale {locale})" for e in _check_validations(fd, value))
        else:
            if required and _is_empty(raw):
                errors.append(f"Field '{fid}' is required")
                continue
            if _is_empty(raw):
                continue
            type_err = _check_type(fd, raw)
            if type_err:
                errors.append(type_err)
                continue
            errors.extend(_check_validations(fd, raw))

    return errors


def collect_linked_ids(field_defs: list[dict], values: dict[str, Any]) -> tuple[dict[str, set[str]], set[str]]:
    """Extract linked ids from entry values.

    Returns (entry_ids_by_field, media_ids). Localized fields contribute the
    ids of every locale. Only well-formed uuid strings are collected.
    """
    entry_ids: dict[str, set[str]] = {}
    media_ids: set[str] = set()

    def _ids_of(value: Any) -> list[str]:
        if isinstance(value, str) and _is_uuid(value):
            return [value]
        if isinstance(value, list):
            return [v for v in value if isinstance(v, str) and _is_uuid(v)]
        return []

    for fd in field_defs:
        ftype = fd.get("type")
        if ftype not in REFERENCE_TYPES | MEDIA_TYPES:
            continue
        raw = values.get(fd["id"])
        if raw is None:
            continue
        candidates: list[str] = []
        if fd.get("localized") and isinstance(raw, dict):
            for v in raw.values():
                candidates.extend(_ids_of(v))
        else:
            candidates.extend(_ids_of(raw))
        if not candidates:
            continue
        if ftype in REFERENCE_TYPES:
            entry_ids.setdefault(fd["id"], set()).update(candidates)
        else:
            media_ids.update(candidates)

    return entry_ids, media_ids
