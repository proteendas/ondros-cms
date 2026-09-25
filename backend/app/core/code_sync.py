"""Reading a connected repository's component manifest.

A project tells Ondros how it renders content by committing a manifest. Two
shapes are accepted, because teams arrive from two directions:

  **Ondros** — ``ondros/component-definition.json``. Written for this CMS, so
  it can say everything in one file: where the project is deployed, how each
  content type maps onto a route, and which block renders which type.

  **AEM Universal Editor** — ``component-definition.json`` (+ the optional
  ``component-models.json``) in the shape Adobe's Universal Editor already
  uses. A repo that has one works unchanged; a component's ``id`` is matched
  to the content type of the same ``api_id`` unless it says otherwise under
  ``plugins.ondros``.

**Neither is required.** A repository that ships no manifest is mapped by
convention instead: components are discovered from its ``blocks/`` directory
(the Edge Delivery Services layout) and bound to the content type whose
``api_id`` matches, with every page-like type routed at
``/{contentType}/{slug}``. Committing a manifest is how a project *overrides*
that — custom routes, a declared deployment URL, a block whose name differs
from the content type it renders.

All three paths produce the single structure the editor and the preview
bridge consume::

    {
      "previewUrl": "https://site.example.com",
      "routes":     {"landing_page": "/{slug}", "article": "/blog/{slug}"},
      "components": [
        {"id": "hero", "title": "Hero", "contentType": "hero",
         "block": "hero", "template": "", "fields": [
            {"name": "heading", "label": "Heading", "component": "text"}]}
      ]
    }

Everything here is pure: fetching is passed in as a coroutine so this module
is directly unit-testable without GitHub.
"""
from __future__ import annotations

import json
import logging
from typing import Any, Awaitable, Callable

logger = logging.getLogger(__name__)

# Tried in order. The first file that parses wins.
MANIFEST_CANDIDATES: list[tuple[str, str]] = [
    ("ondros", "ondros/component-definition.json"),
    ("ondros", ".ondros/component-definition.json"),
    ("aem", "component-definition.json"),
    ("aem", "ue/component-definition.json"),
]
MODELS_CANDIDATES = [
    "component-models.json",
    "ue/component-models.json",
    "ondros/component-models.json",
]

# Default route for a page-like content type when the manifest doesn't say.
DEFAULT_ROUTE = "/{contentType}/{slug}"

Fetcher = Callable[[str], Awaitable[str | None]]
DirLister = Callable[[str], Awaitable[list[str]]]


class ManifestError(ValueError):
    """The repo has a manifest but we can't use it."""


def _as_list(value: Any) -> list:
    return value if isinstance(value, list) else []


def _normalize_field(raw: dict) -> dict:
    """One editable field, in the Universal Editor's field vocabulary."""
    name = raw.get("name") or raw.get("id") or ""
    return {
        "name": name,
        "label": raw.get("label") or raw.get("title") or name,
        # 'component' is the widget hint (text, richtext, reference, image…).
        "component": raw.get("component") or raw.get("type") or "text",
    }


def _normalize_component(raw: dict, *, models: dict[str, list], source: str) -> dict | None:
    """One component entry, or None if it names no content type we could bind."""
    comp_id = raw.get("id") or raw.get("name") or ""
    if not comp_id:
        return None

    # An AEM repo can opt into an explicit mapping without leaving its format.
    plugins = raw.get("plugins") or {}
    ondros = plugins.get("ondros") if isinstance(plugins, dict) else None
    ondros = ondros if isinstance(ondros, dict) else {}

    content_type = (
        raw.get("contentType")
        or ondros.get("contentType")
        # Convention: a component named `hero` renders the `hero` content type.
        or comp_id
    )
    fields = _as_list(raw.get("fields")) or models.get(raw.get("model") or comp_id, [])
    return {
        "id": comp_id,
        "title": raw.get("title") or raw.get("name") or comp_id,
        "contentType": content_type,
        # EDS-style block folder (blocks/<block>/<block>.js). Informational for
        # the editor — the project's own deployment does the rendering.
        "block": raw.get("block") or ondros.get("block") or comp_id,
        "template": raw.get("template") or ondros.get("template") or "",
        "fields": [_normalize_field(f) for f in _as_list(fields) if isinstance(f, dict)],
        "source": source,
    }


def _collect_aem_components(doc: Any) -> list[dict]:
    """AEM nests components under groups; older files use a flat list."""
    if isinstance(doc, list):
        return [c for c in doc if isinstance(c, dict)]
    if not isinstance(doc, dict):
        return []
    if isinstance(doc.get("components"), list):
        return [c for c in doc["components"] if isinstance(c, dict)]
    out: list[dict] = []
    for group in _as_list(doc.get("groups")):
        if isinstance(group, dict):
            out.extend(c for c in _as_list(group.get("components")) if isinstance(c, dict))
    return out


def _parse_models(text: str | None) -> dict[str, list]:
    """component-models.json -> {model id: [field, ...]}."""
    if not text:
        return {}
    try:
        doc = json.loads(text)
    except json.JSONDecodeError:
        logger.warning("Code Sync: component-models.json is not valid JSON; ignoring")
        return {}
    models = doc if isinstance(doc, list) else _as_list(doc.get("models"))
    return {
        m["id"]: _as_list(m.get("fields"))
        for m in models
        if isinstance(m, dict) and m.get("id")
    }


