# DouyinLuma

Experimental Douyin **private + group** message transport for AstrBot via OneBot v11. DouyinLuma uses an independent persistent Chromium browser and delegates all AI, persona and plugin handling to AstrBot. SnowLuma and QQ remain separate.

## v0.4.0: shared video/photo card forwarding (private + group)

Authorized Douyin shared-work cards can now reach AstrBot as OneBot text messages, even if the card contains **no text**. They contain visible card title, author, and a strictly validated Douyin work link when available. This is **not** video understanding. The gateway does not autonomously open or play shared videos. `SHARED_VIDEO_FORWARDING=true` by default; set false to disable.

The management console has an independent **视频卡片封面** toggle for each private chat/group (off by default). When enabled, a newly received private-chat card or an explicitly @-mentioned group-chat card may include one JPEG screenshot of the card as an OneBot `base64://` image segment. AstrBot image parsing and upstream screenshots still require real-world validation. See [docs/shared-video.md](docs/shared-video.md).

## v0.3.0: Web management console + dynamic authorization

- **Default:** Headless Chromium (`node --env-file=.env src/index.mjs`).
- **First login:** Visible Chromium (`node --env-file=.env src/index.mjs --login`).
- **Debug:** Visible Chromium (`node --env-file=.env src/index.mjs --visible`).
- **Admin:** `http://127.0.0.1:3219/` (local computer only). Use the admin token printed in terminal, or configure `ADMIN_TOKEN` of at least 20 characters in `.env`.
- **Contacts:** Click **重新扫描抖音会话**. Private and group conversations are shown independently. Enable or disable each verified conversation; changes persist in `data/allowlist.sqlite` **without restarting**.

Do not run two processes using one browser profile. After manual login, stop the login process before starting the gateway. Only contacts with verified stable identity can be authorized. Scanning the current message list does not guarantee that all Douyin friends and groups are discoverable.

## Windows developer setup

```powershell
cd C:\work\code\DouyinLuma
git pull
npm install
powershell -ExecutionPolicy Bypass -File scripts/install-upstream.ps1
Copy-Item .env.example .env  # only if .env does not exist
node --env-file=.env src/index.mjs --login
# Ctrl+C after manual login, then:
node --env-file=.env src/index.mjs
```

Open `http://127.0.0.1:3219/`, enter the administrator token printed in the console, refresh conversations, and toggle private chats or groups. Changes take effect immediately for **subsequent gateway events/actions**. Already dispatched messages or a platform send click cannot be retracted.

`ALLOWED_CONVERSATIONS` is migrated into SQLite **once**, when a matching verified contact is discovered; afterward the database is authoritative and editing `.env` does not update the whitelist. You can remove `ALLOWED_CONVERSATIONS` after migration.

## Security

- Admin binds only to 127.0.0.1, requires a separate Bearer token for every API operation, validates Origin, and never exposes tokens to the HTML.
- Authorization defaults off for newly discovered contacts. No sending when `ENABLE_SENDING=false`.
- Do not forward port 3219 to the Internet. Never commit `.env`, browser profiles, cookies, chat logs or `data/`.
- This is a **development integration**, not a production-reliable Douyin bridge. Browser automation, login recovery, real chat/group delivery and some upstream CDP methods remain unverified. The browser-to-OneBot polling still uses only an in-memory watermark and outbound sends have no durable receipts. Keep sending disabled until real account tests and a persistent outbound queue are implemented.
- A revoked authorization stops new event dispatch and is checked again before a send starts. If a send was already clicked before revocation, the result cannot be revoked retroactively.

## Tests

`npm run check` validates syntax; `npm test` runs offline tests. The project uses Node's built-in `node:sqlite` in Node >=22.13 (experimental warning on some Node versions). CI does not simulate a real Douyin account.

## Provenance

Underlying browser DOM operations are dynamically loaded from [LockyBee/dsh-douyin-agent](https://github.com/LockyBee/dsh-douyin-agent), MIT. The original DSH plugin or EXE is **not** a separate running service. Respect upstream LICENSE and THIRD_PARTY_NOTICES.
