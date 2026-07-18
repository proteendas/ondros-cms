"""Rich text (ProseMirror/TipTap JSON) support (spec 015).

RichText fields store a versioned ProseMirror JSON document:

    { "richTextSchemaVersion": 1, "type": "doc", "content": [ ...nodes ] }

A legacy value may still be a plain HTML *string* — callers handle that
separately (the editor parses it, renderers print it). This module owns:

  * the catalogue of supported node/mark types,
  * per-field allowed-set resolution from a field's ``rich_text`` config,
  * structural + allowed-type validation of a stored doc,
  * extraction of embedded/linked entry & asset ids for reference integrity
    and delivery-side include resolution.

Kept dependency-free (pure dict walking) so it runs in both the validator and
the delivery serializer.
"""
from __future__ import annotations

from typing import Any

RICH_TEXT_SCHEMA_VERSION = 1

# Every node/mark the editor can produce. A field may narrow this via its
# rich_text config, but never widen it.
SUPPORTED_NODES: set[str] = {
    "doc", "paragraph", "text", "heading", "blockquote",
    "bulletList", "orderedList", "listItem", "codeBlock",
    "horizontalRule", "hardBreak",
    "table", "tableRow", "tableCell", "tableHeader",
    "embeddedEntryBlock", "embeddedEntryInline", "embeddedAssetBlock",
}
SUPPORTED_MARKS: set[str] = {
    "bold", "italic", "underline", "strike", "code",
    "textStyle", "highlight", "link", "linkedEntry", "linkedAsset",
}

# Nodes/marks always present regardless of config (structural + plain text).
_CORE_NODES = {"doc", "paragraph", "text", "hardBreak"}
_TABLE_NODES = {"table", "tableRow", "tableCell", "tableHeader"}
_COLOR_MARKS = {"textStyle"}
_HIGHLIGHT_MARKS = {"highlight"}
_LINK_MARKS = {"link", "linkedEntry", "linkedAsset"}

# Node types that carry an embedded/linked *entry* id vs *asset* id.
_ENTRY_EMBED_NODES = {"embeddedEntryBlock", "embeddedEntryInline"}
_ASSET_EMBED_NODES = {"embeddedAssetBlock"}


def default_config() -> dict:
    """The permissive default when a field has no ``rich_text`` config."""
    return {
        "allowed_marks": None,
        "allowed_nodes": None,
        "allowed_embed_types": [],
        "allow_color": True,
        "allow_highlight": True,
        "allow_tables": True,
        "allow_links": True,
    }


def resolve_allowed(config: dict | None) -> tuple[set[str], set[str]]:
    """Compute the (allowed_nodes, allowed_marks) sets for a field."""
    cfg = {**default_config(), **(config or {})}

    nodes = set(cfg["allowed_nodes"]) if cfg["allowed_nodes"] is not None else set(SUPPORTED_NODES)
    marks = set(cfg["allowed_marks"]) if cfg["allowed_marks"] is not None else set(SUPPORTED_MARKS)

    nodes &= SUPPORTED_NODES
    marks &= SUPPORTED_MARKS
    nodes |= _CORE_NODES  # structural nodes are never removable

    if not cfg["allow_tables"]:
        nodes -= _TABLE_NODES
    if not cfg["allow_color"]:
        marks -= _COLOR_MARKS
    if not cfg["allow_highlight"]:
        marks -= _HIGHLIGHT_MARKS
    if not cfg["allow_links"]:
        marks -= _LINK_MARKS
    return nodes, marks


def is_json_doc(value: Any) -> bool:
    return isinstance(value, dict) and value.get("type") == "doc"


def _walk(node: Any):
    """Yield every node dict in the document (depth-first)."""
    if not isinstance(node, dict):
        return
    yield node
    for child in node.get("content") or []:
        yield from _walk(child)


