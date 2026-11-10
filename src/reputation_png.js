import {repLevel,escapeHtml} from "./reputation_cards.js";
export function cardHtml(mode,user,score,rank,avatar){
 const name=escapeHtml((user.name||user.username||"Участник").slice(0,55));
 const handle=user.username?"@"+escapeHtml(user.username.replace(/^@/,"")):"QVK";
 const [symbol,level]=repLevel(score);
 const roleTag=escapeHtml(user.role?.name||level);
 const pic=avatar?'<img class="avatar" src="'+avatar+'">':'<div class="avatar fallback">💜</div>';
 return '<!doctype html><html><meta charset="utf-8"><style>*{box-sizing:border-box}body{margin:0;width:960px;height:540px;font-family:Arial,sans-serif;color:#fff;background:linear-gradient(135deg,#170e2b,#58317d 65%,#302052)}.frame{position:absolute;inset:30px;border:2px solid #b994d4;border-radius:34px;padding:42px;background:#ffffff0b}.brand{font-size:36px;font-weight:900;letter-spacing:3px}.sub{font-size:18px;color:#dfc6f2;letter-spacing:3px;margin-top:6px}.user{display:flex;align-items:center;gap:24px;margin-top:46px}.avatar{width:124px;height:124px;object-fit:cover;border-radius:50%;border:4px solid #d4b0ff;background:#764a9a}.fallback{display:grid;place-items:center;font-size:54px}.name{font-size:40px;font-weight:800;max-width:620px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.handle{font-size:22px;color:#dac4ed;margin-top:8px}.bottom{display:flex;gap:55px;margin-top:42px}.label{font-size:17px;letter-spacing:2px;color:#d9c3e8}.value{font-size:50px;font-weight:900;margin-top:6px}.level{font-size:30px;font-weight:800;margin-top:12px}.rank{font-size:24px;margin-top:14px;color:#f6d7ff}.tag{margin-top:12px;display:inline-block;padding:8px 18px;border-radius:16px;background:#bb86fc44;border:1px solid #e2b8ff;font-size:19px;font-weight:800;color:#fceaff}</style><div class="frame"><div class="brand">QVK <span style="color:#d6a9ff">MODERATOR</span></div><div class="sub">'+(mode==="testers"?"🧪 TESTER REPUTATION":"💜 COMMUNITY REPUTATION")+'</div><div class="user">'+pic+'<div><div class="name">'+name+'</div><div class="handle">'+handle+'</div><div class="tag">'+roleTag+'</div></div></div><div class="bottom"><div><div class="label">РЕПУТАЦИЯ</div><div class="value">'+(score>0?"+":"")+score+'</div></div><div><div class="label">ЗВАНИЕ</div><div class="level">'+symbol+" "+escapeHtml(level)+'</div></div><div><div class="label">РЕЙТИНГ</div><div class="rank">'+(rank?"🏆 #"+rank:"QVK")+'</div></div></div></div></html>';
}
export async function avatarData(e,userId){
 try{const p=await fetch("https://api.telegram.org/bot"+e.BOT_TOKEN+"/getUserProfilePhotos",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({user_id:userId,limit:1})}).then(x=>x.json());const id=p.result?.photos?.[0]?.[0]?.file_id;if(!id)return null;const f=await fetch("https://api.telegram.org/bot"+e.BOT_TOKEN+"/getFile",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({file_id:id})}).then(x=>x.json());if(!f.result?.file_path)return null;const img=await fetch("https://api.telegram.org/file/bot"+e.BOT_TOKEN+"/"+f.result.file_path);if(!img.ok)return null;const b=new Uint8Array(await img.arrayBuffer());if(b.length>200000)return null;let str="";for(const byte of b)str+=String.fromCharCode(byte);return "data:image/jpeg;base64,"+btoa(str);}catch{return null}
}
export async function pngCard(e,mode,user,score,rank){
 if(!e.BROWSER)throw Error("Cloudflare Browser Rendering binding BROWSER не настроен");
 const puppeteer=(await import("@cloudflare/puppeteer")).default;
 const browser=await puppeteer.launch(e.BROWSER);
 try{const page=await browser.newPage();await page.setViewport({width:960,height:540,deviceScaleFactor:1});const avatar=await avatarData(e,user.id);await page.setContent(cardHtml(mode,user,score,rank,avatar),{waitUntil:"load"});return await page.screenshot({type:"png"});}finally{await browser.close()}
}
export async function sendPng(e,chat,mode,user,score,rank,opts={}){
 const bytes=await pngCard(e,mode,user,score,rank);
 const form=new FormData();form.set("chat_id",String(chat));form.set("photo",new Blob([bytes],{type:"image/png"}),"qvk-reputation.png");form.set("caption","🏆 "+(user.name||"Участник")+" · "+(score>0?"+":"")+score+" баллов");if(opts.message_thread_id)form.set("message_thread_id",String(opts.message_thread_id));if(opts.reply_markup)form.set("reply_markup",JSON.stringify(opts.reply_markup));
 const r=await fetch("https://api.telegram.org/bot"+e.BOT_TOKEN+"/sendPhoto",{method:"POST",body:form});const j=await r.json();if(!j.ok)throw Error("Telegram sendPhoto: "+j.description);return j.result;
}

export async function editPng(e,chat,messageId,mode,user,score,rank,buttons){
 const bytes=await pngCard(e,mode,user,score,rank);
 const form=new FormData();form.set("chat_id",String(chat));form.set("message_id",String(messageId));form.set("media",JSON.stringify({type:"photo",media:"attach://card",caption:"🏆 "+(user.name||"Участник")+" · "+(score>0?"+":"")+score+" баллов"}));form.set("card",new Blob([bytes],{type:"image/png"}),"qvk-reputation.png");form.set("reply_markup",JSON.stringify(buttons));
 const res=await fetch("https://api.telegram.org/bot"+e.BOT_TOKEN+"/editMessageMedia",{method:"POST",body:form});const data=await res.json();if(!data.ok)throw Error("Telegram editMessageMedia: "+data.description);return data.result;
}
