// QVK Beta Portal — D1 schema. Purely additive: only new portal_* tables,
// existing moderator tables are never touched. The same statements are
// written to migrations/0001_portal.sql by scripts/build-portal.mjs.

export const SCHEMA_VERSION = "4";

// v2: nickname + password accounts; Telegram is linked optionally (DMs, admin rights).
export const MIGRATION_V2 = [
  `ALTER TABLE portal_users ADD COLUMN nick TEXT`,
  `ALTER TABLE portal_users ADD COLUMN nick_lc TEXT`,
  `ALTER TABLE portal_users ADD COLUMN pass_hash TEXT`,
  `ALTER TABLE portal_users ADD COLUMN tg_id TEXT`,
  `CREATE UNIQUE INDEX IF NOT EXISTS portal_users_nick ON portal_users(nick_lc)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS portal_users_tg ON portal_users(tg_id)`,
  `CREATE TABLE IF NOT EXISTS portal_links(token_hash TEXT PRIMARY KEY,user_id TEXT NOT NULL,tg_user TEXT,created INTEGER NOT NULL,expires INTEGER NOT NULL)`,
];

// v3: news broadcast to Telegram and browser push notifications.
export const MIGRATION_V3 = [
  `ALTER TABLE portal_users ADD COLUMN notify_news INTEGER NOT NULL DEFAULT 1`,
  `ALTER TABLE portal_posts ADD COLUMN recipients INTEGER NOT NULL DEFAULT 0`,
  `CREATE TABLE IF NOT EXISTS portal_push(id INTEGER PRIMARY KEY AUTOINCREMENT,user_id TEXT NOT NULL,endpoint TEXT NOT NULL UNIQUE,p256dh TEXT NOT NULL,auth TEXT NOT NULL,ua TEXT,created INTEGER NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS portal_push_user ON portal_push(user_id)`,
  `CREATE TABLE IF NOT EXISTS portal_outbox(id INTEGER PRIMARY KEY AUTOINCREMENT,channel TEXT NOT NULL,target TEXT NOT NULL,payload TEXT NOT NULL,attempts INTEGER NOT NULL DEFAULT 0,claimed INTEGER NOT NULL DEFAULT 0,created INTEGER NOT NULL)`,
];

// v4: QVK app API — personal app tokens, device linking codes, ticket source.
export const MIGRATION_V4 = [
  `ALTER TABLE portal_tickets ADD COLUMN source TEXT NOT NULL DEFAULT 'web'`,
  `CREATE TABLE IF NOT EXISTS portal_app_tokens(id INTEGER PRIMARY KEY AUTOINCREMENT,user_id TEXT NOT NULL,token_hash TEXT NOT NULL UNIQUE,name TEXT NOT NULL,created INTEGER NOT NULL,last_used INTEGER NOT NULL,revoked INTEGER NOT NULL DEFAULT 0)`,
  `CREATE INDEX IF NOT EXISTS portal_app_tokens_user ON portal_app_tokens(user_id)`,
  `CREATE TABLE IF NOT EXISTS portal_app_links(id INTEGER PRIMARY KEY AUTOINCREMENT,code TEXT NOT NULL UNIQUE,poll_hash TEXT NOT NULL UNIQUE,device_name TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'pending',user_id TEXT,created INTEGER NOT NULL,expires INTEGER NOT NULL)`,
];

/** Runs statements, skipping ADD COLUMN for columns that already exist (idempotent). */
async function applyMigration(e, stmts) {
  const colsCache = {};
  for (const sql of stmts) {
    const m = sql.match(/^ALTER TABLE (\w+) ADD COLUMN (\w+)/);
    if (m) {
      colsCache[m[1]] ||= new Set(((await e.DB.prepare(`PRAGMA table_info(${m[1]})`).all()).results || []).map((c) => c.name));
      if (colsCache[m[1]].has(m[2])) continue;
    }
    await e.DB.prepare(sql).run();
  }
}

