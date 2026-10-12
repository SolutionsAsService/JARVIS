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
import {readFileSync} from 'node:fs';
import {AutheoReceiptLedger,trustOutcomeObserver} from './adapters/autheo.js';
import {autheoApiConfigFromEnv,createAutheoClient} from './adapters/autheo-client.js';
import {paperclipConfigFromEnv,createPaperclipClient,PaperclipGovernanceMirror} from './adapters/paperclip.js';

export function adaptersFromEnv(env=process.env,{readFile=readFileSync,fetcher}={}){
 const summary={autheo:{enabled:false},autheoApi:{enabled:false},paperclip:{enabled:false}};
 const observers=[];let trust=null,autheoApi=null,paperclip=null;
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
 return {trust,observers,autheoApi,paperclip,summary};
}
