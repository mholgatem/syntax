// Render the browser-tab favicons in public/icons/ from public/icons/icon-512.png (the app
// icon, which is drawn by hand). Run after changing the icon:  node scripts/make-icons.mjs
// Uses the locally installed Chrome via playwright-core. Halves the image step by step so
// the small sizes stay crisp.
import { chromium } from 'playwright-core';
import { readFileSync, writeFileSync } from 'node:fs';

const SIZES = [16, 32, 48];
const src = `data:image/png;base64,${readFileSync('public/icons/icon-512.png').toString('base64')}`;
const CHROME = process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const page = await browser.newPage();

const pngs = await page.evaluate(
  async ({ src, sizes }) => {
    const img = new Image();
    img.src = src;
    await img.decode();
    const draw = (source, size) => {
      const c = document.createElement('canvas');
      c.width = c.height = size;
      const ctx = c.getContext('2d');
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(source, 0, 0, size, size);
      return c;
    };
    const out = {};
    for (const size of sizes) {
      let source = img;
      let w = img.naturalWidth;
      while (w / 2 >= size) {
        w = Math.round(w / 2);
        source = draw(source, w);
      }
      out[size] = draw(source, size).toDataURL('image/png').split(',')[1];
    }
    return out;
  },
  { src, sizes: SIZES },
);

for (const size of SIZES) writeFileSync(`public/icons/favicon-${size}.png`, Buffer.from(pngs[size], 'base64'));
await browser.close();
console.log(`Wrote ${SIZES.map((s) => `public/icons/favicon-${s}.png`).join(', ')}`);
