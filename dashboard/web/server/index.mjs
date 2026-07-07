/**
 * QuickSight embed-URL backend for the Suntech TCA frontend.
 *
 * The browser must NEVER call QuickSight directly (it can't hold AWS creds and
 * RLS scoping must be server-side). This tiny service:
 *   1. authenticates the caller (DEMO: trusts the posted principalId — REPLACE
 *      with your real session/JWT/SSO check before production),
 *   2. calls QuickSight generateEmbedUrlForRegisteredUser scoped to that
 *      principal, so the dataset-layer RLS in QuickSight restricts what they see,
 *   3. returns { embedUrl } to the frontend, which renders it via the embed SDK.
 *
 * Run:
 *   cd dashboard/web/server
 *   npm install
 *   AWS_REGION=me-central-1 \
 *   QS_ACCOUNT_ID=123456789012 \
 *   QS_DASHBOARD_ID=suntech-pnl-invoice-analytics \
 *   QS_NAMESPACE=default \
 *   PORT=8787 \
 *   npm start
 *
 * Credentials come from the standard AWS chain (env vars, shared config, or an
 * IAM role). The IAM principal needs quicksight:GenerateEmbedUrlForRegisteredUser
 * on the dashboard + the registered QuickSight user.
 */
import express from "express";
import cors from "cors";
import {
  QuickSightClient,
  GenerateEmbedUrlForRegisteredUserCommand,
} from "@aws-sdk/client-quicksight";

const PORT = process.env.PORT || 8787;
const REGION = process.env.AWS_REGION || "me-central-1";
const ACCOUNT_ID = process.env.QS_ACCOUNT_ID;
const DASHBOARD_ID = process.env.QS_DASHBOARD_ID || "suntech-pnl-invoice-analytics";
const NAMESPACE = process.env.QS_NAMESPACE || "default";

if (!ACCOUNT_ID) {
  console.error("Set QS_ACCOUNT_ID (the AWS account hosting QuickSight).");
  process.exit(1);
}

const qs = new QuickSightClient({ region: REGION });
const app = express();
app.use(cors());
app.use(express.json());

app.get("/health", (_req, res) =>
  res.json({ ok: true, region: REGION, dashboardId: DASHBOARD_ID })
);

app.post("/embed-url", async (req, res) => {
  try {
    const { principalId } = req.body || {};
    if (!principalId) return res.status(400).json({ error: "principalId required" });

    // DEMO TRUST MODEL — replace with your real auth: verify the caller's
    // session and DERIVE the QuickSight user ARN from it. Do NOT trust a
    // client-supplied identity in production.
    const userArn = `arn:aws:quicksight:${REGION}:${ACCOUNT_ID}:user/${NAMESPACE}/${principalId}`;

    const cmd = new GenerateEmbedUrlForRegisteredUserCommand({
      AwsAccountId: ACCOUNT_ID,
      UserArn: userArn,
      ExperienceConfiguration: {
        Dashboard: { InitialDashboardId: DASHBOARD_ID },
      },
      AllowedDomains: [process.env.ALLOWED_ORIGIN || "http://localhost:5173"],
      SessionLifetimeInMinutes: 60,
    });

    const out = await qs.send(cmd);
    res.json({ embedUrl: out.EmbedUrl });
  } catch (e) {
    console.error("embed-url error:", e.name, e.message);
    res.status(500).json({ error: e.name, message: e.message });
  }
});

app.listen(PORT, () =>
  console.log(`Embed server on http://localhost:${PORT} (region ${REGION}, dashboard ${DASHBOARD_ID})`)
);
