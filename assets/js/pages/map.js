// The live map, laid out like the live map of Smart Parks Protect: a marker per sensor, the
// Layers button top left, the tools as square buttons top right (base map, 3D terrain,
// measure, tracks) and the panels in a column beside them.

import { SCOPES } from "../api.js";
import { ago, buildHash, distanceMeters, formatDistance, speciesIcon, toPoint, toTime, trackLength, withinWindow } from "../lib.js";
import { BASEMAPS, LiveMap, MAX_RADIUS_M, TRACK_COLORS, loadBasemap, trackColor } from "../map.js";
import { account, explain, hasScope } from "../session.js";
import { canListSensors, listError, loadReadings, loadRecent, loadSensors, loadedReadings, recentReadings, sensorById } from "../store.js";
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
let measure = [];

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

function iconOf(sensor) {
  return speciesIcon(sensor.animal && sensor.animal.species ? sensor.animal.species.name : "");
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

/** A square icon button of a panel; `on` fills it. */
function iconButton(name, label, onclick, { on = false, href = "", disabled = false } = {}) {
  const attrs = { class: `btn ${on ? "primary" : "outline"} icon`, title: label, "aria-label": label };
  if (href) return el("a", { ...attrs, href }, icon(name));
  return el("button", { ...attrs, type: "button", disabled, onclick, "aria-pressed": String(on) }, icon(name));
}

// ---------------------------------------------------------------------------------------------
// Drawing

function drawMarkers() {
  const shown = sensors.filter((sensor) => sensor.place && !hidden.has(sensor.id));
  map.setSensors(shown.map((sensor) => ({ id: sensor.id, name: sensor.name, icon: iconOf(sensor), lat: sensor.place.lat, lng: sensor.place.lng })));
  const placed = sensors.filter((sensor) => sensor.place).length;
  $("mapCount").textContent = shown.length === sensors.length ? plural(sensors.length, "sensor") : `${shown.length} of ${plural(sensors.length, "sensor")}`;
  $("mapCount").title = placed < sensors.length ? `${sensors.length - placed} without a position yet` : "";
  if (!fitted && shown.length) {
    fitted = true;
    map.fit(shown.map((sensor) => sensor.place), { maxZoom: 15 });
  }
}

function drawTracks() {
  const drawn = [...tracks.entries()].map(([id, slot]) => {
    const sensor = sensorById(id);
    return { id, name: sensor ? sensor.name : id, slot, points: trackPoints(id) };
  });
  map.setTracks(drawn);
  const points = drawn.reduce((sum, track) => sum + track.points.length, 0);
  $("mapTracksWrap").hidden = drawn.length === 0;
  $("mapTracksBadge").textContent = drawn.length;
  $("mapTracksText").textContent = `${plural(drawn.length, "track")}, ${plural(points, "point")}`;
  if (!drawn.length) showCard("tracksCard", false);
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
          const locate = el("button", { class: "btn ghost icon sm", type: "button", title: "Show on map", "aria-label": "Show on map", disabled: !sensor.place, onclick: () => select(sensor.id, true) }, icon("locate"));
          return el("div", { class: `layer-row${sensor.id === selected ? " selected" : ""}` }, [
            box,
            el("img", { class: "layer-icon", src: `assets/img/icons/${iconOf(sensor)}.svg`, alt: "" }),
            el("button", { class: "layer-name", type: "button", onclick: () => select(sensor.id, true) }, [el("span", { text: sensor.name }), sub ? el("small", { text: sub }) : null]),
            trackButton,
            locate,
          ]);
        })
      : [el("div", { class: "picker-empty" }, sensors.length ? "No sensor matches the search." : ["No sensors yet. Add one by its ID on the ", el("a", { href: buildHash("sensors"), text: "Sensors page" }), "."])]),
  );
}

