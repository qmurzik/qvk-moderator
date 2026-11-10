// Deterministic moderation helpers. No external services and no user-generated regex.
export function extractHosts(text=""){
 const urls=String(text).match(/(?:https?:\/\/|www\.)[^\s<>\[\]()]+/gi)||[];
 return urls.map(raw=>{try{const host=new URL(raw.startsWith("www.")?"https://"+raw:raw).hostname.toLowerCase();return host.replace(/^www\./,"");}catch{return "";}}).filter(Boolean);
}
export function linkRisk(text="",entities=[]){
 const hosts=extractHosts(text);
 // Telegram links with no protocol can arrive as text_link entities.
 for(const e of entities)if(e.type==="text_link"&&e.url)hosts.push(...extractHosts(e.url));
 const dangerous=hosts.filter(h=>/(^|\.)(?:bit\.ly|tinyurl\.com|t\.co|cutt\.ly|grabify\.link|iplogger\.org|iplogger\.com)$/.test(h));
 const many=hosts.length>=4;
 return {risky:dangerous.length>0||many,reason:dangerous.length?"Ссылка-сокращатель или трекер (требует проверки)":many?"Слишком много ссылок в одном сообщении":"",hosts};
}
export function normalized(text=""){return String(text).toLocaleLowerCase("ru").replace(/https?:\/\//g,"").replace(/[^\p{L}\p{N}]+/gu," ").trim().slice(0,350);}
export function fastHash(text){
 let x=2166136261;for(const c of text){x^=c.charCodeAt(0);x=Math.imul(x,16777619);}return (x>>>0).toString(36);
}
export function evaluateFlood(count,duplicates){
 if(duplicates>=3)return "Повтор одного сообщения трижды за две минуты";
 if(count>=7)return "Слишком много сообщений за 20 секунд";
 return "";
}
