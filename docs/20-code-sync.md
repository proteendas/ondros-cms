# Code Sync — preview your own site, not a generic rendering

Ondros previews content the way Adobe's **Universal Editor** does: the editor
does **not** render entries itself. It loads *your project's deployed site* in
an iframe and edits it in place, so an author sees the real page — your CSS,
your components, your layout — and edits it where it appears.

The link between a space and the project that renders it is **Ondros Code
Sync**, a GitHub App that connects a space to a repository.

```mermaid
flowchart LR
    subgraph GH["GitHub"]
      REPO["your repo<br/><i>blocks/ — manifest optional</i>"]
    end
    subgraph CMS["Ondros"]
      SYNC["Code Sync<br/><i>components + routes</i>"]
      ED["Editor<br/><i>entry form</i>"]
    end
    SITE["your deployed site<br/><i>+ ondros-editor.js</i>"]

    REPO -->|"App reads / derives the mapping"| SYNC
    SYNC -->|"which URL shows this entry?"| ED
    ED -->|"iframe + postMessage"| SITE
    SITE -->|"click / inline edit"| ED
    SITE -->|"delivery API"| CMS
```

Until a space is connected, the preview pane has nothing it could honestly
show, so it says **Connect with GitHub for preview** instead of rendering a
placeholder.

---

## What a connected project provides

Two things, neither of them large:

1. **The bridge script** on its pages, which makes the site selectable and
   editable from the editor.
2. **`data-ondros-*` attributes** in its markup, saying what each element
   renders.

And optionally a third:

3. **A component manifest**, when the conventions below aren't what your
   project does — custom routes, a declared deployment URL, or a block whose
   name differs from the content type it renders.

That's the whole contract. Your project keeps its own framework, build and
hosting.

---

## 1. The mapping (manifest optional)

Ondros needs to know which component renders which content type, and at which
URL each content type's entries live. It works that out in one of three ways,
in this order.

### By convention, with no file at all

A repository that ships no manifest is mapped automatically:

- components are discovered from its **`blocks/`** directory (the Edge Delivery
  Services layout) and bound to the content type whose `api_id` matches —
  `blocks/hero/` renders `hero`, `blocks/landing-page/` renders `landing_page`
  (kebab-case blocks match snake_case api_ids);
- a content type with **no matching block still gets a component**, because
  plenty of sites render pages from a template rather than a block;
- every page-like type is routed at **`/{contentType}/{slug}`**.

The sync report shows the result as `derived`. This is what makes "connect any
repository and it works" true — commit nothing, connect, preview.

### By a committed manifest

When the conventions don't fit, commit one. Both supported shapes are detected
automatically; the first file found wins, and any file beats derivation:

| Order | Path | Flavor |
|---|---|---|
| 1 | `ondros/component-definition.json` | Ondros |
| 2 | `.ondros/component-definition.json` | Ondros |
| 3 | `component-definition.json` | AEM Universal Editor |
| 4 | `ue/component-definition.json` | AEM Universal Editor |

### Ondros flavor

Written for this CMS, so one file says everything:

```jsonc
{
  "previewUrl": "https://site.example.com",   // where this branch is deployed
  "routes": {                                  // content type api_id -> URL
    "landing_page": "/{slug}",
    "article": "/blog/{slug}"
  },
  "components": [
    {
      "id": "hero",
      "title": "Hero Section",
      "contentType": "hero",                   // api_id of the content type
      "block": "hero",                         // blocks/hero/hero.js (EDS-style)
      "fields": [
        { "name": "heading", "label": "Heading", "component": "text" },
        { "name": "subheading", "label": "Subheading", "component": "text" }
      ]
    }
  ]
}
```

`routes` templates understand `{slug}` and `{contentType}`. A content type with
no route falls back to `/{contentType}/{slug}`.

`previewUrl` is a convenience — a value set in **Settings → Code Sync**
overrides it, which is what you want for branch deploys.

### AEM Universal Editor flavor

A repository already set up for Adobe's Universal Editor connects unchanged:

