/**
 * Partner website se test catalog fetch (Wello: GET /get_product).
 * Agar partner URL galat / unreachable ho to past jobs se fallback list.
 */
const Job = require("../Models/Job");

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

function friendlyCatalogError(raw, base) {
  const msg = String(raw || "").trim();
  const lower = msg.toLowerCase();
  if (
    lower === "route not found" ||
    lower.includes("cannot get") ||
    /\/get_product/i.test(msg)
  ) {
    return (
      `Partner catalog URL galat hai (${base || "—"}) — ` +
      `WELLO_CATALOG_API_BASE / Client.catalogApiUrl pe Wello ka /get_product API hona chahiye, PhleboHub nahi`
    );
  }
  if (/abort|timeout|econnrefused|fetch failed|network/i.test(msg)) {
    return `Partner catalog unreachable (${base || "—"})`;
  }
  return msg || `Catalog fetch failed (${base || "—"})`;
}

async function fetchFromApi(base, { city } = {}) {
  const params = new URLSearchParams({ status: "true" });
  if (city) params.set("city", String(city).trim());

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);

  let res;
  try {
    res = await fetch(`${base}/get_product?${params}`, { signal: controller.signal });
  } catch (err) {
    throw new Error(friendlyCatalogError(err.message, base));
  } finally {
    clearTimeout(timer);
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(friendlyCatalogError(data.message || `HTTP ${res.status}`, base));
  }

  return data.data || [];
}

/** Recent bookings se unique tests — partner catalog down ho to phlebo phir bhi search kar sake. */
async function fallbackCatalogFromJobs(client, { city, search } = {}) {
  if (!client?._id) return { tests: [], catalogScope: "none", total: 0 };

  const filter = { clientId: client._id };
  const cityName = String(city || "").trim();
  if (cityName) filter.city = cityName;

  const jobs = await Job.find(filter)
    .sort({ createdAt: -1 })
    .limit(250)
    .select("items")
    .lean();

  const byId = new Map();
  for (const job of jobs) {
    for (const item of job.items || []) {
      const name = String(item.name || "").trim();
      if (!name) continue;
      const productId = String(item.productId || "").trim() || `hist-${name.toLowerCase()}`;
      if (byId.has(productId)) continue;
      if (/^manual-/i.test(productId) && byId.has(`hist-${name.toLowerCase()}`)) continue;
      byId.set(productId, {
        productId,
        name,
        price: Number(item.price) || 0,
        category: item.category || "",
        itemType: "Test",
        sku: "",
      });
    }
  }

  let tests = [...byId.values()];
  const q = String(search || "").trim().toLowerCase();
  if (q) {
    tests = tests.filter(
      (t) =>
        t.name.toLowerCase().includes(q) ||
        t.category.toLowerCase().includes(q)
    );
  }
  tests.sort((a, b) => a.name.localeCompare(b.name));
  return { tests, catalogScope: "history", total: tests.length };
}

async function fetchTestCatalog(client, { city, search } = {}) {
  const base = (client?.catalogApiUrl || DEFAULT_CATALOG_BASE).replace(/\/$/, "");
  const cityName = String(city || "").trim();
  let rawProducts = [];
  let catalogScope = "all";
  let partnerError = "";

  try {
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
  } catch (err) {
    partnerError = err.message || "Catalog unavailable";
    console.warn("[catalog]", partnerError);
  }

  if (rawProducts.length) {
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

  const fallback = await fallbackCatalogFromJobs(client, { city: cityName, search });
  return {
    ...fallback,
    warning: partnerError || (fallback.total ? "" : "No catalog tests — add manually"),
  };
}

async function fetchTestById(client, productId, city) {
  const base = (client?.catalogApiUrl || DEFAULT_CATALOG_BASE).replace(/\/$/, "");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  let res;
  try {
    res = await fetch(`${base}/get_product/${productId}`, { signal: controller.signal });
  } catch (err) {
    throw new Error(friendlyCatalogError(err.message, base));
  } finally {
    clearTimeout(timer);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.data) {
    throw new Error(
      friendlyCatalogError(data.message || "Test not found in catalog", base)
    );
  }
  return mapProduct(data.data, city);
}

module.exports = { fetchTestCatalog, fetchTestById, resolvePrice };
