/**
 * Push notifications to the phlebo app via Expo's push service — no separate account/
 * SDK key needed for basic sends (Expo's HTTP API accepts plain Expo push tokens).
 * Fire-and-forget everywhere it's called: a failed/slow push should never block or
 * fail the underlying job-assignment request.
 */
const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";

/**
 * @param {{pushToken?:string}} phlebo Phlebotomist doc (or plain object) with pushToken
 * @param {string} title
 * @param {string} body
 * @param {Object} [data] extra payload (e.g. { jobId })
 */
async function sendPushToPhlebo(phlebo, title, body, data = {}) {
  try {
    const token = phlebo && phlebo.pushToken;
    if (!token || !String(token).startsWith("ExponentPushToken")) {
      return { skipped: true };
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 6000);

    const res = await fetch(EXPO_PUSH_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "Accept-Encoding": "gzip, deflate",
      },
      body: JSON.stringify({
        to: token,
        title,
        body,
        data,
        sound: "default",
        priority: "high",
      }),
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (!res.ok) {
      console.warn("[push] Expo push HTTP", res.status);
      return { ok: false, status: res.status };
    }
    return { ok: true };
  } catch (err) {
    console.warn("[push] failed:", err.message);
    return { ok: false, error: err.message };
  }
}

module.exports = { sendPushToPhlebo };
