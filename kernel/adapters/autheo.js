// Autheo trust adapter. Independently authored, MIT.
// Maps JARVIS governance decisions onto autheo-agent-environment concepts (identity/passport,
// mandate, policy decision, signed receipt) and verifies/produces its Ed25519 receipt format.
// Format source: SolutionsAsService/autheo-agent-environment@8106edd0d68747c3a17e234c967da3b5449298ec
//   src/autheo_agent_environment/signing.py (issue/verify), audit.py (verify_archive),
//   environment.py (append/read_events), models.py (identifiers, scopes).
// No Python code is copied. The optional Python CLI bridge is OFF unless explicitly configured.
import {createHash,createPublicKey,createPrivateKey,generateKeyPairSync,sign as edSign,verify as edVerify,randomUUID} from 'node:crypto';
import {execFile} from 'node:child_process';
import {writeFile,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

export const ZERO_HASH='0'.repeat(64);
export const MAX_TOKEN_BYTES=131072;
export const CLOCK_SKEW_SECONDS=2;
export const MAX_TTL=Object.freeze({passport:86400,mandate:3600,request:300,handoff:300,'trust-snapshot':300,receipt:86400});
// models.py Scope literal and Identifier pattern.
export const AUTHEO_SCOPES=Object.freeze(['marketplace.read','devhub.read','chain.read','compute.simulate','environment.handoff']);
export const IDENTIFIER=/^[A-Za-z0-9][A-Za-z0-9:._-]{0,95}$/;
const REQUIRED_CLAIMS=['iss','sub','aud','iat','nbf','exp','jti','body'];

export class TrustError extends Error{constructor(code,message){super(message);this.code=code;}}
const fail=(code,message)=>{throw new TrustError(code,message);};
const b64url=v=>Buffer.from(typeof v==='string'?v:JSON.stringify(v)).toString('base64url');
const sha256=v=>createHash('sha256').update(v).digest('hex');
const nowSeconds=()=>Math.floor(Date.now()/1000);

// signing.py digest(): json.dumps(sort_keys=True, separators=(",",":")). Python's default
// ensure_ascii=True escapes non-ASCII; reproduce that so digests match byte-for-byte.
export function canonicalJson(value){
 if(value===null||typeof value==='boolean')return JSON.stringify(value);
 if(typeof value==='number'){if(!Number.isFinite(value))fail('canonical','NaN/Infinity not allowed');if(!Number.isInteger(value))fail('canonical','Only integers are supported (Python float repr differs)');return String(value);}
 if(typeof value==='string')return JSON.stringify(value).replace(/[\u007f-\uffff]/g,c=>'\\u'+c.charCodeAt(0).toString(16).padStart(4,'0'));
 if(Array.isArray(value))return '['+value.map(canonicalJson).join(',')+']';
 if(typeof value==='object')return '{'+Object.keys(value).sort().map(k=>canonicalJson(k)+':'+canonicalJson(value[k])).join(',')+'}';
 fail('canonical','Unsupported JSON value');
}
export const autheoDigest=value=>sha256(canonicalJson(value));
export const chainHash=(previous,token)=>sha256(previous+token);

function decodeSegment(segment,label){if(typeof segment!=='string'||!/^[A-Za-z0-9_-]*$/.test(segment))fail('format','Malformed '+label);try{return JSON.parse(Buffer.from(segment,'base64url').toString('utf8'));}catch{fail('format','Malformed '+label);}}
export function readPublicKey(pem){const key=createPublicKey(pem);if(key.asymmetricKeyType!=='ed25519')fail('key','Only Ed25519 public keys are accepted');return key;}

// Mirrors signing.verify(): typ/kid/crit header checks, EdDSA only, required claims, strict string
// audience, integer timestamps, not-before skew, TTL window and nbf==iat. "historical" skips exp
// (receipts only), exactly like the Python verifier.
export function verifyToken(token,{kind,publicKey,issuer,audience,kid='demo-v1',historical=false,now=nowSeconds()}){
 if(typeof token!=='string'||Buffer.byteLength(token)>MAX_TOKEN_BYTES)fail('size','Invalid token size');
 if(historical&&kind!=='receipt')fail('historical','Historical verification is for receipts only');
 if(!(kind in MAX_TTL))fail('kind','Unknown document kind');
 const parts=token.split('.');if(parts.length!==3)fail('format','Not a compact JWS');
 const header=decodeSegment(parts[0],'header');
 if(!header||header.typ!=='autheo-'+kind+'+jwt'||header.kid!==kid||header.crit)fail('header','Invalid document type or key identifier');
 if(header.alg!=='EdDSA')fail('alg','Only EdDSA is accepted');
 const key=typeof publicKey==='string'?readPublicKey(publicKey):publicKey;if(key?.asymmetricKeyType!=='ed25519')fail('key','Only Ed25519 public keys are accepted');
 if(!/^[A-Za-z0-9_-]+$/.test(parts[2]))fail('format','Malformed signature');
 if(!edVerify(null,Buffer.from(parts[0]+'.'+parts[1]),key,Buffer.from(parts[2],'base64url')))fail('signature','Signature verification failed');
 const claims=decodeSegment(parts[1],'claims');
 if(!claims||typeof claims!=='object'||Array.isArray(claims))fail('claims','Invalid claims');
 for(const c of REQUIRED_CLAIMS)if(!(c in claims))fail('claims','Missing claim '+c);
 if(claims.iss!==issuer)fail('issuer','Invalid issuer');
 if(typeof claims.aud!=='string'||claims.aud!==audience)fail('audience','Invalid audience');
 for(const k of ['iat','nbf','exp'])if(!Number.isInteger(claims[k]))fail('time','Timestamps must be integer seconds');
 if(!historical&&claims.exp<=now)fail('expired','Signature has expired');
 if(claims.iat>now+CLOCK_SKEW_SECONDS||claims.nbf>now+CLOCK_SKEW_SECONDS)fail('immature','Token validity starts too far in the future');
 const ttl=claims.exp-claims.iat;if(!(ttl>0&&ttl<=MAX_TTL[kind])||claims.nbf!==claims.iat)fail('window','Invalid token validity window');
 if(!claims.body||typeof claims.body!=='object'||Array.isArray(claims.body)||typeof claims.jti!=='string'||!claims.jti)fail('body','Invalid document body or identifier');
 return {header,claims};
}

// Mirrors audit.verify_archive(): sequence, previous_hash link, executed===false, unique request ids,
// head=sha256(previous+token), optional independent expected head. Same result fields plus decoded receipts.
export function verifyReceiptArchive(archive,{publicKey,issuer,environment,expectedHead=null,kid='demo-v1',now}){
 if(!archive||typeof archive!=='object'||Array.isArray(archive)||Object.keys(archive).length!==1||!Array.isArray(archive.receipts))fail('archive','Invalid audit archive');
 let previous=ZERO_HASH;const ids=new Set(),receipts=[];
 archive.receipts.forEach((token,i)=>{const {claims}=verifyToken(token,{kind:'receipt',publicKey,issuer,audience:environment,kid,historical:true,now});const body=claims.body;
  if(body.sequence!==i+1||body.previous_hash!==previous||body.executed!==false||ids.has(body.request_id))fail('chain','Audit chain integrity failure');
  ids.add(body.request_id);previous=chainHash(previous,token);receipts.push({...body,hash:previous,jti:claims.jti,subject:claims.sub});});
 const matched=expectedHead!==null&&expectedHead!==undefined;
 if(matched&&previous!==expectedHead)fail('head','Audit head differs from external checkpoint');
 return {signature_chain_verified:true,count:ids.size,head:previous,immutable:false,actual_actions_proven:false,external_checkpoint_matched:matched,receipts};
}

const safeId=(prefix,value)=>{const id=(prefix+String(value).replace(/[^A-Za-z0-9:._-]/g,'-')).slice(0,96);if(!IDENTIFIER.test(id))fail('identifier','Cannot form Autheo identifier');return id;};

// JARVIS -> Autheo concept map. JARVIS actors become passport subjects; actor workspace/capability
// grants become a mandate. Autheo scopes are a closed set, so JARVIS capabilities are carried as
// mandate resources and the action is the closest Autheo scope, compute.simulate. JARVIS has no
// money: governance "units" map to DEMO minor units only as an accounting analogy.
export function mapActorToPassport(actor,{owner='human:local-owner',environments}={}){return {agent_id:safeId('agent:jarvis-',actor.id),owner_id:owner,environments:(environments??actor.workspaces.map(w=>'env:'+w)).map(e=>safeId('',e))};}
export function mapActorToMandate(actor,workspace,{perActionMinor=100,totalBudgetMinor=100,approvalThresholdMinor=100}={}){if(!(approvalThresholdMinor<=perActionMinor&&perActionMinor<=totalBudgetMinor))fail('mandate','approval threshold <= per-action limit <= total budget is required');const resources=(actor.capabilities??[]).map(c=>safeId('capability:',c)).slice(0,50);return {agent_id:safeId('agent:jarvis-',actor.id),owner_id:'human:local-owner',environment:safeId('env:',workspace),scopes:['compute.simulate'],resources:resources.length?resources:['capability:none'],destinations:[],asset:'DEMO',per_action_minor:perActionMinor,total_budget_minor:totalBudgetMinor,approval_threshold_minor:approvalThresholdMinor};}

// Policy decision in Autheo vocabulary. Inputs are JARVIS outcomes; nothing is re-decided here:
//  - approval receipt from governance.workApproval -> allow (or escalate above the mandate threshold)
//  - capability_denied / approval_denied -> block scope_denied; forbidden -> block resource_denied
//  - budget errors -> block total_budget_limit (429 admission) / per_action_limit
export function mapGovernanceDecision({approval=null,error=null,units=approval?.units??1,mandate}){
 if(error){const code=String(error.code??'internal');const reasons=code==='capability_denied'||code==='approval_denied'||code==='tool_denied'?['scope_denied']:code==='forbidden'||code==='scope'?['resource_denied']:code==='budget'?[error.status===429?'total_budget_limit':'per_action_limit']:['jarvis_'+code.replace(/[^a-z0-9_]/gi,'_')];return {decision:'block',reasons,amount_minor:0,jarvis:{error:code}};}
 if(!approval)fail('decision','Approval or error required');
 if(mandate&&units>mandate.approval_threshold_minor)return {decision:'escalate',reasons:['human_review_required'],amount_minor:units,jarvis:{approvalHash:approval.hash}};
 return {decision:'allow',reasons:['within_demo_policy'],amount_minor:units,jarvis:{approvalHash:approval.hash}};
}

// Ledger that emits tokens in exactly the Autheo receipt format, so the upstream Python
// autheo_agent_environment.audit CLI can verify JARVIS-issued archives. In-memory only; keys are
// ephemeral unless the caller supplies one. Receipts never claim execution (executed:false), matching
// the upstream invariant that a receipt records a decision, not a performed action.
export class AutheoReceiptLedger{
 constructor({issuer='jarvis-local-authority',environment='env:default',kid='demo-v1',privateKey,ttl=86400}={}){if(!IDENTIFIER.test(environment))fail('identifier','Invalid environment');if(!Number.isInteger(ttl)||ttl<1||ttl>MAX_TTL.receipt)fail('ttl','Invalid token lifetime');this.issuer=issuer;this.environment=environment;this.kid=kid;this.ttl=ttl;if(privateKey){this.privateKey=typeof privateKey==='string'?createPrivateKey(privateKey):privateKey;this.publicKey=createPublicKey(this.privateKey);}else{const pair=generateKeyPairSync('ed25519');this.privateKey=pair.privateKey;this.publicKey=pair.publicKey;}if(this.privateKey.asymmetricKeyType!=='ed25519')fail('key','Ed25519 key required');this.tokens=[];this.events=[];}
 get head(){return this.events.at(-1)?.hash??ZERO_HASH;}
 publicKeyPem(){return this.publicKey.export({type:'spki',format:'pem'});}
 issue(kind,subject,audience,body,ttl=this.ttl,now=nowSeconds()){if(!(kind in MAX_TTL)||!Number.isInteger(ttl)||ttl<1||ttl>MAX_TTL[kind])fail('ttl','Invalid token lifetime');const header={alg:'EdDSA',kid:this.kid,typ:'autheo-'+kind+'+jwt'};const claims={iss:this.issuer,sub:subject,aud:audience,iat:now,nbf:now,exp:now+ttl,jti:randomUUID(),body};const input=b64url(header)+'.'+b64url(claims);return input+'.'+edSign(null,Buffer.from(input),this.privateKey).toString('base64url');}
 record({requestId,payload,agentId,mandateId,kind='simulation',decision,reasons,amountMinor=0,checkpoint}){if(!IDENTIFIER.test(requestId))fail('identifier','Invalid request id');const payloadHash=autheoDigest(payload);const existing=this.events.find(e=>e.request_id===requestId);if(existing){if(existing.payload_hash!==payloadHash)fail('idempotency','Idempotency key reused for different request');return {...existing,replayed:true};}if(!['allow','escalate','block','checkpoint_only'].includes(decision))fail('decision','Unknown decision');const body={sequence:this.events.length+1,previous_hash:this.head,request_id:requestId,payload_hash:payloadHash,agent_id:agentId,mandate_id:mandateId,kind,decision,reasons,amount_minor:amountMinor,executed:false,simulation_only:true};if(checkpoint)body.checkpoint=checkpoint;const token=this.issue('receipt',agentId,this.environment,body);const event={...body,hash:chainHash(body.previous_hash,token)};this.tokens.push(token);this.events.push(event);return event;}
 // Kernel hook: Kernel.submit calls this for admitted (allow) and denied (block) governance outcomes.
 recordGovernance({actor,workspace,idempotencyKey,payloadHash=null,approval=null,error=null}){const mandate=mapActorToMandate(actor,workspace);const d=mapGovernanceDecision({approval,error,mandate});return this.record({requestId:safeId('jarvis:',workspace+':'+idempotencyKey),payload:{workspace,idempotencyKey,payloadHash,approval:approval?.hash??null,error:error?.code??null},agentId:mandate.agent_id,mandateId:'jarvis-mandate:'+autheoDigest(mandate).slice(0,32),decision:d.decision,reasons:d.reasons,amountMinor:d.amount_minor});}
 exportArchive(){return {receipts:[...this.tokens]};}
 verify(opts={}){return verifyReceiptArchive(this.exportArchive(),{publicKey:this.publicKey,issuer:this.issuer,environment:this.environment,kid:this.kid,...opts});}
}

// Optional bridge to the upstream Python verifier. OFF by default: enabled only when
// JARVIS_AUTHEO_PYTHON points at an interpreter with autheo-agent-environment installed.
export function autheoConfigFromEnv(env=process.env){const python=env.JARVIS_AUTHEO_PYTHON;if(!python)return {enabled:false,reason:'JARVIS_AUTHEO_PYTHON not set'};return {enabled:true,python,pythonPath:env.JARVIS_AUTHEO_PYTHONPATH||undefined,timeoutMs:Math.min(Number(env.JARVIS_AUTHEO_TIMEOUT_MS)||10000,60000)};}
export async function verifyWithPythonCli(archive,{python,pythonPath,publicKeyPem,issuer,environment,expectedHead,timeoutMs=10000}){if(!python)fail('disabled','Python Autheo bridge is not configured');const dir=await mkdtemp(join(tmpdir(),'jarvis-autheo-'));try{const archivePath=join(dir,'audit.json'),keyPath=join(dir,'issuer-public.pem');await writeFile(archivePath,JSON.stringify(archive));await writeFile(keyPath,publicKeyPem);const args=['-m','autheo_agent_environment.audit',archivePath,'--public-key',keyPath,'--issuer',issuer,'--environment',environment];if(expectedHead)args.push('--expected-head',expectedHead);const stdout=await new Promise((resolve,reject)=>execFile(python,args,{timeout:timeoutMs,maxBuffer:1<<20,env:{PATH:process.env.PATH??'',...(pythonPath?{PYTHONPATH:pythonPath}:{})}},(error,out,err)=>error?reject(new TrustError('python_verify',String(err||error.message).trim().split('\n').at(-1))):resolve(out)));return JSON.parse(stdout);}finally{await rm(dir,{recursive:true,force:true});}}
