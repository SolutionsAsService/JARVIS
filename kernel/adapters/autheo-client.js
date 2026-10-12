// Client for the autheo-agent-environment 0.2 loopback HTTP API (POST /v1/evaluate etc.).
// Independently authored, MIT. OFF BY DEFAULT. Contract source:
// SolutionsAsService/autheo-agent-environment@68bfb5550925efadd2fdfaafff5273f63475f219
//   docs/API-AND-CLI.md, docs/openapi.json, docs/INTEGRATIONS.md, src/autheo_agent_environment/api.py.
// The service is a policy decision point and evidence ledger; JARVIS stays the enforcement point.
// Rules followed here: loopback HTTP only (the service has no TLS), bearer token from env/file (never
// from the browser), no redirects, bounded responses, fail closed on any transport/HTTP/verification
// error, receipts verified locally against an operator-pinned trust anchor when one is configured,
// and an allow is never cached (callers evaluate immediately before an effect).
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {verifyToken,signAgentDocument,readPublicKey,TrustError,IDENTIFIER} from './autheo.js';

export class AutheoApiError extends Error{constructor(code,message,status,upstream){super(message);this.code=code;this.status=status;this.upstream=upstream;}}
const fail=(code,message,status,upstream)=>{throw new AutheoApiError(code,message,status,upstream);};
const seg=v=>{if(typeof v!=='string'||!/^[A-Za-z0-9][A-Za-z0-9:._-]{0,159}$/.test(v))fail('autheo_input','Invalid path identifier');return encodeURIComponent(v);};
export const AUTHEO_DEFAULT_URL='http://127.0.0.1:8780';

// Loopback HTTP only: the reference service refuses non-loopback binds without --allow-remote and has no TLS.
export function normalizeAutheoUrl(value){let url;try{url=new URL(value);}catch{fail('autheo_config','Invalid Autheo API URL');}if(url.protocol!=='http:'||!['127.0.0.1','localhost','[::1]'].includes(url.hostname))fail('autheo_config','Autheo API URL must be loopback http (127.0.0.1, localhost or [::1])');if(url.username||url.password||url.search||url.hash)fail('autheo_config','Autheo API URL must not carry credentials, query or fragment');return url.origin+url.pathname.replace(/\/+$/,'').replace(/\/v1$/,'');}

// Env-configured connector; returns null (disabled) unless explicitly enabled.
//   JARVIS_AUTHEO_API_ENABLED=1                    required opt-in
//   JARVIS_AUTHEO_API_URL=http://127.0.0.1:8780    loopback only
//   JARVIS_AUTHEO_API_TOKEN=<token>  or  JARVIS_AUTHEO_API_TOKEN_FILE=<state-dir>/api-token
//   JARVIS_AUTHEO_ANCHOR_PUBLIC_KEY_FILE=<issuer-public.pem>, JARVIS_AUTHEO_ANCHOR_KID, JARVIS_AUTHEO_ANCHOR_ISSUER
//                                                  optional pinned trust anchor (all three together)
//   JARVIS_AUTHEO_API_TIMEOUT_MS=5000
export function autheoApiConfigFromEnv(env=process.env,{readFile=readFileSync}={}){
 if(env.JARVIS_AUTHEO_API_ENABLED!=='1')return null;
 const token=env.JARVIS_AUTHEO_API_TOKEN||(env.JARVIS_AUTHEO_API_TOKEN_FILE?String(readFile(env.JARVIS_AUTHEO_API_TOKEN_FILE,'utf8')).trim():'');
 if(!token)fail('autheo_config','JARVIS_AUTHEO_API_TOKEN or JARVIS_AUTHEO_API_TOKEN_FILE is required when enabled');
 const anchorParts=[env.JARVIS_AUTHEO_ANCHOR_PUBLIC_KEY_FILE,env.JARVIS_AUTHEO_ANCHOR_KID,env.JARVIS_AUTHEO_ANCHOR_ISSUER];
 if(anchorParts.some(Boolean)&&!anchorParts.every(Boolean))fail('autheo_config','Pinned anchor needs JARVIS_AUTHEO_ANCHOR_PUBLIC_KEY_FILE, _KID and _ISSUER together');
 const anchor=anchorParts.every(Boolean)?{publicKey:String(readFile(env.JARVIS_AUTHEO_ANCHOR_PUBLIC_KEY_FILE,'utf8')),kid:env.JARVIS_AUTHEO_ANCHOR_KID,issuer:env.JARVIS_AUTHEO_ANCHOR_ISSUER}:null;
 return {baseUrl:normalizeAutheoUrl(env.JARVIS_AUTHEO_API_URL||AUTHEO_DEFAULT_URL),token,anchor,timeoutMs:Math.min(Math.max(Number(env.JARVIS_AUTHEO_API_TIMEOUT_MS)||5000,100),30000)};
}

