import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,rm,writeFile} from 'node:fs/promises';
import {createHash,createPrivateKey,createPublicKey,generateKeyPairSync} from 'node:crypto';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {spawn,execFile} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {verifyToken,verifyAgentDocument,verifyReceiptArchive,verifyReceiptChain,canonicalJson,autheoDigest,chainHash,keyFingerprint,localAuthorityKid,signAgentDocument,AutheoReceiptLedger,trustOutcomeObserver,mapActorToMandate,mapActorToPassport,mandateGrantInput,autheoConfigFromEnv,verifyWithPythonCli,AUTHEO_SPEC_REVISION,MAX_TTL,ZERO_HASH} from '../kernel/adapters/autheo.js';
import {validateAutheoSchema,AUTHEO_SCHEMAS} from '../kernel/adapters/autheo-schema.js';
import {createAutheoClient,autheoApiConfigFromEnv,normalizeAutheoUrl} from '../kernel/adapters/autheo-client.js';
import {adaptersFromEnv} from '../kernel/startup.js';
import {Kernel} from '../kernel/kernel.js';
import {createKernelServer} from '../kernel/http.js';

// Copied unchanged from autheo-agent-environment@68bfb55 (see test/fixtures/autheo-v1/README.md).
const VECTOR_SHA256='038970ad331cf6cc41dda671533cff1efc62d5ae1ee096380470be9cb3de712f';
const vectorBytes=await readFile(new URL('./fixtures/autheo-v1/autheo-v1-vectors.json',import.meta.url));
const vectors=JSON.parse(vectorBytes);
const legacy=JSON.parse(await readFile(new URL('./fixtures/autheo-demo/source-audit.json',import.meta.url),'utf8'));
const legacyPem=await readFile(new URL('./fixtures/autheo-demo/issuer-public.pem',import.meta.url),'utf8');
const actor={id:'local-owner',tenant:'local',workspaces:['default'],capabilities:['text.digest']};
const seedKey=hex=>createPrivateKey({key:Buffer.concat([Buffer.from('302e020100300506032b657004220420','hex'),Buffer.from(hex,'hex')]),format:'der',type:'pkcs8'});
const claimsOf=token=>JSON.parse(Buffer.from(token.split('.')[1],'base64url'));
const swapPayload=(token,mutate)=>{const [h,,s]=token.split('.');const c=claimsOf(token);mutate(c);return h+'.'+Buffer.from(JSON.stringify(c)).toString('base64url')+'.'+s;};

test('vector fixture is the recorded upstream file',async()=>{
 assert.equal(createHash('sha256').update(vectorBytes).digest('hex'),VECTOR_SHA256);
 assert.equal(vectors.version,'autheo-test-vectors/v1');assert.equal(vectors.canonical_json,'autheo-cjson/1');
 const readme=await readFile(new URL('./fixtures/autheo-v1/README.md',import.meta.url),'utf8');
 assert.ok(readme.includes(AUTHEO_SPEC_REVISION)&&readme.includes(VECTOR_SHA256));
});

test('v1 canonical JSON vectors: bytes, digests and rejections',()=>{
 let n=0;for(const item of vectors.canonical){if(item.error){assert.throws(()=>canonicalJson(JSON.parse(item.json)),{code:'canonical'},item.name);}else{assert.equal(canonicalJson(item.value),item.canonical,item.name);assert.equal(autheoDigest(item.value),item.sha256,item.name);}n++;}
 assert.equal(n,vectors.canonical.length);
 assert.equal(autheoDigest(vectors.documents.find(d=>d.name==='passport').token),vectors.digests.passport_digest);
 assert.equal(autheoDigest(vectors.digests.default_policy),vectors.digests.default_policy_digest);
});

test('v1 document vectors: every valid token verifies and every invalid token fails with the expected error class',()=>{
 for(const doc of vectors.documents){const key=vectors.keys[doc.key];
  for(const publicKey of [key.public_key_pem,key.jwk]){
   const run=()=>verifyToken(doc.token,{kind:doc.kind,publicKey,issuer:doc.issuer,audience:doc.audience,kid:key.kid,now:doc.verify_at,historical:doc.historical,skew:vectors.clock_skew_seconds});
   if(doc.expect_valid){const r=run();assert.equal(r.header.typ,doc.typ,doc.name);assert.equal(r.format,'v1',doc.name);}
   else assert.throws(run,e=>e.spec===doc.expect_error,doc.name+' expects '+doc.expect_error);
  }
 }
 assert.equal(vectors.documents.filter(d=>d.expect_valid).length,6);assert.equal(vectors.documents.filter(d=>!d.expect_valid).length,8);
});

