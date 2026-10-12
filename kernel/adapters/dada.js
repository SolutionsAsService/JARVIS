// DADA (Directed Ambition Design Agent) adapter. OFF by default.
// Upstream: https://github.com/SolutionsAsService/dada (fork of AnEntrypoint/dada). The upstream has NO license
// file (GitHub reports none, 2026-10-12), so JARVIS copies none of its text or code: it pins a commit, fetches it
// on demand into .jarvis/upstreams/dada/<sha> (scripts/upstream.mjs) and reads it there. This module only reads
// that checkout, extracts a structural contract, compares it with the committed snapshot and prepares design
// work packets. DADA itself is a prompt-level agent skill: the traversal + critic loop is run by an LLM agent,
// never by this kernel (the kernel has no inference).
import {readFileSync,existsSync,lstatSync,realpathSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {createHash} from 'node:crypto';

const sha=b=>createHash('sha256').update(b).digest('hex');
export const DADA_ID='dada';
// Paths whose presence is part of the contract (a removal is breaking).
export const DADA_REQUIRED_PATHS=['skills/dada/SKILL.md','skills/dada/references/anchor-graph.md','skills/dada/agents/openai.yaml','skills/dada/references/traversal-ledger.md','tools/measure.py','tools/pixcontrast.py','scripts/validate_skills.py','README.md','AGENTS.md'];
// Facts JARVIS depends on. The words are short identifiers JARVIS itself uses, not upstream prose.
export const DADA_ARTIFACTS=['Traversal Plan','Decision Records','Panel Reports','Anchor Ledger','Compliance Check'];
export const DADA_MODES=['Autonomous','Adaptive'];
export const DADA_STOP=['S1','S2','S3','S4','S5'];
// Critic seats each mode's composition rule requires (node ids in the anchor graph).
export const DADA_REQUIRED_SEATS={Autonomous:['crit_apollo_wolfflin','crit_apollo_gombrich','crit_dionys_nietzsche','crit_dionys_venturi','crit_rupt_shklovsky','crit_rupt_marinetti','crit_detach_ortega','crit_detach_sontag'],Adaptive:['crit_prov_debord','crit_prov_shklovsky','crit_inc_holmes','crit_inc_mace']};

function frontmatter(text){const m=/^---\n([\s\S]*?)\n---/.exec(text);if(!m)return null;const out={};for(const line of m[1].split('\n')){const k=/^([a-z_]+):\s*(.*)$/.exec(line);if(k)out[k[1]]=k[2].replace(/^"|"$/g,'');}return out;}

// Pure: files = {path: string|Buffer|undefined}, links = {path: target|undefined}. Returns a JSON-stable contract.
export function extractDadaContract(files,{links={}}={}){
 const text=p=>files[p]===undefined?undefined:String(files[p]);
 const missing=DADA_REQUIRED_PATHS.filter(p=>files[p]===undefined);
 const skill=text('skills/dada/SKILL.md')??'',graph=text('skills/dada/references/anchor-graph.md')??'',ui=text('skills/dada/agents/openai.yaml')??'',measure=text('tools/measure.py')??'';
 const fm=frontmatter(skill)??{};
 const nodeRe=/^\s+([A-Za-z_][A-Za-z0-9_]*)\["[^"]*"\]:::([a-z]+)\s*$/gm,nodes=[];let m;while((m=nodeRe.exec(graph)))nodes.push({id:m[1],cls:m[2]});
 const edges=graph.split('\n').filter(l=>/^\s+[A-Za-z_][A-Za-z0-9_]*\s+(-->|-\.->)/.test(l));
 const subgraphs=[...graph.matchAll(/^\s*subgraph\s+([A-Z_]+)\[/gm)].map(x=>x[1]);
 const critics=nodes.filter(n=>n.cls==='critic').map(n=>n.id).sort();
 const presetsLine=/PRESETS\s*=\s*\{([\s\S]*?)\n\}/.exec(measure);
 const presets=presetsLine?[...presetsLine[1].matchAll(/^\s*'([a-z]+)'\s*:/gm)].map(x=>x[1]):[...new Set([...measure.matchAll(/--preset ([a-z]+)/g)].map(x=>x[1]))].filter(p=>p!=='all');
 const flags=[...new Set([...measure.matchAll(/add_argument\('(--[a-z-]+)'/g)].map(x=>x[1]))].sort();
 const chrome=/^CHROME\s*=\s*'([^']+)'/m.exec(measure)?.[1]??null;
 return {
  schema:'jarvis.dada-contract/1',
  skill:{name:fm.name??null,descriptionSha256:fm.description?sha(fm.description):null,displayName:/display_name:\s*"([^"]*)"/.exec(ui)?.[1]??null,invokes:/\$dada\b/.test(ui)},
  requiredPaths:DADA_REQUIRED_PATHS.filter(p=>files[p]!==undefined),missingPaths:missing,
  discoveryLink:links['.agents/skills/dada']??null,
  artifacts:DADA_ARTIFACTS.filter(a=>skill.includes('**'+a)),
  modes:DADA_MODES.filter(x=>new RegExp('\\|\\s*'+x+'\\s*\\|').test(skill)||skill.includes('**'+x)),
  stopConditions:DADA_STOP.filter(s=>skill.includes('**'+s+'.**')),
  noMoveQuota:/no move quota/i.test(skill),
  graph:{subgraphs,nodes:nodes.length,edges:edges.length,critics:critics.length,criticIds:critics},
  measureTool:{presets,flags,chrome},
  hashes:Object.fromEntries(DADA_REQUIRED_PATHS.filter(p=>files[p]!==undefined).map(p=>[p,sha(Buffer.isBuffer(files[p])?files[p]:String(files[p]))]))
 };
}

