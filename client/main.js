import { BALANCE as B, DEFAULT_SETTINGS, COLORS, COUNTRIES } from '../config/balance.js';
import { distance } from '../shared/formulas.js';
import { MapRenderer } from './render/renderer.js';
import { AudioEngine } from './audio/audioEngine.js';
import { Network } from './ui/network.js';
import { HUD } from './ui/hud.js';
import { $, text, toast, formatTime, readStorage, writeStorage, openDialog, closeDialog } from './ui/dom.js';

const state = { screen:'menu',preview:true,map:null,regions:[],players:[],you:{id:0,economy:200,attackPercent:50,autoExpand:false},waves:[],projectiles:[],selected:new Set(),buildMode:null,time:0,phase:'lobby',settings:{...DEFAULT_SETTINGS},hostId:null,code:null,mode:'solo',peaceLeft:0,paused:false,result:null,leaderboardFull:false };
const maps = new Map(); const audio = new AudioEngine(); const network = new Network();
let chosenColor=COLORS[0], botCount=8, chosenSpeed=1, joining=false, firstSnapshot=true, lastEventId=0, resultShown='', tutorialIndex=0, manuallyPaused=false, percentTimer=null, demoInterval=null;
const renderer = new MapRenderer($('worldCanvas'),$('minimap'),()=>state,{
  onRegionClick: id=>regionClick(id), onDoubleClick: id=>{ if(state.preview)return; if(state.buildMode) regionClick(id); else if(state.regions[id]?.ownerId===state.you.id) selectFrontier(); else regionClick(id); },
  onLongPress: ()=>{ if(!state.preview) selectFrontier(); }, onSelect:(ids,add)=>{ if(state.preview)return; if(!add)state.selected.clear(); for(const id of ids)if(state.regions[id]?.ownerId===state.you.id)state.selected.add(id); state.buildMode=null; hud.update(); },
  onPaint:id=>{ if(!state.preview&&state.regions[id]?.ownerId===state.you.id){state.selected.add(id);hud.update();} }, onClear:()=>{state.selected.clear();state.buildMode=null;hud.update();},
  onCamera:()=>{ if(!state.preview)network.view(renderer.viewport()); }, onPerformance:(fps,ms,quality)=>{text($('fpsCounter'),`${Math.round(fps)} FPS · ${ms.toFixed(1)} MS · ${quality<1?'ECO':'FULL'}`);}
});
const hud = new HUD(state,{buildMode:type=>{if(state.phase!=='running'){toast('Дождись начала матча');return;}state.buildMode=state.buildMode===type?null:type;audio.play('click');hud.update();if(innerWidth<761)toast(`${B.buildings[type].name}: нажми на свой регион на карте`);}});

