export class Network extends EventTarget {
  constructor() { super(); this.ws=null; this.session=null; this.pending=new Map(); this.latency=0; this.intentional=false; this.attempts=0; this.lastView=0; try { this.session=JSON.parse(localStorage.getItem('land.session')||'null'); } catch {} this.timer=setInterval(()=>this.maintenance(),1000); }
  emit(type,detail) { this.dispatchEvent(new CustomEvent(type,{ detail })); }
  on(type,handler) { this.addEventListener(type,e=>handler(e.detail)); }
  saveSession(session) { this.session=session; try { if(session) localStorage.setItem('land.session',JSON.stringify(session)); else localStorage.removeItem('land.session'); } catch {} }
  async request(url,body) { const response=await fetch(url,{ method:body?'POST':'GET',headers:body?{'Content-Type':'application/json'}:undefined,body:body?JSON.stringify(body):undefined }); const data=await response.json(); if(!response.ok) throw new Error(data.error||'Сервер временно недоступен'); return data; }
  connect() {
    if(this.ws?.readyState===WebSocket.OPEN) return Promise.resolve();
    if(this.connecting) return this.connecting;
    this.intentional=false;
    this.connecting=new Promise((resolve,reject)=>{
      const url=`${location.protocol==='https:'?'wss':'ws'}://${location.host}/ws`;
      const ws=new WebSocket(url); this.ws=ws; let opened=false;
      ws.onopen=()=>{ opened=true; this.attempts=0; this.emit('status',{connected:true}); resolve(); };
      ws.onmessage=e=>{ try { const message=JSON.parse(e.data); if(message.t==='WELCOME') { this.saveSession({code:message.code,token:message.token,playerId:message.playerId,mapSize:message.mapSize,mode:message.mode}); this.emit('welcome',message); } if(message.t==='PONG') this.latency=Math.round(performance.now()-message.sentAt); if(message.cmdId) this.pending.delete(message.cmdId); if(message.t==='LEFT') { this.saveSession(null); this.intentional=true; } if(message.t==='SERVER_SHUTDOWN') { this.intentional=true; this.saveSession(null); } this.emit('message',message); } catch(error) { console.error('Invalid server message',error); } };
      ws.onerror=()=>{ if(!opened) reject(new Error('Не удалось подключиться к серверу')); };
      ws.onclose=()=>{ this.connecting=null; if(this.ws!==ws) return; this.emit('status',{connected:false}); if(!this.intentional&&this.session) { this.emit('reconnect',{active:true,text:'Переподключение… Страна сохранена на 90 секунд.'}); this.scheduleReconnect(); } else if(!opened) reject(new Error('Соединение закрыто')); };
    });
    return this.connecting;
  }
  scheduleReconnect() { clearTimeout(this.reconnectTimer); if(this.attempts>=8) { this.emit('reconnect',{active:true,text:'Связь потеряна. Нажмите «Повторить».'}); return; } const delay=Math.min(8000,700*2**this.attempts++); this.reconnectTimer=setTimeout(()=>this.retry(),delay); }
  async retry() { if(!this.session||this.ws?.readyState===WebSocket.OPEN||this.ws?.readyState===WebSocket.CONNECTING) return; try { await this.connect(); this.ws.send(JSON.stringify({t:'JOIN',code:this.session.code,token:this.session.token})); this.emit('reconnect',{active:false}); } catch { this.scheduleReconnect(); } }
  async createAndJoin({mode='solo',settings={},name,color,code}) {
    this.intentional=true; if(this.ws?.readyState===WebSocket.OPEN) this.ws.close(1000,'New match'); this.pending.clear(); this.saveSession(null);
    await new Promise(resolve=>setTimeout(resolve,60));
    const room=code?{code:code.toUpperCase()}:await this.request('/api/rooms',{mode,settings});
    await this.connect(); this.ws.send(JSON.stringify({t:'JOIN',code:room.code,name,color})); return room.code;
  }
  async resume() { if(!this.session) throw new Error('Нет сохранённого матча'); const session={...this.session}; await this.connect(); this.ws.send(JSON.stringify({t:'JOIN',code:session.code,token:session.token})); }
  command(type,payload={}) { const cmdId=globalThis.crypto?.randomUUID?.()||`c-${Date.now()}-${Math.random().toString(36).slice(2)}`; const message={t:'CMD',cmdId,type,payload}; this.pending.set(cmdId,{message,sentAt:performance.now(),tries:0}); this.raw(message); return cmdId; }
  lobby(type,payload={}) { const cmdId=`l-${Date.now()}-${Math.random().toString(36).slice(2)}`; const message={t:type,payload,cmdId}; this.pending.set(cmdId,{message,sentAt:performance.now(),tries:0}); this.raw(message); }
  raw(message) { if(this.ws?.readyState===WebSocket.OPEN) this.ws.send(JSON.stringify(message)); }
  view(payload) { const now=performance.now(); if(now-this.lastView<280) return; this.lastView=now; this.raw({t:'VIEW',payload}); }
  maintenance() {
    if(this.ws?.readyState===WebSocket.OPEN&&this.session) { this.command('PING',{sentAt:performance.now()}); for(const [id,item] of this.pending) { if(performance.now()-item.sentAt>1800) { if(item.tries>=2) { this.pending.delete(id); this.emit('message',{t:'ERR',cmdId:id,code:'TIMEOUT',message:'Команда не подтверждена. Проверьте соединение.'}); } else { item.tries++; item.sentAt=performance.now(); this.raw(item.message); } } } }
  }
  leave() { this.raw({t:'LEAVE'}); this.saveSession(null); this.pending.clear(); this.intentional=true; clearTimeout(this.reconnectTimer); this.emit('reconnect',{active:false}); setTimeout(()=>{ if(this.ws?.readyState===WebSocket.OPEN) this.ws.close(1000,'Left'); },120); }
}
