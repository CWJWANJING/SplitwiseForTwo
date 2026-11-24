# SplitPair

A private Splitwise-style app for two people that also tracks **incoming money**. It runs on Cloudflare's free tier, so it costs $0/month.

## Features

- **Expenses** paid by either person or by both (any amounts).
- **Splits:** equally, exact amounts, percentages, shares, adjustments, or all for one person.
- **Income:** money received by either person or both. It can be shared (e.g. a tax refund, so whoever got it owes the other their part) or personal (a paycheck, tracked in stats only).
- **Balances** per currency, plus per-group balances (trips, a house project, …).
- **Settle up:** record payments in either direction.
- **Recurring** expenses and income (weekly, every 2 weeks, monthly, yearly). Month-end dates are handled correctly, and items can be paused or resumed.
- **Categories, notes, comments, receipt photos,** and a full edit history per item.
- **Activity:** search, filters (type, group, category, month), and a change log of who did what.
- **Stats:** spent vs income vs net, a 12-month chart, by-category breakdowns, and who paid for shared spending. Each can show the total, your share, or your partner's share.
- **Recently deleted:** restore anything you deleted.
- **CSV export.**
- **Installable on phones** ("Add to Home Screen"), with dark mode.

## How the money math works

Every transaction stores four numbers in cents: `paid1, paid2, share1, share2`.

| kind    | paidN means         | shareN means           | effect on "partner 2 owes partner 1" |
|---------|---------------------|------------------------|--------------------------------------|
| expense | N paid              | N's portion            | `paid1 − share1`                     |
| income  | N received          | N is entitled to       | `share1 − paid1`                     |
| payment | N sent              | N received             | `paid1 − share1`                     |

The balance is the sum of these, grouped by currency.

## Deploy (about 10 minutes, one time)

You need a free Cloudflare account (no credit card) and Node.js 18+.

```bash
npm install
```

```bash
npx wrangler login
```

```bash
npx wrangler d1 create splitpair
```

Paste the printed `database_id` into `wrangler.jsonc`. In the same file, set `USER1_NAME`, `USER2_NAME` and `TIMEZONE`.

Then set the secrets. Each command prompts you for a value:

```bash
npx wrangler secret put USER1_PASSWORD
```

```bash
npx wrangler secret put USER2_PASSWORD
```

```bash
npx wrangler secret put SESSION_SECRET
```

For `SESSION_SECRET`, use any long random string, e.g. the output of `openssl rand -base64 32`.

```bash
npm run deploy
```

You'll get a URL like `https://splitpair.<you>.workers.dev`. Open it on both phones and use "Add to Home Screen". Logins last 90 days.

Updating later: edit the code, then run `npm run deploy` again.

## Run locally

Create a `.dev.vars` file:

```
USER1_PASSWORD=pw1
USER2_PASSWORD=pw2
SESSION_SECRET=some-long-random-string
```

Then:

```bash
npm run db:migrate:local
```

```bash
npm run dev
```

## Backups

```bash
npx wrangler d1 export splitpair --remote --output backup.sql
```

D1 also has 30-day point-in-time restore ("Time Travel") built in. You can also download a CSV anytime from More → Export.

## Security notes

- Each person has a password. Sessions use an HMAC-signed, HttpOnly, Secure cookie.
- Logins lock for 15 minutes after 10 failures. Writes require a custom header (CSRF guard).
- For extra protection you can put Cloudflare Access (Zero Trust) in front of the URL, so you log in with an email code before the app even loads.