def normalize(doc: Any, source: str, models: dict[str, list] | None = None) -> dict:
    """Turn either manifest flavor into the normalized structure."""
    models = models or {}
    if source == "ondros":
        if not isinstance(doc, dict):
            raise ManifestError("ondros/component-definition.json must be a JSON object")
        raw_components = _as_list(doc.get("components"))
        preview_url = (doc.get("previewUrl") or doc.get("preview_url") or "").strip()
        raw_routes = doc.get("routes") if isinstance(doc.get("routes"), dict) else {}
    else:
        raw_components = _collect_aem_components(doc)
        # AEM's definition has nowhere for these; a repo that wants them should
        # use the Ondros manifest (or set the preview URL in the editor).
        preview_url = ""
        raw_routes = {}
        if isinstance(doc, dict) and isinstance(doc.get("plugins"), dict):
            ondros = doc["plugins"].get("ondros")
            if isinstance(ondros, dict):
                preview_url = (ondros.get("previewUrl") or "").strip()
                raw_routes = ondros.get("routes") if isinstance(ondros.get("routes"), dict) else {}

    components: list[dict] = []
    seen: set[str] = set()
    for raw in raw_components:
        comp = _normalize_component(raw, models=models, source=source)
        if comp and comp["id"] not in seen:
            seen.add(comp["id"])
            components.append(comp)

    routes = {
        str(k): str(v)
        for k, v in (raw_routes or {}).items()
        if isinstance(k, str) and isinstance(v, str) and v.startswith("/")
    }
    return {"previewUrl": preview_url, "routes": routes, "components": components}


def derive(block_names: list[str], content_type_api_ids: list[str]) -> dict:
    """Build a manifest for a repository that ships none.

    Connecting a project should not require committing a file first, so the
    mapping is inferred the way the conventions already imply:

      * a block directory named ``hero`` renders the ``hero`` content type;
      * a content type with no matching block still gets a component, because
        the site may render it from a page template rather than a block — the
        editor would otherwise report it as unmapped and imply it is broken;
      * every type is routed at ``/{contentType}/{slug}``.

    A project that needs anything else commits a manifest, which wins.
    """
    blocks = {b for b in block_names if b}
    api_ids = [a for a in content_type_api_ids if a]
    components = [
        {
            "id": api_id,
            "title": api_id.replace("_", " ").title(),
            "contentType": api_id,
            # Blocks are usually kebab-case where api_ids are snake_case.
            "block": next(
                (b for b in (api_id, api_id.replace("_", "-")) if b in blocks),
                api_id.replace("_", "-"),
            ),
            "template": "",
            "fields": [],
            "source": "derived",
        }
        for api_id in api_ids
    ]
    # Blocks with no content type of the same name are still worth reporting:
    # they are the project's components that nothing in the model drives.
    known = {c["block"] for c in components}
    for block in sorted(blocks - known):
        components.append(
            {
                "id": block,
                "title": block.replace("-", " ").title(),
                "contentType": "",
                "block": block,
                "template": "",
                "fields": [],
                "source": "derived",
            }
        )
    return {"previewUrl": "", "routes": {}, "components": components}


async def discover(
    fetch: Fetcher,
    list_dir: DirLister | None = None,
    content_type_api_ids: list[str] | None = None,
) -> tuple[dict, str, str]:
    """Find and normalize the repo's manifest, or derive one by convention.

    ``fetch(path)`` returns a file's text or None; ``list_dir(path)`` returns
    directory entry names. Returns (manifest, source, path) where source is
    ``ondros``, ``aem`` or ``derived``.
    """
    for source, path in MANIFEST_CANDIDATES:
        text = await fetch(path)
        if not text:
            continue
        try:
            doc = json.loads(text)
        except json.JSONDecodeError as exc:
            raise ManifestError(f"{path} is not valid JSON: {exc}") from exc

        models: dict[str, list] = {}
        if source == "aem":
            for models_path in MODELS_CANDIDATES:
                models = _parse_models(await fetch(models_path))
                if models:
                    break
        return normalize(doc, source, models), source, path

    blocks = await list_dir("blocks") if list_dir else []
    manifest = derive(blocks, content_type_api_ids or [])
    if not manifest["components"]:
        raise ManifestError(
            "Nothing to map: this branch has no component manifest and no blocks/ "
            "directory, and this environment has no content types. Commit "
            "ondros/component-definition.json (or an AEM component-definition.json) "
            "to describe how your project renders content."
        )
    return manifest, "derived", ""


def route_for(manifest: dict, content_type: str, slug: str) -> str:
    """Path on the project's site that renders this page.

    The manifest's ``routes`` map wins; otherwise a page lives at the
    conventional ``/{contentType}/{slug}``. Only page-like types reach here —
    a block has no page of its own and is previewed inside whichever page
    references it (see app.api.code_sync.preview_target).
    """
    template = ((manifest or {}).get("routes") or {}).get(content_type) or DEFAULT_ROUTE
    return template.replace("{slug}", slug).replace("{contentType}", content_type)
