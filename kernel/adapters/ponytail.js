// Ponytail ("lazy senior dev mode") adapter. OFF by default.
// Upstream: https://github.com/SolutionsAsService/ponytail (fork of DietrichGebert/ponytail), MIT. JARVIS still copies
// nothing: it pins a commit, fetches it on demand (sparse, without media) into .jarvis/upstreams/ponytail/<sha>
// (scripts/upstream.mjs), checks a structural contract and prepares coding work packets naming the pinned skill file.
// Ponytail is a prompt-level agent skill: an LLM agent applies it, never this kernel (the kernel has no inference).
import {readFileSync,existsSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {createHash} from 'node:crypto';

const sha=b=>createHash('sha256').update(b).digest('hex');
export const PONYTAIL_ID='ponytail';
export const PONYTAIL_OPERATION='code.ponytail';
export const PONYTAIL_SKILLS=['ponytail','ponytail-review','ponytail-audit','ponytail-debt','ponytail-gain','ponytail-help'];
// Skills a task can be routed to; gain/help are display-only and stay out of routing.
const ROUTES=[['ponytail-audit',/\baudit\b/i],['ponytail-review',/\breview\b/i],['ponytail-debt',/\b(debt|shortcuts?)\b/i]];
export const PONYTAIL_REQUIRED_PATHS=['LICENSE','package.json','AGENTS.md',...PONYTAIL_SKILLS.map(s=>'skills/'+s+'/SKILL.md'),...PONYTAIL_SKILLS.map(s=>'.openclaw/skills/'+s+'/SKILL.md')];

const fmName=t=>/^---\n[\s\S]*?^name:\s*(\S+)[\s\S]*?\n---/m.exec(t)?.[1]??null;

// Pure: files = {path: string|Buffer|undefined}. Returns a JSON-stable contract.
export function extractPonytailContract(files){
 const text=p=>files[p]===undefined?'':String(files[p]);
 let pkg={};try{pkg=JSON.parse(text('package.json'));}catch{}
 return {
  schema:'jarvis.ponytail-contract/1',
  package:{name:pkg.name??null,version:pkg.version??null,license:pkg.license??null},
  licenseFile:/^MIT License/.test(text('LICENSE'))?'MIT':null,
  requiredPaths:PONYTAIL_REQUIRED_PATHS.filter(p=>files[p]!==undefined),
  missingPaths:PONYTAIL_REQUIRED_PATHS.filter(p=>files[p]===undefined),
  skills:PONYTAIL_SKILLS.filter(s=>fmName(text('skills/'+s+'/SKILL.md'))===s),
  openclawSkills:PONYTAIL_SKILLS.filter(s=>fmName(text('.openclaw/skills/'+s+'/SKILL.md'))===s),
  hashes:Object.fromEntries(PONYTAIL_REQUIRED_PATHS.filter(p=>files[p]!==undefined).map(p=>[p,sha(Buffer.isBuffer(files[p])?files[p]:String(files[p]))]))
 };
}

export function readPonytailCheckout(dir){const files={};for(const p of PONYTAIL_REQUIRED_PATHS){const f=join(dir,p);if(existsSync(f))files[p]=readFileSync(f);}return extractPonytailContract(files);}

// breaking = JARVIS would stop working or would be lying (lost skill/path, license no longer MIT).
export function diffPonytailContract(snapshot,current){
 const breaking=[],changed=[];
 const lost=(label,a=[],b=[])=>{for(const x of a)if(!b.includes(x))breaking.push(label+' removed: '+x);};
 lost('required path',snapshot.requiredPaths,current.requiredPaths);lost('skill',snapshot.skills,current.skills);lost('openclaw skill',snapshot.openclawSkills,current.openclawSkills);
 if(snapshot.licenseFile==='MIT'&&current.licenseFile!=='MIT')breaking.push('LICENSE is no longer MIT');
 if(snapshot.package.license!==current.package.license)breaking.push('package license '+snapshot.package.license+' -> '+current.package.license);
 if(snapshot.package.version!==current.package.version)changed.push('version '+snapshot.package.version+' -> '+current.package.version);
 for(const [p,h] of Object.entries(current.hashes))if(snapshot.hashes[p]!==h)changed.push('content changed: '+p);
 return {breaking,changed,compatible:breaking.length===0,identical:breaking.length===0&&changed.length===0};
}

// Config: OFF unless JARVIS_PONYTAIL_ENABLED=1. JARVIS_PONYTAIL_DIR overrides the fetched checkout location.
export function ponytailConfigFromEnv(env=process.env,{root=process.cwd(),lock}={}){
 if(env.JARVIS_PONYTAIL_ENABLED!=='1')return null;
 if(!lock)throw Object.assign(new Error('ponytail lock entry missing'),{code:'ponytail_config'});
 return {dir:resolve(env.JARVIS_PONYTAIL_DIR||join(root,'.jarvis/upstreams',PONYTAIL_ID,lock.commit)),commit:lock.commit};
}

export function loadPonytail({dir,commit,snapshot}){
 const marker=join(dir,'.jarvis-upstream.json');
 if(!existsSync(marker))throw Object.assign(new Error('ponytail checkout missing at '+dir+' — run: npm run upstream -- fetch ponytail'),{code:'ponytail_missing'});
 const m=JSON.parse(readFileSync(marker,'utf8'));
 if(m.commit!==commit)throw Object.assign(new Error('ponytail checkout is '+m.commit+', lock pins '+commit),{code:'ponytail_pin'});
 const contract=readPonytailCheckout(dir),diff=diffPonytailContract(snapshot,contract);
 if(!diff.compatible)throw Object.assign(new Error('ponytail contract broken: '+diff.breaking.join('; ')),{code:'ponytail_contract',diff});
 return {id:PONYTAIL_ID,commit,dir,version:contract.package.version,contract,diff};
}

// Coding work packet for an external agent runtime. Pure; no network, no inference.
export function codingPacket(p,{task}){
 if(typeof task!=='string'||task.trim().length<5||task.length>4000)throw Object.assign(new Error('Task must be 5-4000 characters'),{code:'input',status:400});
 const skill=ROUTES.find(([,re])=>re.test(task))?.[0]??'ponytail',path='skills/'+skill+'/SKILL.md';
 return {
  kind:'jarvis.coding-packet/1',task,
  skill:{id:skill,repo:'https://github.com/SolutionsAsService/ponytail',commit:p.commit,version:p.version,path,sha256:p.contract.hashes[path],license:'MIT (Copyright (c) 2026 DietrichGebert)'},
  available:PONYTAIL_SKILLS,
  instructions:'Load the pinned skill file by path and sha256 and apply it to the task. JARVIS routes and pins; it does not write or judge the code.'
 };
}
