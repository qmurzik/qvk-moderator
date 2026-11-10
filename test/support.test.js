import test from "node:test";import assert from "node:assert/strict";import {selectArticle,compose,matchAutomatic} from "../src/support.js";
const articles=[{id:"music_android17",status:"known_issue",triggers:["android 17","вылетает музыка"],answer:"Подтверждённого универсального исправления нет.",steps:["Запиши Android и версию QVK.","Посмотри журнал вылета."],clarifying_question:"Есть последний сбой?"},{id:"music_background",status:"needs_diagnosis",triggers:["музыка выключается","музыка"],answer:"Проверь фоновые ограничения.",steps:[],clarifying_question:"Когда пропадает звук?"},{id:"admin_invalid_text",status:"admin_only",triggers:["invalid_text"],answer:"Админка",steps:[],clarifying_question:""}];
test("specific Android music scenario wins over general music",()=>assert.equal(selectArticle(articles,"На android 17 вылетает музыка").id,"music_android17"));
test("admin-only scenario does not leak",()=>assert.equal(selectArticle(articles,"invalid_text",false),null));
test("admin can access authorized admin scenario",()=>assert.equal(selectArticle(articles,"invalid_text",true).id,"admin_invalid_text"));
test("unclear message has no article",()=>assert.equal(selectArticle(articles,"Привет как дела"),null));
test("short reply and one follow-up question",()=>{const r=compose(articles[0]);assert.match(r,/Есть последний сбой/);assert.ok(r.length<950)});

test("automatic FAQ needs exact multiword trigger, avoids general chatter",()=>{const kb=[{id:"a",status:"information",triggers:["что такое qvk"],answer:"QVK"}];assert.equal(matchAutomatic(kb,"Подскажите, что такое qvk?")?.id,"a");assert.equal(matchAutomatic(kb,"Просто обсуждаю QVK"),null);});
test("automatic FAQ never exposes admin-only scenarios",()=>{const kb=[{id:"private",status:"admin_only",triggers:["проверить токен модератора"],answer:"hidden"}];assert.equal(matchAutomatic(kb,"Как проверить токен модератора?"),null);});
