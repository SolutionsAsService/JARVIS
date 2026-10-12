import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,existsSync,readFileSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';import {createHash} from 'node:crypto';import {execFileSync} from 'node:child_process';import {once} from 'node:events';
import {extractLast30Contract,readLast30Checkout,diffLast30Contract,loadLast30,last30ConfigFromEnv,last30Executor,runEngine,engineArgs,engineEnv,shapeReport,validateTopic,pythonSatisfies,L30_REQUIRED_PATHS,L30_REQUIRED_FLAGS,L30_KEYLESS_SOURCES,L30_ENGINE,L30_OPERATION} from '../kernel/adapters/last30days.js';
import {adaptersFromEnv} from '../kernel/startup.js';import {Kernel} from '../kernel/kernel.js';import {createKernelServer} from '../kernel/http.js';import {readLock,checkoutDir} from '../scripts/upstream.mjs';
const lock=readLock(),entry=lock.components.find(c=>c.id==='last30days'),snapshot=JSON.parse(readFileSync(new URL('../upstreams/contracts/last30days.json',import.meta.url),'utf8'));
const py=(()=>{for(const p of ['python3','python']){try{execFileSync(p,['--version'],{stdio:'ignore'});return p;}catch{}}return null;})();
const probe=()=>'Python 3.12.0';
// Synthetic, independently written stand-in for a last30days checkout. Its engine echoes argv/env/cwd in "query"
// and sleeps when the topic says so, so tests can see exactly what JARVIS passes to the real engine.
const ENGINE=[
 'import json, os, sys, time',
 'a = sys.argv[1:]',
 'if a and a[0] == "sleep forever": time.sleep(60)',
 'if a and a[0] == "crash now": sys.stderr.write("boom\\n"); sys.exit(3)',
 'if a and a[0] == "not json": print("hello"); sys.exit(0)',
 'seen = {"argv": a, "cwd": os.getcwd(), "env": {k: os.environ.get(k) for k in ["HOME", "FROM_BROWSER", "LAST30DAYS_CONFIG_DIR", "OPENAI_API_KEY", "JARVIS_TEST_SECRET"]}}',
 'print(json.dumps({"schema_version": "1.4", "query": json.dumps(seen), "generated_at": "2026-10-12T00:00:00Z", "window_days": 30, "source_status": {"reddit": "ok"}, "freshness_verdicts": [], "clusters": [{"title": "c", "summary": "s", "sources": ["reddit"], "engagement_total": 3}], "results": [{"title": "t%d" % i, "source": "reddit", "url": "https://example.test/%d" % i, "summary": "x" * 900, "relevance_score": 0.5, "cluster": 0} for i in range(40)], "usage": None}))',
].join('\n')+'\n';
const ARGS=['--days','--emit','--mock','--no-browser-cookies','--quick','--search','--web-backend','--plan'].map(f=>'parser.add_argument("'+f+'")').join('\n');
function fakeCheckout({commit='a'.repeat(40),license='MIT License\n\nfixture\n',requires='>=3.12',engine=ENGINE,cli=ARGS+'\nparser.add_argument("--emit", choices=["json", "md"])\nparser.add_argument("--web-backend", choices=["auto", "none"])\n'}={}){
 const d=mkdtempSync(join(tmpdir(),'l30-fake-'));const w=(p,s)=>{mkdirSync(join(d,p,'..'),{recursive:true});writeFileSync(join(d,p),s);};
 for(const p of L30_REQUIRED_PATHS)w(p,'# fixture '+p+'\n');
 w('LICENSE',license);w('pyproject.toml','[project]\nversion = "0.0.1"\nrequires-python = "'+requires+'"\n');
 w('skills/last30days/SKILL.md','---\nname: last30days\nversion: "0.0.1"\ndescription: "fixture"\nlicense: MIT\n---\n# Fixture\n');
 w(L30_ENGINE,engine+'\n# '+cli.split('\n').join('\n# ')+'\n');
 w('skills/last30days/scripts/lib/pipeline.py','MOCK_AVAILABLE_SOURCES = [\n    "reddit",\n    "x",\n    "hackernews",\n    "polymarket",\n    "github",\n]\n');
 w('skills/last30days/scripts/lib/schema.py','AGENT_EXPORT_SCHEMA_VERSION = "1.4"\n');
 w('skills/last30days/scripts/lib/env.py','# LAST30DAYS_CONFIG_DIR clean mode\n# FROM_BROWSER=off disables\n');
 w('mcp/manifest.json','{"name":"fixture-mcp","version":"0.0.1","license":"MIT"}');w('mcp/go.mod','module example.test/fixture\n');
 writeFileSync(join(d,'.jarvis-upstream.json'),JSON.stringify({id:'last30days',commit}));return d;}

