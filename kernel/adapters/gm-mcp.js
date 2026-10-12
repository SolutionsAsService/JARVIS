// gm-mcp adapter. Independently authored, MIT. OFF BY DEFAULT (JARVIS_GM_MCP_ENABLED=1).
// Upstream: https://github.com/SolutionsAsService/gm-mcp (fork of https://github.com/AnEntrypoint/gm-mcp).
// The repository has no LICENSE file (package.json says MIT; GitHub reports none, 2026-10-12), so JARVIS copies
// none of its code. It pins a commit in upstreams/lock.json, fetches that commit on demand into
// .jarvis/upstreams/gm-mcp/<sha> (scripts/upstream.mjs) and launches the pre-bundled, dependency-free
// bin/gm-mcp-server.js from there as a kernel-owned stdio child through the official MCP SDK.
//
// Ownership rules (docs/PLAN.md: one scheduler, one execution owner):
//  - the launched bundle is refused unless its checkout HEAD is the pinned commit and its sha256 equals the
//    committed contract snapshot (upstreams/contracts/gm-mcp.json);
//  - every gm-mcp background mechanism that would outlive or replace the child is switched off through the
//    upstream's own env switches (GM_MCP_LOCKDOWN): no self-update, no bundle hot swap, no detached HTTP
//    singleton/supervisor, no release bridge, no dev-sync, and no agentplug runner (re)spawn or watchdog;
//  - the live tools/list schema hash must equal the snapshot before any call (schema drift = no call), and only
//    tools named in the grant list may be called (default: gm_codemode);
//  - one child per call; it is terminated and its exit is confirmed before the result is returned.
// gm verbs that dispatch through the gm spool need an agentplug runner daemon. JARVIS never starts one by
// default; JARVIS_GM_MCP_ALLOW_RUNNER_SPAWN=1 lets gm-mcp start it, and that detached daemon is NOT
// supervised by the kernel. gm.list()/gm.describe() are answered by gm-mcp itself and need no daemon.
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {readFileSync,existsSync,mkdirSync,mkdtempSync,rmSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {join,resolve,isAbsolute} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';

export const GM_MCP_ID='gm-mcp';
export const GM_MCP_ENTRY='bin/gm-mcp-server.js';
export const GM_MCP_CONTRACT_SCHEMA='jarvis.gm-mcp-contract/1';
// Upstream env switches (names read from src/{singleton,self-update,bundle-drift,release-bridge,dev-sync,dispatch}.js
// at the pinned commit). Their presence in the bundle is part of the contract: a removal is a breaking change.
export const GM_MCP_LOCKDOWN=Object.freeze({GM_MCP_NO_HTTP_SINGLETON:'1',GM_MCP_HTTP_SUPERVISOR:'0',GM_MCP_SELF_UPDATE:'0',GM_MCP_NO_SELF_UPDATE:'1',GM_MCP_BUNDLE_DRIFT_RELOAD:'0',GM_MCP_RELEASE_BRIDGE:'0',GM_MCP_DEV_SYNC:'0',GM_MCP_RUNNER_WATCHDOG:'0',GM_MCP_DAEMON_RESPAWN:'0',AGENTPLUG_NO_SELF_UPDATE:'1'});
const RUNNER_SWITCHES=['GM_MCP_RUNNER_WATCHDOG','GM_MCP_DAEMON_RESPAWN'];
// Tools JARVIS calls. Their removal, or a new required argument, is a breaking change.
export const GM_MCP_REQUIRED_TOOLS=Object.freeze(['gm_codemode']);
export const GM_MCP_OPERATION='mcp.gm.codemode';

export class GmMcpError extends Error{constructor(code,message,status=400){super(message);this.code=code;this.status=status;}}
const fail=(code,message,status)=>{throw new GmMcpError(code,message,status);};
const sha=b=>createHash('sha256').update(b).digest('hex');
// Stable JSON (sorted object keys) so a schema hash does not depend on property order.
export const canonical=v=>Array.isArray(v)?'['+v.map(canonical).join(',')+']':v&&typeof v==='object'?'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}':JSON.stringify(v);
export const toolsSchemaHash=tools=>sha(canonical([...tools].map(t=>({name:t.name,inputSchema:t.inputSchema??null})).sort((a,b)=>a.name<b.name?-1:a.name>b.name?1:0)));

// Child environment: built from scratch (no JARVIS_* secrets, no inherited GM_MCP_* overrides) plus lockdown.
export function gmMcpEnv({stateDir,projectRoot,agentplugHome,allowRunnerSpawn=false,base=process.env}={}){
 if(!stateDir)fail('gm_mcp_config','stateDir required');
 const env={};for(const k of ['PATH','HOME','USERPROFILE','SystemRoot','TEMP','TMP','LANG'])if(base[k])env[k]=base[k];
 Object.assign(env,GM_MCP_LOCKDOWN);
 env.GM_MCP_LOG_PATH=join(stateDir,'gm-mcp-server.log');
 env.AGENTPLUG_HOME=agentplugHome??join(stateDir,'agentplug');
 if(allowRunnerSpawn){for(const k of RUNNER_SWITCHES)delete env[k];}else env.GM_TOOLS_DIR=join(stateDir,'gm-tools');
 if(projectRoot)env.GM_MCP_DEFAULT_CWD=projectRoot;
 return env;
}

const pidAlive=pid=>{if(!pid)return false;try{process.kill(pid,0);return true;}catch{return false;}};
// Spawn the pinned bundle, run fn(client), then terminate and confirm exit. Returns {value,cleanup,server}.
export async function withGmMcp(entryPath,{env,cwd,timeoutMs=15000,signal}={},fn){
 const deadline=Date.now()+timeoutMs,left=()=>Math.max(1,deadline-Date.now());
 const client=new Client({name:'jarvis-kernel',version:'0.3.0'});
 const transport=new StdioClientTransport({command:process.execPath,args:[entryPath],env,cwd,stderr:'pipe'});
 let stderr='';transport.stderr?.on('data',d=>{if(stderr.length<8192)stderr+=d;});
 let pid,value,error,server=null;
 try{await client.connect(transport,{timeout:left(),signal});pid=transport.pid;server=client.getServerVersion()??null;value=await fn(client,{left,signal});}
 catch(e){error=e;}
 finally{pid??=transport.pid;if(pidAlive(pid)){try{process.kill(pid,'SIGTERM');}catch{}}try{await client.close();}catch{}try{await transport.close();}catch{}}
 let alive=pidAlive(pid);if(alive){await new Promise(r=>setTimeout(r,300));alive=pidAlive(pid);}
 const cleanup={state:alive?'quarantined':'confirmed',pid:pid??null,kind:'kernel-owned gm-mcp stdio child'};
 if(alive)fail('gm_mcp_cleanup','gm-mcp child '+pid+' did not exit',500);
 if(error){if(error instanceof GmMcpError)throw Object.assign(error,{cleanup});const aborted=signal?.aborted;throw Object.assign(new GmMcpError(aborted?'gm_mcp_aborted':'gm_mcp_protocol',(aborted?'gm-mcp call aborted: ':'gm-mcp failed: ')+String(error.message).slice(0,300)+(stderr&&!aborted?' | stderr: '+stderr.slice(-300):'')),{cleanup});}
 return {value,cleanup,server,stderr};
}

export function bundleFacts(dir){
 dir=resolve(dir);const entry=join(dir,GM_MCP_ENTRY);if(!existsSync(entry))fail('gm_mcp_checkout','Missing '+GM_MCP_ENTRY+' in '+dir);
 const bytes=readFileSync(entry),text=bytes.toString('utf8');
 let pkg={};try{pkg=JSON.parse(readFileSync(join(dir,'package.json'),'utf8'));}catch{}
 return {entry,entrySha256:sha(bytes),bundleVersion:/BUNDLE_VERSION\s*=\s*["']([^"']+)["']/.exec(text)?.[1]??null,package:{name:pkg.name??null,version:pkg.version??null},lockdownSwitches:Object.fromEntries(Object.keys(GM_MCP_LOCKDOWN).map(k=>[k,text.includes(k)]))};
}

// Pure: bundle facts + discovered tools -> JSON-stable contract (what JARVIS depends on).
export function gmMcpContract(facts,{server,tools}){
 const list=[...tools].sort((a,b)=>a.name<b.name?-1:1).map(t=>({name:t.name,required:[...(t.inputSchema?.required??[])].sort(),properties:Object.keys(t.inputSchema?.properties??{}).sort(),inputSchemaSha256:sha(canonical(t.inputSchema??null))}));
 return {schema:GM_MCP_CONTRACT_SCHEMA,entry:GM_MCP_ENTRY,entrySha256:facts.entrySha256,bundleVersion:facts.bundleVersion,package:facts.package,server:{name:server?.name??null,version:server?.version??null},lockdownSwitches:facts.lockdownSwitches,requiredTools:[...GM_MCP_REQUIRED_TOOLS],tools:list,toolsSchemaHash:toolsSchemaHash(tools)};
}

// Launch a checkout in a throwaway state dir and extract its contract (used by scripts/upstream.mjs).
export async function readGmMcpCheckout(dir,{timeoutMs=20000}={}){
 const facts=bundleFacts(dir),state=mkdtempSync(join(tmpdir(),'jarvis-gm-mcp-contract-'));
 try{const {value,server}=await withGmMcp(facts.entry,{env:gmMcpEnv({stateDir:state}),cwd:state,timeoutMs},c=>c.listTools());return gmMcpContract(facts,{server,tools:value.tools});}
 finally{rmSync(state,{recursive:true,force:true});}
}

// snapshot -> current. breaking = JARVIS would stop working or lose a lockdown guarantee; changed = re-pin needed.
export function diffGmMcpContract(snap,cur){
 const breaking=[],changed=[];
 if(cur.schema!==GM_MCP_CONTRACT_SCHEMA)breaking.push('contract schema '+cur.schema);
 if(cur.package?.name!==snap.package?.name)breaking.push('package name '+snap.package?.name+' -> '+cur.package?.name);
 for(const [k,ok] of Object.entries(cur.lockdownSwitches??{}))if(!ok)breaking.push('lockdown switch '+k+' no longer present in bundle');
 const byName=new Map(cur.tools.map(t=>[t.name,t])),before=new Map(snap.tools.map(t=>[t.name,t]));
 for(const name of GM_MCP_REQUIRED_TOOLS){const a=before.get(name),b=byName.get(name);if(!b){breaking.push('required tool '+name+' removed');continue;}if(!a)continue;for(const r of b.required)if(!a.required.includes(r))breaking.push(name+': new required argument '+r);for(const p of a.properties)if(!b.properties.includes(p))breaking.push(name+': argument '+p+' removed');}
 for(const n of before.keys())if(!byName.has(n)&&!GM_MCP_REQUIRED_TOOLS.includes(n))changed.push('tool removed: '+n);
 for(const n of byName.keys())if(!before.has(n))changed.push('tool added: '+n);
 for(const [n,t] of byName)if(before.has(n)&&before.get(n).inputSchemaSha256!==t.inputSchemaSha256)changed.push('tool schema changed: '+n);
 if(snap.entrySha256!==cur.entrySha256)changed.push('bundle sha256 '+String(snap.entrySha256).slice(0,12)+' -> '+String(cur.entrySha256).slice(0,12));
 if(snap.bundleVersion!==cur.bundleVersion)changed.push('bundle version '+snap.bundleVersion+' -> '+cur.bundleVersion);
 if(snap.toolsSchemaHash!==cur.toolsSchemaHash)changed.push('tools schema hash changed (grant moves with the re-pin)');
 return {breaking,changed,compatible:breaking.length===0,identical:breaking.length===0&&changed.length===0};
}

// Env-configured connector; null (disabled) unless JARVIS_GM_MCP_ENABLED=1.
//   JARVIS_GM_MCP_ENABLED=1                required opt-in
//   JARVIS_GM_MCP_DIR=<checkout>           default .jarvis/upstreams/gm-mcp/<pinned sha> (npm run upstream -- fetch gm-mcp)
//   JARVIS_GM_MCP_PROJECT_ROOT=<abs path>  project gm dispatches run in (passed as cwd / GM_MCP_DEFAULT_CWD)
//   JARVIS_GM_MCP_STATE_DIR=<abs path>     logs + isolated agentplug/gm-tools dirs; default .jarvis/gm-mcp
//   JARVIS_GM_MCP_AGENTPLUG_HOME=<path>    use an existing agentplug home (e.g. ~/.agentplug) to reach a running daemon
//   JARVIS_GM_MCP_ALLOW_RUNNER_SPAWN=1     let gm-mcp start the agentplug runner daemon (detached, NOT kernel-supervised)
//   JARVIS_GM_MCP_TOOLS=gm_codemode        comma list of callable tools (grant list)
//   JARVIS_GM_MCP_TIMEOUT_MS=15000         per-call budget (connect + list + call), capped by the task deadline
export function gmMcpConfigFromEnv(env=process.env,{root=process.cwd(),lock}={}){
 if(env.JARVIS_GM_MCP_ENABLED!=='1')return null;
 if(!lock?.commit||!/^[0-9a-f]{40}$/.test(lock.commit))fail('gm_mcp_config','gm-mcp pin missing from upstreams/lock.json');
 const abs=(name,v)=>{if(v===undefined||v==='')return undefined;if(!isAbsolute(v))fail('gm_mcp_config',name+' must be an absolute path');return resolve(v);};
 const tools=(env.JARVIS_GM_MCP_TOOLS??GM_MCP_REQUIRED_TOOLS.join(',')).split(',').map(s=>s.trim()).filter(Boolean);
 for(const t of tools)if(!/^[A-Za-z0-9_.-]{1,64}$/.test(t))fail('gm_mcp_config','Invalid tool name in JARVIS_GM_MCP_TOOLS');
 return {dir:abs('JARVIS_GM_MCP_DIR',env.JARVIS_GM_MCP_DIR)??join(root,'.jarvis/upstreams',GM_MCP_ID,lock.commit),commit:lock.commit,projectRoot:abs('JARVIS_GM_MCP_PROJECT_ROOT',env.JARVIS_GM_MCP_PROJECT_ROOT),stateDir:abs('JARVIS_GM_MCP_STATE_DIR',env.JARVIS_GM_MCP_STATE_DIR)??join(root,'.jarvis/gm-mcp'),agentplugHome:abs('JARVIS_GM_MCP_AGENTPLUG_HOME',env.JARVIS_GM_MCP_AGENTPLUG_HOME),allowRunnerSpawn:env.JARVIS_GM_MCP_ALLOW_RUNNER_SPAWN==='1',tools,timeoutMs:Math.min(Math.max(Number(env.JARVIS_GM_MCP_TIMEOUT_MS)||15000,1000),120000)};
}

const gitHead=dir=>{try{return execFileSync('git',['-C',dir,'rev-parse','HEAD'],{encoding:'utf8',stdio:['ignore','pipe','ignore'],timeout:10000}).trim();}catch{return null;}};

export class GmMcpConnector{
 constructor(cfg,snapshot){this.cfg=cfg;this.snapshot=snapshot;this.facts=bundleFacts(cfg.dir);this.calls=0;}
 // Re-checked before every launch: the file on disk must still be the pinned bundle.
 assertPinned(){const facts=bundleFacts(this.cfg.dir);if(facts.entrySha256!==this.snapshot.entrySha256)fail('gm_mcp_pin','gm-mcp bundle sha256 '+facts.entrySha256.slice(0,12)+' does not match the pinned contract '+String(this.snapshot.entrySha256).slice(0,12),409);return facts;}
 env(){mkdirSync(this.cfg.stateDir,{recursive:true});return gmMcpEnv(this.cfg);}
 async discover({signal}={}){const facts=this.assertPinned();const {value,cleanup,server}=await withGmMcp(facts.entry,{env:this.env(),cwd:this.cfg.projectRoot??this.cfg.stateDir,timeoutMs:this.cfg.timeoutMs,signal},c=>c.listTools({}, {timeout:this.cfg.timeoutMs,signal}));const hash=toolsSchemaHash(value.tools);return {server,tools:value.tools.map(t=>({name:t.name,inputSchema:t.inputSchema})),toolsSchemaHash:hash,matchesPin:hash===this.snapshot.toolsSchemaHash,cleanup};}
 async call(name,args,{signal,timeoutMs=this.cfg.timeoutMs,maxText=16000}={}){
  if(!this.cfg.tools.includes(name))fail('gm_mcp_grant','Tool '+name+' is not in the gm-mcp grant list',403);
  if(!args||typeof args!=='object'||Array.isArray(args))fail('gm_mcp_arguments','Tool arguments must be an object');
  const facts=this.assertPinned();this.calls++;
  const {value,cleanup,server}=await withGmMcp(facts.entry,{env:this.env(),cwd:this.cfg.projectRoot??this.cfg.stateDir,timeoutMs:Math.min(timeoutMs,this.cfg.timeoutMs),signal},async(c,{left})=>{
   const listed=await c.listTools({}, {timeout:left(),signal});const hash=toolsSchemaHash(listed.tools);
   if(hash!==this.snapshot.toolsSchemaHash)fail('gm_mcp_schema_drift','Live gm-mcp tool schemas differ from the pinned contract; re-pin with npm run upstream -- update gm-mcp',409);
   const result=await c.callTool({name,arguments:args},undefined,{timeout:left(),signal});return {result,hash};});
  let truncated=false;const content=(value.result.content??[]).map(p=>{if(p.type==='text'&&typeof p.text==='string'&&p.text.length>maxText){truncated=true;return {type:'text',text:p.text.slice(0,maxText)};}return p.type==='text'?{type:'text',text:p.text}:{type:p.type};});
  return {tool:name,isError:Boolean(value.result.isError),content,truncated,toolsSchemaHash:value.hash,server,commit:this.cfg.commit,cleanup};
 }
 // Kernel executor for the mcp.gm.codemode operation: task text is the gm_codemode JavaScript body.
 executor(){return async({input,signal})=>{const r=await this.call('gm_codemode',{code:input.text,...(this.cfg.projectRoot?{cwd:this.cfg.projectRoot}:{})},{signal,timeoutMs:Math.max(1000,(input.timeoutMs??10000)-250)});return {executor:'gm-mcp-codemode-v1',...r};};}
 summary(){return {enabled:true,commit:this.cfg.commit,bundleVersion:this.facts.bundleVersion,entrySha256:this.facts.entrySha256,tools:this.cfg.tools,operation:GM_MCP_OPERATION,projectRoot:this.cfg.projectRoot??null,runnerSpawn:this.cfg.allowRunnerSpawn,kernelOwnedProcess:true};}
}

// Sync load: refuse a checkout that is not the pinned commit / bundle, or that lost a lockdown switch.
export function loadGmMcp(cfg,snapshot){
 if(!existsSync(cfg.dir))fail('gm_mcp_checkout','gm-mcp checkout missing at '+cfg.dir+'; run npm run upstream -- fetch gm-mcp');
 const head=gitHead(cfg.dir);if(head!==cfg.commit)fail('gm_mcp_pin','gm-mcp checkout HEAD '+head+' is not the pinned commit '+cfg.commit,409);
 const facts=bundleFacts(cfg.dir);
 const missing=Object.entries(facts.lockdownSwitches).filter(([,ok])=>!ok).map(([k])=>k);if(missing.length)fail('gm_mcp_lockdown','gm-mcp bundle lacks lockdown switches: '+missing.join(', '),409);
 const connector=new GmMcpConnector(cfg,snapshot);connector.assertPinned();return connector;
}
