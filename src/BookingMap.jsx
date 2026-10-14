import { useEffect, useRef, useState } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { useTheme } from "./ThemeContext.jsx";
import { getRouteMultiStop } from "./mapboxClient";

mapboxgl.accessToken = import.meta.env.VITE_MAPBOX_TOKEN || "";

const DUBLIN = [-6.2603, 53.3498];
const YELLOW = "#FFC400";

const STYLE_FOR_THEME = {
  light: "mapbox://styles/mapbox/light-v11",
  dark: "mapbox://styles/mapbox/dark-v11",
};

export function pinElement(kind) {
  const el = document.createElement("div");
  el.style.width = "22px";
  el.style.height = "22px";
  el.style.borderRadius = "50%";
  el.style.boxSizing = "border-box";
  if (kind === "pickup") {
    // Black dot with a white centre — "you are here / pickup".
    el.style.background = "#111111";
    el.style.border = "5px solid #FFFFFF";
    el.style.boxShadow = "0 0 0 2px #111111, 0 3px 8px rgba(0,0,0,0.35)";
  } else if (kind === "stop") {
    el.style.width = "14px";
    el.style.height = "14px";
    el.style.background = "#FFFFFF";
    el.style.border = "3px solid #111111";
    el.style.boxShadow = "0 2px 6px rgba(0,0,0,0.3)";
  } else {
    // Yellow dot with a black ring — destination.
    el.style.background = YELLOW;
    el.style.border = "5px solid #111111";
    el.style.boxShadow = "0 3px 8px rgba(0,0,0,0.35)";
  }
  return el;
}

/**
 * Full-width real map that sits behind the booking sheet. It only reads
 * coordinates the booking form already has — it never changes what gets
 * booked. Draws the actual road route (one Directions request each time
 * the pickup / stops / drop-off change) in yellow, with a plain straight
 * line as a fallback if routing fails.
 *
 * Costs: one map load per visit to the screen, plus one Directions
 * request per route change.
 */
export default function BookingMap({ pickup, dropoff, stops = [] }) {
  const { theme } = useTheme();
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const markersRef = useRef([]);
  const appliedThemeRef = useRef(null);
  const [styleReady, setStyleReady] = useState(false);
  const [route, setRoute] = useState(null); // GeoJSON LineString | null
  const [missingToken] = useState(!mapboxgl.accessToken);

  const stopsKey = stops.map((s) => `${s.lat},${s.lng}`).join("|");
  const routeKey = pickup && dropoff ? `${pickup.lat},${pickup.lng}>${stopsKey}>${dropoff.lat},${dropoff.lng}` : "";

  // Create the map once.
  useEffect(() => {
    if (missingToken || !containerRef.current || mapRef.current) return;
    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: STYLE_FOR_THEME[theme] || STYLE_FOR_THEME.light,
      center: DUBLIN,
      zoom: 10.5,
      attributionControl: false,
    });
    map.addControl(new mapboxgl.AttributionControl({ compact: true }), "bottom-left");
    map.on("style.load", () => setStyleReady(true));
    mapRef.current = map;
    appliedThemeRef.current = theme;
    return () => {
      map.remove();
      mapRef.current = null;
      markersRef.current = [];
      setStyleReady(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [missingToken]);

  // Follow the light/dark toggle.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || appliedThemeRef.current === theme) return;
    appliedThemeRef.current = theme;
    setStyleReady(false);
    map.setStyle(STYLE_FOR_THEME[theme] || STYLE_FOR_THEME.light);
  }, [theme]);

  // Fetch the road route when both ends are known.
  useEffect(() => {
    if (!routeKey || missingToken) {
      setRoute(null);
      return;
    }
    let cancelled = false;
    getRouteMultiStop([pickup, ...stops, dropoff], mapboxgl.accessToken)
      .then((r) => {
        if (!cancelled) setRoute(r?.routeGeometry ?? null);
      })
      .catch((err) => {
        console.error("BookingMap: couldn't fetch route, drawing a straight line instead:", err);
        if (!cancelled) setRoute(null);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeKey, missingToken]);

  // Draw markers + route whenever anything changes.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !styleReady) return;

    markersRef.current.forEach((m) => m.remove());
    markersRef.current = [];
    if (pickup) markersRef.current.push(new mapboxgl.Marker({ element: pinElement("pickup") }).setLngLat([pickup.lng, pickup.lat]).addTo(map));
    stops.forEach((s) => markersRef.current.push(new mapboxgl.Marker({ element: pinElement("stop") }).setLngLat([s.lng, s.lat]).addTo(map)));
    if (dropoff) markersRef.current.push(new mapboxgl.Marker({ element: pinElement("dropoff") }).setLngLat([dropoff.lng, dropoff.lat]).addTo(map));

    const line =
      route ||
      (pickup && dropoff
        ? { type: "LineString", coordinates: [[pickup.lng, pickup.lat], ...stops.map((s) => [s.lng, s.lat]), [dropoff.lng, dropoff.lat]] }
        : null);

    ["route-casing", "route-line"].forEach((id) => map.getLayer(id) && map.removeLayer(id));
    if (map.getSource("route")) map.removeSource("route");
    if (line) {
      map.addSource("route", { type: "geojson", data: { type: "Feature", geometry: line } });
      map.addLayer({
        id: "route-casing",
        type: "line",
        source: "route",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": theme === "dark" ? "#000000" : "#111111", "line-width": 9, "line-opacity": 0.85 },
      });
      map.addLayer({
        id: "route-line",
        type: "line",
        source: "route",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": YELLOW, "line-width": 5.5 },
      });
      const bounds = new mapboxgl.LngLatBounds();
      line.coordinates.forEach((c) => bounds.extend(c));
      map.fitBounds(bounds, { padding: { top: 90, bottom: 70, left: 45, right: 45 }, duration: 700, maxZoom: 15 });
    } else if (pickup) {
      map.flyTo({ center: [pickup.lng, pickup.lat], zoom: 14, duration: 700 });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [styleReady, route, pickup?.lat, pickup?.lng, dropoff?.lat, dropoff?.lng, stopsKey, theme]);

  return (
    <div className="booking-map sticky top-0 z-0" style={{ height: "calc(30vh + 36px)", background: "var(--bg-card-alt)" }}>
      {missingToken ? (
        <div className="flex h-full items-center justify-center px-6 text-center text-xs" style={{ color: "var(--text-muted)" }}>
          Map unavailable — set VITE_MAPBOX_TOKEN to show the live map.
        </div>
      ) : (
        <div ref={containerRef} className="h-full w-full" />
      )}
    </div>
  );
}
