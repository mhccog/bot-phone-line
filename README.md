# Bot Phone Line

A public, credential-free scaffold for Cyrus's **dial-a-bot** line. Dial a voice-capable Twilio number, say a bot's name (or use its menu digit), then speak in turns. A Cloudflare Worker serves the Twilio IVR and routes each turn to a configured bot webhook, or to a clearly-labelled stopgap phone persona.

## Architecture

```text
iPhone / CarPlay contact
        │ ordinary phone call
        ▼
Twilio voice number
        │ signed HTTPS form POSTs
        ▼
Cloudflare Worker
  POST /voice   welcome + bot selection; ConversationRelay when enabled
  POST /gather  speech/DTMF selection, then Say + Gather conversation loop
  GET  /ws      ConversationRelay WebSocket (upgraded accounts only)
  GET  /health  deployment check; /bots lists the menu
        │
        ├── BOT_WEBHOOKS[key] → that bot's HTTPS webhook
        └── or OpenAI-compatible chat → temporary phone persona (no bot tools)
```

The trial-friendly path uses `<Gather input="speech dtmf">` and `<Say>`; no ConversationRelay entitlement is needed. Each turn is a new signed Twilio request. Bot selection travels in a validated `/gather?bot=…` URL. Optional Workers KV (`CALL_HISTORY`) retains the last 12 messages for two hours; without it the phone persona is stateless between turns.

`bots.json` includes the 15 requested bots and known IDs. Webhook URLs are deliberately **not** public configuration: they live in the `BOT_WEBHOOKS` Worker secret.

## What works with no credentials

- Source review, `npm test`, and local Wrangler development.
- `/health` and `/bots` on a local dev server.
- TwiML generation and signed-request tests with test-only values.
- Nothing makes or answers calls, contacts a real bot, or invokes an AI model until the relevant secrets and a Twilio number are configured.

## Environment variables and secrets

| Name | Required | Purpose |
|---|---|---|
| `TWILIO_AUTH_TOKEN` | Yes, secret | Verifies `X-Twilio-Signature` on every `/voice` and `/gather` POST. Missing/invalid signatures get 403. |
| `BOT_WEBHOOKS` | For real bots, secret | JSON map, e.g. `{"friday":"https://…","heirloom":"https://…"}`. Keys match `bots.json`. |
| `WEBHOOK_BEARER_TOKEN` | Optional, secret | Shared bearer token sent to each bot webhook. Prefer bot-specific URLs/tokens if their interfaces differ. |
| `OPENAI_API_KEY` | Optional fallback, secret | Enables the stopgap spoken persona when the selected bot has no webhook. |
| `OPENAI_BASE_URL` | Optional var | OpenAI-compatible root; default `https://api.openai.com/v1`. |
| `OPENAI_MODEL` | Optional var | Default `gpt-4.1-mini`. |
| `USE_CONVERSATION_RELAY` | Optional var | `true` selects `<Connect><ConversationRelay>` instead of Gather+Say. |
| `MAX_TURNS` | Reserved var | Placeholder for a future per-call turn cap; not currently enforced. |

No account SID is needed by the Worker itself: the auth token validates incoming webhooks. It is needed in the Twilio console/API when provisioning a number. Never put secrets in `wrangler.jsonc`, `bots.json`, `.dev.vars`, git history, or this public repo.

## Deploy

1. Install Node.js 22+ and log in with `npx wrangler login`, **or** use the box's Cloudflare token. `scripts/deploy.sh` reads `/home/box/.secrets/cf_api_token` only if `CLOUDFLARE_API_TOKEN` is unset; it never prints it.
2. `npm install`
3. `./scripts/deploy.sh`
4. Set secrets interactively so values do not land in shell history:
   ```sh
   npx wrangler secret put TWILIO_AUTH_TOKEN
   npx wrangler secret put BOT_WEBHOOKS
   # Optional:
   npx wrangler secret put OPENAI_API_KEY
   npx wrangler secret put WEBHOOK_BEARER_TOKEN
   ```
5. In **Twilio Console → Phone Numbers → your number → Voice Configuration**, set **A call comes in** to **Webhook**, `https://bot-phone-line.<account>.workers.dev/voice`, **HTTP POST**. Save.
6. Call the number. Try “Friday”, “Heirloom”, and DTMF `1`; then say “switch” or “goodbye”.

Optional history: create a KV namespace and uncomment/insert its real binding:

