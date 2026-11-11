-- QVK Beta Portal v4: QVK app API (tokens, linking codes, ticket source). The Worker also applies it on first request.
ALTER TABLE portal_tickets ADD COLUMN source TEXT NOT NULL DEFAULT 'web';
CREATE TABLE IF NOT EXISTS portal_app_tokens(id INTEGER PRIMARY KEY AUTOINCREMENT,user_id TEXT NOT NULL,token_hash TEXT NOT NULL UNIQUE,name TEXT NOT NULL,created INTEGER NOT NULL,last_used INTEGER NOT NULL,revoked INTEGER NOT NULL DEFAULT 0);
CREATE INDEX IF NOT EXISTS portal_app_tokens_user ON portal_app_tokens(user_id);
CREATE TABLE IF NOT EXISTS portal_app_links(id INTEGER PRIMARY KEY AUTOINCREMENT,code TEXT NOT NULL UNIQUE,poll_hash TEXT NOT NULL UNIQUE,device_name TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'pending',user_id TEXT,created INTEGER NOT NULL,expires INTEGER NOT NULL);