export function createAutheoClient({baseUrl=AUTHEO_DEFAULT_URL,token,fetcher=globalThis.fetch,timeoutMs=5000,maxResponseBytes=1<<20,anchor=null}={}){
 const base=normalizeAutheoUrl(baseUrl);if(typeof fetcher!=='function')fail('autheo_config','fetch implementation required');
 let pinned=anchor?{issuer:anchor.issuer,kid:anchor.kid,publicKey:readPublicKey(anchor.publicKey)}:null;
 async function request(method,path,{body,query,auth=true}={}){
  const url=new URL(base+path);for(const [k,v] of Object.entries(query??{}))if(v!==undefined&&v!==null)url.searchParams.set(k,String(v));
  const headers={Accept:'application/json'};if(auth){if(!token)fail('autheo_config','Autheo API token not configured');headers.Authorization='Bearer '+token;}if(body!==undefined)headers['Content-Type']='application/json';
  const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),timeoutMs);let response,text;
  try{response=await fetcher(url.href,{method,headers,body:body===undefined?undefined:JSON.stringify(body),signal:controller.signal,redirect:'error'});text=await response.text();}
  catch(e){fail(controller.signal.aborted?'autheo_timeout':'autheo_unreachable',controller.signal.aborted?'Autheo API timed out':'Autheo API unreachable');}
  finally{clearTimeout(timer);}
  if(Buffer.byteLength(text)>maxResponseBytes)fail('autheo_response','Autheo API response too large',502);
  let data=null;try{data=text?JSON.parse(text):null;}catch{fail('autheo_response','Autheo API returned non-JSON',502);}
  if(!response.ok)fail(response.status===401?'autheo_auth':response.status===409?'autheo_conflict':response.status===404?'autheo_not_found':'autheo_http','Autheo API '+response.status+': '+(data?.error??'error')+(data?.detail?' ('+String(data.detail).slice(0,200)+')':''),response.status,data?.error);
  return data;
 }
 // Fresh receipts are verified non-historically against the pinned anchor (fail closed on mismatch).
 function checkReceipt(result,environment){
  if(!pinned||!result?.receipt_token)return {...result,receipt_verified:null};
  const audience=environment??result.receipt?.environment;let verified;
  try{const claims=JSON.parse(Buffer.from(String(result.receipt_token).split('.')[1]??'','base64url'));verified=verifyToken(result.receipt_token,{kind:'receipt',publicKey:pinned.publicKey,issuer:pinned.issuer,audience:audience??claims.aud,kid:pinned.kid});
   if(environment===undefined&&!IDENTIFIER.test(String(claims.aud)))fail('autheo_receipt','Receipt audience is not an environment id');}
  catch(e){if(e instanceof AutheoApiError)throw e;fail('autheo_receipt','Receipt failed verification against the pinned anchor: '+(e.code??e.message),502);}
  if(result.receipt&&(result.receipt.sequence!==verified.claims.body.sequence||result.receipt.request_id!==verified.claims.body.request_id||(result.receipt.decision!==undefined&&result.receipt.decision!==verified.claims.body.decision)))fail('autheo_receipt','Response receipt differs from the signed receipt',502);
  return {...result,receipt_verified:{format:verified.format,sequence:verified.claims.body.sequence,decision:verified.claims.body.decision,environment:verified.claims.aud}};
 }
 const client={
  baseUrl:base,
  get anchor(){return pinned?{issuer:pinned.issuer,kid:pinned.kid,publicKeyPem:pinned.publicKey.export({type:'spki',format:'pem'})}:null;},
  health:()=>request('GET','/v1/health',{auth:false}),
  info:()=>request('GET','/v1/info'),
  policy:()=>request('GET','/v1/policy'),
  schemas:()=>request('GET','/v1/schemas',{auth:false}),
  // Trust-on-first-use pinning from /v1/info. Prefer configuring the anchor out of band; if one is already
  // pinned, /v1/info must match it exactly.
  async pinAnchorFromInfo({allowTofu=false}={}){const info=await request('GET','/v1/info');const key=readPublicKey(info.public_key);const same=pinned&&pinned.issuer===info.issuer&&pinned.kid===info.kid&&pinned.publicKey.export({type:'spki',format:'pem'})===key.export({type:'spki',format:'pem'});if(pinned&&!same)fail('autheo_anchor','Autheo /v1/info differs from the pinned trust anchor',502);if(!pinned){if(!allowTofu)fail('autheo_anchor','No pinned anchor; pass allowTofu:true to pin from /v1/info');pinned={issuer:info.issuer,kid:info.kid,publicKey:key};}return client.anchor;},
  issueIdentity:input=>request('POST','/v1/identities',{body:input}),
  getIdentity:agentId=>request('GET','/v1/identities/'+seg(agentId)),
  revokeIdentity:(agentId,reason)=>request('POST','/v1/identities/'+seg(agentId)+'/revoke',{body:reason?{reason}:{}}),
  grantMandate:async input=>checkReceipt(await request('POST','/v1/mandates',{body:input}),input.environment),
  getMandate:id=>request('GET','/v1/mandates/'+seg(id)),
  revokeMandate:async(id,reason)=>checkReceipt(await request('POST','/v1/mandates/'+seg(id)+'/revoke',{body:reason?{reason}:{}})),
  // {request_token} (agent-signed; preferred) or {request} (service-held key, local dev only).
  evaluate:async(input,{environment}={})=>{const keys=Object.keys(input??{});if(keys.length!==1||!['request_token','request'].includes(keys[0]))fail('autheo_input','Provide exactly one of request_token or request');return checkReceipt(await request('POST','/v1/evaluate',{body:input}),environment);},
  recordOutcome:async input=>checkReceipt(await request('POST','/v1/receipts/outcome',{body:input}),input.environment),
  verifyReceipt:token=>request('POST','/v1/receipts/verify',{body:{token}}),
  ledgerVerify:(environment,expectedHead)=>request('POST','/v1/ledger/verify',{body:expectedHead?{environment,expected_head:expectedHead}:{environment}}),
  ledgerReceipts:(environment,{limit,agentId}={})=>request('GET','/v1/ledger/receipts',{query:{environment,limit,agent_id:agentId}}),
  checkpoint:input=>request('POST','/v1/checkpoints',{body:input}),
  acceptHandoff:async input=>checkReceipt(await request('POST','/v1/handoffs/accept',{body:input})),
  // Sign an autheo-request+jwt with the runtime-held agent key and evaluate it now. allow === true only for
  // an "allow" outcome; anything else (escalate, block, error) must not dispatch.
  async evaluateAction({privateKey,agentId,environment,mandateId,action,resource,tool=null,amountMinor=0,requestId='jarvis:'+randomUUID(),ttlSeconds=60}){
   const body={schema_version:'autheo.request/v1',request_id:requestId,agent_id:agentId,environment,mandate_id:mandateId,action,resource,amount_minor:amountMinor,asset:'DEMO',...(tool?{tool}:{})};
   const result=await client.evaluate({request_token:signAgentDocument({kind:'request',privateKey,agentId,environment,body,ttlSeconds})},{environment});
   if(result?.executed!==false||!['allow','escalate','block'].includes(result?.outcome))fail('autheo_response','Unexpected evaluate response',502);
   return {...result,requestId,allow:result.outcome==='allow'&&!result.replayed};
  },
  // After the effect: agent-signed autheo-outcome+jwt. Records a claim, not proof.
  async reportOutcome({privateKey,agentId,environment,requestId,status,detailSha256=null}){
   const body={schema_version:'autheo.outcome/v1',request_id:requestId,agent_id:agentId,environment,status,...(detailSha256?{detail_sha256:detailSha256}:{})};
   const report_token=signAgentDocument({kind:'outcome',privateKey,agentId,environment,body});
   return client.recordOutcome({environment,request_id:requestId,status,...(detailSha256?{detail_sha256:detailSha256}:{}),report_token});
  },
 };
 return client;
}
export {TrustError};
