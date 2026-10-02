import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import express from 'express';
const stateFile = process.argv[2];
if (!stateFile) throw new Error('Indica un respaldo JSON para medir las consultas de lectura.');
process.env.APP_STATE_FILE = path.resolve(stateFile);
process.env.APP_INTERNAL_KEY = 'local-benchmark-only';
const baselineFile = path.resolve('server/routes/.benchmark-temp-state.js');
const servers=[];
try {
  const baseline = process.argv[3] || 'aed32fe';
  const oldSource=execFileSync('git',['show',`${baseline}:server/routes/state.js`],{encoding:'utf8',maxBuffer:10*1024*1024});
  await fs.writeFile(baselineFile,oldSource);
  const oldRouter=(await import('../server/routes/.benchmark-temp-state.js')).default;
  const newRouter=(await import('../server/routes/state.js')).default;
  for(const [name,router] of [['antes',oldRouter],['después',newRouter]]) {
    const app=express(); app.use(router);
    const server=app.listen(0,'127.0.0.1');servers.push(server);
    await new Promise(resolve=>server.once('listening',resolve));
    const endpoint=name==='antes'?'/accounting-context?limit=750':'/accounting/opening-overview';
    for(const url of [endpoint]) {
      for(const pass of ['primera','repetida']) {
        const started=performance.now();
        const response=await fetch(`http://127.0.0.1:${server.address().port}/__copetin_db${url}`,{headers:{'X-App-Internal-Key':process.env.APP_INTERNAL_KEY}});
        const body=await response.text();
        if(!response.ok)throw new Error(`${url}: ${response.status}`);
        console.log(JSON.stringify({version:name,query:url,pass,ms:Math.round(performance.now()-started),bytes:Buffer.byteLength(body),movements:JSON.parse(body).movements?.length}));
      }
    }
  }
} finally {
  for(const server of servers)await new Promise(resolve=>server.close(resolve));
  await fs.rm(baselineFile,{force:true});
}
