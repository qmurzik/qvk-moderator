const now=()=>Math.floor(Date.now()/1000);
const id=x=>String(x??"");
const validChat=x=>/^-?\d{5,20}$/.test(x);
const validUser=x=>/^[1-9]\d{2,19}$/.test(x);
const hex=arr=>[...arr].map(x=>x.toString(16).padStart(2,"0")).join("");
export function canonical(a){return [a.timestamp,a.nonce,a.chat,a.user,a.message_id,a.moderator,a.action,a.duration,a.reason].map(String).join("\n")}
export async function verifySignature(secret,a,signature){
 const key=await crypto.subtle.importKey("raw",new TextEncoder().encode(secret),{name:"HMAC",hash:"SHA-256"},false,["sign"]);
 const expected=hex(new Uint8Array(await crypto.subtle.sign("HMAC",key,new TextEncoder().encode(canonical(a)))));
 const actual=String(signature||"");
 let diff=expected.length^actual.length;for(let i=0;i<expected.length;i++)diff|=expected.charCodeAt(i)^(actual.charCodeAt(i)||0);
 return diff===0;
}
const respond=(error,status)=>Response.json({error},{status});
export async function pluginAction(req,e,telegram){
 if(!e.QVK_PLUGIN_SECRET||String(e.QVK_PLUGIN_SECRET).length<24)return respond("Секрет не настроен",503);
 let b;try{b=await req.json()}catch{return respond("Неверный JSON",400)}
 const a={timestamp:id(req.headers.get("x-qvk-timestamp")),nonce:id(req.headers.get("x-qvk-nonce")),chat:id(b.chat),user:id(b.user),message_id:id(b.message_id),moderator:id(b.moderator),action:id(b.action),duration:id(b.duration||0),reason:id(b.reason||"").trim()};
 if(!validChat(a.chat)||!validUser(a.user)||!validUser(a.moderator)||!Number.isSafeInteger(Number(a.message_id))||Number(a.message_id)<1||!["warn","mute","delete","history"].includes(a.action)||!Number.isSafeInteger(Number(a.timestamp))||Math.abs(now()-Number(a.timestamp))>90||!/^[-_a-f0-9]{16,80}$/i.test(a.nonce))return respond("Недопустимые параметры",400);
 if(!await verifySignature(String(e.QVK_PLUGIN_SECRET),a,req.headers.get("x-qvk-signature")))return respond("Недействительная подпись",403);
 const admins=new Set(id(e.ADMIN_IDS).split(",").map(x=>x.trim()));
 if(!admins.has(a.moderator))return respond("Модератор отсутствует в ADMIN_IDS",403);
 const group=await e.DB.prepare("SELECT value FROM settings WHERE chat_id='_registry' AND key=?").bind("chat:"+a.chat).first();
 if(!group)return respond("Чат не зарегистрирован",403);
 const enabled=await e.DB.prepare("SELECT value FROM settings WHERE chat_id=? AND key='plugin_actions'").bind(a.chat).first();
 if(enabled?.value!=="on")return respond("Ручная модерация Exteragram отключена для чата",403);
 if(a.action!=="history"&&(a.reason.length<5||a.reason.length>180))return respond("Укажи причину от 5 до 180 символов",400);
 if(a.action==="mute"&&![600,3600,86400].includes(Number(a.duration)))return respond("Недопустимая длительность мута",400);
 try{
  const member=await telegram(e,"getChatMember",{chat_id:a.chat,user_id:a.moderator});
  if(!["creator","administrator"].includes(member.status))return respond("У аккаунта нет прав администратора в этом чате",403);
  if(a.action==="history"){
   const w=await e.DB.prepare("SELECT count FROM warnings WHERE chat_id=? AND user_id=?").bind(a.chat,a.user).first();
   const events=await e.DB.prepare("SELECT action,reason,ts FROM events WHERE chat_id=? AND user_id=? ORDER BY id DESC LIMIT 15").bind(a.chat,a.user).all();
   return Response.json({ok:true,warnings:Number(w?.count||0),events:events.results});
  }
  const nonce=await e.DB.prepare("INSERT OR IGNORE INTO processed(chat_id,key,ts) VALUES(?,?,?)").bind("_plugin","action:"+a.nonce,now()).run();
  if(!nonce.meta?.changes)return respond("Повторный запрос",409);
  const target=await telegram(e,"getChatMember",{chat_id:a.chat,user_id:a.user});
  if(["creator","administrator"].includes(target.status))return respond("Действия над администраторами запрещены",403);
  if(a.action==="warn"){
   await telegram(e,"sendMessage",{chat_id:a.chat,text:"⚠️ Официальное предупреждение QVK\nУчастник: ID "+a.user+"\nПричина: "+a.reason+"\nПожалуйста, соблюдай правила чата 💜",reply_parameters:{message_id:Number(a.message_id),allow_sending_without_reply:false}});
   await e.DB.prepare("INSERT INTO warnings(chat_id,user_id,count,updated) VALUES(?,?,1,?) ON CONFLICT(chat_id,user_id) DO UPDATE SET count=count+1,updated=excluded.updated").bind(a.chat,a.user,now()).run();
  }else if(a.action==="mute"){
   await telegram(e,"restrictChatMember",{chat_id:a.chat,user_id:Number(a.user),permissions:{can_send_messages:false,can_send_audios:false,can_send_documents:false,can_send_photos:false,can_send_videos:false,can_send_video_notes:false,can_send_voice_notes:false,can_send_polls:false,can_send_other_messages:false,can_add_web_page_previews:false},until_date:now()+Number(a.duration)});
  }else{
   await telegram(e,"deleteMessage",{chat_id:a.chat,message_id:Number(a.message_id)});
  }
  await e.DB.prepare("INSERT INTO events(chat_id,thread_id,user_id,action,reason,ts) VALUES(?,?,?,?,?,?)").bind(a.chat,"",a.user,"plugin_"+a.action,a.reason+" | moderator "+a.moderator,now()).run();
  return Response.json({ok:true});
 }catch(err){console.error("Manual plugin action",String(err));return respond("Не удалось выполнить действие: проверь права бота и сообщение",502)}
}
