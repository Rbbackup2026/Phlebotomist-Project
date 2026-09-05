const crypto = require("crypto");
const QRCode = require("qrcode");

const RAZORPAY_API = "https://api.razorpay.com/v1";

function keyId() {
  return String(process.env.RAZORPAY_KEY_ID || "").trim();
}

function keySecret() {
  return String(process.env.RAZORPAY_KEY_SECRET || "").trim();
}

function webhookSecret() {
  return String(process.env.RAZORPAY_WEBHOOK_SECRET || "").trim();
}

function isRazorpayConfigured() {
  return !!(keyId() && keySecret());
}

function authHeader() {
  const token = Buffer.from(`${keyId()}:${keySecret()}`).toString("base64");
  return `Basic ${token}`;
}

function razorpayErrorMessage(data, fallback) {
  const err = data && data.error;
  if (!err) return fallback;
  return String(err.description || err.reason || err.code || fallback);
}

async function razorpayRequest(method, path, body) {
  if (!isRazorpayConfigured()) {
    const err = new Error(
      "Razorpay keys missing. Add RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET in PhleboBackend .env, then restart the server"
    );
    err.status = 503;
    throw err;
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  let res;
  try {
    res = await fetch(`${RAZORPAY_API}${path}`, {
      method,
      headers: {
        Authorization: authHeader(),
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
  } catch (e) {
    const err = new Error(
      /abort/i.test(String(e.message || e))
        ? "Razorpay timed out — check internet and try again"
        : "Cannot reach Razorpay"
    );
    err.status = 502;
    throw err;
  } finally {
    clearTimeout(timer);
  }

  let data = {};
  try {
    data = await res.json();
  } catch {
    data = {};
  }
  if (!res.ok) {
    const err = new Error(razorpayErrorMessage(data, `Razorpay error (${res.status})`));
    err.status = res.status >= 500 ? 502 : 400;
    err.razorpay = data;
    throw err;
  }
  return data;
}

async function toQrDataUrl(text) {
  return QRCode.toDataURL(String(text), {
    width: 360,
    margin: 2,
    errorCorrectionLevel: "M",
  });
}

async function imageUrlToDataUrl(url) {
  if (!url || !/^https?:\/\//i.test(url)) return "";
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    const ct = String(res.headers.get("content-type") || "");
    if (!res.ok || !ct.includes("image")) return "";
    const buf = Buffer.from(await res.arrayBuffer());
    return `data:${ct.split(";")[0]};base64,${buf.toString("base64")}`;
  } catch {
    return "";
  }
}

async function displayImageForQr({ imageUrl, payload }) {
  const downloaded = await imageUrlToDataUrl(imageUrl);
  if (downloaded) return downloaded;
  if (payload) return toQrDataUrl(payload);
  if (imageUrl) return toQrDataUrl(imageUrl);
  return "";
}

function createUpiQr({ name, amountPaise, description, closeBy, notes }) {
  return razorpayRequest("POST", "/payments/qr_codes", {
    type: "upi_qr",
    name: String(name || "Phlebo").slice(0, 40),
    usage: "single_use",
    fixed_amount: true,
    payment_amount: amountPaise,
    description: String(description || "Sample collection").slice(0, 255),
    close_by: closeBy,
    notes: notes || {},
  });
}

function fetchQr(qrId) {
  return razorpayRequest("GET", `/payments/qr_codes/${encodeURIComponent(qrId)}`);
}

function fetchQrPayments(qrId) {
  return razorpayRequest("GET", `/payments/qr_codes/${encodeURIComponent(qrId)}/payments`);
}

async function closeQr(qrId) {
  try {
    return await razorpayRequest("POST", `/payments/qr_codes/${encodeURIComponent(qrId)}/close`);
  } catch (e) {
    if (/already|closed|not found/i.test(String(e.message || ""))) return null;
    throw e;
  }
}

function createPaymentLink({ amountPaise, description, customer, expireBy, notes, upiLink = true }) {
  const body = {
    amount: amountPaise,
    currency: "INR",
    accept_partial: false,
    description: String(description || "Sample collection").slice(0, 255),
    notify: { sms: false, email: false },
    reminder_enable: false,
    notes: notes || {},
    expire_by: expireBy,
  };
  if (upiLink) body.upi_link = true;
  const contact = String(customer?.contact || "").replace(/\D/g, "").slice(-10);
  if (customer?.name || contact) {
    body.customer = {
      name: String(customer?.name || "Patient").slice(0, 50),
    };
    if (contact.length === 10) body.customer.contact = `+91${contact}`;
  }
  return razorpayRequest("POST", "/payment_links", body);
}

function fetchPaymentLink(id) {
  return razorpayRequest("GET", `/payment_links/${encodeURIComponent(id)}`);
}

async function cancelPaymentLink(id) {
  try {
    return await razorpayRequest("POST", `/payment_links/${encodeURIComponent(id)}/cancel`);
  } catch (e) {
    if (/already|cancel|not found|expired/i.test(String(e.message || ""))) return null;
    throw e;
  }
}

function verifyWebhookSignature(rawBody, signature) {
  const secret = webhookSecret();
  if (!secret) return false;
  const expected = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
  const a = Buffer.from(String(signature || ""));
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function shouldAcceptWebhook(rawBody, signature) {
  if (!webhookSecret()) return false;
  return verifyWebhookSignature(rawBody, signature);
}

module.exports = {
  isRazorpayConfigured,
  createUpiQr,
  fetchQr,
  fetchQrPayments,
  closeQr,
  createPaymentLink,
  fetchPaymentLink,
  cancelPaymentLink,
  displayImageForQr,
  toQrDataUrl,
  shouldAcceptWebhook,
};
