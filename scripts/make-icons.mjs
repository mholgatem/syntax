// Render the PWA icons in public/icons/ from public/favicon.svg (run once after changing the logo).
// Uses the locally installed Chrome via playwright-core:  node scripts/make-icons.mjs
import { chromium } from 'playwright-core';
import { mkdirSync, readFileSync } from 'node:fs';

const svg = readFileSync('public/favicon.svg', 'utf8');
const CHROME = process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
mkdirSync('public/icons', { recursive: true });
const browser = await chromium.launch({ executablePath: CHROME, headless: true });

async function render(file, size, maskable) {
  const page = await browser.newPage({ viewport: { width: size, height: size } });
  // Maskable icons need the logo inside the central 80% "safe zone" on a full-bleed background.
  const inner = maskable
    ? `<div style="width:100%;height:100%;background:#1e6fd9;display:grid;place-items:center">
         <div style="width:72%;height:72%">${svg.replace('<rect width="32" height="32" rx="7" fill="#1e6fd9"/>', '')}</div></div>`
    : svg;
  await page.setContent(
    `<html><body style="margin:0;background:transparent"><div style="width:${size}px;height:${size}px">${inner}</div>
     <style>svg{width:100%;height:100%;display:block}</style></body></html>`,
  );
  await page.screenshot({ path: `public/icons/${file}`, omitBackground: true });
  await page.close();
}

await render('icon-192.png', 192, false);
await render('icon-512.png', 512, false);
await render('icon-maskable-512.png', 512, true);
await browser.close();
console.log('Wrote public/icons/icon-192.png, icon-512.png, icon-maskable-512.png');
