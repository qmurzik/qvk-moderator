const ts=()=>Math.floor(Date.now()/1000);
export async function setting(e,c,k,fallback="off"){const r=await e.DB.prepare("SELECT value FROM settings WHERE chat_id=? AND key=?").bind(String(c),k).first();return r?.value??fallback;}
export async function logAction(e,c,t,u,action,reason){await e.DB.prepare("INSERT INTO events(chat_id,thread_id,user_id,action,reason,ts) VALUES(?,?,?,?,?,?)").bind(String(c),String(t||""),String(u||""),action,String(reason||"").slice(0,150),ts()).run();}
export async function raidJoin(e,m,notify){
 if(!m.new_chat_members?.length||m.chat.type!=="supergroup")return false;
 const c=String(m.chat.id),time=ts();
 const mode=await setting(e,c,"raid_watch","on");
 if(mode!=="on")return false;
 for(const u of m.new_chat_members){
  await e.DB.prepare("INSERT OR IGNORE INTO processed(chat_id,key,ts) VALUES(?,?,?)").bind(c,"raidjoin:"+u.id+":"+m.message_id,time).run();
 }
 const result=await e.DB.prepare("SELECT COUNT(*) n FROM processed WHERE chat_id=? AND key LIKE 'raidjoin:%' AND ts>=?").bind(c,time-60).first();
 const threshold=Math.max(3,Math.min(100,Number(await setting(e,c,"raid_threshold","8"))||8));
 if(Number(result?.n||0)<threshold)return false;
 const dedupe=await e.DB.prepare("INSERT OR IGNORE INTO processed(chat_id,key,ts) VALUES(?,?,?)").bind(c,"raidalert:"+Math.floor(time/300),time).run();
 if(!dedupe.meta?.changes)return true;
 await logAction(e,c,"","","raid_detected","Вступило "+result.n+" участников за минуту");
 try{await notify(e,c,"🛡 Антирейд QVK: "+result.n+" вступлений за 60 секунд. Проверь новых участников. Автоматические ограничения выключены.");}catch(err){console.error("Raid alert delivery",String(err));}
 return true;
}
export async function observePunishment(e,m,notify){
 if(!m.from||m.from.is_bot||m.sender_chat)return;
 const c=String(m.chat.id),id=String(m.from.id);
 const mode=await setting(e,c,"auto_punish","off");
 if(mode!=="on")return;
 // Opt-in alert only: even when enabled, do not impose restrictions without moderator approval.
 const n=await e.DB.prepare("SELECT count FROM warnings WHERE chat_id=? AND user_id=?").bind(c,id).first();
 const threshold=Math.max(2,Math.min(20,Number(await setting(e,c,"punish_threshold","3"))||3));
 if(Number(n?.count||0)<threshold)return;
 const key="punishnotify:"+id+":"+Math.floor(ts()/86400);
 const done=await e.DB.prepare("INSERT OR IGNORE INTO processed(chat_id,key,ts) VALUES(?,?,?)").bind(c,key,ts()).run();
 if(!done.meta?.changes)return;
 await logAction(e,c,m.message_thread_id,id,"punishment_review","Достигнуто "+n.count+" предупреждений");
 try{await notify(e,c,"⚖️ QVK: у участника "+(m.from.first_name||id)+" уже "+n.count+" предупреждений. Решение о муте принимает администратор.");}catch(err){console.error("Punishment alert",String(err));}
}
export async function analytics(e,c,days=7){
 const start=ts()-Math.min(30,Math.max(1,days))*86400;
 const rows=await e.DB.prepare("SELECT CAST((ts/86400) AS INTEGER) day,action,COUNT(*) total FROM events WHERE chat_id=? AND ts>=? GROUP BY day,action ORDER BY day").bind(String(c),start).all();
 const topics=await e.DB.prepare("SELECT thread_id,COUNT(*) total FROM events WHERE chat_id=? AND ts>=? AND thread_id!='' GROUP BY thread_id ORDER BY total DESC LIMIT 8").bind(String(c),start).all();
 return {days,events:rows.results,topics:topics.results};
}
