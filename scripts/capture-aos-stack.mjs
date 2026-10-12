// Capture docs screenshots of the AOS stack view from a production build.
// Usage: npm run build && node scripts/capture-aos-stack.mjs   (needs a Playwright Chromium)
import {chromium} from '@playwright/test';
import {createStaticServer} from '../server.mjs';
import {resolve} from 'node:path';
const server=createStaticServer(resolve('dist'));
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const base='http://127.0.0.1:'+server.address().port+'/';
const browser=await chromium.launch();
try{
 for(const [name,viewport,full] of [['aos-stack.png',{width:1440,height:900},true],['aos-stack-mobile.png',{width:390,height:844},false]]){
  const page=await browser.newPage({viewport,deviceScaleFactor:1});
  await page.goto(base);
  await page.getByRole('button',{name:'Live digest task (runs today)'}).click();
  await page.waitForFunction(()=>document.querySelectorAll('#aos-lines path.flow-line').length>5);
  await page.evaluate(()=>{document.activeElement?.blur();document.querySelector('#toast')?.classList.remove('show');window.scrollTo(0,0);});
  if(!full)await page.evaluate(()=>document.querySelector('#aos-map').scrollIntoView({block:'start'}));
  await page.waitForTimeout(300);
  await page.screenshot({path:resolve('docs',name),fullPage:full,animations:'disabled'});
  await page.close();
  console.log('wrote docs/'+name);
 }
}finally{await browser.close();server.close();}
