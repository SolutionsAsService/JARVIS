import test from 'node:test';import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';import {once} from 'node:events';
import {jcmConfigFromEnv,loadJcm,jcmEnv,JCM_OPERATION,JCM_DEFAULT_TOOLS} from '../kernel/adapters/jcodemunch.js';
import {adaptersFromEnv} from '../kernel/startup.js';import {Kernel} from '../kernel/kernel.js';import {createKernelServer} from '../kernel/http.js';import {readLock} from '../scripts/upstream.mjs';
const entry=readLock().components.find(c=>c.id==='jcodemunch');
test('jcodemunch lock: commit + PyPI pin, dual-use licence not cleared, nothing vendored',()=>{
 assert.match(entry.commit,/^[0-9a-f]{40}$/);assert.equal(entry.policy,'pin-only');assert.equal(entry.contract,null);assert.equal(entry.license.spdx,null);
 assert.match(entry.license.finding,/Dual-Use License/);assert.match(entry.license.reuse,/not cleared/);assert.match(entry.runtime.package.version,/^\d+\.\d+\.\d+$/);
 assert.equal(existsSync(new URL('../vendor/jcodemunch',import.meta.url)),false);
});
test('jcodemunch adapter: off by default, config validation, version pin enforced, clean child env',()=>{
 const off=adaptersFromEnv({});assert.deepEqual(off.summary.jcodemunch,{enabled:false});assert.equal(off.executors[JCM_OPERATION],undefined);
 assert.equal(jcmConfigFromEnv({}),null);
 assert.throws(()=>jcmConfigFromEnv({JARVIS_JCODEMUNCH_ENABLED:'1'},{lock:{}}),{code:'jcodemunch_config'});
 assert.throws(()=>jcmConfigFromEnv({JARVIS_JCODEMUNCH_ENABLED:'1',JARVIS_JCODEMUNCH_BIN:'rel/bin'},{lock:entry}),{code:'jcodemunch_config'});
 assert.throws(()=>jcmConfigFromEnv({JARVIS_JCODEMUNCH_ENABLED:'1',JARVIS_JCODEMUNCH_TOOLS:'route,bad tool'},{lock:entry}),{code:'jcodemunch_config'});
 const cfg=jcmConfigFromEnv({JARVIS_JCODEMUNCH_ENABLED:'1'},{lock:entry});assert.deepEqual(cfg.tools,[...JCM_DEFAULT_TOOLS]);assert.equal(cfg.pin,entry.runtime.package.version);
 assert.throws(()=>loadJcm({...cfg,bin:'/nonexistent/jcodemunch-mcp'}),{code:'jcodemunch_missing'});
 assert.throws(()=>loadJcm(cfg,{versionOf:()=>'0.0.1'}),{code:'jcodemunch_pin'});
 const c=loadJcm(cfg,{versionOf:()=>cfg.pin});assert.equal(c.summary().enabled,true);assert.equal(c.summary().operation,JCM_OPERATION);
 return assert.rejects(c.call('index_folder',{}),{code:'jcodemunch_grant'}).then(()=>{
  const env=jcmEnv({indexDir:'/i',base:{PATH:'/b',HOME:'/h',JARVIS_SECRET:'x',GITHUB_TOKEN:'t'}});assert.deepEqual(env,{PATH:'/b',HOME:'/h',CODE_INDEX_PATH:'/i'});
 });
});
const BIN=process.env.JARVIS_JCODEMUNCH_BIN;
test('installed jcodemunch runs as a kernel-owned child for mcp.jcodemunch tasks',{skip:BIN&&existsSync(BIN)?false:'set JARVIS_JCODEMUNCH_BIN to an installed jcodemunch-mcp at the pinned version',timeout:60000},async()=>{
 const on=adaptersFromEnv({JARVIS_JCODEMUNCH_ENABLED:'1',JARVIS_JCODEMUNCH_BIN:BIN,PATH:process.env.PATH});assert.equal(on.summary.jcodemunch.enabled,true);
 const found=await on.jcodemunch.discover();assert.ok(found.tools.includes('route'));assert.equal(found.cleanup.state,'confirmed');
 const actor={id:'o',tenant:'t',workspaces:['w'],capabilities:['text.digest',JCM_OPERATION]};const kernel=new Kernel({executors:on.executors});
 const t=kernel.submit(actor,{workspace:'w',idempotencyKey:'j1',operation:JCM_OPERATION,text:JSON.stringify({tool:'jcodemunch_guide',arguments:{}}),timeoutMs:10000});
 const done=await kernel.execute(actor,t.id);assert.equal(done.status,'succeeded',done.failure);assert.equal(done.result.executor,'jcodemunch-mcp-v1');assert.equal(done.result.isError,false);
 const token='test-only-token-long-enough-jcm',server=createKernelServer({kernel,tokens:[{token,actor}],adapters:on});server.listen(0,'127.0.0.1');await once(server,'listening');
 try{const h=await fetch('http://127.0.0.1:'+server.address().port+'/api/health',{headers:{Authorization:'Bearer '+token}}).then(r=>r.json());assert.equal(h.adapters.jcodemunch,true);}finally{await server.shutdown();}
});
