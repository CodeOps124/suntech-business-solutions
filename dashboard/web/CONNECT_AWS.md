# Connecting real AWS QuickSight

The frontend ships in **local-preview mode** (charts from sample data) and flips
to the **live QuickSight embed** purely via config — no code changes. This is the
end-to-end checklist.

> Why it can't "just connect" out of the box: there is no AWS account, no
> credentials, and no deployed dashboard bundled with this repo (and there
> shouldn't be — those are yours). Everything on the code side is done; the
> steps below are the parts only you can provide.

## Prerequisites (yours to provide)

- An AWS account with **QuickSight Enterprise** enabled, home region
  **me-central-1 (Dubai)**.
- AWS credentials on the machine running the embed backend (env vars, shared
  config, or an IAM role).
- The reporting data + QuickSight assets deployed — follow
  `../docs/DEPLOY.md`. That publishes the dashboard id
  `suntech-pnl-invoice-analytics`.
- The P&L leads / client users registered as **QuickSight registered users**,
  with the RLS grants loaded (`reporting.rls_user_grant`).

## Step 1 — Deploy the dashboard (once)

```bash
# from dashboard/
AWS_ACCOUNT_ID=... QS_ADMIN_ARN=... scripts/deploy_quicksight.sh
AWS_ACCOUNT_ID=... scripts/refresh_spice.sh
```

## Step 2 — Run the embed-URL backend

The browser must not call QuickSight directly. This service mints a
**principal-scoped** embed URL so RLS is enforced server-side.

```bash
cd dashboard/web/server
npm install
AWS_REGION=me-central-1 \
QS_ACCOUNT_ID=123456789012 \
QS_DASHBOARD_ID=suntech-pnl-invoice-analytics \
QS_NAMESPACE=default \
PORT=8787 \
npm start
# health check: curl http://localhost:8787/health
```

The IAM principal running it needs
`quicksight:GenerateEmbedUrlForRegisteredUser` on the dashboard and the user.

> **Before production:** replace the demo trust model in `server/index.mjs`
> (it currently trusts the posted `principalId`). Derive the QuickSight user from
> your verified session / SSO / JWT instead.

## Step 3 — Point the frontend at it

```bash
cd dashboard/web
cp .env.example .env.local
# edit .env.local:
#   VITE_AWS_REGION=me-central-1
#   VITE_AWS_ACCOUNT_ID=123456789012
#   VITE_QS_DASHBOARD_ID=suntech-pnl-invoice-analytics
#   VITE_QS_EMBED_ENDPOINT=http://localhost:8787/embed-url
npm run dev
```

## Step 4 — Verify

- **Settings → AWS Connection** shows every requirement `set` and the green
  "Connected" pill.
- The **Analytics** tab banner switches from 🧪 local preview to 🔗 live embed,
  and renders the real QuickSight dashboard.
- Sign in as a restricted persona and confirm QuickSight RLS scopes the embedded
  dashboard to that principal (the embed URL is minted per principal).

## Architecture

```
Browser (Analytics page)
   │  POST { principalId }
   ▼
embed-URL backend (server/)  ──GenerateEmbedUrlForRegisteredUser──▶  QuickSight
   │  { embedUrl }                                                   (RLS applies)
   ▼
embed SDK renders the dashboard, scoped to the principal
```
