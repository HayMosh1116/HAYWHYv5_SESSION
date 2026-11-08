# HAYWHY MDX v5 — Session Service

Separate session-service workspace for **HAYWHY MDX**. The original session-generator repository remains untouched.

## Current status

This repository is a migration workspace, not yet a completed MongoDB session generator. The legacy generator currently uses `@whiskeysockets/baileys` and exports a compressed `PRINCE-MDX!` session string. The bot repository uses a pinned `prince-baileys` fork.

Those formats must not be assumed interchangeable. The session service must use the same pinned `prince-baileys` revision as the bot and persist the complete AuthenticationState (credentials plus Signal keys) to the same MongoDB database/collection.

## Target architecture

- MongoDB collection: `whatsapp_auth`
- Session namespace: `WHATSAPP_SESSION_ID`
- Database: `MONGODB_DB`
- Connection secret: `MONGODB_URI`
- Auth format: the exact `prince-baileys` AuthenticationState used by HAYWHY MDX v5.

The service should expose QR and pairing-code flows while keeping credentials and Signal keys in MongoDB. It should not send raw auth exports or long-lived private keys through chats, logs, URLs, or public endpoints.

## Required environment variables

| Variable | Purpose |
|---|---|
| `MONGODB_URI` | MongoDB Atlas connection string; configure as a secret |
| `MONGODB_DB` | Database name, e.g. `haywhy_mdx` |
| `WHATSAPP_SESSION_ID` | Stable session namespace for the account |
| `PORT` | Optional web server port |

## Safety rules

1. Never commit MongoDB credentials, QR codes, pairing codes, or WhatsApp auth state.
2. Do not run the same session ID from the session service and bot at the same time.
3. Do not delete the existing working session during migration.
4. Do not mark this service production-ready until a fresh pair, MongoDB persistence, restart recovery, and message send/receive tests pass.

## Migration checklist

- [ ] Copy the complete existing QR/pairing routes and UI into this repository.
- [ ] Pin the exact same `prince-baileys` commit as the bot.
- [ ] Replace compressed session-string export with MongoDB-backed auth-state persistence.
- [ ] Verify the service and bot read the same session namespace.
- [ ] Test QR and pairing code flows.
- [ ] Verify restart recovery and message send/receive.
- [ ] Ensure only one live socket owns a session ID.

**Important:** The old repository is preserved. This repository documents the target architecture; its runtime migration and tests are still pending.