test('v1 keys: seeds, raw keys, JWK x and agent kid fingerprints agree; agent documents verify by fingerprint kid',()=>{
 for(const key of Object.values(vectors.keys)){const priv=seedKey(key.TEST_ONLY_private_seed_hex);const pub=createPublicKey(priv);
  assert.equal(pub.export({type:'spki',format:'pem'}),key.public_key_pem);assert.equal(pub.export({format:'jwk'}).x,key.jwk.x);assert.equal(Buffer.from(key.jwk.x,'base64url').toString('hex'),key.public_key_raw_hex);}
 const agent=vectors.keys['agent:vector-01'];assert.equal(keyFingerprint(agent.public_key_pem),agent.kid);
 for(const name of ['request_agent_signed','outcome_agent_signed']){const doc=vectors.documents.find(d=>d.name===name);
  const r=verifyAgentDocument(doc.token,{kind:doc.kind,publicKey:agent.public_key_pem,agentId:'agent:vector-01',environment:doc.audience,now:doc.verify_at});assert.equal(r.kidKind,'fingerprint');}
 const authority=vectors.keys['autheo-test-authority'];assert.match(localAuthorityKid(authority.public_key_pem),/^local-[A-Za-z0-9_-]{16}$/);
 // JARVIS signer reproduces a verifiable agent request with the vector key.
 const body={...claimsOf(vectors.documents.find(d=>d.name==='request_agent_signed').token).body,request_id:'req:jarvis-sign'};
 const token=signAgentDocument({kind:'request',privateKey:seedKey(agent.TEST_ONLY_private_seed_hex),agentId:'agent:vector-01',environment:'env:research',body,now:1790000000});
 assert.equal(verifyAgentDocument(token,{kind:'request',publicKey:agent.jwk,agentId:'agent:vector-01',environment:'env:research',now:1790000010}).claims.body.request_id,'req:jarvis-sign');
 assert.throws(()=>verifyAgentDocument(token,{kind:'request',publicKey:authority.public_key_pem,agentId:'agent:vector-01',environment:'env:research',now:1790000010}),{spec:'bad_header'});
 assert.throws(()=>signAgentDocument({kind:'request',privateKey:seedKey(agent.TEST_ONLY_private_seed_hex),agentId:'agent:vector-01',environment:'env:research',body:{...body,extra:1}}),{code:'schema'});
 assert.equal(MAX_TTL.outcome,300);
});

test('v1 receipt chain and tampered chain vectors',()=>{
 const key=vectors.keys[vectors.chain.issuer];const opts={publicKey:key.public_key_pem,issuer:vectors.chain.issuer,environment:vectors.chain.environment,kid:key.kid};
 assert.equal(vectors.chain.genesis_previous_hash,ZERO_HASH);
 const ok=verifyReceiptChain(vectors.chain.receipts,opts);assert.equal(ok.valid,true);assert.equal(ok.head,vectors.chain.head);assert.equal(ok.count,vectors.chain.receipts.length);
 for(const row of vectors.chain.receipts){assert.deepEqual(claimsOf(row.token).body,row.body);assert.equal(chainHash(row.previous_hash,row.token),row.chain_hash);assert.deepEqual(validateAutheoSchema('ledger-entry',{sequence:row.sequence,request_id:row.request_id,token:row.token,chain_hash:row.chain_hash}),[]);}
 const bad=verifyReceiptChain(vectors.tampered_chain.receipts,opts);assert.equal(bad.valid,false);assert.equal(bad.firstInvalidSequence,vectors.tampered_chain.first_invalid_sequence);
 const archive=verifyReceiptArchive({receipts:vectors.chain.receipts.map(r=>r.token)},{...opts,expectedHead:vectors.chain.head});assert.deepEqual(archive.formats,{v1:4});assert.equal(archive.external_checkpoint_matched,true);
 assert.equal(verifyReceiptChain(vectors.chain.receipts.slice(0,3),{...opts,expectedHead:vectors.chain.head}).error.code,'head');
 assert.equal(verifyReceiptChain([vectors.chain.receipts[1],vectors.chain.receipts[0]],opts).firstInvalidSequence,1);
});

