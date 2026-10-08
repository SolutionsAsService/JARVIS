import {hash,authorize,scope,fail} from './common.js';
export const skillId=s=>s.id+'@'+hash(s.body);
export function selectSkills(catalog,{actor,workspace,platform=process.platform,licenses=['MIT'],capabilities=[],pins=[],intent='',budget=2048}){
 scope(actor,actor.tenant,workspace);
 if(!Number.isSafeInteger(budget)||budget<0)fail('context_budget','Invalid skill token budget');
 const rejected=[],eligible=new Map(),selected=[],dedup=[],conflicts=[],ambiguous=new Set();
 const counts=new Map();for(const s of catalog)if(s.tenant===actor.tenant&&s.workspace===workspace)counts.set(s.id,(counts.get(s.id)||0)+1);
 for(const [id,count] of counts)if(count>1)ambiguous.add(id);
 const permits=s=>{try{for(const p of s.permissions)authorize(actor,p);return true;}catch{return false;}};
 for(const s of catalog){const reason=s.tenant!==actor.tenant||s.workspace!==workspace?'scope':!licenses.includes(s.license)?'license':!s.platforms.includes(platform)?'platform':!permits(s)?'permission':ambiguous.has(s.id)?'ambiguous logical ID':null;if(reason)rejected.push({id:skillId(s),reason});else if(eligible.has(s.id)){rejected.push({id:skillId(s),reason:'ambiguous logical ID'});eligible.delete(s.id);}else eligible.set(s.id,s);}
 const tokens=s=>Math.ceil(s.body.length/4), words=intent.toLowerCase().split(/[^a-z0-9]+/);
 const score=s=>100*pins.includes(s.id)+10*s.capabilities.filter(c=>capabilities.includes(c)).length+s.triggers.filter(t=>words.includes(t.toLowerCase())).length;
 const ranked=[...eligible.values()].sort((a,b)=>score(b)-score(a)||skillId(a).localeCompare(skillId(b)));let used=0;
 for(const root of ranked){if(selected.some(s=>s.id===root.id))continue;if(!score(root)){rejected.push({id:skillId(root),reason:'no heuristic match'});continue;}const closure=[],seen=new Set();let error;
 const visit=(s,stack=[])=>{if(stack.includes(s.id)){error='dependency cycle';return;}if(seen.has(s.id))return;seen.add(s.id);for(const id of s.dependencies){const dep=eligible.get(id);if(!dep){error='missing or denied dependency '+id;return;}visit(dep,[...stack,s.id]);}closure.push(s);};visit(root);
 const additions=closure.filter(s=>!selected.some(x=>x.id===s.id));const unique=[];
 for(const s of additions){const same=[...selected,...unique].find(x=>hash(x.body)===hash(s.body)&&JSON.stringify(x.permissions)===JSON.stringify(s.permissions)&&JSON.stringify(x.capabilities)===JSON.stringify(s.capabilities)&&JSON.stringify(x.dependencies)===JSON.stringify(s.dependencies));if(same){dedup.push({id:skillId(s),canonical:skillId(same)});continue;}const conflict=[...selected,...unique].find(x=>s.exclusive.some(c=>x.capabilities.includes(c))||x.exclusive.some(c=>s.capabilities.includes(c)));if(conflict){conflicts.push({a:skillId(s),b:skillId(conflict)});error='exclusive capability conflict';}unique.push(s);}
 const cost=unique.reduce((n,s)=>n+tokens(s),0);if(error||used+cost>budget){rejected.push({id:skillId(root),reason:error??'context budget'});continue;}selected.push(...unique);used+=cost;
 }
 const covered=selected.flatMap(s=>s.capabilities),missing=capabilities.filter(c=>!covered.includes(c));return {policy:'deterministic-heuristic-v1',selected:selected.map(s=>({id:skillId(s),logicalId:s.id,reason:pins.includes(s.id)?'explicit pin':'capability/trigger or dependency',body:s.body,hash:hash(s.body)})),rejected,dedup,conflicts,tokens:used,missing,blocked:missing.length>0};
}
