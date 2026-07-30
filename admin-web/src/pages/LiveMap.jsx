import { useEffect, useRef, useState } from "react";
import Topbar from "../components/Topbar.jsx";
import { adminApi } from "../api.js";

const REFRESH_MS = 20000;
const DEFAULT_CENTER = [22.9734, 78.6569]; // India centroid — used until markers exist
const DEFAULT_ZOOM = 5;

function timeAgo(dateStr) {
  if (!dateStr) return "never";
  const diffMs = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export default function LiveMap() {
  const [phlebos, setPhlebos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState(null);

  const mapDivRef = useRef(null);
  const mapRef = useRef(null);
  const markersLayerRef = useRef(null);

  async function load() {
    try {
      const res = await adminApi.phlebos();
      const live = (res.phlebos || []).filter(
        (p) =>
          p.dutyStatus === "on_duty" &&
          typeof p.currentLat === "number" &&
          typeof p.currentLng === "number"
      );
      setPhlebos(live);
      setError("");
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  // Poll every REFRESH_MS — location pings come from the phlebo app periodically,
  // so the map stays "live" without the admin needing to manually refresh.
  useEffect(() => {
    load();
    const t = setInterval(load, REFRESH_MS);
    return () => clearInterval(t);
  }, []);

  // Init Leaflet map once (window.L comes from the CDN script tag in index.html).
  useEffect(() => {
    if (!window.L || mapRef.current) return;
    const map = window.L.map(mapDivRef.current).setView(DEFAULT_CENTER, DEFAULT_ZOOM);
    window.L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "&copy; OpenStreetMap contributors",
      maxZoom: 19,
    }).addTo(map);
    mapRef.current = map;
    markersLayerRef.current = window.L.layerGroup().addTo(map);
  }, []);

  // Re-draw markers whenever the phlebo list changes.
  useEffect(() => {
    if (!mapRef.current || !markersLayerRef.current) return;
    const layer = markersLayerRef.current;
    layer.clearLayers();

    if (!phlebos.length) return;

    const bounds = [];
    phlebos.forEach((p) => {
      const marker = window.L.circleMarker([p.currentLat, p.currentLng], {
        radius: 9,
        color: "#7c3aed",
        fillColor: "#a78bfa",
        fillOpacity: 0.9,
        weight: 2,
      }).addTo(layer);
      marker.bindPopup(
        `<div style="font-size:13px">
          <div style="font-weight:600">${p.name}</div>
          <div style="color:#64748b">${p.phone} · ${p.zone || "—"}</div>
          <div style="color:#94a3b8;font-size:11px;margin-top:2px">Updated ${timeAgo(p.lastLocationAt)}</div>
        </div>`
      );
      marker.on("click", () => setSelected(p._id));
      bounds.push([p.currentLat, p.currentLng]);
    });

    if (bounds.length === 1) {
      mapRef.current.setView(bounds[0], 13);
    } else if (bounds.length > 1) {
      mapRef.current.fitBounds(bounds, { padding: [40, 40] });
    }
  }, [phlebos]);

  function focusOn(p) {
    setSelected(p._id);
    if (mapRef.current) {
      mapRef.current.setView([p.currentLat, p.currentLng], 15);
    }
  }

  return (
    <>
      <Topbar title="Live Map" subtitle="On-duty phlebotomists — real-time location" />
      <div className="p-4 md:p-8 space-y-4">
        {error ? <div className="rounded-lg bg-rose-50 text-rose-700 text-sm px-4 py-3">{error}</div> : null}

        <div className="flex items-center gap-2 text-sm text-slate-500">
          <span className="inline-block h-2.5 w-2.5 rounded-full bg-violet-500" />
          {loading ? "Loading…" : `${phlebos.length} phlebo live on map`}
          <span className="text-xs text-slate-300 ml-auto">Auto-refreshes every 20s</span>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
          <div className="card overflow-hidden lg:col-span-3">
            <div ref={mapDivRef} style={{ height: "60vh", width: "100%" }} />
          </div>

          <div className="card p-3 space-y-1.5 max-h-[60vh] overflow-y-auto">
            <div className="text-xs font-medium text-slate-400 uppercase tracking-wide px-1 pb-1">
              On duty now
            </div>
            {phlebos.length === 0 && !loading ? (
              <div className="text-sm text-slate-400 px-1 py-4 text-center">
                No phlebos currently on duty and sharing location
              </div>
            ) : (
              phlebos.map((p) => (
                <button
                  key={p._id}
                  onClick={() => focusOn(p)}
                  className={`w-full text-left rounded-lg px-3 py-2 text-sm transition-colors ${
                    selected === p._id ? "bg-violet-50 text-violet-700" : "hover:bg-slate-50"
                  }`}
                >
                  <div className="font-medium">{p.name}</div>
                  <div className="text-xs text-slate-400">
                    {p.zone || "—"} · updated {timeAgo(p.lastLocationAt)}
                  </div>
                </button>
              ))
            )}
          </div>
        </div>
      </div>
    </>
  );
}
