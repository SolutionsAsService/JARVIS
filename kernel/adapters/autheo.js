// Autheo trust adapter. Independently authored, MIT.
// Implements the Autheo v1 document/signature/receipt-chain rules for the JARVIS kernel: verify
// compact EdDSA JWS documents and hash-chained receipt ledgers, sign agent requests/outcomes, and emit
// receipts in the Autheo format from JARVIS governance outcomes.
// Normative source: SolutionsAsService/autheo-agent-environment@68bfb5550925efadd2fdfaafff5273f63475f219
//   (0.2.0) docs/SPEC-SIGNATURES.md, schemas/*.v1.schema.json (vendored unchanged in
//   kernel/vendor/autheo/), tests/vectors/autheo-v1-vectors.json (copied to test/fixtures/autheo-v1/),
//   interop/js/autheo-verify.mjs + autheo-sign.mjs (read as reference; not copied).
// Backward compatibility: receipts from SolutionsAsService/autheo-agent-environment@8106edd0 (0.1;
// no schema_version/recorded_at, kid "demo-v1") still verify; they are reported as format "legacy-0.1".
// The optional Python CLI bridge and the HTTP client (kernel/adapters/autheo-client.js) are OFF by default.
import {createHash,createPublicKey,createPrivateKey,generateKeyPairSync,sign as edSign,verify as edVerify,randomUUID,KeyObject} from 'node:crypto';
import {execFile} from 'node:child_process';
import {writeFile,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {validateAutheoSchema} from './autheo-schema.js';

export const AUTHEO_SPEC_REVISION='68bfb5550925efadd2fdfaafff5273f63475f219';
export const AUTHEO_LEGACY_REVISION='8106edd0d68747c3a17e234c967da3b5449298ec';
export const ZERO_HASH='0'.repeat(64);
export const MAX_TOKEN_BYTES=131072;
export const CLOCK_SKEW_SECONDS=2;
export const MAX_TTL=Object.freeze({passport:86400,mandate:3600,request:300,handoff:300,'trust-snapshot':300,receipt:86400,outcome:300});
export const LEGACY_KID='demo-v1';
// v1 Scope literal (models.py); the first five are the complete 0.1 vocabulary.
export const AUTHEO_SCOPES=Object.freeze(['marketplace.read','devhub.read','chain.read','compute.simulate','environment.handoff','tool.invoke','model.invoke','file.read','file.write','network.fetch','message.send','task.checkpoint']);
export const LEGACY_SCOPES=Object.freeze(AUTHEO_SCOPES.slice(0,5));
export const RECEIPT_KINDS=Object.freeze(['simulation','handoff_export','handoff_import','revocation','outcome_report','identity_issue','mandate_grant']);
export const RECEIPT_DECISIONS=Object.freeze(['allow','escalate','block','checkpoint_only','revoked','recorded']);
export const IDENTIFIER=/^[A-Za-z0-9][A-Za-z0-9:._-]{0,95}$/;
const REQUEST_ID=/^[A-Za-z0-9][A-Za-z0-9:._-]{0,159}$/;
const HEX64=/^[0-9a-f]{64}$/;
const REQUIRED_CLAIMS=['iss','sub','aud','iat','nbf','exp','jti','body'];
const LEGACY_RECEIPT_FIELDS=['sequence','previous_hash','request_id','payload_hash','agent_id','mandate_id','kind','decision','reasons','amount_minor','executed','simulation_only'];
const SCHEMA_FOR_KIND={passport:'passport',mandate:'mandate',request:'request',handoff:'handoff',receipt:'receipt',outcome:'outcome'};

// Fine-grained codes (code) plus the SPEC-SIGNATURES/vector error class (spec):
// bad_format | bad_header | bad_signature | bad_claims | expired | not_yet_valid.
const SPEC_ERROR={size:'bad_format',format:'bad_format',header:'bad_header',alg:'bad_header',signature:'bad_signature',expired:'expired',immature:'not_yet_valid'};
export class TrustError extends Error{constructor(code,message){super(message);this.code=code;this.spec=SPEC_ERROR[code]??'bad_claims';}}
const fail=(code,message)=>{throw new TrustError(code,message);};
const b64json=v=>Buffer.from(JSON.stringify(v),'utf8').toString('base64url');
const sha256=v=>createHash('sha256').update(v).digest('hex');
const nowSeconds=()=>Math.floor(Date.now()/1000);
const isObject=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);

