// Kernel startup adapter wiring from environment flags. Every adapter is OFF unless explicitly enabled.
// Adapters can observe and record, never admit, schedule or veto kernel work (see kernel.js).
//
// Autheo receipt ledger (kernel/adapters/autheo.js):
//   JARVIS_AUTHEO_ENABLED=1                 record a signed Autheo receipt per governance outcome
//   JARVIS_AUTHEO_ENVIRONMENT=env:default   receipt audience / ledger environment id
//   JARVIS_AUTHEO_ISSUER=jarvis-local-authority
//   JARVIS_AUTHEO_PRIVATE_KEY_FILE=<pkcs8 pem>  optional; otherwise an ephemeral key (lost on restart)
//   JARVIS_AUTHEO_KID=<kid>                 optional; default local-<fingerprint16> for a file key, demo-v1 if ephemeral
//   JARVIS_AUTHEO_FORMAT=v1|legacy-0.1      default v1
//   JARVIS_AUTHEO_OUTCOMES=0                disable outcome_report receipts for terminal tasks (v1 only)
// Autheo loopback API client (kernel/adapters/autheo-client.js): JARVIS_AUTHEO_API_* (see that file).
// Paperclip governance mirror (kernel/adapters/paperclip.js): JARVIS_PAPERCLIP_ENABLED=1, _URL, _COMPANY_ID,
//   _TOKEN, _TIMEOUT_MS, plus optional JARVIS_PAPERCLIP_ASSIGNEE_AGENT_ID / _PROJECT_ID / _GOAL_ID.
// DADA design skill (kernel/adapters/dada.js): JARVIS_DADA_ENABLED=1 loads the pinned checkout fetched by
//   `npm run upstream -- fetch dada` (or JARVIS_DADA_DIR), refuses it unless commit + contract match, and adds the
//   design.dada task operation, which returns a design work packet (no inference, no DADA text copied).
// gm-mcp server (kernel/adapters/gm-mcp.js): JARVIS_GM_MCP_ENABLED=1 loads the pinned checkout fetched by
//   `npm run upstream -- fetch gm-mcp` (or JARVIS_GM_MCP_DIR), refuses it unless commit + bundle sha256 match the
//   lock/contract, and adds the mcp.gm.codemode task operation: one kernel-owned stdio child per task, background
//   self-update/HTTP/runner mechanisms switched off, schema-hash checked before the call. See that file for _* flags.
// last30days research skill (kernel/adapters/last30days.js): JARVIS_LAST30DAYS_ENABLED=1 loads the pinned checkout
//   fetched by `npm run upstream -- fetch last30days` (or JARVIS_LAST30DAYS_DIR), refuses it unless commit + contract
//   + python3.12+ check out, and adds the research.last30days task operation: one kernel-owned engine child per task
//   with keyless sources only, --no-browser-cookies, no API keys or user config. _PYTHON, _SOURCES, _DAYS,
//   _MAX_RESULTS, _MOCK: see that file.
// Ponytail coding skill (kernel/adapters/ponytail.js): JARVIS_PONYTAIL_ENABLED=1 loads the pinned checkout fetched by
//   `npm run upstream -- fetch ponytail` (or JARVIS_PONYTAIL_DIR), refuses it unless commit + contract match, and adds
//   the code.ponytail task operation, which returns a coding work packet naming the pinned skill (no inference).
import {readFileSync} from 'node:fs';
import {AutheoReceiptLedger,trustOutcomeObserver} from './adapters/autheo.js';
import {autheoApiConfigFromEnv,createAutheoClient} from './adapters/autheo-client.js';
import {paperclipConfigFromEnv,createPaperclipClient,PaperclipGovernanceMirror} from './adapters/paperclip.js';
import {dadaConfigFromEnv,loadDada,designPacket} from './adapters/dada.js';
import {gmMcpConfigFromEnv,loadGmMcp,GM_MCP_OPERATION} from './adapters/gm-mcp.js';
import {last30ConfigFromEnv,loadLast30,L30_OPERATION} from './adapters/last30days.js';
import {ponytailConfigFromEnv,loadPonytail,codingPacket,PONYTAIL_OPERATION} from './adapters/ponytail.js';

const repoFile=p=>new URL('../'+p,import.meta.url);
// Lock entry + committed contract snapshot for one pinned upstream component (upstreams/lock.json).
export function upstreamPin(id,readFile=readFileSync){const lock=JSON.parse(String(readFile(repoFile('upstreams/lock.json'),'utf8')));const e=lock.components.find(c=>c.id===id);if(!e)throw new Error('upstreams/lock.json has no '+id);return {entry:e,snapshot:e.contract?JSON.parse(String(readFile(repoFile(e.contract),'utf8'))):null};}
export function dadaLock(readFile=readFileSync){const lock=JSON.parse(String(readFile(repoFile('upstreams/lock.json'),'utf8')));const e=lock.components.find(c=>c.id==='dada');return {entry:e,snapshot:JSON.parse(String(readFile(repoFile(e.contract),'utf8')))};}

