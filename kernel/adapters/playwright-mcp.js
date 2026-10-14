// Playwright MCP adapter (browser automation through accessibility snapshots). OFF BY DEFAULT
// (JARVIS_PLAYWRIGHT_MCP_ENABLED=1). Upstream: https://github.com/microsoft/playwright-mcp, Apache-2.0, npm @playwright/mcp.
// JARVIS copies nothing: upstreams/lock.json pins the release commit and npm version, the operator installs that
// version (npm run mcp:playwright:install, or npm install @playwright/mcp@<pin>) plus a browser build, and the kernel
// launches the installed CLI as a kernel-owned stdio child per task, refusing it unless --version equals the pin.
//
// It drives a real browser, so the launch is locked down and not configurable away:
//   --headless (unless JARVIS_PLAYWRIGHT_MCP_HEADED=1), --isolated (in-memory profile, nothing persisted), a dedicated
//   --output-dir, --no-webmcp (pages cannot register tools), --image-responses omit, --codegen none, and an origin
//   allowlist that is REQUIRED (JARVIS_PLAYWRIGHT_MCP_ALLOWED_ORIGINS) unless the operator explicitly sets
//   JARVIS_PLAYWRIGHT_MCP_ALLOW_ALL_ORIGINS=1. Upstream warns the allowlist is not a security boundary (redirects are
//   not covered), so treat every page as untrusted input. --allow-unrestricted-file-access, --extension,
//   --cdp-endpoint, persistent profiles and --secrets are never passed.
// Only granted tools may be called. The default grant is read-mostly; code execution and file upload tools
// (browser_evaluate, browser_run_code_unsafe, browser_file_upload) are refused unless
// JARVIS_PLAYWRIGHT_MCP_ALLOW_UNSAFE_TOOLS=1.
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {execFileSync} from 'node:child_process';
import {existsSync,mkdirSync} from 'node:fs';
import {join,resolve,isAbsolute} from 'node:path';

export const PWM_ID='playwright-mcp';
export const PWM_OPERATION='mcp.playwright';
export const PWM_DEFAULT_TOOLS=Object.freeze(['browser_navigate','browser_navigate_back','browser_snapshot','browser_take_screenshot','browser_wait_for','browser_console_messages','browser_network_requests','browser_tabs','browser_close']);
export const PWM_UNSAFE_TOOLS=Object.freeze(['browser_evaluate','browser_run_code_unsafe','browser_file_upload']);
export const PWM_BROWSERS=Object.freeze(['chromium','chrome','firefox','webkit','msedge']);
export const PWM_MAX_STEPS=10;
// Operator install location used by npm run mcp:playwright:install (gitignored under .jarvis/).
export const pwmInstallDir=(root=process.cwd())=>join(root,'.jarvis/tools/playwright-mcp');
export const pwmDefaultBin=(root=process.cwd())=>join(pwmInstallDir(root),'node_modules/.bin/playwright-mcp');
export class PwmError extends Error{constructor(code,message,status=400){super(message);this.code=code;this.status=status;}}
const fail=(code,message,status)=>{throw new PwmError(code,message,status);};

// Child env from scratch: no JARVIS_* secrets or tokens leak into the browser process. LD_LIBRARY_PATH and
// PLAYWRIGHT_BROWSERS_PATH pass through for hosts with extracted browser libraries or a non-default browser cache.
export function pwmEnv({base=process.env}={}){
 const env={};for(const k of ['PATH','HOME','USERPROFILE','SystemRoot','TEMP','TMP','LANG','LD_LIBRARY_PATH','PLAYWRIGHT_BROWSERS_PATH','DISPLAY','WAYLAND_DISPLAY','XDG_RUNTIME_DIR'])if(base[k])env[k]=base[k];
 return env;
}

export function pwmArgs(cfg){
 const a=['--isolated','--browser',cfg.browser,'--output-dir',cfg.outputDir,'--no-webmcp','--image-responses','omit','--codegen','none'];
 if(!cfg.headed)a.unshift('--headless');
 if(cfg.allowedOrigins.length)a.push('--allowed-origins',cfg.allowedOrigins.join(';'));
 if(cfg.blockedOrigins.length)a.push('--blocked-origins',cfg.blockedOrigins.join(';'));
 if(cfg.noSandbox)a.push('--no-sandbox');
 return a;
}