def validate_doc(value: Any, config: dict | None) -> list[str]:
    """Structural + allowed-type validation of a rich text JSON doc.

    Returns a list of human-readable errors (empty = valid). A plain string is
    treated as legacy HTML and accepted as-is (validated elsewhere as text).
    """
    if isinstance(value, str):
        return []
    if not is_json_doc(value):
        return ["Rich text value must be a ProseMirror JSON document (type 'doc')"]

    version = value.get("richTextSchemaVersion", RICH_TEXT_SCHEMA_VERSION)
    if not isinstance(version, int) or version > RICH_TEXT_SCHEMA_VERSION:
        return [f"Unsupported richTextSchemaVersion: {version}"]

    allowed_nodes, allowed_marks = resolve_allowed(config)
    errors: list[str] = []
    seen_bad_nodes: set[str] = set()
    seen_bad_marks: set[str] = set()

    for node in _walk(value):
        ntype = node.get("type")
        if not isinstance(ntype, str):
            errors.append("Rich text node is missing a 'type'")
            continue
        if ntype not in SUPPORTED_NODES:
            if ntype not in seen_bad_nodes:
                seen_bad_nodes.add(ntype)
                errors.append(f"Unknown rich text node type: '{ntype}'")
            continue
        if ntype not in allowed_nodes and ntype not in seen_bad_nodes:
            seen_bad_nodes.add(ntype)
            errors.append(f"Rich text node '{ntype}' is not allowed for this field")
        for mark in node.get("marks") or []:
            mtype = mark.get("type") if isinstance(mark, dict) else None
            if not isinstance(mtype, str) or mtype not in SUPPORTED_MARKS:
                if mtype not in seen_bad_marks:
                    seen_bad_marks.add(mtype)
                    errors.append(f"Unknown rich text mark type: '{mtype}'")
            elif mtype not in allowed_marks and mtype not in seen_bad_marks:
                seen_bad_marks.add(mtype)
                errors.append(f"Rich text mark '{mtype}' is not allowed for this field")
    return errors


def collect_ids(value: Any) -> tuple[set[str], set[str]]:
    """Return (entry_ids, asset_ids) embedded or linked inside a doc.

    Covers embed nodes (attrs.id) and the linkedEntry/linkedAsset marks. A
    legacy HTML string contributes nothing.
    """
    entry_ids: set[str] = set()
    asset_ids: set[str] = set()
    if not is_json_doc(value):
        return entry_ids, asset_ids

    for node in _walk(value):
        ntype = node.get("type")
        attrs = node.get("attrs") or {}
        node_id = attrs.get("id")
        if node_id:
            if ntype in _ENTRY_EMBED_NODES:
                entry_ids.add(str(node_id))
            elif ntype in _ASSET_EMBED_NODES:
                asset_ids.add(str(node_id))
        for mark in node.get("marks") or []:
            if not isinstance(mark, dict):
                continue
            mid = (mark.get("attrs") or {}).get("id")
            if not mid:
                continue
            if mark.get("type") == "linkedEntry":
                entry_ids.add(str(mid))
            elif mark.get("type") == "linkedAsset":
                asset_ids.add(str(mid))
    return entry_ids, asset_ids


def collect_embedded_entry_ids(value: Any) -> set[str]:
    """Just the entry ids that are *embedded as nodes* (not link marks) —
    used to enforce allowed_embed_types."""
    ids: set[str] = set()
    if not is_json_doc(value):
        return ids
    for node in _walk(value):
        if node.get("type") in _ENTRY_EMBED_NODES:
            nid = (node.get("attrs") or {}).get("id")
            if nid:
                ids.add(str(nid))
    return ids


def plain_text(value: Any) -> str:
    """Extract plain text from a doc (paragraph breaks preserved). Used by AI
    text extraction. Legacy strings are returned unchanged."""
    if isinstance(value, str):
        return value
    if not is_json_doc(value):
        return ""
    parts: list[str] = []

    def render(node: dict) -> None:
        if node.get("type") == "text":
            parts.append(node.get("text") or "")
            return
        for child in node.get("content") or []:
            render(child)
        if node.get("type") in {"paragraph", "heading", "blockquote", "listItem", "codeBlock"}:
            parts.append("\n")

    render(value)
    return "".join(parts).strip()
