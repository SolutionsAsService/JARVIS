import test from 'node:test';import assert from 'node:assert/strict';
import {existsSync,readFileSync,mkdtempSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';import {createHash} from 'node:crypto';import {execFileSync} from 'node:child_process';import {once} from 'node:events';
import {gmMcpEnv,gmMcpConfigFromEnv,diffGmMcpContract,loadGmMcp,toolsSchemaHash,canonical,GM_MCP_LOCKDOWN,GM_MCP_OPERATION,GM_MCP_CONTRACT_SCHEMA} from '../kernel/adapters/gm-mcp.js';
import {adaptersFromEnv,upstreamPin} from '../kernel/startup.js';import {Kernel} from '../kernel/kernel.js';import {createKernelServer} from '../kernel/http.js';import {readLock,checkoutDir,CONTRACTS} from '../scripts/upstream.mjs';
const lock=readLock(),entry=lock.components.find(c=>c.id==='gm-mcp'),snapshot=JSON.parse(readFileSync(new URL('../upstreams/contracts/gm-mcp.json',import.meta.url),'utf8'));
const clone=v=>JSON.parse(JSON.stringify(v));

test('gm-mcp lock: exact pin on main, contract registered, license not cleared, bundle not committed',()=>{
 assert.match(entry.commit,/^[0-9a-f]{40}$/);assert.equal(entry.branch,'main');assert.equal(entry.repo,'https://github.com/SolutionsAsService/gm-mcp');assert.equal(entry.policy,'pin-fetch-launch');
 assert.equal(entry.license.spdx,null);assert.match(entry.license.reuse,/not cleared/);assert.equal(entry.contract,'upstreams/contracts/gm-mcp.json');assert.ok(CONTRACTS['gm-mcp']);
 assert.equal(snapshot.schema,GM_MCP_CONTRACT_SCHEMA);assert.match(snapshot.entrySha256,/^[0-9a-f]{64}$/);assert.ok(snapshot.tools.some(t=>t.name==='gm_codemode'&&t.required.includes('code')));
 for(const [k,ok] of Object.entries(snapshot.lockdownSwitches))assert.equal(ok,true,k);assert.deepEqual(Object.keys(snapshot.lockdownSwitches).sort(),Object.keys(GM_MCP_LOCKDOWN).sort());
 const files=execFileSync('git',['ls-files'],{encoding:'utf8'}).trim().split('\n').filter(f=>existsSync(f));
 for(const f of files)assert.notEqual(createHash('sha256').update(readFileSync(f)).digest('hex'),snapshot.entrySha256,f+' is a copy of the gm-mcp bundle');
 const cad=lock.components.find(c=>c.id==='unified-cad-mcp');assert.equal(cad.policy,'pin-only');assert.equal(cad.contract,null);assert.match(cad.commit,/^[0-9a-f]{40}$/);
});

test('gm-mcp adapter is off by default and refuses bad configuration',()=>{
 const off=adaptersFromEnv({});assert.equal(off.gmMcp,null);assert.deepEqual(off.summary.gmMcp,{enabled:false});assert.equal(off.executors[GM_MCP_OPERATION],undefined);
 assert.equal(gmMcpConfigFromEnv({}),null);
 assert.throws(()=>gmMcpConfigFromEnv({JARVIS_GM_MCP_ENABLED:'1'},{lock:{}}),{code:'gm_mcp_config'});
 assert.throws(()=>gmMcpConfigFromEnv({JARVIS_GM_MCP_ENABLED:'1',JARVIS_GM_MCP_DIR:'relative/dir'},{lock:entry}),{code:'gm_mcp_config'});
 assert.throws(()=>gmMcpConfigFromEnv({JARVIS_GM_MCP_ENABLED:'1',JARVIS_GM_MCP_TOOLS:'gm_codemode,bad tool'},{lock:entry}),{code:'gm_mcp_config'});
 const cfg=gmMcpConfigFromEnv({JARVIS_GM_MCP_ENABLED:'1',JARVIS_GM_MCP_TIMEOUT_MS:'999999'},{root:'/r',lock:entry});assert.equal(cfg.dir,join('/r/.jarvis/upstreams/gm-mcp',entry.commit));assert.equal(cfg.timeoutMs,120000);assert.deepEqual(cfg.tools,['gm_codemode']);assert.equal(cfg.allowRunnerSpawn,false);
 assert.throws(()=>adaptersFromEnv({JARVIS_GM_MCP_ENABLED:'1',JARVIS_GM_MCP_DIR:'/nonexistent/gm-mcp'}),{code:'gm_mcp_checkout'});
 const empty=mkdtempSync(join(tmpdir(),'gm-mcp-'));assert.throws(()=>loadGmMcp({dir:empty,commit:entry.commit},snapshot),{code:'gm_mcp_pin'});
 assert.equal(upstreamPin('gm-mcp').entry.commit,entry.commit);assert.throws(()=>upstreamPin('nope'),/no nope/);
});

test('gm-mcp child environment: fresh env, every background mechanism switched off, no JARVIS secrets',()=>{
 const base={PATH:'/bin',HOME:'/h',JARVIS_AUTHEO_PRIVATE_KEY_FILE:'/secret',GM_MCP_SELF_UPDATE:'1',GITHUB_TOKEN:'x'};
 const env=gmMcpEnv({stateDir:'/s',projectRoot:'/p',base});
 for(const [k,v] of Object.entries(GM_MCP_LOCKDOWN))assert.equal(env[k],v,k);
 assert.equal(env.PATH,'/bin');assert.equal(env.GM_MCP_DEFAULT_CWD,'/p');assert.equal(env.AGENTPLUG_HOME,'/s/agentplug');assert.equal(env.GM_TOOLS_DIR,'/s/gm-tools');
 for(const k of Object.keys(env))assert.ok(!k.startsWith('JARVIS_')&&k!=='GITHUB_TOKEN',k);
 const spawn=gmMcpEnv({stateDir:'/s',allowRunnerSpawn:true,base});assert.equal(spawn.GM_MCP_RUNNER_WATCHDOG,undefined);assert.equal(spawn.GM_MCP_DAEMON_RESPAWN,undefined);assert.equal(spawn.GM_MCP_SELF_UPDATE,'0');
 assert.throws(()=>gmMcpEnv({}),{code:'gm_mcp_config'});
});

test('gm-mcp contract diff: breaking vs re-pin-only changes',()=>{
 assert.deepEqual(diffGmMcpContract(snapshot,clone(snapshot)),{breaking:[],changed:[],compatible:true,identical:true});
 const removed=clone(snapshot);removed.tools=removed.tools.filter(t=>t.name!=='gm_codemode');assert.match(diffGmMcpContract(snapshot,removed).breaking.join(),/required tool gm_codemode removed/);
 const req=clone(snapshot);req.tools.find(t=>t.name==='gm_codemode').required.push('token');assert.match(diffGmMcpContract(snapshot,req).breaking.join(),/new required argument token/);
 const arg=clone(snapshot);arg.tools.find(t=>t.name==='gm_codemode').properties=['code'];assert.match(diffGmMcpContract(snapshot,arg).breaking.join(),/argument cwd removed/);
 const lost=clone(snapshot);lost.lockdownSwitches.GM_MCP_SELF_UPDATE=false;assert.match(diffGmMcpContract(snapshot,lost).breaking.join(),/GM_MCP_SELF_UPDATE/);
 const grown=clone(snapshot);grown.tools.push({name:'gm_new',required:[],properties:[],inputSchemaSha256:'0'.repeat(64)});grown.entrySha256='1'.repeat(64);grown.toolsSchemaHash='2'.repeat(64);
 const d=diffGmMcpContract(snapshot,grown);assert.equal(d.compatible,true);assert.equal(d.identical,false);assert.ok(d.changed.includes('tool added: gm_new'));
 assert.equal(canonical({b:1,a:[{d:1,c:2}]}),'{"a":[{"c":2,"d":1}],"b":1}');
 assert.equal(toolsSchemaHash([{name:'b',inputSchema:{x:1}},{name:'a'}]),toolsSchemaHash([{name:'a'},{name:'b',inputSchema:{x:1}}]));
});

const pinned=checkoutDir('gm-mcp',entry.commit);
test('pinned gm-mcp runs as a kernel-owned child: contract identical, mcp.gm.codemode task, health + /api/upstreams',{skip:existsSync(join(pinned,'.jarvis-upstream.json'))?false:'run npm run upstream:verify first (CI does)',timeout:60000},async()=>{
 const contract=await CONTRACTS['gm-mcp'].read(pinned);assert.deepEqual(diffGmMcpContract(snapshot,contract),{breaking:[],changed:[],compatible:true,identical:true});
 const stateDir=mkdtempSync(join(tmpdir(),'gm-mcp-state-'));
 const on=adaptersFromEnv({JARVIS_GM_MCP_ENABLED:'1',JARVIS_GM_MCP_DIR:pinned,JARVIS_GM_MCP_STATE_DIR:stateDir});
 assert.equal(on.summary.gmMcp.enabled,true);assert.equal(on.summary.gmMcp.commit,entry.commit);assert.equal(on.summary.gmMcp.runnerSpawn,false);assert.equal(on.summary.gmMcp.kernelOwnedProcess,true);
 const found=await on.gmMcp.discover();assert.equal(found.matchesPin,true);assert.equal(found.cleanup.state,'confirmed');
 await assert.rejects(on.gmMcp.call('gm',{verb:'bash'}),{code:'gm_mcp_grant'});
 const actor={id:'o',tenant:'t',workspaces:['w'],capabilities:['text.digest',GM_MCP_OPERATION]};
 const plain=new Kernel();assert.throws(()=>plain.submit(actor,{workspace:'w',idempotencyKey:'g0',operation:GM_MCP_OPERATION,text:'return 1'}),{code:'tool_denied'});await plain.close();
 const kernel=new Kernel({executors:on.executors});
 assert.throws(()=>kernel.submit({...actor,capabilities:['text.digest']},{workspace:'w',idempotencyKey:'g1',operation:GM_MCP_OPERATION,text:'return 1'}),{code:'capability_denied'});
 const t=kernel.submit(actor,{workspace:'w',idempotencyKey:'g2',operation:GM_MCP_OPERATION,text:'return await gm.list()',timeoutMs:10000});
 const done=await kernel.execute(actor,t.id);assert.equal(done.status,'succeeded',done.failure);assert.equal(done.result.executor,'gm-mcp-codemode-v1');assert.equal(done.result.isError,false);assert.equal(done.result.commit,entry.commit);
 assert.match(done.result.content.map(c=>c.text).join(''),/gm_codemode|gm_instruction/);assert.equal(done.cleanup.state,'confirmed');assert.equal(done.cleanup.kind,'kernel-owned gm-mcp stdio child');
 const token='test-only-token-long-enough-gmmcp',server=createKernelServer({kernel,tokens:[{token,actor}],adapters:on});server.listen(0,'127.0.0.1');await once(server,'listening');
 const origin='http://127.0.0.1:'+server.address().port,get=p=>fetch(origin+p,{headers:{Authorization:'Bearer '+token}}).then(r=>r.json());
 try{assert.equal((await get('/api/health')).adapters.gmMcp,true);const u=await get('/api/upstreams');assert.equal(u.components.find(c=>c.id==='gm-mcp').commit,entry.commit);assert.equal(u.adapters.gmMcp.operation,GM_MCP_OPERATION);assert.ok(u.components.some(c=>c.id==='unified-cad-mcp'));}
 finally{await server.shutdown();}
});
