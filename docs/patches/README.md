# Private Companion: Douyin media compatibility fix

This patch records the local fix tested against
`menglimi/astrbot_plugin_private_companion` version 6.5.6. It changes that
AstrBot plugin, not the DouyinLuma gateway. The installed plugin has already
been patched and AstrBot restarted on this machine.

The creative-work read guard mistook generated Douyin card fields such as
`作品ID` and `内容范围` for questions about the bot's own writing. It then
replaced the reply with a request for a creative-work title or chapter.
The fix excludes appended Douyin card/sampling evidence from this intent
check while preserving explicit questions about the bot's own bookshelf.
It does not add full gallery reading, audio transcription or video sampling.

To apply on another installation, back up the plugin and run from its root:

```powershell
git apply --check C:\work\code\DouyinLuma\docs\patches\private-companion-douyin-media.patch
git apply C:\work\code\DouyinLuma\docs\patches\private-companion-douyin-media.patch
```

Restart AstrBot after applying. If the check fails after a plugin upgrade,
review the changed guard instead of forcing the patch. Plugin updates may
overwrite this local fix.

Validation: all 21 tests in `tests/test_creative_chat_tool.py` passed,
including media metadata, explicit media summaries, and genuine creative
work queries. The patch includes the regression test. A fresh live reply
has not yet been verified.
