# DouyinLuma

Experimental Douyin **private + group** message transport for AstrBot via OneBot v11. DouyinLuma uses an independent persistent Chromium browser and delegates all AI, persona and plugin handling to AstrBot. SnowLuma and QQ remain separate.

## v0.6.0: send/receive image stickers (private + group)

- **Incoming sticker/emoji cards:** Recognized Douyin `media.type='emoji'` cards now produce an OneBot text event even when no text exists; when `RECEIVE_STICKERS=true` (default), an exact-card image screenshot is attached as an image segment when upstream capture is available. Screenshots are rate-limited per conversation.
- **Sending image stickers:** AstrBot OneBot v11 `send_private_msg` or `send_group_msg` can send one image segment containing `data.file='base64://...'`. Supported file signatures: PNG, JPEG, GIF, WebP; 12 bytes–8MB. This reuses the upstream `ChatBrowser.sendImageMessage` upload-preview/watermark/confirmed-receipt path; no blind click or automatic retry on uncertainty.
- **Gates:** `ENABLE_SENDING=true` and `ENABLE_IMAGE_SENDING=true`, plus the specific conversation's **发送表情图片** Web UI toggle (off by default). All three must be enabled. Conversation authorization changes apply without a restart; `.env` flags require a restart.
- **Unsupported:** Native Douyin sticker-picker IDs, remote URLs, arbitrary local file paths, text+image mixed sends, and multiple images in one OneBot action. Ordinary Unicode emoji such as 🙂 already work as text.
- This is **browser image upload**, not native sticker-library click. Real account delivery is still unverified; start with a disposable test contact and keep sending off until tested. [docs/stickers.md](docs/stickers.md) explains formats and limitations.

## v0.5.0: opt-in real timed video playback sampling

DouyinLuma can now open an explicitly authorized Douyin shared-work video in a **temporary Chromium tab**, mute/play for up to 5 seconds (default 3), collect 3 actual timestamped JPEG frames, verify time progress and visible video identity, pause/close the tab, and forward the frames to AstrBot as OneBot image segments. This is partial visual observation, not full video or audio understanding.

**Off by default for every private conversation and group.** After upgrading, enable both the regular allowlist and **按需视频分时采样** in the Web admin UI. Users must explicitly request video analysis (e.g. “帮我分析这个视频”) after sending a card; groups additionally require an @mention of the bot and a card by the same member. A bare video share NEVER auto-plays. The nearest eligible card within 8 recent messages is used. Sampling quotas: 5 attempts per conversation per rolling 24 hours, 30 globally per rolling 24 hours, at least 90 seconds between attempts in one conversation, with persistent SQLite reservations. Set `VIDEO_SAMPLE_SECONDS=3` (1-5 allowed) in `.env`; changing it requires restart.

The real playback/screenshot path has only been unit-tested with fakes, not a logged-in Douyin account. Actual Chrome UI, iframe, playback restrictions, media CORS, AstrBot image ingestion and group @ handling require Windows end-to-end tests. Read [docs/video-sampling.md](docs/video-sampling.md).

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
