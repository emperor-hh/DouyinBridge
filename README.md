# DouyinLuma

Experimental Douyin private/group chat bridge for AstrBot using OneBot v11. **The AI, plugins, persona and memories belong to AstrBot; DouyinLuma only transports messages.** SnowLuma remains unchanged.

**v0.2.0 — Headless Chromium development integration (not production-ready).**

## Browser modes

| Mode | Command | Behavior |
|---|---|---|
| First login | `npm run login` | Always opens visible browser, scan/login manually, then Ctrl+C |
| Default | `npm start` | Headless persistent Chromium, no browser window |
| Debug | `npm run start:visible` | Visible persistent Chromium, same profile |
| Config | `BROWSER_MODE=visible` | Makes default start visible |

The persistent browser profile is `./data/browser-profile` by default. **Never run login and start concurrently against the same profile.** The application attempts to pause HTML video playback; no autonomous watching or video AI is enabled.

## Setup on Windows (experimental)

1. Install Node.js >=22.13, npm/pnpm and a Chromium-compatible browser (Chrome/Chromium or Edge).
2. `git clone https://github.com/emperor-hh/DouyinLuma.git` and `cd DouyinLuma`.
3. `npm install`.
4. `powershell -ExecutionPolicy Bypass -File scripts/install-upstream.ps1` to fetch the pinned upstream [dsh-douyin-agent](https://github.com/LockyBee/dsh-douyin-agent) source. Its DSH plugin/executable is **not** a separate service.
5. Copy `.env.example` → `.env`. Set the **absolute** `UPSTREAM_DIR` if the checkout is elsewhere. Configure OneBot endpoint and matching access token.
6. `node --env-file=.env src/index.mjs --login`, manually log into Douyin, then Ctrl+C.
7. `npm run check` and `npm test`. Use `node --env-file=.env src/index.mjs` for a development integration run (or `--visible` to debug).

When no `.env` file is used, `npm run login` / `npm start` use environment variables or built-in defaults. With a populated `.env`, invoke using `node --env-file=.env src/index.mjs --login`, `node --env-file=.env src/index.mjs`, or `node --env-file=.env src/index.mjs --visible`.

`BROWSER_CHANNEL=chromium` uses Playwright's Chromium channel; `msedge` uses installed Edge; `bundled` requires an appropriate installed Playwright browser. Set a dedicated `BROWSER_PROFILE_DIR` and never reuse your daily browser profile.

## Important limitations

- **No real Douyin account/group integration test has been completed in this project.** Browser startup is implemented but whether headless mode preserves Douyin login, reads normal friend groups and sends messages is still unverified.
- Current upstream `ChatBrowser` was designed for Windows Edge via a dedicated CDP controller. We inject a Browser-like compatibility wrapper for our own persistent Chromium context; browser-specific CDP operations require real testing.
- `ENABLE_SENDING=false` by default. Leave it disabled until identity verification, queueing, receipts and group routing are validated.
- `ALLOWED_CONVERSATIONS` is a comma-separated list of verified `conv:<sha256>` IDs, not chat display names. Empty list emits no user messages.
- First-snapshot baseline is in memory only. Restart-resistant watermarks and outbound receipts are not implemented; don't use for unattended production.
- OneBot v11 reverse WS connection is independent from SnowLuma. Unsupported actions reject.
- Windows first; Linux Docker is not yet supported/validated.
- Nonofficial browser automation can break on site changes or conflict with platform rules.

## Testing

`npm run check` checks syntax; `npm test` runs offline unit tests using a fake Chromium launcher. Neither test logs in, accesses Douyin, nor sends real messages.

## Provenance and licensing

Design references [LockyBee/dsh-douyin-agent](https://github.com/LockyBee/dsh-douyin-agent) (MIT). Its code remains in a separate checkout. Respect its LICENSE, third-party notices and applicable Douyin rules. Never commit cookies, browser profiles, credentials or chat logs.
