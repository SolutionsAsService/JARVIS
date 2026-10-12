import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,symlinkSync,existsSync,readFileSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';import {createHash} from 'node:crypto';import {execFileSync} from 'node:child_process';import {once} from 'node:events';
import {extractDadaContract,readDadaCheckout,diffDadaContract,loadDada,designPacket,checkDesignLog,DADA_REQUIRED_PATHS,DADA_REQUIRED_SEATS,dadaConfigFromEnv} from '../kernel/adapters/dada.js';
import {adaptersFromEnv} from '../kernel/startup.js';import {Kernel} from '../kernel/kernel.js';import {createKernelServer} from '../kernel/http.js';import {readLock,checkoutDir} from '../scripts/upstream.mjs';
const lock=readLock(),entry=lock.components.find(c=>c.id==='dada'),snapshot=JSON.parse(readFileSync(new URL('../upstreams/contracts/dada.json',import.meta.url),'utf8'));
// Synthetic, independently written stand-in for a DADA checkout (no upstream text: the upstream has no license).
const seats=[...new Set(Object.values(DADA_REQUIRED_SEATS).flat())];
function fakeCheckout({commit='a'.repeat(40),skill}={}){const d=mkdtempSync(join(tmpdir(),'dada-fake-'));const w=(p,s)=>{mkdirSync(join(d,p,'..'),{recursive:true});writeFileSync(join(d,p),s);};
 w('skills/dada/SKILL.md',skill??'---\nname: dada\ndescription: "fixture"\n---\n# Fixture\nThere is no move quota.\n1. **Traversal Plan**\n2. **Decision Records**\n3. **Panel Reports**\n4. **Anchor Ledger**\n5. **Compliance Check**\n| | Autonomous | Adaptive |\n- **S1.** a\n- **S2.** b\n- **S3.** c\n- **S4.** d\n- **S5.** e\n');
 w('skills/dada/references/anchor-graph.md','graph TD\n  subgraph CRITICS["c"]\n'+seats.map(s=>'    '+s+'["x"]:::critic').join('\n')+'\n  end\n  '+seats[0]+' -->|e| '+seats[1]+'\n');
 w('skills/dada/agents/openai.yaml','interface:\n  display_name: "Fixture"\n  default_prompt: "Use $dada"\n');
 for(const p of ['skills/dada/references/traversal-ledger.md','tools/pixcontrast.py','scripts/validate_skills.py','README.md','AGENTS.md'])w(p,'fixture '+p+'\n');
 w('tools/measure.py',"CHROME = '/usr/bin/chromium'\nPRESETS = {\n    'overflow': 1,\n}\nap.add_argument('--preset')\n");
 mkdirSync(join(d,'.agents/skills'),{recursive:true});symlinkSync('../../skills/dada',join(d,'.agents/skills/dada'));
 writeFileSync(join(d,'.jarvis-upstream.json'),JSON.stringify({id:'dada',commit}));return d;}

