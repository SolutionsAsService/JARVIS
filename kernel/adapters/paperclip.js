// Paperclip governance adapter. Independently authored, MIT. OFF BY DEFAULT.
// Talks to a separately running Paperclip server (paperclipai/paperclip, MIT) through its documented
// REST API. Nothing from the Paperclip monorepo is vendored or imported.
// Endpoints were read from SolutionsAsService/paperclip@4f399cec9f84ea85a62231c054fa084c03dcc416:
//   docs/api/{overview,authentication,companies,agents,issues,approvals}.md and
//   server/src/routes/{health,companies,agents,issues,approvals}.ts (see docs/SOURCES.md).
// Ownership rule (docs/PLAN.md): the JARVIS kernel stays the one scheduler. This adapter MIRRORS
// JARVIS tasks into Paperclip issues for governance visibility and READS agents/approvals/heartbeat
// runs. It never checks out issues for a Paperclip agent and only invokes a Paperclip heartbeat when
// the caller explicitly opts in per call, because that would start Paperclip's own dispatcher.

export const PAPERCLIP_ISSUE_STATUSES=Object.freeze(['backlog','todo','in_progress','in_review','done','blocked','cancelled']);
export const PAPERCLIP_APPROVAL_TYPES=Object.freeze(['hire_agent','approve_ceo_strategy','budget_override_required','request_board_approval']);
const GUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class PaperclipError extends Error{constructor(code,message,status){super(message);this.code=code;this.status=status;}}
const fail=(code,message,status)=>{throw new PaperclipError(code,message,status);};
const seg=v=>{if(typeof v!=='string'||!v||v.length>200||!/^[A-Za-z0-9._:-]+$/.test(v))fail('paperclip_input','Invalid path identifier');return encodeURIComponent(v);};

// Base URL: HTTPS anywhere, or HTTP only on loopback (Paperclip dev default http://localhost:3100).
export function normalizeBaseUrl(value){let url;try{url=new URL(value);}catch{fail('paperclip_config','Invalid Paperclip URL');}const loopback=['localhost','127.0.0.1','[::1]'].includes(url.hostname);if(!(url.protocol==='https:'||(url.protocol==='http:'&&loopback)))fail('paperclip_config','Paperclip URL must be HTTPS or loopback HTTP');if(url.username||url.password||url.search||url.hash)fail('paperclip_config','Paperclip URL must not carry credentials, query or fragment');return url.origin+url.pathname.replace(/\/+$/,'').replace(/\/api$/,'');}

// Env-configured connector; returns null (disabled) unless explicitly enabled.
//   JARVIS_PAPERCLIP_ENABLED=1            required opt-in
//   JARVIS_PAPERCLIP_URL=http://127.0.0.1:3100
//   JARVIS_PAPERCLIP_COMPANY_ID=<uuid>    company that mirrors this JARVIS tenant
//   JARVIS_PAPERCLIP_TOKEN=<agent API key> optional; local_trusted mode needs none (board actor)
//   JARVIS_PAPERCLIP_TIMEOUT_MS=5000
export function paperclipConfigFromEnv(env=process.env){if(env.JARVIS_PAPERCLIP_ENABLED!=='1')return null;if(!env.JARVIS_PAPERCLIP_URL||!env.JARVIS_PAPERCLIP_COMPANY_ID)fail('paperclip_config','JARVIS_PAPERCLIP_URL and JARVIS_PAPERCLIP_COMPANY_ID are required when enabled');return {baseUrl:normalizeBaseUrl(env.JARVIS_PAPERCLIP_URL),companyId:env.JARVIS_PAPERCLIP_COMPANY_ID,token:env.JARVIS_PAPERCLIP_TOKEN||undefined,timeoutMs:Math.min(Math.max(Number(env.JARVIS_PAPERCLIP_TIMEOUT_MS)||5000,100),30000)};}