test('last30days lock: exact pin, MIT cleared, pin-fetch-only, sparse fetch without media, nothing upstream committed',()=>{
 assert.match(entry.commit,/^[0-9a-f]{40}$/);assert.equal(entry.policy,'pin-fetch-only');assert.equal(entry.license.spdx,'MIT');assert.match(entry.license.reuse,/^cleared/);
 assert.equal(entry.fetch.filter,'blob:none');for(const x of ['!/media/','!/skills/last30days/assets/'])assert.ok(entry.fetch.sparse.includes(x),x);
 assert.equal(entry.runtime.flag,'JARVIS_LAST30DAYS_ENABLED=1');
 assert.equal(snapshot.schema,'jarvis.last30days-contract/1');assert.deepEqual(snapshot.missingPaths,[]);assert.equal(snapshot.skill.name,'last30days');assert.equal(snapshot.license.spdx,'MIT');assert.equal(snapshot.package.requiresPython,'>=3.12');
 for(const f of L30_REQUIRED_FLAGS)assert.ok(snapshot.cli.flags.includes(f),f);for(const s of L30_KEYLESS_SOURCES)assert.ok(snapshot.sources.includes(s),s);
 assert.ok(snapshot.cli.emit.includes('json'));assert.ok(snapshot.cli.webBackends.includes('none'));assert.deepEqual(snapshot.privacy,{cleanConfigMode:true,fromBrowserOff:true});
 const files=execFileSync('git',['ls-files'],{encoding:'utf8'}).trim().split('\n').filter(f=>existsSync(f));const upstream=new Set(Object.values(snapshot.hashes));
 for(const f of files)assert.ok(!upstream.has(createHash('sha256').update(readFileSync(f)).digest('hex')),f+' is a copy of an upstream last30days file');
});
test('last30days contract: extraction, breaking vs informational diffs',()=>{
 const base=readLast30Checkout(fakeCheckout());assert.deepEqual(base.missingPaths,[]);assert.equal(base.license.spdx,'MIT');assert.deepEqual(base.cli.emit,['json','md']);assert.deepEqual(base.sources,['reddit','x','hackernews','polymarket','github']);assert.ok(diffLast30Contract(base,base).identical);
 const empty=diffLast30Contract(base,extractLast30Contract({}));assert.equal(empty.compatible,false);for(const b of ['skill name','LICENSE is no longer MIT','required path removed: LICENSE','required CLI flag removed: --no-browser-cookies','--emit json removed','keyless source removed: reddit','privacy switch removed: cleanConfigMode'])assert.ok(empty.breaking.some(x=>x.startsWith(b)),b);
 const noCookieFlag=readLast30Checkout(fakeCheckout({cli:'parser.add_argument("--emit", choices=["json"])\nparser.add_argument("--web-backend", choices=["none"])\n'}));assert.ok(diffLast30Contract(base,noCookieFlag).breaking.includes('required CLI flag removed: --no-browser-cookies'));
 assert.ok(diffLast30Contract(base,readLast30Checkout(fakeCheckout({license:'Proprietary\n'}))).breaking.some(b=>/no longer MIT/.test(b)));
 assert.ok(diffLast30Contract(base,readLast30Checkout(fakeCheckout({requires:'>=3.13'}))).breaking.includes('requires-python >=3.12 -> >=3.13'));
 assert.ok(diffLast30Contract(base,{...base,exportSchemaVersion:'2.0'}).breaking.some(b=>/export schema major/.test(b)));
 const drift=diffLast30Contract(base,{...base,exportSchemaVersion:'1.5',package:{...base.package,version:'9'},cli:{...base.cli,flags:[...base.cli.flags.filter(f=>f!=='--plan'),'--new-flag']},sources:[...base.sources.filter(s=>s!=='x'),'threads'],hashes:{...base.hashes,LICENSE:'0'}});
 assert.equal(drift.compatible,true);assert.equal(drift.identical,false);for(const c of ['json export schema 1.4 -> 1.5','version 0.0.1 -> 9','CLI flag removed: --plan','CLI flag added: --new-flag','source removed: x','source added: threads','content changed: LICENSE'])assert.ok(drift.changed.includes(c),c);
});
test('last30days load refuses missing checkout, wrong commit, broken contract and old python; config is keyless-only',()=>{
 const dir=fakeCheckout(),snap=readLast30Checkout(dir),a='a'.repeat(40);
 assert.throws(()=>loadLast30({dir:join(dir,'nope'),commit:a},snap,{probePython:probe}),{code:'last30days_missing'});
 assert.throws(()=>loadLast30({dir,commit:'b'.repeat(40)},snap,{probePython:probe}),{code:'last30days_pin'});
 assert.throws(()=>loadLast30({dir:fakeCheckout({license:'none\n'}),commit:a},snap,{probePython:probe}),{code:'last30days_contract'});
 assert.throws(()=>loadLast30({dir,commit:a},snap,{probePython:()=>'Python 3.11.9'}),{code:'last30days_python'});
 assert.throws(()=>loadLast30({dir,commit:a},snap,{probePython:()=>{throw Object.assign(new Error('x'),{code:'ENOENT'});}}),{code:'last30days_python'});
 const ok=loadLast30({dir,commit:a},snap,{probePython:probe});assert.equal(ok.summary().browserCookies,false);assert.equal(ok.summary().apiKeys,false);assert.equal(ok.summary().operation,L30_OPERATION);
 assert.ok(pythonSatisfies('Python 3.13.1','>=3.12'));assert.ok(pythonSatisfies('Python 4.0.0','>=3.12'));assert.ok(!pythonSatisfies('Python 3.9.2','>=3.12'));
 assert.equal(last30ConfigFromEnv({}),null);const cfg=last30ConfigFromEnv({JARVIS_LAST30DAYS_ENABLED:'1'},{root:'/r',lock:entry});assert.equal(cfg.dir,'/r/.jarvis/upstreams/last30days/'+entry.commit);assert.deepEqual(cfg.sources,[...L30_KEYLESS_SOURCES]);assert.equal(cfg.days,30);assert.equal(cfg.mock,false);
 assert.throws(()=>last30ConfigFromEnv({JARVIS_LAST30DAYS_ENABLED:'1',JARVIS_LAST30DAYS_SOURCES:'reddit,x'},{lock:entry}),{code:'last30days_config'});
 assert.throws(()=>last30ConfigFromEnv({JARVIS_LAST30DAYS_ENABLED:'1',JARVIS_LAST30DAYS_DAYS:'90'},{lock:entry}),{code:'last30days_config'});
});
test('engine invocation: --no-browser-cookies, keyless sources, scrubbed env, bounded output',()=>{
 const cfg={engine:'/e.py',sources:['reddit','hackernews'],days:7,mock:false};const a=engineArgs(cfg,'local-first sync');
 assert.deepEqual(a.slice(0,2),['/e.py','local-first sync']);for(const f of ['--no-browser-cookies','--quick','--emit'])assert.ok(a.includes(f),f);
 assert.equal(a[a.indexOf('--search')+1],'reddit,hackernews');assert.equal(a[a.indexOf('--web-backend')+1],'none');assert.equal(a[a.indexOf('--days')+1],'7');assert.ok(!a.includes('--mock'));assert.ok(engineArgs({...cfg,mock:true},'x y').includes('--mock'));
 for(const f of ['--publish','--publish-html','--store','--save-dir','--output','--corpus'])assert.ok(!a.includes(f),f);
 const env=engineEnv('/tmp/h',{PATH:'/bin',OPENAI_API_KEY:'k',XAI_API_KEY:'k',AUTH_TOKEN:'t',FROM_BROWSER:'auto',LAST30DAYS_CONFIG_DIR:'/home/u/.config/last30days',HOME:'/home/u',LANG:'C.UTF-8'});
 assert.deepEqual(Object.keys(env).sort(),['FROM_BROWSER','HOME','LANG','LAST30DAYS_CONFIG_DIR','NO_COLOR','PATH','PYTHONDONTWRITEBYTECODE','PYTHONIOENCODING','TMPDIR','USERPROFILE']);assert.equal(env.FROM_BROWSER,'off');assert.equal(env.LAST30DAYS_CONFIG_DIR,'');assert.equal(env.HOME,'/tmp/h');
 assert.equal(validateTopic('  ai   video  '),'ai video');for(const bad of ['x','-rf topic','y'.repeat(301),42])assert.throws(()=>validateTopic(bad),{code:'input'});
 const r=shapeReport(JSON.stringify({schema_version:'1.4',query:'q',generated_at:'g',window_days:30,source_status:{},clusters:[],results:Array.from({length:60},(_,i)=>({title:'t'+i,summary:'s'.repeat(2000),extra:'dropped'}))}),{maxResults:5});
 assert.equal(r.results.length,5);assert.equal(r.totalResults,60);assert.ok(r.results[0].summary.length<=600);assert.equal(r.results[0].extra,undefined);
 assert.throws(()=>shapeReport('nope'),{code:'last30days_output'});assert.throws(()=>shapeReport('{"query":"q"}'),{code:'last30days_output'});
});
test('engine child: runs in a throwaway HOME/cwd without keys, cookies or config; killed on abort/timeout; errors surface',{skip:py?false:'python not available'},async()=>{
 const dir=fakeCheckout(),snap=readLast30Checkout(dir);process.env.JARVIS_TEST_SECRET='must-not-leak';
 try{
  const l30=loadLast30({dir,commit:'a'.repeat(40),python:py,sources:['reddit','github'],maxResults:3},snap,{probePython:probe});
  const out=await l30.executor()({input:{text:'agent memory',timeoutMs:5000},signal:new AbortController().signal});
  assert.equal(out.executor,'last30days-research-v1');assert.equal(out.run.browserCookies,false);assert.equal(out.report.results.length,3);assert.equal(out.report.totalResults,40);assert.equal(out.engine.sha256,snap.hashes[L30_ENGINE]);
  const seen=JSON.parse(out.report.query);assert.equal(seen.argv[0],'agent memory');assert.ok(seen.argv.includes('--no-browser-cookies'));assert.equal(seen.argv[seen.argv.indexOf('--search')+1],'reddit,github');
  assert.deepEqual(seen.env,{HOME:seen.cwd,FROM_BROWSER:'off',LAST30DAYS_CONFIG_DIR:'',OPENAI_API_KEY:null,JARVIS_TEST_SECRET:null});assert.ok(seen.cwd.includes('jarvis-l30-'));assert.equal(existsSync(seen.cwd),false,'temp HOME removed');
  const ac=new AbortController(),t0=Date.now();setTimeout(()=>ac.abort(),300);await assert.rejects(runEngine(l30,'sleep forever',{signal:ac.signal,timeoutMs:8000}),{code:'last30days_aborted'});assert.ok(Date.now()-t0<5000);
  await assert.rejects(runEngine(l30,'sleep forever',{timeoutMs:400}),{code:'last30days_timeout'});
  await assert.rejects(runEngine(l30,'crash now',{}),e=>e.code==='last30days_exit'&&/boom/.test(e.message));
  await assert.rejects(l30.executor()({input:{text:'not json'},signal:new AbortController().signal}),{code:'last30days_output'});
  await assert.rejects(runEngine({...l30,python:'/nonexistent/python3'},'agent memory',{}),{code:'last30days_spawn'});
 }finally{delete process.env.JARVIS_TEST_SECRET;}
});
test('research.last30days task: off by default, ranked report when enabled, surfaced in health and /api/upstreams',{skip:py?false:'python not available'},async()=>{
 const off=adaptersFromEnv({});assert.equal(off.summary.last30days.enabled,false);assert.equal(off.executors[L30_OPERATION],undefined);
 assert.throws(()=>adaptersFromEnv({JARVIS_LAST30DAYS_ENABLED:'1',JARVIS_LAST30DAYS_DIR:'/nonexistent/l30'}),{code:'last30days_missing'});
 const dir=fakeCheckout(),snap=readLast30Checkout(dir),fakeLock=JSON.stringify({components:[{...entry,commit:'a'.repeat(40)}]});
 const readFile=(u,enc)=>String(u).endsWith('upstreams/lock.json')?fakeLock:String(u).endsWith('contracts/last30days.json')?JSON.stringify(snap):readFileSync(u,enc);
 const on=adaptersFromEnv({JARVIS_LAST30DAYS_ENABLED:'1',JARVIS_LAST30DAYS_DIR:dir,JARVIS_LAST30DAYS_PYTHON:py},{readFile,probePython:probe});
 assert.equal(on.summary.last30days.enabled,true);assert.equal(on.summary.last30days.inference,false);assert.equal(on.summary.last30days.browserCookies,false);assert.ok(on.executors[L30_OPERATION]);assert.ok(!JSON.stringify(on.summary).includes(dir));
 const actor={id:'o',tenant:'t',workspaces:['w'],capabilities:['text.digest',L30_OPERATION]};
 const plain=new Kernel();assert.throws(()=>plain.submit(actor,{workspace:'w',idempotencyKey:'r0',operation:L30_OPERATION,text:'agent memory'}),{code:'tool_denied'});await plain.close();
 const kernel=new Kernel({executors:on.executors});const t=kernel.submit(actor,{workspace:'w',idempotencyKey:'r1',operation:L30_OPERATION,text:'agent memory',timeoutMs:8000});
 assert.equal(t.routing.blocked,false);const done=await kernel.execute(actor,t.id);assert.equal(done.status,'succeeded',done.failure);assert.equal(done.result.report.results.length,25);assert.equal(done.result.engine.commit,'a'.repeat(40));
 const bad=kernel.submit(actor,{workspace:'w',idempotencyKey:'r2',operation:L30_OPERATION,text:'-x',timeoutMs:8000});assert.equal((await kernel.execute(actor,bad.id)).status,'failed');
 assert.throws(()=>kernel.submit({...actor,capabilities:['text.digest']},{workspace:'w',idempotencyKey:'r3',operation:L30_OPERATION,text:'agent memory'}),{code:'capability_denied'});
 const token='test-only-token-long-enough-l30d',server=createKernelServer({kernel,tokens:[{token,actor}],adapters:on});server.listen(0,'127.0.0.1');await once(server,'listening');const origin='http://127.0.0.1:'+server.address().port,get=p=>fetch(origin+p,{headers:{Authorization:'Bearer '+token}}).then(r=>r.json());
 try{assert.equal((await get('/api/health')).adapters.last30days,true);const u=await get('/api/upstreams');assert.equal(u.components.find(c=>c.id==='last30days').commit,entry.commit);assert.equal(u.adapters.last30days.operation,L30_OPERATION);}finally{await server.shutdown();}
});
const pinned=checkoutDir('last30days',entry.commit);
test('pinned upstream checkout matches the committed contract snapshot and its engine runs on --mock fixtures',{skip:existsSync(join(pinned,'.jarvis-upstream.json'))?false:'run npm run upstream:verify first (CI does)'},async t=>{
 const d=diffLast30Contract(snapshot,readLast30Checkout(pinned));assert.deepEqual(d.breaking,[]);assert.deepEqual(d.changed,[]);
 for(const p of ['media','skills/last30days/assets'])assert.equal(existsSync(join(pinned,p)),false,p+' must not be fetched');
 let l30;try{l30=loadLast30({dir:pinned,commit:entry.commit,python:process.env.JARVIS_LAST30DAYS_PYTHON||'python3',mock:true},snapshot);}catch(e){if(e.code==='last30days_python'){t.skip(e.message);return;}throw e;}
 assert.ok(l30.diff.identical);
 const out=await l30.executor()({input:{text:'AI video tools',timeoutMs:10000},signal:new AbortController().signal});
 assert.equal(out.run.mock,true);assert.equal(out.report.schema_version,snapshot.exportSchemaVersion);assert.equal(out.report.query,'AI video tools');assert.ok(out.report.results.length>=1);assert.ok(Object.keys(out.report.source_status).every(s=>L30_KEYLESS_SOURCES.includes(s)),JSON.stringify(out.report.source_status));
});