export function installedVersion(bin){
 try{const out=execFileSync(bin,['--version'],{encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:20000});return /(\d+\.\d+\.\d+)/.exec(out)?.[1]??null;}catch{return null;}
}

const ORIGIN=/^https?:\/\/(\*\.)?[A-Za-z0-9.-]+(:\d{1,5})?$/;
const origins=(name,v)=>{const list=(v??'').split(';').map(s=>s.trim()).filter(Boolean);for(const o of list)if(!ORIGIN.test(o))fail('playwright_mcp_config','Invalid origin in '+name+': '+o.slice(0,80)+' (scheme://host[:port], ; separated)');return list;};

//   JARVIS_PLAYWRIGHT_MCP_ENABLED=1                       required opt-in
//   JARVIS_PLAYWRIGHT_MCP_BIN=<abs path>                  installed playwright-mcp CLI (default: .jarvis/tools install, else PATH)
//   JARVIS_PLAYWRIGHT_MCP_ALLOWED_ORIGINS=https://a;...   origin allowlist, required unless ..._ALLOW_ALL_ORIGINS=1
//   JARVIS_PLAYWRIGHT_MCP_ALLOW_ALL_ORIGINS=1             explicit opt-out of the allowlist
//   JARVIS_PLAYWRIGHT_MCP_BLOCKED_ORIGINS=https://b;...   origin blocklist (evaluated first)
//   JARVIS_PLAYWRIGHT_MCP_OUTPUT_DIR=<abs>                screenshots/downloads (default: .jarvis/playwright-mcp/output)
//   JARVIS_PLAYWRIGHT_MCP_BROWSER=chromium                chromium|chrome|firefox|webkit|msedge
//   JARVIS_PLAYWRIGHT_MCP_HEADED=1                        show the browser window (default headless)
//   JARVIS_PLAYWRIGHT_MCP_NO_SANDBOX=1                    containers without user namespaces only
//   JARVIS_PLAYWRIGHT_MCP_TOOLS=browser_navigate,...      grant list
//   JARVIS_PLAYWRIGHT_MCP_ALLOW_UNSAFE_TOOLS=1            permit granting evaluate / run_code_unsafe / file_upload
//   JARVIS_PLAYWRIGHT_MCP_TIMEOUT_MS=10000                per task (all steps), 5000..120000; kernel tasks are also
//                                                         bounded by their own timeoutMs (max 10 s) and abort signal
export function pwmConfigFromEnv(env=process.env,{lock,root=process.cwd()}={}){
 if(env.JARVIS_PLAYWRIGHT_MCP_ENABLED!=='1')return null;
 const pin=lock?.runtime?.package?.version;
 if(!pin)fail('playwright_mcp_config','playwright-mcp package pin missing from upstreams/lock.json');
 const abs=(n,v)=>{if(v===undefined||v==='')return undefined;if(!isAbsolute(v))fail('playwright_mcp_config',n+' must be an absolute path');return resolve(v);};
 const tools=(env.JARVIS_PLAYWRIGHT_MCP_TOOLS??PWM_DEFAULT_TOOLS.join(',')).split(',').map(s=>s.trim()).filter(Boolean);
 for(const t of tools)if(!/^[A-Za-z0-9_.-]{1,64}$/.test(t))fail('playwright_mcp_config','Invalid tool name in JARVIS_PLAYWRIGHT_MCP_TOOLS');
 const unsafe=tools.filter(t=>PWM_UNSAFE_TOOLS.includes(t));
 if(unsafe.length&&env.JARVIS_PLAYWRIGHT_MCP_ALLOW_UNSAFE_TOOLS!=='1')fail('playwright_mcp_config','Granting '+unsafe.join(', ')+' runs page code or reads local files; set JARVIS_PLAYWRIGHT_MCP_ALLOW_UNSAFE_TOOLS=1 to accept that');
 const allowedOrigins=origins('JARVIS_PLAYWRIGHT_MCP_ALLOWED_ORIGINS',env.JARVIS_PLAYWRIGHT_MCP_ALLOWED_ORIGINS),blockedOrigins=origins('JARVIS_PLAYWRIGHT_MCP_BLOCKED_ORIGINS',env.JARVIS_PLAYWRIGHT_MCP_BLOCKED_ORIGINS);
 const allowAll=env.JARVIS_PLAYWRIGHT_MCP_ALLOW_ALL_ORIGINS==='1';
 if(!allowedOrigins.length&&!allowAll)fail('playwright_mcp_config','JARVIS_PLAYWRIGHT_MCP_ALLOWED_ORIGINS is required (or set JARVIS_PLAYWRIGHT_MCP_ALLOW_ALL_ORIGINS=1 to browse any origin)');
 if(allowedOrigins.length&&allowAll)fail('playwright_mcp_config','Set either JARVIS_PLAYWRIGHT_MCP_ALLOWED_ORIGINS or JARVIS_PLAYWRIGHT_MCP_ALLOW_ALL_ORIGINS=1, not both');
 const browser=env.JARVIS_PLAYWRIGHT_MCP_BROWSER||'chromium';
 if(!PWM_BROWSERS.includes(browser))fail('playwright_mcp_config','JARVIS_PLAYWRIGHT_MCP_BROWSER must be one of '+PWM_BROWSERS.join(', '));
 const local=pwmDefaultBin(root);
 return {bin:abs('JARVIS_PLAYWRIGHT_MCP_BIN',env.JARVIS_PLAYWRIGHT_MCP_BIN)??(existsSync(local)?local:'playwright-mcp'),
  outputDir:abs('JARVIS_PLAYWRIGHT_MCP_OUTPUT_DIR',env.JARVIS_PLAYWRIGHT_MCP_OUTPUT_DIR)??join(root,'.jarvis/playwright-mcp/output'),
  browser,headed:env.JARVIS_PLAYWRIGHT_MCP_HEADED==='1',noSandbox:env.JARVIS_PLAYWRIGHT_MCP_NO_SANDBOX==='1',allowedOrigins,blockedOrigins,allowAllOrigins:allowAll,
  pin,commit:lock.commit,tools,timeoutMs:Math.min(Math.max(Number(env.JARVIS_PLAYWRIGHT_MCP_TIMEOUT_MS)||10000,5000),120000),base:env};
}

