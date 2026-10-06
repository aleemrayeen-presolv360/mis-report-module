const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const ExcelJS = require('exceljs');
const { createReportWriter, toCsvField } = require('../services/report-writers');

const COLUMNS = [
  { label: 'Case number', type: 'text' },
  { label: 'Notice date', type: 'date' },
  { label: 'Outstanding', type: 'amount' },
  { label: 'Awaiting input', type: 'boolean' },
];
const ROWS = [
  ['S138-1', '2026-09-15', '125000.50', true],
  ['=HYPERLINK("x")', null, null, false],
  ['राजेश, "Raj"', '2026-09-01', '0', null],
];

const tmp = (name) => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mis-')), name);

test('CSV: BOM, quoting, formula injection blocked, Hindi kept', async () => {
  const file = tmp('r.csv');
  const writer = createReportWriter('csv', file, COLUMNS);
  await writer.writeRows(ROWS);
  await writer.finish();

  const text = fs.readFileSync(file, 'utf8');
  assert.ok(text.startsWith('﻿'));
  assert.strictEqual(
    text.slice(1),
    'Case number,Notice date,Outstanding,Awaiting input\r\n' +
      'S138-1,2026-09-15,125000.50,Yes\r\n' +
      `"'=HYPERLINK(""x"")",,,No\r\n` +
      '"राजेश, ""Raj""",2026-09-01,0,\r\n'
  );
});

test('CSV: negative numbers are not treated as formulas', () => {
  assert.strictEqual(toCsvField('-500', 'amount'), '-500');
  assert.strictEqual(toCsvField('-500', 'text'), "'-500");
});

test('Excel: real dates and numbers, header styled', async () => {
  const file = tmp('r.xlsx');
  const writer = createReportWriter('xlsx', file, COLUMNS);
  await writer.writeRows(ROWS);
  await writer.finish();

  const book = new ExcelJS.Workbook();
  await book.xlsx.readFile(file);
  const sheet = book.getWorksheet('Report');
  assert.strictEqual(sheet.getRow(1).getCell(1).value, 'Case number');
  assert.strictEqual(sheet.getRow(1).font.bold, true);
  assert.strictEqual(sheet.getRow(2).getCell(2).value.toISOString(), '2026-09-15T00:00:00.000Z');
  assert.strictEqual(sheet.getRow(2).getCell(3).value, 125000.5);
  assert.strictEqual(sheet.getRow(2).getCell(4).value, 'Yes');
  assert.strictEqual(sheet.getRow(3).getCell(1).value, '=HYPERLINK("x")', 'stored as text, not a formula');
  assert.strictEqual(sheet.rowCount, 4);
});

test('Excel: empty report still has the header row', async () => {
  const file = tmp('empty.xlsx');
  const writer = createReportWriter('xlsx', file, COLUMNS);
  await writer.finish();
  const book = new ExcelJS.Workbook();
  await book.xlsx.readFile(file);
  assert.strictEqual(book.getWorksheet('Report').rowCount, 1);
});