export function createPaperclipClient({baseUrl,token,companyId,fetcher=globalThis.fetch,timeoutMs=5000,maxResponseBytes=1<<20,runId}={}){
 const base=normalizeBaseUrl(baseUrl);if(companyId!==undefined)seg(companyId);if(typeof fetcher!=='function')fail('paperclip_config','fetch implementation required');
 async function request(method,path,{body,query,headers={}}={}){const url=new URL(base+'/api'+path);for(const [k,v] of Object.entries(query??{}))if(v!==undefined&&v!==null)url.searchParams.set(k,String(v));const h={Accept:'application/json',...headers};if(token)h.Authorization='Bearer '+token;if(body!==undefined)h['Content-Type']='application/json';if(runId&&method!=='GET')h['X-Paperclip-Run-Id']=runId;const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),timeoutMs);let response,text;try{response=await fetcher(url.href,{method,headers:h,body:body===undefined?undefined:JSON.stringify(body),signal:controller.signal,redirect:'error'});text=await response.text();}catch(e){fail(controller.signal.aborted?'paperclip_timeout':'paperclip_unreachable',controller.signal.aborted?'Paperclip request timed out':'Paperclip server unreachable');}finally{clearTimeout(timer);}if(Buffer.byteLength(text)>maxResponseBytes)fail('paperclip_response','Paperclip response too large');let data=null;if(text){try{data=JSON.parse(text);}catch{fail('paperclip_response','Paperclip returned non-JSON',response.status);}}if(!response.ok){const code=response.status===409?'paperclip_conflict':response.status===422?'paperclip_transition':response.status===401||response.status===403?'paperclip_auth':response.status===404?'paperclip_not_found':'paperclip_http';fail(code,'Paperclip '+response.status+': '+String(data?.error??'request failed').slice(0,300),response.status);}return data;}
 const company=id=>seg(id??companyId??fail('paperclip_config','companyId required'));
 return {
  baseUrl:base,
  health:()=>request('GET','/health'),
  listCompanies:()=>request('GET','/companies',{query:{scope:'accessible'}}),
  getCompany:id=>request('GET','/companies/'+company(id)),
  listAgents:id=>request('GET','/companies/'+company(id)+'/agents'),
  getAgent:agentId=>request('GET','/agents/'+seg(agentId)),
  me:()=>request('GET','/agents/me'),
  listIssues:(filters={},id)=>request('GET','/companies/'+company(id)+'/issues',{query:{status:filters.status,assigneeAgentId:filters.assigneeAgentId,projectId:filters.projectId}}),
  getIssue:issueId=>request('GET','/issues/'+seg(issueId)),
  createIssue:(input,id)=>request('POST','/companies/'+company(id)+'/issues',{body:input}),
  updateIssue:(issueId,patch)=>request('PATCH','/issues/'+seg(issueId),{body:patch,headers:{Prefer:'return=minimal'}}),
  addComment:(issueId,body)=>request('POST','/issues/'+seg(issueId)+'/comments',{body:{body}}),
  listApprovals:(status,id)=>request('GET','/companies/'+company(id)+'/approvals',{query:{status}}),
  getApproval:approvalId=>request('GET','/approvals/'+seg(approvalId)),
  createApproval:async(input,id)=>{if(!PAPERCLIP_APPROVAL_TYPES.includes(input?.type))fail('paperclip_input','Unknown Paperclip approval type');return request('POST','/companies/'+company(id)+'/approvals',{body:input});},
  listHeartbeatRuns:({agentId,limit=20,summary=true}={},id)=>request('GET','/companies/'+company(id)+'/heartbeat-runs',{query:{agentId,limit:Math.min(Math.max(1,limit|0),1000),summary:summary?'true':undefined}}),
  getHeartbeatRun:runId2=>request('GET','/heartbeat-runs/'+seg(runId2)),
  // Starts Paperclip's own dispatcher for that agent. Requires an explicit per-call opt-in.
  invokeHeartbeat:async(agentId,{allowPaperclipDispatch=false}={})=>{if(allowPaperclipDispatch!==true)fail('paperclip_dispatch_denied','Heartbeat invocation starts a second scheduler; pass allowPaperclipDispatch:true explicitly',403);return request('POST','/agents/'+seg(agentId)+'/heartbeat/invoke');},
 };
}

// JARVIS task lifecycle -> Paperclip issue status. Paperclip requires checkout (single assignee) for
// in_progress, so active JARVIS phases are recorded as comments instead of a status transition.
export function mapTaskStatus(status){return ({queued:'todo',inspecting:null,changing:null,verifying:null,succeeded:'done',failed:'blocked',blocked:'blocked',timed_out:'blocked',cancelled:'cancelled'})[status];}

