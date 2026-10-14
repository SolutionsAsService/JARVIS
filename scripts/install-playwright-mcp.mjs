#!/usr/bin/env node
// Operator install for the Playwright MCP adapter (kernel/adapters/playwright-mcp.js). Not run by npm ci or CI.
// Installs the npm version pinned in upstreams/lock.json (@playwright/mcp) into .jarvis/tools/playwright-mcp
// (gitignored) and downloads the matching browser build with the package's own installer. Nothing is installed
// globally, no system packages are touched, and no gateway or MCP client config is written.
//
//   npm run mcp:playwright:install                         pinned package + chrome-for-testing (what --browser chromium uses)
//   npm run mcp:playwright:install -- --browser firefox    another browser build
//   npm run mcp:playwright:install -- --no-browser         package only
//   npm run mcp:playwright:install -- --dir /abs/path      install somewhere else (then set JARVIS_PLAYWRIGHT_MCP_BIN)
// Browsers go to PLAYWRIGHT_BROWSERS_PATH when set, else the Playwright default cache (~/.cache/ms-playwright).
import {spawnSync} from 'node:child_process';
import {mkdirSync,writeFileSync,existsSync} from 'node:fs';
import {join,resolve,dirname,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
import {readLock} from './upstream.mjs';
import {installedVersion} from '../kernel/adapters/playwright-mcp.js';

const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const BROWSER_BUILDS={chromium:'chrome-for-testing',chrome:'chrome',firefox:'firefox',webkit:'webkit',msedge:'msedge'};
export function installPlan(argv,{root=ROOT,lock=readLock()}={}){
 const e=lock.components.find(c=>c.id==='playwright-mcp');if(!e?.runtime?.package?.version)throw new Error('upstreams/lock.json has no playwright-mcp package pin');
 const opt=f=>{const i=argv.indexOf(f);return i>=0?argv[i+1]:undefined;};
 const dir=opt('--dir')??join(root,'.jarvis/tools/playwright-mcp');if(!isAbsolute(dir))throw new Error('--dir must be absolute');
 const browser=opt('--browser')??'chromium';if(!BROWSER_BUILDS[browser])throw new Error('--browser must be one of '+Object.keys(BROWSER_BUILDS).join(', '));
 const spec=e.runtime.package.name+'@'+e.runtime.package.version;
 return {dir,spec,pin:e.runtime.package.version,bin:join(dir,'node_modules/.bin/playwright-mcp'),browser:argv.includes('--no-browser')?null:BROWSER_BUILDS[browser]};
}
function run(cmd,args,cwd){const r=spawnSync(cmd,args,{cwd,stdio:'inherit',shell:process.platform==='win32'});if(r.status!==0)throw new Error(cmd+' '+args.join(' ')+' failed ('+r.status+')');}
async function main(argv){
 const p=installPlan(argv);mkdirSync(p.dir,{recursive:true});
 if(!existsSync(join(p.dir,'package.json')))writeFileSync(join(p.dir,'package.json'),JSON.stringify({name:'jarvis-playwright-mcp',private:true,description:'Operator-installed @playwright/mcp for the JARVIS kernel (see upstreams/lock.json)'},null,1)+'\n');
 run('npm',['install','--no-audit','--no-fund','--save-exact',p.spec],p.dir);
 const v=installedVersion(p.bin);if(v!==p.pin)throw new Error('installed playwright-mcp reports '+v+', expected pin '+p.pin);
 if(p.browser)run(p.bin,['install-browser',p.browser],p.dir);
 console.log('playwright-mcp '+v+' installed at '+p.bin+(p.browser?' with browser '+p.browser:''));
 console.log('Enable: JARVIS_PLAYWRIGHT_MCP_ENABLED=1 JARVIS_PLAYWRIGHT_MCP_ALLOWED_ORIGINS="https://example.com" npm run start:kernel');
 return 0;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){main(process.argv.slice(2)).then(c=>{process.exitCode=c;},e=>{console.error(e.message);process.exitCode=1;});}
