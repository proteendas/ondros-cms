# Testing

59 backend tests against a **real Postgres**, plus TypeScript type checking per
frontend app.

## Running

```bash
# Backend suite (needs the db service up)
docker compose up -d db
docker compose run --rm --entrypoint sh backend \
  -c "pip install -q -r requirements-dev.txt && pytest"

# Frontends
docker compose exec editor     npm run typecheck
docker compose exec preview    npm run typecheck
docker compose exec superadmin npm run typecheck
```

Useful flags:

```bash
pytest tests/test_permissions.py      # one file
pytest -k "publish"                   # by name
pytest -x                             # stop at the first failure
pytest -v                             # per-test output
```

## What's covered

| File | Tests | Area |
|---|---|---|
| `test_richtext.py` | 10 | ProseMirror document validation |
| `test_validation.py` | 8 | Field validation, locale-aware rules |
| `test_permissions.py` | 7 | Roles, capabilities, space scoping |
| `test_delivery_keys.py` | 7 | Key types, delivery vs preview visibility |
| `test_sso.py` | 7 | OIDC + GitHub OAuth, JIT provisioning |
| `test_accounts.py` | 6 | Signup, verify, refresh, invitations, isolation |
| `test_platform_admin.py` | 5 | Access control, suspension, impersonation |
| `test_billing.py` | 3 | Plan limits — the 402 and 429 paths |
| `test_locales.py` | 3 | Locales and fallback chains |
| `test_versions_audit.py` | 3 | Version snapshots, diff, restore |

The weighting is deliberate: the suite concentrates on **rules that are
expensive to get wrong** — who can do what, which key sees which content,
whether one tenant can reach another's data. CRUD happy paths are barely tested
because a broken one is obvious in seconds; a permission hole is not.

## Real database, not mocks

`conftest.py` builds a session-scoped engine against the actual Postgres
service, creating the pgvector extension and schema once.

This costs a few seconds of startup and is worth it: the interesting behaviour
here **is** database behaviour — JSONB round-tripping, cascade deletes,
`SET NULL` on audit attribution, unique constraints, pgvector columns. None of
that survives being mocked, and mocking it would mean testing a fiction.

### Fixtures

| Fixture | Provides |
|---|---|
| `engine` | Session-scoped async engine + schema |
| `db_maker` | A session factory per test |
| `client` | `httpx` client wired to the app with the test DB injected |
| `workspace` | A seeded tenant, users at each role, space, environment, content type |
| `auth(token)` | `{"Authorization": "Bearer …"}` header helper |

`workspace` is what keeps permission tests readable — you get users at every
role level without each test building its own fixture pyramid:

```python
async def test_author_cannot_publish(client, workspace):
    res = await client.post(
        f"/entries/{workspace.entry_id}/publish",
        headers=auth(workspace.author_token),
    )
    assert res.status_code == 403
```

## Writing a test

Test the **rule**, not the implementation:

```python
async def test_delivery_key_cannot_see_drafts(client, workspace):
    """A delivery key must never return unpublished content."""
    res = await client.get(
        f"/spaces/{workspace.space_id}/environments/master/delivery/entries",
        headers=auth(workspace.delivery_token),
    )
    ids = [e["id"] for e in res.json()["items"]]
    assert workspace.draft_entry_id not in ids
```

That test survives a refactor of the delivery query. A test asserting the SQL
does not.

Conventions: `asyncio_mode = auto` in `pytest.ini`, so no `@pytest.mark.asyncio`
is needed. Name tests after the behaviour — `test_author_cannot_publish`, not
`test_publish_2`.

## Frontend

`tsc --noEmit` is the frontend's test suite. There is no component test runner.

That is a real gap, stated plainly: type checking catches wrong props and
missing fields, but nothing verifies that the `Select` closes on Escape or that
the drawer traps focus. Those were verified by hand. If you add a runner,
Playwright against the running compose stack would cover the interactive
surfaces that matter most — dropdown keyboard behaviour, inline editing, and
the publish flow.

## Manual verification

Some behaviour only exists across processes and is checked by hand:

| Area | Check |
|---|---|
| Live preview | Type in a field; the iframe updates with no save |
| Inline editing | Double-click preview text; the form field focuses |
| WebSocket sync | Two browsers on one entry; save in A, watch B |
| Mobile | Drawer opens, pickers appear inside it, no horizontal page scroll |
| Webhooks | Publish, then check Settings → Webhooks → deliveries |
| Dropdowns | Keyboard only — arrows, Home/End, type-ahead, Escape |

## CI

There is no CI configuration in the repo. A minimal pipeline would be:

```yaml
- docker compose up -d db
- docker compose run --rm --entrypoint sh backend \
    -c "pip install -q -r requirements-dev.txt && pytest"
- docker compose exec -T editor     npm run typecheck
- docker compose exec -T preview    npm run typecheck
- docker compose exec -T superadmin npm run typecheck
```

Worth adding a content-model drift check too — see
[15-cli.md](15-cli.md#ci-drift-check).

## Where to go next

- Rules under test → [07-auth-and-permissions.md](07-auth-and-permissions.md)
- The spec workflow → [19-contributing.md](19-contributing.md)
