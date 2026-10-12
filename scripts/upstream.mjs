#!/usr/bin/env node
// Shared pin/fetch/update tool for external components JARVIS tracks by commit (upstreams/lock.json).
// No upstream code is committed by this tool: it fetches pinned commits into .jarvis/upstreams/<id>/<sha>
// (gitignored) and compares each component's structural contract with upstreams/contracts/<id>.json.
//
//   node scripts/upstream.mjs list                       pins, license findings, policy
//   node scripts/upstream.mjs check [id]                 ls-remote the tracked branch; "update available" or "current"
//   node scripts/upstream.mjs fetch <id> [--ref <sha>]   fetch a commit (default: the pin) into .jarvis/upstreams
//   node scripts/upstream.mjs verify <id>                fetch the pin and require contract == snapshot (CI)
//   node scripts/upstream.mjs update <id> [--write] [--accept-breaking]
//        fetch the branch head, diff its contract against the snapshot; exit 3 on breaking changes.
//        --write re-pins lock.json + snapshot (refused on breaking changes unless --accept-breaking).
// Contract extractors are registered per id in CONTRACTS; components without one are pin-only.
import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync,mkdirSync,existsSync,rmSync} from 'node:fs';
import {join,resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {readDadaCheckout,diffDadaContract} from '../kernel/adapters/dada.js';

const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const LOCK=join(ROOT,'upstreams/lock.json');
export const CONTRACTS={dada:{read:readDadaCheckout,diff:diffDadaContract}};
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
 git(['-C',dir,'init','-q']);git(['-C',dir,'remote','add','origin',e.repo]);git(['-C',dir,'fetch','-q','--depth','1','origin',sha]);git(['-C',dir,'checkout','-q','FETCH_HEAD']);
 const head=git(['-C',dir,'rev-parse','HEAD']);if(head!==sha)throw new Error('fetched '+head+' but wanted '+sha);
 writeFileSync(marker,JSON.stringify({id:e.id,repo:e.repo,commit:sha,fetchedAt:new Date().toISOString(),policy:e.policy},null,1)+'\n');
 return dir;
}
function contractOf(e,dir){const c=CONTRACTS[e.id];return c?c.read(dir):null;}
function diffOf(e,snap,cur){return CONTRACTS[e.id].diff(snap,cur);}

async function main(argv){
 const [cmd,id,...rest]=argv,flag=f=>rest.includes(f)||argv.includes(f),opt=f=>{const i=argv.indexOf(f);return i>=0?argv[i+1]:undefined;};
 const lock=readLock();
 if(!cmd||cmd==='list'){for(const e of lock.components)console.log([e.id,e.commit.slice(0,12),e.branch,e.policy,e.license.finding].join('\t'));return 0;}
 if(cmd==='check'){let behind=0;for(const e of id?[entry(lock,id)]:lock.components){const head=remoteHead(e);const s=head===e.commit?'current':'update available';if(head!==e.commit)behind++;console.log(JSON.stringify({id:e.id,pinned:e.commit,head,branch:e.branch,status:s,update:'npm run upstream -- update '+e.id}));}return behind&&flag('--strict')?4:0;}
 const e=entry(lock,id);
 if(cmd==='fetch'){const dir=fetchCommit(e,opt('--ref')??e.commit);console.log(dir);return 0;}
 if(cmd==='verify'){const dir=fetchCommit(e,e.commit);if(!CONTRACTS[e.id]){console.log(JSON.stringify({id,commit:e.commit,contract:'none (pin-only)'}));return 0;}const snap=JSON.parse(readFileSync(snapPath(id),'utf8')),d=diffOf(e,snap,contractOf(e,dir));console.log(JSON.stringify({id,commit:e.commit,...d}));return d.identical?0:3;}
 if(cmd==='update'){
  const head=remoteHead(e);const dir=fetchCommit(e,head);
  const snap=CONTRACTS[e.id]?JSON.parse(readFileSync(snapPath(id),'utf8')):null,cur=contractOf(e,dir),d=snap?diffOf(e,snap,cur):{breaking:[],changed:[],compatible:true,identical:head===e.commit};
  const report={id,from:e.commit,to:head,...d};
  if(!d.compatible){console.error('BREAKING upstream change for '+id+':\n  '+d.breaking.join('\n  '));}
  console.log(JSON.stringify(report,null,1));
  if(flag('--write')){
   if(!d.compatible&&!flag('--accept-breaking')){console.error('Refusing to re-pin: breaking contract change. Review, adapt JARVIS, then re-run with --accept-breaking.');return 3;}
   const lic=lock.components.find(c=>c.id===id);lic.commit=head;lic.pinnedAt=new Date().toISOString().slice(0,10);
   writeFileSync(LOCK,JSON.stringify(lock,null,1)+'\n');if(cur)writeFileSync(snapPath(id),JSON.stringify(cur,null,1)+'\n');
   console.error('Re-pinned '+id+' '+e.commit.slice(0,12)+' -> '+head.slice(0,12)+'. Update docs/SOURCES.md and run npm test.');
  }
  return d.compatible?0:3;
 }
 throw new Error('unknown command '+cmd);
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){main(process.argv.slice(2)).then(c=>{process.exitCode=c;},e=>{console.error(e.message);process.exitCode=1;});}
