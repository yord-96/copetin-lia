import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { runContractPhotoPython } from './contractPhotoPython.js';

test('Python bridge preserves UTF-8, passes the image on stdin, and checks availability without OCR', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'copetin-ocr-bridge-'));
  const workerPath = path.join(directory, 'fixture.mjs');
  await fs.writeFile(workerPath, `
    if (process.argv.includes('--check')) console.log(JSON.stringify({ready:true}));
    else { const chunks=[]; for await(const chunk of process.stdin) chunks.push(chunk);
      const output=Buffer.from(JSON.stringify({text:'Muñoz, garantía',imageBytes:Buffer.concat(chunks).length}));
      const split=output.indexOf(Buffer.from('ñ'))+1;
      process.stdout.write(output.subarray(0,split));
      setTimeout(()=>process.stdout.write(output.subarray(split)),10);
    }
  `);
  try {
    const env = { CONTRACT_PHOTO_PYTHON_PATH: process.execPath };
    assert.deepEqual(await runContractPhotoPython(null, { env, workerPath, check: true }), { ready: true });
    assert.deepEqual(await runContractPhotoPython(Buffer.from('image'), { env, workerPath }), { text: 'Muñoz, garantía', imageBytes: 5 });
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
});

test('Python bridge rejects stalled workers, cancellation and oversized output', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'copetin-ocr-limits-'));
  const workerPath = path.join(directory, 'fixture.mjs');
  await fs.writeFile(workerPath, `if(process.env.OCR_TEST_LARGE) process.stdout.write('x'.repeat(600000)); else setInterval(()=>{},100);`);
  const env = { CONTRACT_PHOTO_PYTHON_PATH: process.execPath, CONTRACT_PHOTO_PYTHON_TIMEOUT_MS: '1000' };
  try {
    await assert.rejects(runContractPhotoPython(null, { env, workerPath }), /no terminó en 1 segundos/);
    const controller = new AbortController();
    const pending = runContractPhotoPython(null, { env, workerPath, signal: controller.signal });
    controller.abort();
    await assert.rejects(pending, /cancelada/);
    await assert.rejects(runContractPhotoPython(null, { env: { ...env, OCR_TEST_LARGE: '1' }, workerPath }), /demasiado grande/);
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
});
