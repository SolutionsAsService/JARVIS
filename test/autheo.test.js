import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {AutheoReceiptLedger,verifyReceiptArchive,verifyToken,autheoDigest,canonicalJson,mapGovernanceDecision,mapActorToMandate,mapActorToPassport,autheoConfigFromEnv,verifyWithPythonCli,AUTHEO_SCOPES,IDENTIFIER,ZERO_HASH} from '../kernel/adapters/autheo.js';
import {Kernel} from '../kernel/kernel.js';
const fixture=async name=>readFile(new URL('./fixtures/autheo-demo/'+name,import.meta.url),'utf8');
// Fixtures were produced by "python -m autheo_agent_environment.demo" at autheo-agent-environment@8106edd
// (see test/fixtures/autheo-demo/README.md). Only public keys and receipt archives are stored.
const pem=await fixture('issuer-public.pem'),report=JSON.parse(await fixture('demo-report.json'));
const source=JSON.parse(await fixture('source-audit.json')),destination=JSON.parse(await fixture('destination-audit.json'));
const opts={publicKey:pem,issuer:'autheo-demo-authority'};
const actor={id:'local-owner',tenant:'local',workspaces:['default'],capabilities:['text.digest']};
const tamper=(token,mutate)=>{const [h,p,sig]=token.split('.');const claims=JSON.parse(Buffer.from(p,'base64url'));mutate(claims);return h+'.'+Buffer.from(JSON.stringify(claims)).toString('base64url')+'.'+sig;};