```jsonc
// component-definition.json
{
  "groups": [{
    "id": "blocks",
    "components": [
      { "id": "hero", "title": "Hero", "model": "hero" },
      { "id": "teaser", "title": "Teaser", "model": "teaser",
        "plugins": { "ondros": { "contentType": "card", "block": "cards" } } }
    ]
  }]
}
```

```jsonc
// component-models.json  (optional — supplies each component's fields)
[{ "id": "hero", "fields": [
    { "component": "text", "name": "heading", "label": "Heading" },
    { "component": "richtext", "name": "body", "label": "Body" }]}]
```

Binding rule: a component's `id` binds to the content type with the **same
`api_id`**. Override it — and add a `previewUrl` or `routes` — under
`plugins.ondros`, without leaving the AEM format.

Both flavors — and the derived mapping — normalize to one internal structure,
so nothing downstream cares which one your repo ships.

---

## 2. The bridge script

Include it on every page. It is served by the CMS so every site runs one
version:

```html
<script src="https://cms.example.com/code-sync/ondros-editor.js" defer></script>
```

It **no-ops unless the page is open inside the editor** (it checks for an
`ondros-preview` query parameter or being framed), so it is safe to ship to
production.

What it does when the editor *is* the parent:

- outlines the element under the cursor and shows its label,
- posts the clicked field back to the editor, which selects it in the form,
- makes text fields `contenteditable` on double-click and posts the new value
  on blur — the **editor** persists it, so the site never holds credentials,
- applies `FIELD_UPDATED` messages straight to the DOM, so typing in the form
  shows up with no refetch,
- scrolls to and outlines one component when previewing a block.

---

## 3. Instrumentation

Mark up what each element renders. The vocabulary mirrors AEM's `data-aue-*`:

| Attribute | On | Meaning |
|---|---|---|
| `data-ondros-resource` | an entry wrapper | `entry:<uuid>` — which entry this subtree renders |
| `data-ondros-component` | an entry wrapper | the content type's `api_id` |
| `data-ondros-prop` | a field element | the field id |
| `data-ondros-type` | a field element | `text` · `longtext` · `richtext` · `select` · `number` · `media` · `reference` |
| `data-ondros-label` | a field element | optional label shown in the overlay |

```html
<section data-ondros-resource="entry:9f2c…" data-ondros-component="hero">
  <h1 data-ondros-prop="heading"    data-ondros-type="text">Ship faster</h1>
  <p  data-ondros-prop="subheading" data-ondros-type="text">One place …</p>
</section>
```

Nest wrappers freely: a landing page that renders a hero and three cards emits
one `data-ondros-resource` per block, and edits are attributed to the right
entry automatically.

Only `text`, `longtext`, `richtext`, `slug`, `select` and `number` are editable
in place — structured values (references, media, JSON) are edited in the form,
because there is no sensible `contenteditable` representation of them.

> The bundled `preview/` app is the reference implementation of this contract:
> it emits `data-ondros-*` attributes and loads the bridge script. Its routes
> (`/landing_page/{slug}`, `/article/{slug}`) are exactly the convention, so it
> needs no manifest — point a space at any repo with
> `previewUrl=http://localhost:3001` to watch the whole loop locally.

---

## Page-wise and component-wise preview

