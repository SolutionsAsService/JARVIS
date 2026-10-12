// last30days research skill adapter. Independently authored. OFF BY DEFAULT (JARVIS_LAST30DAYS_ENABLED=1).
// Upstream: https://github.com/SolutionsAsService/last30days-skill (fork of mvanhorn/last30days-skill), MIT.
// Reuse is cleared by the MIT license, but JARVIS still copies none of it: it pins a commit in upstreams/lock.json,
// fetches that commit on demand into .jarvis/upstreams/last30days/<sha> (scripts/upstream.mjs: shallow, blobless,
// sparse without the large media), checks a structural contract against upstreams/contracts/last30days.json and
// runs the pinned Python engine (skills/last30days/scripts/last30days.py, python3.12+) as a kernel-owned child.
//
// Ownership and privacy rules:
//  - the checkout is refused unless its commit marker equals the pin and its contract is compatible with the snapshot;
//  - the engine never reads browser cookies: every run passes --no-browser-cookies and FROM_BROWSER=off;
//  - the engine never reads the operator's last30days config or API keys: it runs with a scrubbed env
//    (LAST30DAYS_CONFIG_DIR="" = clean mode), a throwaway HOME and cwd per task, and no keys are forwarded;
//  - only keyless sources are allowed (reddit, hackernews, polymarket, github); --web-backend none, --quick;
//  - one child per task, in its own process group, killed on cancel/deadline and reaped before the result returns;
//  - nothing is published or stored by the engine (no --publish*, --store, --save-dir); its temp HOME is removed.
// The kernel has no inference: the engine's deterministic planner is used, and the result is ranked evidence
// (clusters + results), not a synthesis. An agent runtime can synthesise from it.
import {readFileSync,existsSync,mkdtempSync,rmSync} from 'node:fs';
import {execFileSync,spawn} from 'node:child_process';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';

const sha=b=>createHash('sha256').update(b).digest('hex');
export const L30_ID='last30days';
export const L30_OPERATION='research.last30days';
export const L30_ENGINE='skills/last30days/scripts/last30days.py';
export const L30_CONTRACT_SCHEMA='jarvis.last30days-contract/1';
// Paths whose presence is part of the contract (a removal is breaking).
export const L30_REQUIRED_PATHS=Object.freeze(['LICENSE','pyproject.toml','skills/last30days/SKILL.md',L30_ENGINE,'skills/last30days/scripts/lib/pipeline.py','skills/last30days/scripts/lib/schema.py','skills/last30days/scripts/lib/env.py','skills/last30days/scripts/lib/reddit.py','skills/last30days/scripts/lib/hackernews.py','skills/last30days/scripts/lib/polymarket.py','skills/last30days/scripts/lib/github.py','mcp/manifest.json','mcp/go.mod']);
// CLI flags JARVIS passes. Their removal is breaking (above all --no-browser-cookies).
export const L30_REQUIRED_FLAGS=Object.freeze(['--days','--emit','--mock','--no-browser-cookies','--quick','--search','--web-backend']);
// Sources that work without API keys. JARVIS allows only these.
export const L30_KEYLESS_SOURCES=Object.freeze(['reddit','hackernews','polymarket','github']);
// Keys of the --emit json (agent profile) export JARVIS reads.
export const L30_EXPORT_KEYS=Object.freeze(['schema_version','query','generated_at','window_days','source_status','clusters','results']);

export class Last30Error extends Error{constructor(code,message,status=400){super(message);this.code=code;this.status=status;}}
const fail=(code,message,status)=>{throw new Last30Error(code,message,status);};