export function readDadaCheckout(dir){
 const files={},links={};for(const p of DADA_REQUIRED_PATHS){const f=join(dir,p);if(existsSync(f))files[p]=readFileSync(f);}
 const l=join(dir,'.agents/skills/dada');try{if(lstatSync(l).isSymbolicLink())links['.agents/skills/dada']=realpathSync(l)===realpathSync(join(dir,'skills/dada'))?'skills/dada':'other';}catch{}
 return extractDadaContract(files,{links});
}

// Compare a fresh contract with the committed snapshot. breaking = JARVIS would stop working or would be lying.
export function diffDadaContract(snapshot,current){
 const breaking=[],changed=[];
 const lost=(label,a=[],b=[])=>{for(const x of a)if(!b.includes(x))breaking.push(label+' removed: '+x);};
 if(current.skill.name!==snapshot.skill.name)breaking.push('skill name '+snapshot.skill.name+' -> '+current.skill.name);
 if(snapshot.skill.invokes&&!current.skill.invokes)breaking.push('default prompt no longer invokes $dada');
 lost('required path',snapshot.requiredPaths,current.requiredPaths);
 if(snapshot.discoveryLink&&current.discoveryLink!==snapshot.discoveryLink)breaking.push('discovery link .agents/skills/dada changed');
 lost('artifact',snapshot.artifacts,current.artifacts);lost('mode',snapshot.modes,current.modes);lost('stop condition',snapshot.stopConditions,current.stopConditions);
 if(snapshot.noMoveQuota&&!current.noMoveQuota)breaking.push('no-move-quota rule removed');
 lost('graph subgraph',snapshot.graph.subgraphs,current.graph.subgraphs);
 for(const ids of Object.values(DADA_REQUIRED_SEATS))lost('required critic seat',ids.filter(i=>snapshot.graph.criticIds.includes(i)),current.graph.criticIds);
 lost('measure preset',snapshot.measureTool.presets,current.measureTool.presets);lost('measure flag',snapshot.measureTool.flags,current.measureTool.flags);
 for(const k of ['nodes','edges','critics'])if(snapshot.graph[k]!==current.graph[k])changed.push('graph '+k+' '+snapshot.graph[k]+' -> '+current.graph[k]);
 if(snapshot.skill.descriptionSha256!==current.skill.descriptionSha256)changed.push('skill description changed');
 if(snapshot.measureTool.chrome!==current.measureTool.chrome)changed.push('measure.py browser path '+snapshot.measureTool.chrome+' -> '+current.measureTool.chrome);
 for(const [p,h] of Object.entries(current.hashes))if(snapshot.hashes[p]!==h)changed.push('content changed: '+p);
 return {breaking,changed,compatible:breaking.length===0,identical:breaking.length===0&&changed.length===0};
}

// Config: OFF unless JARVIS_DADA_ENABLED=1. JARVIS_DADA_DIR overrides the fetched checkout location.
export function dadaConfigFromEnv(env=process.env,{root=process.cwd(),lock}={}){
 if(env.JARVIS_DADA_ENABLED!=='1')return null;
 if(!lock)throw Object.assign(new Error('DADA lock entry missing'),{code:'dada_config'});
 return {dir:resolve(env.JARVIS_DADA_DIR||join(root,'.jarvis/upstreams',DADA_ID,lock.commit)),commit:lock.commit};
}

