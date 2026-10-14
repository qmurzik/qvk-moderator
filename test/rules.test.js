import test from "node:test";import assert from "node:assert/strict";import {assess,GUIDES} from "../src/rules.js";
test("bug belongs to bugs",()=>assert.equal(assess("bugs","На test38 вылетает видео").verdict,"ok"));
test("feature request not bugs",()=>assert.equal(assess("bugs","Предлагаю добавить вкладку").verdict,"offtopic"));
test("bug not idea",()=>assert.equal(assess("ideas","Вылетает при запуске").verdict,"offtopic"));
test("feature idea",()=>assert.equal(assess("ideas","Добавьте настройку иконок").verdict,"ok"));
test("VK link belongs to badges",()=>assert.equal(assess("badges","https://vk.com/id123456").verdict,"ok"));
test("chat unrestricted",()=>assert.equal(assess("chat","Привет всем!").verdict,"ok"));
test("media uncertain",()=>assert.equal(assess("bugs","",true).verdict,"uncertain"));
test("guidance for all topics",()=>assert.equal(Object.keys(GUIDES).length,5));
