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
- `GET /health` — checks the web service and confirms MongoDB responds to a ping. Returns HTTP 200 when both are available, or HTTP 503 when MongoDB is unavailable.
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

GitHub Actions now runs a Node.js 22 syntax check and MongoDB auth-adapter unit tests on pushes and pull requests. The auth-adapter tests have also passed in an isolated local Node.js 22 test run. A clean dependency installation, live MongoDB test, real WhatsApp pairing, and bot restart recovery are still pending.