```sh
npx wrangler kv namespace create CALL_HISTORY
```

```jsonc
// wrangler.jsonc
"kv_namespaces": [{ "binding": "CALL_HISTORY", "id": "YOUR_KV_NAMESPACE_ID" }]
```

## Connecting each bot to a Grok Bot webhook routine

The Worker POSTs JSON: `{bot, botId, message, callSid, source}` and expects JSON `{reply:"spoken answer"}` (also accepts `message`, `text`, or plain text). The target must return within Twilio's webhook timeout; keep replies short.

1. In Grok Bot, create an **event-driven / webhook-triggered routine** for the chosen bot. Its prompt should treat `message` as untrusted phone speech, answer concisely, and **not** perform irreversible actions from a phone call. Require confirmation in the bot's chat for purchases, sends, posts, deletions, and bookings.
2. Copy that routine's **unique HTTPS webhook URL**. Do not commit it. If Grok Bot gives a separate secret, configure the target to require it; this scaffold supports one shared `WEBHOOK_BEARER_TOKEN` across targets.
3. Add the entry to `BOT_WEBHOOKS`, using the `key` in `bots.json`, for example:
   ```json
   {"friday":"https://example.invalid/REPLACE_WITH_REAL_ROUTINE_WEBHOOK"}
   ```
4. Re-run `npx wrangler secret put BOT_WEBHOOKS` with the complete updated JSON map and call the line.
5. Repeat per bot. Bots without webhooks use the stopgap model if configured; otherwise the caller hears a clear not-configured message.

**Important:** this is an HTTP request/reply bridge, not a native live Grok Bot voice session. Whether a routine webhook exists and its exact payload/response contract must be checked in Grok Bot when configuring it. A webhook that only triggers work and returns no synchronous `{reply}` will need a small adapter; asynchronous task results cannot magically speak back in the same call.

## Trial versus upgraded ConversationRelay

- **Twilio trial:** use the default `USE_CONVERSATION_RELAY=false`. Gather speech recognition plus Say works in turns and is the initial path. Trial accounts also have Twilio's normal trial restrictions (verified callee restrictions for outbound, trial messaging, and available-number/geographic rules). Buying a number and any usage may require adding credit; this repo does neither.
- **Upgraded + ConversationRelay access/onboarding:** configure providers in Twilio Console, then run `npx wrangler secret put` only for secrets and set the non-secret var `USE_CONVERSATION_RELAY=true` in `wrangler.jsonc`; deploy. `/voice` connects to secure `wss://…/ws`. Twilio handles STT/TTS; the Worker handles `setup`, `prompt`, and `dtmf`, returning `{type:"text",token,last:true}`.
- ConversationRelay requires an upgraded/onboarded account and a reachable TLS WebSocket. It does not provide an LLM or memory itself. Keep the HTTP signature checks even when Relay is enabled; `/ws` is a separate Twilio-established channel and should be protected with Relay custom parameters/token before production exposure.
- The Gather loop is less fluid than Relay: speak after the prompt, wait for the response, and use “switch”/“goodbye”. There is no barge-in on Gather+Say.

## CarPlay: save it as a contact

Once the real number exists:

1. On iPhone open **Contacts → +**, name it **Friday & Bots**, and add the Twilio number. Add the menu in Notes if useful (Friday `1`, Heirloom `2`, Thursday `3`, Saturday `4`, Stack `5`; multi-digit entries are easiest by speaking the name).
2. Optionally add it to **Favourites** in the Phone app.
3. In the car, connect CarPlay and open **Phone → Contacts/Favourites → Friday & Bots**. Start only when parked or use hands-free Siri: “Call Friday and Bots.” Obey local driving laws.
4. Say “Friday” (or the bot wanted), then speak normally in the Gather loop. This is a normal cellular call, so no WhatsApp or new calling app is needed.

## Security and limits

- All inbound Twilio HTTP webhooks require a valid HMAC-SHA1 signature, compared in constant time. No browser-facing call API is exposed.
- The public repo contains only placeholders. No Twilio number was purchased and no secret was read into the repository.
- Caller transcripts are untrusted. The fallback model is explicitly a routing phone persona, not the real bot and not a claim that work was done.
- For production, add per-webhook authentication, rate/abuse controls, a per-call turn/time budget, structured logging without sensitive transcripts, and Relay WebSocket authentication. Consider restricting the number to Cyrus's caller ID after testing; Twilio signatures prove Twilio called the Worker, not who dialled the number.
