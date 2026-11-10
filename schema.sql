CREATE TABLE IF NOT EXISTS settings(chat_id TEXT NOT NULL,key TEXT NOT NULL,value TEXT NOT NULL,PRIMARY KEY(chat_id,key));
CREATE TABLE IF NOT EXISTS topics(chat_id TEXT NOT NULL,thread_id TEXT NOT NULL,kind TEXT NOT NULL,PRIMARY KEY(chat_id,thread_id));
CREATE TABLE IF NOT EXISTS processed(chat_id TEXT NOT NULL,key TEXT NOT NULL,ts INTEGER NOT NULL,PRIMARY KEY(chat_id,key));
CREATE TABLE IF NOT EXISTS warnings(chat_id TEXT NOT NULL,user_id TEXT NOT NULL,count INTEGER NOT NULL DEFAULT 0,updated INTEGER NOT NULL,PRIMARY KEY(chat_id,user_id));
CREATE TABLE IF NOT EXISTS events(id INTEGER PRIMARY KEY AUTOINCREMENT,chat_id TEXT NOT NULL,thread_id TEXT,user_id TEXT,action TEXT NOT NULL,reason TEXT,ts INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS events_chat_ts ON events(chat_id,ts);

CREATE TABLE IF NOT EXISTS reputation_scores(chat_id TEXT NOT NULL,user_id TEXT NOT NULL,score INTEGER NOT NULL DEFAULT 0,updated INTEGER NOT NULL,PRIMARY KEY(chat_id,user_id));
CREATE TABLE IF NOT EXISTS reputation_votes(chat_id TEXT NOT NULL,vote_key TEXT NOT NULL,giver_id TEXT NOT NULL,receiver_id TEXT NOT NULL,amount INTEGER NOT NULL,ts INTEGER NOT NULL,PRIMARY KEY(chat_id,vote_key));
CREATE INDEX IF NOT EXISTS reputation_votes_chat_ts ON reputation_votes(chat_id,ts);

CREATE TRIGGER IF NOT EXISTS reputation_vote_score AFTER INSERT ON reputation_votes BEGIN
 INSERT INTO reputation_scores(chat_id,user_id,score,updated) VALUES(NEW.chat_id,NEW.receiver_id,NEW.amount,NEW.ts)
 ON CONFLICT(chat_id,user_id) DO UPDATE SET score=score+excluded.score,updated=excluded.updated;
END;
