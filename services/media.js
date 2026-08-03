const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const UPLOADS_ROOT = path.join(__dirname, "..", "uploads");

/**
 * Save a data-URL / base64 image to disk and return a short public path
 * like `/uploads/samples/abc123.jpg` — so MongoDB stores a readable URL,
 * not a multi-MB base64 blob that Compass truncates.
 *
 * If the input is already an http(s) URL or /uploads path, return as-is.
 */
function saveDataUrlImage(input, folder = "samples") {
  const raw = String(input || "").trim();
  if (!raw) return "";

  if (raw.startsWith("http://") || raw.startsWith("https://") || raw.startsWith("/uploads/")) {
    return raw;
  }

  const match = raw.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
  if (!match) {
    // Unknown format — keep original (legacy)
    return raw.startsWith("data:") ? "" : raw;
  }

  const mime = match[1].toLowerCase();
  const b64 = match[2];
  const ext =
    mime.includes("png") ? "png" :
    mime.includes("webp") ? "webp" :
    mime.includes("gif") ? "gif" : "jpg";

  const dir = path.join(UPLOADS_ROOT, folder);
  fs.mkdirSync(dir, { recursive: true });

  const name = `${Date.now()}_${crypto.randomBytes(4).toString("hex")}.${ext}`;
  const filePath = path.join(dir, name);
  fs.writeFileSync(filePath, Buffer.from(b64, "base64"));

  return `/uploads/${folder}/${name}`;
}

/** Expand relative /uploads/... to absolute URL for the mobile app. */
function absoluteMediaUrl(url) {
  if (!url) return url;
  if (url.startsWith("http://") || url.startsWith("https://") || url.startsWith("data:")) {
    return url;
  }
  const base = String(process.env.PUBLIC_BASE_URL || "").replace(/\/$/, "");
  if (!base) return url;
  return `${base}${url.startsWith("/") ? url : `/${url}`}`;
}

/** Merge legacy single photoUrl with photoUrls[] into one unique list. */
function coalescePhotoUrls(photoUrl, photoUrls) {
  const list = [];
  if (Array.isArray(photoUrls)) {
    for (const u of photoUrls) {
      const s = String(u || "").trim();
      if (s && !list.includes(s)) list.push(s);
    }
  }
  const primary = String(photoUrl || "").trim();
  if (primary && !list.includes(primary)) list.unshift(primary);
  return list;
}

function absoluteMediaUrls(urls) {
  return (Array.isArray(urls) ? urls : []).map(absoluteMediaUrl).filter(Boolean);
}

module.exports = {
  saveDataUrlImage,
  absoluteMediaUrl,
  absoluteMediaUrls,
  coalescePhotoUrls,
  UPLOADS_ROOT,
};
