import { login, BASE } from './lib.mjs';
import { stubCodeSync } from './stub.mjs';
const { browser, page } = await login({ width: 1600, height: 950 });
await stubCodeSync(page);
await page.goto(`${BASE}/entries`, { waitUntil: 'networkidle' });
const href = await page.locator('table.list a[href^="/entries/"]').first().getAttribute('href');
await page.goto(`${BASE}${href}`, { waitUntil: 'networkidle' });
await page.waitForTimeout(3500);

const m = await page.evaluate(() => {
  const sw = document.querySelector('.device-switch');
  const btn = document.querySelector('.preview-toolbar .pt-actions .btn');
  const first = sw.querySelector('button');
  const icon = first.querySelector('i');
  const r = (el) => { const b = el.getBoundingClientRect(); return { w: +b.width.toFixed(1), h: +b.height.toFixed(1) }; };
  return {
    group: r(sw),
    segBtn: r(first),
    segPad: getComputedStyle(first).padding,
    iconBox: r(icon),
    iconFontSize: getComputedStyle(icon).fontSize,
    neighbourBtn: r(btn),
    neighbourPad: getComputedStyle(btn).padding,
  };
});
console.log(JSON.stringify(m, null, 1));
await page.screenshot({ path: 'metrics-toolbar.png', clip: { x: 1090, y: 118, width: 510, height: 64 } });
await browser.close();
