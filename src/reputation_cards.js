export function repLevel(score){const n=Number(score)||0;if(n>=100)return ["💎","Легенда"];if(n>=50)return ["👑","Элита"];if(n>=20)return ["🌟","Эксперт"];if(n>=5)return ["✨","Активист"];if(n<0)return ["🌧️","В минусе"];return ["🌱","Новичок"];}
export function escapeHtml(s){return String(s??"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;");}
export function repCard(mode,user,score,rank=null){
 const [symbol,level]=repLevel(score),testers=mode==="testers";
 const name=escapeHtml(user.name&&user.name!=="Участник"?user.name:user.username?"@"+user.username:"Участник");
 const handle=user.username&&name!=="@"+escapeHtml(user.username.replace(/^@/,""))?"\n@"+escapeHtml(user.username.replace(/^@/,"")):"";
 const number=(score>0?"+":"")+score;
 const progress=Math.min(10,Math.max(0,Math.floor(Math.max(0,score)/10)));
 const bar="▰".repeat(progress)+"▱".repeat(10-progress);
 return "<b>"+(testers?"✦ QVK · TESTERS ✦":"✦ QVK · COMMUNITY ✦")+"</b>\n"+
 "━━━━━━━━━━━━━━━━━━\n"+
 (testers?"🧪":"💜")+" <b>"+name+"</b>"+handle+"\n\n"+
 "🏆 <b>"+number+"</b> баллов репутации\n"+
 symbol+" <b>"+level+"</b>"+(rank?" · 🥇 ТОП #"+rank:"")+"\n"+
 "<code>"+bar+"</code>\n"+
 "━━━━━━━━━━━━━━━━━━\n"+
 "<i>"+(testers?"Оценки назначает владелец QVK":"Оценки участников сообщества")+"</i>"+
 "\n<tg-spoiler>Telegram ID: "+escapeHtml(user.id)+"</tg-spoiler>";
}
export function repTopCard(mode,rows){return "<b>🏆 "+(mode==="testers"?"Рейтинг тестировщиков":"Рейтинг сообщества")+"</b>\n\n"+(rows.length?rows.map((x,i)=>(["🥇","🥈","🥉"][i]||"▫️")+" <b>"+escapeHtml(x.name||"Участник")+"</b>"+(x.role?" · "+escapeHtml(x.role.name):"")+(x.username?" · @"+escapeHtml(x.username.replace(/^@/,"")):"")+" — <b>"+(x.score>0?"+":"")+x.score+"</b> "+repLevel(x.score)[0]).join("\n"):"🌱 Пока нет оценок.")+"\n\n<i>Ответь + или − на сообщение участника, чтобы оценить его.</i>";}
export const cardButtons=target=>({inline_keyboard:[[{text:"👍 +1",callback_data:"rv:1:"+target},{text:"👎 −1",callback_data:"rv:-1:"+target}],[{text:"🔄 Обновить",callback_data:"rc:"+target}]]});