test('vendored v1 schemas validate every vector body and reject drift',async()=>{
 assert.equal(Object.keys(AUTHEO_SCHEMAS).length,12);
 const ledger=JSON.parse(await readFile(new URL('../kernel/vendor/autheo/ledger.json',import.meta.url),'utf8'));assert.equal(ledger.length,14);
 for(const entry of ledger){assert.equal(entry.revision,AUTHEO_SPEC_REVISION);assert.equal(createHash('sha256').update(await readFile(new URL('../'+entry.localPath,import.meta.url))).digest('hex'),entry.sha256,entry.localPath);}
 for(const doc of vectors.documents.filter(d=>d.name!=='mandate_presented_as_receipt'))assert.deepEqual(validateAutheoSchema(doc.kind,claimsOf(doc.token).body),[],doc.name);
 assert.deepEqual(validateAutheoSchema('policy',vectors.digests.default_policy),[]);
 const body=vectors.chain.receipts[0].body;
 assert.ok(validateAutheoSchema('receipt',{...body,unknown:true}).some(e=>e.includes('unknown')));
 assert.ok(validateAutheoSchema('receipt',{...body,executed:true}).length>0);
 assert.ok(validateAutheoSchema('receipt',{...body,amount_minor:1.5}).length>0);
 const {recorded_at,...noTime}=body;assert.ok(validateAutheoSchema('receipt',noTime).some(e=>e.includes('recorded_at')));
});

test('backward compatibility: 8106edd (0.1) receipts verify as legacy-0.1 and can be refused explicitly',()=>{
 const opts={publicKey:legacyPem,issuer:'autheo-demo-authority',environment:'env:research'};
 const r=verifyReceiptArchive(legacy,opts);assert.deepEqual(r.formats,{'legacy-0.1':4});assert.ok(r.receipts.every(x=>x.format==='legacy-0.1'));
 assert.throws(()=>verifyReceiptArchive(legacy,{...opts,allowLegacy:false}),{code:'schema'});
 // A v1 body that claims schema_version must satisfy the v1 schema; a forged legacy body still needs a valid signature.
 assert.throws(()=>verifyReceiptArchive({receipts:[swapPayload(legacy.receipts[0],c=>{delete c.body.executed;})]},opts),{code:'signature'});
});

test('JARVIS ledger emits schema-valid v1 receipts (and 0.1 bodies on request) that verify as chains',()=>{
 const ledger=new AutheoReceiptLedger({environment:'env:default'});
 const a=ledger.recordGovernance({actor,workspace:'default',idempotencyKey:'v1-a',payloadHash:'p',approval:{hash:'abc',units:1,capability:'text.digest',policy:'gm-bounded-v1'}});
 const b=ledger.recordGovernance({actor,workspace:'default',idempotencyKey:'v1-b',error:{code:'capability_denied'},operation:'shell.exec'});
 const o=ledger.recordOutcome({requestId:a.request_id,status:'succeeded',detailSha256:'a'.repeat(64)});
 assert.equal(a.schema_version,'autheo.receipt/v1');assert.equal(a.action,'tool.invoke');assert.equal(a.tool,'jarvis:text.digest');assert.equal(a.resource,'workspace:default');assert.equal(a.policy_id,'policy:jarvis-gm-bounded-v1');assert.equal(b.tool,'jarvis:shell.exec');
 assert.equal(o.kind,'outcome_report');assert.equal(o.decision,'recorded');assert.equal(o.request_id,'outcome:'+a.request_id);assert.equal(o.reference,a.request_id);
 assert.throws(()=>ledger.recordOutcome({requestId:b.request_id,status:'succeeded'}),{code:'outcome'});
 for(const token of ledger.tokens)assert.deepEqual(validateAutheoSchema('receipt',claimsOf(token).body),[]);
 const chain=verifyReceiptChain(ledger.exportLedger(),{publicKey:ledger.publicKeyPem(),issuer:ledger.issuer,environment:ledger.environment,kid:ledger.kid,allowLegacy:false});assert.equal(chain.valid,true);assert.equal(chain.head,ledger.head);
 assert.deepEqual(ledger.verify({allowLegacy:false}).formats,{v1:3});
 const old=new AutheoReceiptLedger({environment:'env:default',format:'legacy-0.1'});old.recordGovernance({actor,workspace:'default',idempotencyKey:'old',approval:{hash:'h',units:1,capability:'text.digest'}});
 assert.equal('schema_version' in old.events[0],false);assert.deepEqual(old.verify().formats,{'legacy-0.1':1});assert.throws(()=>old.recordOutcome({requestId:old.events[0].request_id,status:'succeeded'}),{code:'format'});
 const {privateKey}=generateKeyPairSync('ed25519');const persistent=new AutheoReceiptLedger({privateKey:privateKey.export({type:'pkcs8',format:'pem'})});assert.match(persistent.kid,/^local-/);
});

