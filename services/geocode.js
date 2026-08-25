/**
 * Address → lat/lng. Google Geocoding when GOOGLE_MAPS_API_KEY is set,
 * Nominatim fallback (see services/places.js).
 */
const { geocodeAddress: geocodeQuery } = require("./places");

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
  return geocodeQuery(query);
}

module.exports = { geocodeAddress };
