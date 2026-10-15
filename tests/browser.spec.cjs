'use strict';

// This suite executes only in GitHub Actions and uses synthetic data exclusively.
// Passing it is NOT evidence of a browser upload of the user's private workbook.
const { test, expect } = require('@playwright/test');
const { pathToFileURL } = require('node:url');
const fs = require('node:fs/promises');
const {
  createSyntheticWorkbook, syntheticValue, syntheticDate,
  DAY_COUNT, FIRST_DATE, SOURCE_NAME, TOTAL_COUNT,
} = require('./fixture.cjs');

let syntheticBuffer;

test.beforeAll(async () => {
  syntheticBuffer = await createSyntheticWorkbook();
});

test.beforeEach(async ({ page }) => {
  page.testErrors = [];
  page.testUnexpectedRequests = [];
  page.on('pageerror', error => page.testErrors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error') page.testErrors.push(message.text());
  });
  let loaded = false;
  page.on('request', request => {
    // Navigation/reload is intentional. All background HTTP requests after the
    // page has loaded (including upload analytics or data transfers) are errors.
    if (loaded && /^https?:/.test(request.url()) && !request.isNavigationRequest()) {
      page.testUnexpectedRequests.push(`${request.method()} ${request.url()}`);
    }
  });
  const response = await page.goto('/econ/index.html');
  expect(response.ok()).toBeTruthy();
  loaded = true;
  await expect.poll(() => page.evaluate(() => typeof window.FICC)).toBe('object');
});

test.afterEach(async ({ page }, testInfo) => {
  await testInfo.attach('browser-observations.json', {
    body: JSON.stringify({
      data: 'Synthetic fixture only; no private workbook browser upload.',
      errors: page.testErrors,
      backgroundRequests: page.testUnexpectedRequests,
    }, null, 2),
    contentType: 'application/json',
  });
  expect(page.testErrors, 'No JavaScript or browser console errors').toEqual([]);
  expect(page.testUnexpectedRequests, 'No background HTTP requests after initial load').toEqual([]);
});

async function uploadSynthetic(page, buffer = syntheticBuffer, name = SOURCE_NAME) {
  await page.locator('#excelFile').setInputFiles({
    name,
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer,
  });
  await expect(page.locator('#uploadStatus')).toHaveClass(/success/);
  await expect.poll(() => page.evaluate(() => window.FICC.data.dates.length)).toBe(DAY_COUNT);
}

async function customPeriod(page) {
  await page.locator('#analysisFrom').fill('2024-01-10');
  await page.locator('#analysisTo').fill('2024-03-20');
  await page.locator('#analysisApply').click();
  await expect(page.locator('#periodError')).toHaveText('');
  await expect(page.locator('#periodStatus')).toContainText('2024-01-10');
  await expect(page.locator('#periodStatus')).toContainText('2024-03-20');
}

async function downloadText(page, selector) {
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.locator(selector).click(),
  ]);
  const stream = await download.createReadStream();
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return { name: download.suggestedFilename(), text: Buffer.concat(chunks).toString('utf8') };
}

