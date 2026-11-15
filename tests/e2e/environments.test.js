// The same app files behave as the LIVE app on the workers' address and as the
// TEST app anywhere else. The live hostname is simulated inside the browser
// (requests are answered locally; nothing goes to the internet).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const APP_DIR = path.join(__dirname, '..', '..', 'app');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.webmanifest': 'application/manifest+json' };

async function openAs(browser, origin) {
  const context = await browser.newContext({ serviceWorkers: 'block' });
  await context.route(`${origin}/**`, (route) => {
    const p = new URL(route.request().url()).pathname;
    const file = path.join(APP_DIR, p === '/' ? 'index.html' : p);
    if (!file.startsWith(APP_DIR) || !fs.existsSync(file)) return route.fulfill({ status: 404, body: 'not found' });
    return route.fulfill({ status: 200, contentType: TYPES[path.extname(file)] || 'application/octet-stream', body: fs.readFileSync(file) });
  });
  const page = await context.newPage();
  await page.goto(`${origin}/#/login`);
  await page.waitForSelector('#login');
  return { context, page };
}

test('live address uses the live server with no TEST bar; any other address is clearly TEST', async () => {
  const config = fs.readFileSync(path.join(APP_DIR, 'js', 'config.js'), 'utf8');
  const liveUrl = /LIVE_API_URL = '([^']+)'/.exec(config)[1];
  const browser = await chromium.launch();
  try {
    const live = await openAs(browser, 'https://peppy-pie-7f7463.netlify.app');
    assert.equal(await live.page.inputValue('#apiUrl'), liveUrl, 'workers get the live server pre-filled');
    assert.equal(await live.page.$('#envBanner'), null, 'no TEST bar on the live app');
    await live.context.close();

    const branch = await openAs(browser, 'https://claude-gallant-davinci-z71yj9--peppy-pie-7f7463.netlify.app');
    assert.notEqual(await branch.page.inputValue('#apiUrl'), liveUrl, 'test app never defaults to the live server');
    assert.match(await branch.page.textContent('#envBanner'), /TEST VERSION/);
    await branch.context.close();
  } finally {
    await browser.close();
  }
});
