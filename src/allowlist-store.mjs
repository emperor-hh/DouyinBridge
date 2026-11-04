import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export const CONVERSATION_ID = /^conv:[a-f0-9]{64}$/;
export const BINDING_ID = /^binding:[a-f0-9]{64}$/;
export const validContact = c => Boolean(c && CONVERSATION_ID.test(c.id ?? '') &&
  c.identityVersion === 2 && c.identityVerified === true &&
  BINDING_ID.test(c.identityBinding ?? '') &&
  typeof c.identityKind === 'string' && /^[a-f0-9]{64}$/.test(c.identityHash ?? '') &&
  c.identityHash === c.id.slice(5) &&
  typeof c.isGroup === 'boolean');

export class AllowlistStore {
  constructor(filename,{legacyAllowlist=[]}={}){
    fs.mkdirSync(path.dirname(filename),{recursive:true});
    this.db=new DatabaseSync(filename);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS conversations (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL CHECK(kind IN ('private','group')),
        name TEXT NOT NULL,
        identity_binding TEXT NOT NULL,
        identity_kind TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN (0,1)),
        updated_at TEXT NOT NULL
      );
    `);
    // Additive migration: old databases remain valid, cover capture defaults off.
    if(!this.db.prepare('PRAGMA table_info(conversations)').all().some(row=>row.name==='cover_enabled')){
      this.db.exec('ALTER TABLE conversations ADD COLUMN cover_enabled INTEGER NOT NULL DEFAULT 0 CHECK(cover_enabled IN (0,1))');
    }
    // Legacy env IDs are only imported when a matching verified contact appears.
    // Never override an explicit database disable on later restarts.
    const migrated=this.db.prepare("SELECT value FROM settings WHERE key='legacy_allowlist_migrated'").get();
    if(!migrated){
      const ids=[...new Set(legacyAllowlist)].filter(id=>CONVERSATION_ID.test(id));
      this.db.prepare("INSERT INTO settings(key,value) VALUES('legacy_allowlist_migrated','1')").run();
      this.db.prepare("INSERT INTO settings(key,value) VALUES('legacy_allowlist_pending',?)").run(JSON.stringify(ids));
    }
  }
  pending(){
    try {return JSON.parse(this.db.prepare("SELECT value FROM settings WHERE key='legacy_allowlist_pending'").get()?.value??'[]');}
    catch {return [];}
  }
  upsertContacts(rows){
    if(!Array.isArray(rows))throw new Error('contacts must be an array');
    const sql=this.db.prepare(`INSERT INTO conversations(id,kind,name,identity_binding,identity_kind,enabled,updated_at)
      VALUES(?,?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET name=excluded.name,updated_at=excluded.updated_at`);
    const get=this.db.prepare('SELECT id,kind,identity_binding,identity_kind FROM conversations WHERE id=?');
    const pending=new Set(this.pending());
    this.db.exec('BEGIN IMMEDIATE');
    try{
      for(const c of rows){
        if(!validContact(c))continue;
        const kind=c.isGroup?'group':'private';
        const previous=get.get(c.id);
        // An ID changing its kind/binding is a collision: refuse migration.
        if(previous && (previous.kind!==kind || previous.identity_binding!==c.identityBinding ||
          previous.identity_kind!==c.identityKind))continue;
        const name=String(c.displayName??c.name??'未命名').slice(0,200).trim() || '未命名';
        sql.run(c.id,kind,name,c.identityBinding,c.identityKind,previous?0:pending.has(c.id)?1:0,new Date().toISOString());
        pending.delete(c.id);
      }
      this.db.prepare("UPDATE settings SET value=? WHERE key='legacy_allowlist_pending'").run(JSON.stringify([...pending]));
      this.db.exec('COMMIT');
    }catch(e){this.db.exec('ROLLBACK');throw e;}
  }
  list(){return this.db.prepare('SELECT id,kind,name,enabled,cover_enabled,updated_at FROM conversations ORDER BY kind,name COLLATE NOCASE').all()
    .map(({cover_enabled,...r})=>({...r,enabled:r.enabled===1,coverEnabled:cover_enabled===1}));}
  lookup(id){if(!CONVERSATION_ID.test(id))return null;
    return this.db.prepare('SELECT * FROM conversations WHERE id=?').get(id)??null;}
  allowed(id,kind,binding){
    const row=this.lookup(id);
    return Boolean(row && row.enabled===1 && row.kind===kind &&
      (!binding || row.identity_binding===binding));
  }
  coverAllowed(id,kind,binding){
    const row=this.lookup(id);
    return Boolean(row&&row.cover_enabled===1&&this.allowed(id,kind,binding));
  }
  setCoverEnabled(id,enabled){
    if(!CONVERSATION_ID.test(id)||typeof enabled!=='boolean')throw Object.assign(Error('invalid conversation or cover enabled'),{statusCode:400});
    if(!this.lookup(id))throw Object.assign(Error('conversation not found'),{statusCode:404});
    this.db.prepare('UPDATE conversations SET cover_enabled=?,updated_at=? WHERE id=?')
      .run(enabled?1:0,new Date().toISOString(),id);
    return this.list().find(row=>row.id===id);
  }
  setEnabled(id,enabled){
    if(!CONVERSATION_ID.test(id)||typeof enabled!=='boolean')throw Object.assign(Error('invalid conversation or enabled'),{statusCode:400});
    const row=this.lookup(id);
    if(!row)throw Object.assign(Error('conversation not found or not verified'),{statusCode:404});
    const result=this.db.prepare('UPDATE conversations SET enabled=?,updated_at=? WHERE id=?')
      .run(enabled?1:0,new Date().toISOString(),id);
    if(result.changes!==1)throw Error('could not update conversation');
    return this.list().find(x=>x.id===id);
  }
  close(){this.db.close();}
}
