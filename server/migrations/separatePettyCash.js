import fs from 'node:fs/promises';
import path from 'node:path';
import { getStateSnapshot, updateStateSnapshot, getStateStoreInfo } from '../storage/fileStateStore.js';
import { resetPettyCashState } from '../../src/utils/pettyCashFund.js';

// Reinicio solicitado al separar las cajas. El marcador evita repetirlo en reinicios.
export async function runPettyCashSeparation() {
  const snapshot = await getStateSnapshot();
  if (!snapshot.initialized || !snapshot.state || snapshot.state.settings?.accounting?.cashBoxesIndependent) return;
  const info = getStateStoreInfo();
  const directory = path.join(path.dirname(info.stateFilePath), 'backups');
  await fs.mkdir(directory, { recursive: true });
  const backupPath = path.join(directory, `before-petty-separation-${Date.now()}.json`);
  await fs.writeFile(backupPath, JSON.stringify(snapshot), 'utf8');
  await updateStateSnapshot(state => {
    if (state.settings?.accounting?.cashBoxesIndependent) return state;
    return resetPettyCashState(state, { backupFile: backupPath, userName: 'Reinicio solicitado de Caja Chica' }).state;
  });
  console.info('[migration] Caja Chica independiente, reiniciada en cero.', { backupPath });
}
