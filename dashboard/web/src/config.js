/**
 * Runtime configuration for AWS / QuickSight connectivity.
 *
 * All values come from Vite env vars (set in .env.local). When they're unset,
 * the app runs in local-preview mode and the Settings → AWS Connection panel
 * reports exactly what's missing. Connecting real AWS is therefore a
 * config-only change — no code edits.
 */
export const config = {
  region: import.meta.env.VITE_AWS_REGION || "",
  accountId: import.meta.env.VITE_AWS_ACCOUNT_ID || "",
  dashboardId: import.meta.env.VITE_QS_DASHBOARD_ID || "",
  embedEndpoint: import.meta.env.VITE_QS_EMBED_ENDPOINT || "",
};

/** A single requirement's status for the AWS Connection panel. */
function check(label, value, hint) {
  return { label, value: value || null, ok: Boolean(value), hint };
}

/** Structured connection status used by the Settings panel + embed banner. */
export function connectionStatus() {
  const checks = [
    check("AWS region", config.region, "VITE_AWS_REGION — must be me-central-1 (UAE/Dubai) for data residency"),
    check("AWS account id", config.accountId, "VITE_AWS_ACCOUNT_ID — the account hosting QuickSight"),
    check("QuickSight dashboard id", config.dashboardId, "VITE_QS_DASHBOARD_ID — id of the published dashboard"),
    check("Embed URL endpoint", config.embedEndpoint, "VITE_QS_EMBED_ENDPOINT — your backend that mints a principal-scoped embed URL"),
  ];
  const connected = checks.every((c) => c.ok);
  const regionOk = !config.region || config.region === "me-central-1";
  return { connected, checks, regionOk, region: config.region };
}

export function isEmbedConfigured() {
  return Boolean(config.embedEndpoint);
}