// autheo-cjson/1 (SPEC §2): sorted keys, no whitespace, every char outside 0x20-0x7E escaped as
// lowercase \uXXXX unless a short escape exists, safe integers only. Used only for digests.
export function canonicalJson(value){
 if(value===null||typeof value==='boolean')return JSON.stringify(value);
 if(typeof value==='number'){if(!Number.isFinite(value))fail('canonical','NaN/Infinity not allowed');if(!Number.isSafeInteger(value))fail('canonical','Canonical JSON allows safe integers only');return String(value);}
 if(typeof value==='string')return JSON.stringify(value).replace(/[\u007f-\uffff]/g,c=>'\\u'+c.charCodeAt(0).toString(16).padStart(4,'0'));
 if(Array.isArray(value))return '['+value.map(canonicalJson).join(',')+']';
 if(typeof value==='object')return '{'+Object.keys(value).sort().map(k=>canonicalJson(k)+':'+canonicalJson(value[k])).join(',')+'}';
 fail('canonical','Unsupported JSON value');
}
export const autheoDigest=value=>sha256(canonicalJson(value));
export function chainHash(previous,token){if(!HEX64.test(previous))fail('chain','previous hash must be 64 lowercase hex');return sha256(previous+token);}

function decodeSegment(segment,label){if(typeof segment!=='string'||!/^[A-Za-z0-9_-]+$/.test(segment))fail('format','Malformed '+label);try{return JSON.parse(Buffer.from(segment,'base64url').toString('utf8'));}catch{fail('format','Malformed '+label);}}

// Accepts a KeyObject, SPKI PEM or RFC 8037 OKP JWK; only Ed25519.
export function readPublicKey(input){
 let key;
 try{key=input instanceof KeyObject?(input.type==='private'?createPublicKey(input):input):isObject(input)?createPublicKey({key:{kty:input.kty,crv:input.crv,x:input.x},format:'jwk'}):createPublicKey(input);}catch{fail('key','Invalid public key');}
 if(key.asymmetricKeyType!=='ed25519')fail('key','Only Ed25519 public keys are accepted');return key;
}
// "sha256:" + base64url(SHA-256(SPKI DER)) — the v1 agent kid, identical to Paperclip's agent keyId.
export function keyFingerprint(key){const pub=readPublicKey(key);return 'sha256:'+createHash('sha256').update(pub.export({type:'spki',format:'der'})).digest('base64url');}
// Persistent-state authority kid: "local-" + first 16 chars of the fingerprint (state.py).
export const localAuthorityKid=key=>'local-'+keyFingerprint(key).split(':')[1].slice(0,16);

function checkLegacyReceipt(body){
 for(const f of LEGACY_RECEIPT_FIELDS)if(!(f in body))fail('schema','Legacy receipt lacks '+f);
 if(!Number.isSafeInteger(body.sequence)||body.sequence<1||!HEX64.test(body.previous_hash)||!HEX64.test(body.payload_hash)||typeof body.request_id!=='string'||!IDENTIFIER.test(body.agent_id)||typeof body.mandate_id!=='string'||!Array.isArray(body.reasons)||!Number.isSafeInteger(body.amount_minor)||body.executed!==false||body.simulation_only!==true||!RECEIPT_KINDS.includes(body.kind)||!RECEIPT_DECISIONS.includes(body.decision))fail('schema','Invalid legacy receipt body');
}
// schema: 'auto' (v1 when body.schema_version is present, otherwise 0.1 rules), 'v1', 'legacy' or false.
function checkBody(kind,body,schema){
 if(schema===false)return 'unchecked';
 const v1=schema==='v1'||(schema==='auto'&&'schema_version' in body);
 if(v1){const name=SCHEMA_FOR_KIND[kind];if(!name)return 'v1-unschematized';const errors=validateAutheoSchema(name,body);if(errors.length)fail('schema','Body does not match '+name+'.v1 schema: '+errors.slice(0,5).join('; '));return 'v1';}
 if(schema!=='auto'&&schema!=='legacy')fail('schema','Unknown schema mode');
 if('schema_version' in body)fail('schema','Legacy mode does not accept versioned bodies');
 if(kind==='receipt')checkLegacyReceipt(body);
 return 'legacy-0.1';
}

