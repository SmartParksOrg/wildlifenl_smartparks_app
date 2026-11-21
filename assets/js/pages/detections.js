// Detections. WildlifeNL only answers within 10 km of a point, so this page searches an area
// circle by circle, remembers where it found detectors, and from then on asks only there.

import { PALETTE, LineChart } from "../chart.js";
import { ago, circleGrid, columnsOf, countPerDay, coverPlaces, flatten, toPoint, toTime } from "../lib.js";
import { MAX_RADIUS_M, MapView } from "../map.js";
import { account, explain } from "../session.js";
import { loadSensors } from "../store.js";
import { $, DataTable, MultiPicker, el, formatMoment, note, plural, tiles } from "../ui.js";

const DAY = 24 * 3600 * 1000;
const DEFAULT_DAYS = 90;
/** At most this many circles in one search: about four minutes at the pace below. */
const MAX_CIRCLES = 300;
/** WildlifeNL allows 120 requests a minute per account; this leaves room for the other pages. */
const PACE_MS = 700;
const COLUMNS = ["start", "end", "deploymentID", "sensorType", "species.commonName", "species.name", "animals", "confidence", "location.latitude", "location.longitude", "uri", "user.name", "ID"];
const LEFT_OUT = ["species.advice", "species.behaviour", "species.description", "species.roleInNature", "species.category", "species.ID", "user.ID"];

let map = null;
let table = null;
let chart = null;
let speciesPicker = null;
let detectorPicker = null;
/** every detection found for the chosen period, by ID */
const found = new Map();
let run = 0;
let lastStart = 0;
let loaded = false; // false until the page has loaded for the signed-in account

function placesKey() {
  return `wnl-detection-places:${new URL(account.session.baseUrl).host}`;
}

/** The places where a detector was found before, remembered per server in this browser. */
function knownPlaces() {
  try {
    const places = JSON.parse(localStorage.getItem(placesKey()) || "[]");
    return Array.isArray(places) ? places.filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng)) : [];
  } catch {
    return [];
  }
}

function remember(detections) {
  const places = knownPlaces();
  const seen = new Set(places.map((p) => `${p.lat},${p.lng}`));
  for (const detection of detections) {
    const point = toPoint(detection, "start");
    if (!point) continue;
    const place = { lat: Math.round(point.lat * 1000) / 1000, lng: Math.round(point.lng * 1000) / 1000 };
    if (!seen.has(`${place.lat},${place.lng}`)) {
      seen.add(`${place.lat},${place.lng}`);
      places.push(place);
    }
  }
  localStorage.setItem(placesKey(), JSON.stringify(places));
}

