/**
 * Shared security helpers — secrets, env gates, DEMO OTP policy.
 * Production mein weak defaults reject; development mein local DX rehti hai.
 */

const isProduction = () => String(process.env.NODE_ENV || "").toLowerCase() === "production";

const WEAK_JWT_SECRETS = new Set([
  "",
  "defaultSecretKey",
  "phlebo-change-this-secret",
  "secret",
  "jwtsecret",
]);

const WEAK_SEED_KEYS = new Set(["", "phlebo-seed-dev", "seed", "changeme"]);

/**
 * JWT signing/verification secret.
 * Production: JWT_SECRET required and must not be a known weak value.
 * Dev: falls back to defaultSecretKey so local start still works.
 */
function getJwtSecret() {
  const secret = String(process.env.JWT_SECRET || "").trim();
  if (isProduction()) {
    if (!secret || WEAK_JWT_SECRETS.has(secret)) {
      throw new Error(
        "FATAL: Set a strong JWT_SECRET in production (.env). Do not use default/weak values."
      );
    }
    return secret;
  }
  return secret || "defaultSecretKey";
}

/**
 * Platform seed key for POST /partner/register-client.
 * Production: PLATFORM_SEED_KEY required (no weak default).
 */
function getPlatformSeedKey() {
  const key = String(process.env.PLATFORM_SEED_KEY || "").trim();
  if (isProduction()) {
    if (!key || WEAK_SEED_KEYS.has(key)) {
      throw new Error(
        "FATAL: Set a strong PLATFORM_SEED_KEY in production. Client registration is gated by this key."
      );
    }
    return key;
  }
  return key || "phlebo-seed-dev";
}

/**
 * DEMO OTP (123456) only outside production, and only if ALLOW_DEMO_OTP is not "false".
 * Production never accepts hardcoded DEMO OTP — even if someone sends 123456.
 */
function allowDemoOtp() {
  if (isProduction()) return false;
  return String(process.env.ALLOW_DEMO_OTP || "true").toLowerCase() !== "false";
}

const DEMO_OTP = "123456";

function isDemoOtp(otp) {
  return allowDemoOtp() && String(otp || "").trim() === DEMO_OTP;
}

/**
 * CORS origins from CORS_ORIGINS (comma-separated).
 * Empty in development → reflect request origin (cors origin: true-ish via callback).
 * Production with empty list → only same-origin / no browser cross-origin (origin false).
 */
function getCorsOriginOption() {
  const raw = String(process.env.CORS_ORIGINS || "").trim();
  const list = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  if (list.length === 0) {
    if (isProduction()) {
      // Mobile apps (Expo) don't send Origin the same way; allow non-browser clients.
      // Browser admin should be same-origin (/admin on same host) so CORS is unused.
      return false;
    }
    return true; // reflect any origin in dev
  }

  return (origin, callback) => {
    // Non-browser (Postman / mobile native) often omit Origin — allow those;
    // they still need JWT / API key on protected routes.
    if (!origin) return callback(null, true);
    if (list.includes(origin) || list.includes("*")) return callback(null, true);
    return callback(new Error(`CORS blocked for origin: ${origin}`));
  };
}

/** Call once at startup so misconfig fails fast instead of at first login. */
function assertSecurityConfig() {
  getJwtSecret();
  if (isProduction() || process.env.PLATFORM_SEED_KEY) {
    getPlatformSeedKey();
  }
}

module.exports = {
  isProduction,
  getJwtSecret,
  getPlatformSeedKey,
  allowDemoOtp,
  DEMO_OTP,
  isDemoOtp,
  getCorsOriginOption,
  assertSecurityConfig,
};