function drawObjectPanel() {
  const panel = $("objectPanel");
  const sensor = sensorById(selected);
  panel.hidden = !sensor;
  if (!sensor) return;
  const loaded = recentReadings(sensor.id); // the newest readings are enough for these facts
  const all = loadedReadings(sensor.id);
  const track = loaded ? loaded.track : [];
  const last = track[track.length - 1];
  const readings = loaded ? loaded.readings : [];
  const newest = readings.reduce((best, r) => (!best || toTime(r.timestamp) > toTime(best.timestamp) ? r : best), null);
  const withTemperature = readings.filter((r) => typeof r.temperature === "number").sort((a, b) => toTime(a.timestamp) - toTime(b.timestamp));
  const temperature = withTemperature.length ? withTemperature[withTemperature.length - 1].temperature : null;
  const tracked = tracks.has(sensor.id);
  const inPeriod = trackPoints(sensor.id);
  const list = el("dl", { class: "facts" });
  facts(list, [
    ["Sensor ID", sensor.id],
    ["Last seen", loaded ? (newest ? ago(toTime(newest.timestamp)) : "no readings yet") : "loading…"],
    ["Position", last ? formatMoment(last.t) : loaded ? (loaded.complete ? "none yet" : "not recently") : ""],
    ["Coordinates", sensor.place ? `${sensor.place.lat.toFixed(5)}, ${sensor.place.lng.toFixed(5)}` : ""],
    ["Temperature", temperature == null ? "" : `${temperature} °C`],
    ["Animal", sensor.animal ? [sensor.animal.name, sensor.species && `(${sensor.species})`].filter(Boolean).join(" ") : ""],
    ["Track", all && tracked ? `${inPeriod.length.toLocaleString()} of ${plural(all.track.length, "point")}, ${formatDistance(trackLength(inPeriod))}` : ""],
  ]);
  panel.replaceChildren(
    el("div", { class: "panel-head" }, [
      el("img", { class: "object-icon", src: `assets/img/icons/${iconOf(sensor)}.svg`, alt: "" }),
      el("div", { class: "object-title" }, [el("strong", { text: sensor.name }), el("small", { text: sensor.species ? `sensor on ${sensor.species.toLowerCase()}` : "sensor" })]),
      el("button", { class: "btn ghost icon sm", type: "button", "aria-label": "Close", title: "Close", onclick: () => select("") }, icon("x")),
    ]),
    list,
    el("div", { class: "row" }, [
      iconButton("route", tracked ? "Hide the track" : "Show the track", () => toggleTrack(sensor.id), { on: tracked }),
      iconButton("locate", "Centre the map here", () => sensor.place && map.flyTo(sensor.place), { disabled: !sensor.place }),
      iconButton("sensor", "Open the sensor page", null, { href: buildHash("sensors", sensor.id) }),
      iconButton("chart", "Open in the data explorer", null, { href: buildHash("explore", "", { sensors: sensor.id, metrics: "speed" }) }),
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
// Tools: base map, terrain, measure

function showCard(id, open) {
  $(id).hidden = !open;
  const button = { layerPanel: "mapLayersButton", tracksCard: "mapTracksButton" }[id];
  if (button) $(button).setAttribute(id === "layerPanel" ? "aria-expanded" : "aria-pressed", String(open));
  if (button === "mapTracksButton") $(button).classList.toggle("active", open);
}

function drawBasemapMenu() {
  $("mapBasemapMenu").replaceChildren(
    ...Object.entries(BASEMAPS).map(([key, basemap]) =>
      el("button", { class: "menu-item", type: "button", role: "menuitemradio", "aria-checked": String(key === map.basemap), onclick: () => chooseBasemap(key) }, [key === map.basemap ? icon("check-small") : el("span", { class: "icon" }), basemap.label]),
    ),
  );
}

function openBasemapMenu(open) {
  $("mapBasemapMenu").hidden = !open;
  $("mapBasemapButton").setAttribute("aria-expanded", String(open));
}

function chooseBasemap(key) {
  map.setBasemap(key);
  drawBasemapMenu();
  openBasemapMenu(false);
}

function drawTerrain() {
  const button = $("mapTerrain");
  button.classList.toggle("active", map.terrain);
  button.setAttribute("aria-pressed", String(map.terrain));
  button.title = map.terrain ? "Flat map" : "3D terrain";
  button.setAttribute("aria-label", button.title);
}

function setMeasuring(on) {
  measure = [];
  map.setMeasuring(on);
  map.setMeasure(measure);
  $("measureCard").hidden = !on;
  const button = $("mapMeasure");
  button.classList.toggle("active", on);
  button.setAttribute("aria-pressed", String(on));
  button.title = on ? "Stop measuring" : "Measure";
  button.setAttribute("aria-label", button.title);
  drawMeasure();
}

function drawMeasure() {
  map.setMeasure(measure);
  let total = 0;
  for (let i = 1; i < measure.length; i++) total += distanceMeters(measure[i - 1], measure[i]);
  $("measureText").textContent = measure.length > 1 ? formatDistance(total) : "Measure";
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
  try {
    await loadRecent(id);
  } catch (error) {
    const text = explain(error);
    if (text) toast(`${id}: ${text}`, true);
  }
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
      else toast(points.length ? "Only one position in this period" : "No positions in this period. Choose a longer track length under Tracks.");
    }
  }
  redraw();
}

/** Sensors without a place get their newest readings in the background, three at a time. */
async function locateTheRest() {
  const queue = sensors.filter((sensor) => !sensor.place && !recentReadings(sensor.id));
  const worker = async () => {
    for (let sensor = queue.shift(); sensor; sensor = queue.shift()) {
      try {
        await loadRecent(sensor.id);
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
    const radius = Math.min(MAX_RADIUS_M, Math.max(1000, map.viewRadius()));
    const detections = await account.api.detections({
      start: new Date(Date.now() - DETECTION_DAYS * 24 * HOUR).toISOString(),
      end: new Date().toISOString(),
      latitude: center.lat,
      longitude: center.lng,
      radius,
    });
    map.setDetections(
      detections
        .map((d) => ({ point: toPoint(d, "start"), d }))
        .filter((x) => x.point)
        .map(({ point, d }) => ({ lat: point.lat, lng: point.lng, title: (d.species && (d.species.commonName || d.species.name)) || "Detection", lines: [formatMoment(point.t), d.deploymentID, d.sensorType] })),
    );
    toast(`${plural(detections.length, "detection")} within ${Math.round(radius / 1000)} km of the map centre in the last ${DETECTION_DAYS} days`);
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
  note($("mapNote"), problem ? `Could not list the deployed sensors: ${problem}` : sensors.length || canListSensors() ? "" : "Your account cannot list the deployed sensors (that needs the herd-manager role). Add a sensor by its ID on the Sensors page.", problem ? "warn" : "");
  redraw();
  locateTheRest();
}

function wire() {
  drawBasemapMenu();
  drawTerrain();
  $("mapBasemapButton").addEventListener("click", () => openBasemapMenu($("mapBasemapMenu").hidden));
  document.addEventListener("click", (event) => {
    if (!event.target.closest(".tool-menu")) openBasemapMenu(false);
  });
  $("mapTerrain").addEventListener("click", () => {
    map.setTerrain(!map.terrain);
    drawTerrain();
  });
  $("mapMeasure").addEventListener("click", () => setMeasuring(!map.measuring));
  $("measureClose").addEventListener("click", () => setMeasuring(false));
  $("measureClear").addEventListener("click", () => {
    measure = [];
    drawMeasure();
  });
  $("measureUndo").addEventListener("click", () => {
    measure = measure.slice(0, -1);
    drawMeasure();
  });

  $("mapLayersButton").addEventListener("click", () => showCard("layerPanel", $("layerPanel").hidden));
  $("layerClose").addEventListener("click", () => showCard("layerPanel", false));
  $("mapTracksButton").addEventListener("click", () => showCard("tracksCard", $("tracksCard").hidden));
  $("tracksClose").addEventListener("click", () => showCard("tracksCard", false));
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
  $("mapTrackHours").addEventListener("change", redraw);
  $("mapClearTracks").addEventListener("click", () => {
    tracks.clear();
    redraw();
  });
  $("mapDetections").addEventListener("change", loadDetections);
  document.addEventListener("themechange", drawLayerList); // the track buttons follow the theme
}

/** Shows the page; `?sensor=ID` selects a sensor and `&track=1` draws its track. */
export async function show({ query }) {
  if (!map) {
    map = new LiveMap($("liveMap"), {
      onSensor: (id) => select(id),
      onNothing: () => select(""),
      describePoint: (track, point) => [track.name, pointLines(point)],
      onMeasure: (place) => {
        measure = [...measure, place];
        drawMeasure();
      },
    });
    if (map.map) wire();
  }
  if (!map.map) return;
  await reload();
  if (query.sensor && sensorById(query.sensor)) {
    await select(query.sensor, true);
    if (query.track) await toggleTrack(query.sensor, true);
  }
  if (query.sensor) history.replaceState(null, "", buildHash("map"));
}

/** Forgets what belongs to the account that signed out. */
export function reset() {
  sensors = [];
  tracks.clear();
  selected = "";
  fitted = false;
  if (!map || !map.map) return;
  setMeasuring(false);
  map.setSelected("");
  map.setSensors([]);
  map.setTracks([]);
  map.setDetections([]);
  for (const id of ["objectPanel", "layerPanel", "tracksCard"]) $(id).hidden = true;
  $("mapDetections").checked = false;
}
