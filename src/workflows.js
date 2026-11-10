const clean=(x,max=1000)=>String(x??"").replace(/[\u0000-\u001f]/g," ").trim().slice(0,max);
const now=()=>Math.floor(Date.now()/1000);
export const parseBug=text=>{
 const s=clean(text,900);
 const version=s.match(/\b(?:test|public|beta)\s*\d+(?:\.\d+)*/i)?.[0]||"";
 const android=s.match(/android\s*\d+(?:\.\d+)?/i)?.[0]||"";
 return {description:s,version,android};
};
export function ticketKey(chat,id){return "ticket:"+String(chat)+":"+String(id);}
export async function createRecord(env,msg,type,description){
 const chat=String(msg.chat.id),id=String(msg.message_id),user=String(msg.from?.id||"");
 if(!user||!["ticket","bug"].includes(type))throw Error("Invalid record");
 const detail=type==="bug"?parseBug(description):{description:clean(description,900)};
 if(detail.description.length<12)throw Error("Описание должно содержать не менее 12 символов");
 const item={id,chat,user,thread:String(msg.message_thread_id||""),type,status:"new",created:now(),...detail};
 const key=ticketKey(chat,id);
 const result=await env.DB.prepare("INSERT OR IGNORE INTO settings(chat_id,key,value) VALUES(?,?,?)").bind("_cases",key,JSON.stringify(item)).run();
 return {...item,createdNew:!!result.meta?.changes};
}
export async function listRecords(env,chats,type="all",limit=80){
 const ids=[...new Set(chats.map(String))].slice(0,30);
 if(!ids.length)return [];
 const rows=await env.DB.prepare("SELECT key,value FROM settings WHERE chat_id='_cases' AND key LIKE 'ticket:%' ORDER BY rowid DESC LIMIT 350").all();
 return rows.results.flatMap(row=>{try{const x=JSON.parse(row.value);return ids.includes(String(x.chat))&&(type==="all"||type===x.type)?[x]:[]}catch{return []}}).sort((a,b)=>b.created-a.created).slice(0,limit);
}
export async function changeRecord(env,chat,id,next,admin){
 if(!["new","in_review","resolved","closed"].includes(next))throw Error("Неизвестный статус");
 const key=ticketKey(chat,id);
 const r=await env.DB.prepare("SELECT value FROM settings WHERE chat_id='_cases' AND key=?").bind(key).first();
 if(!r)throw Error("Обращение не найдено");
 const data=JSON.parse(r.value);
 if(String(data.chat)!==String(chat))throw Error("Неверная группа");
 if(data.status===next)return data;
 const changed={...data,status:next,reviewedBy:String(admin),updated:now()};
 const q=await env.DB.prepare("UPDATE settings SET value=? WHERE chat_id='_cases' AND key=? AND value=?").bind(JSON.stringify(changed),key,r.value).run();
 if(!q.meta?.changes)throw Error("Обращение уже изменено");
 await env.DB.prepare("INSERT INTO events(chat_id,thread_id,user_id,action,reason,ts) VALUES(?,?,?,?,?,?)").bind(String(chat),data.thread,data.user,"case_"+next,data.type+" #"+id,now()).run();
 return changed;
}
export function summarizeChats(rows,cases){
 return rows.map(x=>({chat:x.chat,title:x.title,messages:Number(x.messages||0),warnings:Number(x.warnings||0),faq:Number(x.faq||0),spam:Number(x.spam||0),openCases:cases.filter(c=>c.chat===String(x.chat)&&!["closed","resolved"].includes(c.status)).length,bugs:cases.filter(c=>c.chat===String(x.chat)&&c.type==="bug").length}));
}
