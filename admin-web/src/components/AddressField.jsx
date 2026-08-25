import { useEffect, useRef, useState } from "react";
import { adminApi } from "../api.js";

export default function AddressField({ label, value, required, onChange }) {
  const [q, setQ] = useState(value || "");
  const [hits, setHits] = useState([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const skipRef = useRef(false);

  useEffect(() => {
    setQ(value || "");
  }, [value]);

  useEffect(() => {
    if (skipRef.current) {
      skipRef.current = false;
      return;
    }
    const text = String(q || "").trim();
    if (text.length < 3) {
      setHits([]);
      return;
    }
    const t = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await adminApi.placesSuggest(text);
        setHits(res.suggestions || []);
        setOpen(true);
      } catch {
        setHits([]);
      } finally {
        setLoading(false);
      }
    }, 320);
    return () => clearTimeout(t);
  }, [q]);

  async function pick(hit) {
    skipRef.current = true;
    setOpen(false);
    setHits([]);
    let address = hit.label;
    let lat = hit.lat;
    let lng = hit.lng;
    if (hit.secondary) address = `${hit.label}, ${hit.secondary}`;
    if (typeof lat !== "number" || typeof lng !== "number") {
      try {
        const res = await adminApi.placesDetails(hit.id, address);
        if (res.place) {
          address = res.place.address || address;
          lat = res.place.lat;
          lng = res.place.lng;
        }
      } catch {
        /* keep typed label */
      }
    }
    setQ(address);
    onChange({ address, lat, lng });
  }

  return (
    <div className="relative">
      {label ? <label className="label">{label}</label> : null}
      <input
        required={required}
        className="input"
        value={q}
        autoComplete="off"
        placeholder="Type address — Google suggestions"
        onChange={(e) => {
          const next = e.target.value;
          setQ(next);
          onChange({ address: next, lat: null, lng: null });
        }}
        onFocus={() => hits.length && setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 180)}
      />
      {loading ? <div className="text-[11px] text-slate-400 mt-1">Searching…</div> : null}
      {open && hits.length ? (
        <ul className="absolute z-30 mt-1 w-full max-h-56 overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-lg">
          {hits.map((h) => (
            <li key={h.id}>
              <button
                type="button"
                className="w-full text-left px-3 py-2 text-sm hover:bg-slate-50"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(h)}
              >
                <div className="font-medium text-slate-800">{h.label}</div>
                {h.secondary ? <div className="text-[11px] text-slate-400">{h.secondary}</div> : null}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
