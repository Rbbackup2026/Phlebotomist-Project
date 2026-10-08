import { useEffect, useState } from "react";
import { adminApi } from "../api.js";
import { useAuth } from "../context/AuthContext.jsx";

const REASONS = [
  "OTP not received",
  "Patient phone has no network",
  "Wrong number on the booking",
];

function liveCode(order) {
  if (!order?.otpAdminCode) return null;
  const expires = order.otpAdminCodeExpires ? new Date(order.otpAdminCodeExpires) : null;
  if (!expires || expires <= new Date()) return null;
  return {
    code: order.otpAdminCode,
    expires: order.otpAdminCodeExpires,
    reason: order.otpAdminCodeReason || REASONS[0],
  };
}

export default function DoorCodePanel({ order }) {
  const { user, updateUser } = useAuth();
  const [reason, setReason] = useState(REASONS[0]);
  const [phone, setPhone] = useState(String(user?.phone || "").replace(/\D/g, "").slice(0, 10));
  const [editingPhone, setEditingPhone] = useState(!user?.phone);
  const [code, setCode] = useState("");
  const [expiresAt, setExpiresAt] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setPhone(String(user?.phone || "").replace(/\D/g, "").slice(0, 10));
    setEditingPhone(!user?.phone);
  }, [user?.phone]);

  useEffect(() => {
    if (order?.phleboStatus !== "Arrived") return undefined;
    const known = liveCode(order);
    if (known) {
      setCode(known.code);
      setExpiresAt(known.expires);
      setReason(known.reason);
      return;
    }
    setCode("");
    setExpiresAt(null);
    if (!order?._id || order.otpAdminCode === "") return undefined;
    let cancelled = false;
    adminApi
      .getOrder(order._id)
      .then((res) => {
        const fresh = liveCode(res.order);
        if (cancelled || !fresh) return;
        setCode(fresh.code);
        setExpiresAt(fresh.expires);
        setReason(fresh.reason);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [order?._id, order?.otpAdminCode, order?.otpAdminCodeExpires]);

  if (!order || order.phleboStatus !== "Arrived" || user?.role !== "admin") return null;

  async function savePhone() {
    setBusy(true);
    setError("");
    try {
      const res = await adminApi.saveMyPhone(phone);
      updateUser({ phone: res.phone });
      setEditingPhone(false);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function generate() {
    setBusy(true);
    setError("");
    try {
      const res = await adminApi.issueOtpCode(order._id, reason);
      setCode(res.code);
      setExpiresAt(res.expiresAt);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  const expiresLabel = expiresAt
    ? new Date(expiresAt).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })
    : "";

  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-3 space-y-3">
      <div className="text-xs font-semibold uppercase tracking-wide text-amber-800">Door code</div>
      <p className="text-sm text-amber-950">
        Patient OTP nahi aaya ho to code banao aur phlebo ko phone par padh kar do. Yeh code sirf is order ke liye hai, 10 minute ke liye.
      </p>
      {editingPhone ? (
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-xs text-amber-900 flex-1 min-w-[180px]">
            Your mobile (phlebo will call this)
            <input
              className="input mt-1"
              inputMode="numeric"
              maxLength={10}
              value={phone}
              onChange={(e) => setPhone(e.target.value.replace(/\D/g, "").slice(0, 10))}
              placeholder="10-digit mobile"
            />
          </label>
          <button type="button" className="btn-primary" disabled={busy || phone.length !== 10} onClick={savePhone}>
            Save number
          </button>
        </div>
      ) : (
        <div className="text-sm text-amber-950">
          Phlebo will call <span className="font-semibold">{user.phone}</span>
          <button type="button" className="ml-2 text-brand-600 font-medium" onClick={() => setEditingPhone(true)}>
            Change
          </button>
        </div>
      )}
      <label className="text-xs text-amber-900 block">
        Reason
        <select className="input mt-1" value={reason} onChange={(e) => setReason(e.target.value)}>
          {REASONS.map((item) => (
            <option key={item} value={item}>
              {item}
            </option>
          ))}
        </select>
      </label>
      <button type="button" className="btn-primary" disabled={busy || !user?.phone} onClick={generate}>
        {busy ? "Please wait…" : code ? "Generate a new code" : "Generate code"}
      </button>
      {error ? <div className="text-sm text-rose-700">{error}</div> : null}
      {code ? (
        <div className="rounded-lg bg-white border border-amber-200 px-3 py-3 text-center">
          <div className="text-xs uppercase tracking-wide text-slate-400">Read this to the phlebo</div>
          <div className="text-4xl font-bold tracking-[0.35em] text-slate-900 mt-1">{code}</div>
          <div className="text-xs text-slate-500 mt-1">Valid until {expiresLabel}</div>
        </div>
      ) : null}
    </div>
  );
}
