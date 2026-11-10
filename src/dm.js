import {LABELS} from "./rules.js";
import {person,personLabel,actionLabel} from "./people.js";
const label=(s,n=55)=>String(s||"").replace(/[\r\n]/g," ").slice(0,n);
export const isGroup=m=>["supergroup","group"].includes(m?.chat?.type);
export async function discover(env,m){
 if(!isGroup(m))return;
 const id=String(m.chat.id);
 await env.DB.prepare("INSERT OR IGNORE INTO settings(chat_id,key,value) VALUES('_registry',?,?)").bind("chat:"+id,JSON.stringify({id,title:label(m.chat.title,90)})).run();
 const t=m.message_thread_id;
 if(t==null)return;
 const name=m.forum_topic_created?.name||m.forum_topic_edited?.name;
 if(name){
  await env.DB.prepare("INSERT INTO settings(chat_id,key,value) VALUES(?,?,?) ON CONFLICT(chat_id,key) DO UPDATE SET value=excluded.value").bind(id,"topic:"+t,label(name,90)).run();
 }else{
  await env.DB.prepare("INSERT OR IGNORE INTO settings(chat_id,key,value) VALUES(?,?,?)").bind(id,"topic:"+t,"Тема #"+t).run();
 }
}
async function groups(env){
 const r=await env.DB.prepare("SELECT key,value FROM settings WHERE chat_id='_registry' AND key LIKE 'chat:%' ORDER BY key LIMIT 100").all();
 return r.results.map(v=>{try{return JSON.parse(v.value)}catch{return null}}).filter(Boolean);
}
async function topics(env,id){
 const r=await env.DB.prepare("SELECT x.thread_id,x.kind,COALESCE(s.value,'Тема #'||x.thread_id) AS title FROM topics x LEFT JOIN settings s ON s.chat_id=x.chat_id AND s.key='topic:'||x.thread_id WHERE x.chat_id=?").bind(id).all();
 const p=await env.DB.prepare("SELECT substr(key,7) AS thread_id,value AS title FROM settings WHERE chat_id=? AND key LIKE 'topic:%'").bind(id).all();
 const a=new Map(p.results.map(x=>[String(x.thread_id),{...x,kind:null}]));
 for(const x of r.results)a.set(String(x.thread_id),{...a.get(String(x.thread_id)),...x});
 return [...a.values()].sort((a,b)=>Number(a.thread_id)-Number(b.thread_id)).slice(0,80);
}
const b=(text,data)=>({text,callback_data:data});
const kb=rows=>({inline_keyboard:rows});
const webApp=(env)=>({text:"📱 Открыть Mini App",web_app:{url:String(env.MINI_APP_URL||"https://qvk-moderator.qmurzik7.workers.dev/app")}});
async function groupName(e,id){const x=await e.DB.prepare("SELECT value FROM settings WHERE chat_id='_registry' AND key=?").bind("chat:"+id).first();try{return JSON.parse(x?.value||"{}").title||"Группа QVK";}catch{return "Группа QVK";}}
async function topicName(e,id,thread){if(!thread)return "Общая";const x=await e.DB.prepare("SELECT value FROM settings WHERE chat_id=? AND key=?").bind(id,"topic:"+thread).first();return x?.value||"Ветка #"+thread;}
const settings=[["enabled","Модерация"],["ai","ИИ"],["antispam","Антиспам"],["links","Проверка ссылок"],["join_cleanup","Очистка вступлений"],["raid_watch","Антирейд"],["auto_punish","Контроль предупреждений"],["self_test","Самопроверка"]];
export async function dmHome(env,chat,send){
 const g=await groups(env);
 const rows=g.map(x=>[b("👥 "+label(x.title||x.id,45),"dm:g:"+x.id)]);
 rows.push([b("🔄 Обновить","dm:home")]);
 await send(env,chat,"💜 QVK Moderator — группы\n"+(g.length?"Выбери группу для настройки:":"Пока не нашла группы. Добавь бота в группу и отправь там /panel — группа появится здесь."),{reply_markup:kb(rows)});
}
async function dmGroup(env,chat,id,send){
 const r=await env.DB.prepare("SELECT value FROM settings WHERE chat_id='_registry' AND key=?").bind("chat:"+id).first();
 if(!r)return send(env,chat,"Группа не зарегистрирована. Отправь /panel внутри группы.");
 const name=JSON.parse(r.value).title;
 await send(env,chat,"💜 QVK Moderator\n\n👥 "+label(name)+"\n\nВыбери раздел управления:",{reply_markup:kb([[b("🗂 Ветки и назначение правил","dm:t:"+id)],[b("⚙️ Переключатели","dm:s:"+id)],[b("📊 Статистика","dm:stats:"+id),b("📜 Журнал","dm:logs:"+id)],[b("🩺 Права бота","dm:rights:"+id)],[webApp(env)],[b("👤 Участники и наказания","dm:users:"+id)],[b("➕ Добавить ветку вручную","dm:new:"+id)],[b("⬅️ Все группы","dm:home")]])});
}
async function dmTopics(env,chat,id,send){
 const arr=await topics(env,id);
 const rows=arr.map(x=>[b(label(x.title,24)+" · "+(LABELS[x.kind]||"Без правил"),"dm:k:"+id+":"+x.thread_id)]);
 rows.push([b("➕ Ветка по ID","dm:new:"+id)],[b("⬅️ Группа","dm:g:"+id)]);
 await send(env,chat,"🗂 Ветки · "+label(await groupName(env,id))+"\n\n"+(arr.length?"Нажми на ветку, чтобы назначить правила.":"Пока ветки не обнаружены. Напиши любое сообщение в каждой ветке или добавь её ID вручную."),{reply_markup:kb(rows)});
}
async function dmKinds(env,chat,id,t,send){
 const rows=Object.entries(LABELS).map(([k,l])=>[b(l,"dm:a:"+id+":"+t+":"+k)]);
 rows.push([b("🚫 Без тематических правил","dm:a:"+id+":"+t+":none")],[b("✏️ Изменить название","dm:rename:"+id+":"+t)],[b("⬅️ Ветки","dm:t:"+id)]);
 await send(env,chat,"🧭 "+label(await topicName(env,id,t))+"\n\nВыбери назначение ветки:",{reply_markup:kb(rows)});
}
async function dmSettings(env,chat,id,send){
 const r=await env.DB.prepare("SELECT key,value FROM settings WHERE chat_id=?").bind(id).all();
 const vals=Object.fromEntries(r.results.map(x=>[x.key,x.value]));
 const rows=settings.map(([k,name])=>[b((vals[k]??(k==="auto_punish"?"off":"on"))==="on"?"✅ "+name:"⏸ "+name,"dm:toggle:"+id+":"+k)]);
 rows.push([b("🧭 Оффтоп: "+((vals.topic_action||"delete")==="delete"?"Удалять":"Предупреждать"),"dm:toggle:"+id+":topic_action")],[b("🛡 Спам: "+((vals.spam_action||"warn")==="delete"?"Удалять":"Предупреждать"),"dm:toggle:"+id+":spam_action")],[b("⬅️ Группа","dm:g:"+id)]);
 await send(env,chat,"⚙️ Настройки · "+label(await groupName(env,id))+"\n\nНажми, чтобы изменить состояние:",{reply_markup:kb(rows)});
}
async function dmStats(env,chat,id,send){
 const count=await env.DB.prepare("SELECT COALESCE(SUM(count),0) n FROM warnings WHERE chat_id=?").bind(id).first();
 const total=await env.DB.prepare("SELECT COUNT(*) n FROM events WHERE chat_id=? AND ts>=?").bind(id,Math.floor(Date.now()/1000)-86400).first();
 const rows=await env.DB.prepare("SELECT action,COUNT(*) n FROM events WHERE chat_id=? GROUP BY action ORDER BY n DESC LIMIT 12").bind(id).all();
 const info=rows.results.map(x=>(actionLabel[x.action]||"▫️ "+label(x.action,35))+": "+x.n).join("\\n");
 await send(env,chat,["📊 Статистика · "+label(await groupName(env,id)),"","⚠️ Всего предупреждений: "+(count?.n||0),"🕘 Действий за сутки: "+(total?.n||0),"","По категориям:",info||"Пока нет событий"].join("\\n").replaceAll("\\n","\n"),{reply_markup:kb([[b("📜 Журнал","dm:logs:"+id)],[b("⬅️ Группа","dm:g:"+id)]])});
}
async function dmLogs(env,chat,id,send){
 const rows=await env.DB.prepare("SELECT action,thread_id,user_id,reason,ts FROM events WHERE chat_id=? ORDER BY id DESC LIMIT 15").bind(id).all();
 const events=await Promise.all(rows.results.map(async x=>{
  const when=new Date(x.ts*1000).toISOString().slice(5,16).replace("T"," · ")+" UTC";
  const name=x.user_id?personLabel(await person(env,id,x.user_id),x.user_id):"Система";
  const thread=await topicName(env,id,x.thread_id);
  return "• "+(actionLabel[x.action]||label(x.action))+"\n"+when+"\n👤 "+label(name,65)+"\n🗂 "+label(thread,65)+(x.reason?"\n↳ "+label(x.reason,125):"");
 }));
 await send(env,chat,"📜 Журнал · "+label(await groupName(env,id))+"\n\n"+(events.length?events.join("\n\n"):"Пока нет записей."),{reply_markup:kb([[b("🔄 Обновить","dm:logs:"+id)],[b("⬅️ Группа","dm:g:"+id)]])});
}
async function dmRights(env,chat,id,send){
 try{
  const bot=await fetch("https://api.telegram.org/bot"+env.BOT_TOKEN+"/getMe").then(r=>r.json());
  if(!bot.ok)throw Error(bot.description||"getMe failed");
  const raw=await fetch("https://api.telegram.org/bot"+env.BOT_TOKEN+"/getChatMember",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({chat_id:id,user_id:bot.result.id})}).then(r=>r.json());
  if(!raw.ok)throw Error(raw.description||"getChatMember failed");
  const p=raw.result;
  await send(env,chat,["🩺 Права бота", "Статус: "+p.status, "Удалять сообщения: "+(p.can_delete_messages?"✅":"❌"),"Ограничивать участников: "+(p.can_restrict_members?"✅":"❌"),"Управлять темами: "+(p.can_manage_topics?"✅":"❌"),"Чтобы бот удалял оффтоп, ему нужно право удалять сообщения."].join("\n"),{reply_markup:kb([[b("🔄 Проверить снова","dm:rights:"+id)],[b("⬅️ Группа","dm:g:"+id)]])});
 }catch(err){await send(env,chat,"Не удалось проверить права: "+label(err.message));}
}
async function dmUsers(env,chat,id,send){
 const r=await env.DB.prepare("SELECT w.user_id,w.count FROM warnings w WHERE w.chat_id=? AND w.count>0 ORDER BY w.updated DESC LIMIT 20").bind(id).all();
 const rows=await Promise.all(r.results.map(async x=>[b("👤 "+label(personLabel(await person(env,id,x.user_id),x.user_id),39)+" · ⚠️ "+x.count,"dm:user:"+id+":"+x.user_id)]));
 rows.push([b("🔎 Ввести ID участника","dm:find:"+id)],[b("⬅️ Группа","dm:g:"+id)]);
 await send(env,chat,"👥 Участники · "+label(await groupName(env,id))+"\n\nВыбери участника для просмотра нарушений.\nМуты выдаются только вручную.",{reply_markup:kb(rows)});
}
async function dmUser(env,chat,id,user,send){
 if(!/^\d{1,20}$/.test(String(user)))throw Error("Неверный Telegram ID");
 const r=await env.DB.prepare("SELECT count FROM warnings WHERE chat_id=? AND user_id=?").bind(id,user).first();
 const count=r?.count||0;
 const p=await person(env,id,user);
 await send(env,chat,"👤 "+personLabel(p,user,true)+"\n\n⚠️ Предупреждений: "+count+"\n\nВыбери действие администратора:",{reply_markup:kb([[b("➖ Снять 1 предупреждение","dm:clear:"+id+":"+user)],[b("🔇 Мут 1 час","dm:mute60:"+id+":"+user),b("🔇 24 часа","dm:mute1440:"+id+":"+user)],[b("🔊 Снять мут","dm:unmute:"+id+":"+user)],[b("⬅️ Участники","dm:users:"+id)]])});
}
async function dmPunish(env,q,action,id,user,send){
 if(!/^[-]\d+$/.test(id)||!/^\d{1,20}$/.test(user))throw Error("Неправильный ID");
 if(action==="clear"){
  await env.DB.prepare("UPDATE warnings SET count=CASE WHEN count>0 THEN count-1 ELSE 0 END,updated=? WHERE chat_id=? AND user_id=?").bind(Math.floor(Date.now()/1000),id,user).run();
  await env.DB.prepare("INSERT INTO events(chat_id,thread_id,user_id,action,reason,ts) VALUES(?,?,?,?,?,?)").bind(id,"",user,"warning_removed","Снято администратором "+q.from.id,Math.floor(Date.now()/1000)).run();
 }else{
  // Telegram requires can_restrict_members on the bot. Do not mute administrators.
  const check=await fetch("https://api.telegram.org/bot"+env.BOT_TOKEN+"/getChatMember",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({chat_id:id,user_id:user})}).then(r=>r.json());
  if(!check.ok)throw Error(check.description||"Пользователь не найден");
  if(["administrator","creator"].includes(check.result.status))throw Error("Нельзя ограничивать администратора");
  const duration=action==="mute60"?3600:action==="mute1440"?86400:0;
  const data={chat_id:id,user_id:user,permissions:{can_send_messages:duration===0,can_send_audios:duration===0,can_send_documents:duration===0,can_send_photos:duration===0,can_send_videos:duration===0,can_send_video_notes:duration===0,can_send_voice_notes:duration===0,can_send_polls:duration===0,can_send_other_messages:duration===0,can_add_web_page_previews:duration===0,can_invite_users:duration===0},use_independent_chat_permissions:true};
  if(duration)data.until_date=Math.floor(Date.now()/1000)+duration;
  const res=await fetch("https://api.telegram.org/bot"+env.BOT_TOKEN+"/restrictChatMember",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(data)}).then(r=>r.json());
  if(!res.ok)throw Error(res.description||"Не удалось изменить ограничение");
  await env.DB.prepare("INSERT INTO events(chat_id,thread_id,user_id,action,reason,ts) VALUES(?,?,?,?,?,?)").bind(id,"",user,action,"Администратор "+q.from.id,Math.floor(Date.now()/1000)).run();
 }
 await dmUser(env,q.message.chat.id,id,user,send);
}
export async function dmCallback(env,q,send,ack){
 if(q.message?.chat?.type!=="private"||!q.data?.startsWith("dm:"))return false;
 const [_,action,id,t,k]=q.data.split(":");
 const originalSend=send;
 const panelSend=async(e,chat,text,opts={})=>{
  // Navigate by replacing the same message instead of flooding the chat.
  const out={chat_id:chat,message_id:q.message.message_id,text,...opts};
  try{const x=await fetch("https://api.telegram.org/bot"+e.BOT_TOKEN+"/editMessageText",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(out)}).then(r=>r.json());if(!x.ok&&!String(x.description).includes("message is not modified"))throw Error(x.description);return x.result;}catch(err){console.error("panel edit",String(err));return originalSend(e,chat,text,opts);}
 };
 try{
  send=panelSend;
  if(action==="home")await dmHome(env,q.message.chat.id,send);
  else if(action==="g")await dmGroup(env,q.message.chat.id,id,send);
  else if(action==="t")await dmTopics(env,q.message.chat.id,id,send);
  else if(action==="k")await dmKinds(env,q.message.chat.id,id,t,send);
  else if(action==="s")await dmSettings(env,q.message.chat.id,id,send);
  else if(action==="stats")await dmStats(env,q.message.chat.id,id,send);
  else if(action==="logs")await dmLogs(env,q.message.chat.id,id,send);
  else if(action==="rights")await dmRights(env,q.message.chat.id,id,send);
  else if(action==="users")await dmUsers(env,q.message.chat.id,id,send);
  else if(action==="user")await dmUser(env,q.message.chat.id,id,t,send);
  else if(action==="find"){await env.DB.prepare("INSERT INTO settings(chat_id,key,value) VALUES(?,?,?) ON CONFLICT(chat_id,key) DO UPDATE SET value=excluded.value").bind(String(q.from.id),"dm_pending",JSON.stringify({action:"find",id})).run();await send(env,q.message.chat.id,"Отправь Telegram ID участника (только цифры). Для отмены /cancel");}
  else if(["clear","mute60","mute1440","unmute"].includes(action))await dmPunish(env,q,action,id,t,send);
  else if(action==="a"){
   if(!Object.hasOwn(LABELS,k)&&k!=="none")throw Error("Неизвестный тип");
   if(k==="none")await env.DB.prepare("DELETE FROM topics WHERE chat_id=? AND thread_id=?").bind(id,t).run();
   else await env.DB.prepare("INSERT INTO topics(chat_id,thread_id,kind) VALUES(?,?,?) ON CONFLICT(chat_id,thread_id) DO UPDATE SET kind=excluded.kind").bind(id,t,k).run();
   await dmTopics(env,q.message.chat.id,id,send);
  }else if(action==="toggle"){
   if(![...settings.map(x=>x[0]),"topic_action","spam_action"].includes(t))throw Error("Неизвестная настройка");
   const previous=await env.DB.prepare("SELECT value FROM settings WHERE chat_id=? AND key=?").bind(id,t).first();
   const old=previous?.value??(t==="spam_action"?"warn":t==="topic_action"?"delete":t==="auto_punish"?"off":"on");
   const next=t==="spam_action"?(old==="warn"?"delete":"warn"):t==="topic_action"?(old==="delete"?"warn":"delete"):(old==="on"?"off":"on");
   await env.DB.prepare("INSERT INTO settings(chat_id,key,value) VALUES(?,?,?) ON CONFLICT(chat_id,key) DO UPDATE SET value=excluded.value").bind(id,t,next).run();
   await dmSettings(env,q.message.chat.id,id,send);
  }else if(action==="new"||action==="rename"){
   await env.DB.prepare("INSERT INTO settings(chat_id,key,value) VALUES(?,?,?) ON CONFLICT(chat_id,key) DO UPDATE SET value=excluded.value").bind(String(q.from.id),"dm_pending",JSON.stringify({action,id,thread:t})).run();
   await send(env,q.message.chat.id,action==="new"?"Отправь ID темы и название через пробел, например: 9 Баги":"Отправь новое название ветки #"+t);
  }
 }catch(err){console.error("DM panel",String(err));await send(env,q.message.chat.id,"⚠️ "+label(err.message));}
 finally{await ack(env,q.id);}
 return true;
}
export async function dmText(env,m,send){
 if(m.chat.type!=="private")return false;
 const id=String(m.from.id);
 const state=await env.DB.prepare("SELECT value FROM settings WHERE chat_id=? AND key='dm_pending'").bind(id).first();
 if(!state)return false;
 const v=JSON.parse(state.value),text=String(m.text||"").trim();
 if(text.startsWith("/cancel")){await env.DB.prepare("DELETE FROM settings WHERE chat_id=? AND key='dm_pending'").bind(id).run();await send(env,m.chat.id,"Отменено");return true;}
 if(v.action==="find"){
  if(!/^\d{1,20}$/.test(text)){await send(env,m.chat.id,"Нужен числовой Telegram ID. /cancel для отмены.");return true;}
  await env.DB.prepare("DELETE FROM settings WHERE chat_id=? AND key='dm_pending'").bind(id).run();
  await dmUser(env,m.chat.id,v.id,text,send);return true;
 }
 let thread=v.thread, title=text;
 if(v.action==="new"){
  const match=text.match(/^(\d+)\s+(.{1,90})$/s);
  if(!match){await send(env,m.chat.id,"Укажи номер и название, например: 9 Баги. Для отмены /cancel");return true;}
  thread=match[1];title=match[2];
 }
 if(!title||title.length>90){await send(env,m.chat.id,"Название должно быть длиной 1–90 символов");return true;}
 await env.DB.prepare("INSERT INTO settings(chat_id,key,value) VALUES(?,?,?) ON CONFLICT(chat_id,key) DO UPDATE SET value=excluded.value").bind(v.id,"topic:"+thread,label(title,90)).run();
 await env.DB.prepare("DELETE FROM settings WHERE chat_id=? AND key='dm_pending'").bind(id).run();
 await send(env,m.chat.id,"✅ Ветка #"+thread+": "+label(title));
 await dmTopics(env,m.chat.id,v.id,send);
 return true;
}
