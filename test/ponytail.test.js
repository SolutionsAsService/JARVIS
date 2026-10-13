import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,existsSync,readFileSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';import {createHash} from 'node:crypto';import {execFileSync} from 'node:child_process';import {once} from 'node:events';
import {extractPonytailContract,readPonytailCheckout,diffPonytailContract,loadPonytail,codingPacket,ponytailConfigFromEnv,PONYTAIL_SKILLS,PONYTAIL_REQUIRED_PATHS,PONYTAIL_OPERATION} from '../kernel/adapters/ponytail.js';
import {adaptersFromEnv} from '../kernel/startup.js';import {Kernel} from '../kernel/kernel.js';import {createKernelServer} from '../kernel/http.js';import {readLock,checkoutDir} from '../scripts/upstream.mjs';
const lock=readLock(),entry=lock.components.find(c=>c.id==='ponytail'),snapshot=JSON.parse(readFileSync(new URL('../upstreams/contracts/ponytail.json',import.meta.url),'utf8'));
// Synthetic stand-in for a ponytail checkout (no upstream text).
function fakeCheckout({commit='a'.repeat(40),license='MIT License\nfixture\n'}={}){const d=mkdtempSync(join(tmpdir(),'ponytail-fake-'));const w=(p,s)=>{mkdirSync(join(d,p,'..'),{recursive:true});writeFileSync(join(d,p),s);};
 w('LICENSE',license);w('package.json',JSON.stringify({name:'fixture',version:'1.0.0',license:'MIT'}));w('AGENTS.md','fixture\n');
 for(const s of PONYTAIL_SKILLS){w('skills/'+s+'/SKILL.md','---\nname: '+s+'\ndescription: >\n  fixture\n---\nbody\n');w('.openclaw/skills/'+s+'/SKILL.md','---\nname: '+s+'\ndescription: x\n---\n');}
 writeFileSync(join(d,'.jarvis-upstream.json'),JSON.stringify({id:'ponytail',commit}));return d;}

