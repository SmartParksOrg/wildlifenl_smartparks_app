// The live map: a marker per sensor, the layers panel that chooses what is shown, tracks and
// the panel of the selected sensor. It follows the live map of Smart Parks Protect.

import { SCOPES } from "../api.js";
import { ago, buildHash, formatDistance, toPoint, toTime, trackLength, withinWindow } from "../lib.js";
import { BASEMAPS, LiveMap, TRACK_COLORS, loadBasemap, trackColor } from "../map.js";
import { account, explain, hasScope } from "../session.js";
import { addSensor, canListSensors, listError, loadReadings, loadSensors, loadedReadings, sensorById } from "../store.js";
import { $, el, facts, formatMoment, icon, note, plural, toast } from "../ui.js";

const HIDDEN_KEY = "wnl-map-hidden";
const HOUR = 3600 * 1000;
const DETECTION_DAYS = 7;

/** @type {LiveMap|null} */
let map = null;
let sensors = [];
let hidden = new Set(readHidden());
/** sensor id to its slot in TRACK_COLORS; a track keeps its colour while it is shown */
const tracks = new Map();
let selected = "";
let fitted = false;

function readHidden() {
  try {
    const ids = JSON.parse(localStorage.getItem(HIDDEN_KEY) || "[]");
    return Array.isArray(ids) ? ids : [];
  } catch {
    return [];
  }
}

function saveHidden() {
  localStorage.setItem(HIDDEN_KEY, JSON.stringify([...hidden]));
}

function trackHours() {
  const value = $("mapTrackHours").value;
  return value === "all" ? NaN : Number(value);
}

function trackPoints(id) {
  const loaded = loadedReadings(id);
  if (!loaded) return [];
  const hours = trackHours();
  return withinWindow(loaded.track, Number.isFinite(hours) ? Date.now() - hours * HOUR : NaN, NaN);
}

function pointLines(point) {
  const reading = point.raw;
  return [
    formatMoment(point.t),
    `${point.lat.toFixed(5)}, ${point.lng.toFixed(5)}`,
    typeof reading.temperature === "number" ? `${reading.temperature} °C` : "",
    typeof reading.altitude === "number" ? `${Math.round(reading.altitude)} m altitude` : "",
  ];
}

// ---------------------------------------------------------------------------------------------
// Drawing

function drawMarkers() {
  const shown = sensors.filter((sensor) => sensor.place && !hidden.has(sensor.id));
  map.setSensors(shown.map((sensor) => ({ id: sensor.id, name: sensor.name, lat: sensor.place.lat, lng: sensor.place.lng })));
  const placed = sensors.filter((sensor) => sensor.place).length;
  $("mapCount").textContent = shown.length === sensors.length ? plural(sensors.length, "sensor") : `${shown.length} of ${plural(sensors.length, "sensor")}`;
  $("mapCount").title = placed < sensors.length ? `${sensors.length - placed} without a position yet` : "";
  if (!fitted && shown.length) {
    fitted = true;
    map.fit(shown.map((sensor) => sensor.place), { maxZoom: 12 });
  }
}

function drawTracks() {
  const drawn = [...tracks.entries()].map(([id, slot]) => {
    const sensor = sensorById(id);
    return { id, name: sensor ? sensor.name : id, slot, points: trackPoints(id).map((p) => ({ lat: p.lat, lng: p.lng, t: p.t, lines: pointLines(p) })) };
  });
  map.setTracks(drawn);
  const points = drawn.reduce((sum, track) => sum + track.points.length, 0);
  const select = $("mapTrackHours");
  $("mapTracks").hidden = drawn.length === 0;
  $("mapTracksText").textContent = `${plural(drawn.length, "track")}, ${plural(points, "point")}, ${select.options[select.selectedIndex].text.toLowerCase()}`;
}

function drawLayerList() {
  const query = $("layerSearch").value.trim().toLowerCase();
  const rows = sensors.filter((sensor) => !query || `${sensor.name} ${sensor.id} ${sensor.species}`.toLowerCase().includes(query));
  $("layerList").replaceChildren(
    ...(rows.length
      ? rows.map((sensor) => {
          const box = el("input", { type: "checkbox", checked: !hidden.has(sensor.id), "aria-label": `Show ${sensor.name}` });
          box.addEventListener("change", () => {
            if (box.checked) hidden.delete(sensor.id);
            else hidden.add(sensor.id);
            saveHidden();
            drawMarkers();
          });
          const tracked = tracks.has(sensor.id);
          const sub = [sensor.name !== sensor.id ? sensor.id : "", sensor.species, sensor.place ? "" : "no position yet"].filter(Boolean).join(" · ");
          const trackButton = el("button", { class: `btn ghost icon sm${tracked ? " active" : ""}`, type: "button", title: tracked ? "Hide the track" : "Show the track", "aria-label": tracked ? "Hide the track" : "Show the track", onclick: () => toggleTrack(sensor.id) }, icon("route"));
          if (tracked) trackButton.style.color = trackColor(tracks.get(sensor.id));
          return el("div", { class: `layer-row${sensor.id === selected ? " selected" : ""}` }, [
            box,
            el("button", { class: "layer-name", type: "button", onclick: () => select(sensor.id, true) }, [el("span", { text: sensor.name }), sub ? el("small", { text: sub }) : null]),
            trackButton,
          ]);
        })
      : [el("div", { class: "picker-empty", text: sensors.length ? "No sensor matches the search." : canListSensors() ? "WildlifeNL has no active sensor deployments. Add a sensor by its ID." : "Add a sensor by its ID to see it on the map." })]),
  );
}

