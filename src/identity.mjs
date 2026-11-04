import fs from 'node:fs';
import path from 'node:path';
const MAX = Number.MAX_SAFE_INTEGER - 1000000;
export class IdentityStore {
  constructor(filename) { this.filename = filename; this.map = {}; this.next = 100000000; this.load(); }
  load() {
    try {
      const d = JSON.parse(fs.readFileSync(this.filename, 'utf8'));
      if (!d || typeof d.map !== 'object' || !Number.isSafeInteger(d.next)) throw Error('invalid mapping');
      this.map = d.map; this.next = d.next;
    } catch (e) { if (e.code !== 'ENOENT') throw e; }
  }
  flush() {
    fs.mkdirSync(path.dirname(this.filename), {recursive:true});
    const t = this.filename + '.tmp';
    fs.writeFileSync(t, JSON.stringify({map:this.map,next:this.next},null,2),{mode:0o600});
    fs.renameSync(t,this.filename);
  }
  id(kind,native) {
    if(typeof native!=='string'||!native.trim()) throw Error('stable native identity required');
    const k = `${kind}:${native}`;
    if(!this.map[k]) { if(this.next>=MAX) throw Error('identity exhausted'); this.map[k]=this.next++; this.flush(); }
    return this.map[k];
  }
  lookup(kind,id) {
    return Object.entries(this.map).find(([k,v])=>k.startsWith(kind+':')&&v===Number(id))?.[0].slice(kind.length+1)??null;
  }
}
