require("dotenv").config();
const path = require("path");
const fs = require("fs");
const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const morgan = require("morgan");
const { seedPlatform } = require("./services/seed");

/**
 * PhleboBackend — standalone product (own MongoDB).
 *
 *   Website (Wello / others)  --API key-->  POST /partner/jobs
 *   PhleboApp                 ------------>  /phlebo/* + /admin/*
 *   Status changes            --webhook--->  partner website
 */
const PORT = process.env.PORT || 3010;
const MONGO_URI = process.env.MONGO_URI || "mongodb://localhost:27017/phlebo";

// ─── Crash safety net ───────────────────────────────────────────────────────
// Har route already try/catch mein hai, lekin agar phir bhi kahin se koi
// unexpected error escape kare (bad library callback, timer, etc.), to Node
// process crash hoke poore server ko down nahi karega — sirf log hoga.
process.on("uncaughtException", (err) => {
  console.error("[uncaughtException] server survived:", err);
});
process.on("unhandledRejection", (reason) => {
  console.error("[unhandledRejection] server survived:", reason);
});

const app = express();
app.use(morgan("dev"));
app.use(cors({ origin: "*" }));
app.use(express.json({ limit: "15mb" }));
app.use(express.urlencoded({ extended: true, limit: "15mb" }));

// Sample / bag photos saved as files — short URL in MongoDB, image on disk
const UPLOADS_DIR = path.join(__dirname, "uploads");
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });
app.use("/uploads", express.static(UPLOADS_DIR));

app.get("/", (_req, res) => {
  res.json({
    ok: true,
    service: "phlebo-platform",
    mode: "standalone",
    message: "Own DB — multi-website partner API + field ops",
    db: mongoose.connection.name || null,
  });
});

app.get("/health", (_req, res) => {
  const state = mongoose.connection.readyState;
  res.status(state === 1 ? 200 : 503).json({
    ok: state === 1,
    phleboPort: PORT,
    mongo: state === 1 ? "connected" : "disconnected",
    db: mongoose.connection.name || null,
  });
});

app.use("/v1/api", require("./Route/AuthRoute"));
app.use("/v1/api", require("./Route/PartnerRoute"));
app.use("/v1/api", require("./Route/PhleboRoute"));
// Patient-facing tracking/rating/reschedule-request — no auth, keyed by trackingToken.
app.use("/v1/api/public", require("./Route/PublicRoute"));

// Admin web dashboard — built React app (admin-web/dist), served at /admin.
// Build it once with: cd admin-web && npm install && npm run build
const ADMIN_DIST = path.join(__dirname, "admin-web", "dist");
if (fs.existsSync(ADMIN_DIST)) {
  app.use("/admin", express.static(ADMIN_DIST));
  app.get("/admin/*", (_req, res) => {
    res.sendFile(path.join(ADMIN_DIST, "index.html"));
  });
} else {
  app.get("/admin", (_req, res) => {
    res.status(503).send(
      "Admin web not built yet. Run: cd admin-web && npm install && npm run build"
    );
  });
}

// 404 for unmatched /v1/api/* routes (JSON instead of Express's default HTML page)
app.use("/v1/api", (_req, res) => {
  res.status(404).json({ success: false, message: "Route not found" });
});

// Last-resort error middleware — agar koi route apne try/catch ke bawajood
// error ko next(err) se yahan tak forward kare, to server crash hone ke
// bajaye clean 500 JSON bhejega.
// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  console.error("[unhandled route error]", err);
  if (res.headersSent) return;
  res.status(500).json({ success: false, message: "Something went wrong" });
});

// Mongo connection ke baad bhi kabhi network hiccup se 'error' event aa sakta
// hai — agar iske liye koi listener na ho to Node isko throw kar deta hai aur
// process crash ho jaata hai. Listener laga ke sirf log karte hain.
mongoose.connection.on("error", (err) => {
  console.error("[mongo] connection error:", err.message);
});
mongoose.connection.on("disconnected", () => {
  console.warn("[mongo] disconnected — mongoose will retry automatically");
});

async function start() {
  await mongoose.connect(MONGO_URI);
  console.log("Connected DB:", mongoose.connection.name);
  await seedPlatform();

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`PhleboBackend :${PORT} (standalone, DB=${mongoose.connection.name})`);
    console.log("Partner API: POST /v1/api/partner/jobs  (Bearer apiKey)");
    console.log("PhleboApp → http://localhost:3010/v1/api");
  });
}

start().catch((err) => {
  console.error("Failed to start PhleboBackend:", err);
  process.exit(1);
});
