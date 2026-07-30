/**
 * Address → lat/lng geocoding.
 *
 * Uses OpenStreetMap Nominatim (free, no API key) so this works out of the box in
 * dev/demo without any extra setup. Nominatim's usage policy caps free requests at
 * ~1/sec, so this is only called on the job-creation path (low volume), never in a
 * hot loop or per-request on read paths.
 *
 * Swap-out note: if volume/accuracy needs grow, replace the fetch below with Google's
 * Geocoding API (needs GOOGLE_MAPS_API_KEY) — keep the same `{ lat, lng } | null`
 * return shape so callers (PartnerRoute, admin order creation) don't need to change.
 */
const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";
// Nominatim requires a real identifying User-Agent (not the default fetch one) or it
// will reject/block requests — set GEOCODE_USER_AGENT in .env in production.
const USER_AGENT =
  process.env.GEOCODE_USER_AGENT || "WelloPhleboBackend/1.0 (contact: ops@wello.local)";

/**
 * @param {{address?:string, area?:string, city?:string, state?:string, pincode?:string}} parts
 * @returns {Promise<{lat:number, lng:number}|null>}
 */
async function geocodeAddress(parts = {}) {
  const query = [parts.address, parts.area, parts.city, parts.state, parts.pincode, "India"]
    .filter(Boolean)
    .join(", ")
    .trim();
  if (!query) return null;

  try {
    const url = `${NOMINATIM_URL}?format=json&limit=1&q=${encodeURIComponent(query)}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 6000);

    const res = await fetch(url, {
      headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) return null;

    const results = await res.json();
    const hit = Array.isArray(results) ? results[0] : null;
    if (!hit) return null;

    const lat = Number(hit.lat);
    const lng = Number(hit.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

    return { lat, lng };
  } catch (err) {
    console.warn("[geocode] failed:", err.message);
    return null;
  }
}

module.exports = { geocodeAddress };