test('JS verifier accepts receipts produced by the upstream Python demo and reproduces its audit heads',()=>{
 const src=verifyReceiptArchive(source,{...opts,environment:'env:research'});
 assert.equal(src.signature_chain_verified,true);assert.equal(src.count,report.source_audit.count);assert.equal(src.head,report.source_audit.head);
 assert.deepEqual(src.receipts.map(r=>r.decision),['allow','escalate','block','checkpoint_only']);
 assert.deepEqual(src.receipts.slice(0,3).map(r=>r.decision),report.decisions);
 assert.equal(src.actual_actions_proven,false);assert.equal(src.immutable,false);
 const dst=verifyReceiptArchive(destination,{...opts,environment:'env:review',expectedHead:report.destination_audit.head});
 assert.equal(dst.head,report.destination_audit.head);assert.equal(dst.external_checkpoint_matched,true);assert.equal(dst.receipts[0].kind,'handoff_import');
});
test('canonical JSON digest matches Python json.dumps(sort_keys, compact, ensure_ascii) byte-for-byte',()=>{
 // Vector computed with autheo_agent_environment.signing.digest at 8106edd.
 assert.equal(autheoDigest({b:'é✓',a:[1,null,true]}),'c21200917884dded8ee8db02f5e585cd3d2bb58f1d86d22cb57735b4610ba7b6');
 assert.equal(canonicalJson({b:1,a:'x'}),'{"a":"x","b":1}');
 // Reconstruct the demo request model_dump and match the payload_hash the Python environment signed.
 const first=verifyReceiptArchive(source,{...opts,environment:'env:research'}).receipts[0];
 const request={request_id:'request:allow',agent_id:'agent:research-01',environment:'env:research',mandate_id:first.mandate_id,action:'compute.simulate',resource:'listing:demo-01',amount_minor:40,asset:'DEMO'};
 assert.equal(autheoDigest(request),first.payload_hash);
 assert.throws(()=>canonicalJson({x:1.5}),{code:'canonical'});
});
test('tampering, wrong key, wrong issuer/audience, reordering and truncation are rejected',()=>{
 const env={...opts,environment:'env:research'};
 assert.throws(()=>verifyReceiptArchive({receipts:[tamper(source.receipts[0],c=>{c.body.decision='allow';c.body.amount_minor=1;})]},env),{code:'signature'});
 const other=new AutheoReceiptLedger({environment:'env:research'});
 assert.throws(()=>verifyReceiptArchive(source,{...env,publicKey:other.publicKeyPem()}),{code:'signature'});
 assert.throws(()=>verifyReceiptArchive(source,{...env,issuer:'someone-else'}),{code:'issuer'});
 assert.throws(()=>verifyReceiptArchive(source,{...opts,environment:'env:review'}),{code:'audience'});
 assert.throws(()=>verifyReceiptArchive({receipts:[source.receipts[1],source.receipts[0]]},env),{code:'chain'});
 assert.throws(()=>verifyReceiptArchive({receipts:source.receipts.slice(0,2)},{...env,expectedHead:report.source_audit.head}),{code:'head'});
 assert.throws(()=>verifyReceiptArchive({receipts:source.receipts,extra:1},env),{code:'archive'});
 const [h,p,sig]=source.receipts[0].split('.');
 const noneHeader=Buffer.from(JSON.stringify({alg:'none',kid:'demo-v1',typ:'autheo-receipt+jwt'})).toString('base64url');
 assert.throws(()=>verifyToken(noneHeader+'.'+p+'.'+sig,{kind:'receipt',...env,audience:'env:research',historical:true}),{code:'alg'});
 assert.throws(()=>verifyToken(source.receipts[0],{kind:'passport',...env,audience:'env:research'}),{code:'header'});
 assert.throws(()=>verifyToken(source.receipts[0],{kind:'mandate',...env,audience:'env:research',historical:true}),{code:'historical'});
 // Non-historical verification enforces exp, like PyJWT verify_exp.
 const claims=JSON.parse(Buffer.from(p,'base64url'));
 assert.throws(()=>verifyToken(source.receipts[0],{kind:'receipt',...env,audience:'env:research',now:claims.exp+1}),{code:'expired'});
 assert.throws(()=>verifyToken(source.receipts[0],{kind:'receipt',...env,audience:'env:research',historical:true,now:claims.iat-60}),{code:'immature'});
 assert.equal(h.length>0,true);
});
test('JARVIS governance outcomes map to Autheo identity, mandate and allow/escalate/block vocabulary',()=>{
 const passport=mapActorToPassport(actor);assert.equal(passport.agent_id,'agent:jarvis-local-owner');assert.deepEqual(passport.environments,['env:default']);
 const mandate=mapActorToMandate(actor,'default',{perActionMinor:10,totalBudgetMinor:20,approvalThresholdMinor:5});
 assert.ok(mandate.scopes.every(s=>AUTHEO_SCOPES.includes(s)));assert.ok([mandate.agent_id,mandate.environment,...mandate.resources].every(id=>IDENTIFIER.test(id)));
 assert.throws(()=>mapActorToMandate(actor,'default',{perActionMinor:30,totalBudgetMinor:20}),{code:'mandate'});
 assert.equal(mapGovernanceDecision({approval:{hash:'h',units:1},mandate}).decision,'allow');
 assert.deepEqual(mapGovernanceDecision({approval:{hash:'h',units:6},mandate}).reasons,['human_review_required']);
 assert.deepEqual(mapGovernanceDecision({error:{code:'capability_denied'}}).reasons,['scope_denied']);
 assert.deepEqual(mapGovernanceDecision({error:{code:'forbidden'}}).reasons,['resource_denied']);
 assert.deepEqual(mapGovernanceDecision({error:{code:'budget',status:429}}).reasons,['total_budget_limit']);
 assert.equal(mapGovernanceDecision({error:{code:'budget',status:429}}).amount_minor,0);
});
test('JARVIS receipt ledger emits a verifiable Autheo-format chain with idempotency',()=>{
 const ledger=new AutheoReceiptLedger({environment:'env:default'});assert.equal(ledger.head,ZERO_HASH);
 const a=ledger.recordGovernance({actor,workspace:'default',idempotencyKey:'k1',payloadHash:'p',approval:{hash:'abc',units:1}});
 const b=ledger.recordGovernance({actor,workspace:'default',idempotencyKey:'k2',error:{code:'capability_denied'}});
 assert.equal(a.decision,'allow');assert.equal(b.decision,'block');assert.equal(b.previous_hash,a.hash);assert.equal(a.executed,false);
 assert.equal(ledger.recordGovernance({actor,workspace:'default',idempotencyKey:'k1',payloadHash:'p',approval:{hash:'abc',units:1}}).replayed,true);
 assert.throws(()=>ledger.recordGovernance({actor,workspace:'default',idempotencyKey:'k1',payloadHash:'other',approval:{hash:'abc',units:1}}),{code:'idempotency'});
 const v=ledger.verify({expectedHead:ledger.head});assert.equal(v.count,2);assert.equal(v.head,b.hash);
});
test('kernel trust hook records allow and block receipts without changing admission',async()=>{
 const trust=new AutheoReceiptLedger({environment:'env:default'});const kernel=new Kernel({trust});
 try{const task=kernel.submit(actor,{workspace:'default',idempotencyKey:'t1',text:'hello'});
  assert.equal(task.trust.decision,'allow');assert.equal(task.trust.format,'autheo-receipt+jwt');
  assert.ok(kernel.read(actor,task.id).events.some(e=>e.kind==='trust-receipt'));
  assert.equal(kernel.submit(actor,{workspace:'default',idempotencyKey:'t1',text:'hello'}).id,task.id);
  assert.throws(()=>kernel.submit(actor,{workspace:'default',idempotencyKey:'t2',text:'x',operation:'shell.exec'}),{code:'capability_denied'});
  const v=trust.verify();assert.equal(v.count,2);assert.deepEqual(v.receipts.map(r=>r.decision),['allow','block']);
  await kernel.drain(actor);assert.equal(kernel.read(actor,task.id).status,'succeeded');
 }finally{await kernel.close();}
 const plain=new Kernel();try{assert.equal(plain.submit(actor,{workspace:'default',idempotencyKey:'p',text:'x'}).trust,undefined);}finally{await plain.close();}
});
const bridge=autheoConfigFromEnv();
test('optional Python bridge is off by default',()=>{assert.equal(autheoConfigFromEnv({}).enabled,false);});
test('upstream Python audit CLI verifies a JARVIS-issued archive and rejects tampering',{skip:bridge.enabled?false:'set JARVIS_AUTHEO_PYTHON (and optionally JARVIS_AUTHEO_PYTHONPATH) to run against autheo-agent-environment'},async()=>{
 const ledger=new AutheoReceiptLedger({environment:'env:default'});
 ledger.recordGovernance({actor,workspace:'default',idempotencyKey:'py1',approval:{hash:'abc',units:1}});
 ledger.recordGovernance({actor,workspace:'default',idempotencyKey:'py2',error:{code:'budget',status:429}});
 const common={python:bridge.python,pythonPath:bridge.pythonPath,publicKeyPem:ledger.publicKeyPem(),issuer:ledger.issuer,environment:ledger.environment,timeoutMs:bridge.timeoutMs};
 const result=await verifyWithPythonCli(ledger.exportArchive(),{...common,expectedHead:ledger.head});
 assert.equal(result.signature_chain_verified,true);assert.equal(result.count,2);assert.equal(result.head,ledger.head);assert.equal(result.external_checkpoint_matched,true);
 const bad={receipts:[tamper(ledger.tokens[0],c=>{c.body.decision='escalate';})]};
 await assert.rejects(verifyWithPythonCli(bad,common),{code:'python_verify'});
 const upstream=await verifyWithPythonCli(source,{...common,publicKeyPem:pem,issuer:'autheo-demo-authority',environment:'env:research'});
 assert.equal(upstream.head,report.source_audit.head);
});
