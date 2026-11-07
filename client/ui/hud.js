import { BALANCE as B } from '../../config/balance.js';
import { buildingCost } from '../../shared/formulas.js';
import { $, icon, text, html, formatTime, number } from './dom.js';
const BUILD_TYPES=['house','port','fort','drone','missile','aa'];
export class HUD {
  constructor(state,actions) {
    this.state=state; this.actions=actions; this.leaderSignature=''; this.lobbySignature=''; this.lastLogId=0;
    $('buildingButtons').innerHTML=BUILD_TYPES.map(type=>{const b=B.buildings[type];return `<button class="building-button" data-building="${type}" title="${b.name} · радиус ${b.radius} · до 5 уровней">${icon(type)}<span class="building-radius">${b.radius?`R${b.radius}`:'РЕГИОН'}</span><strong>${b.name}</strong><span class="building-cost">${b.cost} ◇</span><span class="mini-levels">${'<i></i>'.repeat(5)}</span></button>`;}).join('');
    $('buildingButtons').addEventListener('click',e=>{const button=e.target.closest('[data-building]');if(button) actions.buildMode(button.dataset.building);});
  }
  update() {
    const s=this.state,p=s.players[s.you?.id]; if(!p) return;
    text($('hudCountry'),p.name); $('hudColor').style.background=p.color; $('hudColor').style.outlineColor=p.color;
    html($('hudTroops'),`${number(p.troops)} <em>/ ${number(p.cap)}</em>`); text($('hudGold'),number(s.you.economy)); text($('hudIncome'),`+${(p.income||0).toFixed(2)}`); html($('hudRegions'),`${p.regionsCount} <em>/ ${s.regions.length}</em>`); text($('matchTimer'),formatTime(s.time));
    text($('battleStatus'),s.phase==='finished'?'КАМПАНИЯ ЗАВЕРШЕНА':s.phase==='countdown'?'ОБРАТНЫЙ ОТСЧЁТ':s.peaceLeft>0?`МИРНАЯ ЗАСТРОЙКА · ${Math.ceil(s.peaceLeft)} С`:s.paused?'ОПЕРАЦИЯ ПРИОСТАНОВЛЕНА':'ОПЕРАЦИЯ «ЗАВОЕВАНИЕ»');
    text($('victoryTarget'),`${s.settings.victoryPercent}% мира`);
    if(document.activeElement!==$('attackRange')&&document.activeElement!==$('attackNumber')) { $('attackRange').value=s.you.attackPercent; $('attackNumber').value=s.you.attackPercent; }
    if(document.activeElement!==$('autoExpand')) $('autoExpand').checked=!!s.you.autoExpand;
    document.querySelectorAll('[data-percent]').forEach(b=>b.classList.toggle('active',Number(b.dataset.percent)===s.you.attackPercent));
    const selected=[...s.selected].map(id=>s.regions[id]).filter(r=>r?.ownerId===p.id), troops=selected.reduce((n,r)=>n+(r.troops||0),0), focus=selected.length===1?selected[0]:null;
    text($('attackPreview'),s.you.attackPercent===0?'Выберите силу атаки больше 0%':selected.length?`Отправится ${number(Math.floor(troops*s.you.attackPercent/100))} войск из ${selected.length} рег.`:'Выбери регион, чтобы отправить войска');
    $('selectionTroops').textContent=selected.length?`${number(troops)} ВОЙСК`:'';
    document.querySelector('.selection-dot').style.background=selected.length?p.color:'var(--dim)';
    if(s.buildMode) { text($('selectionTitle'),`${B.buildings[s.buildMode].name} · выбери регион`); text($('selectionDetails'),'Клик по своему региону — построить · ПКМ — отмена'); }
    else if(focus) { text($('selectionTitle'),`Регион #${focus.id+1} · ${focus.isCoastal?'побережье':'суша'}`); text($('selectionDetails'),focus.buildings.length?focus.buildings.map(b=>`${B.buildings[b[0]].name} ${b[1]} ур. · ${Math.ceil(b[2])} HP`).join(' / '):'Постройки не размещены · выбери здание справа'); }
    else if(selected.length>1) { text($('selectionTitle'),`Выбрано регионов: ${selected.length}`); text($('selectionDetails'),'Клик по соседу — атака · Shift + drag — добавить выделение'); }
    else { text($('selectionTitle'),'Выбери свою территорию'); text($('selectionDetails'),'Клик — выбрать · двойной клик — все границы · drag — карта'); }
    text($('buildHint'),s.buildMode?`${B.buildings[s.buildMode].name}: нажми на свой регион`:focus?`Регион #${focus.id+1} · нажми здание, затем регион`:'Выбери свой регион для постройки');
    for(const button of document.querySelectorAll('[data-building]')) {
      const type=button.dataset.building,old=focus?.buildings.find(b=>b[0]===type),level=(old?.[1]||0)+1,max=level>5,cost=max?0:buildingCost(type,p.buildingCount,level);
      button.classList.toggle('active',s.buildMode===type); button.classList.toggle('unaffordable',cost>s.you.economy); button.querySelector('.building-cost').textContent=max?'МАКС. 5':`${number(cost)} ◇`; button.querySelectorAll('.mini-levels i').forEach((dot,i)=>dot.classList.toggle('filled',i<(old?.[1]||0))); button.title=`${B.buildings[type].name} · ${max?'максимальный уровень':old?`улучшить до ${level} уровня`:'построить'} · ${cost} золота`;
    }
    this.leaderboard();
  }
  leaderboard() {
    const s=this.state, sorted=[...s.players].sort((a,b)=>b.regionsCount-a.regionsCount||b.troops-a.troops), shown=s.leaderboardFull?sorted:sorted.slice(0,5), signature=JSON.stringify([shown.map(p=>[p.id,p.regionsCount,p.name,p.color]),s.you?.id,s.leaderboardFull]);
    if(signature===this.leaderSignature) return; this.leaderSignature=signature;
    $('leaderboard').innerHTML=shown.map((p,i)=>`<div class="leader-row${p.id===s.you?.id?' is-me':''}" style="${p.eliminated?'opacity:.45':''}"><span class="leader-rank">${i+1}</span><i class="leader-color" style="background:${p.color}"></i><span class="leader-name">${escapeName(p.name)}${p.id===s.you?.id?' · ты':''}</span><span class="leader-count">${p.regionsCount}</span></div><div class="leader-bar"><i style="width:${p.regionsCount/s.regions.length*100}%;background:${p.color}"></i></div>`).join('');
    text($('leaderboardHint'),s.leaderboardFull?'СВЕРНУТЬ ↑':'ТОП-5 ↓');
  }
  log(message,time=0,type='') { const line=document.createElement('div'); line.className=`event-line ${type}`; const stamp=document.createElement('time'); stamp.textContent=formatTime(time); const span=document.createElement('span'); span.textContent=message; line.append(stamp,span); $('eventLog').append(line); while($('eventLog').children.length>40) $('eventLog').firstChild.remove(); $('eventLog').scrollTop=$('eventLog').scrollHeight; }
  chat(name,color,message) { const node=document.createElement('div'); node.className='chat-message'; const title=document.createElement('strong'); title.textContent=name; title.style.color=color; const body=document.createElement('span'); body.textContent=message; node.append(title,body); $('chatMessages').append(node); while($('chatMessages').children.length>100) $('chatMessages').firstChild.remove(); $('chatMessages').scrollTop=$('chatMessages').scrollHeight; }
  lobby() {
    const s=this.state,host=s.you?.id===s.hostId,signature=JSON.stringify([s.players,s.hostId,s.you?.id,s.settings]); if(signature===this.lobbySignature) return; this.lobbySignature=signature;
    text($('lobbyCode'),s.code); text($('lobbySlotCount'),`${s.players.length} / 20`); $('hostControls').hidden=!host; $('lobbySettings').hidden=!host; $('startMulti').hidden=!host; $('startMulti').disabled=s.players.length<2; $('lobbyWait').hidden=host;
    if(document.activeElement!==$('lobbySpeed')) $('lobbySpeed').value=s.settings.speed; if(document.activeElement!==$('lobbyPeace')) $('lobbyPeace').value=s.settings.peaceSeconds;
    $('lobbySlots').innerHTML=s.players.map(p=>`<div class="lobby-slot"><i class="leader-color" style="background:${p.color}"></i><span>${escapeName(p.name)}</span><small>${p.isBot?`ИИ · УР. ${p.difficulty}`:p.id===s.hostId?'ХОСТ':p.connected?'В СЕТИ':'НЕТ СВЯЗИ'}</small>${host&&p.id!==s.hostId?`<button data-replace="${p.id}" title="Заменить на ИИ">${p.isBot?'Сменить ИИ':'В ИИ'}</button><button data-kick="${p.id}">Кик</button>`:''}</div>`).join('');
  }
  result(eliminated=false) {
    const s=this.state,ranking=s.result?.ranking||[...s.players].sort((a,b)=>b.regionsCount-a.regionsCount).map((p,i)=>({...p,place:i+1,regions:p.regionsCount,peakRegions:p.peakRegions})),mine=ranking.find(p=>p.id===s.you?.id),winner=ranking[0],won=mine?.place===1&&!eliminated;
    text($('resultTitle'),eliminated?'Эта битва осталась позади':won?'Мир запомнит твой ход':'Каждая империя — новый план'); text($('resultPlace'),`#${mine?.place||'—'}`); text($('resultSubtitle'),eliminated?'Поражение':won?'Победа!':s.result?'Кампания завершена':'Твой последний регион потерян');
    const reason={conquest:`цель ${s.settings.victoryPercent}% мира достигнута`,domination:'на карте осталась одна держава',time:'лимит времени исчерпан',shutdown:'сервер завершил матч'}[s.result?.reason];
    text($('resultSummary'),`${mine?.regions||0} регионов · пик ${mine?.peakRegions||0} · ${formatTime(s.time)}${reason?` · ${reason}`:''}`);
    $('resultRanking').innerHTML=ranking.map(p=>`<div class="leader-row${p.id===s.you?.id?' is-me':''}"><span class="leader-rank">${p.place}</span><i class="leader-color" style="background:${p.color}"></i><span class="leader-name">${escapeName(p.name)}${p.isBot?' · ИИ':''}</span><span class="leader-count">${p.regions} рег.</span></div>`).join('');
    $('rematchButton').disabled=s.you?.id!==s.hostId||s.phase!=='finished'; $('observeButton').textContent=s.phase==='finished'?'Осмотреть карту':'Наблюдать за матчем';
  }
}
function escapeName(name) { return String(name).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
