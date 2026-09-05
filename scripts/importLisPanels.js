require("dotenv").config();
const mongoose = require("mongoose");
const XLSX = require("xlsx");
const fs = require("fs");
const path = require("path");
const { normalizeRow, upsertPanels, rowsFromUpload } = require("../services/lisPanels");

const DEFAULT_XLSX = path.join(
  "C:/Users/Rohit Upadhyay/Downloads",
  "PUPMasterData (5) (1).xlsx"
);

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

(async () => {
  const excelPath = process.argv[2] || DEFAULT_XLSX;
  if (!fs.existsSync(excelPath)) {
    console.error("Excel not found:", excelPath);
    process.exit(1);
  }

  const wb = XLSX.readFile(excelPath);
  const aoa = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], {
    header: 1,
    defval: "",
  });
  const raw = rowsFromAoA(aoa);
  const panels = [];
  const seen = new Set();
  for (const r of raw) {
    const n = normalizeRow(r);
    if (!n || !n.isActive) continue;
    if (seen.has(n.panelId)) continue;
    seen.add(n.panelId);
    panels.push({
      panelId: n.panelId,
      name: n.name,
      centreId: n.centreId,
      referenceCode: n.referenceCode,
    });
  }

  const outFile = path.join(__dirname, "..", "data", "lisPanels.json");
  fs.writeFileSync(outFile, JSON.stringify(panels));
  console.log("Wrote", panels.length, "clients to data/lisPanels.json");

  const uri = process.env.MONGO_URI;
  if (!uri) {
    console.log("No MONGO_URI — JSON only");
    process.exit(0);
  }
  await mongoose.connect(uri);
  const result = await upsertPanels(panels);
  console.log("Mongo upsert", result);
  await mongoose.disconnect();
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