test('kernel records allow then outcome receipts through the startup observer',async()=>{
 const {trust,observers,summary}=adaptersFromEnv({JARVIS_AUTHEO_ENABLED:'1',JARVIS_AUTHEO_ENVIRONMENT:'env:default'});
 assert.equal(summary.autheo.enabled,true);assert.equal(summary.autheo.ephemeralKey,true);assert.equal(summary.autheo.outcomeReceipts,true);assert.equal(summary.paperclip.enabled,false);
 const kernel=new Kernel({trust,observers});
 try{const task=kernel.submit(actor,{workspace:'default',idempotencyKey:'obs-1',text:'hello'});await kernel.drain(actor);assert.equal(kernel.read(actor,task.id).status,'succeeded');
  await new Promise(r=>setImmediate(r));
  const v=trust.verify({allowLegacy:false});assert.deepEqual(v.receipts.map(r=>r.kind),['simulation','outcome_report']);assert.equal(v.receipts[1].reported_status,'succeeded');
 }finally{await kernel.close();}
});

test('startup flags: everything off by default; Autheo/Paperclip/API wiring and config errors',async()=>{
 const off=adaptersFromEnv({});assert.equal(off.trust,null);assert.equal(off.observers.length,0);assert.equal(off.autheoApi,null);assert.equal(off.paperclip,null);
 assert.throws(()=>adaptersFromEnv({JARVIS_PAPERCLIP_ENABLED:'1'}),{code:'paperclip_config'});
 assert.throws(()=>adaptersFromEnv({JARVIS_AUTHEO_API_ENABLED:'1'}),{code:'autheo_config'});
 assert.throws(()=>adaptersFromEnv({JARVIS_AUTHEO_ENABLED:'1',JARVIS_AUTHEO_FORMAT:'v9'}),{code:'format'});
 const files={'/k.pem':generateKeyPairSync('ed25519').privateKey.export({type:'pkcs8',format:'pem'}),'/token':'file-token-0123456789\n'};
 const calls=[];const fetcher=async(url,init)=>{calls.push({url,init});return new Response(JSON.stringify({id:'00000000-0000-4000-8000-000000000001',identifier:'JAR-1',status:'todo'}),{status:201,headers:{'content-type':'application/json'}});};
 const on=adaptersFromEnv({JARVIS_AUTHEO_ENABLED:'1',JARVIS_AUTHEO_PRIVATE_KEY_FILE:'/k.pem',JARVIS_AUTHEO_OUTCOMES:'0',JARVIS_AUTHEO_API_ENABLED:'1',JARVIS_AUTHEO_API_TOKEN_FILE:'/token',JARVIS_PAPERCLIP_ENABLED:'1',JARVIS_PAPERCLIP_URL:'http://127.0.0.1:3100',JARVIS_PAPERCLIP_COMPANY_ID:'company-1'},{readFile:p=>files[p],fetcher});
 assert.match(on.summary.autheo.kid,/^local-/);assert.equal(on.summary.autheo.ephemeralKey,false);assert.equal(on.summary.autheo.outcomeReceipts,false);
 assert.equal(on.summary.autheoApi.baseUrl,'http://127.0.0.1:8780');assert.equal(on.summary.autheoApi.gatesKernel,false);assert.equal(JSON.stringify(on.summary).includes('file-token'),false);
 assert.equal(on.observers.length,1);const kernel=new Kernel({trust:on.trust,observers:on.observers});
 try{kernel.submit(actor,{workspace:'default',idempotencyKey:'pc-1',text:'x'});await on.paperclip.queue;assert.equal(calls[0].url,'http://127.0.0.1:3100/api/companies/company-1/issues');assert.equal(on.paperclip.issues.size,1);}finally{await kernel.close();}
});

