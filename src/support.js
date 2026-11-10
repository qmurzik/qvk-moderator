// QVK support assistant: replies only on explicit /qvk requests.
// Reads the owner's structured support articles from QVK_KB binding if configured.
// No moderation or ticket privileges are inferred from the FAQ.
const normalize=t=>String(t||"").toLowerCase().replace(/ё/g,"е").replace(/[^\p{L}\p{N} ]/gu," ").replace(/\s+/g," ").trim();
const fallback={answer:"Уточни, пожалуйста, что именно не работает и в каком разделе QVK. Не нужно сбрасывать данные или выходить из аккаунта.",clarifying_question:"Что ожидалось и что произошло вместо этого?",steps:[]};
export function selectArticle(articles,query,isAdmin=false){
 const q=normalize(query);
 if(!q||q.length<5)return null;
 const tokens=q.split(" ").filter(t=>t.length>3);
 const ranked=articles.filter(x=>x.status!=="admin_only"||isAdmin).map(x=>{
  const triggers=(x.triggers||[]).map(normalize);
  const exact=triggers.filter(t=>t.length>3&&q.includes(t)).reduce((n,t)=>n+Math.min(12,t.length),0);
  const hits=triggers.reduce((n,t)=>n+t.split(" ").filter(w=>w.length>4&&tokens.includes(w)).length,0);
  const score=exact*2+hits-(x.id==="unknown"?1000:0);
  return {x,score};
 }).sort((a,b)=>b.score-a.score);
 if((ranked[0]?.score||0)<7)return null;
 return ranked[0].x;
}
export function compose(article,previous="",maxSteps=3){
 const a=article||fallback;

 const seen=new Set(String(previous||"").split("|").filter(Boolean));
 const choices=(a.steps||[]).filter(step=>seen.size? !seen.has(step):true).filter(step=>{
  const words=normalize(step).split(" ").filter(w=>w.length>5);
  return words.length>0;
 }).slice(0,maxSteps);
 const head=String(a.answer||fallback.answer).slice(0,430);
 const parts=[head,...choices.map((s,i)=>(i+1)+". "+s)];
 if(!choices.length&&previous)parts.push("Если безопасные шаги уже проверены, лучше составить краткий отчёт: версия QVK, Android, симптом, текст ошибки и что пробовал.");
 if(a.clarifying_question)parts.push(a.clarifying_question);
 return parts.join("\n\n").slice(0,950);
}
export async function supportMessage(e,m,query,isAdmin,send){
 const row=await e.DB.prepare("SELECT value FROM settings WHERE chat_id=? AND key=?").bind("_registry","support_kb").first();
 const raw=row?.value;
 if(!raw){await send(e,m.chat.id,"База знаний пока не загружена владельцем.",{message_thread_id:m.message_thread_id});return true;}
 let kb;try{kb=JSON.parse(raw)}catch{return false;}
 const c=String(m.chat.id),u=String(m.from?.id||""),key="support:"+u;
 const previous=await e.DB.prepare("SELECT value FROM settings WHERE chat_id=? AND key=?").bind(c,key).first();
 let state;try{state=JSON.parse(previous?.value||"{}")}catch{state={}}
 const chosen=selectArticle(kb.articles||[],query,isAdmin);
 if(!chosen){await send(e,c,compose(null,""),{message_thread_id:m.message_thread_id});return true;}
 const repeated=state.id===chosen.id&&Date.now()-Number(state.time||0)<300000;
 if(repeated&&state.query===normalize(query))return true;
 const prevText=repeated?state.steps||"":"";
 const answer=compose(chosen,prevText);
 await send(e,c,answer,{message_thread_id:m.message_thread_id});
 await e.DB.prepare("INSERT INTO settings(chat_id,key,value) VALUES(?,?,?) ON CONFLICT(chat_id,key) DO UPDATE SET value=excluded.value").bind(c,key,JSON.stringify({id:chosen.id,query:normalize(query),steps:[...new Set([...String(prevText).split("|").filter(Boolean),...(chosen.steps||[]).slice(0,3)])].join("|").slice(-1000),time:Date.now()})).run();
 return true;
}

