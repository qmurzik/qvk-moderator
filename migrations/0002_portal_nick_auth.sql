-- QVK Beta Portal v2: nickname + password accounts, optional Telegram link.
ALTER TABLE portal_users ADD COLUMN nick TEXT;
ALTER TABLE portal_users ADD COLUMN nick_lc TEXT;
ALTER TABLE portal_users ADD COLUMN pass_hash TEXT;
ALTER TABLE portal_users ADD COLUMN tg_id TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS portal_users_nick ON portal_users(nick_lc);
CREATE UNIQUE INDEX IF NOT EXISTS portal_users_tg ON portal_users(tg_id);
CREATE TABLE IF NOT EXISTS portal_links(token_hash TEXT PRIMARY KEY,user_id TEXT NOT NULL,tg_user TEXT,created INTEGER NOT NULL,expires INTEGER NOT NULL);
