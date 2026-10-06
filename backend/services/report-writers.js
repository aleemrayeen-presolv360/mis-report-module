/**
 * REPORT WRITERS — write rows to a file as they arrive, never holding the whole report in memory.
 *
 * Both writers share one interface:
 *     const writer = createReportWriter('xlsx' | 'csv', filePath, columns);
 *     await writer.writeRows(rows);   // call once per batch; rows are arrays in column order
 *     await writer.finish();
 *
 * `columns` is [{ label, type }] from query-builder.js. Types decide formatting:
 *   date / datetime -> real Excel dates (CSV: YYYY-MM-DD)
 *   number / amount -> real numbers
 *   boolean         -> Yes / No
 */

const fs = require('fs');
const { once } = require('events');
const { finished } = require('stream/promises');
const ExcelJS = require('exceljs');

const EXCEL_MAX_ROWS_PER_SHEET = 1048575; // Excel's limit is 1,048,576 including the header row
const EXCEL_MAX_CELL_TEXT = 32767;
const HEADER_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8EAEE' } };

const NUMBER_FORMAT = {
  date: 'dd-mmm-yyyy',
  datetime: 'dd-mmm-yyyy hh:mm',
  amount: '#,##0.00',
  number: '0',
};

/* ------------------------------------------------------------------ */
/* Value conversion                                                    */
/* ------------------------------------------------------------------ */

// 'YYYY-MM-DD' or 'YYYY-MM-DD HH:MM' -> Date in UTC, which ExcelJS writes as that exact clock time.
function toExcelDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})(?: (\d{2}):(\d{2}))?/.exec(value);
  if (!match) return value;
  const [, y, m, d, hh = '0', mm = '0'] = match;
  return new Date(Date.UTC(+y, +m - 1, +d, +hh, +mm));
}

function toExcelValue(value, type) {
  if (value === null || value === undefined) return null;
  switch (type) {
    case 'date':
    case 'datetime':
      return toExcelDate(value);
    case 'number':
    case 'amount': {
      const n = Number(value);
      return Number.isFinite(n) ? n : String(value);
    }
    case 'boolean':
      return value ? 'Yes' : 'No';
    default: {
      const s = typeof value === 'object' ? JSON.stringify(value) : String(value);
      return s.length > EXCEL_MAX_CELL_TEXT ? `${s.slice(0, EXCEL_MAX_CELL_TEXT - 1)}…` : s;
    }
  }
}

function toCsvField(value, type) {
  if (value === null || value === undefined) return '';
  if (type === 'boolean') return value ? 'Yes' : 'No';
  if (type === 'number' || type === 'amount' || type === 'date' || type === 'datetime') return String(value);

  let s = typeof value === 'object' ? JSON.stringify(value) : String(value);
  // A text cell starting with = + - @ would run as a formula when the CSV is opened in Excel.
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/* ------------------------------------------------------------------ */
/* CSV                                                                 */
/* ------------------------------------------------------------------ */

class CsvReportWriter {
  constructor(filePath, columns) {
    this.columns = columns;
    this.stream = fs.createWriteStream(filePath, { encoding: 'utf8' });
    // The byte-order mark makes Excel open the file as UTF-8, so Hindi/Marathi names show correctly.
    this.stream.write(`﻿${columns.map((c) => toCsvField(c.label, 'text')).join(',')}\r\n`);
  }

  async writeRows(rows) {
    const chunk = rows
      .map((row) => row.map((value, i) => toCsvField(value, this.columns[i].type)).join(','))
      .join('\r\n');
    if (!this.stream.write(`${chunk}\r\n`)) await once(this.stream, 'drain');
  }

  async finish() {
    this.stream.end();
    await finished(this.stream);
  }

  async abort() {
    this.stream.destroy();
  }
}

/* ------------------------------------------------------------------ */
/* Excel                                                               */
/* ------------------------------------------------------------------ */

class XlsxReportWriter {
  constructor(filePath, columns) {
    this.columns = columns;
    // Streaming writer: each committed row goes straight to the zip on disk.
    // Shared strings are off because that table would keep every distinct text value in memory.
    this.workbook = new ExcelJS.stream.xlsx.WorkbookWriter({
      filename: filePath,
      useStyles: true,
      useSharedStrings: false,
    });
    this.sheetNumber = 0;
    this.rowsInSheet = 0;
    this.addSheet();
  }

  // A new sheet each time Excel's row limit is reached: "Report", "Report (2)", ...
  addSheet() {
    if (this.sheet) this.sheet.commit();
    this.sheetNumber += 1;
    this.rowsInSheet = 0;

    const name = this.sheetNumber === 1 ? 'Report' : `Report (${this.sheetNumber})`;
    this.sheet = this.workbook.addWorksheet(name, { views: [{ state: 'frozen', ySplit: 1 }] });
    this.sheet.columns = this.columns.map((c) => ({
      header: c.label,
      width: Math.min(Math.max(c.label.length + 4, c.type === 'datetime' ? 18 : 14), 50),
      style: NUMBER_FORMAT[c.type] ? { numFmt: NUMBER_FORMAT[c.type] } : {},
    }));
    this.sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: this.columns.length } };

    const header = this.sheet.getRow(1);
    header.font = { bold: true };
    header.fill = HEADER_FILL;
    header.commit();
  }

  async writeRows(rows) {
    for (const row of rows) {
      if (this.rowsInSheet >= EXCEL_MAX_ROWS_PER_SHEET) this.addSheet();
      this.sheet.addRow(row.map((value, i) => toExcelValue(value, this.columns[i].type))).commit();
      this.rowsInSheet += 1;
    }
    await this.waitForZip();
  }

  /**
   * ExcelJS writes each row into the zip without waiting for compression to keep up, so on big
   * reports the backlog grows to gigabytes. Here we wait until the zip's input stream has drained
   * before accepting the next batch, which keeps memory flat.
   * Uses ExcelJS internals (sheet._stream.pipes); if they change, it falls back to a short yield.
   * (archiver uses the older readable-stream package, which only exposes `_writableState.needDrain`.)
   */
  async waitForZip() {
    const zipInput = this.sheet._stream && this.sheet._stream.pipes && this.sheet._stream.pipes[0];
    const needsDrain = zipInput && (zipInput.writableNeedDrain || (zipInput._writableState && zipInput._writableState.needDrain));
    if (needsDrain) await once(zipInput, 'drain');
    else await new Promise((resolve) => setImmediate(resolve));
  }

  async finish() {
    this.sheet.commit();
    await this.workbook.commit();
  }

  async abort() {
    try {
      await this.workbook.commit();
    } catch (err) {
      // the file is deleted by the caller anyway
    }
  }
}

function createReportWriter(format, filePath, columns) {
  return format === 'xlsx' ? new XlsxReportWriter(filePath, columns) : new CsvReportWriter(filePath, columns);
}

module.exports = { createReportWriter, toCsvField, toExcelValue };
