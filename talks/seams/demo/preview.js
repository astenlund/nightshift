'use strict';
// Renders frames of a demo page with headless Chromium. Run from the repository root:
//   node talks/seams/demo/preview.js <page.html> <seconds>...
// Each time is measured from page load; frames land in .tmp/demo-frames. The pages are Artifact page bodies, so this
// wraps them in the document skeleton the Artifact publisher adds. Google Fonts are fetched through curl so a TLS proxy
// that Chromium does not trust still yields the real faces. Needs Playwright (npm i -g playwright, then NODE_PATH).
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { chromium } = require('playwright');

const [page, ...times] = process.argv.slice(2);
if (!page || times.length === 0) {
  console.error('Usage: node talks/seams/demo/preview.js <page.html> <seconds>...');
  process.exit(2);
}
const out = path.resolve('.tmp/demo-frames');
fs.mkdirSync(out, { recursive: true });
const source = fs.readFileSync(page, 'utf8');
const wrapped = path.join(out, '_page.html');
fs.writeFileSync(wrapped, `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${source.replace('<div class="app">', '</head><body><div class="app">')}</body></html>`);

(async () => {
  const browser = await chromium.launch();
  const tab = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const errors = [];
  tab.on('pageerror', error => errors.push(error.message));
  tab.on('console', message => message.type() === 'error' && errors.push(message.text()));
  await tab.route(/fonts\.(googleapis|gstatic)\.com/, route => {
    const url = route.request().url();
    const body = execFileSync('curl', ['-sS', '-A', 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/140 Safari/537.36', url]);
    route.fulfill({ status: 200, body, headers: { 'content-type': url.includes('googleapis') ? 'text/css' : 'font/woff2', 'access-control-allow-origin': '*' } });
  });
  const start = Date.now();
  await tab.goto('file://' + wrapped);
  for (const seconds of times.map(Number)) {
    const wait = seconds * 1000 - (Date.now() - start);
    if (wait > 0) await tab.waitForTimeout(wait);
    const file = path.join(out, `${path.basename(page, '.html')}-${String(seconds).replace('.', '_')}s.png`);
    await tab.screenshot({ path: file });
    console.log(file);
  }
  if (errors.length) console.error('Page errors:', errors);
  await browser.close();
})();
