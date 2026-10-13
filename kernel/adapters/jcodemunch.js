// jCodeMunch MCP adapter (token-efficient code retrieval). OFF BY DEFAULT (JARVIS_JCODEMUNCH_ENABLED=1).
// Upstream: https://github.com/jgravelle/jcodemunch-mcp — "jCodeMunch-MCP Dual-Use License" v1.1 (c) J. Gravelle:
// free for personal/academic/non-commercial use; commercial use needs a paid licence; republishing to package
// registries is not allowed. JARVIS therefore copies nothing: upstreams/lock.json pins the repo commit and the
// PyPI version, the operator installs it (uv tool install jcodemunch-mcp==<pin>), and the kernel launches that
// installed binary as a kernel-owned stdio child per call, refusing it unless --version equals the pin.
// Only granted tools may be called (default: the adaptive-tier entry points route, menu, jcodemunch_guide).
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {execFileSync} from 'node:child_process';
import {existsSync,mkdirSync} from 'node:fs';
import {join,resolve,isAbsolute} from 'node:path';

export const JCM_ID='jcodemunch';
export const JCM_OPERATION='mcp.jcodemunch';
export const JCM_DEFAULT_TOOLS=Object.freeze(['route','menu','jcodemunch_guide']);
export class JcmError extends Error{constructor(code,message,status=400){super(message);this.code=code;this.status=status;}}
const fail=(code,message,status)=>{throw new JcmError(code,message,status);};

// Child env from scratch: no JARVIS_* secrets or tokens leak into the tool.
export function jcmEnv({indexDir,base=process.env}={}){
 const env={};for(const k of ['PATH','HOME','USERPROFILE','SystemRoot','TEMP','TMP','LANG'])if(base[k])env[k]=base[k];
 if(indexDir)env.CODE_INDEX_PATH=indexDir;
 return env;
}

export function installedVersion(bin){
 try{const out=execFileSync(bin,['--version'],{encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:20000});return /(\d+\.\d+\.\d+)/.exec(out)?.[1]??null;}catch{return null;}
}

//   JARVIS_JCODEMUNCH_ENABLED=1           required opt-in
//   JARVIS_JCODEMUNCH_BIN=<abs path>      installed jcodemunch-mcp executable (default: jcodemunch-mcp on PATH)
//   JARVIS_JCODEMUNCH_INDEX_DIR=<abs>     index location passed as CODE_INDEX_PATH (default: tool default ~/.code-index)
//   JARVIS_JCODEMUNCH_TOOLS=route,menu    grant list
//   JARVIS_JCODEMUNCH_TIMEOUT_MS=20000    per call
export function jcmConfigFromEnv(env=process.env,{lock}={}){
 if(env.JARVIS_JCODEMUNCH_ENABLED!=='1')return null;
 const pin=lock?.runtime?.package?.version;
 if(!pin)fail('jcodemunch_config','jcodemunch package pin missing from upstreams/lock.json');
 const abs=(n,v)=>{if(v===undefined||v==='')return undefined;if(!isAbsolute(v))fail('jcodemunch_config',n+' must be an absolute path');return resolve(v);};
 const tools=(env.JARVIS_JCODEMUNCH_TOOLS??JCM_DEFAULT_TOOLS.join(',')).split(',').map(s=>s.trim()).filter(Boolean);
 for(const t of tools)if(!/^[A-Za-z0-9_.-]{1,64}$/.test(t))fail('jcodemunch_config','Invalid tool name in JARVIS_JCODEMUNCH_TOOLS');
 return {bin:abs('JARVIS_JCODEMUNCH_BIN',env.JARVIS_JCODEMUNCH_BIN)??'jcodemunch-mcp',indexDir:abs('JARVIS_JCODEMUNCH_INDEX_DIR',env.JARVIS_JCODEMUNCH_INDEX_DIR),pin,commit:lock.commit,tools,timeoutMs:Math.min(Math.max(Number(env.JARVIS_JCODEMUNCH_TIMEOUT_MS)||20000,1000),120000)};
}

async function withChild(cfg,fn){
 if(cfg.indexDir)mkdirSync(cfg.indexDir,{recursive:true});
 const client=new Client({name:'jarvis-kernel',version:'0.3.0'});
 const transport=new StdioClientTransport({command:cfg.bin,args:['serve'],env:jcmEnv(cfg),stderr:'pipe'});
 let pid,value,error,server=null;
 try{await client.connect(transport,{timeout:cfg.timeoutMs});pid=transport.pid;server=client.getServerVersion()??null;value=await fn(client);}catch(e){error=e;}
 finally{pid??=transport.pid;try{await client.close();}catch{}try{if(pid)process.kill(pid,0)&&process.kill(pid,'SIGTERM');}catch{}}
 let alive=false;try{if(pid){process.kill(pid,0);alive=true;}}catch{}
 const cleanup={state:alive?'quarantined':'confirmed',pid:pid??null,kind:'kernel-owned jcodemunch stdio child'};
 if(error)throw Object.assign(error instanceof JcmError?error:new JcmError('jcodemunch_protocol','jcodemunch failed: '+String(error.message).slice(0,300)),{cleanup});
 return {value,server,cleanup};
}

export class JcmConnector{
 constructor(cfg,version){this.cfg=cfg;this.version=version;}
 async discover(){const {value,server,cleanup}=await withChild(this.cfg,c=>c.listTools({},{timeout:this.cfg.timeoutMs}));return {server,tools:value.tools.map(t=>t.name),cleanup};}
 async call(name,args={}){
  if(!this.cfg.tools.includes(name))fail('jcodemunch_grant','Tool '+name+' is not in the jcodemunch grant list',403);
  if(!args||typeof args!=='object'||Array.isArray(args))fail('jcodemunch_arguments','Tool arguments must be an object');
  const {value,server,cleanup}=await withChild(this.cfg,c=>c.callTool({name,arguments:args},undefined,{timeout:this.cfg.timeoutMs}));
  const content=(value.content??[]).map(p=>p.type==='text'?{type:'text',text:String(p.text).slice(0,16000)}:{type:p.type});
  return {tool:name,isError:Boolean(value.isError),content,server,version:this.version,cleanup};
 }
 // Task text is JSON {"tool": "...", "arguments": {...}}; plain text is sent to route({task}).
 executor(){return async({input})=>{let req;try{req=JSON.parse(input.text);}catch{req={tool:'route',arguments:{task:input.text}};}return {executor:'jcodemunch-mcp-v1',...await this.call(req.tool,req.arguments??{})};};}
 summary(){return {enabled:true,version:this.version,pin:this.cfg.pin,commit:this.cfg.commit,tools:this.cfg.tools,operation:JCM_OPERATION,kernelOwnedProcess:true,license:'dual-use: non-commercial free, commercial licence required'};}
}

export function loadJcm(cfg,{versionOf=installedVersion}={}){
 if(isAbsolute(cfg.bin)&&!existsSync(cfg.bin))fail('jcodemunch_missing','jcodemunch-mcp not found at '+cfg.bin+'; install with: uv tool install jcodemunch-mcp=='+cfg.pin);
 const v=versionOf(cfg.bin);
 if(!v)fail('jcodemunch_missing','jcodemunch-mcp did not report a version; install with: uv tool install jcodemunch-mcp=='+cfg.pin);
 if(v!==cfg.pin)fail('jcodemunch_pin','installed jcodemunch-mcp '+v+' is not the pinned '+cfg.pin+'; run: uv tool install --force jcodemunch-mcp=='+cfg.pin,409);
 return new JcmConnector(cfg,v);
}
