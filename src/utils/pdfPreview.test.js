import test from 'node:test';
import assert from 'node:assert/strict';
import { createPdfPreview } from './pdfPreview.js';
test('cached PDF viewer and print URL use the authenticated downloaded bytes without expiring access tokens', () => {
  const pdf = new Blob(['%PDF-1.7 test'], { type: 'application/pdf' });
  const preview = createPdfPreview(pdf);
  try {
    assert.match(preview.viewerUrl, /^blob:/);
    assert.equal(preview.viewerUrl, preview.blobUrl);
    assert.equal(preview.viewerUrl.includes('access_token'), false);
    const reopened = { ...preview };
    assert.equal(reopened.viewerUrl, preview.viewerUrl);
  } finally { URL.revokeObjectURL(preview.blobUrl); }
});
test('unauthorized JSON responses cannot become a PDF preview', () => {
  assert.throws(() => createPdfPreview(new Blob(['{"error":"Clave interna requerida"}'], { type: 'application/json' })), /PDF valido/);
});
