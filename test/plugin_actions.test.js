import test from "node:test";import assert from "node:assert/strict";import {webcrypto} from "node:crypto";import {canonical,verifySignature} from "../src/plugin_actions.js";
test("HMAC for Exteragram action uses stable fields",async()=>{
 globalThis.crypto=webcrypto;
 const a={timestamp:"1770000000",nonce:"abcdef0123456789",chat:"-1004356415652",user:"123456",message_id:"617",moderator:"5110155633",action:"warn",duration:"0",reason:"Нарушение правил"};
 assert.equal(canonical(a),[a.timestamp,a.nonce,a.chat,a.user,a.message_id,a.moderator,a.action,a.duration,a.reason].join("\n"));
 const key=await crypto.subtle.importKey("raw",new TextEncoder().encode("a-very-long-private-standalone-secret"),{name:"HMAC",hash:"SHA-256"},false,["sign"]);
 const sig=Buffer.from(await crypto.subtle.sign("HMAC",key,new TextEncoder().encode(canonical(a)))).toString("hex");
 assert.equal(await verifySignature("a-very-long-private-standalone-secret",a,sig),true);
 assert.equal(await verifySignature("a-very-long-private-standalone-secret",{...a,action:"delete"},sig),false);
 assert.equal(await verifySignature("a-very-long-private-standalone-secret",a,"broken"),false);
});
