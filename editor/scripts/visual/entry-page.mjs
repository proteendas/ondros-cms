import { login, BASE } from './lib.mjs';
import { stubCodeSync } from './stub.mjs';

const { browser, page } = await login({ width: 1600, height: 600 });
const fail = [];
const ok = (c, m) => { console.log(`  ${c ? 'ok  ' : 'FAIL'} ${m}`); if (!c) fail.push(m); };

await stubCodeSync(page);

await page.goto(`${BASE}/entries`, { waitUntil: 'networkidle' });
await page.waitForSelector('table.list a[href^="/entries/"]', { timeout: 20000 });
const href = await page.locator('table.list a[href^="/entries/"]').first().getAttribute('href');
console.log('  entry:', href);

await page.goto(`${BASE}${href}`, { waitUntil: 'networkidle' });
await page.waitForTimeout(4000);

const bar = await page.evaluate(() => {
  const tb = document.querySelector('.preview-toolbar');
  if (!tb) return null;
  const sw = tb.querySelector('.device-switch');
  const rects = [...tb.children].map((c) => {
    const r = c.getBoundingClientRect();
    return { cls: c.className.split(' ')[0], mid: r.top + r.height / 2 };
  });
  return { hasSwitch: !!sw, buttons: sw ? sw.querySelectorAll('button').length : 0, rects };
});
console.log('  toolbar:', JSON.stringify(bar?.rects?.map(r => r.cls)));
ok(bar?.hasSwitch, 'device switcher renders in the pane');
ok(bar?.buttons === 5, `five viewport buttons (got ${bar?.buttons})`);
const mids = (bar?.rects ?? []).map((r) => r.mid);
const spread = mids.length ? Math.max(...mids) - Math.min(...mids) : 99;
ok(spread < 6, `toolbar items share a baseline (spread ${spread.toFixed(1)}px)`);
await page.screenshot({ path: 'v4-entry.png', clip: { x: 640, y: 0, width: 960, height: 460 } });

// Prove the page can actually scroll, or "still visible" means nothing.
const scrolled = await page.evaluate(() => {
  window.scrollTo(0, 2000);
  return { y: Math.round(window.scrollY), docH: document.documentElement.scrollHeight, vpH: window.innerHeight };
});
console.log('  scroll:', JSON.stringify(scrolled));
ok(scrolled.y > 200, `page actually scrolled (y=${scrolled.y})`);
await page.waitForTimeout(700);
const ai = await page.evaluate(() => {
  const b = [...document.querySelectorAll('.entry-topbar button')].find((x) => /AI assistant/.test(x.textContent));
  if (!b) return { found: false };
  const r = b.getBoundingClientRect();
  return { found: true, top: Math.round(r.top), inView: r.top >= 0 && r.bottom <= window.innerHeight };
});
console.log('  after scroll:', JSON.stringify(ai));
ok(ai.found && ai.inView, 'AI button stays visible after scrolling');
await page.screenshot({ path: 'v5-scrolled.png', clip: { x: 0, y: 0, width: 1600, height: 300 } });

await page.locator('.entry-topbar button', { hasText: 'AI assistant' }).click();
await page.waitForTimeout(900);
ok(await page.locator('.modal-backdrop').isVisible(), 'AI dialog opens');
await page.screenshot({ path: 'v6-ai.png' });
await page.keyboard.press('Escape');
await page.waitForTimeout(500);
ok((await page.locator('.modal-backdrop').count()) === 0, 'Escape closes the AI dialog');

await browser.close();
console.log(fail.length ? `\n${fail.length} FAILED` : '\nall entry-page checks passed');
process.exit(fail.length ? 1 : 0);
