import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import net from 'node:net';
import WebSocket from 'ws';

async function freePort(){const server=net.createServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const port=server.address().port;await new Promise(resolve=>server.close(resolve));return port;}
function client(url){const ws=new WebSocket(url),messages=[],waiters=[];const ready=new Promise((resolve,reject)=>{ws.once('open',resolve);ws.once('error',reject);});ws.on('message',data=>{const m=JSON.parse(data);const i=waiters.findIndex(w=>w.predicate(m));if(i>=0){const w=waiters.splice(i,1)[0];clearTimeout(w.timer);w.resolve(m);}else messages.push(m);});return {ws,ready,messages,send:m=>ws.send(JSON.stringify(m)),wait(predicate,timeout=8000){const i=messages.findIndex(predicate);if(i>=0)return Promise.resolve(messages.splice(i,1)[0]);return new Promise((resolve,reject)=>{const w={predicate,resolve,timer:setTimeout(()=>reject(new Error('Timed out waiting for WebSocket message')),timeout)};waiters.push(w);});}};}

test('two browsers share authoritative state, chat, and a 90-second reconnect slot',{timeout:25000},async()=>{
  const port=await freePort(),child=spawn(process.execPath,['server/index.js'],{cwd:process.cwd(),env:{...process.env,PORT:String(port)},stdio:['ignore','pipe','pipe']});
  let logs='';child.stdout.on('data',d=>logs+=d);child.stderr.on('data',d=>logs+=d);
  const exited=new Promise(resolve=>child.once('exit',resolve));
  try {
    for(let i=0;i<50;i++){try{const r=await fetch(`http://127.0.0.1:${port}/api/health`);if(r.ok)break;}catch{}await new Promise(r=>setTimeout(r,100));}
    const base=`http://127.0.0.1:${port}`,url=`ws://127.0.0.1:${port}/ws`;
    const created=await (await fetch(`${base}/api/rooms`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({mode:'multi',settings:{bots:1,peaceSeconds:0,speed:1}})})).json();assert.match(created.code,/^[A-Z0-9]{6}$/);
    const a=client(url),b=client(url);await Promise.all([a.ready,b.ready]);a.send({t:'JOIN',code:created.code,name:'Host'});const wa=await a.wait(m=>m.t==='WELCOME');b.send({t:'JOIN',code:created.code,name:'Guest'});const wb=await b.wait(m=>m.t==='WELCOME');assert.equal(wa.playerId,0);assert.equal(wb.playerId,1);assert.ok(wa.token);
    a.send({t:'START'});await Promise.all([a.wait(m=>m.t==='SNAP'&&m.phase==='running'),b.wait(m=>m.t==='SNAP'&&m.phase==='running')]);
    const sa=await a.wait(m=>m.t==='SNAP'&&m.tick>10),sb=await b.wait(m=>m.t==='SNAP'&&m.tick>10);assert.equal(sa.players.length,3);assert.equal(sb.players.length,3);assert.deepEqual(sa.players.map(p=>[p.id,p.regionsCount]),sb.players.map(p=>[p.id,p.regionsCount]));
    a.send({t:'CMD',cmdId:'chat-1',type:'CHAT',payload:{text:'Общий мир'}});const chat=await b.wait(m=>m.t==='SNAP'&&m.events.some(e=>e.type==='chat'));assert.ok(chat.events.find(e=>e.type==='chat').p.text==='Общий мир');
    b.send({t:'CMD',cmdId:'cheat',type:'BUILD',payload:{regionId:sa.players[0].capitalId,type:'house'}});const err=await b.wait(m=>m.t==='ERR'&&m.cmdId==='cheat');assert.equal(err.code,'NOT_OWNER');
    a.ws.close();await new Promise(r=>setTimeout(r,250));const resumed=client(url);await resumed.ready;resumed.send({t:'JOIN',code:created.code,token:wa.token});const welcome=await resumed.wait(m=>m.t==='WELCOME');assert.equal(welcome.playerId,0);const full=await resumed.wait(m=>m.t==='SNAP');assert.equal(full.full,true);assert.equal(full.delta.length,320);
    const rooms=await (await fetch(`${base}/api/rooms`)).json();assert.ok(Array.isArray(rooms));
    resumed.ws.close();b.ws.close();
  } finally { child.kill('SIGTERM');await exited; }
});
