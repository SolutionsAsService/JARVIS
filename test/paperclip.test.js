import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {randomUUID} from 'node:crypto';
import {createPaperclipClient,paperclipConfigFromEnv,normalizeBaseUrl,PaperclipGovernanceMirror,mapTaskStatus,taskToIssue,PAPERCLIP_ISSUE_STATUSES} from '../kernel/adapters/paperclip.js';
import {Kernel} from '../kernel/kernel.js';

// In-process mock of the Paperclip REST surface used by the adapter. Routes, bodies and error shapes
// follow paperclip@4f399ce docs/api/*.md and server/src/routes/*.ts: JSON {error} bodies, company-scoped
// paths, 422 for invalid transitions, in_progress only through checkout. It is a fixture, not Paperclip.
function mockPaperclip({token}={}){
 const companyId=randomUUID(),agentId=randomUUID(),issues=new Map(),comments=[],log=[];let n=0;
 const company={id:companyId,name:'JARVIS mirror',status:'active',budgetMonthlyCents:10000};
 const agents=[{id:agentId,name:'Engineer',role:'engineer',status:'idle',companyId,budgetMonthlyCents:5000,spentMonthlyCents:1200}];
 const server=createServer(async(req,res)=>{let raw='';for await(const c of req)raw+=c;const url=new URL(req.url,'http://x');const body=raw?JSON.parse(raw):undefined;log.push({method:req.method,path:url.pathname,query:Object.fromEntries(url.searchParams),body,auth:req.headers.authorization,runId:req.headers['x-paperclip-run-id'],prefer:req.headers.prefer});
  const send=(status,data)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(data));};
  if(token&&req.headers.authorization!=='Bearer '+token)return send(401,{error:'Unauthenticated'});
  const p=url.pathname,m=(re)=>p.match(re);let r;
  if(req.method==='GET'&&p==='/api/health')return send(200,{status:'ok',commit:'4f399cec9f84ea85a62231c054fa084c03dcc416'});
  if(req.method==='GET'&&p==='/api/companies')return send(200,[company]);
  if((r=m(/^\/api\/companies\/([^/]+)(\/.*)?$/))&&r[1]!==companyId)return send(403,{error:'Cross-company access denied'});
  if(req.method==='GET'&&p==='/api/companies/'+companyId)return send(200,company);
  if(req.method==='GET'&&p==='/api/companies/'+companyId+'/agents'){if(url.search)return send(400,{error:'Unsupported query parameters'});return send(200,agents);}
  if(req.method==='GET'&&p==='/api/companies/'+companyId+'/approvals')return send(200,[{id:randomUUID(),type:'hire_agent',status:url.searchParams.get('status')??'pending'}]);
  if(req.method==='GET'&&p==='/api/companies/'+companyId+'/heartbeat-runs')return send(200,[{id:randomUUID(),agentId,status:'succeeded'}]);
  if(req.method==='POST'&&p==='/api/companies/'+companyId+'/issues'){if(!body?.title||!PAPERCLIP_ISSUE_STATUSES.includes(body.status??'todo'))return send(400,{error:'Validation error'});if(body.status==='in_progress')return send(422,{error:'in_progress requires checkout'});const issue={id:randomUUID(),identifier:'PAP-'+(++n),companyId,...body};issues.set(issue.id,issue);return send(201,issue);}
  if((r=m(/^\/api\/issues\/([^/]+)$/))){const issue=issues.get(r[1]);if(!issue)return send(404,{error:'Not found'});if(req.method==='GET')return send(200,issue);if(req.method==='PATCH'){if(body.status==='in_progress')return send(422,{error:'in_progress requires checkout'});if(body.status==='done'&&issue.status==='backlog')return send(422,{error:'Invalid state transition'});const changes={};if(body.status&&body.status!==issue.status){changes.status={from:issue.status,to:body.status};issue.status=body.status;}if(body.comment)comments.push({issueId:issue.id,body:body.comment});return send(200,{id:issue.id,identifier:issue.identifier,updatedAt:new Date().toISOString(),changes,comment:body.comment?{body:body.comment}:null});}}
  if(req.method==='POST'&&(r=m(/^\/api\/issues\/([^/]+)\/comments$/))){if(!issues.has(r[1]))return send(404,{error:'Not found'});comments.push({issueId:r[1],body:body.body});return send(201,{id:randomUUID(),body:body.body});}
  if(req.method==='POST'&&p==='/api/agents/'+agentId+'/heartbeat/invoke')return send(202,{id:randomUUID(),agentId,status:'queued'});
  if(req.method==='GET'&&p==='/api/agents/'+agentId)return send(200,agents[0]);
  send(404,{error:'Unknown route'});});
 return new Promise(resolve=>server.listen(0,'127.0.0.1',()=>resolve({server,url:'http://127.0.0.1:'+server.address().port,companyId,agentId,issues,comments,log,close:()=>new Promise(r=>server.close(r))})));
}

