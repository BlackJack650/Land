import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSettings, validateCommand, validateViewport } from '../shared/protocol.js';
test('settings are bounded and deterministic defaults are applied',()=>{
  const s=normalizeSettings({bots:999,speed:99,seed:'x'.repeat(80),minutes:-4,victoryPercent:200}); assert.equal(s.bots,15); assert.equal(s.speed,1); assert.equal(s.seed.length,32); assert.equal(s.minutes,1); assert.equal(s.victoryPercent,100);
});
test('command schemas reject malformed intentions',()=>{
  assert.equal(validateCommand({t:'CMD',cmdId:'a1',type:'ATTACK',payload:{fromRegions:[1],toRegionId:2,percent:50}}),null);
  assert.ok(validateCommand({t:'CMD',cmdId:'a2',type:'ATTACK',payload:{fromRegions:[1,1],toRegionId:2,percent:50}}));
  assert.ok(validateCommand({t:'CMD',cmdId:'a3',type:'ATTACK',payload:{fromRegions:[1],toRegionId:2,percent:101}}));
  assert.ok(validateCommand({t:'CMD',cmdId:'a4',type:'BUILD',payload:{regionId:1,type:'tank'}}));
  assert.ok(validateCommand({t:'CMD',cmdId:'a5',type:'CHAT',payload:{text:'x'.repeat(201)}}));
  assert.equal(validateCommand({t:'CMD',cmdId:'a6',type:'SET_ATTACK_PERCENT',payload:{percent:0}}),null);
});
test('viewport is clamped to map bounds',()=>{
  assert.deepEqual(validateViewport({x:-10,y:5,w:500,h:20},{width:192,height:96}),{x:0,y:5,w:192,h:20}); assert.equal(validateViewport({x:'bad'}, {width:192,height:96}),null);
});
