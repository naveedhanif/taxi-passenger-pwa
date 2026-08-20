/**
 * Mapbox integration: address search + traffic-aware routing.
 *
 * Uses the Geocoding v5 and Directions v5 APIs (stable, well-documented,
 * not the newer v6 geocoding endpoint) — reduces risk of relying on
 * details that might shift under a newer API still in active development.
 *
 * IMPORTANT: fetch-based functions here have NOT been tested against a
 * live Mapbox endpoint — this sandbox has no network access to
 * api.mapbox.com. The pure parsing functions (parseGeocodingFeatures,
 * parseDirectionsRoute) ARE tested against realistic fixture data
 * matching Mapbox's documented response shape — see test.js. Test the
 * live fetch calls for real once you have a Mapbox token wired into
 * the actual app.
 */

const MAPBOX_BASE = "https://api.mapbox.com";

/**
 * Search for addresses matching a text query, biased to Ireland.
 * Use this for the pickup/dropoff autocomplete fields.
 */
async function searchAddress(query, token) {
  const url = `${MAPBOX_BASE}/geocoding/v5/mapbox.places/${encodeURIComponent(query)}.json` +
    `?access_token=${token}&country=ie&types=address,poi&autocomplete=true&limit=5`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Mapbox geocoding failed: ${res.status}`);
  return parseGeocodingFeatures(await res.json());
}

/** Turn a raw Mapbox geocoding response into a clean list of address options. */
function parseGeocodingFeatures(json) {
  if (!json || !Array.isArray(json.features)) return [];
  return json.features.map((f) => ({
    name: f.text,
    fullAddress: f.place_name,
    lng: f.center[0],
    lat: f.center[1],
  }));
}

/**
 * Reverse-geocode a coordinate pair into a readable address.
 * Use this for the "Use current location" GPS button.
 */
async function reverseGeocode(lng, lat, token) {
  const url = `${MAPBOX_BASE}/geocoding/v5/mapbox.places/${lng},${lat}.json` +
    `?access_token=${token}&country=ie&types=address`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Mapbox reverse geocoding failed: ${res.status}`);
  const parsed = parseGeocodingFeatures(await res.json());
  return parsed[0] || null;
}

/**
 * Get a traffic-aware route between two points.
 * THE key detail: profile is "driving-traffic", not "driving" — this is
 * what makes duration reflect real current congestion, which is what
 * feeds the "fare goes up in heavy traffic" behavior in fareCalculator.js.
 */
async function getRoute(origin, destination, token) {
  const coords = `${origin.lng},${origin.lat};${destination.lng},${destination.lat}`;
  const url = `${MAPBOX_BASE}/directions/v5/mapbox/driving-traffic/${coords}` +
    `?access_token=${token}&geometries=geojson&overview=full`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Mapbox directions failed: ${res.status}`);
  return parseDirectionsRoute(await res.json());
}

/** Turn a raw Mapbox directions response into distance/duration/route geometry. */
function parseDirectionsRoute(json) {
  if (!json || !Array.isArray(json.routes) || json.routes.length === 0) {
    return null;
  }
  const route = json.routes[0];
  return {
    distanceKm: Math.round((route.distance / 1000) * 100) / 100,
    durationMinutes: Math.round((route.duration / 60) * 10) / 10,
    routeGeometry: route.geometry, // GeoJSON LineString — feed directly to Mapbox GL JS
  };
}

export {
  searchAddress,
  reverseGeocode,
  getRoute,
  parseGeocodingFeatures,
  parseDirectionsRoute,
};
