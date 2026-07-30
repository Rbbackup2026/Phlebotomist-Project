/**
 * Partner website se test catalog fetch (Wello: GET /get_product).
 */
const DEFAULT_CATALOG_BASE =
  process.env.WELLO_CATALOG_API_BASE || "http://localhost:3000/v1/api";

function resolvePrice(product, city) {
  const cityName = String(city || "").trim();
  if (cityName && Array.isArray(product.cityPricing)) {
    const entry = product.cityPricing.find(
      (c) => String(c.city || "").toLowerCase() === cityName.toLowerCase()
    );
    if (entry) {
      if (entry.price && entry.price > 0) return entry.price;
      if (entry.schedulePrice && entry.schedulePrice > 0) return entry.schedulePrice;
      if (entry.mrp) return entry.mrp;
    }
  }
  if (product.schedulePrice && product.schedulePrice > 0) return product.schedulePrice;
  if (product.price) return product.price;
  return product.mrp || 0;
}

function mapProduct(p, city) {
  const cat = p.category;
  return {
    productId: String(p._id),
    name: p.name || "",
    price: resolvePrice(p, city),
    category:
      cat && typeof cat === "object" ? cat.name || "" : String(cat || ""),
    itemType: p.itemType || "Test",
    sku: p.sku || "",
  };
}

function cityFallbacks(city) {
  const c = String(city || "").trim();
  if (!c) return [];
  const list = [c];
  if (/new\s+delhi/i.test(c)) list.push("Delhi");
  if (/delhi/i.test(c) && !list.includes("Delhi")) list.push("Delhi");
  if (/gurugram|gurgaon/i.test(c)) list.push("Gurgaon", "Gurugram");
  if (/bengaluru|bangalore/i.test(c)) list.push("Bangalore", "Bengaluru");
  return [...new Set(list)];
}

async function fetchFromApi(base, { city } = {}) {
  const params = new URLSearchParams({ status: "true" });
  if (city) params.set("city", String(city).trim());

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);

  let res;
  try {
    res = await fetch(`${base}/get_product?${params}`, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.message || `Catalog fetch failed (${res.status})`);
  }

  return data.data || [];
}

async function fetchTestCatalog(client, { city, search } = {}) {
  const base = (client?.catalogApiUrl || DEFAULT_CATALOG_BASE).replace(/\/$/, "");
  const cityName = String(city || "").trim();
  let rawProducts = [];
  let catalogScope = "all";

  if (cityName) {
    for (const tryCity of cityFallbacks(cityName)) {
      rawProducts = await fetchFromApi(base, { city: tryCity });
      if (rawProducts.length) {
        catalogScope = tryCity;
        break;
      }
    }
  }

  // City match na ho to saare active tests dikhao (phlebo ko empty list nahi)
  if (!rawProducts.length) {
    rawProducts = await fetchFromApi(base, {});
    catalogScope = "all";
  }

  let tests = rawProducts.map((p) => mapProduct(p, cityName || catalogScope));

  const q = String(search || "").trim().toLowerCase();
  if (q) {
    tests = tests.filter(
      (t) =>
        t.name.toLowerCase().includes(q) ||
        t.sku.toLowerCase().includes(q) ||
        t.category.toLowerCase().includes(q)
    );
  }

  tests.sort((a, b) => a.name.localeCompare(b.name));
  return { tests, catalogScope, total: tests.length };
}

async function fetchTestById(client, productId, city) {
  const base = (client?.catalogApiUrl || DEFAULT_CATALOG_BASE).replace(/\/$/, "");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  let res;
  try {
    res = await fetch(`${base}/get_product/${productId}`, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.data) {
    throw new Error(data.message || "Test not found in catalog");
  }
  return mapProduct(data.data, city);
}

module.exports = { fetchTestCatalog, fetchTestById, resolvePrice };