function csvRows(text) {
  // Actual exports quote all fields; parse doubled quotes and embedded commas.
  const rows = [];
  let row = [], cell = '', quoted = false;
  const input = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < input.length; i += 1) {
    const character = input[i];
    if (character === '"') {
      if (quoted && input[i + 1] === '"') { cell += '"'; i += 1; }
      else quoted = !quoted;
    } else if (character === ',' && !quoted) { row.push(cell); cell = ''; }
    else if ((character === '\n' || character === '\r') && !quoted) {
      if (character === '\r' && input[i + 1] === '\n') i += 1;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += character;
  }
  if (cell.length || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

test('initial public page has no embedded observations and renders without errors', async ({ page }) => {
  const empty = await page.evaluate(() => ({
    dates: window.FICC.data.dates,
    values: window.FICC.data.values,
    dataset: JSON.parse(document.querySelector('#dataset').textContent),
  }));
  expect(empty.dates).toEqual([]);
  expect(empty.values).toEqual([]);
  expect(empty.dataset.values).toEqual([]);
  await expect(page.locator('.upload-empty').first()).toBeVisible();
  await expect(page.locator('#uploadBtn')).toBeEnabled();
  await expect(page.locator('#saveHtmlBtn')).toBeDisabled();
});

test('invalid first upload preserves the empty state and disabled data export', async ({ page }) => {
  await page.locator('#excelFile').setInputFiles({
    name: 'synthetic_invalid_first.xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: await createSyntheticWorkbook({ problem: 'invalid-date' }),
  });
  await expect(page.locator('#uploadStatus')).toHaveClass(/error/);
  expect(await page.evaluate(() => window.FICC.data.dates)).toEqual([]);
  await expect(page.locator('#saveHtmlBtn')).toBeDisabled();
  await expect(page.locator('.upload-empty').first()).toBeVisible();
});

test('synthetic XLSX imports 302 indicators, preserves zero, and rejects nonnumeric cells', async ({ page }, testInfo) => {
  await uploadSynthetic(page);
  const actual = await page.evaluate(() => ({
    count: window.FICC.data.meta.length,
    first: window.FICC.data.dates[0],
    last: window.FICC.data.dates.at(-1),
    samples: [
      window.FICC.data.values[3][259], // Invalid text "4.2bad".
      window.FICC.data.values[4][258], // Missing cell.
      window.FICC.data.values[5][257], // Excel error.
      window.FICC.data.values[6][256], // Formula with no cached result.
      window.FICC.data.values[7][255], // Genuine zero.
    ],
    extraValue: window.FICC.data.values[20][301],
  }));
  expect(actual.count).toBe(TOTAL_COUNT);
  expect(actual.first).toBe(FIRST_DATE);
  expect(actual.last).toBe(syntheticDate(DAY_COUNT - 1));
  expect(actual.samples).toEqual([null, null, null, null, 0]);
  expect(actual.extraValue).toBeCloseTo(syntheticValue(302, 20), 10);
  await expect(page.locator('#rowCount')).toContainText('302');
  await expect(page.locator('#allRows tr')).toHaveCount(TOTAL_COUNT);
  await expect(page.locator('#trend svg')).toBeVisible();
  await expect(page.locator('#series option')).toHaveCount(TOTAL_COUNT);
  await expect(page.locator('#quantX option')).toHaveCount(TOTAL_COUNT + 2);
  await expect(page.locator('#series optgroup[label="EQUITY"] option')).toHaveCount(4);
  const screenshotPath = testInfo.outputPath('dashboard.png');
  await page.screenshot({ path: screenshotPath, fullPage: true });
  await testInfo.attach('dashboard-synthetic-1440px.png', { path: screenshotPath, contentType: 'image/png' });
});

test('custom dates update charts, analysis samples, searches and CSV exports', async ({ page }) => {
  await uploadSynthetic(page);
  await customPeriod(page);
  const state = await page.evaluate(() => window.FICC.getState());
  expect(state.start).toBe(9);
  expect(state.current).toBe(79);
  expect(state.range).toBe('CUSTOM');
  await expect(page.locator('#trendStats')).toContainText('71');
  await expect(page.locator('#spreadCoverage')).toContainText('2024-01-10');
  await expect(page.locator('#quantCaption')).toContainText('2024-03-20');
  await page.locator('#search').fill('SYNTHETIC_EXTRA_42');
  await expect(page.locator('#allRows tr')).toHaveCount(1);
  await expect(page.locator('#allRows')).toContainText('SYNTHETIC_EXTRA_42');
  const exported = await downloadText(page, '#csvBtn');
  expect(exported.name).toMatch(/\.csv$/);
  const records = csvRows(exported.text);
  expect(records).toHaveLength(2);
  expect(records[1]).toContain('2024-01-10');
  expect(records[1]).toContain('2024-03-20');
  await page.locator('#search').fill('this-indicator-does-not-exist');
  await expect(page.locator('#allRows')).toContainText('일치하는 지표가 없습니다');
  await expect(page.locator('#csvBtn')).toBeDisabled();
});

test('period and matched-maturity credit spreads agree with independent formulas', async ({ page }) => {
  await uploadSynthetic(page);
  await customPeriod(page);
  await page.locator('#spreadTermTab').click();
  await page.locator('#spreadCountry').selectOption('KR');
  await page.locator('#spreadLong').selectOption('11');
  await page.locator('#spreadShort').selectOption('7');
  const term = await page.evaluate(() => window.FICC.getSpreadCache());
  expect(term.begin).toBe(9);
  expect(term.end).toBe(79);
  expect(term.values[79]).toBeCloseTo(50 + 79 * 0.5, 9);
  await expect(page.locator('#spreadMetrics')).toContainText('89.50 bp');
  await page.locator('#spreadSwap').click();
  expect(await page.evaluate(() => window.FICC.getSpreadCache().values[79])).toBeCloseTo(-89.5, 9);

  await page.locator('#spreadCreditTab').click();
  await page.locator('#creditSpreadMode').selectOption('yield');
  await page.locator('#spreadCreditLeg').selectOption('171');
  await page.locator('#spreadMatch').selectOption('exact');
  const credit = await page.evaluate(() => window.FICC.getSpreadCache());
  expect(credit.values[79]).toBeCloseTo(90 + 79 * 0.8, 9);
  expect(credit.benchmark.interpolated).toBe(false);
  expect(credit.benchmark.mismatch).toBe(false);
  await expect(page.locator('#spreadMetrics')).toContainText('153.20 bp');
  const records = csvRows((await downloadText(page, '#spreadCsvBtn')).text);
  expect(records).toHaveLength(72);
  const dateColumn = records[0].indexOf('날짜');
  const spreadColumn = records[0].indexOf('스프레드_bp');
  expect(dateColumn).toBeGreaterThanOrEqual(0);
  expect(spreadColumn).toBeGreaterThanOrEqual(0);
  expect(records[1][dateColumn]).toBe('2024-01-10');
  expect(records.at(-1)[dateColumn]).toBe('2024-03-20');
  expect(Number(records.at(-1)[spreadColumn])).toBeCloseTo(153.2, 9);
});

test('statistics, correlation, regression and rolling volatility match analytic answers', async ({ page }) => {
  await uploadSynthetic(page);
  await customPeriod(page);
  await page.locator('#quantX').selectOption('36');
  await page.locator('#quantY').selectOption('11');
  await page.locator('#quantTransform').selectOption('level');
  await page.locator('#quantWindow').selectOption('20');
  const result = await page.evaluate(() => window.FICC.getQuantCache());
  expect(result.pairs).toHaveLength(71);
  expect(result.model.valid).toBe(true);
  expect(result.model.beta).toBeCloseTo(0.75, 10);
  expect(result.model.alpha).toBeCloseTo(1.75, 10);
  expect(result.model.r).toBeCloseTo(1, 10);
  expect(result.model.r2).toBeCloseTo(1, 10);
  expect(result.summary.mean).toBeCloseTo(2.5 + 0.015 * 44, 10);
  expect(result.summary.sd).toBeCloseTo(0.015 * Math.sqrt(71 * 72 / 12), 10);
  expect(result.vol.at(-1)).toBeCloseTo(0.015 * Math.sqrt(20 * 21 / 12), 10);
  await expect(page.locator('#quantPairCount')).toHaveText('n = 71');
  await expect(page.locator('#quantStats')).toBeVisible();
  const records = csvRows((await downloadText(page, '#quantCsvBtn')).text);
  expect(records).toHaveLength(72);
  const header = records[0];
  const last = records.at(-1);
  expect(last[header.indexOf('날짜')]).toBe('2024-03-20');
  expect(Number(last[header.indexOf('X원값')])).toBeCloseTo(syntheticValue(36, 79), 10);
  expect(Number(last[header.indexOf('적합Y')])).toBeCloseTo(syntheticValue(11, 79), 10);
  expect(Number(last[header.indexOf('잔차')])).toBeCloseTo(0, 10);
});

test('zoom and legend controls operate without altering the analysis period', async ({ page }) => {
  await uploadSynthetic(page);
  await customPeriod(page);
  const before = await page.evaluate(() => ({
    state: window.FICC.getState(),
    view: window.FICC.chartViews.get('trend'),
  }));
  await page.locator('#trendTools [data-chart-action="in"]').click();
  const after = await page.evaluate(() => ({
    state: window.FICC.getState(),
    view: window.FICC.chartViews.get('trend'),
  }));
  expect(after.state.start).toBe(before.state.start);
  expect(after.state.current).toBe(before.state.current);
  expect(after.view.to - after.view.from).toBeLessThan(before.view.to - before.view.from);
  const legend = page.locator('#trendTools [data-chart-series="0"]');
  await expect(legend).toHaveAttribute('aria-pressed', 'true');
  await legend.click();
  await expect(legend).toHaveAttribute('aria-pressed', 'false');
  await legend.click();
  await expect(legend).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#trendTools [data-chart-action="reset"]').click();
  const restored = await page.evaluate(() => window.FICC.chartViews.get('trend'));
  expect(restored.from).toBe(before.view.from);
  expect(restored.to).toBe(before.view.to);
});

test('bad date uploads and invalid date ranges retain the existing valid dataset', async ({ page }) => {
  await uploadSynthetic(page);
  for (const problem of ['duplicate-date', 'invalid-date']) {
    await page.locator('#excelFile').setInputFiles({
      name: `synthetic_${problem}.xlsx`,
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      buffer: await createSyntheticWorkbook({ problem }),
    });
    await expect(page.locator('#uploadStatus')).toHaveClass(/error/);
    expect(await page.evaluate(() => window.FICC.data.source.name)).toBe(SOURCE_NAME);
    expect(await page.evaluate(() => window.FICC.data.dates.length)).toBe(DAY_COUNT);
  }
  const before = await page.evaluate(() => window.FICC.getState());
  await page.locator('#analysisFrom').fill('2024-03-20');
  await page.locator('#analysisTo').fill('2024-01-10');
  await page.locator('#analysisApply').click();
  await expect(page.locator('#periodError')).not.toHaveText('');
  expect(await page.evaluate(() => window.FICC.getState())).toEqual(before);
});

test('saved synthetic HTML reopens offline; ordinary public-page reload clears the upload', async ({ page, browser }, testInfo) => {
  await uploadSynthetic(page);
  await customPeriod(page);
  page.on('dialog', dialog => dialog.accept());
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.locator('#saveHtmlBtn').click(),
  ]);
  const savedPath = testInfo.outputPath('saved-synthetic-dashboard.html');
  await download.saveAs(savedPath);
  const contents = await fs.readFile(savedPath, 'utf8');
  expect(contents).toContain(SOURCE_NAME);
  expect(contents).not.toMatch(/<script[^>]+\bsrc\s*=/i);
  expect(contents).not.toMatch(/<link[^>]+rel=["']stylesheet["'][^>]+href=/i);

  const offlineContext = await browser.newContext({ offline: true, locale: 'ko-KR' });
  const offlinePage = await offlineContext.newPage();
  const offlineErrors = [], offlineRequests = [];
  offlinePage.on('pageerror', error => offlineErrors.push(error.message));
  offlinePage.on('console', message => { if (message.type() === 'error') offlineErrors.push(message.text()); });
  offlinePage.on('request', request => { if (/^https?:/.test(request.url())) offlineRequests.push(request.url()); });
  try {
    await offlinePage.goto(pathToFileURL(savedPath).href);
    await expect.poll(() => offlinePage.evaluate(() => window.FICC?.data.dates.length)).toBe(DAY_COUNT);
    expect(await offlinePage.evaluate(() => window.FICC.data.meta.length)).toBe(TOTAL_COUNT);
    expect(await offlinePage.evaluate(() => window.FICC.getState().current)).toBe(79);
    await expect(offlinePage.locator('#series option')).toHaveCount(TOTAL_COUNT);
    await expect(offlinePage.locator('#quantX option')).toHaveCount(TOTAL_COUNT + 2);
    await expect(offlinePage.locator('#series optgroup[label="EQUITY"] option')).toHaveCount(4);
    await expect(offlinePage.locator('#quantX optgroup[label="EQUITY"] option')).toHaveCount(4);
    await offlinePage.locator('#series').selectOption('302');
    await expect(offlinePage.locator('#series')).toHaveValue('302');
    await offlinePage.locator('#quantX').selectOption('302');
    await expect(offlinePage.locator('#quantX')).toHaveValue('302');
    await expect(offlinePage.locator('#trend svg')).toBeVisible();
    await offlinePage.reload();
    expect(await offlinePage.evaluate(() => window.FICC.data.dates.length)).toBe(DAY_COUNT);
    expect(offlineErrors).toEqual([]);
    expect(offlineRequests).toEqual([]);
  } finally {
    await offlineContext.close();
  }

  await page.reload();
  expect(await page.evaluate(() => window.FICC.data.dates)).toEqual([]);
  expect(await page.evaluate(() => window.FICC.data.values)).toEqual([]);
  await expect(page.locator('.upload-empty').first()).toBeVisible();
});
