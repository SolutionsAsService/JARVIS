import {createServer} from 'node:http';
import {readFile,stat} from 'node:fs/promises';
import {resolve,extname,sep} from 'node:path';
import {pathToFileURL} from 'node:url';
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.json':'application/json','.png':'image/png','.woff2':'font/woff2'};
export function createStaticServer(root=resolve('dist')){return createServer(async(req,res)=>{
 res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','strict-origin-when-cross-origin');res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'self'; form-action 'self'");
 if(!['GET','HEAD'].includes(req.method)){res.writeHead(405,{'Allow':'GET, HEAD'});res.end('Method not allowed');return;}
 try{
  const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
  const file=resolve(root,'.'+(pathname.endsWith('/')?pathname+'index.html':pathname));
  if(file!==root&&!file.startsWith(root+sep)){res.writeHead(403);res.end('Forbidden');return;}
  if(!(await stat(file)).isFile())throw new Error('not a file');
  const data=await readFile(file);res.writeHead(200,{'Content-Type':types[extname(file)]||'application/octet-stream','Content-Length':data.length,'Cache-Control':extname(file)==='.html'?'no-cache':'public, max-age=3600'});res.end(req.method==='HEAD'?undefined:data);
 }catch{res.writeHead(404,{'Content-Type':'text/plain'});res.end('Not found');}
});}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){const server=createStaticServer();server.listen(Number(process.env.PORT||8080),'0.0.0.0',()=>console.log('JARVIS static frontend listening on '+(process.env.PORT||8080)));process.once('SIGTERM',()=>server.close());process.once('SIGINT',()=>server.close());}