async function withChild(cfg,fn,signal){
 mkdirSync(cfg.outputDir,{recursive:true});
 if(signal?.aborted)fail('playwright_mcp_cancelled','playwright-mcp task cancelled before launch',499);
 const client=new Client({name:'jarvis-kernel',version:'0.3.0'});
 // cwd = output dir: upstream resolves explicitly named files against the workspace root (cwd when no roots are set).
 const transport=new StdioClientTransport({command:cfg.bin,args:pwmArgs(cfg),env:pwmEnv({base:cfg.base}),cwd:cfg.outputDir,stderr:'pipe'});
 let pid,value,error,server=null;
 // The kernel's deadline/cancel signal closes the transport, which ends the child and its browser.
 const onAbort=()=>{client.close().catch(()=>{});};signal?.addEventListener('abort',onAbort,{once:true});
 try{await client.connect(transport,{timeout:cfg.timeoutMs,signal});pid=transport.pid;server=client.getServerVersion()??null;value=await fn(client);}catch(e){error=e;}
 finally{signal?.removeEventListener('abort',onAbort);pid??=transport.pid;try{await client.close();}catch{}try{if(pid)process.kill(pid,0)&&process.kill(pid,'SIGTERM');}catch{}}
 let alive=false;try{if(pid){process.kill(pid,0);alive=true;}}catch{}
 const cleanup={state:alive?'quarantined':'confirmed',pid:pid??null,kind:'kernel-owned playwright-mcp stdio child (isolated browser profile)'};
 if(error)throw Object.assign(error instanceof PwmError?error:new PwmError('playwright_mcp_protocol','playwright-mcp failed: '+String(error.message).slice(0,300)),{cleanup});
 return {value,server,cleanup};
}

