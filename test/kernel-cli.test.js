import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {once} from 'node:events';
import {mkdtemp,symlink,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
test('actual CLI serves built frontend and persists task across a clean server restart',async()=>{
 const cwd=await mkdtemp(join(tmpdir(),'jarvis-cli-'));await symlink(resolve('dist'),join(cwd,'dist'),'dir');const token=randomBytes(32).toString('hex');let child;
 const start=async()=>{child=spawn(process.execPath,[resolve('kernel/http.js')],{cwd,env:{...process.env,JARVIS_TOKEN:token,PORT:'0'},stdio:['ignore','pipe','pipe']});child.stderr.resume();let output='';let timer;const port=await new Promise((resolve,reject)=>{timer=setTimeout(()=>reject(new Error('CLI startup timeout')),10000);child.once('error',reject);child.stdout.on('data',data=>{output+=data;const match=output.match(/127[.]0[.]0[.]1:([0-9]+)/);if(match)resolve(Number(match[1]));});});clearTimeout(timer);return 'http://127.0.0.1:'+port;};
 const stop=async()=>{if(child.exitCode!==null)return;child.kill('SIGTERM');await once(child,'exit');};
 const api=(origin,path,body)=>fetch(origin+'/api/'+path,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(3000)});
 try{let origin=await start();assert.equal((await fetch(origin+'/?kernel=local')).status,200);assert.equal((await api(origin,'health')).status,200);const task=await (await api(origin,'tasks',{workspace:'default',idempotencyKey:'cli-real',text:'durable smoke'})).json();let record;for(let i=0;i<15;i++){record=await (await api(origin,'tasks/'+task.id)).json();if(record.status==='succeeded')break;await delay(30);}assert.equal(record.status,'succeeded');await stop();origin=await start();const restored=await (await api(origin,'tasks/'+task.id)).json();assert.equal(restored.status,'succeeded');assert.equal(restored.runId,record.runId);assert.equal(restored.attempt,1);}
 finally{if(child)await stop();await rm(cwd,{recursive:true,force:true});}
});
