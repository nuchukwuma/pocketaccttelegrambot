# HordeMart link, consent records and security changes

What changed in this repo, what to set before deploying, and what still
needs a person (a lawyer, or you) to decide.

## Before you deploy — do these first

1. **Rotate `BOT_API_KEY`** on both the backend and the bot server. Older app
   builds compiled it into the app (`VITE_BOT_API_KEY`), so treat it as public.
   Then delete `VITE_BOT_API_KEY` from the app's `.env` — nothing reads it now.
2. **Rotate the Turso database token** that is written in
   `mrmouse-telegram-bot/read.me`, then remove it from that file. It is in
   this repository's history, so anyone with read access to the repo has it.
3. Set the new environment variables below.

## Environment

Backend (`mrmouse-backend`), server only — never in a `VITE_` variable:

| Variable | What it is |
|---|---|
| `HORDEMART_SSO_SECRET` | Same value as HordeMart's `MRMOUSE_SSO_SECRET` (32+ random characters) |
| `HORDEMART_WEBHOOK_SECRET` | Same value as HordeMart's `MRMOUSE_WEBHOOK_SECRET` (different from the one above) |
| `HORDEMART_API_URL` | HordeMart's app address, e.g. `https://app.hordemart.com` |
| `TRUST_PROXY` | `1` when the backend runs behind a hosting proxy (Render, Railway, Heroku, Nginx). The sign-in limits count by IP address. |

On HordeMart, set `MRMOUSE_WEB_URL` to where the Mr Mouse web app is hosted
and `MRMOUSE_API_URL` to this backend's address.

Bot server (`mrmouse-telegram-bot`): optional `ALLOW_LEGACY_APP_KEY=true`
lets old app builds that only send the key keep working while people update.
It reopens the hole the change closes, so switch it off as soon as you can.

## What changed

**HordeMart sign-in** (`routes/hordemart.js`): a seller presses "Open Mr
Mouse" in HordeMart. The first time, they see what linking shares and tick to
agree. A store owner with no Mr Mouse account gets one, with the normal
30-day trial — HordeMart grants no Mr Mouse plan. A store staff member must
already have been added to their owner's Mr Mouse team. Each sign-in pass
works once, for 60 seconds.

**Stock in step with HordeMart** (`services/hordemartStock.js`): products now
have an optional **item code (SKU)**. When a product changes, Mr Mouse sends
HordeMart the stock count for each item code. When a HordeMart order is paid,
the sold items are recorded as "offloaded" on the product with the same code.
Prices and customer details never cross. This only happens from a store
owner's link, while they still agree, and while stock sync is on in HordeMart.

**Consent records** (`routes/consents.js`, `models/Consent.js`): every tick
box in the app is recorded on the server — who, when, which version, IP
address and device. Records are never edited or deleted; a withdrawal is a
new record. The server enforces the agreements as well as the app: the AI
assistant refuses without the AI agreement, and the bot server refuses to
pair Telegram or send over WhatsApp without the matching one. Withdrawing
unlinks HordeMart, Telegram or WhatsApp.

**Security fixes**
- The bot server checks the signed-in person's own token, and that the
  business is theirs, instead of a key anyone could read from the app.
- Sign-up requires accepting the current Terms, and a password of 12 or more
  characters (existing accounts still sign in with their old passwords).
- Every new or changed request body is checked (zod) before use.
- Rate limits on sign-in, sign-up, HordeMart sign-in and payment start/verify.
- Server errors no longer send internal details to the app, and request
  bodies (passwords) are never written to the log.

Limits are kept in the server's memory: right for one server. Running more
than one copy needs a shared store (e.g. Redis).

## Tests

```
cd mrmouse-backend && MONGO_TEST_URI=mongodb://127.0.0.1:27017/mrmouse_test npm test
cd mrmouse-telegram-bot && npm test
```

Without `MONGO_TEST_URI` the database tests are skipped (the run says so).

## For a Nigerian lawyer (NDPA 2023) — not decided by code

- The Terms, Privacy Policy and every consent text in
  `mr-mouse/src/assets/legal/` are drafts (`LEGAL_DRAFT = true`).
- Business data sent to Google and Anthropic (AI), Telegram and Meta
  (WhatsApp) leaves Nigeria: cross-border transfer.
- WhatsApp messages to a business's clients: the business must hold its
  clients' consent.
- HordeMart ⇄ Mr Mouse sharing: if they are run by different companies, a
  data-sharing agreement is needed, and both privacy policies should name
  each other.
- How long consent records and IP addresses are kept.
