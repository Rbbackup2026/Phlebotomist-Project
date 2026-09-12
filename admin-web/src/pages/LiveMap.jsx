import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
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

function coordsOf(p) {
  const lat = typeof p.currentLat === "number" ? p.currentLat : Number(p.currentLat);
  const lng = typeof p.currentLng === "number" ? p.currentLng : Number(p.currentLng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng };
}

export default function LiveMap() {
  const [onDuty, setOnDuty] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [engine, setEngine] = useState(null);
  const [selected, setSelected] = useState(null);

  const mapDivRef = useRef(null);
  const mapRef = useRef(null);
  const markersRef = useRef({});

  async function load() {
    try {
      const res = await adminApi.phlebos();
      const duty = (res.phlebos || []).filter((p) => p.dutyStatus === "on_duty");
      setOnDuty(duty);
      setError("");
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    const t = setInterval(load, REFRESH_MS);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const cfg = await adminApi.mapsConfig();
        if (cfg.googleMapsKey) {
          try {
            await loadGoogleMaps(cfg.googleMapsKey);
            if (!cancelled) {
              setEngine("google");
              return;
            }
          } catch {
            // Production referrers / billing often reject the browser key — OSM still works.
          }
        }
        if (!cancelled) setEngine("osm");
      } catch {
        if (!cancelled) setEngine("osm");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!engine || !mapDivRef.current) return;

    if (engine === "google") {
      mapRef.current = {
        engine,
        map: new window.google.maps.Map(mapDivRef.current, {
          center: INDIA,
          zoom: 5,
          mapTypeControl: false,
          streetViewControl: false,
          fullscreenControl: true,
        }),
      };
      return () => {
        mapRef.current = null;
        markersRef.current = {};
      };
    }

    const map = L.map(mapDivRef.current, { zoomControl: true }).setView([INDIA.lat, INDIA.lng], 5);
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: "&copy; OpenStreetMap",
    }).addTo(map);
    mapRef.current = { engine, map };
    const t = setTimeout(() => map.invalidateSize(), 80);
    return () => {
      clearTimeout(t);
      map.remove();
      mapRef.current = null;
      markersRef.current = {};
    };
  }, [engine]);

  const live = onDuty
    .map((p) => ({ p, pos: coordsOf(p) }))
    .filter((row) => row.pos);

  useEffect(() => {
    const handle = mapRef.current;
    if (!handle?.map || !engine) return;
    const { map } = handle;
    const markers = markersRef.current;
    const seen = new Set();

    live.forEach(({ p, pos }) => {
      const id = String(p._id);
      seen.add(id);
      if (engine === "google") {
        const g = window.google;
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
      } else if (!markers[id]) {
        const marker = L.circleMarker([pos.lat, pos.lng], {
          radius: 9,
          color: "#7c3aed",
          weight: 2,
          fillColor: "#a78bfa",
          fillOpacity: 1,
        })
          .addTo(map)
          .bindTooltip(p.name);
        marker.on("click", () => setSelected(id));
        markers[id] = marker;
      } else {
        markers[id].setLatLng([pos.lat, pos.lng]);
      }
    });

    Object.keys(markers).forEach((id) => {
      if (seen.has(id)) return;
      if (engine === "google") markers[id].setMap(null);
      else map.removeLayer(markers[id]);
      delete markers[id];
    });

    if (selected) return;
    if (live.length === 1) {
      if (engine === "google") {
        map.setCenter(live[0].pos);
        map.setZoom(13);
      } else {
        map.setView([live[0].pos.lat, live[0].pos.lng], 13);
      }
    } else if (live.length > 1) {
      if (engine === "google") {
        const b = new window.google.maps.LatLngBounds();
        live.forEach(({ pos }) => b.extend(pos));
        map.fitBounds(b, 48);
      } else {
        map.fitBounds(
          L.latLngBounds(live.map(({ pos }) => [pos.lat, pos.lng])),
          { padding: [48, 48] }
        );
      }
    }
  }, [onDuty, selected, engine]);

  function focusOn(p) {
    const pos = coordsOf(p);
    setSelected(p._id);
    const handle = mapRef.current;
    if (!pos || !handle?.map) return;
    if (handle.engine === "google") {
      handle.map.panTo(pos);
      handle.map.setZoom(15);
    } else {
      handle.map.setView([pos.lat, pos.lng], 15);
    }
  }

  return (
    <>
      <Topbar title="Live Map" subtitle="On-duty phlebotomists, real-time location" />
      <div className="p-4 md:p-8 space-y-4">
        {error ? <div className="rounded-lg bg-rose-50 text-rose-700 text-sm px-4 py-3">{error}</div> : null}

        <div className="flex items-center gap-2 text-sm text-slate-500">
          <span className="inline-block h-2.5 w-2.5 rounded-full bg-violet-500" />
          {loading
            ? "Loading…"
            : `${onDuty.length} on duty · ${live.length} with GPS on map`}
          <span className="text-xs text-slate-300 ml-auto">
            {engine === "google" ? "Google Maps" : engine === "osm" ? "OpenStreetMap" : "Map"} · refresh 20s
          </span>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
          <div className="card overflow-hidden lg:col-span-3">
            <div ref={mapDivRef} className="z-0" style={{ height: "60vh", width: "100%", minHeight: 360 }} />
          </div>

          <div className="card p-3 space-y-1.5 max-h-[60vh] overflow-y-auto">
            <div className="text-xs font-medium text-slate-400 uppercase tracking-wide px-1 pb-1">
              On duty now
            </div>
            {onDuty.length === 0 && !loading ? (
              <div className="text-sm text-slate-400 px-1 py-4 text-center">
                No phlebos currently on duty
              </div>
            ) : (
              onDuty.map((p) => {
                const pos = coordsOf(p);
                return (
                  <button
                    key={p._id}
                    onClick={() => focusOn(p)}
                    disabled={!pos}
                    className={`w-full text-left rounded-lg px-3 py-2 text-sm transition-colors ${
                      selected === p._id ? "bg-violet-50 text-violet-700" : "hover:bg-slate-50"
                    } ${!pos ? "opacity-70 cursor-default" : ""}`}
                  >
                    <div className="font-medium">{p.name}</div>
                    <div className="text-xs text-slate-400">
                      {p.zone || p.city || "—"} ·{" "}
                      {pos
                        ? `updated ${timeAgo(p.lastLocationAt)}`
                        : "GPS not received yet — keep the app open with location on"}
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>
      </div>
    </>
  );
}