test('DADA lock: exact pin, license finding, pin-fetch-only and nothing upstream committed',()=>{
 assert.match(entry.commit,/^[0-9a-f]{40}$/);assert.equal(entry.policy,'pin-fetch-only');assert.equal(entry.license.spdx,null);assert.match(entry.license.reuse,/not cleared/);
 assert.equal(snapshot.schema,'jarvis.dada-contract/1');assert.deepEqual(snapshot.missingPaths,[]);assert.equal(snapshot.skill.name,'dada');assert.equal(snapshot.graph.nodes,302);
 for(const s of seats)assert.ok(snapshot.graph.criticIds.includes(s),s);
 const files=execFileSync('git',['ls-files'],{encoding:'utf8'}).trim().split('\n').filter(f=>existsSync(f));const upstream=new Set(Object.values(snapshot.hashes));
 for(const f of files)assert.ok(!upstream.has(createHash('sha256').update(readFileSync(f)).digest('hex')),f+' is a copy of an upstream DADA file');
});
test('DADA contract: extraction, breaking vs informational diffs',()=>{
 const base=readDadaCheckout(fakeCheckout());assert.deepEqual(base.missingPaths,[]);assert.equal(base.artifacts.length,5);assert.deepEqual(base.modes,['Autonomous','Adaptive']);assert.equal(base.discoveryLink,'skills/dada');assert.ok(diffDadaContract(base,base).identical);
 const files=Object.fromEntries(DADA_REQUIRED_PATHS.map(p=>[p,'x']));
 const noArtifacts=extractDadaContract(files);const d=diffDadaContract(base,noArtifacts);assert.equal(d.compatible,false);assert.ok(d.breaking.some(b=>/artifact removed: Anchor Ledger/.test(b)));assert.ok(d.breaking.some(b=>/skill name/.test(b)));
 const lostPath=diffDadaContract(base,{...base,requiredPaths:base.requiredPaths.filter(p=>p!=='tools/measure.py')});assert.ok(lostPath.breaking.includes('required path removed: tools/measure.py'));
 const lostSeat=diffDadaContract(base,{...base,graph:{...base.graph,criticIds:base.graph.criticIds.filter(i=>i!=='crit_inc_mace')}});assert.ok(lostSeat.breaking.includes('required critic seat removed: crit_inc_mace'));
 const drift=diffDadaContract(base,{...base,graph:{...base.graph,nodes:base.graph.nodes+1},hashes:{...base.hashes,'README.md':'0'}});assert.equal(drift.compatible,true);assert.equal(drift.identical,false);assert.ok(drift.changed.includes('content changed: README.md'));
});
test('DADA load refuses missing checkout, wrong commit and broken contract',()=>{
 const dir=fakeCheckout(),snap=readDadaCheckout(dir);
 assert.throws(()=>loadDada({dir:join(dir,'nope'),commit:'a'.repeat(40),snapshot:snap}),{code:'dada_missing'});
 assert.throws(()=>loadDada({dir,commit:'b'.repeat(40),snapshot:snap}),{code:'dada_pin'});
 const broken=fakeCheckout({skill:'---\nname: dada\n---\nno artifacts'});assert.throws(()=>loadDada({dir:broken,commit:'a'.repeat(40),snapshot:snap}),{code:'dada_contract'});
 const ok=loadDada({dir,commit:'a'.repeat(40),snapshot:snap});assert.match(ok.skillSha256,/^[0-9a-f]{64}$/);
 assert.equal(dadaConfigFromEnv({}),null);assert.equal(dadaConfigFromEnv({JARVIS_DADA_ENABLED:'1'},{root:'/r',lock:entry}).dir,'/r/.jarvis/upstreams/dada/'+entry.commit);
});
test('design packets and DESIGN-LOG checks',()=>{
 const dada={commit:'a'.repeat(40),skillSha256:'f'.repeat(64)};
 assert.equal(designPacket(dada,{brief:'A poster about silence, no constraints'}).mode,'Autonomous');
 const p=designPacket(dada,{brief:'Landing page for developers; audience: evaluators',lite:true});assert.equal(p.mode,'Adaptive');assert.deepEqual(p.requiredSeats,DADA_REQUIRED_SEATS.Adaptive);assert.deepEqual(p.stopConditions,[]);assert.equal(p.skill.commit,dada.commit);
 assert.throws(()=>designPacket(dada,{brief:'short'}),{code:'input'});assert.throws(()=>designPacket(dada,{brief:'long enough brief',mode:'Chaos'}),{code:'input'});
 const good='## Traversal Plan\nMode: **Adaptive**\n## Move M1: x\n### Panel, Move M1, round R1\n## Anchor Ledger\n## Compliance Check\n- [x] a\n- [x] b\n';
 const r=checkDesignLog(good);assert.equal(r.ok,true);assert.equal(r.complete,true);assert.equal(r.mode,'Adaptive');
 const partial=checkDesignLog(good+'- [ ] S1 not met\n');assert.equal(partial.ok,false);assert.equal(checkDesignLog(good+'- [ ] S1 not met\n## Open frontier\n').ok,true);
 assert.deepEqual(checkDesignLog('## Traversal Plan\nMode: Adaptive\n').missing,['Decision Records','Panel Reports','Anchor Ledger','Compliance Check']);
});
test('design.dada task: off by default, packet when enabled, surfaced in health and /api/upstreams',async()=>{
 const off=adaptersFromEnv({});assert.equal(off.summary.dada.enabled,false);assert.deepEqual(off.executors,{});
 assert.throws(()=>adaptersFromEnv({JARVIS_DADA_ENABLED:'1',JARVIS_DADA_DIR:'/nonexistent/dada'}),{code:'dada_missing'});
 const dir=fakeCheckout(),snap=readDadaCheckout(dir),fakeLock=JSON.stringify({components:[{...entry,commit:'a'.repeat(40)}]});
 const readFile=(u,enc)=>String(u).endsWith('upstreams/lock.json')?fakeLock:String(u).endsWith('contracts/dada.json')?JSON.stringify(snap):readFileSync(u,enc);
 const on=adaptersFromEnv({JARVIS_DADA_ENABLED:'1',JARVIS_DADA_DIR:dir},{readFile});assert.equal(on.summary.dada.enabled,true);assert.equal(on.summary.dada.inference,false);assert.ok(on.executors['design.dada']);assert.ok(!JSON.stringify(on.summary).includes(dir));
 const actor={id:'o',tenant:'t',workspaces:['w'],capabilities:['text.digest','design.dada']};
 const plain=new Kernel();assert.throws(()=>plain.submit(actor,{workspace:'w',idempotencyKey:'d0',operation:'design.dada',text:'Poster for a jazz night'}),{code:'tool_denied'});await plain.close();
 const kernel=new Kernel({executors:on.executors});const t=kernel.submit(actor,{workspace:'w',idempotencyKey:'d1',operation:'design.dada',text:'Landing page for developers evaluating JARVIS'});
 assert.equal(t.routing.blocked,false);const done=await kernel.execute(actor,t.id);assert.equal(done.status,'succeeded');assert.equal(done.result.packet.mode,'Adaptive');assert.equal(done.result.packet.skill.sha256,snap.hashes['skills/dada/SKILL.md']);
 assert.throws(()=>kernel.submit({...actor,capabilities:['text.digest']},{workspace:'w',idempotencyKey:'d2',operation:'design.dada',text:'Poster brief here'}),{code:'capability_denied'});
 const token='test-only-token-long-enough-dada',server=createKernelServer({kernel,tokens:[{token,actor}],adapters:on});server.listen(0,'127.0.0.1');await once(server,'listening');const origin='http://127.0.0.1:'+server.address().port,get=p=>fetch(origin+p,{headers:{Authorization:'Bearer '+token}}).then(r=>r.json());
 try{assert.equal((await get('/api/health')).adapters.dada,true);const u=await get('/api/upstreams');assert.equal(u.components.find(c=>c.id==='dada').commit,entry.commit);assert.equal(u.adapters.dada.operation,'design.dada');}finally{await server.shutdown();}
});
const pinned=checkoutDir('dada',entry.commit);
test('pinned upstream checkout matches the committed contract snapshot',{skip:existsSync(join(pinned,'.jarvis-upstream.json'))?false:'run npm run upstream:verify first (CI does)'},()=>{
 const d=diffDadaContract(snapshot,readDadaCheckout(pinned));assert.deepEqual(d.breaking,[]);assert.deepEqual(d.changed,[]);assert.ok(loadDada({dir:pinned,commit:entry.commit,snapshot}).diff.identical);
});