export function adaptersFromEnv(env=process.env,{readFile=readFileSync,fetcher,root=process.cwd(),probePython}={}){
 const summary={autheo:{enabled:false},autheoApi:{enabled:false},paperclip:{enabled:false},dada:{enabled:false},gmMcp:{enabled:false},last30days:{enabled:false},ponytail:{enabled:false}};
 const observers=[],executors={};let trust=null,autheoApi=null,paperclip=null,dada=null,gmMcp=null,last30days=null,ponytail=null;
 if(env.JARVIS_AUTHEO_ENABLED==='1'){
  const privateKey=env.JARVIS_AUTHEO_PRIVATE_KEY_FILE?String(readFile(env.JARVIS_AUTHEO_PRIVATE_KEY_FILE,'utf8')):undefined;
  trust=new AutheoReceiptLedger({issuer:env.JARVIS_AUTHEO_ISSUER||'jarvis-local-authority',environment:env.JARVIS_AUTHEO_ENVIRONMENT||'env:default',kid:env.JARVIS_AUTHEO_KID||undefined,privateKey,format:env.JARVIS_AUTHEO_FORMAT||'v1'});
  const outcomes=trust.format==='v1'&&env.JARVIS_AUTHEO_OUTCOMES!=='0';
  if(outcomes){const observe=trustOutcomeObserver(trust);observers.push(task=>observe(task));}
  const anchor=trust.trustAnchor();
  summary.autheo={enabled:true,issuer:anchor.issuer,kid:anchor.kid,environment:anchor.environment,fingerprint:anchor.fingerprint,format:anchor.format,ephemeralKey:!privateKey,outcomeReceipts:outcomes};
 }
 const api=autheoApiConfigFromEnv(env,{readFile});
 if(api){autheoApi=createAutheoClient({...api,...(fetcher?{fetcher}:{})});summary.autheoApi={enabled:true,baseUrl:api.baseUrl,anchorPinned:Boolean(api.anchor),gatesKernel:false};}
 const pc=paperclipConfigFromEnv(env);
 if(pc){const client=createPaperclipClient({...pc,...(fetcher?{fetcher}:{})});const defaults={};for(const [k,e] of [['assigneeAgentId','JARVIS_PAPERCLIP_ASSIGNEE_AGENT_ID'],['projectId','JARVIS_PAPERCLIP_PROJECT_ID'],['goalId','JARVIS_PAPERCLIP_GOAL_ID']])if(env[e])defaults[k]=env[e];paperclip=new PaperclipGovernanceMirror(client,{defaults});observers.push(task=>paperclip.syncTask(task));summary.paperclip={enabled:true,baseUrl:client.baseUrl,companyId:pc.companyId,authenticated:Boolean(pc.token)};}
 if(env.JARVIS_DADA_ENABLED==='1'){
  const {entry,snapshot}=dadaLock(readFile);const cfg=dadaConfigFromEnv(env,{root,lock:entry});
  dada=loadDada({...cfg,snapshot});
  executors['design.dada']=async({input})=>({executor:'dada-design-packet-v1',packet:designPacket(dada,{brief:input.text})});
  summary.dada={enabled:true,commit:dada.commit,skillSha256:dada.skillSha256,contract:dada.diff.identical?'identical':'compatible',operation:'design.dada',inference:false};
 }
 const gm=gmMcpConfigFromEnv(env,{root,lock:env.JARVIS_GM_MCP_ENABLED==='1'?upstreamPin('gm-mcp',readFile).entry:undefined});
 if(gm){gmMcp=loadGmMcp(gm,upstreamPin('gm-mcp',readFile).snapshot);executors[GM_MCP_OPERATION]=gmMcp.executor();summary.gmMcp=gmMcp.summary();}
 const l30=last30ConfigFromEnv(env,{root,lock:env.JARVIS_LAST30DAYS_ENABLED==='1'?upstreamPin('last30days',readFile).entry:undefined});
 if(l30){last30days=loadLast30(l30,upstreamPin('last30days',readFile).snapshot,probePython?{probePython}:{});executors[L30_OPERATION]=last30days.executor();summary.last30days=last30days.summary();}
 const pt=ponytailConfigFromEnv(env,{root,lock:env.JARVIS_PONYTAIL_ENABLED==='1'?upstreamPin('ponytail',readFile).entry:undefined});
 if(pt){ponytail=loadPonytail({...pt,snapshot:upstreamPin('ponytail',readFile).snapshot});executors[PONYTAIL_OPERATION]=async({input})=>({executor:'ponytail-coding-packet-v1',packet:codingPacket(ponytail,{task:input.text})});summary.ponytail={enabled:true,commit:ponytail.commit,version:ponytail.version,contract:ponytail.diff.identical?'identical':'compatible',operation:PONYTAIL_OPERATION,inference:false};}
 return {trust,observers,autheoApi,paperclip,dada,gmMcp,last30days,ponytail,executors,summary};
}
