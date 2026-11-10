export const ROLES={
 founder:{name:"👑 Основатель QVK",tag:"FOUNDER"},
 testers:{
  rookie:{name:"🧪 Новобранец",tag:"ROOKIE",min:-99999},
  scout:{name:"🔍 Охотник за багами",tag:"BUG HUNTER",min:5},
  elite:{name:"⚡ QA-специалист",tag:"QA ELITE",min:20},
  legend:{name:"💎 Легенда тестирования",tag:"QA LEGEND",min:50},
  curator:{name:"🎖 Куратор тестирования",tag:"CURATOR",manual:true}
 },
 users:{
  member:{name:"💜 Участник",tag:"MEMBER",min:-99999},
  active:{name:"✨ Активист",tag:"ACTIVE",min:5},
  veteran:{name:"🌟 Ветеран QVK",tag:"VETERAN",min:20},
  icon:{name:"💎 Легенда сообщества",tag:"ICON",min:50},
  vip:{name:"🎀 VIP сообщества",tag:"VIP",manual:true}
 }
};
const owner=(e,id)=>String(e.REPUTATION_OWNER_ID||"")!==""&&String(e.REPUTATION_OWNER_ID)===String(id);
export function validRole(mode,key){return !!ROLES[mode]?.[key];}
export function automaticRole(mode,score){
 const entries=Object.entries(ROLES[mode]||{}).filter(([,value])=>!value.manual&&Number(score)>=value.min);
 return entries.length?entries[entries.length-1][0]:"member";
}
export async function roleFor(e,chat,id,mode,score){
 if(owner(e,id))return {key:"founder",...ROLES.founder,source:"owner"};
 const row=await e.DB.prepare("SELECT value FROM settings WHERE chat_id=? AND key=?").bind(String(chat),"role:"+String(id)).first();
 if(row?.value&&validRole(mode,row.value))return {key:row.value,...ROLES[mode][row.value],source:"manual"};
 const key=automaticRole(mode,score);return {key,...(ROLES[mode]?.[key]||ROLES.users.member),source:"reputation"};
}
export async function assignRole(e,chat,actor,target,mode,key){
 if(!owner(e,actor))throw Error("Роли вручную назначает только основатель QVK");
 if(owner(e,target))throw Error("Роль основателя нельзя изменить");
 if(key!=="auto"&&!validRole(mode,key))throw Error("Неизвестная роль для этой группы");
 const k="role:"+String(target);
 if(key==="auto")await e.DB.prepare("DELETE FROM settings WHERE chat_id=? AND key=?").bind(String(chat),k).run();
 else await e.DB.prepare("INSERT INTO settings(chat_id,key,value) VALUES(?,?,?) ON CONFLICT(chat_id,key) DO UPDATE SET value=excluded.value").bind(String(chat),k,key).run();
 return key;
}
export function roleOptions(mode){return Object.entries(ROLES[mode]||{}).map(([k,v])=>k+" — "+v.name).join("\n");}
