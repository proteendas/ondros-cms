# Visual checks

Layout assertions that run a real browser, because the things they cover —
icons sitting off-centre in a 60px rail, a toolbar collapsing on itself, an
iframe leaving a band of dead page beneath it — all typecheck and build
perfectly while looking wrong.

Each script measures the DOM and asserts numbers, then writes a screenshot
next to itself so the numbers can be sanity-checked by eye.

## Running them

The editor must be on **port 3000**: the backend's `CORS_ORIGINS` allows
3000/3001/3003, and on any other port login fails with "Failed to fetch".

```bash
docker compose up -d db backend        # from the repo root
npm run dev                            # editor, port 3000
python -m app.seed                     # once, for an entry to open

cd editor/scripts/visual
npm install playwright-core            # browsers come from the Playwright cache
node sidebar.mjs                       # icon rail: centring, hover, pin
node entry-page.mjs                    # preview toolbar, sticky header, AI dialog
node preview.mjs                       # viewport scaling, /preview height
node richtext-toolbar.mjs              # Select variants don't collide with layout classes
```

`lib.mjs` points at a Playwright-cached Chromium headless shell. If you have
Playwright installed properly, replace `EXE` with `chromium.executablePath()`.

## The Code Sync stub

`stub.mjs` fakes the Code Sync API so the preview renders without connecting a
real GitHub repository — it intercepts the two endpoints in the browser and
touches no database. Point `previewUrl` at any URL that renders; the scripts
default to the editor's own login page, which is always available.
