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
import {readFileSync} from 'node:fs';
import {AutheoReceiptLedger,trustOutcomeObserver} from './adapters/autheo.js';
import {autheoApiConfigFromEnv,createAutheoClient} from './adapters/autheo-client.js';
import {paperclipConfigFromEnv,createPaperclipClient,PaperclipGovernanceMirror} from './adapters/paperclip.js';
import {dadaConfigFromEnv,loadDada,designPacket} from './adapters/dada.js';
import {gmMcpConfigFromEnv,loadGmMcp,GM_MCP_OPERATION} from './adapters/gm-mcp.js';

const repoFile=p=>new URL('../'+p,import.meta.url);
// Lock entry + committed contract snapshot for one pinned upstream component (upstreams/lock.json).
export function upstreamPin(id,readFile=readFileSync){const lock=JSON.parse(String(readFile(repoFile('upstreams/lock.json'),'utf8')));const e=lock.components.find(c=>c.id===id);if(!e)throw new Error('upstreams/lock.json has no '+id);return {entry:e,snapshot:e.contract?JSON.parse(String(readFile(repoFile(e.contract),'utf8'))):null};}
export function dadaLock(readFile=readFileSync){const lock=JSON.parse(String(readFile(repoFile('upstreams/lock.json'),'utf8')));const e=lock.components.find(c=>c.id==='dada');return {entry:e,snapshot:JSON.parse(String(readFile(repoFile(e.contract),'utf8')))};}

export function adaptersFromEnv(env=process.env,{readFile=readFileSync,fetcher,root=process.cwd()}={}){
 const summary={autheo:{enabled:false},autheoApi:{enabled:false},paperclip:{enabled:false},dada:{enabled:false},gmMcp:{enabled:false}};
 const observers=[],executors={};let trust=null,autheoApi=null,paperclip=null,dada=null,gmMcp=null;
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
 return {trust,observers,autheoApi,paperclip,dada,gmMcp,executors,summary};
}