// SPEC-SIGNATURES §1.4. "historical" skips exp (receipts only). The verifier supplies the expected kid
// and key (trust anchor); a token never selects its own key.
export function verifyToken(token,{kind,publicKey,issuer,audience,kid=LEGACY_KID,historical=false,now=nowSeconds(),skew=CLOCK_SKEW_SECONDS,schema='auto'}){
 if(!(kind in MAX_TTL))fail('kind','Unknown document kind');
 if(historical&&kind!=='receipt')fail('historical','Historical verification is for receipts only');
 if(typeof token!=='string'||Buffer.byteLength(token)>MAX_TOKEN_BYTES)fail('size','Invalid token size');
 const parts=token.split('.');if(parts.length!==3)fail('format','Not a compact JWS');
 const header=decodeSegment(parts[0],'header');
 if(!isObject(header))fail('format','Malformed header');
 if(header.alg!=='EdDSA')fail('alg','Only EdDSA is accepted');
 if(header.typ!=='autheo-'+kind+'+jwt'||header.kid!==kid||'crit' in header)fail('header','Invalid document type or key identifier');
 const key=readPublicKey(publicKey);
 if(!/^[A-Za-z0-9_-]+$/.test(parts[2]))fail('format','Malformed signature');
 let valid=false;try{valid=edVerify(null,Buffer.from(parts[0]+'.'+parts[1],'ascii'),key,Buffer.from(parts[2],'base64url'));}catch{valid=false;}
 if(!valid)fail('signature','Signature verification failed');
 const claims=decodeSegment(parts[1],'claims');
 if(!isObject(claims))fail('claims','Invalid claims');
 for(const c of REQUIRED_CLAIMS)if(!(c in claims))fail('claims','Missing claim '+c);
 for(const k of ['iat','nbf','exp'])if(!Number.isSafeInteger(claims[k]))fail('time','Timestamps must be integer seconds');
 if(!isObject(claims.body))fail('body','Invalid document body');
 if(claims.iss!==issuer)fail('issuer','Invalid issuer');
 if(typeof claims.aud!=='string'||claims.aud!==audience)fail('audience','Invalid audience');
 if(typeof claims.jti!=='string'||!claims.jti)fail('body','Invalid document identifier');
 if(!historical&&claims.exp<=now)fail('expired','Signature has expired');
 if(claims.iat>now+skew||claims.nbf>now+skew)fail('immature','Token validity starts too far in the future');
 const ttl=claims.exp-claims.iat;if(!(ttl>0&&ttl<=MAX_TTL[kind])||claims.nbf!==claims.iat)fail('window','Invalid token validity window');
 const format=checkBody(kind,claims.body,schema);
 return {header,claims,format};
}

