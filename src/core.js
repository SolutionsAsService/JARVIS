import { skills, integrations, servers } from './catalog.js';
export const phases = ['inspect', 'change', 'verify', 'done'];
export const initialState = () => ({version:1, enabledSkills:skills.map(s=>s.id), connectors:[], runs:[], plannedServers:[], endpoint:''});
export function conflicts(enabled) {
  const owners = new Map();
  skills.filter(s=>enabled.includes(s.id)).forEach(s=>s.capabilities.forEach(c=>owners.set(c,[...(owners.get(c)||[]),s.id])));
  return [...owners].filter(([,ids])=>ids.length>1).map(([capability,providers])=>({capability,providers}));
}
export function resolveTo(enabled, winner) {
  const chosen=skills.find(s=>s.id===winner); if(!chosen) throw new Error('Unknown skill.');
  return enabled.filter(id=>id===winner || !skills.find(s=>s.id===id)?.capabilities.some(c=>chosen.capabilities.includes(c))).concat(enabled.includes(winner)?[]:[winner]);
}
export function createRun(title, now=Date.now()) {
  if(typeof title!=='string' || title.trim().length<4 || title.trim().length>180) throw new Error('Use a task name between 4 and 180 characters.');
  return {id:globalThis.crypto.randomUUID(),title:title.trim(),phase:'inspect',status:'ready',attempts:0,maxAttempts:2,createdAt:now,deadline:now+600000,events:[{at:now,text:'Local simulation created. No tools or agents launched.'}]};
}
export function advanceRun(run, action, now=Date.now()) {
  if(['done','cancelled','timed_out'].includes(run.status)) return run;
  if(now>=run.deadline) return {...run,status:'timed_out',events:[...run.events,{at:now,text:'Deadline exceeded. Stopped; no automatic retry.'}]};
  if(action==='cancel') return {...run,status:'cancelled',events:[...run.events,{at:now,text:'Simulation cancelled.'}]};
  if(action==='fail') return {...run,status:'blocked',events:[...run.events,{at:now,text:'Simulated blocker. A deliberate retry or cancellation is required.'}]};
  if(action==='retry') {
    if(run.status!=='blocked') throw new Error('Only blocked simulations can retry.');
    if(run.attempts>=run.maxAttempts) throw new Error('Retry budget exhausted. Stop and diagnose; no new subprocess.');
    return {...run,status:'ready',attempts:run.attempts+1,events:[...run.events,{at:now,text:'Explicit retry recorded. Same task identity retained.'}]};
  }
  if(action!=='next' || run.status==='blocked') throw new Error('Resolve the blocker before advancing.');
  const phase=phases[phases.indexOf(run.phase)+1];
  return {...run,phase,status:phase==='done'?'done':'ready',events:[...run.events,{at:now,text:phase==='done'?'Simulation complete. No real work was executed.':'Simulated phase: '+phase+'.'}]};
}
export function safeEndpoint(value) {
  if(!value.trim()) return '';
  const url=new URL(value);
  const local=['localhost','127.0.0.1','[::1]'].includes(url.hostname);
  if((url.protocol!=='https:' && !(url.protocol==='http:' && local)) || url.username || url.password || url.search || url.hash) throw new Error('Use HTTPS (or HTTP localhost), without credentials, query strings or fragments.');
  return url.href;
}
export function restoreState(raw) {
  const base=initialState(); if(!raw) return base;
  try {
    const s=JSON.parse(raw); if(s.version!==1) return base;
    base.enabledSkills=Array.isArray(s.enabledSkills)?[...new Set(s.enabledSkills.filter(id=>skills.some(x=>x.id===id)))]:base.enabledSkills;
    base.connectors=Array.isArray(s.connectors)?[...new Set(s.connectors.filter(id=>integrations.some(x=>x.id===id)))]:[];
    base.plannedServers=Array.isArray(s.plannedServers)?[...new Set(s.plannedServers.filter(id=>servers.some(x=>x.id===id)))]:[];
    base.endpoint=typeof s.endpoint==='string'?safeEndpoint(s.endpoint):'';
    base.runs=Array.isArray(s.runs)?s.runs.filter(r=>r && typeof r.id==='string' && /^[0-9a-f-]{36}$/i.test(r.id) && typeof r.title==='string' && r.title.length<=180 && phases.includes(r.phase) && ['ready','blocked','done','cancelled','timed_out'].includes(r.status) && Number.isFinite(r.deadline) && Number.isFinite(r.createdAt) && Number.isInteger(r.attempts) && r.attempts>=0 && r.attempts<=2 && r.maxAttempts===2 && Array.isArray(r.events) && r.events.every(e=>e && Number.isFinite(e.at) && typeof e.text==='string' && e.text.length<500)).slice(0,50):[];
    return base;
  } catch {return initialState();}
}
export function exportPlan(state) {
  return {schemaVersion:1,kind:'jarvis.deployment-plan',mode:'preview',generatedAt:new Date().toISOString(),skills:state.enabledSkills,capabilityConflicts:conflicts(state.enabledSkills),adapters:state.connectors.map(id=>({id,status:'planned',connected:false})),mcp:state.plannedServers.map(id=>({...servers.find(s=>s.id===id),installed:false})),devhub:{endpoint:state.endpoint||null,status:'contract-not-connected'},executionPolicy:{maxRetries:2,timeoutSeconds:600,maxDelegationDepth:1,automaticInstall:false,publicationRequiresAuthorization:true},secretsIncluded:false};
}
