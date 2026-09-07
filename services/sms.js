/**
 * TextGuru Send SMS — same call shape as the working MDRC PHP project:
 *
 *   POST username, password, source, dmobile=91XXXXXXXXXX, dlttempid, message
 *   Official docs: https://www.textguru.in/api/v22.0/
 *   Working PHP also posts to /imobile/api.php
 *
 * Params go in the query string AND the body (PHP $_GET / $_POST both work).
 */

const DEFAULT_API_URL = "https://www.textguru.in/api/v22.0/";
const FALLBACK_API_URL = "https://www.textguru.in/imobile/api.php";
// Same DLT text as mdrcindia.com login (that SMS actually delivers).
const DEFAULT_OTP_MESSAGE =
  "Dear {name}, Welcome to MDRC Phlebo! {otp} is your One Time Password (OTP) for login into your account. www.mdrcindia.com.";
const DEFAULT_PATIENT_MESSAGE = DEFAULT_OTP_MESSAGE;

function env(name, fallback = "") {
  return String(process.env[name] ?? fallback).trim();
}

function isSmsConfigured() {
  if (env("SMS_DISABLED").toLowerCase() === "true") return false;
  return Boolean(
    env("TEXTGURU_USERNAME") &&
      env("TEXTGURU_PASSWORD") &&
      (env("TEXTGURU_SENDER") || env("TEXTGURU_SENDER_ID")) &&
      env("TEXTGURU_DLT_TEMPLATE_ID")
  );
}

function toTenDigitMobile(raw) {
  const digits = String(raw || "").replace(/\D/g, "");
  if (digits.length === 10) return digits;
  if (digits.length === 12 && digits.startsWith("91")) return digits.slice(2);
  if (digits.length === 11 && digits.startsWith("0")) return digits.slice(1);
  if (digits.length > 10) return digits.slice(-10);
  return digits;
}

function safeName(raw) {
  const name = String(raw || "Guest")
    .replace(/[^\w\s.\-]/g, "")
    .trim()
    .slice(0, 30);
  return name || "Guest";
}

function messageFor(kind, otp, name) {
  const specific =
    kind === "patient"
      ? env("TEXTGURU_PATIENT_OTP_MESSAGE")
      : kind === "driver"
        ? env("TEXTGURU_DRIVER_OTP_MESSAGE")
        : env("TEXTGURU_LOGIN_OTP_MESSAGE");
  const tpl =
    specific ||
    env("TEXTGURU_OTP_MESSAGE") ||
    (kind === "patient" ? DEFAULT_PATIENT_MESSAGE : DEFAULT_OTP_MESSAGE);
  const displayName = safeName(name);
  return tpl
    .replace(/\{name\}/gi, displayName)
    .replace(/\{otp\}/gi, String(otp))
    .replace("{#var#}", displayName)
    .replace("{#var#}", String(otp))
    .replace(/\{#var#\}/gi, String(otp));
}

function templateIdFor(kind) {
  if (kind === "patient") {
    return env("TEXTGURU_PATIENT_DLT_TEMPLATE_ID") || env("TEXTGURU_DLT_TEMPLATE_ID");
  }
  if (kind === "driver") {
    return env("TEXTGURU_DRIVER_DLT_TEMPLATE_ID") || env("TEXTGURU_DLT_TEMPLATE_ID");
  }
  return env("TEXTGURU_LOGIN_DLT_TEMPLATE_ID") || env("TEXTGURU_DLT_TEMPLATE_ID");
}

function looksLikeGatewayError(httpStatus, body) {
  if (httpStatus < 200 || httpStatus >= 300) return true;
  const raw = String(body || "").trim();
  if (!raw) return true;
  if (/<!doctype|<html/i.test(raw)) return true;
  const t = raw.toLowerCase();
  if (/invalid|insufficient|error|fail|denied|unauthor|reject|not exist|mismatch|missing/.test(t)) {
    return true;
  }
  return false;
}

function buildParams(phone10, message, templateId) {
  const prefix = env("TEXTGURU_COUNTRY_CODE", "91");
  // Working PHP + official docs: dmobile=91XXXXXXXXXX
  const useTen = env("TEXTGURU_NUMBERS_FORMAT") === "10";
  const dmobile = useTen ? phone10 : `${prefix}${phone10}`;
  const params = {
    username: env("TEXTGURU_USERNAME"),
    password: env("TEXTGURU_PASSWORD"),
    source: env("TEXTGURU_SENDER") || env("TEXTGURU_SENDER_ID"),
    dmobile,
    dlttempid: templateId,
    message,
    type: env("TEXTGURU_SERVICE_TYPE", "OTP"),
    smstype: env("TEXTGURU_SMS_TYPE") || env("TEXTGURU_SERVICE_TYPE", "OTP"),
  };
  const peid = env("TEXTGURU_PE_ID") || env("TEXTGURU_ENTITY_ID");
  if (peid) {
    params.entityid = peid;
    params.peid = peid;
  }
  return { params, dmobile, phone10 };
}

function toFormBody(params) {
  const body = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v) body.set(k, v);
  }
  return body;
}