export function matchAutomatic(articles,query){
 const text=normalize(query);
 if(text.length<13||text.length>1200||!/[а-яa-z]/i.test(text))return null;
 const tokens=text.split(" ").filter(w=>w.length>3);
 if(text.split(" ").filter(Boolean).length<3)return null;
 const candidates=articles.filter(x=>x.status!=="admin_only").flatMap(x=>{
  const phrases=(x.triggers||[]).map(normalize).filter(t=>t.length>=11&&t.split(" ").length>=2);
  const phrase=phrases.filter(t=>text.includes(t)).sort((a,b)=>b.length-a.length)[0];
  if(!phrase)return [];
  const keys=phrase.split(" ").filter(w=>w.length>3);
  const coverage=keys.filter(w=>tokens.includes(w)).length;
  return (coverage>=2||(phrase.split(" ").length>=3&&coverage>=1))?[{article:x,score:phrase.length+coverage*5}]:[];
 }).sort((a,b)=>b.score-a.score);
 if(!candidates.length)return null;
 if(candidates.length>1&&candidates[0].score-candidates[1].score<8&&candidates[0].article.id!==candidates[1].article.id)return null;
 return candidates[0].article;
}
export async function autoSupport(e,m,send){
 if(!m.from||m.from.is_bot||m.sender_chat||!["group","supergroup"].includes(m.chat?.type))return false;
 const c=String(m.chat.id);
 const enabled=await e.DB.prepare("SELECT value FROM settings WHERE chat_id=? AND key='support_auto'").bind(c).first();
 if(enabled?.value==="off")return false;
 const body=String(m.text||"").trim();
 if(body.startsWith("/")||body.length<13||m.reply_to_message?.from?.is_bot)return false;
 const row=await e.DB.prepare("SELECT value FROM settings WHERE chat_id='_registry' AND key='support_kb'").first();
 if(!row?.value)return false;
 let kb;try{kb=JSON.parse(row.value)}catch{return false}
 const chosen=matchAutomatic(kb.articles||[],body);
 if(!chosen)return false;
 const now=Math.floor(Date.now()/1000),u=String(m.from.id),thread=String(m.message_thread_id||"");
 // One response per user/issue/thread per 24h; per chat at most one every 90s.
 const userKey="faq:"+u+":"+thread+":"+chosen.id+":"+Math.floor(now/86400);
 const groupKey="faqrate:"+Math.floor(now/90);
 const busy=await e.DB.prepare("SELECT key FROM processed WHERE chat_id=? AND (key=? OR key=?) LIMIT 1").bind(c,userKey,groupKey).first();
 if(busy)return false;
 const claimed=await e.DB.prepare("INSERT OR IGNORE INTO processed(chat_id,key,ts) VALUES(?,?,?)").bind(c,groupKey,now).run();
 if(!claimed.meta?.changes)return false;
 await e.DB.prepare("INSERT OR IGNORE INTO processed(chat_id,key,ts) VALUES(?,?,?)").bind(c,userKey,now).run();
 const memoryKey="support:"+u;
 const previous=await e.DB.prepare("SELECT value FROM settings WHERE chat_id=? AND key=?").bind(c,memoryKey).first();
 let state={};try{state=JSON.parse(previous?.value||"{}")}catch{}
 const recent=state.id===chosen.id&&Date.now()-Number(state.time||0)<7*86400000;
 const answer=compose(chosen,recent?state.steps||"":"");
 try{
  await send(e,c,"💜 QVK Помощник\n"+answer,{message_thread_id:m.message_thread_id,reply_parameters:{message_id:m.message_id,allow_sending_without_reply:true}});
  await e.DB.prepare("INSERT INTO settings(chat_id,key,value) VALUES(?,?,?) ON CONFLICT(chat_id,key) DO UPDATE SET value=excluded.value").bind(c,memoryKey,JSON.stringify({id:chosen.id,query:normalize(body),steps:[...new Set([...(recent?String(state.steps||"").split("|").filter(Boolean):[]),...(chosen.steps||[]).slice(0,3)])].join("|").slice(-1000),time:Date.now()})).run();
  await e.DB.prepare("INSERT INTO events(chat_id,thread_id,user_id,action,reason,ts) VALUES(?,?,?,?,?,?)").bind(c,thread,u,"faq_answered",chosen.id,now).run();
  return true;
 }catch(err){console.error("Automatic FAQ",String(err));return false}
}
