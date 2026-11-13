import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { enableContractPhotoOcr } from './enable-contract-photo-ocr.mjs';

test('OCR activation preserves unrelated configuration and creates a private recovery copy', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'copetin-ocr-config-'));
  const original = 'APP_INTERNAL_KEY=test-secret\nAPP_STATE_FILE=/existing/state.json\nCONTRACT_PHOTO_ENGINE=ollama\nexport CONTRACT_PHOTO_ENABLED=false\n';
  await fs.writeFile(path.join(directory, '.env'), original);
  try {
    await assert.rejects(enableContractPhotoOcr({ directory, probe: async () => ({ ready: false, message: 'not installed' }) }), /not installed/);
    assert.equal(await fs.readFile(path.join(directory, '.env'), 'utf8'), original);
    const result = await enableContractPhotoOcr({ directory, probe: async () => ({ ready: true }) });
    assert.equal(await fs.readFile(result.backup, 'utf8'), original);
    const updated = await fs.readFile(path.join(directory, '.env'), 'utf8');
    assert.match(updated, /APP_INTERNAL_KEY=test-secret/); assert.match(updated, /APP_STATE_FILE=\/existing\/state.json/);
    assert.match(updated, /CONTRACT_PHOTO_ENGINE=python/); assert.match(updated, /CONTRACT_PHOTO_ENABLED=true/);
    assert.equal((updated.match(/CONTRACT_PHOTO_ENGINE=/g) || []).length, 1);
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
});
