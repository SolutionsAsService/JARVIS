import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {once} from 'node:events';
import {Kernel} from '../kernel/kernel.js';
import {createKernelServer} from '../kernel/http.js';
import {selectSkills} from '../kernel/skill-router.js';
import {contextManifest} from '../kernel/context.js';
const actor={id:'owner',tenant:'t',workspaces:['w'],capabilities:['text.*','read.*'],deniedCapabilities:['read.secret']};
const skill=(id,extra={})=>({id,body:'bounded policy '+id,tenant:'t',workspace:'w',license:'MIT',platforms:[process.platform],permissions:['read.file'],capabilities:['work'],triggers:[],dependencies:[],exclusive:[],...extra});
test('single live supervisor owns file store and route context is persisted',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'jarvis-owner-'));const path=join(dir,'state.sqlite');const k=new Kernel({path});
 try{assert.throws(()=>new Kernel({path}),{code:'store_owned'});const task=k.submit(actor,{workspace:'w',idempotencyKey:'routed',text:'actual input'});assert.equal(task.routing.selected[0].logicalId,'jarvis.bounded-work');const result=await k.execute(actor,task.id);assert.equal(result.status,'succeeded');assert.equal(result.context.included[0].trust,'approved-skill');assert.equal(result.context.included[1].trust,'user');assert.equal(result.approval.capability,'text.digest');}
 finally{await k.close();await rm(dir,{recursive:true,force:true});}
});
test('all ambiguous logical IDs denied and deny rules cannot be routed around',()=>{
 const options={actor,workspace:'w',capabilities:['work']};
 const ambiguous=selectSkills([skill('same'),skill('same',{body:'two'}),skill('same',{body:'three'})],options);
 assert.equal(ambiguous.selected.length,0);assert.equal(ambiguous.rejected.length,3);
 const allowed=selectSkills([skill('allowed'),skill('secret',{permissions:['read.secret']})],options);assert.equal(allowed.selected[0].logicalId,'allowed');assert.ok(allowed.rejected.some(s=>s.reason==='permission'));
 const cross=selectSkills([skill('same'),skill('same',{tenant:'other'})],options);assert.equal(cross.selected.length,1);
 for(const budget of [-1,NaN,Infinity]){assert.throws(()=>selectSkills([skill('a')],{...options,budget}),{code:'context_budget'});assert.throws(()=>contextManifest([],{actor,workspace:'w',budget}),{code:'context_budget'});}
 assert.throws(()=>selectSkills([],{actor,workspace:'denied'}),{code:'forbidden'});
});
test('restart drains queued custody without resubmission and authenticated policy API stays honest',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'jarvis-http-restart-'));const path=join(dir,'state.sqlite');let k=new Kernel({path});const task=k.submit(actor,{workspace:'w',idempotencyKey:'restart',text:'queued',timeoutMs:10000});await k.close();k=new Kernel({path});const token='test-restart-only-long-token-000';const server=createKernelServer({kernel:k,tokens:[{token,actor}]});server.listen(0,'127.0.0.1');await once(server,'listening');const origin='http://127.0.0.1:'+server.address().port;
 const post=(path,body)=>fetch(origin+path,{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify(body)});
 try{await server.kernelIdle();assert.equal(k.read(actor,task.id).status,'succeeded');const r=await post('/api/skills/route',{workspace:'w',capabilities:['text.digest']});assert.equal(r.status,200);assert.equal((await r.json()).selected.length,1);const model=await (await post('/api/models/route',{workspace:'w'})).json();assert.equal(model.inferencePerformed,false);assert.equal(model.blocked,true);const preview=await (await post('/api/mcp/preview',{workspace:'w',id:'proposal',pin:'fixture-only',license:'MIT',transport:'stdio'})).json();assert.equal(preview.installed,false);assert.equal((await post('/api/skills/route',{workspace:'outside'})).status,403);}
 finally{await server.shutdown();await rm(dir,{recursive:true,force:true});}
});
