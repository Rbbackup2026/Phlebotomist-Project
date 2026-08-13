/**
 * Test catalog fetch — LIS rate-list API (primary) ya legacy Wello GET /get_product.
 * Agar remote catalog down ho to past jobs se fallback list.
 */
const Job = require("../Models/Job");

const DEFAULT_LIS_URL = (process.env.LIS_CATALOG_API_URL || "").replace(/\/$/, "");
const DEFAULT_WELLO_BASE = (
  process.env.WELLO_CATALOG_API_BASE || "http://localhost:3000/v1/api"
).replace(/\/$/, "");

function resolveCatalogEndpoint(client) {
  // Env LIS URL wins so stale Client.catalogApiUrl (old Wello) block na kare
  if (DEFAULT_LIS_URL) return DEFAULT_LIS_URL;
  const fromClient = String(client?.catalogApiUrl || "").trim().replace(/\/$/, "");
  if (fromClient) return fromClient;
  return DEFAULT_WELLO_BASE;
}

/** True when URL is a full LIS endpoint (not Wello /v1/api base). */
function isLisEndpoint(url) {
  const u = String(url || "").toLowerCase();
  if (!u) return false;
  if (/\/get_product(\/|$|\?)/i.test(u)) return false;
  if (/\/v1\/api$/i.test(u)) return false;
  if (DEFAULT_LIS_URL && u === DEFAULT_LIS_URL.toLowerCase()) return true;
  if (/lis|ratelist|getitem|itemrate|get_item|getitems/i.test(u)) return true;
  // Explicit provider flag only when URL is not the legacy Wello base shape
  if (String(process.env.CATALOG_PROVIDER || "").toLowerCase() === "lis") return true;
  return false;
}

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

function mapWelloProduct(p, city) {
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

/** Map LIS rate-list row → Phlebo catalog test shape. */
function mapLisItem(row) {
  const rate = Number(row.Rate);
  const schedule = Number(row.ScheduleRate);
  const price =
    Number.isFinite(schedule) && schedule > 0
      ? schedule
      : Number.isFinite(rate)
        ? rate
        : 0;

  return {
    productId: String(row.itemid || row.itemcode || "").trim(),
    name: String(row.itemname || "").trim(),
    price,
    category: String(row.DepartmentName || "").trim(),
    itemType: String(row.ItemType || "Test").trim() || "Test",
    sku: String(row.itemcode || "").trim(),
    labName: String(row.LabName || "").trim(),
    labId: String(row.LabID || "").trim(),
    labCode: String(row.LabCode || "").trim(),
  };
}

function isLisRow(row) {
  return row && (row.itemid != null || row.itemname != null);
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

function filterLisByCity(rows, city) {
  const cityName = String(city || "").trim();
  if (!cityName || !rows.length) return rows;
  const needles = cityFallbacks(cityName).map((n) => n.toLowerCase());
  const matched = rows.filter((r) => {
    const lab = String(r.LabName || "").toLowerCase();
    return needles.some((n) => lab.includes(n.toLowerCase()));
  });
  return matched.length ? matched : rows;
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
      `Catalog URL galat hai (${base || "—"}) — ` +
      `LIS_CATALOG_API_URL / Client.catalogApiUrl pe LIS rate-list endpoint set karo`
    );
  }
  if (/abort|timeout|econnrefused|fetch failed|network/i.test(msg)) {
    return `Catalog unreachable (${base || "—"})`;
  }
  return msg || `Catalog fetch failed (${base || "—"})`;
}

