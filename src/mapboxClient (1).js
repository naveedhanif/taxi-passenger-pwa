/**
 * Mapbox integration: address search + traffic-aware routing.
 *
 * Address search uses the Search Box API (/suggest + /retrieve), not the
 * old Geocoding v5 API. Mapbox removed POI data from Geocoding v5 — see
 * https://docs.mapbox.com/api/search/geocoding-v5/ — which is why a
 * previous version of this file could resolve street addresses but never
 * returned named places like "Dublin Airport". Search Box API is what
 * Mapbox now points POI-search users to.
 *
 * Routing still uses the Directions v5 API, which is unaffected by that
 * change and remains the documented way to get a driving route.
 *
 * IMPORTANT: fetch-based functions here have NOT been tested against a
 * live Mapbox endpoint — this sandbox has no network access to
 * api.mapbox.com. Test the live fetch calls once you have a Mapbox token
 * wired into the actual app.
 */

const MAPBOX_BASE = "https://api.mapbox.com";

/**
 * Generates a session token for Search Box API billing/session-grouping.
 * Per Mapbox's docs, a session runs from the first /suggest call to the
 * /retrieve call — call this once per search session (e.g. once per
 * booking-form field the user is typing into), not once per keystroke.
 */
function createSearchSessionToken() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  // Fallback for environments without crypto.randomUUID
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * Search for addresses AND points of interest (airports, landmarks,
 * businesses) matching a text query, biased to Ireland. Use this for the
 * pickup/dropoff autocomplete fields.
 *
 * Two-step Search Box API flow: this is step one (/suggest). Each result
 * has a mapbox_id but NOT coordinates — call retrieveSuggestion() with the
 * chosen result to get lat/lng, per Mapbox's documented interactive-search
 * pattern.
 */
async function searchAddress(query, token, sessionToken) {
  const session = sessionToken || createSearchSessionToken();
  const url = `${MAPBOX_BASE}/search/searchbox/v1/suggest?q=${encodeURIComponent(query)}` +
    `&access_token=${token}&session_token=${session}&country=ie&language=en&limit=8`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Mapbox suggest failed: ${res.status}`);
  const json = await res.json();
  return {
    sessionToken: session,
    suggestions: parseSuggestions(json),
  };
}

/** Turn a raw Search Box /suggest response into a clean list of options. */
function parseSuggestions(json) {
  if (!json || !Array.isArray(json.suggestions)) return [];
  return json.suggestions.map((s) => ({
    mapboxId: s.mapbox_id,
    name: s.name,
    fullAddress: s.full_address || s.place_formatted || s.name,
    featureType: s.feature_type,
  }));
}

/**
 * Step two of the Search Box API flow: resolves a suggestion's mapbox_id
 * (from searchAddress) into real coordinates. Must use the SAME
 * sessionToken returned by searchAddress for correct session billing.
 */
async function retrieveSuggestion(mapboxId, token, sessionToken) {
  const url = `${MAPBOX_BASE}/search/searchbox/v1/retrieve/${encodeURIComponent(mapboxId)}` +
    `?access_token=${token}&session_token=${sessionToken}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Mapbox retrieve failed: ${res.status}`);
  const json = await res.json();
  return parseRetrieveFeature(json);
}

/** Turn a raw Search Box /retrieve response into {name, fullAddress, lat, lng}. */
function parseRetrieveFeature(json) {
  if (!json || !Array.isArray(json.features) || json.features.length === 0) {
    return null;
  }
  const f = json.features[0];
  const [lng, lat] = f.geometry.coordinates;
  return {
    name: f.properties.name,
    fullAddress: f.properties.full_address || f.properties.place_formatted || f.properties.name,
    lng,
    lat,
  };
}

/**
 * Reverse-geocode a coordinate pair into a readable address.
 * Use this for the "Use current location" GPS button. The /reverse
 * endpoint returns coordinates directly (no /retrieve step needed).
 */
async function reverseGeocode(lng, lat, token) {
  const url = `${MAPBOX_BASE}/search/searchbox/v1/reverse?longitude=${lng}&latitude=${lat}` +
    `&access_token=${token}&country=ie&limit=1`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Mapbox reverse geocoding failed: ${res.status}`);
  const json = await res.json();
  return parseRetrieveFeature(json);
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
  createSearchSessionToken,
  searchAddress,
  retrieveSuggestion,
  reverseGeocode,
  getRoute,
  parseSuggestions,
  parseRetrieveFeature,
  parseDirectionsRoute,
};

