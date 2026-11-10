import {listRecords,ticketKey} from "./workflows.js";
const ts=()=>Math.floor(Date.now()/1000);
const norm=s=>String(s||"").toLowerCase().replace(/ё/g,"е").replace(/(?:test|beta|public)\s*\d+(?:\.\d+)*/gi," ").replace(/android\s*\d+(?:\.\d+)?/gi," ").replace(/[^\p{L}\p{N} ]/gu," ").replace(/\s+/g," ").trim();
const common=new Set(["qvk","приложение","работает","версия","тест","ошибка","после","когда","просто","очень","снова","android","почему","меня","есть","только"]);
export function similarity(a,b){
 const words=s=>new Set(norm(s).split(" ").filter(x=>x.length>=4&&!common.has(x)));
 const x=words(a),y=words(b),overlap=[...x].filter(w=>y.has(w)).length;
 return !x.size||!y.size?0:overlap/Math.max(1,new Set([...x,...y]).size);
}
export function duplicateSuggestions(records,target,threshold=0.36){
 if(target.type!=="bug")return [];
 return records.filter(r=>r.type==="bug"&&(r.id!==target.id||r.chat!==target.chat))
  .map(r=>({chat:r.chat,id:r.id,description:r.description,score:similarity(target.description,r.description)}))
  .filter(r=>r.score>=threshold).sort((a,b)=>b.score-a.score).slice(0,5);
}
export async function boardUpdate(e,chat,id,patch,admin){
 const key=ticketKey(chat,id);
 const row=await e.DB.prepare("SELECT value FROM settings WHERE chat_id='_cases' AND key=?").bind(key).first();
 if(!row)throw Error("Запись не найдена");
 const x=JSON.parse(row.value);if(String(x.chat)!==String(chat))throw Error("Неверная группа");
 const status=patch.status===undefined?x.status:String(patch.status);
 if(!["new","in_review","testing","resolved","closed"].includes(status))throw Error("Недопустимый этап");
 const priority=patch.priority===undefined?(x.priority||"normal"):String(patch.priority);
 if(!["low","normal","high","critical"].includes(priority))throw Error("Недопустимый приоритет");
 const confirmed=patch.confirmed===undefined?!!x.confirmed:patch.confirmed===true;
 const duplicateOf=patch.duplicateOf===undefined?(x.duplicateOf||""):String(patch.duplicateOf||"");
 if(duplicateOf&&!/^[-]?\d+:\d+$/.test(duplicateOf))throw Error("Неверный ID связанного бага");
 if(duplicateOf===String(chat)+":"+id)throw Error("Нельзя объединить с собой");
 const changed={...x,status,priority,confirmed,duplicateOf,updated:ts(),reviewedBy:String(admin)};
 const done=await e.DB.prepare("UPDATE settings SET value=? WHERE chat_id='_cases' AND key=? AND value=?").bind(JSON.stringify(changed),key,row.value).run();
 if(!done.meta?.changes)throw Error("Запись уже изменена, обнови данные");
 await e.DB.prepare("INSERT INTO events(chat_id,thread_id,user_id,action,reason,ts) VALUES(?,?,?,?,?,?)").bind(String(chat),x.thread||"",x.user||"","board_updated",status+" · "+priority+(confirmed?" · подтвержден":"")+" · "+admin,ts()).run();
 return changed;
}
export function testerRanking(records,chat){
 const counts=new Map();
 for(const x of records)if(x.type==="bug"&&x.confirmed&&(!chat||String(x.chat)===String(chat))&&!x.duplicateOf){
  const id=String(x.user);counts.set(id,(counts.get(id)||0)+1);
 }
 return [...counts].map(([user,confirmedBugs])=>({user,confirmedBugs})).sort((a,b)=>b.confirmedBugs-a.confirmedBugs).slice(0,30);
}
export function faqCandidates(records,kb){
 const existing=new Set((kb.articles||[]).flatMap(a=>(a.triggers||[]).map(norm)));
 return records.filter(x=>!["closed","resolved"].includes(x.status)&&x.description&&x.description.length>=15)
  .filter(x=>!existing.has(norm(x.description)))
  .map(x=>({chat:x.chat,id:x.id,question:x.description.slice(0,210),source:"ticket",status:"proposal"})).slice(0,35);
}
export function weeklySummary(aggregate,records,time=ts()){
 const since=time-7*86400;
 const fresh=records.filter(x=>Number(x.created||0)>=since);
 return {start:since,end:time,chats:aggregate,created:fresh.length,bugs:fresh.filter(x=>x.type==="bug").length,resolved:records.filter(x=>Number(x.updated||0)>=since&&["resolved","closed"].includes(x.status)).length};
}
