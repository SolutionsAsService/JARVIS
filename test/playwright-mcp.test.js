import test from 'node:test';import assert from 'node:assert/strict';
import {existsSync,mkdtempSync} from 'node:fs';import {once} from 'node:events';import {createServer} from 'node:http';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {pwmConfigFromEnv,loadPwm,pwmEnv,pwmArgs,PWM_OPERATION,PWM_DEFAULT_TOOLS,PWM_UNSAFE_TOOLS} from '../kernel/adapters/playwright-mcp.js';
import {installPlan} from '../scripts/install-playwright-mcp.mjs';
import {adaptersFromEnv} from '../kernel/startup.js';import {Kernel} from '../kernel/kernel.js';import {createKernelServer} from '../kernel/http.js';import {readLock} from '../scripts/upstream.mjs';
const entry=readLock().components.find(c=>c.id==='playwright-mcp');
const ON={JARVIS_PLAYWRIGHT_MCP_ENABLED:'1',JARVIS_PLAYWRIGHT_MCP_ALLOWED_ORIGINS:'https://example.com'};
test('playwright-mcp lock: release commit + npm pin, Apache-2.0, nothing vendored',()=>{
 assert.match(entry.commit,/^[0-9a-f]{40}$/);assert.equal(entry.policy,'pin-only');assert.equal(entry.contract,null);assert.equal(entry.license.spdx,'Apache-2.0');
 assert.equal(entry.runtime.package.registry,'npm');assert.equal(entry.runtime.package.name,'@playwright/mcp');assert.match(entry.runtime.package.version,/^\d+\.\d+\.\d+$/);
 assert.equal(existsSync(new URL('../vendor/playwright-mcp',import.meta.url)),false);
 const plan=installPlan([],{root:'/r'});assert.equal(plan.spec,'@playwright/mcp@'+entry.runtime.package.version);assert.equal(plan.bin,'/r/.jarvis/tools/playwright-mcp/node_modules/.bin/playwright-mcp');assert.equal(plan.browser,'chrome-for-testing');
 assert.equal(installPlan(['--no-browser'],{root:'/r'}).browser,null);assert.throws(()=>installPlan(['--browser','lynx'],{root:'/r'}));assert.throws(()=>installPlan(['--dir','rel'],{root:'/r'}));
});
test('playwright-mcp adapter: off by default, origin allowlist required, unsafe tools refused, pin enforced',()=>{
 const off=adaptersFromEnv({});assert.deepEqual(off.summary.playwrightMcp,{enabled:false});assert.equal(off.executors[PWM_OPERATION],undefined);
 assert.equal(pwmConfigFromEnv({}),null);
 assert.throws(()=>pwmConfigFromEnv(ON,{lock:{}}),{code:'playwright_mcp_config'});
 assert.throws(()=>pwmConfigFromEnv({JARVIS_PLAYWRIGHT_MCP_ENABLED:'1'},{lock:entry}),/ALLOWED_ORIGINS is required/);
 assert.throws(()=>pwmConfigFromEnv({...ON,JARVIS_PLAYWRIGHT_MCP_ALLOW_ALL_ORIGINS:'1'},{lock:entry}),{code:'playwright_mcp_config'});
 assert.throws(()=>pwmConfigFromEnv({...ON,JARVIS_PLAYWRIGHT_MCP_ALLOWED_ORIGINS:'example.com'},{lock:entry}),{code:'playwright_mcp_config'});
 assert.throws(()=>pwmConfigFromEnv({...ON,JARVIS_PLAYWRIGHT_MCP_BIN:'rel/bin'},{lock:entry}),{code:'playwright_mcp_config'});
 assert.throws(()=>pwmConfigFromEnv({...ON,JARVIS_PLAYWRIGHT_MCP_BROWSER:'lynx'},{lock:entry}),{code:'playwright_mcp_config'});
 for(const u of PWM_UNSAFE_TOOLS)assert.throws(()=>pwmConfigFromEnv({...ON,JARVIS_PLAYWRIGHT_MCP_TOOLS:'browser_navigate,'+u},{lock:entry}),/ALLOW_UNSAFE_TOOLS/);
 assert.deepEqual(pwmConfigFromEnv({...ON,JARVIS_PLAYWRIGHT_MCP_TOOLS:'browser_evaluate',JARVIS_PLAYWRIGHT_MCP_ALLOW_UNSAFE_TOOLS:'1'},{lock:entry}).tools,['browser_evaluate']);
 const all=pwmConfigFromEnv({JARVIS_PLAYWRIGHT_MCP_ENABLED:'1',JARVIS_PLAYWRIGHT_MCP_ALLOW_ALL_ORIGINS:'1'},{lock:entry,root:'/r'});assert.equal(all.allowAllOrigins,true);assert.ok(!pwmArgs(all).includes('--allowed-origins'));
 const cfg=pwmConfigFromEnv({...ON,JARVIS_PLAYWRIGHT_MCP_BLOCKED_ORIGINS:'https://ads.example.com'},{lock:entry,root:'/r'});
 assert.deepEqual(cfg.tools,[...PWM_DEFAULT_TOOLS]);assert.equal(cfg.pin,entry.runtime.package.version);assert.equal(cfg.outputDir,'/r/.jarvis/playwright-mcp/output');assert.equal(cfg.bin,'playwright-mcp');
 for(const t of PWM_UNSAFE_TOOLS)assert.ok(!cfg.tools.includes(t),t+' must not be granted by default');
 const args=pwmArgs(cfg);for(const f of ['--headless','--isolated','--no-webmcp'])assert.ok(args.includes(f),f);
 assert.deepEqual(args.slice(args.indexOf('--allowed-origins'),args.indexOf('--allowed-origins')+2),['--allowed-origins','https://example.com']);assert.ok(args.includes('--blocked-origins'));
 for(const f of ['--allow-unrestricted-file-access','--extension','--cdp-endpoint','--user-data-dir','--secrets','--no-sandbox'])assert.ok(!args.includes(f),f);
 assert.ok(!pwmArgs({...cfg,headed:true}).includes('--headless'));
 assert.throws(()=>loadPwm({...cfg,bin:'/nonexistent/playwright-mcp'}),{code:'playwright_mcp_missing'});
 assert.throws(()=>loadPwm(cfg,{versionOf:()=>null}),{code:'playwright_mcp_missing'});
 assert.throws(()=>loadPwm(cfg,{versionOf:()=>'0.0.1'}),{code:'playwright_mcp_pin'});
 const c=loadPwm(cfg,{versionOf:()=>cfg.pin});const s=c.summary();assert.equal(s.enabled,true);assert.equal(s.operation,PWM_OPERATION);assert.equal(s.headless,true);assert.equal(s.isolatedProfile,true);assert.deepEqual(s.allowedOrigins,['https://example.com']);
 assert.throws(()=>c.checkSteps([{tool:'browser_run_code_unsafe',arguments:{}}]),{code:'playwright_mcp_grant'});
 assert.throws(()=>c.checkSteps([]),{code:'playwright_mcp_arguments'});assert.throws(()=>c.checkSteps(Array(11).fill({tool:'browser_snapshot'})),{code:'playwright_mcp_arguments'});
 assert.throws(()=>c.checkSteps([{tool:'browser_snapshot',arguments:[]}]),{code:'playwright_mcp_arguments'});
 const env=pwmEnv({base:{PATH:'/b',HOME:'/h',LD_LIBRARY_PATH:'/l',JARVIS_SECRET:'x',GITHUB_TOKEN:'t',JARVIS_AUTHEO_PRIVATE_KEY_FILE:'/k'}});assert.deepEqual(env,{PATH:'/b',HOME:'/h',LD_LIBRARY_PATH:'/l'});
 return assert.rejects(c.executor()({input:{text:'not a url'}}),{code:'playwright_mcp_arguments'});
});
// Live: needs the pinned package and a browser build (npm run mcp:playwright:install). Browses a local page only.
const BIN=process.env.JARVIS_PLAYWRIGHT_MCP_BIN;
test('installed playwright-mcp browses an allowed local page as a kernel-owned child for mcp.playwright tasks',{skip:BIN&&existsSync(BIN)?false:'set JARVIS_PLAYWRIGHT_MCP_BIN to an installed playwright-mcp at the pinned version (npm run mcp:playwright:install)',timeout:120000},async()=>{
 const page=createServer((req,res)=>{res.setHeader('Content-Type','text/html');res.end('<title>JARVIS probe</title><h1>Hello from the JARVIS probe</h1>');});page.listen(0,'127.0.0.1');await once(page,'listening');const origin='http://127.0.0.1:'+page.address().port;
 const out=mkdtempSync(join(tmpdir(),'jarvis-pwm-'));
 const on=adaptersFromEnv({JARVIS_PLAYWRIGHT_MCP_ENABLED:'1',JARVIS_PLAYWRIGHT_MCP_BIN:BIN,JARVIS_PLAYWRIGHT_MCP_ALLOWED_ORIGINS:origin,JARVIS_PLAYWRIGHT_MCP_OUTPUT_DIR:out,...Object.fromEntries(['PATH','HOME','LD_LIBRARY_PATH','PLAYWRIGHT_BROWSERS_PATH'].filter(k=>process.env[k]).map(k=>[k,process.env[k]]))});
 assert.equal(on.summary.playwrightMcp.enabled,true);
 try{
  const found=await on.playwrightMcp.discover();assert.ok(found.tools.includes('browser_navigate'));assert.ok(found.tools.includes('browser_snapshot'));assert.equal(found.cleanup.state,'confirmed');
  const actor={id:'o',tenant:'t',workspaces:['w'],capabilities:['text.digest',PWM_OPERATION]};const kernel=new Kernel({executors:on.executors});
  const t=kernel.submit(actor,{workspace:'w',idempotencyKey:'p1',operation:PWM_OPERATION,text:JSON.stringify({steps:[{tool:'browser_navigate',arguments:{url:origin+'/'}},{tool:'browser_snapshot',arguments:{}}]}),timeoutMs:10000});
  const done=await kernel.execute(actor,t.id);assert.equal(done.status,'succeeded',done.failure);assert.equal(done.result.executor,'playwright-mcp-v1');assert.equal(done.result.isError,false,JSON.stringify(done.result.steps).slice(0,600));
  assert.match(JSON.stringify(done.result.steps),/Hello from the JARVIS probe/);assert.equal(done.result.cleanup.state,'confirmed');
  // An origin outside the allowlist is blocked by the browser (upstream: not a security boundary, redirects are not covered).
  const other=createServer((req,res)=>res.end('forbidden page'));other.listen(0,'127.0.0.1');await once(other,'listening');
  try{const b=await on.playwrightMcp.run([{tool:'browser_navigate',arguments:{url:'http://127.0.0.1:'+other.address().port+'/'}}]);assert.equal(b.isError,true);assert.match(JSON.stringify(b.steps),/ERR_BLOCKED_BY_CLIENT/);assert.doesNotMatch(JSON.stringify(b.steps),/forbidden page/);}finally{other.close();}
  const token='test-only-token-long-enough-pwm',server=createKernelServer({kernel,tokens:[{token,actor}],adapters:on});server.listen(0,'127.0.0.1');await once(server,'listening');
  try{const h=await fetch('http://127.0.0.1:'+server.address().port+'/api/health',{headers:{Authorization:'Bearer '+token}}).then(r=>r.json());assert.equal(h.adapters.playwrightMcp,true);}finally{await server.shutdown();}
 }finally{page.close();}
});
