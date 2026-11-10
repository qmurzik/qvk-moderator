// Display metadata is sourced from Telegram updates; older users may not have a cached name yet.
const clean=(v,n=80)=>String(v??"").replace(/[\r\n\t]/g," ").trim().slice(0,n);
export const displayName=u=>clean([u?.first_name,u?.last_name].filter(Boolean).join(" "))|| (u?.username?"@"+clean(u.username,32):"");
export async function rememberUser(e,chat,u){
 if(!u?.id||!chat)return;
 const value={name:displayName(u),username:clean(u.username,32)};
 if(!value.name&&!value.username)return;
 await e.DB.prepare("INSERT INTO settings(chat_id,key,value) VALUES(?,?,?) ON CONFLICT(chat_id,key) DO UPDATE SET value=excluded.value").bind(String(chat),"user:"+u.id,JSON.stringify(value)).run();
}
export async function person(e,chat,id){
 const row=await e.DB.prepare("SELECT value FROM settings WHERE chat_id=? AND key=?").bind(String(chat),"user:"+id).first();
 if(row?.value){try{const x=JSON.parse(row.value);if(x.name||x.username)return x;}catch{}}
 // Telegram cannot list arbitrary users; getChatMember can resolve current members when permitted.
 try{
  const r=await fetch("https://api.telegram.org/bot"+e.BOT_TOKEN+"/getChatMember",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({chat_id:chat,user_id:id})}).then(r=>r.json());
  if(r.ok&&r.result?.user){const u=r.result.user;await rememberUser(e,chat,u);return {name:displayName(u),username:clean(u.username,32)};}
 }catch(err){console.error("User lookup",String(err));}
 return {name:"Участник",username:""};
}
export const personLabel=(p,id,withId=false)=>(p?.name||"Участник")+(p?.username&&("@"+p.username)!==p.name?" · @"+p.username:"")+(withId?"\nID: "+id:"");
export const actionLabel={offtopic_deleted:"🗑 Удалён оффтоп",offtopic_warned:"⚠️ Оффтоп: предупреждение",warning:"⚠️ Предупреждение",spam_warning:"🛡 Предупреждение о спаме",spam_deleted:"🗑 Удалён спам",join_service_deleted:"🧹 Убрано системное сообщение",warning_removed:"✅ Предупреждение снято",mute60:"🔇 Мут на 1 час",mute1440:"🔇 Мут на 24 часа",unmute:"🔊 Мут снят"};