test('kernel HTTP exposes adapter flags in health and trust evidence at /api/trust',async()=>{
 const adapters=adaptersFromEnv({JARVIS_AUTHEO_ENABLED:'1'});const kernel=new Kernel({trust:adapters.trust,observers:adapters.observers});const token='test-only-token-long-enough-000';
 const server=createKernelServer({kernel,tokens:[{token,actor}],adapters});server.listen(0,'127.0.0.1');await once(server,'listening');const origin='http://127.0.0.1:'+server.address().port;
 const call=(path,body)=>fetch(origin+path,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});
 try{assert.deepEqual((await (await call('/api/health')).json()).adapters,{autheo:true,autheoApi:false,paperclip:false,dada:false,gmMcp:false,last30days:false,ponytail:false,jcodemunch:false,playwrightMcp:false});
  await call('/api/tasks',{workspace:'default',idempotencyKey:'http-trust',text:'x'});await server.kernelIdle();await new Promise(r=>setImmediate(r));
  const trust=await (await call('/api/trust')).json();assert.equal(trust.autheo.verified,true);assert.equal(trust.autheo.count,2);assert.deepEqual(trust.autheo.formats,{v1:2});assert.equal(trust.autheo.anchor.kid,'demo-v1');assert.equal(trust.paperclip.enabled,false);
  assert.equal((await fetch(origin+'/api/trust')).status,401);
 }finally{await server.shutdown();}
});

// In-process stand-in for the Autheo loopback API (routes, auth, Host rule and response shapes follow
// autheo-agent-environment@68bfb55 api.py/service.py). It is a fixture, not Autheo; the live Python
// service is exercised by the optional cross-check test below.
async function mockAutheo({token,tamper=false}){
 const authority=new AutheoReceiptLedger({issuer:'autheo-local-authority',environment:'env:default',privateKey:generateKeyPairSync('ed25519').privateKey});
 const agents=new Map(),mandates=new Map();const log=[];
 const server=createServer(async(req,res)=>{let raw='';for await(const c of req)raw+=c;log.push({method:req.method,url:req.url,auth:req.headers.authorization,host:req.headers.host});
  const send=(s,d)=>{res.writeHead(s,{'content-type':'application/json'});res.end(JSON.stringify(d));};
  if(req.headers.host!=='127.0.0.1:'+server.address().port)return send(421,{error:'loopback_host_required'});
  if(req.url==='/v1/health')return send(200,{status:'ok',version:'0.2.0',mode:'local_reference',executes_actions:false});
  if(req.headers.authorization!=='Bearer '+token)return send(401,{error:'bearer_token_required'});
  const body=raw?JSON.parse(raw):{};
  if(req.url==='/v1/info')return send(200,{issuer:authority.issuer,kid:authority.kid,public_key:authority.publicKeyPem(),environments:['env:default']});
  if(req.url==='/v1/identities'){agents.set(body.agent_id,body.public_key);return send(200,{agent_id:body.agent_id,key_fingerprint:keyFingerprint(body.public_key),receipts:[]});}
  if(req.url==='/v1/mandates'){const id='00000000-0000-4000-8000-00000000000'+(mandates.size+1);mandates.set(id,body);return send(200,{mandate_id:id,mandate:body,receipt:null,receipt_token:null});}
  if(req.url==='/v1/evaluate'){try{const claims=claimsOf(body.request_token);const r=verifyAgentDocument(body.request_token,{kind:'request',publicKey:agents.get(claims.sub),agentId:claims.sub,environment:'env:default'});const m=mandates.get(r.claims.body.mandate_id);const allow=m&&(m.tools??[]).includes(r.claims.body.tool);
   const receipt=authority.record({requestId:r.claims.body.request_id,payload:r.claims.body,agentId:claims.sub,mandateId:r.claims.body.mandate_id,decision:allow?'allow':'block',reasons:allow?['within_demo_policy']:['tool_denied'],action:r.claims.body.action,resource:r.claims.body.resource,tool:r.claims.body.tool});
   let receiptToken=authority.tokens.at(-1);if(tamper)receiptToken=swapPayload(receiptToken,c=>{c.body.decision='allow';});
   return send(200,{decision:null,outcome:receipt.decision,reasons:receipt.reasons,replayed:false,request_proof:'agent_signed_request',executed:false,receipt,receipt_token:receiptToken});}catch(e){return send(400,{error:'validation_error',detail:e.message});}}
  return send(404,{error:'not_found'});});
 server.listen(0,'127.0.0.1');await once(server,'listening');
 return {url:'http://127.0.0.1:'+server.address().port,authority,log,close:()=>new Promise(r=>server.close(r))};
}

