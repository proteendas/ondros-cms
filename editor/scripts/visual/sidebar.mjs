import { login } from './lib.mjs';
const { browser, page } = await login();
const fail = [];
const ok = (c, m) => { console.log(`  ${c ? 'ok  ' : 'FAIL'} ${m}`); if (!c) fail.push(m); };

// ---- 1. collapsed rail: icons centred -------------------------------------
await page.mouse.move(1300, 700);
await page.waitForTimeout(700);
const rail = await page.evaluate(() => {
  const nav = document.querySelector('#app-sidebar');
  const b = nav.getBoundingClientRect();
  const ic = [...nav.querySelectorAll('.nav-item .nav-icon')].map((el) => {
    const r = el.getBoundingClientRect();
    return Math.round(r.left + r.width / 2);
  });
  return { w: Math.round(b.width), centre: Math.round(b.left + b.width / 2), iconCentres: [...new Set(ic)] };
});
console.log('  rail:', JSON.stringify(rail));
ok(rail.w === 60, 'rail is collapsed to 60px');
ok(rail.iconCentres.length === 1 && Math.abs(rail.iconCentres[0] - rail.centre) <= 1,
   `icons centred (icon ${rail.iconCentres} vs rail centre ${rail.centre})`);
await page.screenshot({ path: 'v1-rail.png', clip: { x: 0, y: 0, width: 300, height: 860 } });

// ---- 2. hover expands, toggle reads as a sidebar control -------------------
await page.hover('#app-sidebar');
await page.waitForTimeout(700);
const hov = await page.evaluate(() => {
  const nav = document.querySelector('#app-sidebar');
  const pin = nav.querySelector('.nav-pin');
  return {
    w: Math.round(nav.getBoundingClientRect().width),
    label: pin.textContent.trim(),
    icon: pin.querySelector('i')?.className,
  };
});
console.log('  hovered:', JSON.stringify(hov));
ok(hov.w === 232, 'hover expands to 232px');
ok(/Keep expanded|Collapse menu/.test(hov.label), `toggle label is "${hov.label}"`);
ok(/arrows-(expand|collapse)-vertical/.test(hov.icon ?? ''), `toggle icon is ${hov.icon}`);
await page.screenshot({ path: 'v2-hover.png', clip: { x: 0, y: 0, width: 420, height: 860 } });

// ---- 3. pin keeps it open and shifts content ------------------------------
const beforeX = await page.evaluate(() => Math.round(document.querySelector('main.content').getBoundingClientRect().left));
await page.click('.nav-pin');
await page.waitForTimeout(600);
await page.mouse.move(1300, 700);
await page.waitForTimeout(700);
const pinned = await page.evaluate(() => ({
  w: Math.round(document.querySelector('#app-sidebar').getBoundingClientRect().width),
  contentX: Math.round(document.querySelector('main.content').getBoundingClientRect().left),
}));
console.log('  pinned:', JSON.stringify(pinned), 'content was at', beforeX);
ok(pinned.w === 232, 'stays expanded when pinned and pointer leaves');
ok(pinned.contentX > beforeX, 'pinned pushes content instead of overlaying');
await page.screenshot({ path: 'v3-pinned.png', clip: { x: 0, y: 0, width: 520, height: 860 } });

// unpin for the remaining checks
await page.hover('#app-sidebar');
await page.waitForTimeout(400);
await page.click('.nav-pin');
await page.mouse.move(1300, 700);
await page.waitForTimeout(600);

await browser.close();
console.log(fail.length ? `\n${fail.length} FAILED` : '\nall sidebar checks passed');
process.exit(fail.length ? 1 : 0);