export const issueMarker=task=>'jarvis-task:'+task.id;
export function taskToIssue(task,{assigneeAgentId,projectId,goalId,priority='medium'}={}){
 const lines=['Mirrored from the JARVIS local kernel. JARVIS remains the scheduler/executor; do not check this issue out for a Paperclip agent.','',issueMarker(task),'operation: '+task.operation,'workspace: '+task.workspace,'jarvis status: '+task.status,'payload sha256: '+task.payloadHash];
 if(task.approval?.hash)lines.push('governance approval: '+task.approval.hash+' ('+task.approval.policy+')');
 if(task.goalId??task.input?.goalId)lines.push('jarvis goalId: '+(task.goalId??task.input?.goalId));
 const issue={title:('JARVIS '+task.operation+' '+task.id.slice(0,8)).slice(0,240),description:lines.join('\n'),status:'todo',priority};
 if(assigneeAgentId){if(!GUID.test(assigneeAgentId))fail('paperclip_input','assigneeAgentId must be a Paperclip agent UUID');issue.assigneeAgentId=assigneeAgentId;}
 if(projectId){if(!GUID.test(projectId))fail('paperclip_input','projectId must be a UUID');issue.projectId=projectId;}
 if(goalId){if(!GUID.test(goalId))fail('paperclip_input','goalId must be a Paperclip goal UUID');issue.goalId=goalId;}
 return issue;
}

// One-way mirror with in-memory taskId->issueId custody. Repeated syncs are idempotent per process:
// only status changes produce writes. Failures are returned, never thrown into the kernel path.
export class PaperclipGovernanceMirror{
 constructor(client,{defaults={}}={}){this.client=client;this.defaults=defaults;this.issues=new Map();this.queue=Promise.resolve();this.results=[];}
 // Serialized so concurrent kernel notifications cannot create duplicate issues for one task.
 syncTask(task){const run=this.queue.then(()=>this.syncOne(task)).then(r=>{this.results.push({taskId:task.id,...r});if(this.results.length>200)this.results.shift();return r;});this.queue=run.catch(()=>{});return run;}
 async syncOne(task){try{let entry=this.issues.get(task.id);if(!entry){const created=await this.client.createIssue(taskToIssue(task,this.defaults));entry={issueId:created.id,identifier:created.identifier??null,mirroredStatus:created.status??'todo',jarvisStatus:'queued'};this.issues.set(task.id,entry);}
  if(entry.jarvisStatus===task.status)return {ok:true,issueId:entry.issueId,identifier:entry.identifier,action:'unchanged'};
  const target=mapTaskStatus(task.status);let action='comment';
  if(target&&target!==entry.mirroredStatus){const comment='JARVIS task '+task.id+' is '+task.status+(task.failure?' ('+String(task.failure).slice(0,200)+')':'')+'.';try{await this.client.updateIssue(entry.issueId,{status:target,comment});entry.mirroredStatus=target;action='status:'+target;}catch(e){if(e.code!=='paperclip_transition')throw e;await this.client.addComment(entry.issueId,comment+' Paperclip rejected status '+target+' (422); left unchanged.');action='comment:transition_rejected';}}
  else await this.client.addComment(entry.issueId,'JARVIS phase: '+task.status+'.');
  entry.jarvisStatus=task.status;return {ok:true,issueId:entry.issueId,identifier:entry.identifier,action};}
  catch(e){return {ok:false,error:e.code??'paperclip_error',message:e.message};}}
 // Read-only governance snapshot: company, agents (identity/role/budget), pending approvals, recent runs.
 async governanceSnapshot(){const [health,company,agents,approvals,runs]=await Promise.all([this.client.health(),this.client.getCompany(),this.client.listAgents(),this.client.listApprovals('pending'),this.client.listHeartbeatRuns({limit:10})]);return {source:'paperclip',health:{status:health?.status??null,commit:health?.commit??null},company:{id:company.id,name:company.name,status:company.status,budgetMonthlyCents:company.budgetMonthlyCents??null},agents:(agents??[]).map(a=>({id:a.id,name:a.name,role:a.role,status:a.status,budgetMonthlyCents:a.budgetMonthlyCents??null,spentMonthlyCents:a.spentMonthlyCents??null})),pendingApprovals:(approvals??[]).map(a=>({id:a.id,type:a.type,status:a.status})),recentHeartbeatRuns:(runs??[]).map(r=>({id:r.id,agentId:r.agentId,status:r.status})),mirroredTasks:this.issues.size};}
}