Which URL the editor opens depends on whether the entry is a page or a block —
which, per [content modeling](08-content-modeling.md#slugs), is decided by
whether its content type models a `slug` field.

| Entry | Mode | What the editor shows |
|---|---|---|
| Type models a slug, slug filled in | `page` | The entry's own URL on your site |
| Type models a slug, slug blank | `unroutable` | "Fill in the slug field to give this entry a URL" |
| Type models no slug, used on a page | `component` | That page, scrolled to the component and outlined |
| Type models no slug, unused | `orphan` | "No page references this yet" |

Component-wise preview is what makes editing a `hero` or `card` sensible: a
block has no page of its own, so Ondros finds a page that references it
(published pages preferred) and reveals it there — exactly what the Universal
Editor does. The referencing page is found by scanning reference fields,
including links nested in repeatable groups and rich text.

---

## Setting it up

### Register the GitHub App (once per deployment)

1. **GitHub → Settings → Developer settings → GitHub Apps → New GitHub App.**
2. Name it `Ondros Code Sync` (the slug becomes `GITHUB_APP_SLUG`).
3. **Setup URL** (under *Post installation*):
   `https://cms.example.com/code-sync/github/callback`
   The form calls this optional; for Ondros it is **required** — it is where
   GitHub sends the new `installation_id`, and without it an install never
   reaches the CMS. There is no field called "Callback URL": the *Redirect URI*
   above it belongs to the user-authorization (OAuth) flow, which Ondros does
   not use. Leave it blank and leave *Request user authorization (OAuth) during
   installation* unchecked.
4. **Webhook URL**: `https://cms.example.com/code-sync/github/webhook`,
   with a secret you keep.
5. **Permissions**: Repository → *Contents: Read-only* (this also reveals the
   `Push` event), *Metadata: Read-only* (mandatory, selected for you).
6. **Subscribe to events**: `Push`. `Installation` is not in the list because
   GitHub delivers installation events to every App automatically.
7. Generate a private key and set the backend's environment:

```bash
GITHUB_APP_ID=123456
GITHUB_APP_SLUG=ondros-code-sync
GITHUB_APP_PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----\n…"   # or base64 of the PEM
GITHUB_APP_WEBHOOK_SECRET=…
```

Until those are set, `mode` is `none` and the editor explains that an operator
must register the App — a different message from "this space isn't connected
yet", because it is a different problem.

### Local development without an App

```bash
GITHUB_TOKEN=ghp_…      # a PAT with read access to the repo
```

`mode` becomes `token` and everything works except the install flow — pick the
repository directly in **Settings → Code Sync**. Never use this in production:
the token carries its owner's full access, where an App installation carries
only what the customer granted.

### Connect a space

1. **Settings → Code Sync → Connect with GitHub**, install the App on the
   repository that builds the site.
2. GitHub returns to the **Setup URL**, which records the installation against
   the space (carried in `state`, which GitHub preserves from the install
   link) and bounces back to `{FRONTEND_URL}/settings/code-sync` — so
   `FRONTEND_URL` must point at your editor app.
3. Choose the repository and branch. Ondros reads the manifest immediately and
   reports what it found.

The sync report names the two ways a preview silently renders nothing:
**content types with no component** and **components naming a content type
that doesn't exist**.

Pushes to the connected branch re-sync the manifest automatically (signed
webhook); removing the installation marks the connection as errored rather
than deleting content.

---

## API

| Method | Path | Capability |
|---|---|---|
| `GET` | `/spaces/{space_id}/code-sync` | `read_content` |
| `GET` | `/spaces/{space_id}/code-sync/repositories` | `manage_settings` |
| `POST` | `/spaces/{space_id}/code-sync/connect` | `manage_settings` |
| `PATCH` | `/spaces/{space_id}/code-sync` | `manage_settings` |
| `POST` | `/spaces/{space_id}/code-sync/sync` | `manage_settings` |
| `DELETE` | `/spaces/{space_id}/code-sync` | `manage_settings` |
| `GET` | `/spaces/{id}/environments/{env}/code-sync/preview-target?entry_id=` | `read_content` |
| `GET` | `/spaces/{id}/environments/{env}/delivery/code-sync` | delivery/preview API key |
| `POST` | `/code-sync/github/webhook` | HMAC signature |
| `GET` | `/code-sync/github/callback` | — (the App's Setup URL) |

The delivery-plane endpoint lets a connected site read its own component
mapping with the API key it already has, without management credentials in the
browser.

---

## Troubleshooting

| Symptom | Cause |
|---|---|
| "Connect with GitHub for preview" | The space has no connection yet |
| "Code Sync isn't set up on this server" | No `GITHUB_APP_*` and no `GITHUB_TOKEN` |
| "Nothing to map" | The branch has no manifest, no `blocks/` directory, and the environment has no content types |
| Sync reports `derived` | No manifest was committed — the mapping came from conventions. Commit one to override routes or block names |
| Preview loads but nothing is selectable | The page is missing `data-ondros-*` attributes — the editor warns about this explicitly |
| "No page references this … yet" | A block that no page uses; add it to a page |
| "This entry has no URL yet" | A page whose slug field is still blank |
| Sync says a content type is unmapped | Add a component for it, or the preview will render an empty page |
