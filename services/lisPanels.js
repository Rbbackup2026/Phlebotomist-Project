const LisPanel = require("../Models/LisPanel");
const seedRows = require("../data/lisPanels.json");

function keyOf(header) {
  return String(header || "")
    .replace(/\s+/g, "")
    .replace(/[^a-z0-9]/gi, "")
    .toLowerCase();
}

function pick(row, keys) {
  const map = {};
  for (const [k, v] of Object.entries(row || {})) map[keyOf(k)] = v;
  for (const k of keys) {
    if (map[k] != null && String(map[k]).trim() !== "") return String(map[k]).trim();
  }
  return "";
}

function normalizeRow(row) {
  const panelId = pick(row, ["panelid", "panelcode", "clientcode", "clientid"]);
  if (!panelId) return null;
  const name = pick(row, ["companyname", "panelname", "name", "clientname"]);
  const centreId =
    pick(row, ["centreid", "centerid", "centr", "centre"]) || "1";
  const referenceCode = pick(row, ["referencecode", "referencecodeop"]);
  const activeRaw = pick(row, ["isactive", "active"]);
  const isActive = activeRaw === "" ? true : !["0", "false", "no"].includes(activeRaw.toLowerCase());
  return { panelId, name, centreId, referenceCode, isActive };
}

function parseCsv(text) {
  const raw = String(text || "").replace(/^\uFEFF/, "");
  const lines = raw.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return [];
  const split = (line) => {
    const out = [];
    let cur = "";
    let q = false;
    for (let i = 0; i < line.length; i += 1) {
      const ch = line[i];
      if (ch === '"') {
        if (q && line[i + 1] === '"') {
          cur += '"';
          i += 1;
        } else q = !q;
      } else if (ch === "," && !q) {
        out.push(cur.trim());
        cur = "";
      } else cur += ch;
    }
    out.push(cur.trim());
    return out;
  };
  let headerIdx = lines.findIndex((line) => /panel[_\s-]?id/i.test(line));
  if (headerIdx < 0) headerIdx = 0;
  const headers = split(lines[headerIdx]);
  return lines.slice(headerIdx + 1).map((line) => {
    const cols = split(line);
    const row = {};
    headers.forEach((h, i) => {
      row[h] = cols[i] || "";
    });
    return row;
  });
}

function rowsFromAoA(aoa) {
  if (!Array.isArray(aoa) || !aoa.length) return [];
  let headerIdx = aoa.findIndex(
    (r) => Array.isArray(r) && r.some((c) => /panel[_\s-]?id/i.test(String(c || "")))
  );
  if (headerIdx < 0) headerIdx = 0;
  const headers = (aoa[headerIdx] || []).map((h) => String(h || "").trim());
  return aoa.slice(headerIdx + 1).map((cols) => {
    const row = {};
    headers.forEach((h, i) => {
      row[h] = cols[i] == null ? "" : String(cols[i]).trim();
    });
    return row;
  });
}

function rowsFromUpload({ csv, panels, fileBase64, fileName }) {
  if (Array.isArray(panels) && panels.length) return panels;
  if (csv) return parseCsv(csv);
  if (fileBase64) {
    const buf = Buffer.from(String(fileBase64).replace(/^data:[^;]+;base64,/, ""), "base64");
    const name = String(fileName || "").toLowerCase();
    if (name.endsWith(".csv") || name.endsWith(".txt")) {
      return parseCsv(buf.toString("utf8"));
    }
    // eslint-disable-next-line global-require
    const XLSX = require("xlsx");
    const wb = XLSX.read(buf, { type: "buffer" });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const aoa = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });
    return rowsFromAoA(aoa);
  }
  return [];
}

async function seedLisPanelsIfEmpty() {
  const wanted = Array.isArray(seedRows) ? seedRows.length : 0;
  const count = await LisPanel.countDocuments();
  if (!wanted) return count;
  if (count >= wanted) return count;
  await upsertPanels(seedRows);
  return LisPanel.countDocuments();
}

async function upsertPanels(rows) {
  const ops = [];
  let skipped = 0;
  for (const raw of rows) {
    const row = normalizeRow(raw);
    if (!row) {
      skipped += 1;
      continue;
    }
    ops.push({
      updateOne: {
        filter: { panelId: row.panelId },
        update: { $set: row },
        upsert: true,
      },
    });
  }
  if (ops.length) {
    const chunk = 500;
    for (let i = 0; i < ops.length; i += chunk) {
      await LisPanel.bulkWrite(ops.slice(i, i + chunk), { ordered: false });
    }
  }
  const total = await LisPanel.countDocuments();
  return { upserted: ops.length, skipped, total };
}

async function searchPanels(q, limit = 40) {
  const query = String(q || "").trim();
  const filter = query
    ? {
        $or: [
          { panelId: new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i") },
          { name: new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i") },
        ],
      }
    : {};
  const [panels, total] = await Promise.all([
    LisPanel.find(filter).sort({ name: 1 }).limit(Math.min(80, Math.max(1, Number(limit) || 40))),
    LisPanel.countDocuments(),
  ]);
  return { panels, total, matched: query ? await LisPanel.countDocuments(filter) : total };
}

module.exports = {
  normalizeRow,
  seedLisPanelsIfEmpty,
  upsertPanels,
  searchPanels,
  parseCsv,
  rowsFromUpload,
};
