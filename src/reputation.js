const stamp=()=>Math.floor(Date.now()/1000);
const day=()=>Math.floor(stamp()/86400);
const uid=x=>String(x??"");
const valid=x=>/^[1-9]\d{2,19}$/.test(uid(x));
export function modeAllowed(mode,owner,actor){
 return mode==="users"||(mode==="testers"&&uid(owner)!==""&&uid(actor)===uid(owner));
}
export async function repMode(e,chat){
 const row=await e.DB.prepare("SELECT value FROM settings WHERE chat_id=? AND key='reputation_mode'").bind(String(chat)).first();
 return ["users","testers"].includes(row?.value)?row.value:null;
}
export async function setupRep(e,chat,mode,actor){
 if(!valid(e.REPUTATION_OWNER_ID)||uid(actor)!==uid(e.REPUTATION_OWNER_ID))throw Error("Только владелец с REPUTATION_OWNER_ID может назначать тип группы");
 if(!["users","testers"].includes(mode))throw Error("Тип: users или testers");
 const other=await e.DB.prepare("SELECT chat_id FROM settings WHERE key='reputation_mode' AND value=? AND chat_id<>? LIMIT 1").bind(mode,String(chat)).first();
 if(other)throw Error("Этот тип уже назначен другому чату: "+other.chat_id);
 await e.DB.prepare("INSERT INTO settings(chat_id,key,value) VALUES(?,'reputation_mode',?) ON CONFLICT(chat_id,key) DO UPDATE SET value=excluded.value").bind(String(chat),mode).run();
 return mode;
}
export async function addRep(e,params){
 const {chat,actor,target,sourceMessage,amount=1}=params;
 const c=uid(chat),a=uid(actor),t=uid(target);
 if(!valid(a)||!valid(t)||a===t)throw Error("Нельзя начислять репутацию самому себе");
 const mode=await repMode(e,c);
 if(!mode)throw Error("Владелец должен назначить тип группы через /rep_setup");
 if(!modeAllowed(mode,e.REPUTATION_OWNER_ID,a))throw Error("Только владелец может повышать репутацию тестировщиков");
 if(mode==="users"&&![-1,1].includes(amount))throw Error("Участникам доступны только + и - по одному баллу");
 if(mode==="testers"&&(!Number.isInteger(amount)||amount===0||Math.abs(amount)>5))throw Error("Баллы: от -5 до -1 или от 1 до 5");
 if(!Number.isSafeInteger(Number(sourceMessage))||Number(sourceMessage)<1)throw Error("Неизвестное сообщение");
 const key=mode==="users"?("daily:"+day()+":"+a+":"+t):("owner:"+a+":"+uid(sourceMessage));
 const r=await e.DB.prepare("INSERT OR IGNORE INTO reputation_votes(chat_id,vote_key,giver_id,receiver_id,amount,ts) VALUES(?,?,?,?,?,?)").bind(c,key,a,t,amount,stamp()).run();
 if(!r.meta?.changes)return {mode,added:false};
 // D1 trigger reputation_vote_score applies the accepted vote atomically.
 return {mode,added:true};
}
export async function getRep(e,chat,user){
 const row=await e.DB.prepare("SELECT score FROM reputation_scores WHERE chat_id=? AND user_id=?").bind(uid(chat),uid(user)).first();
 return Number(row?.score||0);
}
export async function topRep(e,chat){
 const rows=await e.DB.prepare("SELECT user_id,score FROM reputation_scores WHERE chat_id=? ORDER BY score DESC,user_id LIMIT 10").bind(uid(chat)).all();
 return rows.results;
}
