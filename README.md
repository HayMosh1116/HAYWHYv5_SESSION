# HAYWHY MDX v5 — Session Service

A separate pairing/QR service for HAYWHY MDX v5. The original session-generator repository is not modified.

## How it works

1. Open the service URL.
2. Choose pairing code or QR.
3. Link the WhatsApp account.
4. The service stores the complete Baileys authentication state (credentials and Signal keys) in MongoDB's `whatsapp_auth` collection.
5. The linked WhatsApp account receives the value to set as `WHATSAPP_SESSION_ID` in the bot host's private environment settings.

There is no compressed `creds.json` export. The session service and bot use the same pinned `prince-baileys` revision and MongoDB database format.

## Environment variables

Set these privately in your hosting provider:

- `MONGODB_URI` — MongoDB Atlas connection string.
- `MONGODB_DB` — database name; defaults to `haywhy_mdx`.
- `PORT` — optional web service port.
- `LOG_LEVEL` — optional Pino log level.
- `MAX_ACTIVE_SESSIONS` — optional concurrent setup limit.

The generated `WHATSAPP_SESSION_ID` is sent to the linked WhatsApp account after successful pairing. Put that exact value into the bot service's environment settings.

## Endpoints

- `GET /` — browser interface.
- `GET /health` — service health.
- `POST /api/pair` with JSON `{"number":"2348012345678"}` — start pairing.
- `POST /api/qr` — start QR linking.
- `GET /api/sessions/:id` — retrieve setup status.

## Safety

- Never commit MongoDB credentials or WhatsApp authentication data.
- Keep the generated session ID private.
- Run only one active WhatsApp socket per session ID.
- The session service closes its temporary socket after successful linking; start the bot only after setup has completed.
- Do not delete or replace an existing live bot session until the new one has passed restart and send/receive tests.

## Current validation status

The repository contains the initial MongoDB-backed implementation. It has not yet been run against a real MongoDB deployment or WhatsApp account. Confirm the pinned fork exports, clean Node 22 installation, QR/pairing behavior, persistence, and bot restart recovery before production use.