test('Autheo API client: config from env, loopback-only URLs, signed evaluate with pinned-anchor receipt verification, fail-closed errors',async()=>{
 assert.equal(autheoApiConfigFromEnv({}),null);
 assert.throws(()=>autheoApiConfigFromEnv({JARVIS_AUTHEO_API_ENABLED:'1',JARVIS_AUTHEO_API_TOKEN:'t',JARVIS_AUTHEO_ANCHOR_KID:'k'}),{code:'autheo_config'});
 for(const bad of ['https://autheo.example','http://10.0.0.2:8780','http://u:p@127.0.0.1:8780','http://127.0.0.1:8780/?x=1'])assert.throws(()=>normalizeAutheoUrl(bad),{code:'autheo_config'});
 assert.equal(normalizeAutheoUrl('http://localhost:8780/v1/'),'http://localhost:8780');
 const token='autheo-test-token-0123456789';const svc=await mockAutheo({token});
 try{
  const unpinned=createAutheoClient({baseUrl:svc.url,token});assert.equal((await unpinned.health()).executes_actions,false);assert.equal(svc.log[0].auth,undefined);
  await assert.rejects(unpinned.pinAnchorFromInfo(),{code:'autheo_anchor'});
  const anchor={publicKey:svc.authority.publicKeyPem(),kid:svc.authority.kid,issuer:svc.authority.issuer};
  const cfg=autheoApiConfigFromEnv({JARVIS_AUTHEO_API_ENABLED:'1',JARVIS_AUTHEO_API_URL:svc.url,JARVIS_AUTHEO_API_TOKEN:token,JARVIS_AUTHEO_ANCHOR_PUBLIC_KEY_FILE:'/a.pem',JARVIS_AUTHEO_ANCHOR_KID:anchor.kid,JARVIS_AUTHEO_ANCHOR_ISSUER:anchor.issuer},{readFile:()=>anchor.publicKey});
  const client=createAutheoClient(cfg);assert.equal((await client.pinAnchorFromInfo()).kid,anchor.kid);
  const {privateKey,publicKey}=generateKeyPairSync('ed25519');const passport=mapActorToPassport(actor);
  await client.issueIdentity({...passport,public_key:publicKey.export({type:'spki',format:'pem'})});
  const mandate=mapActorToMandate(actor,'default');const grant=await client.grantMandate(mandateGrantInput(mandate));assert.equal(grant.receipt_verified,null);
  const common={privateKey,agentId:passport.agent_id,environment:'env:default',mandateId:grant.mandate_id,action:'tool.invoke',resource:'workspace:default'};
  const allowed=await client.evaluateAction({...common,tool:'jarvis:text.digest'});assert.equal(allowed.allow,true);assert.equal(allowed.receipt_verified.format,'v1');assert.equal(allowed.receipt_verified.decision,'allow');
  const blocked=await client.evaluateAction({...common,tool:'jarvis:shell.exec'});assert.equal(blocked.allow,false);assert.equal(blocked.outcome,'block');
  assert.ok(svc.log.filter(l=>l.url!=='/v1/health').every(l=>l.auth==='Bearer '+token));
  await assert.rejects(createAutheoClient({baseUrl:svc.url,token:'wrong-token-0123456789'}).info(),{code:'autheo_auth',status:401});
  await assert.rejects(client.evaluate({request_token:'x',request:{}}),{code:'autheo_input'});
  const other={publicKey:generateKeyPairSync('ed25519').publicKey.export({type:'spki',format:'pem'}),kid:anchor.kid,issuer:anchor.issuer};
  await assert.rejects(createAutheoClient({baseUrl:svc.url,token,anchor:other}).pinAnchorFromInfo(),{code:'autheo_anchor'});
  await assert.rejects(createAutheoClient({baseUrl:svc.url,token,anchor:other}).evaluateAction({...common,tool:'jarvis:text.digest'}),{code:'autheo_receipt'});
 }finally{await svc.close();}
 const tampered=await mockAutheo({token,tamper:true});
 try{const client=createAutheoClient({baseUrl:tampered.url,token,anchor:{publicKey:tampered.authority.publicKeyPem(),kid:tampered.authority.kid,issuer:tampered.authority.issuer}});
  const {privateKey,publicKey}=generateKeyPairSync('ed25519');await client.issueIdentity({...mapActorToPassport(actor),public_key:publicKey.export({type:'spki',format:'pem'})});const grant=await client.grantMandate(mandateGrantInput(mapActorToMandate(actor,'default')));
  await assert.rejects(client.evaluateAction({privateKey,agentId:'agent:jarvis-local-owner',environment:'env:default',mandateId:grant.mandate_id,action:'tool.invoke',resource:'workspace:default',tool:'jarvis:shell.exec'}),{code:'autheo_receipt'});
 }finally{await tampered.close();}
 await assert.rejects(createAutheoClient({baseUrl:'http://127.0.0.1:9',token,timeoutMs:500}).info(),{code:'autheo_unreachable'});
});