async function httpJson(url, { method = "GET", body, contentType, timeoutMs = 20000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res;
  try {
    const headers = { Accept: "application/json" };
    const token = String(process.env.LIS_CATALOG_API_TOKEN || "").trim();
    if (token) headers.Authorization = `Bearer ${token}`;

    const opts = { method, signal: controller.signal, headers };
    if (body !== undefined) {
      const ct = contentType || "application/json";
      headers["Content-Type"] = ct;
      if (ct.includes("application/x-www-form-urlencoded")) {
        opts.body =
          typeof body === "string"
            ? body
            : new URLSearchParams(
                Object.entries(body).reduce((acc, [k, v]) => {
                  acc[k] = v == null ? "" : String(v);
                  return acc;
                }, {})
              ).toString();
      } else {
        opts.body = typeof body === "string" ? body : JSON.stringify(body);
      }
    }
    res = await fetch(url, opts);
  } catch (err) {
    throw new Error(friendlyCatalogError(err.message, url));
  } finally {
    clearTimeout(timer);
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(
      friendlyCatalogError(data.message || data.Message || `HTTP ${res.status}`, url)
    );
  }
  return data;
}

function lisRequestBody() {
  const raw = String(process.env.LIS_CATALOG_REQUEST_BODY || "").trim();
  if (raw) {
    // support both JSON object and raw form string: PanelID=78
    if (raw.includes("=") && !raw.trim().startsWith("{")) {
      return raw;
    }
    try {
      return JSON.parse(raw);
    } catch {
      console.warn("[catalog] LIS_CATALOG_REQUEST_BODY invalid — using PanelID fallback");
    }
  }
  const panelId = String(process.env.LIS_PANEL_ID || "78").trim();
  const labId = String(process.env.LIS_LAB_ID || "").trim();
  const body = {};
  if (panelId) body.PanelID = panelId;
  if (labId) body.LabID = labId;
  return body;
}

async function fetchFromWello(base, { city } = {}) {
  const params = new URLSearchParams({ status: "true" });
  if (city) params.set("city", String(city).trim());
  const data = await httpJson(`${base}/get_product?${params}`);
  return data.data || [];
}

async function fetchFromLis(endpoint, { city } = {}) {
  // MDRC GetItemListPanel: POST + form-urlencoded PanelID=78 (JSON body returns [])
  const method = String(process.env.LIS_CATALOG_HTTP_METHOD || "POST").toUpperCase();
  const contentType =
    process.env.LIS_CATALOG_CONTENT_TYPE ||
    "application/x-www-form-urlencoded";
  const data = await httpJson(endpoint, {
    method,
    body: method === "GET" ? undefined : lisRequestBody(),
    contentType: method === "GET" ? undefined : contentType,
    timeoutMs: 60000,
  });
  let rows = Array.isArray(data.data) ? data.data : Array.isArray(data) ? data : [];
  if (data.status === false) {
    throw new Error(friendlyCatalogError(data.message || "LIS catalog status false", endpoint));
  }
  if (!rows.length) {
    console.warn(
      "[catalog] LIS returned 0 tests — check PanelID form body (PanelID=78)"
    );
  }
  rows = filterLisByCity(rows, city);
  return rows;
}

/** Recent bookings se unique tests — catalog down ho to phlebo phir bhi search kar sake. */
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

function mapRawRows(rawProducts, city) {
  if (!rawProducts.length) return [];
  if (isLisRow(rawProducts[0])) {
    return rawProducts.map(mapLisItem).filter((t) => t.productId && t.name);
  }
  return rawProducts.map((p) => mapWelloProduct(p, city));
}

async function fetchRawCatalog(endpoint, { city } = {}) {
  const cityName = String(city || "").trim();

  if (isLisEndpoint(endpoint)) {
    if (cityName) {
      for (const tryCity of cityFallbacks(cityName)) {
        const rows = await fetchFromLis(endpoint, { city: tryCity });
        if (rows.length) return { rawProducts: rows, catalogScope: tryCity };
      }
    }
    const rows = await fetchFromLis(endpoint, {});
    return { rawProducts: rows, catalogScope: "all" };
  }

  // Legacy Wello
  if (cityName) {
    for (const tryCity of cityFallbacks(cityName)) {
      const rows = await fetchFromWello(endpoint, { city: tryCity });
      if (rows.length) return { rawProducts: rows, catalogScope: tryCity };
    }
  }
  const rows = await fetchFromWello(endpoint, {});
  return { rawProducts: rows, catalogScope: "all" };
}

async function fetchTestCatalog(client, { city, search } = {}) {
  const endpoint = resolveCatalogEndpoint(client);
  const cityName = String(city || "").trim();
  let rawProducts = [];
  let catalogScope = "all";
  let partnerError = "";

  try {
    const result = await fetchRawCatalog(endpoint, { city: cityName });
    rawProducts = result.rawProducts;
    catalogScope = result.catalogScope;
  } catch (err) {
    partnerError = err.message || "Catalog unavailable";
    console.warn("[catalog]", partnerError);
  }

  if (rawProducts.length) {
    let tests = mapRawRows(rawProducts, cityName || catalogScope);
    const q = String(search || "").trim().toLowerCase();
    if (q) {
      tests = tests.filter(
        (t) =>
          t.name.toLowerCase().includes(q) ||
          String(t.sku || "")
            .toLowerCase()
            .includes(q) ||
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
  const endpoint = resolveCatalogEndpoint(client);
  const id = String(productId || "").trim();

  if (isLisEndpoint(endpoint)) {
    const { rawProducts } = await fetchRawCatalog(endpoint, { city });
    const row = rawProducts.find(
      (r) =>
        String(r.itemid || "") === id ||
        String(r.itemcode || "") === id
    );
    if (!row) throw new Error(friendlyCatalogError("Test not found in LIS catalog", endpoint));
    return mapLisItem(row);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  let res;
  try {
    res = await fetch(`${endpoint}/get_product/${id}`, {
      signal: controller.signal,
    });
  } catch (err) {
    throw new Error(friendlyCatalogError(err.message, endpoint));
  } finally {
    clearTimeout(timer);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.data) {
    throw new Error(
      friendlyCatalogError(data.message || "Test not found in catalog", endpoint)
    );
  }
  return mapWelloProduct(data.data, city);
}

module.exports = {
  fetchTestCatalog,
  fetchTestById,
  resolvePrice,
  mapLisItem,
  isLisEndpoint,
};
