// Optional browser smoke test. Run `npm start` first, then `node tools/browserSmoke.js`.
// Uses the npm-distributed Chromium binary; no browser CDN is required.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import zlib from 'node:zlib';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
import chromium from '@sparticuz/chromium';
import { chromium as pw } from '@playwright/test';

const base=process.env.BASE_URL||'http://localhost:3000';
const env={...process.env};
if(process.platform==='linux'){
  const libDir=path.join(os.tmpdir(),'land-chromium-libs');
  if(!fs.existsSync(path.join(libDir,'lib/libnspr4.so'))){fs.mkdirSync(libDir,{recursive:true});const tar=path.join(os.tmpdir(),'land-chromium-libs.tar');fs.writeFileSync(tar,zlib.brotliDecompressSync(fs.readFileSync(path.join(process.cwd(),'node_modules/@sparticuz/chromium/bin/al2023.tar.br'))));const result=spawnSync('tar',['-xf',tar,'-C',libDir]);if(result.status!==0)throw new Error('Could not extract Chromium libraries');}
  env.LD_LIBRARY_PATH=`${libDir}/lib:${os.tmpdir()}`;
}
const browser=await pw.launch({executablePath:await chromium.executablePath(),args:chromium.args,headless:true,env});
const errors=[];
function watch(page){page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});}
async function clickRegion(page,id){const pos=await page.evaluate(id=>{const {state,renderer}=window.__LAND__;const r=state.regions[id],box=renderer.canvas.getBoundingClientRect();return {x:box.x+renderer.ox+r.x*renderer.scale,y:box.y+renderer.oy+r.y*renderer.scale};},id);await page.mouse.click(pos.x,pos.y);}
try{
  const page=await browser.newPage({viewport:{width:1440,height:1000},deviceScaleFactor:1});watch(page);
  await page.goto(`${base}/?debug=1`);await page.waitForFunction(()=>window.__LAND__?.state.regions.length===320);await page.waitForTimeout(700);fs.mkdirSync('docs',{recursive:true});await page.screenshot({path:'docs/menu-desktop.png',fullPage:true});
  await page.selectOption('#difficulty','1');for(let i=0;i<7;i++)await page.locator('#botsMinus').click();await page.locator('[data-speed="4"]').click();await page.locator('summary').click();await page.selectOption('#peaceSeconds','0');await page.locator('summary').click();
  await page.locator('#startSolo').click();await page.waitForFunction(()=>window.__LAND__.state.phase==='running',null,{timeout:15000});await page.waitForTimeout(500);
  const capital=await page.evaluate(()=>{const {state,renderer}=window.__LAND__;const p=state.players[state.you.id];renderer.centerOn(state.regions[p.capitalId].x,state.regions[p.capitalId].y,3);return p.capitalId;});await page.waitForTimeout(250);
  await clickRegion(page,capital);await page.locator('[data-percent="25"]').click();await page.waitForTimeout(250);const target=await page.evaluate(cap=>window.__LAND__.state.regions[cap].landNeighbors.find(id=>window.__LAND__.state.regions[id].ownerId===null),capital);await clickRegion(page,target);await page.waitForTimeout(1000);
  await clickRegion(page,capital);await page.waitForTimeout(450);await page.locator('[data-building="house"]').click();await clickRegion(page,capital);await page.waitForTimeout(600);
  const game=await page.evaluate(()=>{const {state,renderer}=window.__LAND__;return {phase:state.phase,regions:state.players[state.you.id].regionsCount,cap:state.players[state.you.id].cap,buildings:state.regions[state.players[state.you.id].capitalId].buildings,fps:renderer.fps,ms:renderer.renderMs};});
  assert.equal(game.phase,'running');assert.ok(game.regions>=2);assert.equal(game.cap,650);assert.ok(game.buildings.some(b=>b[0]==='house'));
  await page.locator('#skipTutorial').click().catch(()=>{});await page.evaluate(()=>window.__LAND__.renderer.fit());await page.waitForTimeout(400);await page.screenshot({path:'docs/game-desktop.png',fullPage:true});console.log('Solo capture + house:',JSON.stringify(game));
  // Two independent browser contexts share one authoritative room.
  const a=await browser.newPage({viewport:{width:1280,height:900}}),b=await browser.newPage({viewport:{width:1280,height:900}});watch(a);watch(b);
  await a.goto(`${base}/?debug=1`);await b.goto(`${base}/?debug=1`);await a.locator('[data-nav="multi"]').click();await a.locator('#createRoom').click();await a.waitForFunction(()=>window.__LAND__.state.code&&document.getElementById('lobbyDialog').open);const code=await a.locator('#lobbyCode').textContent();
  await b.locator('[data-nav="multi"]').click();await b.locator('#joinCode').fill(code);await b.locator('#joinRoom').click();await b.waitForFunction(()=>window.__LAND__.state.players.length>=2);await a.locator('#startMulti').click();
  await Promise.all([a.waitForFunction(()=>window.__LAND__.state.phase==='running'),b.waitForFunction(()=>window.__LAND__.state.phase==='running')]);await a.waitForTimeout(500);
  const ownersA=await a.evaluate(()=>window.__LAND__.state.regions.map(r=>r.ownerId)),ownersB=await b.evaluate(()=>window.__LAND__.state.regions.map(r=>r.ownerId));assert.deepEqual(ownersA,ownersB);
  await a.locator('#chatButton').click();await a.locator('#chatInput').fill('Проверка общего мира');await a.locator('#chatForm button').click();await b.waitForFunction(()=>document.getElementById('chatMessages').textContent.includes('Проверка общего мира'));
  const playerId=await a.evaluate(()=>window.__LAND__.state.you.id);await a.evaluate(()=>window.__LAND__.network.ws.close());await a.waitForFunction(()=>window.__LAND__.state.you.id===undefined?false:true);await a.waitForTimeout(2500);const resumedId=await a.evaluate(()=>window.__LAND__.state.you.id);assert.equal(resumedId,playerId);console.log('Multiplayer: shared ownership, chat and reconnect ✓');
  // 360 px portrait: no horizontal overflow, map first, dock below.
  const mobile=await browser.newPage({viewport:{width:360,height:800},deviceScaleFactor:1,isMobile:true,hasTouch:true});watch(mobile);await mobile.goto(`${base}/?debug=1`);await mobile.waitForTimeout(800);await mobile.screenshot({path:'docs/menu-mobile.png',fullPage:true});assert.equal(await mobile.evaluate(()=>document.documentElement.scrollWidth),360);
  await mobile.selectOption('#difficulty','1');await mobile.locator('#botsMinus').click({clickCount:7});await mobile.locator('[data-speed="4"]').click();await mobile.locator('#startSolo').click();await mobile.waitForFunction(()=>window.__LAND__.state.phase==='running',null,{timeout:15000});await mobile.locator('#skipTutorial').click().catch(()=>{});await mobile.waitForTimeout(500);assert.equal(await mobile.evaluate(()=>document.documentElement.scrollWidth),360);await mobile.screenshot({path:'docs/game-mobile.png',fullPage:true});console.log('360 px portrait: no horizontal overflow ✓');
  assert.deepEqual(errors,[]);console.log('Browser console errors: 0 ✓');
}finally{await browser.close();}
