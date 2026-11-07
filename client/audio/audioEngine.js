import { BALANCE as B } from '../../config/balance.js';
const PRESETS = {
  capture: [660,0.10,'square',0.16,1.35], attack: [180,0.20,'sawtooth',0.12,0.35], lost: [480,0.25,'triangle',0.18,0.35],
  build: [150,0.09,'square',0.20,0.65], upgrade: [520,0.18,'square',0.14,1.5], drone: [720,0.12,'sawtooth',0.09,0.6],
  missile: [110,0.38,'sawtooth',0.16,2.5], explosion: [70,0.40,'noise',0.30,0.3], intercept: [1200,0.13,'square',0.12,0.5],
  error: [95,0.16,'sawtooth',0.13,0.8], click: [700,0.035,'square',0.06,0.8], victory: [523,0.65,'square',0.14,2], defeat: [220,0.7,'triangle',0.20,0.5], nearby: [140,0.13,'triangle',0.10,0.65]
};
const BATTLE = new Set(['capture','attack','lost','drone','missile','explosion','intercept','nearby']);
export class AudioEngine {
  constructor() {
    this.settings = { master:0.6,sfx:0.8,music:0,muted:false };
    try { Object.assign(this.settings,JSON.parse(localStorage.getItem('land.audio')||'{}')); } catch {}
    this.ctx=null; this.battleVoices=0; this.musicStep=0; this.musicTimer=null;
  }
  async init() {
    try {
      if (!this.ctx) {
        const Context=window.AudioContext||window.webkitAudioContext; if (!Context) return;
        this.ctx=new Context(); this.master=this.ctx.createGain(); this.sfx=this.ctx.createGain(); this.music=this.ctx.createGain(); this.sfx.connect(this.master); this.music.connect(this.master); this.master.connect(this.ctx.destination);
        this.noise=this.ctx.createBuffer(1,this.ctx.sampleRate,this.ctx.sampleRate); const data=this.noise.getChannelData(0); for(let i=0;i<data.length;i++) data[i]=Math.random()*2-1;
        this.apply(); this.musicTimer=setInterval(()=>this.musicTick(),420);
      }
      if(this.ctx.state==='suspended') await this.ctx.resume();
    } catch {}
  }
  save() { try { localStorage.setItem('land.audio',JSON.stringify(this.settings)); } catch {} this.apply(); }
  apply() { if(!this.ctx) return; const t=this.ctx.currentTime; this.master.gain.setTargetAtTime(this.settings.muted?0:this.settings.master,t,0.025); this.sfx.gain.setTargetAtTime(this.settings.sfx,t,0.025); this.music.gain.setTargetAtTime(this.settings.music*0.25,t,0.025); }
  tone(freq,duration,type,volume,slide=1,delay=0,output=null,pan=0) {
    if(!this.ctx||this.ctx.state!=='running') return null;
    const t=this.ctx.currentTime+delay,osc=this.ctx.createOscillator(),gain=this.ctx.createGain(); osc.type=type; osc.frequency.setValueAtTime(freq,t); osc.frequency.exponentialRampToValueAtTime(Math.max(20,freq*slide),t+duration);
    gain.gain.setValueAtTime(0,t); gain.gain.linearRampToValueAtTime(volume,t+0.006); gain.gain.exponentialRampToValueAtTime(0.0001,t+duration);
    osc.connect(gain); let panner=null;
    if(this.ctx.createStereoPanner) { panner=this.ctx.createStereoPanner(); panner.pan.value=Math.max(-1,Math.min(1,pan)); gain.connect(panner); panner.connect(output||this.sfx); } else gain.connect(output||this.sfx);
    osc.start(t); osc.stop(t+duration+0.02); osc.onended=()=>{ osc.disconnect(); gain.disconnect(); panner?.disconnect(); }; return osc;
  }
  burst(duration,volume,pan=0) {
    if(!this.ctx||this.ctx.state!=='running') return;
    const t=this.ctx.currentTime,source=this.ctx.createBufferSource(),filter=this.ctx.createBiquadFilter(),gain=this.ctx.createGain(); source.buffer=this.noise; filter.type='lowpass'; filter.frequency.setValueAtTime(1400,t); filter.frequency.exponentialRampToValueAtTime(80,t+duration); gain.gain.setValueAtTime(volume,t); gain.gain.exponentialRampToValueAtTime(0.0001,t+duration); source.connect(filter); filter.connect(gain); let panner=null; if(this.ctx.createStereoPanner) { panner=this.ctx.createStereoPanner(); panner.pan.value=pan; gain.connect(panner); panner.connect(this.sfx); } else gain.connect(this.sfx); source.start(t); source.stop(t+duration); source.onended=()=>{source.disconnect();filter.disconnect();gain.disconnect();panner?.disconnect();};
  }
  play(type,{x=0,y=0,size=1,camera=null,important=false}={}) {
    if(!this.ctx||this.settings.muted||this.ctx.state!=='running') return;
    let volume=1,pan=0;
    if(camera) { const dx=x-camera.x,dy=y-camera.y,d=Math.hypot(dx,dy); volume=Math.max(0.06,1-d/Math.max(70,camera.w)); pan=Math.max(-0.85,Math.min(0.85,dx/Math.max(1,camera.w/2))); if(d>camera.w*1.3&&!important) return; }
    if(BATTLE.has(type)) { if(this.battleVoices>=B.render.maxBattleSounds&&!important) return; this.battleVoices++; setTimeout(()=>{this.battleVoices=Math.max(0,this.battleVoices-1);},420); }
    const preset=PRESETS[type]||PRESETS.click; let [freq,duration,wave,gain,slide]=preset;
    if(type==='capture') freq=540+Math.min(8,size)*55;
    if(type==='victory') { [1,1.25,1.5,2].forEach((n,i)=>this.tone(freq*n,0.22,'square',0.12,1,i*0.14)); return; }
    if(type==='defeat') { [1,1.2,1.5].forEach(n=>this.tone(freq*n,0.65,'triangle',0.09,0.7)); return; }
    if(type==='upgrade') { this.tone(freq,0.10,'square',0.12,1,0); this.tone(freq*1.5,0.16,'square',0.12,1,0.1); return; }
    if(wave==='noise') this.burst(duration,gain*volume,pan); else this.tone(freq,duration,wave,gain*volume,slide,0,null,pan);
    if(type==='build'||type==='explosion') this.burst(duration*0.7,gain*volume*0.5,pan);
  }
  musicTick() { if(!this.ctx||this.ctx.state!=='running'||this.settings.music<=0||this.settings.muted||document.hidden) return; const notes=[130.81,196,261.63,196,155.56,233.08,311.13,233.08]; this.tone(notes[this.musicStep++%notes.length],0.34,'triangle',0.16,1,0,this.music); }
}
