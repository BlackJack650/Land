export const $ = id => document.getElementById(id);
export const icon = (name,small=false) => `<svg class="icon${small?' small':''}" aria-hidden="true"><use href="#i-${name}"/></svg>`;
export function text(element,value) { const s=String(value); if(element.textContent!==s) element.textContent=s; }
export function html(element,value) { if(element.innerHTML!==value) element.innerHTML=value; }
export const formatTime = seconds => `${String(Math.floor(seconds/60)).padStart(2,'0')}:${String(Math.floor(seconds%60)).padStart(2,'0')}`;
export const number = value => Math.floor(value||0).toLocaleString('ru-RU');
export function toast(message,error=false) { const node=document.createElement('div'); node.className=`toast${error?' error':''}`; node.textContent=message; $('toasts').append(node); while($('toasts').children.length>3) $('toasts').firstChild.remove(); setTimeout(()=>node.remove(),error?4500:3200); }
export function readStorage(key,fallback=null) { try { return JSON.parse(localStorage.getItem(key))??fallback; } catch { return fallback; } }
export function writeStorage(key,value) { try { localStorage.setItem(key,JSON.stringify(value)); } catch {} }
export function openDialog(id) { const dialog=$(id); if(!dialog.open) dialog.showModal(); }
export function closeDialog(id) { const dialog=$(id); if(dialog.open) dialog.close(); }
