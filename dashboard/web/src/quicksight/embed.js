/**
 * QuickSight embed integration (production path).
 *
 * When AWS is configured, the Analytics page embeds the REAL QuickSight
 * dashboard built by the rest of this project (quicksight/03_analysis_definition.json).
 * Flow:
 *   1. Your backend calls QuickSight generate-embed-url-for-registered-user
 *      (scoped to the signed-in principal; RLS applies server-side).
 *   2. It returns an EmbedUrl.
 *   3. We call createEmbeddingContext().embedDashboard({ url }) to render it.
 *
 * Until a backend embed endpoint exists, getEmbedUrl() returns null and the
 * Analytics page renders the local-mock charts instead. No rework needed when
 * AWS goes live — only VITE_QS_EMBED_ENDPOINT has to be set.
 */
import { createEmbeddingContext } from "amazon-quicksight-embedding-sdk";
import { config, isEmbedConfigured } from "../config.js";

export { isEmbedConfigured };

/**
 * Ask the backend for an embed URL for the current principal.
 * The backend MUST scope the URL to the authenticated user so RLS is enforced.
 */
export async function getEmbedUrl(principalId) {
  if (!config.embedEndpoint) return null;
  const res = await fetch(config.embedEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ principalId }),
    credentials: "include",
  });
  if (!res.ok) throw new Error(`embed endpoint returned ${res.status}`);
  const { embedUrl } = await res.json();
  return embedUrl;
}

/** Mount the embedded dashboard into `container`. */
export async function embedDashboard(container, embedUrl) {
  const context = await createEmbeddingContext();
  await context.embedDashboard({
    url: embedUrl,
    container,
    height: "800px",
    width: "100%",
    resizeHeightOnSizeChangedEvent: true,
  });
}
