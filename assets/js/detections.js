// What the app has found around places: the detections of camera traps and other detectors,
// and the reports people made (the API calls those interactions). The live map shows both as
// layers and the Detections and Reports pages list them.
//
// WildlifeNL only answers within 10 km of a point and has no list of detectors, so an area is
// searched circle by circle. Every place with a find is remembered in this browser, per
// server, and from then on only those places are asked.

import { SCOPES } from "./api.js";
import { circleGrid, coverPlaces, toPoint, toTime } from "./lib.js";
import { account, explain, hasScope } from "./session.js";

/** WildlifeNL answers such a query within at most this many metres of a point. */
export const MAX_RADIUS_M = 10000;
/** At most this many circles in one search: about four minutes at the pace below. */
const MAX_CIRCLES = 300;
/** WildlifeNL allows 120 requests a minute per account; this leaves room for the other pages. */
const PACE_MS = 700;
const DAY = 24 * 3600 * 1000;
const DEFAULT_DAYS = 90;

function dateText(t) {
  return new Date(t - new Date(t).getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

/** `found` holds every detection of the period by ID and `reports` every report; `progress`
 * is a line for the person while a search runs; `message` says how the last search ended
 * when it found nothing. */
export const detections = {
  found: new Map(),
  reports: new Map(),
  from: dateText(Date.now() - DEFAULT_DAYS * DAY),
  to: dateText(Date.now()),
  busy: false,
  progress: "",
  message: "",
  loaded: false,
};

/** The two kinds of finds: where the API keeps them, who may ask, where they land. */
const KINDS = [
  { path: "detections", scope: SCOPES.detections, into: () => detections.found, places: "wnl-detection-places" },
  { path: "interactions", scope: SCOPES.reports, into: () => detections.reports, places: "wnl-report-places" },
];

const listeners = new Set();
let run = 0;
let lastStart = 0;

/** Calls `listener` whenever the detections or the progress change. */
export function onDetections(listener) {
  listeners.add(listener);
}

function changed() {
  for (const listener of listeners) listener();
}

function placesKey(name) {
  return `${name}:${new URL(account.session.baseUrl).host}`;
}

function placesOf(name) {
  try {
    const places = JSON.parse(localStorage.getItem(placesKey(name)) || "[]");
    return Array.isArray(places) ? places.filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng)) : [];
  } catch {
    return [];
  }
}

/** The places where a detector or a report was found before. */
export function knownPlaces() {
  return KINDS.flatMap((kind) => placesOf(kind.places));
}

/** Where a report happened: the place the person pointed at, else where the person stood. */
export function reportPlace(report) {
  const place = report.place || report.location;
  return place && Number.isFinite(place.latitude) && Number.isFinite(place.longitude) ? { lat: place.latitude, lng: place.longitude } : null;
}

