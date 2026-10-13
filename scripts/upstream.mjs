#!/usr/bin/env node
// Shared pin/fetch/update tool for external components JARVIS tracks by commit (upstreams/lock.json).
// No upstream code is committed by this tool: it fetches pinned commits into .jarvis/upstreams/<id>/<sha>
// (gitignored) and compares each component's structural contract with upstreams/contracts/<id>.json.
// See docs/UPSTREAMS.md for the update workflow.
//
//   node scripts/upstream.mjs list                       pins, license findings, policy
//   node scripts/upstream.mjs check [id] [--strict]      ls-remote the tracked branch; "update available" or "current"
//   node scripts/upstream.mjs fetch <id> [--ref <sha>]   fetch a commit (default: the pin) into .jarvis/upstreams
//   node scripts/upstream.mjs verify [id]                fetch the pin(s) and require contract == snapshot (CI: all)
//   node scripts/upstream.mjs update <id|--all> [--write] [--accept-breaking] [--test]
//        fetch the branch head, diff its contract against the snapshot; exit 3 on breaking changes.
//        --write re-pins lock.json + snapshot + the catalog pin in src/aos-stack.js (refused on breaking changes
//        unless --accept-breaking). --test then runs npm test and restores the previous pin if it fails.
// Contract extractors are registered per id in CONTRACTS (read may be async); components without one are pin-only.
import {execFileSync,spawnSync} from 'node:child_process';
import {readFileSync,writeFileSync,mkdirSync,existsSync,rmSync} from 'node:fs';
import {join,resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {readDadaCheckout,diffDadaContract} from '../kernel/adapters/dada.js';
import {readGmMcpCheckout,diffGmMcpContract} from '../kernel/adapters/gm-mcp.js';
import {readLast30Checkout,diffLast30Contract} from '../kernel/adapters/last30days.js';
import {readPonytailCheckout,diffPonytailContract} from '../kernel/adapters/ponytail.js';

const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const LOCK=join(ROOT,'upstreams/lock.json');
const CATALOG=join(ROOT,'src/aos-stack.js');
export const CONTRACTS={dada:{read:readDadaCheckout,diff:diffDadaContract},'gm-mcp':{read:readGmMcpCheckout,diff:diffGmMcpContract},last30days:{read:readLast30Checkout,diff:diffLast30Contract},ponytail:{read:readPonytailCheckout,diff:diffPonytailContract}};
const git=(args,opts={})=>execFileSync('git',args,{encoding:'utf8',timeout:120000,stdio:['ignore','pipe','pipe'],...opts}).trim();
export const readLock=(file=LOCK)=>JSON.parse(readFileSync(file,'utf8'));
const entry=(lock,id)=>{const e=lock.components.find(c=>c.id===id);if(!e)throw new Error('unknown component '+id+' (known: '+lock.components.map(c=>c.id).join(', ')+')');return e;};
const snapPath=id=>join(ROOT,'upstreams/contracts',id+'.json');
export const checkoutDir=(id,sha,root=ROOT)=>join(root,'.jarvis/upstreams',id,sha);

export function remoteHead(e){const out=git(['ls-remote',e.repo,'refs/heads/'+e.branch]);const sha=out.split(/\s+/)[0];if(!/^[0-9a-f]{40}$/.test(sha))throw new Error('ls-remote returned no head for '+e.repo+' '+e.branch);return sha;}
export function fetchCommit(e,sha,{root=ROOT}={}){
 if(!/^[0-9a-f]{40}$/.test(sha))throw new Error('full 40-hex commit required');
 const dir=checkoutDir(e.id,sha,root),marker=join(dir,'.jarvis-upstream.json');
 if(existsSync(marker)&&JSON.parse(readFileSync(marker,'utf8')).commit===sha&&git(['-C',dir,'rev-parse','HEAD'])===sha)return dir;
 rmSync(dir,{recursive:true,force:true});mkdirSync(dir,{recursive:true});
 // lock entry `fetch` (optional): {filter:'blob:none', sparse:[non-cone patterns]} for repos too large to fetch whole
 // (e.g. last30days: media and assets excluded). Blobs outside the sparse set are never downloaded.
 const f=e.fetch??{};
 git(['-C',dir,'init','-q']);git(['-C',dir,'remote','add','origin',e.repo]);
 if(f.sparse?.length){git(['-C',dir,'config','core.sparseCheckout','true']);git(['-C',dir,'config','core.sparseCheckoutCone','false']);writeFileSync(join(dir,'.git/info/sparse-checkout'),f.sparse.join('\n')+'\n');}
 git(['-C',dir,'fetch','-q','--depth','1',...(f.filter?['--filter='+f.filter]:[]),'origin',sha],{timeout:300000});git(['-C',dir,'checkout','-q','FETCH_HEAD'],{timeout:300000});
 const head=git(['-C',dir,'rev-parse','HEAD']);if(head!==sha)throw new Error('fetched '+head+' but wanted '+sha);
 writeFileSync(marker,JSON.stringify({id:e.id,repo:e.repo,commit:sha,fetchedAt:new Date().toISOString(),policy:e.policy,...(e.fetch?{fetch:e.fetch}:{})},null,1)+'\n');
 return dir;
}
export async function contractOf(e,dir){const c=CONTRACTS[e.id];return c?await c.read(dir):null;}
function diffOf(e,snap,cur){return CONTRACTS[e.id].diff(snap,cur);}

// Keep the AOS catalog pin (src/aos-stack.js `pin:`) in step with lock.json; test/catalog.test.js enforces equality.
export function repinCatalog(from,to,pinnedAt,file=CATALOG){const src=readFileSync(file,'utf8');const re=new RegExp("pin: \\{commit: '"+from+"'(, branch: '[^']+', pinnedAt: ')[0-9-]+'");if(!re.test(src))return false;writeFileSync(file,src.replace(re,"pin: {commit: '"+to+"'$1"+pinnedAt+"'"));return true;}

export async function verifyOne(e){const dir=fetchCommit(e,e.commit);if(!CONTRACTS[e.id])return {id:e.id,commit:e.commit,contract:'none (pin-only)',identical:true};const snap=JSON.parse(readFileSync(snapPath(e.id),'utf8')),d=diffOf(e,snap,await contractOf(e,dir));return {id:e.id,commit:e.commit,...d};}

async function updateOne(lock,e,flag){
 const head=remoteHead(e);const dir=fetchCommit(e,head);
 const snap=CONTRACTS[e.id]?JSON.parse(readFileSync(snapPath(e.id),'utf8')):null,cur=await contractOf(e,dir),d=snap?diffOf(e,snap,cur):{breaking:[],changed:head===e.commit?[]:['commit '+e.commit.slice(0,12)+' -> '+head.slice(0,12)],compatible:true,identical:head===e.commit};
 const report={id:e.id,from:e.commit,to:head,...d};
 if(!d.compatible)console.error('BREAKING upstream change for '+e.id+':\n  '+d.breaking.join('\n  '));
 console.log(JSON.stringify(report,null,1));
 if(!flag('--write')||(head===e.commit&&d.identical))return {code:d.compatible?0:3,written:null};
 if(!d.compatible&&!flag('--accept-breaking')){console.error('Refusing to re-pin '+e.id+': breaking contract change. Review, adapt JARVIS, then re-run with --accept-breaking.');return {code:3,written:null};}
 const backup={lock:readFileSync(LOCK,'utf8'),catalog:readFileSync(CATALOG,'utf8'),snap:snap&&readFileSync(snapPath(e.id),'utf8')};
 const pinnedAt=new Date().toISOString().slice(0,10),from=e.commit;e.commit=head;e.pinnedAt=pinnedAt;
 writeFileSync(LOCK,JSON.stringify(lock,null,1)+'\n');if(cur)writeFileSync(snapPath(e.id),JSON.stringify(cur,null,1)+'\n');
 if(!repinCatalog(from,head,pinnedAt))console.error('No catalog pin for '+e.id+' in src/aos-stack.js; add pin: {commit, branch, pinnedAt, update} to its component.');
 console.error('Re-pinned '+e.id+' '+from.slice(0,12)+' -> '+head.slice(0,12)+'. Record the new revision in docs/SOURCES.md.');
 return {code:d.compatible?0:3,written:{id:e.id,backup}};
}

async function main(argv){
 const [cmd,id,...rest]=argv,flag=f=>rest.includes(f)||argv.includes(f),opt=f=>{const i=argv.indexOf(f);return i>=0?argv[i+1]:undefined;};
 const lock=readLock(),all=!id||id==='--all',targets=()=>all?lock.components:[entry(lock,id)];
 if(!cmd||cmd==='list'){for(const e of lock.components)console.log([e.id,e.commit.slice(0,12),e.branch,e.policy,e.license.finding].join('\t'));return 0;}
 if(cmd==='check'){let behind=0;for(const e of targets()){const head=remoteHead(e);const s=head===e.commit?'current':'update available';if(head!==e.commit)behind++;console.log(JSON.stringify({id:e.id,pinned:e.commit,head,branch:e.branch,status:s,update:'npm run upstream -- update '+e.id+' --write --test'}));}return behind&&flag('--strict')?4:0;}
 if(cmd==='fetch'){const e=entry(lock,id);const dir=fetchCommit(e,opt('--ref')??e.commit);console.log(dir);return 0;}
 if(cmd==='verify'){let code=0;for(const e of targets()){const r=await verifyOne(e);console.log(JSON.stringify(r));if(!r.identical)code=3;}return code;}
 if(cmd==='update'){
  let code=0;const written=[];
  for(const e of targets()){const r=await updateOne(lock,e,flag);code=Math.max(code,r.code);if(r.written)written.push(r.written);}
  if(written.length&&flag('--test')){
   console.error('Running npm test against the new pin(s)...');const t=spawnSync('npm',['test'],{cwd:ROOT,stdio:'inherit',shell:process.platform==='win32'});
   if(t.status!==0){for(const w of written.reverse()){writeFileSync(LOCK,w.backup.lock);writeFileSync(CATALOG,w.backup.catalog);if(w.backup.snap)writeFileSync(snapPath(w.id),w.backup.snap);}console.error('npm test failed: previous pin(s) restored. Adapt JARVIS to the new upstream, then re-run.');return 5;}
   console.error('npm test passed with the new pin(s). Review the diff (git diff upstreams src/aos-stack.js) and commit.');
  }
  return code;
 }
 throw new Error('unknown command '+cmd);
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){main(process.argv.slice(2)).then(c=>{process.exitCode=c;},e=>{console.error(e.message);process.exitCode=1;});}
