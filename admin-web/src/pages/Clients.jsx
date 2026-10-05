import { useEffect, useState } from "react";
import Topbar from "../components/Topbar.jsx";
import Badge from "../components/Badge.jsx";
import { adminApi } from "../api.js";
import { useAuth } from "../context/AuthContext.jsx";

export default function Clients() {
  const { user } = useAuth();
  const isSuperadmin = user?.role === "superadmin";
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState("");
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    name: "",
    slug: "",
    webhookUrl: "",
    contactEmail: "",
  });
  const [editId, setEditId] = useState("");
  const [editWebhook, setEditWebhook] = useState("");
  const [editToken, setEditToken] = useState("");

  function load() {
    setLoading(true);
    adminApi
      .clients()
      .then((d) => setClients(d.clients || []))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    load();
  }, []);

  function copy(text, key) {
    if (!text) return;
    navigator.clipboard?.writeText(text);
    setCopied(key);
    setTimeout(() => setCopied(""), 1200);
  }

  async function createClient(e) {
    e.preventDefault();
    setError("");
    setSaving(true);
    try {
      await adminApi.createClient(form);
      setForm({ name: "", slug: "", webhookUrl: "", contactEmail: "" });
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function saveWebhook(id) {
    setError("");
    setSaving(true);
    try {
      await adminApi.updateClient(id, {
        webhookUrl: editWebhook,
        webhookAuthType: /crm\.mdrcindia\.net|ingest_phlebo_event/i.test(editWebhook)
          ? "frappe"
          : undefined,
        webhookToken: editToken,
      });
      setEditId("");
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <Topbar
        title="Partner / CRM"
        subtitle="CRM aur websites API key se order bhejte hain — Admin assign karta hai, App pe job aata hai"
      />
      <div className="p-4 md:p-8 space-y-4">
        {error ? <div className="rounded-lg bg-rose-50 text-rose-700 text-sm px-4 py-3">{error}</div> : null}

        {isSuperadmin ? (
          <form onSubmit={createClient} className="card p-5 space-y-3">
            <div className="font-semibold text-slate-900">Naya CRM / partner connect</div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <input
                className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
                placeholder="Name (e.g. Acme CRM)"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                required
              />
              <input
                className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-mono"
                placeholder="slug (e.g. acme-crm)"
                value={form.slug}
                onChange={(e) => setForm({ ...form, slug: e.target.value })}
                required
              />
              <input
                className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
                placeholder="CRM webhook URL (optional)"
                value={form.webhookUrl}
                onChange={(e) => setForm({ ...form, webhookUrl: e.target.value })}
              />
              <input
                className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
                placeholder="Contact email (optional)"
                value={form.contactEmail}
                onChange={(e) => setForm({ ...form, contactEmail: e.target.value })}
              />
            </div>
            <button
              type="submit"
              disabled={saving}
              className="rounded-lg bg-brand-600 text-white text-sm px-4 py-2 disabled:opacity-50"
            >
              {saving ? "Saving…" : "Create client + API key"}
            </button>
            <p className="text-xs text-slate-500">
              Save ke baad API key aur webhook secret copy karke CRM team ko do. Ye keys Phlebo Admin login nahi hain.
            </p>
          </form>
        ) : null}

        {loading ? (
          <div className="text-slate-500 text-sm">Loading…</div>
        ) : clients.length === 0 ? (
          <div className="card p-8 text-center text-slate-400">No partner websites yet</div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {clients.map((c) => (
              <div key={c._id} className="card p-5">
                <div className="flex items-start justify-between">
                  <div>
                    <div className="font-semibold text-slate-900">{c.name}</div>
                    <div className="text-xs text-slate-400">{c.slug}</div>
                  </div>
                  <Badge>{c.status}</Badge>
                </div>

                <div className="mt-4 space-y-2 text-xs">
                  <SecretRow
                    label="API key"
                    value={c.apiKey}
                    copied={copied === `k-${c._id}`}
                    onCopy={() => copy(c.apiKey, `k-${c._id}`)}
                    mask={!isSuperadmin}
                  />
                  {isSuperadmin && c.webhookSecret ? (
                    <SecretRow
                      label="Webhook secret"
                      value={c.webhookSecret}
                      copied={copied === `s-${c._id}`}
                      onCopy={() => copy(c.webhookSecret, `s-${c._id}`)}
                    />
                  ) : null}
                  <div className="rounded-lg bg-slate-50 px-3 py-2 space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-slate-500 shrink-0">Webhook URL</span>
                      {isSuperadmin ? (
                        <button
                          type="button"
                          className="text-brand-600"
                          onClick={() => {
                            setEditId(c._id);
                            setEditWebhook(c.webhookUrl || "");
                            setEditToken(c.webhookToken || "");
                          }}
                        >
                          Edit
                        </button>
                      ) : null}
                    </div>
                    {editId === c._id ? (
                      <div className="space-y-2">
                        <input
                          className="w-full rounded border border-slate-200 px-2 py-1 font-mono"
                          value={editWebhook}
                          onChange={(e) => setEditWebhook(e.target.value)}
                          placeholder="https://crm.mdrcindia.net/api/method/crm.integrations.phlebo.webhooks.ingest_phlebo_event"
                        />
                        <input
                          className="w-full rounded border border-slate-200 px-2 py-1 font-mono"
                          value={editToken}
                          onChange={(e) => setEditToken(e.target.value)}
                          placeholder="Frappe token: api_key:api_secret"
                        />
                        <button
                          type="button"
                          className="text-brand-600"
                          disabled={saving}
                          onClick={() => saveWebhook(c._id)}
                        >
                          Save
                        </button>
                      </div>
                    ) : (
                      <div className="font-mono text-slate-700 break-all">{c.webhookUrl || "—"}</div>
                    )}
                  </div>
                  <div className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2">
                    <span className="text-slate-500">Catalog API</span>
                    <span className="font-mono text-slate-700 truncate max-w-[180px]" title={c.catalogApiUrl || ""}>
                      {c.catalogApiUrl || "—"}
                    </span>
                  </div>
                  {c.contactEmail ? (
                    <div className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2">
                      <span className="text-slate-500">Contact</span>
                      <span className="text-slate-700">{c.contactEmail}</span>
                    </div>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="card p-5 text-xs text-slate-500 leading-relaxed space-y-1">
          <p>
            CRM ko do: <code className="font-mono">Base URL + /v1/api</code>, API key, webhook secret, aur ye file:{" "}
            <code className="font-mono">PhleboBackend/docs/Phlebo_CRM_Partner_API_Integration.html</code>
          </p>
          <p>
            MDRC CRM: unhe Partner API key do (CRM → Phlebo). Unse Frappe{" "}
            <code className="font-mono">api_key:api_secret</code> lo aur webhook URL + token yahan save karo
            (Phlebo → CRM). HMAC nahi.
          </p>
        </div>
      </div>
    </>
  );
}

function SecretRow({ label, value, copied, onCopy, mask }) {
  return (
    <div className="flex items-center justify-between gap-2 rounded-lg bg-slate-50 px-3 py-2">
      <span className="text-slate-500 shrink-0">{label}</span>
      <button
        type="button"
        onClick={onCopy}
        className="font-mono text-slate-700 hover:text-brand-600 text-right break-all"
        title="Click to copy"
      >
        {copied ? "Copied ✓" : mask ? maskKey(value) : value || "—"}
      </button>
    </div>
  );
}

function maskKey(key = "") {
  if (key.length < 10) return key;
  return `${key.slice(0, 10)}••••••••${key.slice(-4)}`;
}
