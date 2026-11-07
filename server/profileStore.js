import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
// Anonymous local statistics only. No account, email, IP or chat is persisted.
export class ProfileStore {
  constructor(directory = 'data') { this.file = path.join(directory,'profiles.json'); this.profiles = {}; this.timer = null; try { this.profiles = JSON.parse(fs.readFileSync(this.file,'utf8')); } catch { this.profiles = {}; } }
  record(room) {
    if (!room.result) return;
    for (const p of room.players) if (!p.isBot && p.token) {
      const id = createHash('sha256').update(p.token).digest('hex').slice(0,24);
      const profile = this.profiles[id] ||= { games: 0, wins: 0, bestRegions: 0 };
      profile.games++; profile.wins += room.result.winnerId === p.id ? 1 : 0; profile.bestRegions = Math.max(profile.bestRegions,p.peakRegions); profile.lastPlayed = new Date().toISOString();
    }
    clearTimeout(this.timer); this.timer = setTimeout(() => this.flush(),1000); this.timer.unref();
  }
  flush() { try { fs.mkdirSync(path.dirname(this.file),{ recursive: true }); const temp = `${this.file}.tmp`; fs.writeFileSync(temp,JSON.stringify(this.profiles,null,2)); fs.renameSync(temp,this.file); } catch (error) { console.warn('Local statistics could not be saved:',error.message); } }
}