function period() {
  const start = toTime(`${$("detectionsFrom").value}T00:00`);
  const end = toTime(`${$("detectionsTo").value}T23:59:59`);
  return { start, end };
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** One circle, paced so a long search stays under the limit of the API; a "slow down"
 * answer is waited out and tried again. */
async function searchCircle(centre, mine) {
  const { start, end } = period();
  for (let attempt = 0; attempt < 4 && mine === run; attempt++) {
    const pause = lastStart + PACE_MS - Date.now();
    lastStart = Math.max(Date.now(), lastStart + PACE_MS);
    if (pause > 0) await wait(pause);
    if (mine !== run) return [];
    try {
      return await account.api.detections({ start: new Date(start).toISOString(), end: new Date(end).toISOString(), latitude: centre.lat, longitude: centre.lng, radius: MAX_RADIUS_M });
    } catch (error) {
      if (error.status !== 429) throw error;
      $("detectionsProgress").textContent = "WildlifeNL asks to slow down, waiting 20 seconds…";
      await wait(20000);
    }
  }
  return [];
}

/** Searches the circles one after another and draws what comes in. */
async function search(centres, label) {
  const mine = ++run;
  const { start, end } = period();
  if (!(start < end)) return note($("detectionsNote"), "The period must end after it starts.", "error");
  note($("detectionsNote"), "");
  $("detectionsStop").hidden = centres.length < 4;
  $("detectionsScan").disabled = true;
  let done = 0;
  try {
    for (const centre of centres) {
      if (mine !== run) break;
      $("detectionsProgress").textContent = centres.length > 1 ? `${label} ${done + 1} of ${centres.length}, ${plural(found.size, "detection")} so far` : "Searching…";
      map.setCircle(centre, MAX_RADIUS_M, searchAround);
      const detections = await searchCircle(centre, mine);
      if (mine !== run) break;
      for (const detection of detections) found.set(detection.ID, detection);
      if (detections.length) {
        remember(detections);
        draw();
      }
      done++;
    }
  } catch (error) {
    const text = explain(error);
    if (text) note($("detectionsNote"), text, "error");
  }
  if (mine !== run) return;
  $("detectionsProgress").textContent = "";
  $("detectionsStop").hidden = true;
  $("detectionsScan").disabled = false;
  draw();
  if (!found.size) note($("detectionsNote"), knownPlaces().length ? "No detections in this period at the known detectors. Choose a longer period, or search another part of the map." : "No detections found here. Move or zoom the map to the area you want and search again; the app remembers where it finds detectors.", "warn");
}

function searchAround(place) {
  search([{ lat: place.lat, lng: place.lng }], "Searching");
}

function scanView() {
  const box = map.bounds();
  if (!box) return;
  const centres = circleGrid(box, MAX_RADIUS_M);
  if (centres.length > MAX_CIRCLES) return note($("detectionsNote"), `This view needs ${centres.length} searches of 10 km each. Zoom in until it needs at most ${MAX_CIRCLES}, which takes about four minutes.`, "warn");
  search(centres, "Searching area");
}

function chosen() {
  const species = new Set(speciesPicker.values());
  const detectors = new Set(detectorPicker.values());
  return [...found.values()].filter((d) => (!species.size || species.has(speciesName(d))) && (!detectors.size || detectors.has(d.deploymentID)));
}

function speciesName(detection) {
  return (detection.species && (detection.species.commonName || detection.species.name)) || "Unknown";
}

function counted(items, keyOf) {
  const counts = new Map();
  for (const item of items) counts.set(keyOf(item), (counts.get(keyOf(item)) || 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1]);
}

function draw() {
  const all = [...found.values()];
  speciesPicker.set(counted(all, speciesName).map(([name, count]) => ({ value: name, label: name, note: count.toLocaleString() })), speciesPicker.values());
  detectorPicker.set(counted(all, (d) => d.deploymentID).map(([name, count]) => ({ value: name, label: name, note: count.toLocaleString() })), detectorPicker.values());
  const detections = chosen();
  const times = detections.map((d) => toTime(d.start)).filter(Number.isFinite);
  const latest = times.length ? Math.max(...times) : NaN;
  const species = counted(detections, speciesName);
  const detectors = counted(detections, (d) => d.deploymentID);
  tiles($("detectionsTiles"), [
    { label: "Detections", value: detections.length.toLocaleString(), note: detections.length === all.length ? "" : `${all.length.toLocaleString()} without the filters` },
    { label: "Species", value: species.length.toLocaleString(), note: species.length ? `Most: ${species[0][0]}` : "" },
    { label: "Detectors", value: detectors.length.toLocaleString(), note: plural(knownPlaces().length, "known place") },
    { label: "Latest detection", value: ago(latest) || "None", note: formatMoment(latest) },
  ]);

  // one point per detector, with what it saw in the popup
  const sites = new Map();
  for (const detection of detections) {
    const point = toPoint(detection, "start");
    if (!point) continue;
    const key = `${detection.deploymentID}|${point.lat.toFixed(4)}|${point.lng.toFixed(4)}`;
    const site = sites.get(key) || { lat: point.lat, lng: point.lng, t: 0, name: detection.deploymentID, detections: [] };
    site.t = Math.max(site.t, point.t);
    site.detections.push(detection);
    sites.set(key, site);
  }
  map.setPoints([...sites.values()], {
    fit: false,
    describe: (site) => [site.name, [plural(site.detections.length, "detection"), `Latest ${formatMoment(site.t)}`, counted(site.detections, speciesName).slice(0, 4).map(([name, count]) => `${name} ${count}`).join(", ")]],
  });

  $("detectionsChartCard").hidden = !times.length;
  $("detectionsSpeciesCard").hidden = !species.length;
  if (times.length) chart.set({ unit: "", series: [{ name: "Detections", color: PALETTE[0], data: countPerDay(times) }] });
  const most = species.length ? species[0][1] : 1;
  const picked = new Set(speciesPicker.values());
  $("detectionsBars").replaceChildren(
    ...species.slice(0, 12).map(([name, count]) =>
      el("button", { class: `bar${picked.has(name) ? " on" : ""}`, type: "button", title: picked.has(name) ? "Show all species again" : `Show only ${name}`, onclick: () => toggleSpecies(name) }, [
        el("span", { class: "bar-name", text: name }),
        el("span", { class: "bar-track" }, el("span", { class: "bar-fill", style: `width:${Math.max(2, (count / most) * 100)}%` })),
        el("span", { class: "bar-count", text: count.toLocaleString() }),
      ]),
    ),
    species.length > 12 ? el("span", { class: "hint", text: `and ${species.length - 12} more, see the Species filter` }) : "",
  );

  const rows = detections.map((detection) => {
    const animals = detection.animals || [];
    const flat = flatten({ ...detection, animals: animals.length });
    for (const key of LEFT_OUT) delete flat[key];
    flat.confidence = animals.length ? `${Math.max(...animals.map((a) => a.confidence || 0))}%` : "";
    return flat;
  });
  const present = columnsOf(rows);
  table.setRows(rows, { columns: [...COLUMNS.filter((c) => present.includes(c)), ...present.filter((c) => !COLUMNS.includes(c))], sortKey: "start", raw: detections });
}

function toggleSpecies(name) {
  const values = speciesPicker.values();
  speciesPicker.set(speciesPicker.options, values.includes(name) ? values.filter((v) => v !== name) : [name]);
  draw();
}

/** Loads the period again at the known detectors; the first time there are none yet. */
async function reload() {
  found.clear();
  draw();
  const centres = coverPlaces(knownPlaces(), MAX_RADIUS_M * 0.9);
  if (centres.length) {
    map.fit(knownPlaces(), { maxZoom: 11 });
    return search(centres, "Loading detector area");
  }
  ++run;
  note($("detectionsNote"), "No detectors known yet. WildlifeNL only answers within 10 km of a point, so move the map to the area you want and choose Search this map view. The app remembers where it finds detectors.");
  try {
    const sensor = (await loadSensors()).find((s) => s.place);
    if (sensor) map.fit([sensor.place], { maxZoom: 9 });
  } catch (error) {
    explain(error);
  }
}

function setPeriod() {
  const iso = (t) => new Date(t - new Date(t).getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  $("detectionsFrom").value = iso(Date.now() - DEFAULT_DAYS * DAY);
  $("detectionsTo").value = iso(Date.now());
}

export async function show() {
  if (map) {
    if (!loaded) {
      loaded = true;
      await reload();
    }
    return;
  }
  loaded = true;
  map = new MapView($("detectionsMap"));
  table = new DataTable($("detectionsTable"), { filename: "wildlifenl-detections", empty: "No detections loaded yet." });
  chart = new LineChart($("detectionsChart"));
  speciesPicker = new MultiPicker($("detectionsSpecies"), { placeholder: "All species", noun: "species", onChange: draw });
  detectorPicker = new MultiPicker($("detectionsDetectors"), { placeholder: "All detectors", noun: "detectors", onChange: draw });
  setPeriod();
  $("detectionsScan").addEventListener("click", scanView);
  $("detectionsStop").addEventListener("click", () => {
    run++;
    $("detectionsProgress").textContent = "";
    $("detectionsStop").hidden = true;
    $("detectionsScan").disabled = false;
    draw();
  });
  for (const id of ["detectionsFrom", "detectionsTo"]) $(id).addEventListener("change", reload);
  map.setCircle(null, 0, searchAround);
  await reload();
}

export function reset() {
  run++;
  found.clear();
  if (!map) return;
  setPeriod();
  speciesPicker.set([], []);
  detectorPicker.set([], []);
  draw();
  note($("detectionsNote"), "");
  $("detectionsProgress").textContent = "";
  $("detectionsStop").hidden = true;
  $("detectionsScan").disabled = false;
  loaded = false; // the next account loads its own detectors
}
