export async function registerAppeal(e,chat,messageId,user,thread,reason,counted=true){
 const value=JSON.stringify({user:String(user),thread:String(thread||""),reason:String(reason||"").slice(0,150),counted,status:"eligible",created:Date.now()});
 await e.DB.prepare("INSERT OR IGNORE INTO settings(chat_id,key,value) VALUES(?,?,?)").bind(String(chat),"appeal:"+messageId,value).run();
}
export async function requestAppeal(e,q){
 const match=/^appeal:([-]\d+):(\d+)$/.exec(q.data||"");
 if(!match)return false;
 const [,chat,msg]=match;
 if(String(q.message?.chat?.id)!==chat)return {error:"Неизвестный чат"};
 const key="appeal:"+msg;
 const old=await e.DB.prepare("SELECT value FROM settings WHERE chat_id=? AND key=?").bind(chat,key).first();
 if(!old)return {error:"Предупреждение не найдено"};
 let obj;try{obj=JSON.parse(old.value);}catch{return {error:"Данные повреждены"}}
 if(String(q.from.id)!==String(obj.user))return {error:"Подать апелляцию может только получатель предупреждения"};
 if(obj.status==="pending")return {error:"Апелляция уже отправлена"};
 if(obj.status!=="eligible")return {error:"По этому предупреждению решение уже принято"};
 const next=JSON.stringify({...obj,status:"pending",submitted:Date.now()});
 const done=await e.DB.prepare("UPDATE settings SET value=? WHERE chat_id=? AND key=? AND value=?").bind(next,chat,key,old.value).run();
 if(!done.meta?.changes)return {error:"Апелляция уже обрабатывается"};
 await e.DB.prepare("INSERT INTO events(chat_id,thread_id,user_id,action,reason,ts) VALUES(?,?,?,?,?,?)").bind(chat,obj.thread,obj.user,"appeal_opened",obj.reason,Math.floor(Date.now()/1000)).run();
 return {ok:true};
}
export async function appeals(e,chat){
 const r=await e.DB.prepare("SELECT key,value FROM settings WHERE chat_id=? AND key LIKE 'appeal:%' ORDER BY key DESC LIMIT 100").bind(String(chat)).all();
 return r.results.flatMap(x=>{try{const o=JSON.parse(x.value);return o.status==="pending"?[{id:x.key.slice(7),...o}]:[]}catch{return []}});
}
export async function decide(e,chat,id,decision,admin){
 if(!/^\d{1,12}$/.test(String(id))||!["approve","reject"].includes(decision))throw Error("Некорректное решение");
 const key="appeal:"+id;
 const old=await e.DB.prepare("SELECT value FROM settings WHERE chat_id=? AND key=?").bind(String(chat),key).first();
 if(!old)throw Error("Апелляция не найдена");
 const item=JSON.parse(old.value);
 if(item.status!=="pending")throw Error("Апелляция уже рассмотрена");
 const next=JSON.stringify({...item,status:decision==="approve"?"approved":"rejected",decidedBy:String(admin),decided:Date.now()});
 const changed=await e.DB.prepare("UPDATE settings SET value=? WHERE chat_id=? AND key=? AND value=?").bind(next,String(chat),key,old.value).run();
 if(!changed.meta?.changes)throw Error("Решение уже принято");
 if(decision==="approve"&&item.counted!==false){
  await e.DB.prepare("UPDATE warnings SET count=MAX(0,count-1),updated=? WHERE chat_id=? AND user_id=?").bind(Math.floor(Date.now()/1000),String(chat),item.user).run();
 }
 await e.DB.prepare("INSERT INTO events(chat_id,thread_id,user_id,action,reason,ts) VALUES(?,?,?,?,?,?)").bind(String(chat),item.thread,item.user,decision==="approve"?"appeal_approved":"appeal_rejected","Рассмотрено администратором "+admin,Math.floor(Date.now()/1000)).run();
 return item;
}
