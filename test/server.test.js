import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {once} from 'node:events';
import {createStaticServer} from '../server.mjs';
test('production static server serves assets, headers and refuses unsafe requests',async()=>{const root=await mkdtemp(join(tmpdir(),'jarvis-test-'));await writeFile(join(root,'index.html'),'<h1>JARVIS</h1>');await writeFile(join(root,'asset.js'),'console.log("ok")');const server=createStaticServer(root);server.listen(0,'127.0.0.1');await once(server,'listening');const origin='http://127.0.0.1:'+server.address().port;try{const page=await fetch(origin);assert.equal(page.status,200);assert.match(await page.text(),/JARVIS/);assert.match(page.headers.get('content-security-policy'),/object-src 'none'/);assert.equal(page.headers.get('x-content-type-options'),'nosniff');const js=await fetch(origin+'/asset.js');assert.match(js.headers.get('content-type'),/javascript/);const head=await fetch(origin,{method:'HEAD'});assert.equal(await head.text(),'');assert.equal((await fetch(origin,{method:'POST'})).status,405);assert.equal((await fetch(origin+'/missing')).status,404);assert.equal((await fetch(origin+'/%2e%2e%2fsecret')).status,403);}finally{await new Promise(resolve=>server.close(resolve));await rm(root,{recursive:true,force:true});}});
