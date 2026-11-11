-- QVK Beta Portal v3: news broadcast (Telegram + Web Push). The Worker also applies it on first request.
ALTER TABLE portal_users ADD COLUMN notify_news INTEGER NOT NULL DEFAULT 1;
ALTER TABLE portal_posts ADD COLUMN recipients INTEGER NOT NULL DEFAULT 0;
CREATE TABLE IF NOT EXISTS portal_push(id INTEGER PRIMARY KEY AUTOINCREMENT,user_id TEXT NOT NULL,endpoint TEXT NOT NULL UNIQUE,p256dh TEXT NOT NULL,auth TEXT NOT NULL,ua TEXT,created INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS portal_push_user ON portal_push(user_id);
CREATE TABLE IF NOT EXISTS portal_outbox(id INTEGER PRIMARY KEY AUTOINCREMENT,channel TEXT NOT NULL,target TEXT NOT NULL,payload TEXT NOT NULL,attempts INTEGER NOT NULL DEFAULT 0,claimed INTEGER NOT NULL DEFAULT 0,created INTEGER NOT NULL);
