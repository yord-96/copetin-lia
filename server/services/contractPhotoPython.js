import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const worker = path.join(root, 'server', 'ocr', 'worker.py');

export const contractPhotoPythonTimeoutMs = (env = process.env) => Math.min(120000,
  Math.max(1000, Number(env.CONTRACT_PHOTO_PYTHON_TIMEOUT_MS) || 60000));

export function runContractPhotoPython(buffer, { env = process.env, signal, check = false, workerPath = worker } = {}) {
  const executable = env.CONTRACT_PHOTO_PYTHON_PATH || path.join(root, 'data', 'contract-photo-python', 'venv',
    process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
  const timeoutMs = check ? 5000 : contractPhotoPythonTimeoutMs(env);
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(new Error('Lectura cancelada. No se creó ningún contrato.')); return; }
    const child = spawn(executable, [workerPath, ...(check ? ['--check'] : [])], {
      cwd: root, windowsHide: true,
      env: { ...process.env, ...env, OMP_NUM_THREADS: '1', OPENBLAS_NUM_THREADS: '1', PYTHONIOENCODING: 'utf-8' },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '', bytes = 0, settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true; clearTimeout(timer); signal?.removeEventListener('abort', abort);
      if (error) reject(error); else resolve(value);
    };
    const stop = () => {
      if (process.platform === 'win32' && child.pid) {
        // A Windows venv launcher may have a Python child. Kill only this worker's tree.
        const killer = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
        killer.on('error', () => child.kill());
      } else child.kill('SIGKILL');
    };
    const abort = () => { stop(); finish(new Error('Lectura cancelada. No se creó ningún contrato.')); };
    const timer = setTimeout(() => {
      stop(); finish(new Error(`El OCR local no terminó en ${timeoutMs/1000} segundos. No se creó ningún contrato.`));
    }, timeoutMs);
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    child.on('error', error => finish(Object.assign(new Error('No se pudo iniciar el OCR Python. Ejecuta su instalador y revisa CONTRACT_PHOTO_PYTHON_PATH.'), { cause: error })));
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', chunk => {
      bytes += Buffer.byteLength(chunk, 'utf8');
      if (bytes > 512*1024) { stop(); finish(new Error('El OCR devolvió una respuesta demasiado grande.')); return; }
      stdout += chunk.toString('utf8');
    });
    // Drain diagnostic logs without exposing raw OCR/client content to application logs.
    child.stderr.on('data', () => {});
    child.stdin.on('error', error => { if (error.code !== 'EPIPE') { stop(); finish(error); } });
    child.on('close', code => {
      if (settled) return;
      let result;
      try { result = JSON.parse(stdout); }
      catch { finish(new Error('El OCR Python no devolvió una respuesta válida. Revisa su instalación.')); return; }
      if (code !== 0 || result.error) { finish(new Error(result.error || 'El OCR Python terminó con un error.')); return; }
      finish(null, result);
    });
    child.stdin.end(buffer || undefined);
  });
}
