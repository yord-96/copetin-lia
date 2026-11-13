import 'dotenv/config';
import os from 'node:os';
import fs from 'node:fs/promises';
import { contractPhotoReaderStatus } from '../server/services/contractPhotoReader.js';
const gib = bytes => Number((bytes / 1024 ** 3).toFixed(1));
const disk = await fs.statfs('.');
const status = await contractPhotoReaderStatus();
console.log(JSON.stringify({ ...status, totalRamGiB: gib(os.totalmem()), freeRamGiB: gib(os.freemem()),
  freeDiskGiB: gib(disk.bavail * disk.bsize), note: 'El diagnóstico no instala modelos ni registra contratos. La velocidad y precisión requieren probar fotos reales.' }, null, 2));
if (!status.ready) process.exitCode = 1;