function frontmatter(text){const m=/^---\n([\s\S]*?)\n---/.exec(text);if(!m)return {};const out={};for(const line of m[1].split('\n')){const k=/^([a-z_-]+):\s*(.*)$/.exec(line);if(k)out[k[1]]=k[2].replace(/^"|"$/g,'');}return out;}
const pyList=(src,name)=>{const m=new RegExp('^'+name+'\\s*=\\s*[\\[{(]([\\s\\S]*?)[\\]})]','m').exec(src);return m?[...m[1].matchAll(/["']([a-z0-9_.-]+)["']/g)].map(x=>x[1]):[];};
// choices=[...] of the add_argument call that declares flag (searched up to the next add_argument call).
const choicesOf=(src,flag)=>{for(const part of src.split('add_argument(').slice(1)){if(!part.trimStart().startsWith('"'+flag+'"'))continue;const m=/choices=\[([^\]]*)\]/.exec(part);if(m)return [...m[1].matchAll(/"([a-z-]+)"/g)].map(x=>x[1]);}return [];};

// Pure: files = {path: string|Buffer|undefined}. Returns a JSON-stable contract.
export function extractLast30Contract(files){
 const text=p=>files[p]===undefined?'':String(files[p]);
 const skill=text('skills/last30days/SKILL.md'),cli=text(L30_ENGINE),py=text('pyproject.toml'),lic=text('LICENSE'),pipe=text('skills/last30days/scripts/lib/pipeline.py'),schema=text('skills/last30days/scripts/lib/schema.py'),env=text('skills/last30days/scripts/lib/env.py');
 let manifest={};try{manifest=JSON.parse(text('mcp/manifest.json')||'{}');}catch{}
 const fm=frontmatter(skill);
 return {
  schema:L30_CONTRACT_SCHEMA,
  skill:{name:fm.name??null,version:fm.version??null,license:fm.license??null,descriptionSha256:fm.description?sha(fm.description):null},
  license:{spdx:/^MIT License\b/.test(lic.trim())?'MIT':null,sha256:lic?sha(lic):null},
  package:{version:/^version\s*=\s*"([^"]+)"/m.exec(py)?.[1]??null,requiresPython:/^requires-python\s*=\s*"([^"]+)"/m.exec(py)?.[1]??null},
  requiredPaths:L30_REQUIRED_PATHS.filter(p=>files[p]!==undefined),missingPaths:L30_REQUIRED_PATHS.filter(p=>files[p]===undefined),
  cli:{flags:[...new Set([...cli.matchAll(/add_argument\(\s*"(--[a-z0-9-]+)"/g)].map(x=>x[1]))].sort(),emit:choicesOf(cli,'--emit'),webBackends:choicesOf(cli,'--web-backend')},
  sources:pyList(pipe,'MOCK_AVAILABLE_SOURCES'),
  exportSchemaVersion:/^AGENT_EXPORT_SCHEMA_VERSION\s*=\s*"([^"]+)"/m.exec(schema)?.[1]??null,
  privacy:{cleanConfigMode:/LAST30DAYS_CONFIG_DIR/.test(env),fromBrowserOff:/FROM_BROWSER=off/.test(env)},
  mcp:{name:manifest.name??null,version:manifest.version??null,license:manifest.license??null,goModule:/^module\s+(\S+)/m.exec(text('mcp/go.mod'))?.[1]??null},
  hashes:Object.fromEntries(L30_REQUIRED_PATHS.filter(p=>files[p]!==undefined).map(p=>[p,sha(Buffer.isBuffer(files[p])?files[p]:String(files[p]))]))
 };
}

export function readLast30Checkout(dir){const files={};for(const p of L30_REQUIRED_PATHS){const f=join(dir,p);if(existsSync(f))files[p]=readFileSync(f);}return extractLast30Contract(files);}

// Compare a fresh contract with the committed snapshot. breaking = JARVIS would stop working, or its privacy or
// licensing claims would no longer hold.
export function diffLast30Contract(snapshot,current){
 const breaking=[],changed=[];
 const lost=(label,a=[],b=[])=>{for(const x of a)if(!b.includes(x))breaking.push(label+' removed: '+x);};
 if(current.schema!==snapshot.schema)breaking.push('contract schema '+snapshot.schema+' -> '+current.schema);
 if(current.skill.name!==snapshot.skill.name)breaking.push('skill name '+snapshot.skill.name+' -> '+current.skill.name);
 if(snapshot.license.spdx==='MIT'&&current.license.spdx!=='MIT')breaking.push('LICENSE is no longer MIT (reuse clearance lost)');
 if(current.package.requiresPython!==snapshot.package.requiresPython)breaking.push('requires-python '+snapshot.package.requiresPython+' -> '+current.package.requiresPython);
 lost('required path',snapshot.requiredPaths,current.requiredPaths);
 lost('required CLI flag',L30_REQUIRED_FLAGS.filter(f=>snapshot.cli.flags.includes(f)),current.cli.flags);
 if(snapshot.cli.emit.includes('json')&&!current.cli.emit.includes('json'))breaking.push('--emit json removed');
 if(snapshot.cli.webBackends.includes('none')&&!current.cli.webBackends.includes('none'))breaking.push('--web-backend none removed');
 lost('keyless source',L30_KEYLESS_SOURCES.filter(s=>snapshot.sources.includes(s)),current.sources);
 const major=v=>String(v??'').split('.')[0];
 if(major(current.exportSchemaVersion)!==major(snapshot.exportSchemaVersion))breaking.push('json export schema major '+snapshot.exportSchemaVersion+' -> '+current.exportSchemaVersion);
 else if(current.exportSchemaVersion!==snapshot.exportSchemaVersion)changed.push('json export schema '+snapshot.exportSchemaVersion+' -> '+current.exportSchemaVersion);
 for(const k of ['cleanConfigMode','fromBrowserOff'])if(snapshot.privacy[k]&&!current.privacy[k])breaking.push('privacy switch removed: '+k);
 for(const f of snapshot.cli.flags)if(!current.cli.flags.includes(f)&&!L30_REQUIRED_FLAGS.includes(f))changed.push('CLI flag removed: '+f);
 for(const f of current.cli.flags)if(!snapshot.cli.flags.includes(f))changed.push('CLI flag added: '+f);
 for(const s of current.sources)if(!snapshot.sources.includes(s))changed.push('source added: '+s);
 for(const s of snapshot.sources)if(!current.sources.includes(s)&&!L30_KEYLESS_SOURCES.includes(s))changed.push('source removed: '+s);
 if(current.package.version!==snapshot.package.version)changed.push('version '+snapshot.package.version+' -> '+current.package.version);
 if(current.skill.descriptionSha256!==snapshot.skill.descriptionSha256)changed.push('skill description changed');
 if(current.mcp.version!==snapshot.mcp.version||current.mcp.name!==snapshot.mcp.name)changed.push('mcp server '+snapshot.mcp.name+'@'+snapshot.mcp.version+' -> '+current.mcp.name+'@'+current.mcp.version);
 for(const [p,h] of Object.entries(current.hashes))if(snapshot.hashes[p]!==h)changed.push('content changed: '+p);
 return {breaking,changed,compatible:breaking.length===0,identical:breaking.length===0&&changed.length===0};
}

// Config: OFF unless JARVIS_LAST30DAYS_ENABLED=1.
//   JARVIS_LAST30DAYS_DIR=<checkout>     default .jarvis/upstreams/last30days/<pinned sha>
//   JARVIS_LAST30DAYS_PYTHON=python3     interpreter (must satisfy the contract's requires-python, 3.12+)
//   JARVIS_LAST30DAYS_SOURCES=reddit,hackernews,polymarket,github   subset of the keyless sources
//   JARVIS_LAST30DAYS_DAYS=30            lookback window, 1-30
//   JARVIS_LAST30DAYS_MAX_RESULTS=25     results kept in the task result, 1-100
//   JARVIS_LAST30DAYS_MOCK=1             run the engine on its own --mock fixtures (no network)
export function last30ConfigFromEnv(env=process.env,{root=process.cwd(),lock}={}){
 if(env.JARVIS_LAST30DAYS_ENABLED!=='1')return null;
 if(!lock)fail('last30days_config','last30days lock entry missing',500);
 const sources=(env.JARVIS_LAST30DAYS_SOURCES||L30_KEYLESS_SOURCES.join(',')).split(',').map(s=>s.trim().toLowerCase()).filter(Boolean);
 const bad=sources.filter(s=>!L30_KEYLESS_SOURCES.includes(s));if(bad.length||!sources.length)fail('last30days_config','JARVIS_LAST30DAYS_SOURCES must be a subset of '+L30_KEYLESS_SOURCES.join(',')+' (got '+(bad.join(',')||'nothing')+')',500);
 const int=(v,d,lo,hi,name)=>{const n=v===undefined||v===''?d:Number(v);if(!Number.isInteger(n)||n<lo||n>hi)fail('last30days_config',name+' must be an integer '+lo+'-'+hi,500);return n;};
 return {dir:resolve(env.JARVIS_LAST30DAYS_DIR||join(root,'.jarvis/upstreams',L30_ID,lock.commit)),commit:lock.commit,python:env.JARVIS_LAST30DAYS_PYTHON||'python3',sources:[...new Set(sources)],days:int(env.JARVIS_LAST30DAYS_DAYS,30,1,30,'JARVIS_LAST30DAYS_DAYS'),maxResults:int(env.JARVIS_LAST30DAYS_MAX_RESULTS,25,1,100,'JARVIS_LAST30DAYS_MAX_RESULTS'),mock:env.JARVIS_LAST30DAYS_MOCK==='1'};
}

// ">=3.12" style requirement against "Python 3.12.3".
export function pythonSatisfies(versionText,requires){const v=/(\d+)\.(\d+)/.exec(String(versionText??''));const r=/>=\s*(\d+)\.(\d+)/.exec(String(requires??''));if(!v||!r)return false;return Number(v[1])>Number(r[1])||Number(v[1])===Number(r[1])&&Number(v[2])>=Number(r[2]);}

// Load a fetched checkout and refuse it loudly unless commit marker, contract and interpreter are acceptable.
export function loadLast30({dir,commit,python='python3',sources=[...L30_KEYLESS_SOURCES],days=30,maxResults=25,mock=false},snapshot,{probePython=p=>execFileSync(p,['--version'],{encoding:'utf8',timeout:10000,stdio:['ignore','pipe','pipe']})}={}){
 const marker=join(dir,'.jarvis-upstream.json');
 if(!existsSync(marker))fail('last30days_missing','last30days checkout missing at '+dir+' — run: npm run upstream -- fetch last30days',500);
 const m=JSON.parse(readFileSync(marker,'utf8'));
 if(m.commit!==commit)fail('last30days_pin','last30days checkout is '+m.commit+', lock pins '+commit,500);
 const contract=readLast30Checkout(dir),diff=diffLast30Contract(snapshot,contract);
 if(!diff.compatible)throw Object.assign(new Last30Error('last30days_contract','last30days contract broken: '+diff.breaking.join('; '),500),{diff});
 let pyVersion;try{pyVersion=String(probePython(python)).trim();}catch(e){fail('last30days_python','Python interpreter '+python+' not runnable: '+(e.code??e.message),500);}
 if(!pythonSatisfies(pyVersion,contract.package.requiresPython))fail('last30days_python',python+' is '+pyVersion+'; the pinned engine requires '+contract.package.requiresPython+' (set JARVIS_LAST30DAYS_PYTHON)',500);
 const engine=join(dir,L30_ENGINE);
 const cfg={commit,dir,engine,python,pythonVersion:pyVersion,sources,days,maxResults,mock,contract,diff};
 return {...cfg,engineSha256:contract.hashes[L30_ENGINE],executor:opts=>last30Executor(cfg,opts),summary:()=>({enabled:true,commit,engineSha256:contract.hashes[L30_ENGINE],version:contract.package.version,python:pyVersion,sources,days,mock,contract:diff.identical?'identical':'compatible',operation:L30_OPERATION,browserCookies:false,apiKeys:false,inference:false})};
}

// argv for one research run. Pure; exported for tests.
export function engineArgs(cfg,topic){
 const a=[cfg.engine,topic,'--emit','json','--no-browser-cookies','--quick','--web-backend','none','--search',cfg.sources.join(','),'--days',String(cfg.days)];
 if(cfg.mock)a.push('--mock');return a;
}
// Env for one research run: nothing inherited except PATH/locale/CA paths; no keys, no config, no browser cookies.
export function engineEnv(home,base=process.env){
 const env={PATH:base.PATH||'/usr/local/bin:/usr/bin:/bin',HOME:home,USERPROFILE:home,TMPDIR:home,LAST30DAYS_CONFIG_DIR:'',FROM_BROWSER:'off',PYTHONDONTWRITEBYTECODE:'1',PYTHONIOENCODING:'utf-8',NO_COLOR:'1'};
 for(const k of ['LANG','LC_ALL','SYSTEMROOT','SSL_CERT_FILE','SSL_CERT_DIR'])if(base[k])env[k]=base[k];
 return env;
}

const MAX_STDOUT=4*1024*1024;
export function validateTopic(text){if(typeof text!=='string')fail('input','Research topic required');const topic=text.trim().replace(/\s+/g,' ');if(topic.length<2||topic.length>300)fail('input','Research topic must be 2-300 characters');if(topic.startsWith('-'))fail('input','Research topic must not start with "-"');return topic;}
const clip=(s,n)=>typeof s==='string'&&s.length>n?s.slice(0,n-1)+'…':s;
// Bound and shape the engine's agent JSON export into the task result.
export function shapeReport(raw,{maxResults=25}={}){
 let r;try{r=JSON.parse(raw);}catch{fail('last30days_output','Engine output is not JSON',502);}
 if(!r||typeof r!=='object'||Array.isArray(r))fail('last30days_output','Engine output is not an object',502);
 const missing=L30_EXPORT_KEYS.filter(k=>!(k in r));if(missing.length)fail('last30days_output','Engine output missing '+missing.join(', '),502);
 const results=(Array.isArray(r.results)?r.results:[]).slice(0,maxResults).map(x=>({title:clip(x.title,300),source:x.source,url:clip(x.url,1000),published_at:x.published_at??null,summary:clip(x.summary,600),engagement:x.engagement??null,relevance_score:x.relevance_score??null,cluster:x.cluster??null}));
 const clusters=(Array.isArray(r.clusters)?r.clusters:[]).slice(0,20).map(c=>({title:clip(c.title,300),summary:clip(c.summary,600),sources:c.sources,engagement_total:c.engagement_total??null}));
 return {schema_version:r.schema_version,query:r.query,generated_at:r.generated_at,window_days:r.window_days,source_status:r.source_status,clusters,results,totalResults:Array.isArray(r.results)?r.results.length:0};
}

// Run the pinned engine once: own process group, scrubbed env, throwaway HOME/cwd, kill + reap on abort.
export function runEngine(cfg,topic,{signal,timeoutMs=9500,env}={}){
 return new Promise((resolveRun,reject)=>{
  if(signal?.aborted)return reject(new Last30Error('last30days_aborted','Aborted before start',499));
  const home=mkdtempSync(join(tmpdir(),'jarvis-l30-'));
  const cleanup=()=>{try{rmSync(home,{recursive:true,force:true});}catch{}};
  const group=process.platform!=='win32';
  let child;try{child=spawn(cfg.python,engineArgs(cfg,topic),{cwd:home,env:env??engineEnv(home),stdio:['ignore','pipe','pipe'],detached:group,windowsHide:true});}catch(e){cleanup();return reject(new Last30Error('last30days_spawn',e.message,500));}
  const out=[];let outLen=0,err='',stop=null;
  const signalChild=s=>{try{group?process.kill(-child.pid,s):child.kill(s);}catch{}};
  const kill=reason=>{if(stop)return;stop=reason;signalChild('SIGTERM');setTimeout(()=>signalChild('SIGKILL'),1500).unref();};
  const timer=setTimeout(()=>kill('timeout'),timeoutMs);const onAbort=()=>kill('aborted');signal?.addEventListener('abort',onAbort,{once:true});
  child.stdout.on('data',d=>{outLen+=d.length;if(outLen>MAX_STDOUT)kill('output_limit');else out.push(d);});
  child.stderr.on('data',d=>{err=(err+d).slice(-2000);});
  child.on('error',e=>{stop=stop??'spawn';err=e.message;});
  child.on('close',(code,sig)=>{clearTimeout(timer);signal?.removeEventListener('abort',onAbort);if(group)signalChild('SIGKILL');cleanup();
   if(stop)return reject(new Last30Error('last30days_'+stop,'Engine stopped: '+stop+(stop==='spawn'?' ('+err+')':''),stop==='aborted'?499:504));
   if(code!==0)return reject(new Last30Error('last30days_exit','Engine exited '+(code??sig)+': '+err.trim().split('\n').slice(-3).join(' | '),502));
   resolveRun({stdout:Buffer.concat(out).toString('utf8'),stderrTail:err});});
 });
}

export function last30Executor(cfg,{run=runEngine}={}){
 return async({input,signal})=>{
  const topic=validateTopic(input.text);const started=Date.now();
  const timeoutMs=Math.max(500,Math.min(9500,(input.timeoutMs??10000)-300));
  const {stdout}=await run(cfg,topic,{signal,timeoutMs});
  const report=shapeReport(stdout,{maxResults:cfg.maxResults});
  return {executor:'last30days-research-v1',engine:{id:L30_ID,repo:'https://github.com/SolutionsAsService/last30days-skill',commit:cfg.commit,path:L30_ENGINE,sha256:cfg.contract.hashes[L30_ENGINE],license:'MIT',python:cfg.pythonVersion},
   run:{topic,sources:cfg.sources,days:cfg.days,mock:cfg.mock,browserCookies:false,apiKeys:false,planner:'engine deterministic fallback (no --plan)',ms:Date.now()-started},report};
 };
}
