import test from "node:test";import assert from "node:assert/strict";import {cardHtml} from "../src/reputation_png.js";
test("PNG HTML contains actual name, scores and role",()=>{
 const s=cardHtml("testers",{name:"Аня Иванова",username:"anya"},23,2,null);
 assert.match(s,/Аня Иванова/);
 assert.match(s,/@anya/);
 assert.match(s,/\+23/);
 assert.match(s,/TESTER REPUTATION/);
});
test("card escapes unsafe Telegram display names",()=>{
 const s=cardHtml("users",{name:"<img onerror='x'>",username:"a&b"},0,null,null);
 assert.doesNotMatch(s,/<img onerror=/);
 assert.match(s,/&lt;img/);
 assert.match(s,/@a&amp;b/);
});
