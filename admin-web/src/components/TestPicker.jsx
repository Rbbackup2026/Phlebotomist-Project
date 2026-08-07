import { useEffect, useState } from "react";
import { adminApi } from "../api.js";

/**
 * Client ka test catalog search karke test pick karne ke liye — New Order
 * banate waqt aur kisi existing order mein manually test add karte waqt,
 * dono jagah reuse hota hai. onAdd(item) fire hota hai jab admin koi test
 * (catalog se ya manually type karke) select kare.
 */
export default function TestPicker({ clientId, city, onAdd, disabled }) {
  const [search, setSearch] = useState("");
  const [tests, setTests] = useState([]);
  const [loading, setLoading] = useState(false);
  const [catalogError, setCatalogError] = useState("");
  const [manualOpen, setManualOpen] = useState(false);
  const [manualName, setManualName] = useState("");
  const [manualPrice, setManualPrice] = useState("");

  useEffect(() => {
    if (!clientId) {
      setTests([]);
      setCatalogError("");
      return;
    }
    setLoading(true);
    setCatalogError("");
    const t = setTimeout(() => {
      adminApi
        .catalog({ clientId, city, search })
        .then((res) => {
          setTests(res.tests || []);
          setCatalogError("");
        })
        .catch((e) => {
          setTests([]);
          setCatalogError(e.message || "Catalog load failed");
        })
        .finally(() => setLoading(false));
    }, 300);
    return () => clearTimeout(t);
  }, [clientId, city, search]);

  function addManual() {
    if (!manualName.trim() || manualPrice === "") return;
    onAdd({
      name: manualName.trim(),
      price: Number(manualPrice) || 0,
      category: "Custom",
      quantity: 1,
    });
    setManualName("");
    setManualPrice("");
    setManualOpen(false);
  }

  return (
    <div className="space-y-2">
      <input
        className="input"
        placeholder={clientId ? "Search tests…" : "Select a source first"}
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        disabled={disabled || !clientId}
      />
      <div className="max-h-40 overflow-y-auto space-y-1 border border-slate-100 rounded-lg p-1">
        {!clientId ? (
          <p className="text-xs text-slate-400 p-2">Select a source first</p>
        ) : loading ? (
          <p className="text-xs text-slate-400 p-2">Loading…</p>
        ) : catalogError ? (
          <p className="text-xs text-rose-600 p-2 leading-relaxed">{catalogError}</p>
        ) : tests.length === 0 ? (
          <p className="text-xs text-slate-400 p-2">No tests found</p>
        ) : (
          tests.map((t) => (
            <button
              key={t.productId}
              type="button"
              disabled={disabled}
              onClick={() =>
                onAdd({
                  productId: t.productId,
                  name: t.name,
                  price: t.price,
                  category: t.category,
                  quantity: 1,
                })
              }
              className="w-full flex items-center justify-between rounded-lg px-2.5 py-1.5 text-left hover:bg-brand-50 text-sm disabled:opacity-50"
            >
              <span className="text-slate-700">{t.name}</span>
              <span className="text-slate-500 text-xs">₹{t.price}</span>
            </button>
          ))
        )}
      </div>

      {!manualOpen ? (
        <button
          type="button"
          className="text-xs text-brand-600 font-medium"
          onClick={() => setManualOpen(true)}
        >
          + Not in catalog? Add manually
        </button>
      ) : (
        <div className="flex gap-2 items-end">
          <div className="flex-1">
            <label className="label">Test name</label>
            <input
              className="input"
              value={manualName}
              onChange={(e) => setManualName(e.target.value)}
            />
          </div>
          <div className="w-24">
            <label className="label">Price</label>
            <input
              type="number"
              min="0"
              className="input"
              value={manualPrice}
              onChange={(e) => setManualPrice(e.target.value)}
            />
          </div>
          <button
            type="button"
            className="btn-secondary"
            disabled={disabled || !manualName.trim() || manualPrice === ""}
            onClick={addManual}
          >
            Add
          </button>
        </div>
      )}
    </div>
  );
}
