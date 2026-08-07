/**
 * Temporarily hide Wello from admin UI.
 * Unhide later: set HIDE_WELLO_CLIENT = false
 */
export const HIDE_WELLO_CLIENT = true;

/** Label shown instead of "Wello" for walk-in / internal bookings. */
export const DIRECT_SOURCE_LABEL = "Direct / Walk-in";

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

/**
 * Sources for New Order picker.
 * Agar koi visible partner nahi (sirf Wello hide hai) to Wello ko
 * "Direct / Walk-in" label se dikhao — order create chal sake, naam na dikhe.
 */
export function sourceOptionsForBooking(list = []) {
  const visible = visibleClients(list).map((c) => ({
    _id: c._id,
    slug: c.slug,
    name: c.name,
    label: c.name,
  }));
  if (visible.length > 0) return visible;

  return (list || [])
    .filter((c) => isHiddenClient(c))
    .map((c) => ({
      _id: c._id,
      slug: c.slug,
      name: c.name,
      label: DIRECT_SOURCE_LABEL,
    }));
}

/** Source column / labels — Wello → Direct / Walk-in (jab hide on ho). */
export function displaySource(orderOrClient) {
  if (!orderOrClient) return "—";
  if (
    isHiddenClient(orderOrClient) ||
    isHiddenClient(orderOrClient.clientSlug) ||
    isHiddenClient(orderOrClient.slug)
  ) {
    return DIRECT_SOURCE_LABEL;
  }
  return (
    orderOrClient.clientName ||
    orderOrClient.name ||
    orderOrClient.clientSlug ||
    orderOrClient.slug ||
    "—"
  );
}