const clip=p=>p.type==='text'?{type:'text',text:String(p.text).slice(0,16000)}:{type:p.type};

export class PwmConnector{
 constructor(cfg,version){this.cfg=cfg;this.version=version;}
 async discover(){const {value,server,cleanup}=await withChild(this.cfg,c=>c.listTools({},{timeout:this.cfg.timeoutMs}));return {server,tools:value.tools.map(t=>t.name),cleanup};}
 checkSteps(steps){
  if(!Array.isArray(steps)||steps.length<1||steps.length>PWM_MAX_STEPS)fail('playwright_mcp_arguments','steps must be 1..'+PWM_MAX_STEPS+' tool calls');
  return steps.map(s=>{
   if(!s||typeof s!=='object'||typeof s.tool!=='string')fail('playwright_mcp_arguments','each step needs a tool name');
   if(!this.cfg.tools.includes(s.tool))fail('playwright_mcp_grant','Tool '+s.tool+' is not in the playwright-mcp grant list',403);
   const args=s.arguments??{};if(!args||typeof args!=='object'||Array.isArray(args))fail('playwright_mcp_arguments','Tool arguments must be an object');
   return {tool:s.tool,arguments:args};
  });
 }
 // All steps share one isolated browser session (one child); the profile is discarded when the child exits.
 async run(steps,{signal}={}){
  const plan=this.checkSteps(steps),deadline=Date.now()+this.cfg.timeoutMs;
  const {value,server,cleanup}=await withChild(this.cfg,async c=>{const out=[];for(const s of plan){const left=deadline-Date.now();if(left<=0)fail('playwright_mcp_timeout','playwright-mcp task deadline exceeded',504);const r=await c.callTool({name:s.tool,arguments:s.arguments},undefined,{timeout:left,signal});out.push({tool:s.tool,isError:Boolean(r.isError),content:(r.content??[]).map(clip)});if(r.isError)break;}return out;},signal);
  return {steps:value,isError:value.some(s=>s.isError),server,version:this.version,cleanup};
 }
 call(name,args={}){return this.run([{tool:name,arguments:args}]);}
 // Task text: JSON {"steps":[{"tool","arguments"}...]} or {"tool","arguments"}; a bare http(s) URL navigates to it.
 executor(){return async({input,signal})=>{let req;try{req=JSON.parse(input.text);}catch{const url=String(input.text).trim();if(!/^https?:\/\/\S+$/.test(url))fail('playwright_mcp_arguments','Task text must be JSON steps or an http(s) URL');req={tool:'browser_navigate',arguments:{url}};}
  const steps=Array.isArray(req?.steps)?req.steps:[req];return {executor:'playwright-mcp-v1',...await this.run(steps,{signal})};};}
 summary(){return {enabled:true,version:this.version,pin:this.cfg.pin,commit:this.cfg.commit,tools:this.cfg.tools,operation:PWM_OPERATION,kernelOwnedProcess:true,headless:!this.cfg.headed,isolatedProfile:true,browser:this.cfg.browser,allowedOrigins:this.cfg.allowAllOrigins?'*':this.cfg.allowedOrigins,license:'Apache-2.0'};}
}

export function loadPwm(cfg,{versionOf=installedVersion}={}){
 const hint='install with: npm run mcp:playwright:install (or npm install @playwright/mcp@'+cfg.pin+' and npx playwright-mcp install-browser chrome-for-testing)';
 if(isAbsolute(cfg.bin)&&!existsSync(cfg.bin))fail('playwright_mcp_missing','playwright-mcp not found at '+cfg.bin+'; '+hint);
 const v=versionOf(cfg.bin);
 if(!v)fail('playwright_mcp_missing','playwright-mcp did not report a version; '+hint);
 if(v!==cfg.pin)fail('playwright_mcp_pin','installed playwright-mcp '+v+' is not the pinned '+cfg.pin+'; run: npm run mcp:playwright:install',409);
 return new PwmConnector(cfg,v);
}
