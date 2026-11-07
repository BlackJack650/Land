import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { gzipSync } from 'node:zlib';
const directories=['client','server','shared','config','tools','tests'];let files=[];
function walk(dir){for(const entry of fs.readdirSync(dir,{withFileTypes:true})){const p=path.join(dir,entry.name);if(entry.isDirectory())walk(p);else if(p.endsWith('.js'))files.push(p);}}
directories.forEach(walk);files.push('config.js');
for(const file of files){const result=spawnSync(process.execPath,['--check',file],{encoding:'utf8'});if(result.status!==0){console.error(result.stderr);process.exit(1);}}
const assets=[];function collect(dir){for(const entry of fs.readdirSync(dir,{withFileTypes:true})){const p=path.join(dir,entry.name);if(entry.isDirectory())collect(p);else if(/\.(js|css|html)$/.test(p))assets.push(p);}}collect('client');
const bytes=assets.reduce((n,p)=>n+fs.statSync(p).size,0),gzip=assets.reduce((n,p)=>n+gzipSync(fs.readFileSync(p)).length,0);
const external=assets.filter(p=>/(?:src|href)=["']https?:\/\//i.test(fs.readFileSync(p,'utf8')));
for(const name of ['map.json','map-large.json']){const map=JSON.parse(fs.readFileSync(`shared/map/${name}`));if(map.regions.length<250||map.regions.length>350)throw new Error(`${name}: region count out of scope`);if(map.spawns.length!==20)throw new Error(`${name}: expected 20 capitals`);}
console.log(`Syntax: ${files.length} modules ✓`);console.log(`Client code: ${(bytes/1024).toFixed(1)} KiB raw / ${(gzip/1024).toFixed(1)} KiB gzip (map and fonts separate) ✓`);console.log(`External CDN references: ${external.length} ✓`);if(external.length)process.exit(1);