async function postToGateway(url, params) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  const form = toFormBody(params);
  const qs = form.toString();
  const method = env("TEXTGURU_API_METHOD", "POST").toUpperCase();
  // Official docs + working Node sample put fields on the URL.
  // Working PHP also POSTs the same fields in the body.
  const requestUrl = `${url}${url.includes("?") ? "&" : "?"}${qs}`;
  const opts = { method, signal: controller.signal };
  if (method === "POST") {
    opts.headers = { "Content-Type": "application/x-www-form-urlencoded" };
    opts.body = qs;
  }
  try {
    const res = await fetch(requestUrl, opts);
    const body = await res.text();
    const snippet = String(body).replace(/\s+/g, " ").slice(0, 300);
    console.log(`[sms] TextGuru ${method} HTTP ${res.status} to ${params.dmobile}: ${snippet}`);
    if (looksLikeGatewayError(res.status, body)) {
      console.warn("[sms] TextGuru rejected send:", res.status, snippet);
      return { ok: false, error: snippet || "SMS gateway rejected the message", status: res.status };
    }
    return { ok: true, status: res.status, snippet };
  } catch (err) {
    console.warn("[sms] TextGuru request failed:", err.message);
    return { ok: false, error: err.message || "SMS gateway unreachable" };
  } finally {
    clearTimeout(timer);
  }
}

function gatewayUrls() {
  const primary = env("TEXTGURU_API_URL") || DEFAULT_API_URL;
  const extra = env("TEXTGURU_FALLBACK_URL") || FALLBACK_API_URL;
  const urls = [primary];
  if (extra && extra !== primary) urls.push(extra);
  return urls;
}

async function sendOtpSms(phone, otp, kind = "login", extra = {}) {
  if (!isSmsConfigured()) {
    console.warn("[sms] skipped: TextGuru username/password/sender/template missing");
    return { skipped: true };
  }
  const phone10 = toTenDigitMobile(phone);
  if (!/^\d{10}$/.test(phone10)) {
    return { ok: false, error: "Invalid mobile number for SMS" };
  }
  const templateId = templateIdFor(kind);
  if (!templateId) {
    return { ok: false, error: "DLT template ID missing" };
  }
  const message = messageFor(kind, otp, extra.name);
  const { params } = buildParams(phone10, message, templateId);

  let last = { ok: false, error: "SMS gateway unreachable" };
  for (const url of gatewayUrls()) {
    last = await postToGateway(url, params);
    if (last.ok) return last;
    console.warn(`[sms] ${url} failed, trying next endpoint`);
  }
  return last;
}

async function deliverOtp(phone, otp, kind = "login", extra = {}) {
  if (!isSmsConfigured()) {
    if (env("NODE_ENV").toLowerCase() === "production") {
      const err = new Error("SMS gateway is not configured on this server");
      err.status = 503;
      throw err;
    }
    console.warn("[sms] OTP saved in DB but SMS not sent — TextGuru not configured on this server");
    return { skipped: true };
  }
  const result = await sendOtpSms(phone, otp, kind, extra);
  if (result.skipped) return result;
  if (!result.ok) {
    const err = new Error(result.error || "Could not send OTP SMS");
    err.status = 502;
    throw err;
  }
  return result;
}

module.exports = {
  isSmsConfigured,
  sendOtpSms,
  deliverOtp,
  toTenDigitMobile,
};
