import { chromium } from 'playwright-core';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const EXE = join(
  homedir(),
  'Library/Caches/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-mac-arm64/chrome-headless-shell',
);
export const BASE = 'http://localhost:3000';

export async function login(viewport = { width: 1440, height: 900 }) {
  const browser = await chromium.launch({ executablePath: EXE });
  const page = await browser.newPage({ viewport });
  page.on('console', (m) => { if (m.type() === 'error') console.log('  [console]', m.text().slice(0, 160)); });
  page.on('response', (r) => {
    if (r.url().includes('/auth/login')) console.log('  [login]', r.status());
  });

  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('form input', { timeout: 20000 });
  const inputs = page.locator('form input');
  await inputs.nth(0).fill('admin@example.com');
  await inputs.nth(1).fill('admin123');
  await page.locator('form button[type=submit], form button:not([type])').first().click();

  try {
    await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 25000 });
  } catch {
    await page.screenshot({ path: 'debug-login.png', fullPage: true });
    const err = await page.locator('.error-text').first().textContent().catch(() => null);
    throw new Error(`login did not navigate. error-text=${JSON.stringify(err)}`);
  }
  await page.waitForTimeout(2500);
  return { browser, page };
}
