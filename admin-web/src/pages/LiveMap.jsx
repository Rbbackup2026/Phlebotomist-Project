import { useEffect, useRef, useState } from "react";
import Topbar from "../components/Topbar.jsx";
import { adminApi } from "../api.js";
import { loadGoogleMaps } from "../lib/googleMaps.js";

const REFRESH_MS = 20000;
const INDIA = { lat: 22.9734, lng: 78.6569 };

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
  const [mapsReady, setMapsReady] = useState(false);
  const [needKey, setNeedKey] = useState(false);
  const [selected, setSelected] = useState(null);

  const mapDivRef = useRef(null);
  const mapRef = useRef(null);
  const markersRef = useRef({});

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

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const cfg = await adminApi.mapsConfig();
        if (!cfg.googleMapsKey) {
          setNeedKey(true);
          setLoading(false);
          return;
        }
        await loadGoogleMaps(cfg.googleMapsKey, () => {
          setError(
            "Google Maps key reject. HTTP referrers mein http://localhost:3010/* add karo. Billing ON, Maps JavaScript API enable."
          );
        });
        if (!cancelled) setMapsReady(true);
      } catch (e) {
        if (!cancelled) setError(e.message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!mapsReady) return;
    load();
    const t = setInterval(load, REFRESH_MS);
    return () => clearInterval(t);
  }, [mapsReady]);

  useEffect(() => {
    if (!mapsReady || !mapDivRef.current || mapRef.current) return;
    mapRef.current = new window.google.maps.Map(mapDivRef.current, {
      center: INDIA,
      zoom: 5,
      mapTypeControl: false,
      streetViewControl: false,
      fullscreenControl: true,
    });
  }, [mapsReady]);

  useEffect(() => {
    const map = mapRef.current;
    const g = window.google;
    if (!map || !g?.maps) return;
    const markers = markersRef.current;
    const seen = new Set();

    phlebos.forEach((p) => {
      const id = String(p._id);
      seen.add(id);
      const pos = { lat: p.currentLat, lng: p.currentLng };
      if (!markers[id]) {
        markers[id] = new g.maps.Marker({
          map,
          position: pos,
          title: p.name,
          icon: {
            path: g.maps.SymbolPath.CIRCLE,
            scale: 9,
            fillColor: "#a78bfa",
            fillOpacity: 1,
            strokeColor: "#7c3aed",
            strokeWeight: 2,
          },
        });
        markers[id].addListener("click", () => setSelected(id));
      } else {
        markers[id].setPosition(pos);
      }
    });

    Object.keys(markers).forEach((id) => {
      if (!seen.has(id)) {
        markers[id].setMap(null);
        delete markers[id];
      }
    });

    if (selected) return;
    if (phlebos.length === 1) {
      map.setCenter({ lat: phlebos[0].currentLat, lng: phlebos[0].currentLng });
      map.setZoom(13);
    } else if (phlebos.length > 1) {
      const b = new g.maps.LatLngBounds();
      phlebos.forEach((p) => b.extend({ lat: p.currentLat, lng: p.currentLng }));
      map.fitBounds(b, 48);
    }
  }, [phlebos, selected]);

  function focusOn(p) {
    setSelected(p._id);
    if (mapRef.current) {
      mapRef.current.panTo({ lat: p.currentLat, lng: p.currentLng });
      mapRef.current.setZoom(15);
    }
  }

  return (
    <>
      <Topbar title="Live Map" subtitle="Google Maps — on-duty phlebotomists, real-time location" />
      <div className="p-4 md:p-8 space-y-4">
        {needKey ? (
          <div className="rounded-lg bg-amber-50 text-amber-900 text-sm px-4 py-3 space-y-2">
            <p className="font-semibold">Google Maps browser key chahiye</p>
            <ol className="list-decimal ml-4 space-y-1">
              <li>
                Cloud Console key pe Website restrictions:{" "}
                <code>http://localhost:3010/*</code>
              </li>
              <li>
                <code className="text-xs">PhleboBackend/.env</code> mein{" "}
                <code>GOOGLE_MAPS_BROWSER_KEY=</code> (ambulance wali same key chalegi)
              </li>
              <li>Phlebo backend restart, phir ye page hard refresh</li>
            </ol>
          </div>
        ) : null}
        {error ? <div className="rounded-lg bg-rose-50 text-rose-700 text-sm px-4 py-3">{error}</div> : null}

        <div className="flex items-center gap-2 text-sm text-slate-500">
          <span className="inline-block h-2.5 w-2.5 rounded-full bg-violet-500" />
          {loading ? "Loading…" : `${phlebos.length} phlebo live on map`}
          <span className="text-xs text-slate-300 ml-auto">Google Maps · refresh 20s</span>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
          <div className="card overflow-hidden lg:col-span-3">
            <div ref={mapDivRef} style={{ height: "60vh", width: "100%", minHeight: 360 }} />
          </div>

          <div className="card p-3 space-y-1.5 max-h-[60vh] overflow-y-auto">
            <div className="text-xs font-medium text-slate-400 uppercase tracking-wide px-1 pb-1">
              On duty now
            </div>
            {phlebos.length === 0 && !loading && !needKey ? (
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
