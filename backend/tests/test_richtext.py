"""Rich text (ProseMirror JSON) support — spec 015.

Unit coverage of app.core.richtext plus integration: publishing entries with
richtext JSON (allowed/disallowed marks, embedded entries) and delivery-side
resolution of entries embedded in richtext into `includes`.
"""
import uuid

import pytest

from app.core import richtext
from tests.conftest import DELIVERY_TOKEN, auth


def _doc(*content):
    return {"richTextSchemaVersion": 1, "type": "doc", "content": list(content)}


def _para(text, marks=None):
    node = {"type": "text", "text": text}
    if marks:
        node["marks"] = marks
    return {"type": "paragraph", "content": [node]}


# --- unit -------------------------------------------------------------------------


def test_validate_accepts_legacy_html_string():
    assert richtext.validate_doc("<p>hello</p>", None) == []


def test_validate_rejects_non_doc():
    assert richtext.validate_doc({"type": "paragraph"}, None)


def test_validate_flags_disallowed_mark():
    doc = _para("hi", [{"type": "textStyle", "attrs": {"color": "#f00"}}])
    assert richtext.validate_doc(_doc(doc), None) == []
    errs = richtext.validate_doc(_doc(doc), {"allow_color": False})
    assert errs and "textStyle" in errs[0]


def test_validate_flags_disallowed_node():
    doc = _doc({"type": "heading", "attrs": {"level": 2}, "content": [{"type": "text", "text": "T"}]})
    assert richtext.validate_doc(doc, {"allowed_nodes": ["paragraph"]})


def test_validate_rejects_future_schema_version():
    doc = _doc(_para("hi"))
    doc["richTextSchemaVersion"] = 999
    assert richtext.validate_doc(doc, None)


def test_collect_ids_from_embeds_and_link_marks():
    eid, aid = str(uuid.uuid4()), str(uuid.uuid4())
    lid = str(uuid.uuid4())
    doc = _doc(
        {"type": "embeddedEntryBlock", "attrs": {"id": eid}},
        {"type": "embeddedAssetBlock", "attrs": {"id": aid}},
        _para("link", [{"type": "linkedEntry", "attrs": {"id": lid}}]),
    )
    entries, assets = richtext.collect_ids(doc)
    assert entries == {eid, lid}
    assert assets == {aid}
    # allowed_embed_types enforcement targets embed nodes only, not link marks.
    assert richtext.collect_embedded_entry_ids(doc) == {eid}


def test_plain_text_extraction():
    doc = _doc(_para("Hello"), _para("World"))
    assert richtext.plain_text(doc) == "Hello\nWorld"


# --- integration ------------------------------------------------------------------


async def _make_entry(client, ws, fields, slug):
    admin = auth(ws["tokens"]["ORG_ADMIN"])
    res = await client.post(
        f"/spaces/{ws['space'].id}/environments/master/entries",
        json={"content_type_id": str(ws["article_ct"].id), "slug": slug, "fields": fields},
        headers=admin,
    )
    assert res.status_code == 201, res.text
    return res.json()


@pytest.mark.asyncio
async def test_publish_accepts_richtext_json(client, workspace):
    ws = workspace
    body = _doc(_para("Bold", [{"type": "bold"}]), _para("colour", [{"type": "textStyle", "attrs": {"color": "#4f46e5"}}]))
    entry = await _make_entry(client, ws, {"title": {"en-US": "T"}, "body": body}, "rt-json")
    res = await client.post(f"/entries/{entry['id']}/publish", headers=auth(ws["tokens"]["ORG_ADMIN"]))
    assert res.status_code == 200, res.text


@pytest.mark.asyncio
async def test_publish_rejects_disallowed_mark(client, workspace):
    ws = workspace
    admin = auth(ws["tokens"]["ORG_ADMIN"])
    # A content type whose richtext field forbids color.
    ct = (await client.post(
        f"/spaces/{ws['space'].id}/environments/master/content-types",
        json={
            "name": "Blurb", "api_id": "blurb", "display_field": "title",
            "fields": [
                {"id": "title", "name": "Title", "type": "text", "validations": {"required": True}},
                {"id": "note", "name": "Note", "type": "richtext",
                 "rich_text": {"allow_color": False}, "validations": {}},
            ],
        },
        headers=admin,
    )).json()
    body = _doc(_para("x", [{"type": "textStyle", "attrs": {"color": "#f00"}}]))
    res = await client.post(
        f"/spaces/{ws['space'].id}/environments/master/entries",
        json={"content_type_id": ct["id"], "slug": "blurb-1", "fields": {"title": "T", "note": body}},
        headers=admin,
    )
    entry = res.json()
    res = await client.post(f"/entries/{entry['id']}/publish", headers=admin)
    assert res.status_code == 422
    assert any("not allowed" in e for e in res.json()["detail"]["errors"])


@pytest.mark.asyncio
async def test_delivery_resolves_richtext_embed(client, workspace):
    ws = workspace
    admin = auth(ws["tokens"]["ORG_ADMIN"])
    # A hero entry to embed.
    hero = (await client.post(
        f"/spaces/{ws['space'].id}/environments/master/entries",
        json={"content_type_id": str(ws["hero_ct"].id), "slug": "embed-hero",
              "fields": {"heading": "Embedded hero"}},
        headers=admin,
    )).json()
    await client.post(f"/entries/{hero['id']}/publish", headers=admin)

    body = _doc(_para("Intro"), {"type": "embeddedEntryBlock", "attrs": {"id": hero["id"]}})
    article = await _make_entry(client, ws, {"title": {"en-US": "Has embed"}, "body": body}, "has-embed")
    await client.post(f"/entries/{article['id']}/publish", headers=admin)

    url = f"/spaces/{ws['space'].id}/environments/master/delivery/entries"
    res = (await client.get(f"{url}?slug=has-embed&include=2", headers=auth(DELIVERY_TOKEN))).json()
    included_ids = {e["id"] for e in res["includes"]["Entry"]}
    assert hero["id"] in included_ids