function drawObjectPanel() {
  const panel = $("objectPanel");
  const sensor = sensorById(selected);
  panel.hidden = !sensor;
  if (!sensor) return;
  const loaded = loadedReadings(sensor.id);
  const track = loaded ? loaded.track : [];
  const last = track[track.length - 1];
  const readings = loaded ? loaded.readings : [];
  const newest = readings.reduce((best, r) => (toTime(r.timestamp) > toTime(best && best.timestamp) || !best ? r : best), null);
  const latest = (read) => {
    const withValue = readings.filter((r) => typeof read(r) === "number").sort((a, b) => toTime(a.timestamp) - toTime(b.timestamp));
    return withValue.length ? read(withValue[withValue.length - 1]) : null;
  };
  const temperature = latest((r) => r.temperature);
  const list = el("dl", { class: "facts" });
  const tracked = tracks.has(sensor.id);
  const inPeriod = trackPoints(sensor.id);
  facts(list, [
    ["Sensor ID", sensor.id],
    ["Last seen", loaded ? (newest ? ago(toTime(newest.timestamp)) : "no readings yet") : "loading…"],
    ["Position", last ? formatMoment(last.t) : loaded ? "none yet" : ""],
    ["Coordinates", sensor.place ? `${sensor.place.lat.toFixed(5)}, ${sensor.place.lng.toFixed(5)}` : ""],
    ["Temperature", temperature == null ? "" : `${temperature} °C`],
    ["Animal", sensor.animal ? [sensor.animal.name, sensor.species && `(${sensor.species})`].filter(Boolean).join(" ") : ""],
    ["Sensor", el("a", { href: buildHash("sensors", sensor.id), text: "open sensor" })],
    ["More", el("a", { href: buildHash("explore", "", { sensors: sensor.id, metrics: "temperature" }), text: "data" })],
  ]);
  panel.replaceChildren(
    el("div", { class: "panel-head" }, [
      el("div", { class: "object-title" }, [el("strong", { text: sensor.name }), el("small", { text: sensor.species ? `sensor on ${sensor.species.toLowerCase()}` : "sensor" })]),
      el("button", { class: "btn ghost icon sm", type: "button", "aria-label": "Close", onclick: () => select("") }, icon("x")),
    ]),
    list,
    el("div", { class: "row" }, [
      el("button", { class: "btn primary sm", type: "button", text: tracked ? "Hide the track" : "Show the track", onclick: () => toggleTrack(sensor.id) }),
      loaded && tracked ? el("span", { class: "hint", text: `${inPeriod.length} of ${plural(track.length, "point")}, ${formatDistance(trackLength(inPeriod))}` }) : null,
    ]),
  );
}

function redraw() {
  drawMarkers();
  drawTracks();
  drawLayerList();
  drawObjectPanel();
}

// ---------------------------------------------------------------------------------------------
// Actions

async function ensureReadings(id) {
  try {
    await loadReadings(id);
    return true;
  } catch (error) {
    const text = explain(error);
    if (text) toast(`${id}: ${text}`, true);
    return false;
  }
}

async function select(id, fly = false) {
  selected = id;
  map.setSelected(id);
  drawLayerList();
  drawObjectPanel();
  if (!id) return;
  if (hidden.delete(id)) saveHidden();
  await ensureReadings(id);
  if (selected !== id) return;
  redraw();
  const sensor = sensorById(id);
  if (fly && sensor && sensor.place) map.flyTo(sensor.place);
}

async function toggleTrack(id, force) {
  const on = force ?? !tracks.has(id);
  if (!on) tracks.delete(id);
  else if (!tracks.has(id)) {
    const used = new Set(tracks.values());
    const slot = TRACK_COLORS.findIndex((_, index) => !used.has(index));
    if (slot < 0) return toast(`At most ${TRACK_COLORS.length} tracks at a time. Hide one first.`, true);
    tracks.set(id, slot);
    if (!(await ensureReadings(id))) tracks.delete(id);
    else {
      const points = trackPoints(id);
      if (points.length > 1) map.fit(points, { animate: true });
      else toast(points.length ? "Only one position in this period" : "No positions in this period. Choose a longer track length.");
    }
  }
  redraw();
}

