import {createServer} from 'node:http';
import {timingSafeEqual} from 'node:crypto';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {Kernel} from './kernel.js';
import {fail,scope} from './common.js';
import {selectSkills} from './skill-router.js';
import {workflowCatalog} from './catalog.js';
import {routeModel} from './model-router.js';
import {McpRegistry} from './mcp.js';
import {createStaticServer} from '../server.mjs';
export function createKernelServer({kernel,tokens,staticRoot=resolve('dist')}={}){if(!kernel||!Array.isArray(tokens)||tokens.some(t=>t.token.length<24))throw new Error('Explicit strong backend token bindings required');const staticServer=createStaticServer(staticRoot);let worker=Promise.resolve();let scheduled=false,again=false,workerError=null;const registry=kernel.mcp??new McpRegistry();
 const schedule=()=>{again=true;if(scheduled)return;scheduled=true;worker=worker.then(async()=>{try{do{again=false;for(const binding of tokens)await kernel.drain(binding.actor);}while(again);}catch(e){workerError=e.code??'supervisor_failed';}finally{scheduled=false;}});};
 const server=createServer(async(req,res)=>{if(!req.url.startsWith('/api/')){staticServer.emit('request',req,res);return;}res.setHeader('Content-Type','application/json');res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');const send=(status,data)=>{res.writeHead(status);res.end(JSON.stringify(data));};try{const host=req.headers.host;if(!host||!/^127[.]0[.]0[.]1:[0-9]+$/.test(host))fail('host','Local host required',403);if(req.headers.origin&&req.headers.origin!=='http://'+host)fail('origin','Cross-origin forbidden',403);const supplied=req.headers.authorization?.replace(/^Bearer /,'')??'';const binding=tokens.find(t=>{const a=Buffer.from(t.token),b=Buffer.from(supplied);return a.length===b.length&&timingSafeEqual(a,b);});if(!binding)fail('authentication','Bearer token required',401);const actor=binding.actor,path=new URL(req.url,'http://'+host).pathname;
 if(req.method==='GET'&&path==='/api/health'){send(200,{status:workerError?'blocked':'ready',supervisorError:workerError,mode:'local-kernel',executor:'owned-text-digest',inference:false,tenant:actor.tenant});return;}
 let body;if(['POST'].includes(req.method)){let length=0,parts=[];for await(const chunk of req){length+=chunk.length;if(length>8192)fail('body_limit','Request too large',413);parts.push(chunk);}try{body=JSON.parse(Buffer.concat(parts).toString());}catch{fail('json','Invalid JSON');}if(!body||typeof body!=='object'||Array.isArray(body))fail('json','JSON object required');}
 if(req.method==='POST'&&path==='/api/tasks'){const task=kernel.submit(actor,body);send(202,task);schedule();return;}
 if(req.method==='POST'&&['/api/skills/route','/api/models/route','/api/mcp/preview'].includes(path)){
 scope(actor,actor.tenant,body.workspace);
 if(path==='/api/skills/route'){if(!Array.isArray(body.capabilities??[])||(body.capabilities??[]).some(c=>typeof c!=='string')||typeof(body.intent??'')!=='string')fail('input','Invalid routing request');send(200,selectSkills(workflowCatalog(actor,body.workspace),{actor,workspace:body.workspace,capabilities:body.capabilities??[],intent:body.intent??'',budget:body.budget??512}));return;}
 if(path==='/api/models/route'){send(200,routeModel([],{tenant:actor.tenant,pin:body.pin}));return;}
 send(200,registry.preview({...body,tenant:actor.tenant},actor));return;
 }
 const match=path.match(new RegExp('^/api/tasks/([0-9a-f-]{36})(/cancel)?$'));if(match){if(req.method==='GET'&&!match[2]){send(200,kernel.read(actor,match[1]));return;}if(req.method==='POST'&&match[2]){send(202,kernel.cancel(actor,match[1]));return;}}
 fail('not_found','Unknown API route',404);
 }catch(e){send(e.status??500,{error:e.code??'internal',message:e.status?e.message:'Internal failure'});}});server.once('listening',schedule);server.requestTimeout=5000;server.headersTimeout=5000;server.maxRequestsPerSocket=100;server.kernelIdle=async()=>{await worker;};server.shutdown=async()=>{await new Promise(r=>server.close(r));await worker;await kernel.close();};return server;}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){if(!process.env.JARVIS_TOKEN||process.env.JARVIS_TOKEN.length<24)throw new Error('Set JARVIS_TOKEN (24+ characters); never put it in Vite/browser storage');const actor={id:'local-owner',tenant:'local',workspaces:['default'],capabilities:['text.digest']};const kernel=new Kernel({path:resolve('.jarvis/state.sqlite')});const server=createKernelServer({kernel,tokens:[{token:process.env.JARVIS_TOKEN,actor}]});server.listen(Number(process.env.PORT||8787),'127.0.0.1',()=>console.log('JARVIS local kernel: http://127.0.0.1:'+server.address().port));for(const signal of ['SIGTERM','SIGINT'])process.once(signal,()=>server.shutdown().catch(e=>{console.error(e.message);process.exitCode=1;}));}