async function loadMap(size='standard') { if(maps.has(size))return maps.get(size); const response=await fetch(`/shared/map/${size==='large'?'map-large.json':'map.json'}`); if(!response.ok)throw new Error('Не удалось загрузить карту'); const map=await response.json();maps.set(size,map);return map; }
function demoWorld(map,seed=42) {
  const regions=map.regions.map(r=>({...r,ownerId:null,troops:Math.round(r.area*0.12),buildings:[]}));
  const targets=[[ -108,46],[-57,-16],[17,49],[22,3],[92,48],[134,-26],[113,29],[48,25]], used=new Set(), players=[];
  const sizes=[19,13,10,16,21,11,9,7];
  targets.forEach(([lon,lat],id)=>{
    const x=(lon+180)/360*map.width,y=(90-lat)/180*map.height;
    const capital=map.regions.filter(r=>!used.has(r.id)).sort((a,b)=>(a.x-x)**2+(a.y-y)**2-((b.x-x)**2+(b.y-y)**2))[0];
    if(!capital)return;
    const player={id,name:COUNTRIES[id],color:COLORS[id],capitalId:capital.id,regionsCount:0,troops:0,cap:650,income:1,growth:1,isBot:true,connected:true};players.push(player);
    const queue=[capital.id],seen=new Set(queue);let count=0;
    for(let i=0;i<queue.length&&count<sizes[id];i++){const r=regions[queue[i]];if(used.has(r.id))continue;r.ownerId=id;r.troops=20+((r.id*7)%60);used.add(r.id);player.regionsCount++;player.troops+=r.troops;count++;for(const n of r.landNeighbors)if(!seen.has(n)&&!used.has(n)){seen.add(n);queue.push(n);}}
    regions[capital.id].buildings=[['house',2,200],['fort',1,150]];
  });
  const waves=[];for(const id of [0,2,4,5]){const p=players[id];if(!p)continue;const from=regions.find(r=>r.ownerId===id&&r.landNeighbors.some(n=>regions[n].ownerId===null));if(!from)continue;const to=from.landNeighbors.find(n=>regions[n].ownerId===null);if(to!==undefined)waves.push([id+100,id,from.x,from.y,to,30,0,3,false]);}
  return {regions,players,waves};
}
async function showDemo(size='standard') { const map=await loadMap(size);state.map=map;const demo=demoWorld(map,$('seedInput').value);state.regions=demo.regions;state.players=demo.players;state.waves=demo.waves;state.projectiles=[];state.you={id:-1,economy:200,attackPercent:50};state.selected.clear();state.buildMode=null;state.preview=true;renderer.setMap(map,true);text($('regionStat'),map.regions.length);text($('mapSeedLabel'),String($('seedInput').value).padStart(4,'0')); }
function readSettings() { return {bots:botCount,difficulty:$('difficulty').value==='mixed'?'mixed':Number($('difficulty').value),speed:chosenSpeed,startMultiplier:Number($('startMultiplier').value),peaceSeconds:Number($('peaceSeconds').value),mapSize:$('mapSize').value,seed:$('seedInput').value.trim()||'42',minutes:Number($('matchMinutes').value),victoryPercent:Number($('victoryPercent').value)}; }
function switchScreen(screen) {
  state.screen=screen;$('menuScreen').hidden=screen!=='menu';$('gameScreen').hidden=screen!=='game';
  const stage=$(screen==='menu'?'menuMapStage':'gameMapStage');stage.prepend(renderer.canvas);renderer.observer.disconnect();renderer.observer.observe(stage);requestAnimationFrame(()=>renderer.resize());
  document.querySelectorAll('[data-nav]').forEach(b=>b.classList.toggle('active',b.dataset.nav===(screen==='menu'?(state.mode==='multi'?'multi':'solo'):'solo')));
  if(screen==='menu'){$('resumeSession').hidden=!network.session;clearInterval(viewTimer);clearInterval(demoInterval);demoInterval=setInterval(()=>{if(state.preview){for(const w of state.waves){w[6]=0;w[7]=3;}}},1000);} else {$('resumeSession').hidden=true;clearInterval(demoInterval);viewTimer=setInterval(()=>{if(state.screen==='game'&&!document.hidden)network.view(renderer.viewport());},350);}
}
let viewTimer=null;
async function startSolo(event) {
  event?.preventDefault();if(joining)return;joining=true;audio.init();const button=$('startSolo');button.disabled=true;button.querySelector('span').textContent='Создаём мир…';
  try { const settings=readSettings();writeStorage('land.country',{name:$('countryName').value,color:chosenColor});await network.createAndJoin({mode:'solo',settings,name:$('countryName').value,color:chosenColor}); }
  catch(error){toast(error.message,true);}finally{joining=false;button.disabled=false;button.querySelector('span').textContent='Начать завоевание';}
}
async function startMulti(code) {
  if(joining)return;joining=true;audio.init();$('createRoom').disabled=true;$('joinRoom').disabled=true;
  try { const settings={...readSettings(),bots:0};await network.createAndJoin({mode:'multi',settings,name:$('multiName').value,color:chosenColor,code}); }
  catch(error){toast(error.message,true);}finally{joining=false;$('createRoom').disabled=false;$('joinRoom').disabled=false;}
}
network.on('welcome',async message=>{
  try {
    const map=await loadMap(message.mapSize);state.map=map;state.regions=map.regions.map(r=>({...r,ownerId:null,buildings:[]}));state.players=[];state.waves=[];state.projectiles=[];state.you={id:message.playerId,economy:200,attackPercent:50,autoExpand:false};state.selected.clear();state.buildMode=null;state.preview=false;state.mode=message.mode;state.code=message.code;state.settings=message.settings;state.phase='lobby';state.result=null;state.hostId=null;firstSnapshot=true;lastEventId=0;resultShown='';manuallyPaused=false;
    $('eventLog').replaceChildren();$('chatMessages').replaceChildren();$('tutorial').hidden=true;$('chatButton').hidden=message.mode!=='multi';$('pauseButton').hidden=message.mode!=='solo';hud.leaderSignature='';hud.lobbySignature='';
    renderer.setMap(map,false);switchScreen('game');closeDialog('resultDialog');closeDialog('pauseDialog');
    if(message.mode==='multi'){openDialog('lobbyDialog');hud.lobby();}else closeDialog('lobbyDialog');
    renderer.start();
  }catch(error){toast(error.message,true);}
});
network.on('message',message=>{
  if(message.t==='SNAP')applySnapshot(message);
  else if(message.t==='LOBBY'){state.players=message.players;state.hostId=message.hostId;state.settings=message.settings;state.phase=message.phase;state.code=message.code;hud.lobby();if(message.phase!=='lobby')closeDialog('lobbyDialog');}
  else if(message.t==='ERR'){toast(message.message||'Команда отклонена',true);audio.play('error',{important:true});if(message.code==='NOT_FOUND'){network.saveSession(null);$('resumeSession').hidden=true;}}
  else if(message.t==='SERVER_SHUTDOWN'){toast(message.message,true);$('reconnectBanner').hidden=false;text($('reconnectText'),message.message);}
  else if(message.t==='LEFT'){showMenu();}
  else if(message.t==='KICKED'){toast(message.message,true);showMenu();}
});
network.on('status',status=>{text($('serverStatus'),status.connected?'СЕРВЕР В СЕТИ':'НЕТ СОЕДИНЕНИЯ');if(status.connected&&network.session)$('reconnectBanner').hidden=true;});
network.on('reconnect',detail=>{$('reconnectBanner').hidden=!detail.active;if(detail.text)text($('reconnectText'),detail.text);});
function applySnapshot(message) {
  const previousPhase=state.phase;
  for(const row of message.delta){const r=state.regions[row[0]];if(!r)continue;r.ownerId=row[1];if(row.length>2){r.troops=row[2];r.buildings=row[3];}else if(r.ownerId!==state.you.id){r.troops=null;r.buildings=[];}}
  state.players=message.players;state.you=message.you;state.hostId=message.hostId;state.time=message.time;state.phase=message.phase;state.settings=message.settings;state.peaceLeft=message.peaceLeft;state.paused=message.paused;state.waves=message.waves;state.projectiles=message.projectiles;state.result=message.result;
  for(const id of state.selected)if(state.regions[id]?.ownerId!==state.you.id)state.selected.delete(id);
  $('countdownOverlay').hidden=message.phase!=='countdown';if(message.phase==='countdown')text($('countdownNumber'),Math.max(1,message.countdown));$('pausedOverlay').hidden=!message.paused||message.phase!=='running';
  if(message.phase==='lobby'&&state.mode==='multi'){hud.lobby();if(!$('lobbyDialog').open)openDialog('lobbyDialog');}
  if(message.phase!=='lobby')closeDialog('lobbyDialog');
  if(previousPhase!==message.phase&&message.phase==='running'){renderer.flash(state.players[state.you.id]?.capitalId);if(!readStorage('land.tutorialSeen',false)){tutorialIndex=0;showTutorial();}}
  for(const event of message.events){if(event.id<=lastEventId)continue;lastEventId=event.id;handleEvent(event);}
  hud.update();
  if(firstSnapshot){firstSnapshot=false;network.view(renderer.viewport());hud.log('Добро пожаловать в LAND. Твоя страна отмечена флагом.',0,'positive');}
  if(message.phase==='finished'){const key=`${state.code}:${message.result?.time}`;if(resultShown!==key){resultShown=key;hud.result();openDialog('resultDialog');}}
  const ping=network.latency;text($('pingLabel'),`${state.mode==='solo'?'LOCAL':'ONLINE'} · ${ping} MS${ping>B.network.highPingMs?' ⚠':''}`);$('pingLabel').style.color=ping>B.network.highPingMs?'var(--danger)':'';
}
function handleEvent(event) {
  const p=event.p||{},mine=p.owner===state.you.id,player=state.players[p.owner],r=state.regions[event.regionId],camera=renderer.viewport();const spatial={x:r?.x||state.map.width/2,y:r?.y||state.map.height/2,camera,size:p.count||1,important:mine};
  const names={house:'Дом',port:'Порт',fort:'Защита',drone:'FPV-дрон',missile:'Ракета',aa:'ПВО'};
  switch(event.type){
    case 'capture': if(r)renderer.flash(r.id,player?.color);if(mine){audio.play('capture',spatial);hud.log(`Регион #${event.regionId+1} захвачен · гарнизон ${p.troops}`,event.time,'positive');}else if(p.previous===state.you.id)audio.play('lost',spatial);else audio.play('nearby',spatial);break;
    case 'lost':if(mine){audio.play('lost',spatial);hud.log(`Регион #${event.regionId+1} потерян`,event.time,'negative');}break;
    case 'attack':audio.play(mine?'attack':'nearby',spatial);if(mine)hud.log(`Атака на регион #${p.to+1} · ${p.force} войск`,event.time);break;
    case 'build':if(mine){audio.play('build',spatial);hud.log(`${names[p.type]} построен · регион #${p.to+1} · −${p.cost} золота`,event.time,'positive');}break;
    case 'upgrade':if(mine){audio.play('upgrade',spatial);hud.log(`${names[p.type]} → уровень ${p.level} · регион #${p.to+1}`,event.time,'positive');}break;
    case 'buildingCapture':{const outcome={intact:'перешла целой',damaged:'повреждена при захвате',destroyed:'разрушена при захвате'}[p.outcome];hud.log(`${names[p.type]} #${p.to+1}: ${outcome}`,event.time,p.outcome==='destroyed'?'negative':'positive');break;}
    case 'drone':case 'missile':audio.play(event.type,spatial);if(mine)hud.log(`${event.type==='drone'?'Дрон':'Ракета'} → регион #${p.to+1}`,event.time);break;
    case 'explosion':audio.play('explosion',spatial);if(r)renderer.flash(r.id,'#efb079');break;
    case 'intercept':audio.play('intercept',spatial);hud.log(`ПВО: ${p.type==='missile'?'ракета перехвачена':'дрон сбит'} у региона #${p.to+1}`,event.time,'positive');break;
    case 'destroyed':hud.log(`${names[p.type]} в регионе #${p.to+1} уничтожен`,event.time,p.owner===state.you.id?'':'negative');break;
    case 'damaged':if(state.regions[p.to]?.ownerId===state.you.id)hud.log(`${names[p.type]} #${p.to+1}: −${p.damage} HP`,event.time,'negative');break;
    case 'repelled':if(mine)hud.log(`Атака на регион #${p.to+1} отражена`,event.time,'negative');break;
    case 'chat':hud.chat(p.name,state.players[p.owner]?.color||COLORS[0],p.text);break;
    case 'info':hud.log(p.text,event.time);break;
    case 'defeat':if(mine){audio.play('defeat',{important:true});hud.result(true);openDialog('resultDialog');}break;
    case 'result':audio.play(p.winnerId===state.you.id?'victory':'defeat',{important:true});hud.log(`${state.players[p.winnerId]?.name||'Матч'} — итог кампании`,event.time,'positive');break;
  }
}
function regionClick(id) {
  if(state.preview||state.phase!=='running')return;const r=state.regions[id];if(!r)return;
  if(state.buildMode){if(r.ownerId!==state.you.id){toast('Строить можно только на своей территории',true);return;}network.command('BUILD',{regionId:id,type:state.buildMode});state.selected.clear();state.selected.add(id);state.buildMode=null;hud.update();return;}
  if(r.ownerId===state.you.id){if(!state.selected.has(id)){state.selected.clear();state.selected.add(id);}else state.selected.delete(id);audio.play('click');hud.update();return;}
  if(!state.selected.size){const adjacent=state.players[state.you.id].regionsCount?state.regions.filter(x=>x.ownerId===state.you.id&&x.neighbors.includes(id)&&!state.waves.some(w=>w[9]?.includes(x.id))):[];const source=adjacent.sort((a,b)=>(b.troops||0)-(a.troops||0))[0];if(source)state.selected.add(source.id);}
  if(!state.selected.size){toast('Сначала выбери свой регион рядом с целью');return;}
  if(state.you.attackPercent===0){toast('Выберите силу атаки больше 0%',true);audio.play('error');return;}
  network.command('ATTACK',{fromRegions:[...state.selected],toRegionId:id,percent:state.you.attackPercent});hud.update();
}
function selectFrontier(){if(state.preview)return;state.selected.clear();for(const r of state.regions)if(r.ownerId===state.you.id&&r.neighbors.some(n=>state.regions[n].ownerId!==state.you.id))state.selected.add(r.id);state.buildMode=null;hud.update();toast(state.selected.size?`Выбрано пограничных регионов: ${state.selected.size}`:'Пока нет пограничных регионов');}
function setPercent(value){const percent=Math.max(0,Math.min(100,Math.round(Number(value)||0)));state.you.attackPercent=percent;$('attackRange').value=percent;$('attackNumber').value=percent;hud.update();clearTimeout(percentTimer);percentTimer=setTimeout(()=>network.command('SET_ATTACK_PERCENT',{percent}),100);}
function togglePause(value=!state.paused){if(state.mode!=='solo'||state.phase!=='running')return;manuallyPaused=value;network.command('PAUSE',{value});state.paused=value;$('pausedOverlay').hidden=!value;}
function showMenu(){network.leave();for(const dialog of document.querySelectorAll('dialog[open]'))dialog.close();$('chatDrawer').hidden=true;state.phase='lobby';state.mode='solo';switchScreen('menu');showDemo($('mapSize').value).catch(error=>toast(error.message,true));}
async function refreshRooms(){try{const rooms=await network.request('/api/rooms');$('roomList').replaceChildren();if(!rooms.length){const p=document.createElement('p');p.className='empty-state';p.textContent='Пока тихо. Создай первую комнату.';$('roomList').append(p);return;}for(const room of rooms){const button=document.createElement('button');button.className='room-list-item';const info=document.createElement('div'),title=document.createElement('strong'),meta=document.createElement('span'),code=document.createElement('code');title.textContent=room.host;meta.textContent=`${room.players} игроков · ${room.bots} ИИ · ${room.mapSize==='large'?'большая':'стандарт'}`;code.textContent=room.code;info.append(title,meta);button.append(info,code);button.addEventListener('click',()=>startMulti(room.code));$('roomList').append(button);}}catch(error){toast(error.message,true);}}
function setMenuMode(mode){state.mode=mode;$('soloSetup').hidden=mode!=='solo';$('multiSetup').hidden=mode!=='multi';document.querySelectorAll('[data-nav]').forEach(b=>b.classList.toggle('active',b.dataset.nav===mode));if(mode==='multi')refreshRooms();}
const TUTORIALS=[['Твоя страна — там, где флаг','Найди цветной флаг своего государства. Кликни по территории под ним. Миникарта поможет приблизить нужный участок.'],['Сколько войск отправить?','Выбери силу атаки. Для начала хватит 25–50%. Клавиши 1–5 задают 20/40/60/80/100%. Не оставляй границу пустой.'],['Первый соседний регион','Кликни по нейтральному региону рядом со своей землёй. Дождись волну: захват произойдёт после её прибытия.'],['Построй основу экономики','Выбери один свой регион, нажми «Дом», затем снова регион на карте. Лимит войск вырастет на 350. Повторное наложение улучшает дом до 5 уровня.'],['Думай на ход дальше','Двойной клик выделяет все границы. Порты открывают десант, форты защищают. Захвати заданную долю мира или лидируй к концу времени.']];
function showTutorial(){const step=TUTORIALS[tutorialIndex];if(!step){$('tutorial').hidden=true;writeStorage('land.tutorialSeen',true);return;}$('tutorial').hidden=false;text($('tutorialStep'),`ПОДСКАЗКА ${tutorialIndex+1} / 5`);text($('tutorialTitle'),step[0]);text($('tutorialText'),step[1]);text($('nextTutorial'),tutorialIndex===4?'Вперёд!':'Дальше');}
function syncAudio(){const a=audio.settings;for(const [id,key] of [['masterVolume','master'],['sfxVolume','sfx'],['musicVolume','music']]){$(id).value=Math.round(a[key]*100);text($(id.replace('Volume','Value')),`${Math.round(a[key]*100)}%`);}$('muteToggle').checked=a.muted;$('soundButton').querySelector('use').setAttribute('href',a.muted?'#i-mute':'#i-sound');$('soundButton').setAttribute('aria-label',a.muted?'Включить звук':'Выключить звук');}

