import { useEffect, useRef } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";

/**
 * Real live map: pickup + dropoff markers, the actual driving route, and
 * live traffic congestion coloring (via Mapbox's traffic-day style, which
 * renders real-time congestion natively — no manual traffic layer needed).
 *
 * NOT TESTED against a live Mapbox render in this environment — this
 * sandbox has no network access to api.mapbox.com or its map tiles, and
 * WebGL map rendering can't be verified from a headless code review
 * either way. The Mapbox GL JS API calls here follow the documented
 * usage patterns exactly, but the first real render, with a real token,
 * in an actual browser, is the genuine test — watch for it.
 *
 * @param {object} props
 * @param {string} props.token - Mapbox public token
 * @param {{lat:number,lng:number}} props.pickup
 * @param {{lat:number,lng:number}} props.dropoff
 * @param {object} props.routeGeometry - GeoJSON LineString from mapboxClient.getRoute()
 */
export default function LiveMapView({ token, pickup, dropoff, routeGeometry }) {
  const mapContainerRef = useRef(null);
  const mapRef = useRef(null);

  useEffect(() => {
    if (!token || !pickup || !dropoff || mapRef.current) return;

    mapboxgl.accessToken = token;

    const map = new mapboxgl.Map({
      container: mapContainerRef.current,
      style: "mapbox://styles/mapbox/traffic-day-v2", // native live traffic coloring
      center: [pickup.lng, pickup.lat],
      zoom: 12,
    });
    mapRef.current = map;

    map.on("load", () => {
      // Pickup marker
      new mapboxgl.Marker({ color: "#2C2C2A" })
        .setLngLat([pickup.lng, pickup.lat])
        .addTo(map);

      // Dropoff marker
      new mapboxgl.Marker({ color: "#185FA5" })
        .setLngLat([dropoff.lng, dropoff.lat])
        .addTo(map);

      // Route line
      if (routeGeometry) {
        map.addSource("route", {
          type: "geojson",
          data: { type: "Feature", properties: {}, geometry: routeGeometry },
        });
        map.addLayer({
          id: "route-line",
          type: "line",
          source: "route",
          layout: { "line-join": "round", "line-cap": "round" },
          paint: { "line-color": "#185FA5", "line-width": 4, "line-opacity": 0.85 },
        });

        // Fit the map to show the whole route, not just the start point
        const bounds = routeGeometry.coordinates.reduce(
          (b, coord) => b.extend(coord),
          new mapboxgl.LngLatBounds(routeGeometry.coordinates[0], routeGeometry.coordinates[0])
        );
        map.fitBounds(bounds, { padding: 60, duration: 0 });
      }
    });

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, [token, pickup, dropoff, routeGeometry]);

  if (!token) {
    return (
      <div
        className="flex h-56 items-center justify-center rounded-xl text-xs text-[#8C8977]"
        style={{ background: "#EAE8E1" }}
      >
        Map unavailable — no Mapbox token configured
      </div>
    );
  }

  return (
    <div
      ref={mapContainerRef}
      className="h-56 w-full overflow-hidden rounded-xl"
      style={{ background: "#EAE8E1" }}
    />
  );
}