// Agent-signed request/outcome (SPEC §1.3): kid must be the fingerprint of the passport-bound key; the
// 0.1 value "demo-v1" is accepted only when allowLegacyKid is true. iss == sub == body.agent_id.
export function verifyAgentDocument(token,{kind,publicKey,agentId,environment,now,allowLegacyKid=true,schema='auto'}){
 if(kind!=='request'&&kind!=='outcome')fail('kind','Agent documents are request or outcome');
 const fingerprint=keyFingerprint(publicKey);let headerKid;try{headerKid=decodeSegment(String(token).split('.')[0],'header')?.kid;}catch{headerKid=undefined;}
 const kid=headerKid===fingerprint||(allowLegacyKid&&headerKid===LEGACY_KID)?headerKid:fingerprint;
 const result=verifyToken(token,{kind,publicKey,issuer:agentId,audience:environment,kid,now,schema});
 if(result.claims.sub!==agentId||result.claims.body.agent_id!==agentId)fail('claims','Agent identity mismatch');
 return {...result,kidKind:kid===LEGACY_KID?'legacy':'fingerprint'};
}

function chainChecks(body,sequence,previous,ids){
 if(body.sequence!==sequence||body.previous_hash!==previous||body.executed!==false||ids.has(body.request_id)||!RECEIPT_KINDS.includes(body.kind))fail('chain','Audit chain integrity failure');
}

// Receipt archive {receipts:[token,...]} as written by "ledger export"/demo (audit.verify_archive), with
// v1 additions: body schema per receipt (or 0.1 rules when allowLegacy) and known receipt kinds.
export function verifyReceiptArchive(archive,{publicKey,issuer,environment,expectedHead=null,kid=LEGACY_KID,now,allowLegacy=true,schema}){
 if(!isObject(archive)||Object.keys(archive).length!==1||!Array.isArray(archive.receipts))fail('archive','Invalid audit archive');
 const mode=schema??(allowLegacy?'auto':'v1');
 let previous=ZERO_HASH;const ids=new Set(),receipts=[],formats={};
 archive.receipts.forEach((token,i)=>{const {claims,format}=verifyToken(token,{kind:'receipt',publicKey,issuer,audience:environment,kid,historical:true,now,schema:mode});const body=claims.body;
  chainChecks(body,i+1,previous,ids);ids.add(body.request_id);previous=chainHash(previous,token);formats[format]=(formats[format]??0)+1;receipts.push({...body,hash:previous,jti:claims.jti,subject:claims.sub,format});});
 const matched=expectedHead!==null&&expectedHead!==undefined;
 if(matched&&previous!==expectedHead)fail('head','Audit head differs from external checkpoint');
 return {signature_chain_verified:true,count:ids.size,head:previous,immutable:false,actual_actions_proven:false,external_checkpoint_matched:matched,formats,receipts};
}

// v1 ledger rows [{sequence, request_id, token, chain_hash}] (schemas/ledger-entry.v1). Never throws for
// chain faults: returns {valid, head, count, firstInvalidSequence, error:{code,spec,message}}.
export function verifyReceiptChain(rows,{publicKey,issuer,environment,kid=LEGACY_KID,expectedHead=null,now,allowLegacy=true}){
 if(!Array.isArray(rows))fail('archive','Ledger rows must be an array');
 let previous=ZERO_HASH;const ids=new Set();
 for(const [index,row] of rows.entries()){const sequence=index+1;
  try{
   if(!isObject(row)||row.sequence!==sequence||typeof row.token!=='string'||!REQUEST_ID.test(row.request_id??'')||!HEX64.test(row.chain_hash??''))fail('chain','Invalid ledger row');
   const {claims}=verifyToken(row.token,{kind:'receipt',publicKey,issuer,audience:environment,kid,historical:true,now,schema:allowLegacy?'auto':'v1'});
   chainChecks(claims.body,sequence,previous,ids);
   if(claims.body.request_id!==row.request_id)fail('chain','Row id differs from receipt request_id');
   const recomputed=chainHash(previous,row.token);if(recomputed!==row.chain_hash)fail('chain','Stored chain hash differs');
   ids.add(row.request_id);previous=recomputed;
  }catch(e){if(!(e instanceof TrustError))throw e;return {valid:false,head:null,count:index,firstInvalidSequence:sequence,error:{code:e.code,spec:e.spec,message:e.message}};}
 }
 if(expectedHead!==null&&expectedHead!==undefined&&previous!==expectedHead)return {valid:false,head:previous,count:rows.length,firstInvalidSequence:null,error:{code:'head',spec:'bad_claims',message:'Head differs from independent anchor'}};
 return {valid:true,head:previous,count:rows.length,firstInvalidSequence:null,error:null};
}

