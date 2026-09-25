/**
 * The richtext toolbar's block-type Select must sit on the same centre line as
 * the buttons beside it.
 *
 * It did not: the trigger rendered `class="select-trigger toolbar"`, and
 * `.toolbar` is also the page-header layout utility, whose `margin-bottom:14px`
 * applied to the trigger by accident. That made it the tallest item on the
 * flex line, so `align-items:center` centred every other button against its
 * inflated box and left the picker 7px high. Variants are namespaced
 * `select-<variant>` now; this guards both the collision and the alignment.
 */
import { login, BASE } from './lib.mjs';

const { browser, page } = await login({ width: 1440, height: 950 });
const fail = [];
const ok = (c, m) => { console.log(`  ${c ? 'ok  ' : 'FAIL'} ${m}`); if (!c) fail.push(m); };

await page.goto(`${BASE}/entries`, { waitUntil: 'networkidle' });
await page.waitForSelector('table.list a[href^="/entries/"]', { timeout: 20000 });
const hrefs = [...new Set(await page.locator('table.list a[href^="/entries/"]')
  .evaluateAll((els) => els.map((e) => e.getAttribute('href'))))];

let found = null;
for (const href of hrefs.slice(0, 12)) {
  await page.goto(`${BASE}${href}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  if (await page.locator('.tiptap-toolbar .select-trigger').count()) { found = href; break; }
}
console.log('  entry:', found);
ok(!!found, 'found an entry with a richtext field');

if (found) {
  const m = await page.evaluate(() => {
    const bar = document.querySelector('.tiptap-toolbar');
    const sel = bar.querySelector('.select-trigger');
    const mid = (el) => { const r = el.getBoundingClientRect(); return r.top + r.height / 2; };
    const btns = [...bar.querySelectorAll(':scope > button')]
      .filter((b) => !b.classList.contains('select-trigger'));
    return {
      classes: [...sel.classList],
      margin: getComputedStyle(sel).margin,
      selCy: mid(sel),
      btnCys: btns.slice(0, 5).map(mid),
      barH: bar.getBoundingClientRect().height,
    };
  });
  console.log('  select:', JSON.stringify({ classes: m.classes, margin: m.margin }));

  // Variant names must never reach the DOM bare — that is the collision.
  const bare = m.classes.filter((c) => ['toolbar', 'input', 'chrome'].includes(c));
  ok(bare.length === 0, `no bare variant class on the trigger (got ${JSON.stringify(bare)})`);
  ok(m.margin === '0px', `trigger has no inherited margin (got ${m.margin})`);

  const drift = Math.max(...m.btnCys.map((c) => Math.abs(c - m.selCy)));
  ok(drift <= 1, `block-type picker shares the row's centre line (drift ${drift.toFixed(1)}px)`);
}

// Same guard for every other Select in the app.
await page.goto(`${BASE}/entries`, { waitUntil: 'networkidle' });
await page.waitForTimeout(1200);
const leaks = await page.evaluate(() =>
  [...document.querySelectorAll('.select-trigger')]
    .map((el) => [...el.classList].filter((c) => ['toolbar', 'input', 'chrome'].includes(c)))
    .flat());
ok(leaks.length === 0, `no bare variant classes on the entries list (got ${JSON.stringify(leaks)})`);

await browser.close();
console.log(fail.length ? `\n${fail.length} FAILED` : '\nall richtext-toolbar checks passed');
process.exit(fail.length ? 1 : 0);
