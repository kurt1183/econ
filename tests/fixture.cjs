'use strict';

// SYNTHETIC TEST DATA ONLY. These dates and values are generated independently
// of data_info.xlsx. Reference metadata supplies identities, never observations.
const JSZip = require('../src/jszip.min.js');
const referenceMeta = require('../src/reference-meta.json');

const DAY_COUNT = 96;
const FIRST_DATE = '2024-01-01';
const SOURCE_NAME = 'synthetic_ficc_fixture.xlsx';
const REQUIRED_COUNT = 260;
const EXTRA_COUNT = 42;
const TOTAL_COUNT = REQUIRED_COUNT + EXTRA_COUNT;

function columnName(index) {
  let result = '';
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) {
    result = String.fromCharCode(65 + (n - 1) % 26) + result;
  }
  return result;
}

function escapeXml(value) {
  return String(value).replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;',
  })[character]);
}

function stringCell(column, row, value) {
  return `<c r="${columnName(column)}${row}" t="inlineStr"><is><t>${escapeXml(value)}</t></is></c>`;
}

function numberCell(column, row, value) {
  return `<c r="${columnName(column)}${row}"><v>${value}</v></c>`;
}

function syntheticDate(day) {
  return new Date(Date.UTC(2024, 0, 1 + day)).toISOString().slice(0, 10);
}

function syntheticValue(key, day) {
  // Known analytic relationships permit independent arithmetic assertions.
  if (key === 7) return 2 + day * 0.01;
  if (key === 11) return 2.5 + day * 0.015;
  if (key === 36) return 1 + day * 0.02;
  if (key === 171) return 2.9 + day * 0.018;
  if (key === 20) return 1000 + day * 2;
  return 10 + key * 0.1 + day * 0.025;
}

function syntheticMetadata() {
  if (!Array.isArray(referenceMeta) || referenceMeta.length !== REQUIRED_COUNT) {
    throw new Error('The synthetic fixture expects exactly 260 reference identities.');
  }
  return [
    ...referenceMeta.map(meta => ({ ...meta })),
    ...Array.from({ length: EXTRA_COUNT }, (_, offset) => ({
      index: REQUIRED_COUNT + offset + 1,
      key: String(REQUIRED_COUNT + offset + 1),
      // Four extras exercise a category absent from the original 260 identities.
      category: offset >= EXTRA_COUNT - 4 ? 'EQUITY' : 'MACRO',
      id: `SYNTHETIC_EXTRA_${String(offset + 1).padStart(2, '0')}`,
      field: 'SYNTHETIC_TEST_VALUE',
      ticker: `SYNTHETIC_TICKER_${offset + 1}`,
      notation: `Synthetic extra ${offset + 1}`,
      label: `Synthetic extra ${offset + 1}`,
      unit: '지수',
      mode: 'abs',
    })),
  ];
}

/** Build a complete XLSX buffer in memory, containing no private observations. */
async function createSyntheticWorkbook({ problem = null } = {}) {
  const metadata = syntheticMetadata();
  const headerLabels = { 4: 'UNITS', 5: 'Category', 6: 'Ticker', 7: 'Notation', 8: 'DATES', 9: 'Field' };
  const headerFields = { 5: 'category', 6: 'ticker', 7: 'notation', 8: 'id', 9: 'field' };
  const xmlRows = [];
  for (const row of [4, 5, 6, 7, 8, 9]) {
    const cells = [stringCell(0, row, headerLabels[row])];
    metadata.forEach((meta, index) => {
      const value = row === 4 ? `단위:${meta.unit}` : meta[headerFields[row]];
      cells.push(stringCell(index + 1, row, value));
    });
    xmlRows.push(`<row r="${row}">${cells.join('')}</row>`);
  }
  for (let day = 0; day < DAY_COUNT; day += 1) {
    const row = day + 10;
    let date = syntheticDate(day);
    if (problem === 'duplicate-date' && day === DAY_COUNT - 1) date = syntheticDate(day - 1);
    if (problem === 'invalid-date' && day === DAY_COUNT - 1) date = '2024-02-30';
    const cells = [stringCell(0, row, date)];
    for (let key = 1; key <= TOTAL_COUNT; key += 1) {
      // Deliberate, explicitly located quality cases; important analytic series
      // remain complete so the expected regressions/spreads have exact answers.
      if (day === 3 && key === 260) cells.push(stringCell(key, row, '4.2bad'));
      else if (day === 4 && key === 259) continue; // Missing cell.
      else if (day === 5 && key === 258) cells.push(`<c r="${columnName(key)}${row}" t="e"><v>#N/A</v></c>`);
      else if (day === 6 && key === 257) cells.push(`<c r="${columnName(key)}${row}"><f>1+1</f></c>`); // No cached value.
      else if (day === 7 && key === 256) cells.push(numberCell(key, row, 0));
      else cells.push(numberCell(key, row, syntheticValue(key, day)));
    }
    xmlRows.push(`<row r="${row}">${cells.join('')}</row>`);
  }

  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8"?>' +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
    '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
    '</Types>');
  zip.file('_rels/.rels', '<?xml version="1.0" encoding="UTF-8"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
    '</Relationships>');
  zip.file('xl/workbook.xml', '<?xml version="1.0" encoding="UTF-8"?>' +
    '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
    '<sheets><sheet name="DailyRate" sheetId="1" r:id="rId1"/></sheets></workbook>');
  zip.file('xl/_rels/workbook.xml.rels', '<?xml version="1.0" encoding="UTF-8"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
    '</Relationships>');
  zip.file('xl/worksheets/sheet1.xml', '<?xml version="1.0" encoding="UTF-8"?>' +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    `<dimension ref="A1:${columnName(TOTAL_COUNT)}${DAY_COUNT + 9}"/>` +
    `<sheetData>${xmlRows.join('')}</sheetData></worksheet>`);
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

module.exports = {
  createSyntheticWorkbook, syntheticDate, syntheticValue, syntheticMetadata,
  DAY_COUNT, FIRST_DATE, SOURCE_NAME, TOTAL_COUNT,
};