export const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS portal_settings(key TEXT PRIMARY KEY,value TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS portal_users(id TEXT PRIMARY KEY,first_name TEXT,last_name TEXT,username TEXT,photo_url TEXT,created INTEGER NOT NULL,last_seen INTEGER NOT NULL,notify_tg INTEGER NOT NULL DEFAULT 1,tg_blocked INTEGER NOT NULL DEFAULT 0,active_device INTEGER,deleted INTEGER NOT NULL DEFAULT 0,banned INTEGER NOT NULL DEFAULT 0)`,
  `CREATE TABLE IF NOT EXISTS portal_sessions(hash TEXT PRIMARY KEY,user_id TEXT NOT NULL,csrf TEXT NOT NULL,created INTEGER NOT NULL,expires INTEGER NOT NULL,seen INTEGER NOT NULL,ua TEXT)`,
  `CREATE INDEX IF NOT EXISTS portal_sessions_user ON portal_sessions(user_id)`,
  `CREATE TABLE IF NOT EXISTS portal_logins(id INTEGER PRIMARY KEY AUTOINCREMENT,token_hash TEXT NOT NULL UNIQUE,nonce_hash TEXT NOT NULL UNIQUE,code TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'pending',tg_user TEXT,user_id TEXT,created INTEGER NOT NULL,expires INTEGER NOT NULL,ua TEXT)`,
  `CREATE TABLE IF NOT EXISTS portal_devices(id INTEGER PRIMARY KEY AUTOINCREMENT,user_id TEXT NOT NULL,model TEXT NOT NULL,android TEXT NOT NULL,app_version TEXT NOT NULL,firmware TEXT,created INTEGER NOT NULL,updated INTEGER NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS portal_devices_user ON portal_devices(user_id)`,
  `CREATE TABLE IF NOT EXISTS portal_counters(kind TEXT PRIMARY KEY,n INTEGER NOT NULL DEFAULT 0)`,
  `CREATE TABLE IF NOT EXISTS portal_tickets(id INTEGER PRIMARY KEY AUTOINCREMENT,kind TEXT NOT NULL,num INTEGER NOT NULL,code TEXT NOT NULL UNIQUE,author_id TEXT NOT NULL,category TEXT NOT NULL,title TEXT NOT NULL,description TEXT NOT NULL DEFAULT '',steps TEXT NOT NULL DEFAULT '',expected TEXT NOT NULL DEFAULT '',actual TEXT NOT NULL DEFAULT '',frequency TEXT,how_it_works TEXT NOT NULL DEFAULT '',purpose TEXT NOT NULL DEFAULT '',device_model TEXT,android TEXT,app_version TEXT,firmware TEXT,status TEXT NOT NULL,priority TEXT NOT NULL DEFAULT 'normal',fixed_version TEXT,status_note TEXT,pinned INTEGER NOT NULL DEFAULT 0,hidden INTEGER NOT NULL DEFAULT 0,duplicate_of INTEGER,votes INTEGER NOT NULL DEFAULT 0,confirms INTEGER NOT NULL DEFAULT 0,comments INTEGER NOT NULL DEFAULT 0,created INTEGER NOT NULL,updated INTEGER NOT NULL,activity INTEGER NOT NULL,resolved INTEGER,search TEXT NOT NULL DEFAULT '')`,
  `CREATE INDEX IF NOT EXISTS portal_tickets_kind_status ON portal_tickets(kind,status)`,
  `CREATE INDEX IF NOT EXISTS portal_tickets_author ON portal_tickets(author_id)`,
  `CREATE INDEX IF NOT EXISTS portal_tickets_activity ON portal_tickets(kind,activity)`,
  `CREATE TABLE IF NOT EXISTS portal_votes(ticket_id INTEGER NOT NULL,user_id TEXT NOT NULL,created INTEGER NOT NULL,PRIMARY KEY(ticket_id,user_id))`,
  `CREATE TABLE IF NOT EXISTS portal_confirms(ticket_id INTEGER NOT NULL,user_id TEXT NOT NULL,created INTEGER NOT NULL,PRIMARY KEY(ticket_id,user_id))`,
  `CREATE TABLE IF NOT EXISTS portal_favorites(user_id TEXT NOT NULL,ticket_id INTEGER NOT NULL,created INTEGER NOT NULL,PRIMARY KEY(user_id,ticket_id))`,
  `CREATE TABLE IF NOT EXISTS portal_comments(id INTEGER PRIMARY KEY AUTOINCREMENT,ticket_id INTEGER NOT NULL,user_id TEXT,kind TEXT NOT NULL DEFAULT 'comment',body TEXT NOT NULL,created INTEGER NOT NULL,edited INTEGER,deleted INTEGER NOT NULL DEFAULT 0)`,
  `CREATE INDEX IF NOT EXISTS portal_comments_ticket ON portal_comments(ticket_id,id)`,
  `CREATE TABLE IF NOT EXISTS portal_history(id INTEGER PRIMARY KEY AUTOINCREMENT,ticket_id INTEGER NOT NULL,actor_id TEXT,field TEXT NOT NULL,old TEXT,new TEXT,note TEXT,created INTEGER NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS portal_history_ticket ON portal_history(ticket_id,id)`,
  `CREATE TABLE IF NOT EXISTS portal_attachments(id TEXT PRIMARY KEY,ticket_id INTEGER,comment_id INTEGER,user_id TEXT NOT NULL,name TEXT NOT NULL,mime TEXT NOT NULL,size INTEGER NOT NULL,storage TEXT NOT NULL,chunks INTEGER NOT NULL DEFAULT 0,created INTEGER NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS portal_attachments_ticket ON portal_attachments(ticket_id)`,
  `CREATE TABLE IF NOT EXISTS portal_chunks(att_id TEXT NOT NULL,idx INTEGER NOT NULL,data BLOB NOT NULL,PRIMARY KEY(att_id,idx))`,
  `CREATE TABLE IF NOT EXISTS portal_notifications(id INTEGER PRIMARY KEY AUTOINCREMENT,user_id TEXT NOT NULL,ticket_id INTEGER,type TEXT NOT NULL,text TEXT NOT NULL,created INTEGER NOT NULL,read INTEGER NOT NULL DEFAULT 0)`,
  `CREATE INDEX IF NOT EXISTS portal_notifications_user ON portal_notifications(user_id,read,id)`,
  `CREATE TABLE IF NOT EXISTS portal_posts(id INTEGER PRIMARY KEY AUTOINCREMENT,kind TEXT NOT NULL,title TEXT NOT NULL,body TEXT NOT NULL,version TEXT,pinned INTEGER NOT NULL DEFAULT 0,author_id TEXT,created INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS portal_drafts(user_id TEXT NOT NULL,kind TEXT NOT NULL,data TEXT NOT NULL,updated INTEGER NOT NULL,PRIMARY KEY(user_id,kind))`,
  `CREATE TABLE IF NOT EXISTS portal_rate(k TEXT PRIMARY KEY,w INTEGER NOT NULL,c INTEGER NOT NULL)`,
  `INSERT OR IGNORE INTO portal_counters(kind,n) VALUES('bug',0),('idea',0)`,
  `INSERT OR IGNORE INTO portal_settings(key,value) VALUES('current_version','3.0'),('comments_public','on'),('notify_admins','on'),('login_widget','off'),('rev','1'),('welcome','Спасибо, что помогаете сделать QVK 3.0 лучше! Сообщайте об ошибках и делитесь идеями — каждое обращение читает команда.')`,
];

let ready = null;

/** Idempotently creates portal tables. Memoised per isolate. */
export async function ensureSchema(e) {
  if (ready) return ready;
  ready = (async () => {
    let version = "0";
    try {
      const row = await e.DB.prepare("SELECT value FROM portal_settings WHERE key='schema_version'").first();
      version = row?.value || "0";
      if (version === SCHEMA_VERSION) return true;
    } catch {
      /* table missing — create below */
    }
    if (version < "1") await e.DB.batch(SCHEMA.map((sql) => e.DB.prepare(sql)));
    if (version < "2") await applyMigration(e, MIGRATION_V2);
    if (version < "3") await applyMigration(e, MIGRATION_V3);
    if (version < "4") await applyMigration(e, MIGRATION_V4);
    await e.DB.prepare(
      "INSERT INTO portal_settings(key,value) VALUES('schema_version',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
    ).bind(SCHEMA_VERSION).run();
    return true;
  })().catch((err) => {
    ready = null;
    throw err;
  });
  return ready;
}

export function resetSchemaCache() {
  ready = null;
}
