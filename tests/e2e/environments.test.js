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

    const branch = await openAs(browser, 'https://develop--peppy-pie-7f7463.netlify.app');
    assert.notEqual(await branch.page.inputValue('#apiUrl'), liveUrl, 'test app never defaults to the live server');
    const testUrl = /TEST_API_URL = '([^']*)'/.exec(config)[1];
    assert.ok(testUrl && testUrl !== liveUrl, 'a separate test server is configured');
    assert.equal(await branch.page.inputValue('#apiUrl'), testUrl, 'test app defaults to the test server');
    assert.match(await branch.page.textContent('#envBanner'), /TEST VERSION/);
    await branch.context.close();
  } finally {
    await browser.close();
  }
});

test('a tablet set up with a replaced server address is not stuck', async () => {
  const config = fs.readFileSync(path.join(APP_DIR, 'js', 'config.js'), 'utf8');
  const testUrl = /TEST_API_URL = '([^']*)'/.exec(config)[1];
  const oldUrl = /PREVIOUS_API_URLS = \[\s*'([^']+)'/.exec(config)[1];
  const browser = await chromium.launch();
  try {
    const { context, page } = await openAs(browser, 'https://develop--peppy-pie-7f7463.netlify.app');
    const setDevice = (url) => page.evaluate(async (u) => {
      const db = await import('./js/db.js');
      await db.setMeta('device', { id: 'dev-1', token: 't', apiUrl: u, environment: 'TEST' });
      await db.setMeta('lastLogin', { apiUrl: u, login: 'ana' });
    }, url);

    // Set up with the old address: moved to the current server on start.
    await setDevice(oldUrl);
    await page.goto('https://develop--peppy-pie-7f7463.netlify.app/#/login/code');
    await page.waitForSelector('#login');
    assert.equal(await page.isEnabled('#apiUrl'), true, 'old tablet setup forgotten');
    assert.equal(await page.inputValue('#apiUrl'), testUrl);

    // Set up with another address: the admin can choose to set the tablet up again.
    await setDevice('https://example.invalid/exec');
    await page.reload();
    await page.goto('https://develop--peppy-pie-7f7463.netlify.app/#/login/code');
    await page.waitForSelector('#login');
    assert.equal(await page.isEnabled('#apiUrl'), false);
    await page.click('summary:has-text("Server address")');
    await page.click('#resetTablet');
    await page.click('dialog button:has-text("Set up again")');
    await page.waitForSelector('#apiUrl:enabled');
    assert.equal(await page.inputValue('#apiUrl'), testUrl, 'current server filled in');
    assert.ok(await page.isVisible('#sharedTablet'), 'can set the tablet up again');
    await context.close();
  } finally {
    await browser.close();
  }
});
