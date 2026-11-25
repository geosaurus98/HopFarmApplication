// End-to-end: Plant Health checks in a real browser against the real Apps Script code.
// Covers the farm's weekly bay check form, offline saving, sync, reports, export and access.
process.env.TZ = 'Pacific/Auckland';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const { chromium } = require('playwright');
const { startServer } = require('../support/dev-server');

const SHOTS = process.env.SHOTS_DIR;

test('plant health: weekly bay check offline, conditional questions, sync, reports, export, access', { timeout: 120000 }, async () => {
  const { server, g, url } = await startServer();
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1024, height: 700 }, acceptDownloads: true });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|ERR_INTERNET_DISCONNECTED/.test(m.text())) errors.push(m.text()); });
  const shot = async (name, opts = {}) => { if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: `${SHOTS}/${name}.png`, ...opts }); } };

  /** Sign in with a code (an owner on a new tablet also sets it up for workers). */
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
  }

  try {
    await codeSignIn('ana', '111111'); // the owner sets the tablet up
    await pickName('Cole Collector');
    // Not the workers' address, and a test server: orange TEST bar, no warning.
    assert.match(await page.textContent('#envBanner'), /TEST VERSION .* test data/);
    assert.equal(await page.isVisible('#envBanner.danger'), false);
    // Both sections on the home screen for someone with access to both.
    assert.ok(await page.isVisible('#goMites'));
    assert.ok(await page.isVisible('#goPlants'));
    await page.waitForSelector('#syncBadge:has-text("All synced")');

    // ---- A weekly check, recorded offline ----
    await context.setOffline(true);
    await page.click('#goPlants');
    await page.click('text=New Plant Check');
    await page.waitForSelector('#BlockVarietyID');
    assert.match(await page.inputValue('#InspectionDate'), /^\d{4}-\d{2}-\d{2}$/, 'date filled in');
    assert.match(await page.inputValue('#InspectionTime'), /^\d{2}:\d{2}$/, 'time filled in');
    assert.ok(await page.isVisible('text=Inspector: Cole Collector'));

    // Save with nothing chosen: block, row, bay and stage are required.
    await page.click('#savePlant');
    await page.waitForSelector('text=Choose the current growth stage.');
    assert.ok(await page.isVisible('text=Enter the row number.'));

    await page.selectOption('#BlockVarietyID', 'C2-RIWAKA');
    await page.fill('#Row', '14');
    await page.fill('#Bay', '3');
    await page.click('#GrowthStage .chip[data-value="Spring Emergence / Rhizome Sprouting"]');
    assert.equal(await page.isVisible('text=Enter the row number.'), false, 'errors clear once the field is changed');
    assert.equal(await page.isVisible('text=Choose the current growth stage.'), false);
    for (const [q, v] of [['BineHealth', 'Normal'], ['CoirStatus', 'Intact'], ['WeedPressure', 'Low'], ['GrassLength', 'Medium'], ['TrellisIntegrity', 'Good'], ['IrrigationLeaks', 'None']]) {
      await page.click(`#${q} .chip[data-value="${v}"]`);
    }
    await page.click('#GrowthStage .chip[data-value="Training Stage (Bines being wrapped)"]');

    // Conditional questions: lateral length hidden before Lateral Development; internode bands by height.
    assert.equal(await page.isVisible('#AvgLateralLengthCm'), false);
    assert.equal(await page.isVisible('#Internode1to2mCm'), false);
    await page.fill('#BinesTrained', '30');
    await page.fill('#AvgBineHeightCm', '250');
    assert.equal(await page.isVisible('#InternodeUnder1mCm'), false, '<1 m stops after 2 m');
    assert.equal(await page.isVisible('#Internode1to2mCm'), true);
    await page.fill('#AvgBineHeightCm', '85');
    assert.equal(await page.isVisible('#InternodeUnder1mCm'), true);
    await page.fill('#MaxBineHeightCm', '60');
    await page.fill('#InternodeUnder1mCm', '12.5');
    // Help opens over the form without losing what's been entered.
    await page.click('#plantHelp');
    await page.waitForSelector('dialog.wide-dialog:has-text("Plant Health help")');
    await page.click('dialog.wide-dialog button:has-text("Close")');
    assert.equal(await page.$('dialog.wide-dialog'), null);
    await page.click('#OverallBineHealth .chip[data-value="Vigorous"]');
    await page.click('#LeafColour .swatch[data-value="5"]');
    await page.click('#LeafSize .chip[data-value="Medium"]');
    await page.click('#LeafDamage .chip[data-value="Curling"]');
    await page.click('#LeafDamage .chip[data-value="Chewing"]');
    await page.fill('#Comments', 'Some wind damage at the south end');
    await shot('plant-01-form', { fullPage: true });

    // Tallest shorter than average is caught.
    await page.click('#savePlant');
    await page.waitForSelector('text=The tallest bine cannot be shorter than the average.');
    await page.fill('#MaxBineHeightCm', '120');
    await page.click('#savePlant');
    await page.waitForSelector('text=Plant check saved');
    assert.ok(await page.isVisible('text=C2 - Riwaka · Row 14, Bay 3'));

    // Next bay: row/bay remembered from the last check of the block.
    await page.click('text=Check another bay');
    await page.selectOption('#BlockVarietyID', 'C2-RIWAKA');
    assert.equal(await page.inputValue('#Row'), '14');
    assert.equal(await page.inputValue('#Bay'), '3');
    await page.waitForSelector('.last-check:has-text("average height 85 cm")');
    await page.fill('#Bay', '4');
    await page.click('#GrowthStage .chip[data-value="Lateral Development (Side arm growth)"]');
    assert.equal(await page.isVisible('#AvgLateralLengthCm'), true, 'laterals asked from Lateral Development on');
    await page.fill('#AvgBineHeightCm', '95');
    await page.fill('#AvgLateralLengthCm', '15');
    await page.click('#savePlant');
    await page.waitForSelector('text=Plant check saved');

    // Survives an app restart while offline.
    await page.reload();
    await page.waitForSelector('#syncBadge:has-text("2 waiting to upload")');
    assert.equal(g.table('PlantChecks').length, 0, 'nothing reached the server while offline');

    // ---- Back online: uploads, gets record numbers ----
    await context.setOffline(false);
    await page.waitForSelector('#syncBadge:has-text("All synced")', { timeout: 15000 });
    const rows = g.table('PlantChecks').sort((a, b) => a.Bay - b.Bay);
    assert.equal(rows.length, 2);
    assert.deepEqual(rows.map((r) => [r.Block, r.Variety, r.Row, r.Bay, r.RecordNumber]), [['C2', 'Riwaka', 14, 3, 1], ['C2', 'Riwaka', 14, 4, 2]]);
    const first = rows[0];
    assert.equal(first.InspectorEmail, 'col@farm.nz');
    assert.equal(first.GrowthStage, 'Training Stage (Bines being wrapped)');
    assert.deepEqual([first.BinesTrained, first.AvgBineHeightCm, first.MaxBineHeightCm, first.InternodeUnder1mCm, first.LeafColour],
      [30, 85, 120, 12.5, 5]);
    assert.equal(first.LeafDamage, 'Chewing, Curling');
    assert.equal(first.AvgLateralLengthCm, '', 'not asked, so not saved');
    assert.equal(first.WeedPressure, 'Low');
    assert.equal(first.Comments, 'Some wind damage at the south end');
    assert.equal(rows[1].AvgLateralLengthCm, 15);

    // List and detail
    await page.goto(`${url}/#/plants`);
    await page.waitForSelector('.sample-card:has-text("Row 14, Bay 4")');
    await page.click('.sample-card:has-text("Row 14, Bay 3")');
    await page.waitForSelector('text=Record 2026/27 #1');
    assert.ok(await page.isVisible('.kv:has-text("Leaf damage") >> text=Chewing, Curling'));
    assert.ok(await page.isVisible('.swatch-mini'));

    // Editing your own check
    await page.click('a:has-text("Edit")');
    await page.waitForSelector('#savePlant');
    await page.fill('#Comments', 'Wind damage, south end of row 14');
    await page.click('#savePlant');
    await page.waitForSelector('h1:has-text("C2 - Riwaka")');
    await syncNow();
    assert.equal(g.table('PlantChecks').find((r) => r.Bay === 3).Comments, 'Wind damage, south end of row 14');

    // Users don't get reports.
    await page.goto(`${url}/#/plant-health`);
    assert.equal(await page.isVisible('text=Plant Reports'), false);

    // ---- Reports (admins and owners) ----
    await codeSignIn('ana', '111111');
    await page.goto(`${url}/#/plant-health`);
    await page.click('text=Plant Reports');
    await page.waitForSelector('.small-multiples .chart svg path.bar');
    await page.click('.chart-card:nth-child(1) .bar-group >> nth=0');
    assert.match(await page.textContent('.chart-card:nth-child(1) .chart-readout'), /Row 14 bay 3: 85 cm average height/);
    assert.ok(await page.isVisible('table.timeline td:has-text("C2 - Riwaka")'));
    // Latest checks table: two checks, newest first, link opens the check.
    await page.waitForSelector('#latestChecks tbody tr');
    assert.equal(await page.$$eval('#latestChecks tbody tr', (r) => r.length), 2);
    assert.equal(await page.inputValue('#latestPeriod'), '14', 'last 14 days to start with');
    assert.deepEqual(await page.$$eval('#latestPeriod option', (o) => o.map((x) => x.textContent)), ['Last 7 days', 'Last 14 days', 'Last 30 days', 'All']);
    const heads = await page.$$eval('#latestChecks th', (t) => t.map((x) => x.textContent));
    assert.ok(!heads.some((x) => /Season|Week|Inspector|Row|Grass|Trellis|Growth|Overall|Leaf size/.test(x)), heads.join());
    assert.ok(['Variety', 'Bine health', 'Bines on string', 'Snapped lateral'].every((x) => heads.includes(x)), heads.join());
    await page.click('#latestChecks tbody tr:first-child a.open-check');
    await page.waitForURL(/#\/plant\/[\w-]+$/);
    await page.waitForSelector('h1:has-text("C2")');
    await page.click('#backBtn');
    await page.waitForSelector('#latestChecks');
    await shot('plant-02-reports', { fullPage: true });
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#exportPlant')]);
    const csv = fs.readFileSync(await dl.path(), 'utf8').replace(/^﻿/, '').trim().split('\r\n');
    assert.equal(csv.length, 3);
    assert.ok(csv[0].startsWith('RecordNumber,Season,InspectionDate,WeekStarting,InspectionTime,Inspector,Block,Variety,Row,Bay'));
    assert.ok(csv[1].includes(',Cole Collector,C2,Riwaka,14,3,'));

    // Help: Plant Health section, each picture large when opened; Nitrogen (2) / Potassium (2) gone.
    await page.goto(`${url}/#/help/plant`);
    await page.click('summary:has-text("Molybdenum deficiency")');
    await page.waitForFunction(() => document.querySelector('#plant-molybdenum .help-photo')?.naturalWidth > 0);
    const titles = await page.$$eval('.help-item summary', (els) => els.map((e) => e.textContent));
    assert.equal(titles.filter((t) => /deficiency|aphids/.test(t)).length, 14);
    assert.ok(!titles.some((t) => /\(2\)/.test(t)));

    // ---- Access: a plant-only person sees only Plant Health ----
    await page.goto(`${url}/#/user/new`);
    await page.fill('#FullName', 'Pat Plants');
    await page.fill('#UserEmail', 'pat@farm.nz');
    await page.uncheck('#section-Mites');
    await page.click('button:has-text("Add person")');
    await page.waitForSelector('#noCodeNote');
    await pickName('Pat Plants');
    assert.ok(await page.isVisible('text=New Plant Check'), 'goes straight to Plant Health');
    assert.equal(await page.isVisible('text=New Mite Sample'), false);
    assert.equal(await page.isVisible('#goMites'), false);
    // Users see their own checks only.
    await page.goto(`${url}/#/plants`);
    await page.waitForSelector('text=No plant checks match.');
    const cole = g.table('PlantChecks').find((r) => r.Bay === 3);
    await page.goto(`${url}/#/plant/edit/${cole.CheckID}`);
    await page.waitForSelector('text=This check can no longer be changed');

    // Phone width: no sideways scrolling on the plant screens.
    await page.setViewportSize({ width: 390, height: 800 });
    for (const hash of ['#/', '#/plant-health', '#/plant/new', '#/plants', '#/help/plant']) {
      await page.goto(`${url}/${hash}`);
      await page.waitForTimeout(300);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      assert.ok(overflow <= 1, `horizontal overflow ${overflow}px on ${hash}`);
      assert.doesNotMatch(await page.textContent('main'), /\bnull\b|\bundefined\b|NaN/, `stray text on ${hash}`);
    }
    await page.goto(`${url}/#/plant/new`);
    await shot('plant-03-phone', { fullPage: true });

    // A test app pointed at a LIVE server gets a red warning.
    await page.setViewportSize({ width: 1024, height: 700 });
    g.props.ENVIRONMENT = 'LIVE';
    await codeSignIn('cole', '222222');
    assert.match(await page.textContent('#envBanner.danger'), /connected to the LIVE server/);
    g.props.ENVIRONMENT = 'TEST';

    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
    server.close();
  }
});
