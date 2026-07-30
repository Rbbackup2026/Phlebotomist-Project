import { useEffect, useState } from "react";
import Topbar from "../components/Topbar.jsx";
import Badge from "../components/Badge.jsx";
import { adminApi } from "../api.js";

export default function Clients() {
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState("");

  useEffect(() => {
    adminApi
      .clients()
      .then((d) => setClients(d.clients || []))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  function copy(text, key) {
    navigator.clipboard?.writeText(text);
    setCopied(key);
    setTimeout(() => setCopied(""), 1200);
  }

  return (
    <>
      <Topbar title="Partner Websites" subtitle="Companies connected via API key (multi-tenant)" />
      <div className="p-4 md:p-8 space-y-4">
        {error ? <div className="rounded-lg bg-rose-50 text-rose-700 text-sm px-4 py-3">{error}</div> : null}

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
                  <div className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2">
                    <span className="text-slate-500">API key</span>
                    <button
                      onClick={() => copy(c.apiKey, `k-${c._id}`)}
                      className="font-mono text-slate-700 hover:text-brand-600"
                      title="Click to copy"
                    >
                      {copied === `k-${c._id}` ? "Copied ✓" : maskKey(c.apiKey)}
                    </button>
                  </div>
                  <div className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2">
                    <span className="text-slate-500">Webhook URL</span>
                    <span className="font-mono text-slate-700 truncate max-w-[180px]">
                      {c.webhookUrl || "—"}
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

        <div className="card p-5 text-xs text-slate-500 leading-relaxed">
          To connect a new partner website, call <code className="font-mono">POST /v1/api/partner/register-client</code>{" "}
          (header <code className="font-mono">x-seed-key</code>); they will receive a unique API key for their order-creation API calls.
        </div>
      </div>
    </>
  );
}

function maskKey(key = "") {
  if (key.length < 10) return key;
  return `${key.slice(0, 10)}••••••••${key.slice(-4)}`;
}