const safeId=(prefix,value,max=96)=>{const id=(prefix+String(value).replace(/[^A-Za-z0-9:._-]/g,'-')).slice(0,max);if(!(max>96?REQUEST_ID:IDENTIFIER).test(id))fail('identifier','Cannot form Autheo identifier');return id;};
const toolId=operation=>{const id=('jarvis:'+String(operation).replace(/[^A-Za-z0-9:._/-]/g,'-')).slice(0,128);return id;};

// JARVIS -> Autheo concept map. Actors become passport subjects; actor workspace/capability grants
// become a v1 mandate (scope tool.invoke, one resource per workspace, JARVIS capabilities as allow-listed
// tools "jarvis:<capability>"). The result matches POST /v1/mandates (MandateGrantInput) apart from
// owner_id/asset, which the service sets itself. JARVIS has no money: governance "units" map to DEMO
// minor units only as an accounting analogy.
export function mapActorToPassport(actor,{owner='human:local-owner',environments}={}){return {agent_id:safeId('agent:jarvis-',actor.id),owner_id:owner,environments:(environments??actor.workspaces.map(w=>'env:'+w)).map(e=>safeId('',e))};}
export function mapActorToMandate(actor,workspace,{perActionMinor=100,totalBudgetMinor=100,approvalThresholdMinor=100,ttlSeconds}={}){
 if(!(approvalThresholdMinor<=perActionMinor&&perActionMinor<=totalBudgetMinor))fail('mandate','approval threshold <= per-action limit <= total budget is required');
 const tools=(actor.capabilities??[]).map(toolId).slice(0,50);
 const mandate={agent_id:safeId('agent:jarvis-',actor.id),owner_id:'human:local-owner',environment:safeId('env:',workspace),scopes:['tool.invoke'],resources:[safeId('workspace:',workspace)],tools,destinations:[],asset:'DEMO',per_action_minor:perActionMinor,total_budget_minor:totalBudgetMinor,approval_threshold_minor:approvalThresholdMinor};
 const errors=validateAutheoSchema('mandate',mandate);if(errors.length)fail('mandate','Mapped mandate violates mandate.v1: '+errors.join('; '));
 if(ttlSeconds!==undefined)mandate.ttl_seconds=ttlSeconds;return mandate;
}
export const mandateGrantInput=({owner_id,asset,...grant})=>grant;

const reasonCode=code=>('jarvis_'+String(code).toLowerCase().replace(/[^a-z0-9_]/g,'_')).slice(0,64);
// Policy decision in Autheo vocabulary. Inputs are JARVIS outcomes; nothing is re-decided here:
//  - approval receipt from governance.workApproval -> allow (or escalate above the mandate threshold)
//  - capability_denied / approval_denied / tool_denied -> block scope_denied; forbidden -> resource_denied
//  - budget errors -> block total_budget_limit (429 admission) / per_action_limit
export function mapGovernanceDecision({approval=null,error=null,units=approval?.units??1,mandate}){
 if(error){const code=String(error.code??'internal');const reasons=code==='capability_denied'||code==='approval_denied'||code==='tool_denied'?['scope_denied']:code==='forbidden'||code==='scope'?['resource_denied']:code==='budget'?[error.status===429?'total_budget_limit':'per_action_limit']:[reasonCode(code)];return {decision:'block',reasons,amount_minor:0,jarvis:{error:code}};}
 if(!approval)fail('decision','Approval or error required');
 if(mandate&&units>mandate.approval_threshold_minor)return {decision:'escalate',reasons:['human_review_required'],amount_minor:units,jarvis:{approvalHash:approval.hash}};
 return {decision:'allow',reasons:['within_demo_policy'],amount_minor:units,jarvis:{approvalHash:approval.hash}};
}

