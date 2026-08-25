/**
 * Address suggest + geocode.
 * Google Places when GOOGLE_MAPS_API_KEY is set — Nominatim fallback.
 */
const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";
const USER_AGENT =
  process.env.GEOCODE_USER_AGENT || "MDRC-PhleboBackend/1.0 (ops@wello.local)";

function mapsKey() {
  return String(process.env.GOOGLE_MAPS_API_KEY || "").trim();
}

async function fetchJson(url, opts = {}, timeoutMs = 4000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...opts, signal: controller.signal });
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, data };
  } finally {
    clearTimeout(timer);
  }
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

async function googleSuggestNew(query) {
  const key = mapsKey();
  if (!key) return null;
  const { ok, data } = await fetchJson("https://places.googleapis.com/v1/places:autocomplete", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": key,
      "X-Goog-FieldMask":
        "suggestions.placePrediction.placeId,suggestions.placePrediction.text,suggestions.placePrediction.structuredFormat",
    },
    body: JSON.stringify({
      input: query,
      includedRegionCodes: ["in"],
      languageCode: "en",
    }),
  });
  if (!ok || !Array.isArray(data.suggestions)) return null;
  return data.suggestions
    .map((s) => s.placePrediction)
    .filter(Boolean)
    .map((p) => ({
      id: String(p.placeId || "").replace(/^places\//, ""),
      label: p.structuredFormat?.mainText?.text || p.text?.text || "",
      secondary: p.structuredFormat?.secondaryText?.text || "",
      lat: null,
      lng: null,
      source: "google",
    }))
    .filter((x) => x.id && x.label);
}

async function googleSuggestLegacy(query) {
  const key = mapsKey();
  if (!key) return null;
  const url =
    "https://maps.googleapis.com/maps/api/place/autocomplete/json" +
    `?input=${encodeURIComponent(query)}&components=country:in&language=en&key=${encodeURIComponent(key)}`;
  const { data } = await fetchJson(url);
  if (data.status !== "OK" && data.status !== "ZERO_RESULTS") return null;
  const preds = Array.isArray(data.predictions) ? data.predictions : [];
  return preds.map((p) => ({
    id: p.place_id,
    label: p.structured_formatting?.main_text || p.description || "",
    secondary: p.structured_formatting?.secondary_text || "",
    lat: null,
    lng: null,
    source: "google",
  }));
}

async function nominatimSuggest(query) {
  const url = `${NOMINATIM_URL}?format=json&limit=6&countrycodes=in&q=${encodeURIComponent(query)}`;
  const { ok, data } = await fetchJson(url, {
    headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
  });
  if (!ok || !Array.isArray(data)) return [];
  return data
    .map((hit) => {
      const lat = num(hit.lat);
      const lng = num(hit.lon);
      if (lat == null || lng == null) return null;
      const label = String(hit.display_name || "").trim();
      return {
        id: `osm:${hit.place_id}:${lat}:${lng}`,
        label,
        secondary: "",
        lat,
        lng,
        source: "osm",
      };
    })
    .filter(Boolean);
}

async function suggestPlaces(query) {
  const q = String(query || "").trim();
  if (q.length < 3) return [];
  try {
    const fresh = (await googleSuggestNew(q)) || (await googleSuggestLegacy(q));
    if (Array.isArray(fresh) && fresh.length) return fresh.slice(0, 6);
  } catch (err) {
    console.warn("[places] google suggest failed:", err.message);
  }
  try {
    return await nominatimSuggest(q);
  } catch (err) {
    console.warn("[places] nominatim suggest failed:", err.message);
    return [];
  }
}

async function googleDetailsNew(placeId) {
  const key = mapsKey();
  if (!key || !placeId) return null;
  const id = String(placeId).replace(/^places\//, "");
  const { ok, data } = await fetchJson(
    `https://places.googleapis.com/v1/places/${encodeURIComponent(id)}`,
    {
      headers: {
        "X-Goog-Api-Key": key,
        "X-Goog-FieldMask": "id,displayName,formattedAddress,location",
      },
    }
  );
  if (!ok || !data.location) return null;
  const lat = num(data.location.latitude);
  const lng = num(data.location.longitude);
  if (lat == null || lng == null) return null;
  return {
    address: data.formattedAddress || data.displayName?.text || "",
    lat,
    lng,
  };
}

async function googleDetailsLegacy(placeId) {
  const key = mapsKey();
  if (!key || !placeId) return null;
  const url =
    "https://maps.googleapis.com/maps/api/place/details/json" +
    `?place_id=${encodeURIComponent(placeId)}&fields=formatted_address,geometry,name&key=${encodeURIComponent(key)}`;
  const { data } = await fetchJson(url);
  if (data.status !== "OK" || !data.result?.geometry?.location) return null;
  const lat = num(data.result.geometry.location.lat);
  const lng = num(data.result.geometry.location.lng);
  if (lat == null || lng == null) return null;
  return {
    address: data.result.formatted_address || data.result.name || "",
    lat,
    lng,
  };
}

function parseOsmId(id) {
  const m = String(id || "").match(/^osm:([^:]+):(-?\d+\.?\d*):(-?\d+\.?\d*)$/);
  if (!m) return null;
  const lat = num(m[2]);
  const lng = num(m[3]);
  if (lat == null || lng == null) return null;
  return { lat, lng };
}

async function resolvePlace(id, fallbackLabel = "") {
  const osm = parseOsmId(id);
  if (osm) {
    return { address: fallbackLabel, lat: osm.lat, lng: osm.lng };
  }
  try {
    const hit = (await googleDetailsNew(id)) || (await googleDetailsLegacy(id));
    if (hit) return hit;
  } catch (err) {
    console.warn("[places] google details failed:", err.message);
  }
  if (fallbackLabel) {
    const geo = await geocodeAddress(fallbackLabel);
    if (geo) return { address: fallbackLabel, ...geo };
  }
  return null;
}

async function geocodeAddress(address) {
  const query = String(address || "").trim();
  if (!query) return null;
  const key = mapsKey();
  if (key) {
    try {
      const url =
        "https://maps.googleapis.com/maps/api/geocode/json" +
        `?address=${encodeURIComponent(query)}&region=in&key=${encodeURIComponent(key)}`;
      const { data } = await fetchJson(url);
      const loc = data.results?.[0]?.geometry?.location;
      const lat = num(loc?.lat);
      const lng = num(loc?.lng);
      if (lat != null && lng != null) return { lat, lng };
    } catch (err) {
      console.warn("[places] google geocode failed:", err.message);
    }
  }
  try {
    const hits = await nominatimSuggest(query);
    if (hits[0]) return { lat: hits[0].lat, lng: hits[0].lng };
  } catch (err) {
    console.warn("[places] nominatim geocode failed:", err.message);
  }
  return null;
}

async function coordsForAddress(address, lat, lng) {
  if (lat == null || lng == null || lat === "" || lng === "") {
    const geo = await geocodeAddress(address);
    return geo || { lat: null, lng: null };
  }
  const a = Number(lat);
  const b = Number(lng);
  if (Number.isFinite(a) && Number.isFinite(b)) return { lat: a, lng: b };
  const geo = await geocodeAddress(address);
  return geo || { lat: null, lng: null };
}

module.exports = { suggestPlaces, resolvePlace, geocodeAddress, coordsForAddress };
