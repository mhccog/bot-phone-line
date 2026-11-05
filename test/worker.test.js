import test from "node:test";
import assert from "node:assert/strict";
import worker from "../src/worker.js";

const env = { TWILIO_AUTH_TOKEN: "test-only-token", BOT_WEBHOOKS: "{}", USE_CONVERSATION_RELAY: "false" };
async function signed(path, fields) {
  const url = `https://example.test${path}`;
  const form = new URLSearchParams(fields);
  const data = url + [...form.keys()].sort().map((k) => k + form.get(k)).join("");
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(env.TWILIO_AUTH_TOKEN), { name: "HMAC", hash: "SHA-1" }, false, ["sign"]);
  const bytes = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data));
  const signature = btoa(String.fromCharCode(...new Uint8Array(bytes)));
  return new Request(url, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", "X-Twilio-Signature": signature }, body: form });
}

test("health and bots need no credentials", async () => {
  assert.equal((await worker.fetch(new Request("https://example.test/health"), {})).status, 200);
  const bots = await (await worker.fetch(new Request("https://example.test/bots"), {})).json();
  assert.equal(bots.length, 15);
  assert.equal(bots[0].name, "Friday");
});

test("unsigned and invalid Twilio posts are rejected", async () => {
  const req = new Request("https://example.test/voice", { method: "POST", body: new URLSearchParams({ CallSid: "CAtest" }) });
  assert.equal((await worker.fetch(req, env)).status, 403);
});

test("voice returns trial Gather menu", async () => {
  const body = await (await worker.fetch(await signed("/voice", { CallSid: "CAtest" }), env)).text();
  assert.match(body, /<Gather input="speech dtmf"/);
  assert.match(body, /Friday, 1/);
  assert.doesNotMatch(body, /ConversationRelay/);
});

test("spoken bot selection reaches Friday and handles missing backend", async () => {
  const body = await (await worker.fetch(await signed("/gather", { CallSid: "CAtest", SpeechResult: "Friday" }), env)).text();
  assert.match(body, /Friday selected/);
  const next = await (await worker.fetch(await signed("/gather?bot=friday", { CallSid: "CAtest", SpeechResult: "Hello" }), env)).text();
  assert.match(next, /webhook and the stopgap model are not configured/);
  assert.match(next, /What next/);
});

test("DTMF bot selection supports Atlas", async () => {
  const body = await (await worker.fetch(await signed("/gather", { CallSid: "CAtest", Digits: "2" }), env)).text();
  assert.match(body, /Hierloom \/ Atlas selected/);
});

test("unknown selection gathers again", async () => {
  const body = await (await worker.fetch(await signed("/gather", { CallSid: "CAtest", SpeechResult: "Nobody" }), env)).text();
  assert.match(body, /I did not catch that/);
});

test("bot replies can come from a webhook", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async (_url, options) => {
    const payload = JSON.parse(options.body);
    assert.equal(payload.bot, "friday");
    assert.equal(payload.message, "Test");
    return Response.json({ reply: "Real bot reply." });
  };
  try {
    const body = await (await worker.fetch(await signed("/gather?bot=friday", { CallSid: "CAtest", SpeechResult: "Test" }), { ...env, BOT_WEBHOOKS: JSON.stringify({ friday: "https://example.invalid/hook" }) })).text();
    assert.match(body, /Real bot reply/);
  } finally { globalThis.fetch = original; }
});

test("Relay mode points to secure Worker socket", async () => {
  const body = await (await worker.fetch(await signed("/voice", { CallSid: "CAtest" }), { ...env, USE_CONVERSATION_RELAY: "true" })).text();
  assert.match(body, /<ConversationRelay url="wss:\/\/example.test\/ws"/);
});