// Sign an agent document (request/outcome) with a runtime-held key; kid = key fingerprint (v1).
export function signAgentDocument({kind,privateKey,agentId,environment,body,ttlSeconds=60,now=nowSeconds(),jti=randomUUID()}){
 if(kind!=='request'&&kind!=='outcome')fail('kind','Agent documents are request or outcome');
 const key=typeof privateKey==='string'?createPrivateKey(privateKey):privateKey;if(key?.asymmetricKeyType!=='ed25519'||key.type!=='private')fail('key','Ed25519 private key required');
 if(!Number.isInteger(ttlSeconds)||ttlSeconds<1||ttlSeconds>MAX_TTL[kind])fail('ttl','Invalid token lifetime');
 const errors=validateAutheoSchema(kind,body);if(errors.length)fail('schema','Body does not match '+kind+'.v1: '+errors.slice(0,5).join('; '));
 if(body.agent_id!==agentId||body.environment!==environment)fail('claims','Body agent/environment must match the signer');
 const header={alg:'EdDSA',kid:keyFingerprint(key),typ:'autheo-'+kind+'+jwt'};
 const claims={iss:agentId,sub:agentId,aud:environment,iat:now,nbf:now,exp:now+ttlSeconds,jti,body};
 const input=b64json(header)+'.'+b64json(claims);return input+'.'+edSign(null,Buffer.from(input,'ascii'),key).toString('base64url');
}

