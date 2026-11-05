#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
if [[ -z "${CLOUDFLARE_API_TOKEN:-}" && -r /home/box/.secrets/cf_api_token ]]; then
  IFS= read -r CLOUDFLARE_API_TOKEN < /home/box/.secrets/cf_api_token
  export CLOUDFLARE_API_TOKEN
fi
if [[ -z "${CLOUDFLARE_API_TOKEN:-}" ]]; then
  echo "Set CLOUDFLARE_API_TOKEN or save it in /home/box/.secrets/cf_api_token" >&2
  exit 1
fi
npm install
npx wrangler deploy
printf '\nNext: set secrets (no values in shell history if prompted interactively):\n'
printf '  npx wrangler secret put TWILIO_AUTH_TOKEN\n'
printf '  npx wrangler secret put BOT_WEBHOOKS\n'
printf 'Optional: OPENAI_API_KEY, WEBHOOK_BEARER_TOKEN\n'
