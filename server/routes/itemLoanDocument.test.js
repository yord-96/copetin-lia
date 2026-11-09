import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';

const chrome = [process.env.CHROMIUM_EXECUTABLE_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/chromium', '/usr/bin/google-chrome'].find(value => value && existsSync(value));
test('loan PDF endpoint reads the saved loan, requires the internal key and never changes stock', { skip: !chrome }, async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'copetin-loan-document-'));
  process.env.APP_STATE_FILE = path.join(directory, 'state.json');
  process.env.APP_INTERNAL_KEY = 'loan-document-test';
  process.env.CHROMIUM_EXECUTABLE_PATH = chrome;
  process.env.DOCUMENT_PDF_CACHE_DIR = path.join(directory, 'pdf-cache');
  process.env.CHROMIUM_USER_DATA_DIR = path.join(directory, 'browser');
  const { default: router } = await import('./documents.js');
  const { replaceStateSnapshot, getStateSnapshot, updateStateSnapshot } = await import('../storage/fileStateStore.js');
  const { closeDocumentPdfRenderer } = await import('../storage/documentPdfRenderer.js');
  await replaceStateSnapshot({ settings: {}, items: [{ id: 'chair', totalStock: 20 }], itemLoans: [
    { id: 'loan', code: 'PR-00001', personName: 'CLIENTE GUARDADO', kind: 'legacy', date: '2026-11-09', lines: [{ id: 'l', itemName: 'MANTEL BLANCO', quantity: 11 }], returns: [] },
    { id: 'deleted', code: 'PR-00002', deletedAt: '2026-11-09' },
  ] }, null);
  const app = express(); app.use(router);
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}/__copetin_db/inventory/item-loans`;
  const headers = { 'X-App-Internal-Key': 'loan-document-test' };
  try {
    assert.equal((await fetch(`${base}/loan/pdf`)).status, 401);
    assert.equal((await fetch(`${base}/missing/pdf`, { headers })).status, 404);
    assert.equal((await fetch(`${base}/deleted/pdf`, { headers })).status, 404);
    const before = await getStateSnapshot();
    const response = await fetch(`${base}/loan/pdf`, { headers });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'application/pdf');
    assert.match(response.headers.get('content-disposition'), /PRESTAMO-PR-00001\.pdf/);
    const pdf = Buffer.from(await response.arrayBuffer());
    assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
    assert.equal((await getStateSnapshot()).revision, before.revision);
    await updateStateSnapshot(state => { state.itemLoans[0].returns = [{ lineId: 'l', quantity: 4, date: '2026-11-09' }]; return state; });
    const updatedPdf = Buffer.from(await (await fetch(`${base}/loan/pdf`, { headers })).arrayBuffer());
    assert.notDeepEqual(updatedPdf, pdf, 'saved returns must update the generated document');
    assert.equal((await getStateSnapshot()).state.items[0].totalStock, 20);
  } finally {
    await new Promise(resolve => server.close(resolve));
    await closeDocumentPdfRenderer();
    await fs.rm(directory, { recursive: true, force: true });
  }
});
