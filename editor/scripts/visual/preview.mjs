import { login, BASE } from './lib.mjs';
import { stubCodeSync } from './stub.mjs';

const { browser, page } = await login({ width: 1600, height: 950 });
const fail = [];
const ok = (c, m) => { console.log(`  ${c ? 'ok  ' : 'FAIL'} ${m}`); if (!c) fail.push(m); };
await stubCodeSync(page);

await page.goto(`${BASE}/entries`, { waitUntil: 'networkidle' });
const href = await page.locator('table.list a[href^="/entries/"]').first().getAttribute('href');
const entryId = href.split('/').pop();

// ---- device switching actually resizes the frame --------------------------
await page.goto(`${BASE}${href}`, { waitUntil: 'networkidle' });
await page.waitForTimeout(3500);
const sizes = {};
for (const [i, name] of [[0,'fit'],[1,'desktop'],[3,'tablet'],[4,'mobile']]) {
  await page.locator('.device-switch button').nth(i).click();
  await page.waitForTimeout(600);
  sizes[name] = await page.evaluate(() => {
    const f = document.querySelector('.preview-frame');
    const vp = document.querySelector('.preview-viewport');
    return {
      cssWidth: Math.round(f.getBoundingClientRect().width),
      declared: vp ? Math.round(parseFloat(getComputedStyle(vp).width)) : null,
    };
  });
}
console.log('  sizes:', JSON.stringify(sizes));
ok(sizes.mobile.declared === 390, `mobile renders the site at 390 CSS px (got ${sizes.mobile.declared})`);
ok(sizes.tablet.declared === 834, `tablet renders at 834 (got ${sizes.tablet.declared})`);
ok(sizes.desktop.declared === 1440, `desktop renders at 1440 (got ${sizes.desktop.declared})`);
ok(sizes.fit.declared === null, 'fit mode uses no fixed viewport');
await page.locator('.device-switch button').nth(4).click();
await page.waitForTimeout(700);
await page.screenshot({ path: 'v7-mobile.png', clip: { x: 640, y: 0, width: 960, height: 900 } });

// ---- /preview: no dead space under the frame ------------------------------
await page.goto(`${BASE}/preview?entry=${entryId}`, { waitUntil: 'networkidle' });
await page.waitForTimeout(3000);
await page.locator('.device-switch button').nth(0).click();   // fit to pane
await page.waitForTimeout(700);
const gap = await page.evaluate(() => {
  const f = document.querySelector('.preview-frame');
  if (!f) return null;
  const r = f.getBoundingClientRect();
  return {
    frameBottom: Math.round(r.bottom),
    viewportH: window.innerHeight,
    gap: Math.round(window.innerHeight - r.bottom),
    pageScrolls: document.documentElement.scrollHeight > window.innerHeight + 2,
  };
});
console.log('  /preview fit:', JSON.stringify(gap));
ok(gap && gap.gap <= 16, `no dead space under the frame (gap ${gap?.gap}px)`);
ok(gap && !gap.pageScrolls, 'the preview page itself does not scroll');
await page.screenshot({ path: 'v8-preview.png' });

await browser.close();
console.log(fail.length ? `\n${fail.length} FAILED` : '\nall preview checks passed');
process.exit(fail.length ? 1 : 0);
