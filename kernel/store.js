import {randomUUID} from 'node:crypto';
import {fail} from './common.js';
import {DatabaseSync} from 'node:sqlite';
import {mkdirSync} from 'node:fs';
import {dirname} from 'node:path';
export class Store {
 constructor(path){this.owner=randomUUID();this.closed=false;if(path!==':memory:')mkdirSync(dirname(path),{recursive:true,mode:0o700});this.db=new DatabaseSync(path);this.db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=1000; CREATE TABLE IF NOT EXISTS tasks(id TEXT PRIMARY KEY, tenant TEXT NOT NULL, workspace TEXT NOT NULL, idem TEXT NOT NULL, hash TEXT NOT NULL, data TEXT NOT NULL, UNIQUE(tenant,workspace,idem)); CREATE TABLE IF NOT EXISTS events(seq INTEGER PRIMARY KEY AUTOINCREMENT, task TEXT NOT NULL, data TEXT NOT NULL); CREATE TABLE IF NOT EXISTS supervisor(id INTEGER PRIMARY KEY CHECK(id=1), owner TEXT NOT NULL, pid INTEGER NOT NULL);');
 try{this.transaction(()=>{const prior=this.db.prepare('SELECT pid FROM supervisor WHERE id=1').get();if(prior){let alive=true;try{process.kill(prior.pid,0);}catch(e){alive=e.code!=='ESRCH';}if(alive)fail('store_owned','Another local supervisor owns this database',409);}this.db.prepare('INSERT OR REPLACE INTO supervisor(id,owner,pid) VALUES(1,?,?)').run(this.owner,process.pid);});}catch(e){this.db.close();throw e;}
 }
 transaction(fn){this.db.exec('BEGIN IMMEDIATE');try{const result=fn();this.db.exec('COMMIT');return result;}catch(e){this.db.exec('ROLLBACK');throw e;}}
 find(tenant,workspace,key){const r=this.db.prepare('SELECT data FROM tasks WHERE tenant=? AND workspace=? AND idem=?').get(tenant,workspace,key);return r&&JSON.parse(r.data);}
 get(id){const r=this.db.prepare('SELECT data FROM tasks WHERE id=?').get(id);return r&&JSON.parse(r.data);}
 all(){return this.db.prepare('SELECT data FROM tasks ORDER BY rowid').all().map(r=>JSON.parse(r.data));}
 insert(t){this.db.prepare('INSERT INTO tasks VALUES(?,?,?,?,?,?)').run(t.id,t.tenant,t.workspace,t.idempotencyKey,t.payloadHash,JSON.stringify(t));this.event(t,'accepted');}
 save(t,kind){this.db.prepare('UPDATE tasks SET data=? WHERE id=?').run(JSON.stringify(t),t.id);this.event(t,kind);}
 event(t,kind){this.db.prepare('INSERT INTO events(task,data) VALUES(?,?)').run(t.id,JSON.stringify({kind,taskId:t.id,runId:t.runId??null,epoch:t.epoch,status:t.status,at:Date.now(),cleanup:t.cleanup}));}
 events(id){return this.db.prepare('SELECT seq,data FROM events WHERE task=? ORDER BY seq').all(id).map(r=>({seq:r.seq,...JSON.parse(r.data)}));}
 close(){if(this.closed)return;this.db.prepare('DELETE FROM supervisor WHERE id=1 AND owner=?').run(this.owner);this.db.close();this.closed=true;}
}