// Ledger that emits receipts in the Autheo format (v1 by default; "legacy-0.1" reproduces 8106edd bodies
// for old verifiers), so the upstream Python audit CLI can verify JARVIS-issued archives. In-memory only;
// keys are ephemeral unless the caller supplies one. Receipts never claim execution (executed:false).
export class AutheoReceiptLedger{
 constructor({issuer='jarvis-local-authority',environment='env:default',kid,privateKey,ttl=86400,format='v1',clock=nowSeconds}={}){
  if(!IDENTIFIER.test(environment))fail('identifier','Invalid environment');if(!Number.isInteger(ttl)||ttl<1||ttl>MAX_TTL.receipt)fail('ttl','Invalid token lifetime');if(format!=='v1'&&format!=='legacy-0.1')fail('format','Unknown receipt format');
  this.issuer=issuer;this.environment=environment;this.ttl=ttl;this.format=format;this.clock=clock;
  if(privateKey){this.privateKey=typeof privateKey==='string'?createPrivateKey(privateKey):privateKey;}else{this.privateKey=generateKeyPairSync('ed25519').privateKey;}
  if(this.privateKey.asymmetricKeyType!=='ed25519'||this.privateKey.type!=='private')fail('key','Ed25519 private key required');
  this.publicKey=createPublicKey(this.privateKey);this.kid=kid??(privateKey?localAuthorityKid(this.publicKey):LEGACY_KID);this.tokens=[];this.events=[];
 }
 get head(){return this.events.at(-1)?.hash??ZERO_HASH;}
 publicKeyPem(){return this.publicKey.export({type:'spki',format:'pem'});}
 trustAnchor(){return {issuer:this.issuer,kid:this.kid,public_key:this.publicKeyPem(),fingerprint:keyFingerprint(this.publicKey),environment:this.environment,format:this.format};}
 issue(kind,subject,audience,body,ttl=this.ttl,now=this.clock()){if(!(kind in MAX_TTL)||!Number.isInteger(ttl)||ttl<1||ttl>MAX_TTL[kind])fail('ttl','Invalid token lifetime');const header={alg:'EdDSA',kid:this.kid,typ:'autheo-'+kind+'+jwt'};const claims={iss:this.issuer,sub:subject,aud:audience,iat:now,nbf:now,exp:now+ttl,jti:randomUUID(),body};const input=b64json(header)+'.'+b64json(claims);return input+'.'+edSign(null,Buffer.from(input,'ascii'),this.privateKey).toString('base64url');}
 record({requestId,payload,agentId,mandateId,kind='simulation',decision,reasons,amountMinor=0,checkpoint,action,resource,tool,policyId,policyDigest,reference,reportedStatus,reportedBy}){
  if(!REQUEST_ID.test(requestId))fail('identifier','Invalid request id');
  const payloadHash=autheoDigest(payload);const existing=this.events.find(e=>e.request_id===requestId);
  if(existing){if(existing.payload_hash!==payloadHash)fail('idempotency','Idempotency key reused for different request');return {...existing,replayed:true};}
  if(!RECEIPT_DECISIONS.includes(decision)||!RECEIPT_KINDS.includes(kind))fail('decision','Unknown receipt kind or decision');
  const now=this.clock();let body;
  if(this.format==='v1'){
   body={schema_version:'autheo.receipt/v1',sequence:this.events.length+1,previous_hash:this.head,request_id:requestId,payload_hash:payloadHash,agent_id:agentId,mandate_id:mandateId,kind,decision,reasons,amount_minor:amountMinor,executed:false,simulation_only:true,recorded_at:now};
   for(const [k,v] of Object.entries({action,resource,tool,policy_id:policyId,policy_digest:policyDigest,checkpoint,reference,reported_status:reportedStatus,reported_by:reportedBy}))if(v!==undefined&&v!==null)body[k]=v;
   const errors=validateAutheoSchema('receipt',body);if(errors.length)fail('schema','Receipt body violates receipt.v1: '+errors.slice(0,5).join('; '));
  }else{
   if(!['allow','escalate','block','checkpoint_only'].includes(decision)||!['simulation','handoff_export','handoff_import'].includes(kind))fail('decision','Not representable in the 0.1 format');
   body={sequence:this.events.length+1,previous_hash:this.head,request_id:requestId,payload_hash:payloadHash,agent_id:agentId,mandate_id:mandateId,kind,decision,reasons,amount_minor:amountMinor,executed:false,simulation_only:true};if(checkpoint)body.checkpoint=checkpoint;
  }
  const token=this.issue('receipt',agentId,this.environment,body,this.ttl,now);const event={...body,hash:chainHash(body.previous_hash,token)};this.tokens.push(token);this.events.push(event);return event;
 }
 // Kernel hook: Kernel.submit calls this for admitted (allow) and denied (block) governance outcomes.
 recordGovernance({actor,workspace,idempotencyKey,payloadHash=null,approval=null,error=null,operation}){
  const mandate=mapActorToMandate(actor,workspace);const d=mapGovernanceDecision({approval,error,mandate});const op=operation??approval?.capability;
  return this.record({requestId:this.requestIdFor(workspace,idempotencyKey),payload:{workspace,idempotencyKey,payloadHash,approval:approval?.hash??null,error:error?.code??null},agentId:mandate.agent_id,mandateId:'jarvis-mandate:'+autheoDigest(mandate).slice(0,32),decision:d.decision,reasons:d.reasons,amountMinor:d.amount_minor,action:this.format==='v1'&&op?'tool.invoke':undefined,tool:this.format==='v1'&&op?toolId(op):undefined,resource:this.format==='v1'?safeId('workspace:',workspace):undefined,policyId:this.format==='v1'&&approval?.policy?safeId('policy:jarvis-',approval.policy):undefined});
 }
 // Executor-reported outcome of an ALLOWED decision (v1 kind outcome_report, decision "recorded"). Like
 // upstream, it records the claim only; it proves nothing about the effect.
 recordOutcome({requestId,status,detailSha256=null}){
  if(this.format!=='v1')fail('format','Outcome receipts require the v1 format');if(!['succeeded','failed','unknown'].includes(status))fail('outcome','Unknown reported status');if(detailSha256!==null&&!HEX64.test(detailSha256))fail('outcome','detail_sha256 must be 64 lowercase hex');
  const decision=this.events.find(e=>e.request_id===requestId&&e.kind==='simulation');if(!decision)fail('outcome','No decision receipt exists for this request');if(decision.decision!=='allow')fail('outcome','Outcomes can only be recorded for allowed decisions');
  const report={schema_version:'autheo.outcome/v1',request_id:requestId,agent_id:decision.agent_id,environment:this.environment,status,...(detailSha256?{detail_sha256:detailSha256}:{})};
  return this.record({requestId:'outcome:'+requestId,payload:report,agentId:decision.agent_id,mandateId:decision.mandate_id,kind:'outcome_report',decision:'recorded',reasons:['executor_reported_'+status,'not_independently_verified'],action:decision.action,resource:decision.resource,tool:decision.tool,reference:requestId,reportedStatus:status,reportedBy:'operator_api'});
 }
 // v1 request ids may be 160 chars; the 0.1 format used the 96-char Identifier.
 requestIdFor(workspace,idempotencyKey){return safeId('jarvis:',workspace+':'+idempotencyKey,this.format==='v1'?160:96);}
 exportArchive(){return {receipts:[...this.tokens]};}
 exportLedger(){return this.events.map((e,i)=>({sequence:e.sequence,request_id:e.request_id,token:this.tokens[i],chain_hash:e.hash}));}
 verify(opts={}){return verifyReceiptArchive(this.exportArchive(),{publicKey:this.publicKey,issuer:this.issuer,environment:this.environment,kid:this.kid,...opts});}
}