/** Sensors without a place get their readings in the background, three at a time. */
async function locateTheRest() {
  const queue = sensors.filter((sensor) => !sensor.place && !loadedReadings(sensor.id));
  const worker = async () => {
    for (let sensor = queue.shift(); sensor; sensor = queue.shift()) {
      try {
        await loadReadings(sensor.id);
      } catch (error) {
        if (!explain(error)) return; // signed out
      }
      drawMarkers();
      drawLayerList();
    }
  };
  await Promise.all([worker(), worker(), worker()]);
}

async function loadDetections() {
  if (!$("mapDetections").checked) return map.setDetections([]);
  try {
    const center = map.center();
    const detections = await account.api.detections({
      start: new Date(Date.now() - DETECTION_DAYS * 24 * HOUR).toISOString(),
      end: new Date().toISOString(),
      latitude: center.lat,
      longitude: center.lng,
      radius: Math.max(1000, map.viewRadius()),
    });
    map.setDetections(
      detections
        .map((d) => ({ point: toPoint(d, "start"), d }))
        .filter((x) => x.point)
        .map(({ point, d }) => ({ lat: point.lat, lng: point.lng, title: (d.species && (d.species.commonName || d.species.name)) || "Detection", lines: [formatMoment(point.t), d.deploymentID, d.sensorType] })),
    );
    toast(`${plural(detections.length, "detection")} in view in the last ${DETECTION_DAYS} days`);
  } catch (error) {
    $("mapDetections").checked = false;
    const text = explain(error);
    if (text) toast(text, true);
  }
}

async function reload(force = false) {
  $("layerDetections").hidden = !hasScope(SCOPES.detections);
  try {
    sensors = await loadSensors(force);
  } catch (error) {
    const text = explain(error);
    if (text) note($("mapNote"), text, "error");
    return;
  }
  const problem = listError();
  note($("mapNote"), problem ? `Could not list the deployed sensors: ${problem}` : sensors.length ? "" : canListSensors() ? "" : "Your account cannot list the deployed sensors (that needs the herd-manager role). Open Layers and add a sensor by its ID.", problem ? "warn" : "");
  redraw();
  locateTheRest();
}

function wire() {
  const basemap = $("mapBasemap");
  basemap.replaceChildren(...Object.entries(BASEMAPS).map(([key, value]) => el("option", { value: key, text: value.label })));
  basemap.value = loadBasemap();
  basemap.addEventListener("change", () => map.setBasemap(basemap.value));

  const panel = $("layerPanel");
  const togglePanel = (open) => {
    panel.hidden = !open;
    $("mapLayersButton").setAttribute("aria-expanded", String(open));
  };
  $("mapLayersButton").addEventListener("click", () => togglePanel(panel.hidden));
  $("layerClose").addEventListener("click", () => togglePanel(false));
  $("layerSearch").addEventListener("input", drawLayerList);
  $("layerShowAll").addEventListener("click", () => {
    hidden.clear();
    saveHidden();
    redraw();
  });
  $("layerHideAll").addEventListener("click", () => {
    hidden = new Set(sensors.map((sensor) => sensor.id));
    saveHidden();
    redraw();
  });
  $("layerReset").addEventListener("click", () => {
    hidden.clear();
    saveHidden();
    tracks.clear();
    $("mapTrackHours").value = "168";
    $("mapDetections").checked = false;
    $("layerSearch").value = "";
    map.setDetections([]);
    redraw();
  });
  $("layerAddForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const id = $("layerAddInput").value.trim();
    if (id.length < 2) return;
    addSensor(id);
    $("layerAddInput").value = "";
    await reload();
    select(id, true);
  });
  $("mapTrackHours").addEventListener("change", redraw);
  document.addEventListener("themechange", drawLayerList); // the track buttons follow the theme
  $("mapClearTracks").addEventListener("click", () => {
    tracks.clear();
    redraw();
  });
  $("mapDetections").addEventListener("change", loadDetections);
}

/** Shows the page; `?sensor=ID` selects a sensor and `&track=1` draws its track. */
export async function show({ query }) {
  if (!map) {
    map = new LiveMap($("liveMap"), { onSensor: (id) => select(id), onNothing: () => select("") });
    wire();
  }
  if (!map.map) return;
  await reload();
  if (query.sensor) {
    if (!sensorById(query.sensor)) {
      addSensor(query.sensor);
      await reload();
    }
    await select(query.sensor, true);
    if (query.track) await toggleTrack(query.sensor, true);
    history.replaceState(null, "", buildHash("map"));
  }
}

/** Forgets what belongs to the account that signed out. */
export function reset() {
  sensors = [];
  tracks.clear();
  selected = "";
  fitted = false;
  if (!map || !map.map) return;
  map.setSelected("");
  map.setSensors([]);
  map.setTracks([]);
  map.setDetections([]);
  $("objectPanel").hidden = true;
  $("layerPanel").hidden = true;
  $("mapDetections").checked = false;
  $("layerDetections").hidden = false;
}