test('connector is off by default and validates its configuration',()=>{
 assert.equal(paperclipConfigFromEnv({}),null);
 assert.equal(paperclipConfigFromEnv({JARVIS_PAPERCLIP_URL:'http://127.0.0.1:3100',JARVIS_PAPERCLIP_COMPANY_ID:'c'}),null);
 assert.throws(()=>paperclipConfigFromEnv({JARVIS_PAPERCLIP_ENABLED:'1'}),{code:'paperclip_config'});
 const cfg=paperclipConfigFromEnv({JARVIS_PAPERCLIP_ENABLED:'1',JARVIS_PAPERCLIP_URL:'http://localhost:3100/api/',JARVIS_PAPERCLIP_COMPANY_ID:'company-1',JARVIS_PAPERCLIP_TIMEOUT_MS:'999999'});
 assert.equal(cfg.baseUrl,'http://localhost:3100');assert.equal(cfg.timeoutMs,30000);assert.equal(cfg.token,undefined);
 for(const bad of ['http://paperclip.example.com','https://u:p@x.example','https://x.example/?t=1','ftp://localhost'])assert.throws(()=>normalizeBaseUrl(bad),{code:'paperclip_config'});
 assert.equal(normalizeBaseUrl('https://pc.example.com/base/'),'https://pc.example.com/base');
});
test('task lifecycle maps onto Paperclip issue statuses without claiming checkout',()=>{
 for(const s of ['queued','succeeded','failed','blocked','timed_out','cancelled'])assert.ok(PAPERCLIP_ISSUE_STATUSES.includes(mapTaskStatus(s)),s);
 for(const s of ['inspecting','changing','verifying'])assert.equal(mapTaskStatus(s),null);
 const issue=taskToIssue({id:randomUUID(),operation:'text.digest',workspace:'default',status:'queued',payloadHash:'ab',approval:{hash:'h',policy:'gm-bounded-v1'},input:{goalId:'g-1'}});
 assert.equal(issue.status,'todo');assert.match(issue.description,/jarvis-task:/);assert.match(issue.description,/jarvis goalId: g-1/);assert.equal(issue.goalId,undefined);
 assert.throws(()=>taskToIssue({id:randomUUID(),operation:'x',workspace:'w',status:'queued'},{goalId:'not-a-uuid'}),{code:'paperclip_input'});
});
test('client speaks the documented REST API with auth, run-id and error mapping',async()=>{
 const pc=await mockPaperclip({token:'agent-key-for-tests-only'});
 try{const client=createPaperclipClient({baseUrl:pc.url,token:'agent-key-for-tests-only',companyId:pc.companyId,runId:'run-1'});
  assert.equal((await client.health()).status,'ok');
  assert.equal((await client.listCompanies())[0].id,pc.companyId);
  assert.equal((await client.listAgents())[0].role,'engineer');
  const created=await client.createIssue({title:'t',status:'todo'});assert.match(created.identifier,/^PAP-/);
  const patched=await client.updateIssue(created.id,{status:'done',comment:'ok'});assert.deepEqual(patched.changes.status,{from:'todo',to:'done'});
  await assert.rejects(client.updateIssue(created.id,{status:'in_progress'}),{code:'paperclip_transition',status:422});
  await assert.rejects(client.getIssue(randomUUID()),{code:'paperclip_not_found'});
  await assert.rejects(client.getCompany(randomUUID()),{code:'paperclip_auth',status:403});
  await assert.rejects(client.invokeHeartbeat(pc.agentId),{code:'paperclip_dispatch_denied'});
  assert.equal(pc.log.some(l=>l.path.endsWith('/heartbeat/invoke')),false);
  assert.equal((await client.invokeHeartbeat(pc.agentId,{allowPaperclipDispatch:true})).status,'queued');
  await assert.rejects(client.createApproval({type:'free_money',payload:{}}),{code:'paperclip_input'});
  assert.throws(()=>client.getIssue('../companies'),{code:'paperclip_input'});
  assert.equal(pc.log.find(l=>l.path==='/api/companies').query.scope,'accessible');
  const patch=pc.log.find(l=>l.method==='PATCH');assert.equal(patch.runId,'run-1');assert.equal(patch.prefer,'return=minimal');
  assert.ok(pc.log.every(l=>l.auth==='Bearer agent-key-for-tests-only'));
  assert.equal(pc.log.filter(l=>l.method==='GET').some(l=>l.runId),false);
  const anon=createPaperclipClient({baseUrl:pc.url,companyId:pc.companyId});await assert.rejects(anon.health(),{code:'paperclip_auth',status:401});
 }finally{await pc.close();}
 const dead=createPaperclipClient({baseUrl:'http://127.0.0.1:9',timeoutMs:500});await assert.rejects(dead.health(),{code:'paperclip_unreachable'});
});
test('governance mirror creates one issue per task, mirrors terminal status and reads a snapshot',async()=>{
 const pc=await mockPaperclip();
 try{const mirror=new PaperclipGovernanceMirror(createPaperclipClient({baseUrl:pc.url,companyId:pc.companyId}));
  const task={id:randomUUID(),operation:'text.digest',workspace:'default',status:'queued',payloadHash:'ab'};
  const [a,b]=await Promise.all([mirror.syncTask(task),mirror.syncTask(task)]);
  assert.equal(pc.issues.size,1);assert.equal(a.issueId,b.issueId);assert.equal(b.action,'unchanged');
  assert.equal((await mirror.syncTask({...task,status:'changing'})).action,'comment');
  assert.equal((await mirror.syncTask({...task,status:'succeeded'})).action,'status:done');
  assert.equal(pc.issues.get(a.issueId).status,'done');assert.ok(pc.comments.some(c=>/succeeded/.test(c.body)));
  const snap=await mirror.governanceSnapshot();assert.equal(snap.company.id,pc.companyId);assert.equal(snap.agents[0].spentMonthlyCents,1200);assert.equal(snap.pendingApprovals[0].status,'pending');assert.equal(snap.health.commit,'4f399cec9f84ea85a62231c054fa084c03dcc416');assert.equal(snap.mirroredTasks,1);
  // Rejected transition falls back to a comment instead of throwing into the kernel.
  const backlog={id:randomUUID(),operation:'text.digest',workspace:'default',status:'queued',payloadHash:'cd'};const first=await mirror.syncTask(backlog);pc.issues.get(first.issueId).status='backlog';
  assert.equal((await mirror.syncTask({...backlog,status:'succeeded'})).action,'comment:transition_rejected');
 }finally{await pc.close();}
 const offline=new PaperclipGovernanceMirror(createPaperclipClient({baseUrl:'http://127.0.0.1:9',companyId:'c',timeoutMs:300}));
 const result=await offline.syncTask({id:randomUUID(),operation:'text.digest',workspace:'default',status:'queued',payloadHash:'x'});assert.equal(result.ok,false);assert.equal(result.error,'paperclip_unreachable');
});
test('kernel observer mirrors a real kernel task end-to-end into the mock Paperclip',async()=>{
 const pc=await mockPaperclip();const mirror=new PaperclipGovernanceMirror(createPaperclipClient({baseUrl:pc.url,companyId:pc.companyId}));
 const kernel=new Kernel({observers:[t=>mirror.syncTask(t)]});const actor={id:'local-owner',tenant:'local',workspaces:['default'],capabilities:['text.digest']};
 try{const task=kernel.submit(actor,{workspace:'default',idempotencyKey:'pc-1',text:'mirror me'});await kernel.drain(actor);await mirror.queue;
  assert.equal(kernel.read(actor,task.id).status,'succeeded');assert.equal(pc.issues.size,1);const issue=[...pc.issues.values()][0];
  assert.equal(issue.status,'done');assert.match(issue.description,new RegExp('jarvis-task:'+task.id));assert.ok(mirror.results.every(r=>r.ok));
 }finally{await kernel.close();await pc.close();}
});
