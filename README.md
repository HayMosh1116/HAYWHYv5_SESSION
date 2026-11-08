# HAYWHY MDX v5 Session Generator

Companion session-generation workspace for HAYWHY MDX v5.

## Contract

The generator must create a complete authentication state compatible with the exact pinned `prince-baileys` version used by the bot. A credentials-only JSON export is not a complete session: Signal keys are required too.

## Recommended flow

1. Pair the WhatsApp linked device using the generator.
2. Persist the generated credentials and all Signal key categories to the same MongoDB auth collection used by the bot, under a unique `WHATSAPP_SESSION_ID`.
3. The bot loads that same namespace and writes every key update back to MongoDB.
4. Protect the session with encryption at rest, least-privilege MongoDB credentials, and a single-active-owner lease.
5. Never log, expose, or place session data in GitHub, URLs, browser local storage, or public API responses.

## Environment

- `MONGODB_URI`
- `MONGODB_DB`
- `WHATSAPP_SESSION_ID`

The generator should not export only `creds.json` or compress credentials while omitting Signal keys. The final implementation must use the same auth-store adapter contract as the bot.