// Load a fetched checkout and refuse it loudly unless its commit marker matches the pin and the contract is compatible.
export function loadDada({dir,commit,snapshot}){
 const marker=join(dir,'.jarvis-upstream.json');
 if(!existsSync(marker))throw Object.assign(new Error('DADA checkout missing at '+dir+' — run: npm run upstream -- fetch dada'),{code:'dada_missing'});
 const m=JSON.parse(readFileSync(marker,'utf8'));
 if(m.commit!==commit)throw Object.assign(new Error('DADA checkout is '+m.commit+', lock pins '+commit),{code:'dada_pin'});
 const contract=readDadaCheckout(dir),diff=diffDadaContract(snapshot,contract);
 if(!diff.compatible)throw Object.assign(new Error('DADA contract broken: '+diff.breaking.join('; ')),{code:'dada_contract',diff});
 const skillPath=join(dir,'skills/dada/SKILL.md');
 return {id:DADA_ID,commit,dir,skillPath,skillSha256:contract.hashes['skills/dada/SKILL.md'],contract,diff};
}

const MODE_RE=/\b(client|audience|users?|visitors?|customers?|public|approachab)/i;
// Build a design work packet for an external agent to run DADA's loop. Pure; no network, no inference.
export function designPacket(dada,{brief,mode,lite=false}){
 if(typeof brief!=='string'||brief.trim().length<10||brief.length>4000)throw Object.assign(new Error('Design brief must be 10-4000 characters'),{code:'input',status:400});
 if(mode!==undefined&&!DADA_MODES.includes(mode))throw Object.assign(new Error('mode must be Autonomous or Adaptive'),{code:'input',status:400});
 const chosen=mode??(MODE_RE.test(brief)?'Adaptive':'Autonomous');
 return {
  kind:'jarvis.design-packet/1',skill:{id:'dada',repo:'https://github.com/SolutionsAsService/dada',commit:dada.commit,path:'skills/dada/SKILL.md',sha256:dada.skillSha256,license:'NOASSERTION (no upstream LICENSE file; not redistributed)'},
  brief,mode:chosen,modeReason:mode?'requested':(chosen==='Adaptive'?'brief names an audience/client/public':'default: no audience named'),lite:Boolean(lite),
  requiredArtifacts:DADA_ARTIFACTS,stopConditions:lite?[]:DADA_STOP,requiredSeats:DADA_REQUIRED_SEATS[chosen],
  log:'DESIGN-LOG.md',instructions:'Load the pinned skill file by path and sha256, run its workflow on the brief, and return DESIGN-LOG.md plus the artifact. JARVIS checks the log with checkDesignLog; it does not judge the design.'
 };
}

// Structural check of a returned DESIGN-LOG.md. It proves the five artifacts are present and that unmet stop
// conditions are declared; it does not prove the panel was independent or the design is good.
export function checkDesignLog(text,{lite=false}={}){
 if(typeof text!=='string')throw Object.assign(new Error('DESIGN-LOG text required'),{code:'input',status:400});
 const has=a=>new RegExp('^#{1,4}.*'+a.replace(/s$/,'s?'),'im').test(text)||new RegExp('^#{1,4}\\s*(Move|Panel)','im').test(text)&&(a==='Decision Records'&&/^#{1,4}\s*Move\s/im.test(text)||a==='Panel Reports'&&/^#{1,4}\s*Panel\b/im.test(text));
 const artifacts=Object.fromEntries(DADA_ARTIFACTS.map(a=>[a,has(a)]));
 const missing=Object.entries(artifacts).filter(([,v])=>!v).map(([k])=>k);
 const mode=DADA_MODES.find(m=>new RegExp('Mode:?\\**\\s*\\**'+m,'i').test(text))??null;
 const declaredLite=/\bLite\b/.test(text);
 const openFrontier=/open frontier/i.test(text);
 const unchecked=(text.match(/^\s*- \[ \]/gm)||[]).length,checked=(text.match(/^\s*- \[x\]/gim)||[]).length;
 const ok=missing.length===0&&mode!==null&&(!lite||declaredLite)&&(unchecked===0||openFrontier||declaredLite);
 return {ok,artifacts,missing,mode,lite:declaredLite,openFrontier,compliance:{checked,unchecked},complete:ok&&unchecked===0&&!declaredLite};
}
