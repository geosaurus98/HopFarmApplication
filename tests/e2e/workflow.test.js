// End-to-end: real browser + real app + real Apps Script code (in-memory sheets).
// The mite monitoring walkthrough (spec §22) on a shared tablet:
// an owner sets the tablet up, workers tap their name (no codes), collect offline,
// analyse leaf by leaf, complete; admins see reports and exports; owners manage people.
// Run: node --test tests/e2e/
process.env.TZ = 'Pacific/Auckland';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const { chromium } = require('playwright');
const { startServer } = require('../support/dev-server');

const SHOTS = process.env.SHOTS_DIR; // optional: save screenshots here

test('shared tablet: collect offline, analyse leaf by leaf, complete, admin reports, owner manages people', { timeout: 150000 }, async () => {
  const { server, g, url } = await startServer();
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1024, height: 640 }, acceptDownloads: true, serviceWorkers: 'allow' });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|ERR_INTERNET_DISCONNECTED/.test(m.text())) errors.push(m.text()); });
  const shot = async (name) => { if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: `${SHOTS}/${name}.png` }); } };

  /** Sign in with a code (admins/owners). */
  async function codeSignIn(login, code) {
    await page.goto(`${url}/#/login/code`);
    await page.waitForSelector('#login');
    await page.fill('#login', login);
    await page.fill('#code', code);
    if (await page.isEnabled('#apiUrl')) {
      if (!(await page.isVisible('#apiUrl'))) await page.click('summary:has-text("Server address")');
      await page.fill('#apiUrl', '/api');
    }
    await page.click('button:has-text("Sign in")');
    await page.waitForSelector('.tiles, form p.error:not(:empty)');
    const err = await page.$eval('form p.error', (e) => e.textContent).catch(() => '');
    if (err) throw new Error(`Sign-in as ${login} failed: ${err}`);
  }
  /** On the set-up tablet: change person, then tap a name. */
  async function pickName(name) {
    await page.goto(`${url}/#/switch`);
    await page.waitForSelector('#whoList');
    await page.click(`.who-btn:has-text("${name}")`);
    await page.waitForSelector('.tiles');
  }
  async function syncNow() {
    await page.goto(`${url}/#/sync`);
    await page.click('#syncNow');
    await page.waitForSelector('text=Sync complete.', { timeout: 15000 });
    await page.waitForSelector('#syncBadge:has-text("All synced")', { timeout: 15000 });
  }

  try {
    // ---- First use: an owner sets the tablet up ----
    await page.goto(url);
    await page.waitForSelector('#login');
    assert.equal(await page.inputValue('#apiUrl'), '', 'test app does not default to the live server');
    await page.fill('#login', 'ana');
    await page.fill('#code', '999999');
    await page.fill('#apiUrl', '/api');
    await page.click('button:has-text("Sign in")');
    await page.waitForSelector('text=not recognised');
    await page.fill('#code', '111111');
    await page.fill('#tabletName', 'Field tablet 1');
    await page.click('button:has-text("Sign in")');
    await page.waitForSelector('.tiles');
    assert.equal(g.table('Devices')[0].DeviceName, 'Field tablet 1');
    await page.evaluate(() => navigator.serviceWorker.ready);

    // ---- Workers tap their name: no password ----
    await page.goto(`${url}/#/switch`);
    await page.waitForSelector('#whoList');
    assert.deepEqual(await page.$$eval('.who-btn', (els) => els.map((e) => e.textContent)), ['Cole Collector', 'Lee Analyst']);
    await shot('01-who');
    await page.click('.who-btn:has-text("Cole Collector")');
    await page.waitForSelector('.tiles');
    assert.ok(await page.isVisible('text=Cole Collector · User'));
    assert.equal(await page.isVisible('text=Manage Users'), false, 'owners only');
    await page.waitForSelector('#syncBadge:has-text("All synced")');

    // Home: one button per section; Mite Monitoring page in the requested rows.
    await page.click('#goMites');
    await page.waitForSelector('text=New Mite Sample');
    const tiles = await page.$$eval('.tiles.two', (rows) => rows.map((r) => [...r.querySelectorAll('.tile-title')].map((t) => t.textContent)));
    assert.deepEqual(tiles, [['New Mite Sample', 'Analyse Samples'], ['Samples In Progress', 'My Completed Samples']], 'no reports for Users');

    // ---- Field collection, offline ----
    await context.setOffline(true);
    await page.waitForSelector('#syncBadge:has-text("Offline")');
    await page.click('text=New Mite Sample');
    await page.fill('#SampleNumber', '1042');
    await page.selectOption('#BlockVarietyID', 'A1-CASCADE');
    assert.equal(await page.textContent('#targetLeaves'), '75');
    await page.fill('#SampleComments', 'Dusty, windy afternoon');
    await page.click('#saveSample'); // "Continue"
    await page.waitForSelector('text=Bag 1042 saved');
    assert.equal(await page.textContent('#collectLeaves'), '75 leaves');
    assert.ok(await page.isVisible('text=Seal the bag.'));
    assert.ok(await page.isVisible('text=Make sure the bag is clearly labelled with'));
    await shot('02-bag-saved');

    await page.click('button:has-text("Record another sample")');
    await page.click('#saveSample'); // empty form -> validation
    await page.waitForSelector('text=Enter the number written on the sample bag.');
    await page.fill('#SampleNumber', '1043');
    await page.selectOption('#BlockVarietyID', 'H1-SOUTHERNCROSS');
    assert.equal(await page.textContent('#targetLeaves'), '50');
    await page.selectOption('#BlockVarietyID', 'K2-RIWAKA');
    assert.equal(await page.textContent('#targetLeaves'), '115');
    await page.click('#saveSample');
    await page.waitForSelector('text=Bag 1043 saved');
    await page.click('button:has-text("Record another sample")');
    await page.fill('#SampleNumber', '1042');
    await page.waitForSelector('text=has already been used this season');

    // App restart while offline: app from the service worker, data from IndexedDB, still Cole.
    await page.reload();
    await page.waitForSelector('#syncBadge:has-text("2 waiting to upload")');
    assert.ok(await page.isVisible('text=Cole Collector · User'));
    assert.equal(g.table('Samples').length, 0, 'nothing reached the server while offline');

    // Back online: uploads automatically, under Cole's name.
    await context.setOffline(false);
    await page.waitForSelector('#syncBadge:has-text("All synced")', { timeout: 15000 });
    const s1042 = g.table('Samples').find((s) => s.SampleNumber === 1042);
    assert.equal(g.table('Samples').length, 2);
    assert.equal(s1042.TargetLeafCount, 75);
    assert.equal(s1042.Status, 'Awaiting Analysis');
    assert.equal(s1042.CollectorEmail, 'col@farm.nz');
    assert.equal(s1042.SampleComments, 'Dusty, windy afternoon');

    // ---- Office analysis: Lee taps his name ----
    await pickName('Lee Analyst');
    await page.goto(`${url}/#/mites`);
    await page.click('text=Analyse Samples');
    await page.waitForSelector('.sample-card:has-text("1042")');
    await page.click('.sample-card:has-text("1042")');
    await page.click('button:has-text("Start analysis")');
    await page.waitForSelector('#leafNumber:has-text("1")');
    // Every count starts at 0; the comment box is always there; two buttons only.
    for (const id of ['TetranychusCount', 'TwoSpotEggCount', 'DeadTetranychusCount', 'EatenTwoSpotEggCount', 'PhytoseiulusCount', 'PredatorEggCount', 'LacewingCount']) {
      assert.equal(await page.inputValue(`#${id}`), '0', id);
    }
    assert.ok(await page.isVisible('#LeafComment'));
    assert.deepEqual(await page.$$eval('.sticky-actions button', (b) => b.map((x) => x.textContent.trim())), ['Sample finished', 'Next leaf  →'].map((x) => x.trim()));
    // The layout: 2SM | 2SM eggs, Dead 2SM | Eaten 2SM eggs, PP | PP eggs.
    assert.deepEqual(await page.$$eval('.count-grid:not(.beneficials) .counter label strong', (els) => els.map((e) => e.textContent)),
      ['2SM', '2SM eggs', 'Dead 2SM', 'Eaten 2SM eggs', 'PP', 'PP eggs']);
    // Help opens over the leaf screen without losing what's typed.
    await page.fill('#TetranychusCount', '4');
    await page.click('#leafHelp');
    await page.waitForSelector('dialog >> text=Eaten 2SM eggs');
    await page.click('dialog button:has-text("Close")');
    assert.equal(await page.inputValue('#TetranychusCount'), '4');
    await shot('03-leaf-entry');

    // Negative values are rejected.
    await page.fill('#PredatorEggCount', '-3');
    await page.click('#nextLeaf');
    await page.waitForSelector('text=Counts cannot be negative.');
    await page.fill('#PredatorEggCount', '0');
    await page.fill('#PhytoseiulusCount', '1');
    await page.fill('#TwoSpotEggCount', '6');
    await page.fill('#DeadTetranychusCount', '2');
    await page.fill('#EatenTwoSpotEggCount', '3');
    await page.fill('#LadybirdStethorusCount', '1');
    await page.fill('#BeneficialOtherCount', '1');
    await page.fill('#OtherBeneficialDescription', 'Hoverfly larva');
    await page.fill('#LeafComment', 'Webbing on underside');
    await page.click('#nextLeaf');
    await page.waitForSelector('#leafNumber:has-text("2")');
    assert.equal(await page.inputValue('#TetranychusCount'), '0');
    assert.equal(await page.inputValue('#LeafComment'), '');

    // Leaf 2 with +/- buttons and Enter-to-advance (Enter on the last box = Next leaf).
    await page.click('button[aria-label="2SM plus one"]');
    await page.click('button[aria-label="2SM plus one"]');
    assert.equal(await page.inputValue('#TetranychusCount'), '2');
    await page.fill('#PhytoseiulusCount', '1');
    await page.focus('#BeneficialOtherCount');
    await page.keyboard.press('Enter');
    await page.waitForSelector('#leafNumber:has-text("3")');

    // Leaf 3: high count; "Sample finished" asks to save what's typed.
    await page.fill('#TetranychusCount', '150');
    await page.click('#sampleFinished');
    await page.click('dialog button[data-choice="save"]');
    await page.click('dialog button:has-text("Yes, save it")');
    await page.waitForSelector('#leavesAnalysed:has-text("3")');
    assert.ok(await page.isVisible('text=72'), 'remaining = 75 - 3');
    assert.deepEqual(await page.$$eval('.hbar-label', (els) => els.map((e) => e.textContent)), ['PP', '2SM', 'PP eggs', '2SM eggs', 'Beneficials']);
    await shot('04-sample-detail');

    // Pause and resume: continues at leaf 4; an untouched leaf leaves without asking.
    await page.goto(`${url}/#/mites`);
    await page.click('text=Samples In Progress');
    await page.click('.sample-card:has-text("1042")');
    await page.click('text=Resume at leaf 4');
    await page.waitForSelector('#leafNumber:has-text("4")');
    await page.click('#sampleFinished');
    await page.waitForSelector('#leavesAnalysed:has-text("3")');

    // Correct leaf 2.
    await page.click('.leaf-table tbody tr:nth-child(2)');
    await page.fill('#PhytoseiulusCount', '3');
    await page.click('button:has-text("Save changes")');
    await page.waitForSelector('#leavesAnalysed:has-text("3")');

    // Complete below target: a reason is required; explanation and comments optional.
    await page.click('text=Complete analysis');
    await page.waitForSelector('text=Target not reached — 72 leaves short.');
    await page.click('button:has-text("Confirm — complete analysis")');
    await page.waitForSelector('text=Choose why fewer leaves were analysed.');
    await page.selectOption('#EarlyCompletionReason', 'Insufficient material');
    await page.click('button:has-text("Confirm — complete analysis")');
    await page.waitForSelector('.pill.complete');

    await syncNow();
    const leaves = g.table('LeafAnalysis').sort((a, b) => a.LeafNumber - b.LeafNumber);
    assert.deepEqual(leaves.map((l) => l.LeafNumber), [1, 2, 3]);
    assert.deepEqual(leaves.map((l) => l.TetranychusCount), [4, 2, 150]);
    assert.deepEqual([leaves[0].DeadTetranychusCount, leaves[0].EatenTwoSpotEggCount, leaves[0].LadybirdStethorusCount, leaves[0].BeneficialOtherCount], [2, 3, 1, 1]);
    assert.equal(leaves[0].OtherBeneficialCount, 2, 'beneficials total = sum of types');
    assert.equal(leaves[0].OtherBeneficialDescription, 'Hoverfly larva');
    assert.equal(leaves[0].LeafComment, 'Webbing on underside');
    assert.equal(leaves[1].PhytoseiulusCount, 3);
    assert.ok(leaves.every((l) => l.AnalystEmail === 'lab@farm.nz'));
    const done = g.table('Samples').find((s) => s.SampleNumber === 1042);
    assert.equal(done.Status, 'Analysis Complete');
    assert.equal(done.ActualLeafCount, 3);
    assert.equal(done.CompletedBy, 'lab@farm.nz');
    assert.equal(done.EarlyCompletionReason, 'Insufficient material');

    // Lee sees his own completed analyses and can reopen within 31 days; no reports.
    await page.goto(`${url}/#/samples/completed`);
    await page.waitForSelector('.sample-card:has-text("1042")');
    await page.click('.sample-card:has-text("1042")');
    await page.waitForSelector('button:has-text("Reopen analysis")');
    await page.goto(`${url}/#/leaf/${done.SampleID}/new`);
    await page.waitForSelector('text=Tap "Reopen analysis" to add more leaves');
    await page.goto(`${url}/#/reports`);
    await page.waitForSelector('text=Reports are for admins and owners.');

    // Cole (who didn't analyse it) doesn't see it among his completed samples.
    await pickName('Cole Collector');
    await page.goto(`${url}/#/samples/completed`);
    await page.waitForSelector('text=No samples match.');

    // ---- Admin: reports and exports ----
    await codeSignIn('bea', '555000');
    await page.goto(`${url}/#/mites`);
    assert.ok(await page.isVisible('text=Mite Reports'));
    assert.ok(await page.isVisible('text=All Samples'));
    await page.goto(`${url}/#/reports`);
    await page.waitForSelector('.small-multiples .chart svg path.bar');
    await shot('05-reports');
    const [download] = await Promise.all([page.waitForEvent('download'), page.click('#exportLeaves')]);
    const csv = fs.readFileSync(await download.path(), 'utf8').replace(/^﻿/, '');
    const lines = csv.trim().split('\r\n');
    assert.equal(lines.length, 4, csv);
    assert.ok(lines[0].includes(',DeadTetranychusCount,EatenTwoSpotEggCount,OtherBeneficialCount,LadybirdStethorusCount,'));
    assert.ok(lines[1].includes(',Cole Collector,A1,Cascade,7.84,75,1,Lee Analyst,'));
    await context.setOffline(true);
    const [dl2] = await Promise.all([page.waitForEvent('download'), page.click('#exportSummary')]);
    assert.match(dl2.suggestedFilename(), /tablet/);
    await context.setOffline(false);
    assert.equal(await page.isVisible('text=Manage Users'), false);

    // ---- Owner: people and tablets ----
    await codeSignIn('ana', '111111');
    assert.ok(await page.isVisible('text=Ana Admin · Owner'));
    await page.goto(`${url}/#/sample/${done.SampleID}`);
    await page.click('.leaf-table tbody tr:nth-child(1)');
    await page.fill('#TetranychusCount', '5');
    await page.click('button:has-text("Save changes")');
    await page.waitForSelector('#leavesAnalysed');
    await syncNow();
    const audit = g.table('AuditLog');
    assert.equal(audit.length, 1);
    assert.match(audit[0].Summary, /TetranychusCount: 4 → 5/);

    await page.goto(`${url}/#/`);
    await page.click('text=Manage Users');
    await page.waitForSelector('.sample-card:has-text("Cole Collector")');
    assert.ok(await page.isVisible('.sample-card:has-text("Field tablet 1")'));
    // A new User needs no code.
    await page.click('text=+ Add person');
    await page.fill('#FullName', 'Sam Wilson');
    assert.equal(await page.inputValue('#Username'), 'sam');
    await page.fill('#UserEmail', 'sam@farm.nz');
    await page.click('button:has-text("Add person")');
    await page.waitForSelector('#noCodeNote');
    // Another owner is view-only.
    await page.click('text=Add another');
    await page.fill('#FullName', 'Bob Boss');
    await page.fill('#UserEmail', 'bob@farm.nz');
    await page.selectOption('#Role', 'Owner');
    await page.click('button:has-text("Add person")');
    await page.waitForSelector('#newCode');
    const bobCode = await page.textContent('#newCode');
    await page.goto(`${url}/#/users`);
    await page.click('.sample-card:has-text("Bob Boss")');
    await page.waitForSelector('#readOnlyNote');
    assert.equal(await page.inputValue('#AccessCode'), bobCode);
    assert.equal(await page.isVisible('button:has-text("Save changes")'), false);
    // Sam now taps his name.
    await pickName('Sam Wilson');
    assert.ok(await page.isVisible('text=Sam Wilson · User'));

    // "I'm new here" on the tablet.
    await page.goto(`${url}/#/switch`);
    await page.click('text=I’m new here');
    await page.fill('#fullName', 'Kiri Tane');
    await page.click('button:has-text("Add me")');
    await page.waitForSelector('.tiles'); // signed in and on the home screen
    assert.ok(await page.isVisible('text=Kiri Tane · User'));
    assert.ok(g.table('Users').some((u) => u.FullName === 'Kiri Tane' && u.Role === 'User'));

    // Server unreachable: changes wait safely.
    await codeSignIn('ana', '111111');
    server.apiDown = true;
    await page.goto(`${url}/#/sample/${done.SampleID}`);
    await page.click('button:has-text("Reopen analysis")');
    await page.click('dialog button:has-text("Reopen")');
    await page.waitForSelector('#syncBadge:has-text("1 waiting to upload")', { timeout: 15000 });
    server.apiDown = false;
    await syncNow();
    assert.equal(g.table('Samples').find((s) => s.SampleNumber === 1042).Status, 'Analysis In Progress');

    // Phone-sized screen: no sideways scrolling, no stray text.
    await page.setViewportSize({ width: 390, height: 800 });
    for (const hash of ['#/', '#/mites', '#/new', '#/help/mites', '#/users', '#/user/new', '#/samples/all', `#/sample/${done.SampleID}`, `#/leaf/${done.SampleID}/new`, '#/reports', '#/switch', '#/login/new']) {
      await page.goto(`${url}/${hash}`);
      await page.waitForTimeout(300);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      assert.ok(overflow <= 1, `horizontal overflow ${overflow}px on ${hash}`);
      assert.doesNotMatch(await page.textContent('main'), /\bnull\b|\bundefined\b|NaN/, `stray text on ${hash}`);
    }

    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
    server.close();
  }
});