// ---- Optional cross-check against the upstream Python implementation (off unless JARVIS_AUTHEO_PYTHON is set).
const bridge=autheoConfigFromEnv();
const skip=bridge.enabled?false:'set JARVIS_AUTHEO_PYTHON (and JARVIS_AUTHEO_PYTHONPATH) to an autheo-agent-environment 0.2 interpreter';
const pyEnv={PATH:process.env.PATH??'',...(bridge.pythonPath?{PYTHONPATH:bridge.pythonPath}:{})};
const runPy=(args,input)=>new Promise((resolve,reject)=>{const p=execFile(bridge.python,args,{env:pyEnv,timeout:30000,maxBuffer:1<<22},(e,out,err)=>e?reject(new Error(String(err||e.message))):resolve(out));if(input!==undefined)p.stdin.end(input);});

test('Python 0.2: vectors check, ReceiptBody accepts JARVIS v1 bodies, audit CLI verifies JARVIS v1 and 0.1 archives',{skip},async()=>{
 const checked=await runPy(['-m','autheo_agent_environment','vectors','check',new URL('./fixtures/autheo-v1/autheo-v1-vectors.json',import.meta.url).pathname]);assert.ok(checked.length>=0);
 const {privateKey}=generateKeyPairSync('ed25519');const ledger=new AutheoReceiptLedger({environment:'env:default',privateKey});
 const a=ledger.recordGovernance({actor,workspace:'default',idempotencyKey:'py1',approval:{hash:'abc',units:1,capability:'text.digest',policy:'gm-bounded-v1'}});
 ledger.recordGovernance({actor,workspace:'default',idempotencyKey:'py2',error:{code:'budget',status:429},operation:'text.digest'});ledger.recordOutcome({requestId:a.request_id,status:'failed'});
 const bodies=ledger.tokens.map(t=>claimsOf(t).body);
 const out=await runPy(['-c','import json,sys\nfrom autheo_agent_environment.models import ReceiptBody\nfor b in json.load(sys.stdin):\n    m=ReceiptBody.model_validate(b)\n    assert m.model_dump(exclude_none=True,mode="json")==b,(m.model_dump(exclude_none=True,mode="json"),b)\nprint("ok")'],JSON.stringify(bodies));assert.match(out,/^ok/);
 const common={python:bridge.python,pythonPath:bridge.pythonPath,publicKeyPem:ledger.publicKeyPem(),issuer:ledger.issuer,environment:ledger.environment,kid:ledger.kid,timeoutMs:bridge.timeoutMs};
 const result=await verifyWithPythonCli(ledger.exportArchive(),{...common,expectedHead:ledger.head});assert.equal(result.count,3);assert.equal(result.head,ledger.head);assert.equal(result.external_checkpoint_matched,true);
 await assert.rejects(verifyWithPythonCli({receipts:[swapPayload(ledger.tokens[0],c=>{c.body.decision='escalate';})]},common),{code:'python_verify'});
 const old=new AutheoReceiptLedger({environment:'env:default',format:'legacy-0.1'});old.recordGovernance({actor,workspace:'default',idempotencyKey:'py-old',approval:{hash:'h',units:1,capability:'text.digest'}});
 assert.equal((await verifyWithPythonCli(old.exportArchive(),{...common,publicKeyPem:old.publicKeyPem(),issuer:old.issuer,kid:old.kid})).head,old.head);
 assert.equal((await verifyWithPythonCli(legacy,{...common,publicKeyPem:legacyPem,issuer:'autheo-demo-authority',environment:'env:research',kid:undefined})).count,4);
});