function remember(kind, list) {
  const places = placesOf(kind.places);
  const seen = new Set(places.map((p) => `${p.lat},${p.lng}`));
  for (const item of list) {
    const point = kind.path === "detections" ? toPoint(item, "start") : reportPlace(item);
    if (!point) continue;
    const place = { lat: Math.round(point.lat * 1000) / 1000, lng: Math.round(point.lng * 1000) / 1000 };
    if (!seen.has(`${place.lat},${place.lng}`)) {
      seen.add(`${place.lat},${place.lng}`);
      places.push(place);
    }
  }
  localStorage.setItem(placesKey(kind.places), JSON.stringify(places));
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** One question about one circle, paced so a long search stays under the limit of the API;
 * a "slow down" answer is waited out and tried again. */
async function ask(kind, centre, mine) {
  const start = new Date(toTime(`${detections.from}T00:00`)).toISOString();
  const end = new Date(toTime(`${detections.to}T23:59:59`)).toISOString();
  for (let attempt = 0; attempt < 4 && mine === run; attempt++) {
    const pause = lastStart + PACE_MS - Date.now();
    lastStart = Math.max(Date.now(), lastStart + PACE_MS);
    if (pause > 0) await wait(pause);
    if (mine !== run) return [];
    try {
      return await account.api.around(kind.path, { start, end, latitude: centre.lat, longitude: centre.lng, radius: MAX_RADIUS_M });
    } catch (error) {
      if (error.status !== 429) throw error;
      detections.progress = "WildlifeNL asks to slow down, waiting 20 seconds…";
      changed();
      await wait(20000);
    }
  }
  return [];
}

async function search(centres, label) {
  const mine = ++run;
  const kinds = KINDS.filter((kind) => hasScope(kind.scope));
  detections.busy = true;
  detections.message = "";
  let done = 0;
  try {
    for (const centre of centres) {
      if (mine !== run) return;
      detections.progress = centres.length > 1 ? `${label} ${done + 1} of ${centres.length}` : "Searching…";
      changed();
      for (const kind of kinds) {
        const list = await ask(kind, centre, mine);
        if (mine !== run) return;
        for (const item of list) kind.into().set(item.ID, item);
        if (list.length) remember(kind, list);
      }
      done++;
    }
  } catch (error) {
    const text = explain(error);
    if (mine === run && text) detections.message = text;
  }
  if (mine !== run) return;
  detections.busy = false;
  detections.progress = "";
  if (!detections.found.size && !detections.reports.size && !detections.message) {
    detections.message = knownPlaces().length ? "Nothing in this period at the known places. Choose a longer period, or search another part of the map." : "Nothing found there. Search another part of the map; the app remembers where it finds detectors and reports.";
  }
  changed();
}

/** Loads the period at the known places, once; `force` loads it again. */
export function loadDetections(force = false) {
  if (detections.loaded && !force) return;
  detections.loaded = true;
  detections.found.clear();
  detections.reports.clear();
  const centres = coverPlaces(knownPlaces(), MAX_RADIUS_M * 0.9);
  if (centres.length) return search(centres, "Loading known area");
  run++;
  detections.busy = false;
  detections.progress = "";
  detections.message = "Nothing known yet. WildlifeNL only answers within 10 km of a point: open the live map, go to an area and search it under Layers.";
  changed();
}

/** Changes the period, as two `yyyy-mm-dd` dates, and loads it. */
export function setPeriod(from, to) {
  if (!(toTime(`${from}T00:00`) <= toTime(`${to}T23:59:59`))) {
    detections.message = "The period must end after it starts.";
    return changed();
  }
  detections.from = from;
  detections.to = to;
  loadDetections(true);
}

/** Searches the box `{south, west, north, east}` circle by circle. Returns a text when the
 * box is too large to search. */
export function searchBox(box) {
  const centres = circleGrid(box, MAX_RADIUS_M);
  if (centres.length > MAX_CIRCLES) return `This view needs ${centres.length} searches of 10 km each. Zoom in until it needs at most ${MAX_CIRCLES}, which takes about four minutes.`;
  detections.loaded = true;
  search(centres, "Searching area");
  return "";
}

export function stopSearch() {
  run++;
  detections.busy = false;
  detections.progress = "";
  changed();
}

export function speciesName(detection) {
  return (detection.species && (detection.species.commonName || detection.species.name)) || "Unknown";
}

/** `[key, count]` pairs of a list, most first. */
export function counted(items, keyOf) {
  const counts = new Map();
  for (const item of items) counts.set(keyOf(item), (counts.get(keyOf(item)) || 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1]);
}

/** The detectors of a list of detections: one per deployment and place, with what it saw. */
export function detectorsOf(list = [...detections.found.values()]) {
  const sites = new Map();
  for (const detection of list) {
    const point = toPoint(detection, "start");
    if (!point) continue;
    const id = `${detection.deploymentID}|${point.lat.toFixed(4)}|${point.lng.toFixed(4)}`;
    const site = sites.get(id) || { id, name: detection.deploymentID, lat: point.lat, lng: point.lng, latest: 0, detections: [] };
    site.latest = Math.max(site.latest, point.t);
    site.detections.push(detection);
    sites.set(id, site);
  }
  return [...sites.values()].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
}

/** Forgets the detections of the account that signed out; the remembered places stay. */
export function resetDetections() {
  run++;
  detections.found.clear();
  detections.reports.clear();
  detections.from = dateText(Date.now() - DEFAULT_DAYS * DAY);
  detections.to = dateText(Date.now());
  detections.busy = false;
  detections.progress = "";
  detections.message = "";
  detections.loaded = false;
}