// Kernel observer: records an outcome receipt when a task that has an allow receipt reaches a terminal
// state. succeeded -> succeeded, failed/timed_out -> failed, cancelled/blocked -> unknown.
export function trustOutcomeObserver(ledger){
 const map={succeeded:'succeeded',failed:'failed',timed_out:'failed',cancelled:'unknown',blocked:'unknown'};
 return task=>{if(task?.trust?.decision!=='allow'||!map[task.status])return null;const requestId=ledger.requestIdFor(task.workspace,task.idempotencyKey);if(ledger.events.some(e=>e.request_id==='outcome:'+requestId))return null;return ledger.recordOutcome({requestId,status:map[task.status],detailSha256:autheoDigest({status:task.status,result:task.result??null,failure:task.failure??null})});};
}

// Optional bridge to the upstream Python verifier. OFF by default: enabled only when
// JARVIS_AUTHEO_PYTHON points at an interpreter with autheo-agent-environment importable.
export function autheoConfigFromEnv(env=process.env){const python=env.JARVIS_AUTHEO_PYTHON;if(!python)return {enabled:false,reason:'JARVIS_AUTHEO_PYTHON not set'};return {enabled:true,python,pythonPath:env.JARVIS_AUTHEO_PYTHONPATH||undefined,timeoutMs:Math.min(Number(env.JARVIS_AUTHEO_TIMEOUT_MS)||10000,60000)};}
export async function verifyWithPythonCli(archive,{python,pythonPath,publicKeyPem,issuer,environment,expectedHead,kid,timeoutMs=10000}){if(!python)fail('disabled','Python Autheo bridge is not configured');const dir=await mkdtemp(join(tmpdir(),'jarvis-autheo-'));try{const archivePath=join(dir,'audit.json'),keyPath=join(dir,'issuer-public.pem');await writeFile(archivePath,JSON.stringify(archive));await writeFile(keyPath,publicKeyPem);const args=['-m','autheo_agent_environment.audit',archivePath,'--public-key',keyPath,'--issuer',issuer,'--environment',environment];if(expectedHead)args.push('--expected-head',expectedHead);if(kid&&kid!==LEGACY_KID)args.push('--kid',kid);const stdout=await new Promise((resolve,reject)=>execFile(python,args,{timeout:timeoutMs,maxBuffer:1<<20,env:{PATH:process.env.PATH??'',...(pythonPath?{PYTHONPATH:pythonPath}:{})}},(error,out,err)=>error?reject(new TrustError('python_verify',String(err||error.message).trim().split('\n').at(-1))):resolve(out)));return JSON.parse(stdout);}finally{await rm(dir,{recursive:true,force:true});}}
