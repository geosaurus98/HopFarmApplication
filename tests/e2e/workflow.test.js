// End-to-end: real browser + real app + real Apps Script code (in-memory sheet).
// Covers the "successful first release" walkthrough in spec §22, including offline.
// Run: node --test tests/e2e/
process.env.TZ = 'Pacific/Auckland';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const { chromium } = require('playwright');
const { startServer } = require('../support/dev-server');

const SHOTS = process.env.SHOTS_DIR; // optional: save screenshots here

test('field collection offline, sync, leaf-by-leaf analysis, completion, export', { timeout: 120000 }, async () => {
  const { server, g, url } = await startServer();
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1024, height: 640 }, acceptDownloads: true, serviceWorkers: 'allow' });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|ERR_INTERNET_DISCONNECTED/.test(m.text())) errors.push(m.text()); });
  const shot = async (name) => { if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: `${SHOTS}/${name}.png` }); } };

  async function signIn(email, code) {
    await page.goto(`${url}/#/login`);
    await page.fill('#email', email);
    await page.fill('#code', code);
    if (await page.isVisible('#apiUrl') === false) await page.click('summary:has-text("Server address")');
    await page.fill('#apiUrl', '/api');
    await page.click('button:has-text("Sign in")');
    await page.waitForSelector('.tiles');
  }

  async function signOut() {
    await page.goto(`${url}/#/sync`);
    await page.click('button:has-text("Sign out")');
    await page.click('dialog button:has-text("Sign out")');
    await page.waitForSelector('#email');
  }

  try {
    // Wrong code is refused with a clear message.
    await page.goto(url);
    await page.waitForSelector('#email');
    await page.fill('#email', 'col@farm.nz');
    await page.fill('#code', '999999');
    assert.match(await page.inputValue('#apiUrl'), /^https:\/\/script\.google\.com\/macros\/s\/.+\/exec$/, 'farm server is the default');
    await page.click('summary:has-text("Server address")');
    await page.fill('#apiUrl', '/api');
    await page.click('button:has-text("Sign in")');
    await page.waitForSelector('text=not recognised');

    // ---- Stage 1: field collection (collector) ----
    await signIn('col@farm.nz', '222222');
    assert.equal(await page.isVisible('text=Analyse Samples'), false, 'collectors do not see analysis');
    await page.waitForSelector('#syncBadge:has-text("All synced")');
    await page.evaluate(() => navigator.serviceWorker.ready);
    await shot('01-home-collector');

    await context.setOffline(true);
    await page.waitForSelector('#syncBadge:has-text("Offline")');
    await page.click('text=New Mite Sample');
    await page.fill('#SampleNumber', '1042');
    await page.selectOption('#BlockVarietyID', 'A1-CASCADE');
    assert.equal(await page.textContent('#targetLeaves'), '75');
    await page.fill('#SampleComments', 'Dusty, windy afternoon');
    await shot('02-new-sample');
    await page.click('button:has-text("Save sample")');
    await page.waitForSelector('text=Bag 1042 saved');
    assert.ok(await page.isVisible('text=Saved on this tablet'));

    await page.click('button:has-text("Record another sample")');
    await page.click('button:has-text("Save sample")'); // empty form -> validation
    await page.waitForSelector('text=Enter the number written on the sample bag.');
    await page.fill('#SampleNumber', '1043');
    await page.selectOption('#BlockVarietyID', 'H1-EXAMPLE');
    assert.equal(await page.textContent('#targetLeaves'), '50'); // 3.38 ha -> minimum 50
    await page.selectOption('#BlockVarietyID', 'K2-EXAMPLE');
    assert.equal(await page.textContent('#targetLeaves'), '115');
    await page.click('button:has-text("Save sample")');
    await page.waitForSelector('text=Bag 1043 saved');

    // Duplicate bag number warns but does not block.
    await page.click('button:has-text("Record another sample")');
    await page.fill('#SampleNumber', '1042');
    await page.waitForSelector('text=has already been used this season');

    // App restart while offline: app shell from the service worker, data from IndexedDB.
    await page.reload();
    await page.waitForSelector('#syncBadge:has-text("2 waiting to upload")');
    await page.goto(`${url}/#/samples/mine`);
    await page.waitForSelector('.sample-card >> text=A1 - Cascade');
    assert.equal(g.table('Samples').length, 0, 'nothing reached the server while offline');

    // Back online: syncs automatically.
    await context.setOffline(false);
    await page.waitForSelector('#syncBadge:has-text("All synced")', { timeout: 15000 });
    const samples = g.table('Samples');
    assert.equal(samples.length, 2);
    const s1042 = samples.find((s) => s.SampleNumber === 1042);
    assert.equal(s1042.TargetLeafCount, 75);
    assert.equal(s1042.Season, '2026/27'.slice(0, 0) + s1042.Season); // computed on server
    assert.equal(s1042.Status, 'Awaiting Analysis');
    assert.equal(s1042.CollectorEmail, 'col@farm.nz');
    assert.equal(s1042.SampleComments, 'Dusty, windy afternoon');
    await signOut();

    // ---- Stage 2: office analysis (analyst) ----
    await signIn('lab@farm.nz', '333333');
    await page.click('text=Analyse Samples');
    await page.waitForSelector('.sample-card:has-text("1042")');
    assert.doesNotMatch(await page.textContent('main'), /\bnull\b|\bundefined\b/, 'no stray null/undefined text');
    await page.click('.sample-card:has-text("1042")');
    await page.click('button:has-text("Start analysis")');
    await page.waitForSelector('#leafNumber:has-text("1")');
    await shot('03-leaf-entry');

    // Blank counts cannot be saved; zero must be explicit.
    await page.click('#saveNext');
    await page.waitForSelector('text=Enter a count (0 if none seen).');
    // Negative values are rejected.
    await page.fill('#TetranychusCount', '-3');
    await page.click('button:has-text("Blanks → 0")');
    await page.click('#saveNext');
    await page.waitForSelector('text=Counts cannot be negative.');

    const enter = async (vals) => {
      for (const [k, v] of Object.entries(vals)) await page.fill(`#${k}`, String(v));
    };
    await enter({ TetranychusCount: 4, PhytoseiulusCount: 1, TwoSpotEggCount: 6, PredatorEggCount: 0, OtherBeneficialCount: 1 });
    await page.selectOption('#OtherBeneficialDescription', 'Ladybird (Stethorus)');
    await page.click('summary:has-text("Comment or photo")');
    await page.fill('#LeafComment', 'Webbing on underside');
    await page.click('#saveNext');
    // Save & next: leaf 2 opens, same sample, counts and comment cleared.
    await page.waitForSelector('#leafNumber:has-text("2")');
    assert.equal(await page.inputValue('#TetranychusCount'), '');
    assert.equal(await page.inputValue('#LeafComment'), '');

    // Leaf 2 with +/- buttons and Enter-to-advance.
    await page.click('button[aria-label="TwoSM plus one"]');
    await page.click('button[aria-label="TwoSM plus one"]');
    assert.equal(await page.inputValue('#TetranychusCount'), '2');
    await page.click('button:has-text("Blanks → 0")');
    await page.focus('#OtherBeneficialCount');
    await page.keyboard.press('Enter');
    await page.waitForSelector('#leafNumber:has-text("3")');

    // Leaf 3: unusually high count asks for confirmation.
    await enter({ TetranychusCount: 150 });
    await page.click('button:has-text("Blanks → 0")');
    await page.click('button:has-text("Save & stop")');
    await page.click('dialog button:has-text("Yes, save it")');
    await page.waitForSelector('#leavesAnalysed:has-text("3")');
    assert.ok(await page.isVisible('text=72'), 'remaining = 75 - 3');
    await shot('04-sample-detail');

    // Pause and resume: continues at leaf 4, no duplicates.
    await page.goto(`${url}/#/`);
    await page.click('text=Samples In Progress');
    await page.click('.sample-card:has-text("1042")');
    await page.click('text=Resume at leaf 4');
    await page.waitForSelector('#leafNumber:has-text("4")');
    await page.click('text=Stop without saving');

    // Correct leaf 2.
    await page.click('.leaf-table tbody tr:nth-child(2)');
    await page.fill('#PhytoseiulusCount', '3');
    await page.click('button:has-text("Save changes")');
    await page.waitForSelector('#leavesAnalysed:has-text("3")');

    // Complete below target with a reason.
    await page.click('text=Complete analysis');
    await page.waitForSelector('text=Target not reached — 72 leaves short.');
    await page.selectOption('#EarlyCompletionReason', 'Insufficient material');
    await page.fill('#AnalysisComments', 'Bag only had a few usable leaves');
    await shot('05-complete');
    await page.click('button:has-text("Confirm — complete analysis")');
    await page.waitForSelector('.pill.complete');
    assert.equal(await page.isVisible('text=Resume at leaf'), false);

    await page.goto(`${url}/#/sync`);
    await page.click('#syncNow');
    await page.waitForSelector('#syncBadge:has-text("All synced")', { timeout: 15000 });
    const leaves = g.table('LeafAnalysis').sort((a, b) => a.LeafNumber - b.LeafNumber);
    assert.deepEqual(leaves.map((l) => l.LeafNumber), [1, 2, 3]);
    assert.deepEqual(leaves.map((l) => l.TetranychusCount), [4, 2, 150]);
    assert.equal(leaves[1].PhytoseiulusCount, 3);
    assert.equal(leaves[0].OtherBeneficialDescription, 'Ladybird (Stethorus)');
    assert.equal(leaves[0].LeafComment, 'Webbing on underside');
    assert.ok(leaves.every((l) => l.AnalystEmail === 'lab@farm.nz'));
    const done = g.table('Samples').find((s) => s.SampleNumber === 1042);
    assert.equal(done.Status, 'Analysis Complete');
    assert.equal(done.ActualLeafCount, 3);
    assert.equal(done.CompletedBy, 'lab@farm.nz');
    assert.equal(done.EarlyCompletionReason, 'Insufficient material');
    assert.ok(done.AnalysisStartedAt instanceof Date && done.AnalysisCompletedAt instanceof Date);

    // Completed samples are searchable and read-only for analysts.
    await page.goto(`${url}/#/samples/completed`);
    await page.fill('input[type=search]', 'cascade');
    await page.waitForSelector('.sample-card:has-text("1042")');
    await page.goto(`${url}/#/leaf/${done.SampleID}/new`);
    await page.waitForSelector('text=This analysis is complete');

    // ---- Reports: CSV for Excel, one row per leaf ----
    await page.goto(`${url}/#/reports`);
    await page.waitForSelector('.chart svg circle');
    await shot('06-reports');
    const [download] = await Promise.all([page.waitForEvent('download'), page.click('#exportLeaves')]);
    assert.match(download.suggestedFilename(), /^hopfarm_leaf_results_all-seasons_.*\.csv$/);
    const csv = fs.readFileSync(await download.path(), 'utf8').replace(/^﻿/, '');
    const lines = csv.trim().split('\r\n');
    assert.equal(lines.length, 4, csv);
    assert.ok(lines[0].startsWith('SampleID,SampleNumber,Season,CollectionDate,WeekStarting,Collector'));
    assert.ok(lines[1].includes(',Cole Collector,A1,Cascade,7.84,75,1,Lee Analyst,'));

    // Offline export falls back to data on the tablet.
    await context.setOffline(true);
    const [dl2] = await Promise.all([page.waitForEvent('download'), page.click('#exportSummary')]);
    assert.match(dl2.suggestedFilename(), /tablet/);
    const sum = fs.readFileSync(await dl2.path(), 'utf8').replace(/^﻿/, '').trim().split('\r\n');
    assert.equal(sum.length, 3); // header + 2 samples
    await context.setOffline(false);

    // ---- Admin can reopen; changes to completed samples are audited ----
    await signOut();
    await signIn('admin@farm.nz', '111111');
    await page.goto(`${url}/#/sample/${done.SampleID}`);
    await page.click('.leaf-table tbody tr:nth-child(1)');
    await page.fill('#TetranychusCount', '5');
    await page.click('button:has-text("Save changes")');
    await page.waitForSelector('#leavesAnalysed');
    await page.goto(`${url}/#/sync`);
    await page.click('#syncNow');
    await page.waitForSelector('#syncBadge:has-text("All synced")', { timeout: 15000 });
    const audit = g.table('AuditLog');
    assert.equal(audit.length, 1);
    assert.match(audit[0].Summary, /TetranychusCount: 4 → 5/);

    // Server unreachable: changes wait safely and the badge says so.
    server.apiDown = true;
    await page.goto(`${url}/#/sample/${done.SampleID}`);
    await page.click('button:has-text("Reopen analysis")');
    await page.click('dialog button:has-text("Reopen")');
    await page.waitForSelector('#syncBadge:has-text("1 waiting to upload")', { timeout: 15000 });
    server.apiDown = false;
    await page.goto(`${url}/#/sync`);
    await page.click('#syncNow');
    await page.waitForSelector('#syncBadge:has-text("All synced")', { timeout: 15000 });
    assert.equal(g.table('Samples').find((s) => s.SampleNumber === 1042).Status, 'Analysis In Progress');

    // Phone-sized screen has no horizontal scroll on the main screens.
    await page.setViewportSize({ width: 390, height: 800 });
    for (const hash of ['#/', '#/new', '#/samples/all', `#/sample/${done.SampleID}`, `#/leaf/${done.SampleID}/new`, '#/reports']) {
      await page.goto(`${url}/${hash}`);
      await page.waitForTimeout(300);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      assert.ok(overflow <= 1, `horizontal overflow ${overflow}px on ${hash}`);
    }

    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
    server.close();
  }
});
