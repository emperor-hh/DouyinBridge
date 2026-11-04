# DouyinLuma

Experimental Douyin private/group message bridge for AstrBot via OneBot v11.

> **Development prototype. Not production-ready.** This repository does **not** include verified Douyin account login or proven real-world private/group message sending. Sending is disabled by default.

## Architecture

Douyin web (Windows Edge) → [LockyBee/dsh-douyin-agent ChatBrowser](https://github.com/LockyBee/dsh-douyin-agent) → DouyinLuma OneBot v11 reverse WebSocket → AstrBot (AI, memory, tools, plugins).

SnowLuma remains separate and unchanged. This repository has no own LLM calls. Upstream dsh-douyin-agent **source checkout** is required, but its DSH plugin/desktop executable does not need to run as a separate service.

## Implemented in this prototype

- OneBot v11 reverse WebSocket transport, action handling, reconnect.
- Private/group message event conversion, conservative stable-identity checks.
- Persistent virtual numeric IDs; allowlist, first-snapshot baseline.
- Basic get_login_info/get_status/get_group_list/get_friend_list and text-only send actions.
- Safety gate: `ENABLE_SENDING=false` by default; fail closed if delivery cannot be confirmed.
- Unit tests for identity, formatting, validation and configuration.

## Limitations and blockers

- **Upstream browser startup/login lifecycle is not integrated.** Merely launching `src/index.mjs` does not guarantee a logged-in Douyin account.
- Upstream DOM shapes and real group member IDs need verification on a **test account**.
- Current polling history is in memory; restart-resistant message watermark and durable send queue are not implemented.
- Group @ parsing must be verified before using bot-mention triggering.
- Text only. Unsupported OneBot actions fail explicitly.
- Windows x64 + Edge, Node.js >=22.13 (upstream restriction). Linux/Docker not supported yet.
- Browser automation is nonofficial and may break or cause account restrictions.

## Setup (Windows development only)

1. Install Node.js >=22.13, Microsoft Edge, pnpm and Git.
2. Clone this repository; run `npm install` (or `pnpm install`).
3. Execute `powershell -ExecutionPolicy Bypass -File scripts/install-upstream.ps1` to fetch upstream source.
4. Copy `.env.example` to `.env`; configure `ONEBOT_WS_URL` and strong `ONEBOT_ACCESS_TOKEN`. Do not expose WS over plaintext public networks.
5. Configure a **second** OneBot v11 reverse WS listener in AstrBot, separate from SnowLuma.
6. Run `npm test`. Start with `node --env-file=.env src/index.mjs` as a development integration check.

**Do not enable sending** before completing the browser login/preparation and real private/group message end-to-end tests. `ALLOWED_CONVERSATIONS` accepts verified upstream `conv:<sha256>` IDs, never display names.

## Next engineering milestones

1. Implement supported upstream BrowserController startup, QR login and verified contact discovery.
2. Implement durable per-conversation watermarks and explicit group member identity checks.
3. Add serialized outbound coordinator with optimistic-read verification and unknown-delivery receipts.
4. Test private and ordinary friend-group text reception/sending on a disposable test account.
5. Verify AstrBot OneBot protocol compatibility and add deployment packaging.

## Provenance and license

Design references [LockyBee/dsh-douyin-agent](https://github.com/LockyBee/dsh-douyin-agent), MIT-licensed. See its LICENSE and THIRD_PARTY_NOTICES for any adapted code and additional third-party licenses. The upstream source is imported dynamically rather than vendored. Never commit tokens, browser profiles, login cookies or private chat logs.
