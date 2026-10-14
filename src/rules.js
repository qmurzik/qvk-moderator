// Чёткие признаки и явная путаница веток. В остальных случаях решение оставляем ИИ.
export const LABELS={bugs:"🐛 Баги",ideas:"💡 Предложения",badges:"🏅 Значки",chat:"💬 Общение",releases:"📦 Бета-релизы"};
export const GUIDES={
 bugs:"Укажи версию QVK (например test38), что сломалось, шаги воспроизведения, ожидаемое и фактическое поведение. Приложи скриншот или видео, если есть.",
 ideas:"Опиши предлагаемую функцию, зачем она нужна и как должна работать.",
 badges:"Оставь ссылку на свой профиль VK (vk.com/id123) или числовой VK ID. Не публикуй пароли и токены.",
 chat:"Здесь можно свободно обсуждать QVK; уважай других и не отправляй спам.",
 releases:"Здесь публикуются бета-сборки и объявления команды QVK. Вопросы — в ветку общения."
};
const bug=/(?:\bbug\b|\bcrash\b|баг|ошибк|вылет|краш|не работает|перестал[а-я ]*работать|завис|сломал|не открыв|не загруж|не приход|не показывает|пропал[аи]?|проблем|test\s*\d+)/iu;
const idea=/(?:предлага|предложен|идея|добав(?:ить|ьте)|сделайте|хотелось бы|улучш|можно ли добав|фич|новую функци|реализовать|было бы удобн)/iu;
const vk=/(?:\b(?:https?:\/\/)?(?:m\.)?vk\.com\/(?:id\d+|[a-z0-9_.]+)\b|\bid\d{3,15}\b|\b\d{5,15}\b)/iu;
export function assess(kind,content="",hasMedia=false){
 const text=String(content).trim();
 if(kind==="chat")return {verdict:"ok",reason:"Общение без тематической фильтрации"};
 if(kind==="releases")return {verdict:"uncertain",reason:"Проверка объявлений только по ролям"};
 if(!text)return {verdict:"uncertain",reason:hasMedia?"Медиа без подписи":"Нет текста"};
 const b=bug.test(text),i=idea.test(text),v=vk.test(text);
 if(kind==="bugs"){if(b&&!i)return {verdict:"ok",reason:"Описание неисправности"};if(i&&!b)return {verdict:"offtopic",reason:"Это больше похоже на предложение"};}
 if(kind==="ideas"){if(i&&!b)return {verdict:"ok",reason:"Предложение по улучшению"};if(b&&!i)return {verdict:"offtopic",reason:"Это больше похоже на сообщение о баге"};}
 if(kind==="badges"){if(v&&!b&&!i)return {verdict:"ok",reason:"Указан профиль VK"};if((b||i)&&!v)return {verdict:"offtopic",reason:"Это не заявка на значок"};}
 return {verdict:"uncertain",reason:"Тема сообщения неочевидна"};
}