test('Python 0.2 live loopback API: JARVIS client enrolls, grants, evaluates signed requests, reports outcomes and verifies the ledger',{skip,timeout:60000},async()=>{
 const dir=await mkdtemp(join(tmpdir(),'jarvis-autheo-live-'));let proc;
 try{
  await runPy(['-m','autheo_agent_environment','--state-dir',dir,'init','--environment','env:default']);
  proc=spawn(bridge.python,['-u','-m','autheo_agent_environment','--state-dir',dir,'serve','--port','0'],{env:pyEnv,stdio:['ignore','pipe','pipe']});
  const url=await new Promise((resolve,reject)=>{let buf='';const t=setTimeout(()=>reject(new Error('serve did not start: '+buf)),20000);proc.stdout.on('data',d=>{buf+=d;const m=buf.match(/http:\/\/127\.0\.0\.1:(\d+)\/v1\/health/);if(m){clearTimeout(t);resolve('http://127.0.0.1:'+m[1]);}});proc.stderr.on('data',d=>{buf+=d;});proc.once('exit',c=>reject(new Error('serve exited '+c+': '+buf)));});
  const config=JSON.parse(await readFile(join(dir,'config.json'),'utf8'));
  const cfg=autheoApiConfigFromEnv({JARVIS_AUTHEO_API_ENABLED:'1',JARVIS_AUTHEO_API_URL:url,JARVIS_AUTHEO_API_TOKEN_FILE:join(dir,'api-token'),JARVIS_AUTHEO_ANCHOR_PUBLIC_KEY_FILE:join(dir,'issuer-public.pem'),JARVIS_AUTHEO_ANCHOR_KID:config.kid,JARVIS_AUTHEO_ANCHOR_ISSUER:config.issuer});
  const client=createAutheoClient(cfg);assert.equal((await client.health()).version,'0.2.0');assert.equal((await client.pinAnchorFromInfo()).kid,config.kid);
  const {privateKey,publicKey}=generateKeyPairSync('ed25519');const passport=mapActorToPassport(actor);
  const identity=await client.issueIdentity({...passport,public_key:publicKey.export({type:'spki',format:'pem'})});assert.equal(identity.key_fingerprint,keyFingerprint(publicKey));
  const grant=await client.grantMandate(mandateGrantInput(mapActorToMandate(actor,'default',{perActionMinor:10,totalBudgetMinor:20,approvalThresholdMinor:5})));assert.equal(grant.receipt_verified.decision,grant.receipt.decision);
  const common={privateKey,agentId:passport.agent_id,environment:'env:default',mandateId:grant.mandate_id,action:'tool.invoke',resource:'workspace:default'};
  const allowed=await client.evaluateAction({...common,tool:'jarvis:text.digest',amountMinor:1});assert.equal(allowed.outcome,'allow');assert.equal(allowed.allow,true);assert.equal(allowed.request_proof,'agent_signed_request');assert.equal(allowed.receipt_verified.format,'v1');
  const blocked=await client.evaluateAction({...common,tool:'jarvis:shell.exec'});assert.equal(blocked.outcome,'block');assert.equal(blocked.allow,false);
  const escalated=await client.evaluateAction({...common,tool:'jarvis:text.digest',amountMinor:6});assert.equal(escalated.outcome,'escalate');assert.equal(escalated.allow,false);
  const outcome=await client.reportOutcome({privateKey,agentId:passport.agent_id,environment:'env:default',requestId:allowed.requestId,status:'succeeded',detailSha256:'b'.repeat(64)});assert.equal(outcome.receipt.reported_by,'agent_signed');assert.equal(outcome.receipt_verified.decision,'recorded');
  const report=await client.ledgerVerify('env:default');assert.equal(report.valid,true);
  const exportPath=join(dir,'export.json');await runPy(['-m','autheo_agent_environment','--state-dir',dir,'ledger','export','--environment','env:default','--output',exportPath]);
  const archive=JSON.parse(await readFile(exportPath,'utf8'));const local=verifyReceiptArchive(archive,{publicKey:cfg.anchor.publicKey,issuer:config.issuer,environment:'env:default',kid:config.kid,allowLegacy:false,expectedHead:report.head});
  assert.equal(local.count,report.count);assert.deepEqual(local.receipts.map(r=>r.kind),['identity_issue','mandate_grant','simulation','simulation','simulation','outcome_report']);
  await assert.rejects(createAutheoClient({baseUrl:url,token:'wrong-token-0123456789'}).info(),{code:'autheo_auth'});
 }finally{proc?.kill();await rm(dir,{recursive:true,force:true});}
});
