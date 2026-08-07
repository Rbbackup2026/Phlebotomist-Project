/**
 * Temporarily hide Wello from admin UI.
 * Unhide later: set HIDE_WELLO_CLIENT = false
 */
export const HIDE_WELLO_CLIENT = true;

const WELLO_SLUG = (import.meta.env.VITE_WELLO_CLIENT_SLUG || "wello").toLowerCase();

export function isHiddenClient(clientOrSlug) {
  if (!HIDE_WELLO_CLIENT) return false;
  if (!clientOrSlug) return false;
  if (typeof clientOrSlug === "string") {
    const s = clientOrSlug.toLowerCase().trim();
    return s === WELLO_SLUG || s === "wello";
  }
  const slug = String(clientOrSlug.slug || "").toLowerCase().trim();
  const name = String(clientOrSlug.name || clientOrSlug.clientName || "").toLowerCase().trim();
  return slug === WELLO_SLUG || slug === "wello" || name === "wello";
}

/** Drop Wello from dropdown / partner lists. */
export function visibleClients(list = []) {
  return (list || []).filter((c) => !isHiddenClient(c));
}

/** Source column / labels — Wello shows as em dash while hidden. */
export function displaySource(orderOrClient) {
  if (!orderOrClient) return "—";
  if (isHiddenClient(orderOrClient)) return "—";
  if (isHiddenClient(orderOrClient.clientSlug) || isHiddenClient(orderOrClient.slug)) return "—";
  return (
    orderOrClient.clientName ||
    orderOrClient.name ||
    orderOrClient.clientSlug ||
    orderOrClient.slug ||
    "—"
  );
}