test('ponytail lock: exact pin, MIT cleared, pin-fetch-only, sparse fetch, nothing upstream committed',()=>{
 assert.match(entry.commit,/^[0-9a-f]{40}$/);assert.equal(entry.policy,'pin-fetch-only');assert.equal(entry.license.spdx,'MIT');assert.match(entry.license.reuse,/cleared/);assert.ok(entry.fetch.sparse.includes('!/assets/'));
 assert.equal(snapshot.schema,'jarvis.ponytail-contract/1');assert.deepEqual(snapshot.missingPaths,[]);assert.deepEqual(snapshot.skills,PONYTAIL_SKILLS);assert.equal(snapshot.licenseFile,'MIT');
 const files=execFileSync('git',['ls-files'],{encoding:'utf8'}).trim().split('\n').filter(f=>existsSync(f));const upstream=new Set(Object.values(snapshot.hashes));
 for(const f of files)assert.ok(!upstream.has(createHash('sha256').update(readFileSync(f)).digest('hex')),f+' is a copy of an upstream ponytail file');
});
test('ponytail contract: extraction, breaking vs informational diffs',()=>{
 const base=readPonytailCheckout(fakeCheckout());assert.deepEqual(base.missingPaths,[]);assert.deepEqual(base.skills,PONYTAIL_SKILLS);assert.ok(diffPonytailContract(base,base).identical);
 const empty=diffPonytailContract(base,extractPonytailContract({}));assert.equal(empty.compatible,false);assert.ok(empty.breaking.includes('skill removed: ponytail'));
 assert.ok(diffPonytailContract(base,readPonytailCheckout(fakeCheckout({license:'Proprietary\n'}))).breaking.includes('LICENSE is no longer MIT'));
 const drift=diffPonytailContract(base,{...base,package:{...base.package,version:'2.0.0'},hashes:{...base.hashes,'AGENTS.md':'0'}});assert.equal(drift.compatible,true);assert.ok(drift.changed.includes('version 1.0.0 -> 2.0.0'));assert.ok(drift.changed.includes('content changed: AGENTS.md'));
 assert.equal(PONYTAIL_REQUIRED_PATHS.length,15);
});
test('ponytail load refusals and coding packets',()=>{
 const dir=fakeCheckout(),snap=readPonytailCheckout(dir);
 assert.throws(()=>loadPonytail({dir:join(dir,'nope'),commit:'a'.repeat(40),snapshot:snap}),{code:'ponytail_missing'});
 assert.throws(()=>loadPonytail({dir,commit:'b'.repeat(40),snapshot:snap}),{code:'ponytail_pin'});
 assert.throws(()=>loadPonytail({dir:fakeCheckout({license:'nope'}),commit:'a'.repeat(40),snapshot:snap}),{code:'ponytail_contract'});
 const p=loadPonytail({dir,commit:'a'.repeat(40),snapshot:snap});
 assert.equal(codingPacket(p,{task:'Add a retry to the fetch helper'}).skill.id,'ponytail');
 assert.equal(codingPacket(p,{task:'Review this change please'}).skill.id,'ponytail-review');
 assert.equal(codingPacket(p,{task:'Audit the whole repo'}).skill.id,'ponytail-audit');
 const d=codingPacket(p,{task:'List the shortcuts we took'});assert.equal(d.skill.id,'ponytail-debt');assert.equal(d.skill.sha256,snap.hashes['skills/ponytail-debt/SKILL.md']);
 assert.throws(()=>codingPacket(p,{task:'hi'}),{code:'input'});
 assert.equal(ponytailConfigFromEnv({}),null);assert.equal(ponytailConfigFromEnv({JARVIS_PONYTAIL_ENABLED:'1'},{root:'/r',lock:entry}).dir,'/r/.jarvis/upstreams/ponytail/'+entry.commit);
});
test('code.ponytail task: off by default, packet when enabled, surfaced in health and /api/upstreams',async()=>{
 const off=adaptersFromEnv({});assert.equal(off.summary.ponytail.enabled,false);assert.ok(!off.executors[PONYTAIL_OPERATION]);
 assert.throws(()=>adaptersFromEnv({JARVIS_PONYTAIL_ENABLED:'1',JARVIS_PONYTAIL_DIR:'/nonexistent/ponytail'}),{code:'ponytail_missing'});
 const dir=fakeCheckout(),snap=readPonytailCheckout(dir),fakeLock=JSON.stringify({components:[{...entry,commit:'a'.repeat(40)}]});
 const readFile=(u,enc)=>String(u).endsWith('upstreams/lock.json')?fakeLock:String(u).endsWith('contracts/ponytail.json')?JSON.stringify(snap):readFileSync(u,enc);
 const on=adaptersFromEnv({JARVIS_PONYTAIL_ENABLED:'1',JARVIS_PONYTAIL_DIR:dir},{readFile});assert.equal(on.summary.ponytail.enabled,true);assert.equal(on.summary.ponytail.inference,false);assert.ok(!JSON.stringify(on.summary).includes(dir));
 const actor={id:'o',tenant:'t',workspaces:['w'],capabilities:['text.digest',PONYTAIL_OPERATION]};
 const kernel=new Kernel({executors:on.executors});const t=kernel.submit(actor,{workspace:'w',idempotencyKey:'p1',operation:PONYTAIL_OPERATION,text:'Review the router change'});
 const done=await kernel.execute(actor,t.id);assert.equal(done.status,'succeeded');assert.equal(done.result.packet.skill.id,'ponytail-review');
 const token='test-only-token-long-enough-ponytail',server=createKernelServer({kernel,tokens:[{token,actor}],adapters:on});server.listen(0,'127.0.0.1');await once(server,'listening');const origin='http://127.0.0.1:'+server.address().port,get=p=>fetch(origin+p,{headers:{Authorization:'Bearer '+token}}).then(r=>r.json());
 try{assert.equal((await get('/api/health')).adapters.ponytail,true);const u=await get('/api/upstreams');assert.equal(u.components.find(c=>c.id==='ponytail').commit,entry.commit);assert.equal(u.adapters.ponytail.operation,PONYTAIL_OPERATION);}finally{await server.shutdown();}
});
const pinned=checkoutDir('ponytail',entry.commit);
test('pinned ponytail checkout matches the committed contract snapshot',{skip:existsSync(join(pinned,'.jarvis-upstream.json'))?false:'run npm run upstream:verify first (CI does)'},()=>{
 const d=diffPonytailContract(snapshot,readPonytailCheckout(pinned));assert.deepEqual(d.breaking,[]);assert.deepEqual(d.changed,[]);
});