// Menu and match setup.
$('soloForm').addEventListener('submit',startSolo);
$('botsMinus').addEventListener('click',()=>{botCount=Math.max(1,botCount-1);text($('botCount'),botCount);});$('botsPlus').addEventListener('click',()=>{botCount=Math.min(15,botCount+1);text($('botCount'),botCount);});
$('speedControl').addEventListener('click',e=>{const b=e.target.closest('[data-speed]');if(!b)return;chosenSpeed=Number(b.dataset.speed);document.querySelectorAll('[data-speed]').forEach(x=>x.classList.toggle('active',x===b));text($('speedHint'),{0.5:'Время подумать',1:'В своём темпе',2:'Быстрые решения',4:'Без права на скуку'}[chosenSpeed]);});
$('countryColor').addEventListener('click',()=>{chosenColor=COLORS[(COLORS.indexOf(chosenColor)+1)%COLORS.length];$('countryColor').style.setProperty('--nation-color',chosenColor);});
$('countryName').addEventListener('input',()=>{$('multiName').value=$('countryName').value;});$('multiName').addEventListener('input',()=>{$('countryName').value=$('multiName').value;});
$('seedInput').addEventListener('change',()=>text($('mapSeedLabel'),$('seedInput').value.padStart(4,'0')));$('mapSize').addEventListener('change',()=>showDemo($('mapSize').value).catch(e=>toast(e.message,true)));
$('zoomIn').addEventListener('click',()=>renderer.zoomAt(1.35));$('zoomOut').addEventListener('click',()=>renderer.zoomAt(1/1.35));$('zoomFit').addEventListener('click',()=>renderer.fit());
document.querySelectorAll('[data-nav]').forEach(button=>button.addEventListener('click',()=>{if(state.screen==='game'){openPause();return;}const nav=button.dataset.nav;if(nav==='help')openDialog('helpDialog');else setMenuMode(nav);}));
document.querySelectorAll('[data-help]').forEach(b=>b.addEventListener('click',()=>openDialog('helpDialog')));
$('createRoom').addEventListener('click',()=>startMulti());$('joinRoom').addEventListener('click',()=>{const code=$('joinCode').value.trim().toUpperCase();if(!/^[A-Z0-9]{6}$/.test(code)){toast('Введите 6-символьный код комнаты',true);return;}startMulti(code);});$('joinCode').addEventListener('keydown',e=>{if(e.key==='Enter')$('joinRoom').click();});$('refreshRooms').addEventListener('click',refreshRooms);
$('resumeSession').addEventListener('click',async()=>{audio.init();try{await network.resume();}catch(error){toast(error.message,true);}});
$('brandButton').addEventListener('click',()=>{if(state.screen==='game')openPause();else{setMenuMode('solo');window.scrollTo({top:0,behavior:'smooth'});}});
// In-match controls.
$('attackRange').addEventListener('input',e=>setPercent(e.target.value));$('attackNumber').addEventListener('change',e=>setPercent(e.target.value));document.querySelectorAll('[data-percent]').forEach(b=>b.addEventListener('click',()=>setPercent(b.dataset.percent)));
$('autoExpand').addEventListener('change',e=>{state.you.autoExpand=e.target.checked;network.command('SET_AUTO',{value:e.target.checked});});
$('selectFrontier').addEventListener('click',selectFrontier);$('clearSelection').addEventListener('click',()=>{state.selected.clear();state.buildMode=null;hud.update();});
$('leaderboardToggle').addEventListener('click',()=>{state.leaderboardFull=!state.leaderboardFull;hud.leaderboard();});
$('pauseButton').addEventListener('click',()=>togglePause());$('gameMenuButton').addEventListener('click',openPause);
function openPause(){if(state.phase==='running'&&state.mode==='solo')togglePause(true);openDialog('pauseDialog');}
$('continueGame').addEventListener('click',()=>closeDialog('pauseDialog'));$('pauseDialog').addEventListener('close',()=>{if(state.mode==='solo'&&state.phase==='running'&&manuallyPaused)togglePause(false);});
$('pauseSettings').addEventListener('click',()=>{closeDialog('pauseDialog');openDialog('settingsDialog');});$('leaveGame').addEventListener('click',showMenu);$('resultMenu').addEventListener('click',showMenu);$('observeButton').addEventListener('click',()=>closeDialog('resultDialog'));$('rematchButton').addEventListener('click',()=>{closeDialog('resultDialog');network.lobby('REMATCH');});
$('nextTutorial').addEventListener('click',()=>{tutorialIndex++;showTutorial();});$('skipTutorial').addEventListener('click',()=>{tutorialIndex=5;showTutorial();});
// Room lobby.
$('closeLobby').addEventListener('click',showMenu);$('lobbyDialog').addEventListener('cancel',e=>{e.preventDefault();showMenu();});
$('copyRoomCode').addEventListener('click',async()=>{try{await navigator.clipboard.writeText(state.code);toast('Код комнаты скопирован');}catch{toast(`Код комнаты: ${state.code}`);}});
$('addLobbyBot').addEventListener('click',()=>network.lobby('LOBBY_BOT',{difficulty:$('lobbyBotDifficulty').value}));
$('lobbySlots').addEventListener('click',e=>{const replace=e.target.closest('[data-replace]'),kick=e.target.closest('[data-kick]');if(replace)network.lobby('LOBBY_BOT',{slot:Number(replace.dataset.replace),difficulty:$('lobbyBotDifficulty').value});if(kick)network.lobby('LOBBY_KICK',{slot:Number(kick.dataset.kick)});});
$('startMulti').addEventListener('click',()=>network.lobby('START'));$('lobbySpeed').addEventListener('change',e=>network.lobby('LOBBY_SETTINGS',{speed:Number(e.target.value)}));$('lobbyPeace').addEventListener('change',e=>network.lobby('LOBBY_SETTINGS',{peaceSeconds:Number(e.target.value)}));
$('chatButton').addEventListener('click',()=>{$('chatDrawer').hidden=!$('chatDrawer').hidden;if(!$('chatDrawer').hidden)$('chatInput').focus();});$('closeChat').addEventListener('click',()=>{$('chatDrawer').hidden=true;});$('chatForm').addEventListener('submit',e=>{e.preventDefault();const value=$('chatInput').value.trim();if(!value)return;network.command('CHAT',{text:value.slice(0,200)});$('chatInput').value='';});
// Persistent mixer and accessibility preferences.
$('settingsButton').addEventListener('click',()=>openDialog('settingsDialog'));$('soundButton').addEventListener('click',()=>{audio.init();audio.settings.muted=!audio.settings.muted;audio.save();syncAudio();});
for(const [id,key] of [['masterVolume','master'],['sfxVolume','sfx'],['musicVolume','music']])$(id).addEventListener('input',e=>{audio.init();audio.settings[key]=Number(e.target.value)/100;audio.save();syncAudio();});
$('muteToggle').addEventListener('change',e=>{audio.settings.muted=e.target.checked;audio.save();syncAudio();});$('colorblindToggle').checked=readStorage('land.colorblind',false);renderer.colorblind=$('colorblindToggle').checked;$('colorblindToggle').addEventListener('change',e=>{renderer.colorblind=e.target.checked;writeStorage('land.colorblind',e.target.checked);});
document.querySelectorAll('[data-close]').forEach(button=>button.addEventListener('click',()=>button.closest('dialog').close()));
document.addEventListener('pointerdown',e=>{audio.init();if(e.target.closest('button')&&!e.target.closest('.building-button'))audio.play('click');},{capture:true});
$('retryConnection').addEventListener('click',()=>{network.attempts=0;network.retry();});
// Keyboard shortcuts are ignored while typing or while a modal has focus.
document.addEventListener('keydown',e=>{
  const typing=/INPUT|SELECT|TEXTAREA/.test(e.target.tagName)||e.target.isContentEditable,modal=document.querySelector('dialog[open]');
  if(e.key==='Escape'&&!modal&&state.screen==='game'){e.preventDefault();openPause();return;}
  if(typing||modal||state.screen!=='game')return;
  const key=e.key.toLowerCase();
  if(['w','a','s','d','arrowup','arrowdown','arrowleft','arrowright','q','e'].includes(key)){e.preventDefault();renderer.keys.add(key);}
  if(e.code==='Space'){e.preventDefault();togglePause();}
  if(/^[1-5]$/.test(key))setPercent(Number(key)*20);
  if(key==='b'){e.preventDefault();$('buildPanel').scrollIntoView({block:'nearest',behavior:'smooth'});$('buildingButtons').querySelector('button').focus();}
  if(key==='tab'){e.preventDefault();state.leaderboardFull=!state.leaderboardFull;hud.leaderboard();}
  if(key==='f3'){e.preventDefault();$('fpsCounter').hidden=!$('fpsCounter').hidden;}
});
document.addEventListener('keyup',e=>renderer.keys.delete(e.key.toLowerCase()));window.addEventListener('blur',()=>renderer.keys.clear());
document.addEventListener('visibilitychange',()=>{if(document.hidden){renderer.stop();if(state.mode==='solo'&&state.phase==='running')network.command('AUTO_PAUSE',{value:true});}else{renderer.start();if(state.mode==='solo'&&state.phase==='running')network.command('AUTO_PAUSE',{value:false});}});

async function boot(){const saved=readStorage('land.country');if(saved){$('countryName').value=saved.name||COUNTRIES[0];$('multiName').value=$('countryName').value;chosenColor=COLORS.includes(saved.color)?saved.color:COLORS[0];}$('countryColor').style.setProperty('--nation-color',chosenColor);syncAudio();try{await showDemo();renderer.start();await network.request('/api/health').then(()=>text($('serverStatus'),'СЕРВЕР В СЕТИ'));$('resumeSession').hidden=!network.session;}catch(error){text($('serverStatus'),'СЕРВЕР НЕДОСТУПЕН');toast(error.message,true);}}
boot();
// Optional local diagnostics (?debug=1). Exposes visual/client state only;
// every gameplay mutation still goes through the authoritative command queue.
if (new URLSearchParams(location.search).has('debug')) window.__LAND__ = { state, renderer, network, audio };
