#!/usr/bin/env node
import { readFile, readdir, realpath, lstat } from 'node:fs/promises';
import { resolve, join, relative } from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { createServer } from 'node:http';
import { validatePrototype, entryPath } from './contract.mjs';
import { htmlIssues, sandboxCsp } from './html.mjs';
const args=process.argv.slice(2), options={};
for(let i=0;i<args.length;i++){const k=args[i];if(!['--repo','--browser','--playwright'].includes(k))throw Error(`Unknown option ${k}`);options[k]=k==='--browser'?true:args[++i];}
let browser,server;
try {
 const root=await realpath(resolve(options['--repo']||'.'));
 const cfg=JSON.parse(await readFile(join(root,'docs/project/workflow.json'),'utf8')).prototype;
 if(validatePrototype(cfg).length||cfg.status!=='enabled')throw Error('原型配置未启用或不合法');
 const preview=join(root,cfg.packagePath,'preview');
 const entries=[];
 for(const name of await readdir(preview)){
  const item={id:name,title:name,path:`${cfg.packagePath}/preview/${name}`,kind:'page',devices:['pc-web']};
  const path=entryPath(item,cfg);if(!path)continue;
  const full=join(root,path);let st;try{st=await lstat(full)}catch(e){if(e.code==='ENOENT')continue;throw e;}
  if(!st.isFile()||st.isSymbolicLink()||relative(await realpath(join(root,cfg.packagePath)),await realpath(full)).startsWith('..'))throw Error(`非法入口：${name}`);
  if(st.size>10*1024*1024)throw Error(`入口超过 10 MiB：${name}`);
  const html=await readFile(full,'utf8'),issues=htmlIssues(html);if(issues.length)throw Error(`${name}: ${issues.join('; ')}`);
  entries.push({name,html});
 }
 if(!entries.length)throw Error('没有有效的 preview/<id>/index.html');
 if(options['--browser']){
  const req=createRequire(join(root,'package.json'));
  const modulePath=options['--playwright']||req.resolve('@playwright/test');
  const playwright=await import(pathToFileURL(resolve(modulePath)).href);
  const {chromium}=playwright.chromium ? playwright : playwright.default;
  browser=await chromium.launch({headless:true});
  let current;
  server=createServer((request,response)=>{
    response.setHeader('Content-Type','text/html; charset=utf-8');response.setHeader('Cache-Control','no-store');
    if(request.url==='/'){response.end('<!doctype html><iframe sandbox="allow-scripts" src="/preview"></iframe>');return;}
    if(request.url==='/preview'){response.setHeader('Content-Security-Policy',sandboxCsp);response.end(current.html);return;}
    response.writeHead(404);response.end();
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const origin=`http://127.0.0.1:${server.address().port}`;
  for(const item of entries){
    current=item;const errors=[];const page=await browser.newPage();
    page.on('pageerror',e=>errors.push(e.message));
    page.on('console',msg=>{if(msg.type()==='error')errors.push(msg.text());});
    await page.route('**/*',route=>{const url=route.request().url();if(url===origin+'/'||url===origin+'/preview')return route.continue();errors.push(`外部请求：${url}`);return route.abort();});
    await page.goto(origin);await page.frames()[1].evaluate(()=>document.fonts.ready);await page.waitForTimeout(100);
    await page.close();if(errors.length)throw Error(`${item.name}: ${errors.join('; ')}`);
  }
 }
 console.log(`Validated ${entries.length} self-contained entry(s)${options['--browser']?' in Chromium sandbox':' (static checks only; runtime/interaction checks still required)'}.`);
}catch(e){console.error(`Prototype validation: ${e.message}`);process.exitCode=1;}
finally{if(browser)await browser.close();if(server)await new Promise(r=>server.close(r));}
