// The live map, laid out like the live map of Smart Parks Protect: the Layers button top
// left, the tools as square buttons top right (base map, 3D terrain, measure, tracks) and the
// panels in a column beside them. Everything WildlifeNL knows a place of is a layer: the
// animals (each through the sensor it carries), sensors without an animal, detectors, reports
// from people, living labs and zones.

import { SCOPES } from "../api.js";
import { counted, detections, detectorsOf, loadDetections, onDetections, reportPlace, searchBox, speciesName, stopSearch } from "../detections.js";
import { ago, buildHash, distanceMeters, formatDistance, speciesIcon, toTime, trackLength, webLink, withinWindow } from "../lib.js";
import { BASEMAPS, LiveMap, TRACK_COLORS, trackColor } from "../map.js";
import { listRecords, recordHash, titleOf } from "../records.js";
import { account, explain, hasScope } from "../session.js";
import { canListSensors, listError, loadReadings, loadRecent, loadSensors, loadedReadings, recentReadings, sensorByAnimal, sensorById } from "../store.js";
import { $, el, facts, formatMoment, icon, note, plural, toast } from "../ui.js";
import { choices, drawTab, isCustomised, isShown, openTab, resetChoices, show as showRow } from "./map-layers.js";

const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;
const TABS = ["animals", "sensors", "detectors", "reports", "areas"];

/** @type {LiveMap|null} */
let map = null;
let sensors = [];
/** living labs and zones: `{id, name, kind, record, points}` */
let areas = [];
/** sensor id to its slot in TRACK_COLORS; a track keeps its colour while it is shown */
const tracks = new Map();
/** what is selected: `{kind, id}` with kind animals, sensors, detectors, reports or areas;
 * an animal is known here by the ID of its sensor, where its data comes from */
let selected = { kind: "", id: "" };
/** the area whose visits are drawn, and those visits */
let visits = { area: "", cells: [] };
let fitted = false;
let measure = [];

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

/** The tab a sensor belongs to: an animal when it is on one, else a sensor on its own. */
function tabOf(sensor) {
  return sensor.animal ? "animals" : "sensors";
}

function iconOf(sensor) {
  return speciesIcon(sensor.animal && sensor.animal.species ? sensor.animal.species.name : "");
}

/** The icon of the species of a report; a report without a species gets the general one. */
function reportIcon(report) {
  const name = speciesIcon(report.species && report.species.name);
  return name === "sensor" ? "generic" : name;
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

function isSelected(kind, id) {
  return selected.kind === kind && selected.id === id;
}

/** A square icon button of a panel; `on` fills it. */
function iconButton(name, label, onclick, { on = false, href = "", disabled = false, external = false } = {}) {
  const attrs = { class: `btn ${on ? "primary" : "outline"} icon`, title: label, "aria-label": label };
  if (href) return el("a", { ...attrs, href, target: external ? "_blank" : null, rel: external ? "noopener noreferrer" : null }, icon(name));
  return el("button", { ...attrs, type: "button", disabled, onclick, "aria-pressed": String(on) }, icon(name));
}

/** A small icon button at the end of a row of the layers panel. */
function rowButton(name, label, onclick, { active = false, disabled = false, colour = "" } = {}) {
  const button = el("button", { class: `btn ghost icon sm${active ? " active" : ""}`, type: "button", title: label, "aria-label": label, disabled, onclick }, icon(name));
  if (colour) button.style.color = colour;
  return button;
}

// ---------------------------------------------------------------------------------------------
// The layers: what the map shows and the rows of the panel

function reportName(report) {
  return (report.type && report.type.name) || "Report";
}

function reportTime(report) {
  return toTime(report.moment || report.timestamp);
}

function reportList() {
  return [...detections.reports.values()].map((report) => ({ report, place: reportPlace(report) })).filter((item) => item.place);
}

function detectorList() {
  return hasScope(SCOPES.detections) ? detectorsOf() : [];
}

function drawSensors() {
  const shown = sensors.filter((sensor) => sensor.place && isShown(tabOf(sensor), sensor.id));
  map.setItems("sensors", shown.map((sensor) => ({ id: sensor.id, name: sensor.name, icon: iconOf(sensor), lat: sensor.place.lat, lng: sensor.place.lng, selected: isSelected(tabOf(sensor), sensor.id) })));
  // the count is about animals; sensors only count when no animal is known at all
  const animals = sensors.filter((sensor) => sensor.animal);
  const subject = animals.length ? animals : sensors;
  const noun = animals.length ? "animal" : "sensor";
  const visible = shown.filter((sensor) => subject.includes(sensor)).length;
  const placed = subject.filter((sensor) => sensor.place).length;
  $("mapCount").textContent = visible === subject.length ? plural(subject.length, noun) : `${visible} of ${plural(subject.length, noun)}`;
  $("mapCount").title = placed < subject.length ? `${subject.length - placed} without a position yet` : "";
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

/** Detectors and reports on the map, and the line under their tabs. */
function drawFinds() {
  map.setItems("detectors", detectorList().filter((d) => isShown("detectors", d.id)).map((d) => ({ id: d.id, name: d.name, lat: d.lat, lng: d.lng, selected: isSelected("detectors", d.id) })));
  map.setItems(
    "reports",
    reportList()
      .filter(({ report }) => isShown("reports", report.ID))
      .map(({ report, place }) => ({ id: report.ID, name: reportName(report), icon: reportIcon(report), lat: place.lat, lng: place.lng, selected: isSelected("reports", report.ID) })),
  );
  const found = detections.found.size + detections.reports.size;
  $("layerFindText").textContent = detections.progress || (found ? `${plural(detections.found.size, "detection")} and ${plural(detections.reports.size, "report")}, ${detections.from} to ${detections.to}` : detections.message);
  $("layerFindStop").hidden = !detections.busy;
  $("layerFindSearch").disabled = detections.busy;
}

function drawAreas() {
  map.setItems("areas", areas.filter((area) => isShown("areas", area.id)).map((area) => ({ id: area.id, name: area.name, points: area.points, selected: isSelected("areas", area.id) })));
  map.setItems("visits", visits.area && isShown("areas", visits.area) ? visits.cells : []);
}

/** The tabs of the layers panel. */
function drawPanel() {
  const pick = (kind) => (id) => select(kind, id, true);
  const offerReset = () => ($("layerReset").hidden = !isCustomised());
  const again = () => {
    drawSensors();
    drawFinds();
    drawAreas();
  };
  const locate = (kind, id, disabled = false) => rowButton("locate", "Show on map", () => select(kind, id, true), { disabled });
  const sensorRow = (sensor) => {
    const tracked = tracks.has(sensor.id);
    const tab = tabOf(sensor);
    return {
      id: sensor.id,
      name: sensor.name,
      sub: [sensor.animal ? `sensor ${sensor.id}` : "", sensor.place ? "" : "no position yet"].filter(Boolean).join(" · "),
      group: sensor.species || "Species unknown",
      time: sensor.place ? sensor.place.t : 0,
      icon: iconOf(sensor),
      selected: isSelected(tab, sensor.id),
      actions: [rowButton("route", tracked ? "Hide the track" : "Show the track", () => toggleTrack(sensor.id), { active: tracked, colour: tracked ? trackColor(tracks.get(sensor.id)) : "" }), locate(tab, sensor.id, !sensor.place)],
    };
  };
  drawTab("animals", sensors.filter((sensor) => sensor.animal).map(sensorRow), {
    target: $("layerTab-animals"),
    noun: "animal",
    groupLabel: "Per species",
    empty: canListSensors() ? "WildlifeNL has no animals with an active sensor." : "The animals need the herd-manager role. A sensor you added by its ID is under Sensors.",
    onChange: again,
    onDraw: offerReset,
    onPick: pick("animals"),
  });
  // only the sensors that are not on an animal: the others are their animal
  const bare = sensors.filter((sensor) => !sensor.animal);
  drawTab("sensors", bare.map(sensorRow), {
    target: $("layerTab-sensors"),
    noun: "sensor",
    empty: el("span", {}, [sensors.length ? "Every sensor is on an animal, see Animals. " : "", "Add a sensor by its ID on the ", el("a", { href: buildHash("sensors"), text: "Sensors page" }), "."]),
    onChange: again,
    onDraw: offerReset,
    onPick: pick("sensors"),
  });
  drawTab(
    "detectors",
    detectorList().map((d) => ({
      id: d.id,
      name: d.name,
      sub: `${plural(d.detections.length, "detection")}, latest ${ago(d.latest)}`,
      group: [...new Set(d.detections.map((x) => x.user && x.user.name).filter(Boolean))].join(", ") || "Unknown sender",
      time: d.latest,
      icon: "camera_trap",
      selected: isSelected("detectors", d.id),
      actions: [locate("detectors", d.id)],
    })),
    { target: $("layerTab-detectors"), noun: "detector", groupLabel: "Per sender", empty: hasScope(SCOPES.detections) ? "No detectors found yet. Search this view below." : `Detections need one of these roles: ${SCOPES.detections.join(", ")}.`, onChange: again, onDraw: offerReset, onPick: pick("detectors") },
  );
  drawTab(
    "reports",
    reportList().map(({ report }) => ({
      id: report.ID,
      name: [report.species && (report.species.commonName || report.species.name), formatMoment(reportTime(report))].filter(Boolean).join(", "),
      sub: [report.user && report.user.name, report.notes].filter(Boolean).join(" · "),
      group: reportName(report),
      time: reportTime(report),
      icon: reportIcon(report),
      selected: isSelected("reports", report.ID),
      actions: [locate("reports", report.ID)],
    })),
    { target: $("layerTab-reports"), noun: "report", groupLabel: "Per kind", empty: hasScope(SCOPES.reports) ? "No reports found yet. Search this view below." : `Reports need one of these roles: ${SCOPES.reports.join(", ")}.`, onChange: again, onDraw: offerReset, onPick: pick("reports") },
  );
  drawTab(
    "areas",
    areas.map((area) => ({
      id: area.id,
      name: area.name,
      sub: `${plural(area.points.length, "point")} in the outline`,
      group: area.kind === "zones" ? "My zones" : "Living labs",
      time: 0,
      selected: isSelected("areas", area.id),
      actions: [locate("areas", area.id, area.points.length < 3)],
    })),
    { target: $("layerTab-areas"), noun: "area", groupLabel: "Per kind", empty: "No living labs or zones to show.", onChange: again, onDraw: offerReset, onPick: pick("areas") },
  );
  $("layerFind").hidden = !["detectors", "reports"].includes(choices.tab);
}

// ---------------------------------------------------------------------------------------------
// The panel of what is selected

function panelHead(image, title, subtitle) {
  return el("div", { class: "panel-head" }, [
    image ? el("img", { class: "object-icon", src: `assets/img/icons/${image}.svg`, alt: "" }) : null,
    el("div", { class: "object-title" }, [el("strong", { text: title }), el("small", { text: subtitle })]),
    el("button", { class: "btn ghost icon sm", type: "button", "aria-label": "Close", title: "Close", onclick: () => select("", "") }, icon("x")),
  ]);
}

function factList(pairs) {
  const list = el("dl", { class: "facts" });
  facts(list, pairs);
  return list;
}

function link(href, text) {
  return el("a", { href, text });
}

function sensorPanel(sensor) {
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
  const animal = sensor.animal;
  return [
    panelHead(iconOf(sensor), sensor.name, animal ? sensor.species || "animal" : "sensor without an animal"),
    factList([
      ["Last seen", loaded ? (newest ? ago(toTime(newest.timestamp)) : "no readings yet") : "loading…"],
      ["Position", last ? formatMoment(last.t) : loaded ? (loaded.complete ? "none yet" : "not recently") : ""],
      ["Coordinates", sensor.place ? `${sensor.place.lat.toFixed(5)}, ${sensor.place.lng.toFixed(5)}` : ""],
      ["Temperature", temperature == null ? "" : `${temperature} °C`],
      ["Species", animal && animal.species ? link(recordHash("species", animal.species.ID), sensor.species) : ""],
      ["Sensor", animal ? link(buildHash("sensors", sensor.id), sensor.id) : ""],
      ["Track", all && tracked ? `${inPeriod.length.toLocaleString()} of ${plural(all.track.length, "point")}, ${formatDistance(trackLength(inPeriod))}` : ""],
    ]),
    el("div", { class: "row" }, [
      iconButton("route", tracked ? "Hide the track" : "Show the track", () => toggleTrack(sensor.id), { on: tracked }),
      iconButton("locate", "Centre the map here", () => sensor.place && map.flyTo(sensor.place), { disabled: !sensor.place }),
      animal ? iconButton("animal", "Open the animal", null, { href: buildHash("animals", animal.ID) }) : iconButton("sensor", "Open the sensor", null, { href: buildHash("sensors", sensor.id) }),
      iconButton("chart", "Open in the data explorer", null, { href: buildHash("explore", "", { sensors: sensor.id, metrics: "speed" }) }),
    ]),
  ];
}

function detectorPanel(detector) {
  const species = counted(detector.detections, speciesName);
  const newest = detector.detections.reduce((best, d) => (!best || toTime(d.start) > toTime(best.start) ? d : best), null);
  const picture = newest ? webLink(newest.uri) : "";
  return [
    panelHead("camera_trap", detector.name, "detector"),
    factList([
      ["Detections", `${detector.detections.length.toLocaleString()}, ${detections.from} to ${detections.to}`],
      ["Latest", `${formatMoment(detector.latest)} (${ago(detector.latest)})`],
      ["Species", species.slice(0, 5).map(([name, count]) => `${name} ${count}`).join(", ") + (species.length > 5 ? ` and ${species.length - 5} more` : "")],
      ["Sensor type", [...new Set(detector.detections.map((d) => d.sensorType).filter(Boolean))].join(", ")],
      ["Sent by", [...new Set(detector.detections.map((d) => d.user && d.user.name).filter(Boolean))].join(", ")],
      ["Coordinates", `${detector.lat.toFixed(5)}, ${detector.lng.toFixed(5)}`],
    ]),
    el("div", { class: "row" }, [
      iconButton("list", "Open its detections", null, { href: buildHash("detections", "", { detector: detector.name }) }),
      iconButton("locate", "Centre the map here", () => map.flyTo(detector)),
      picture ? iconButton("external", "Open the newest picture", null, { href: picture, external: true }) : null,
    ]),
  ];
}

function reportPanel(report, place) {
  const sighting = report.reportOfSighting;
  const damage = report.reportOfDamage;
  const collision = report.reportOfCollision;
  const animals = (sighting && sighting.involvedAnimals) || (collision && collision.involvedAnimals) || [];
  return [
    panelHead(reportIcon(report), reportName(report), "report"),
    factList([
      ["When", `${formatMoment(reportTime(report))} (${ago(reportTime(report))})`],
      ["Species", report.species ? link(recordHash("species", report.species.ID), report.species.commonName || report.species.name) : ""],
      ["Animals", animals.length ? String(animals.length) : ""],
      ["Damage", damage ? [damage.belonging, damage.estimatedLoss && `loss ${damage.estimatedLoss}`].filter(Boolean).join(", ") : ""],
      ["Notes", report.notes || ""],
      ["Reported by", report.user ? link(recordHash("people", report.user.ID), report.user.name) : ""],
      ["Coordinates", `${place.lat.toFixed(5)}, ${place.lng.toFixed(5)}`],
    ]),
    el("div", { class: "row" }, [iconButton("list", "Open the report", null, { href: recordHash("reports", report.ID) }), iconButton("locate", "Centre the map here", () => map.flyTo(place))]),
  ];
}

function areaPanel(area) {
  const lab = area.kind === "livinglabs";
  const showing = visits.area === area.id;
  const species = (area.record.species || []).map((s) => s.commonName || s.name).join(", ");
  return [
    panelHead("", area.name, lab ? "living lab" : "zone"),
    factList([
      ["Outline", plural(area.points.length, "point")],
      ["Species", species],
      ["Created", area.record.created ? formatMoment(toTime(area.record.created)) : ""],
      ["Visits", showing ? (visits.cells.length ? `${visits.cells.reduce((sum, cell) => sum + cell.count, 0).toLocaleString()} in the last 30 days, per 250 m cell` : "none in the last 30 days") : ""],
    ]),
    el("div", { class: "row" }, [
      iconButton("list", lab ? "Open the living lab" : "Open the zone", null, { href: recordHash(area.kind, area.id) }),
      iconButton("locate", "Show the whole area", () => map.fit(area.points, { animate: true }), { disabled: area.points.length < 3 }),
      lab && hasScope(SCOPES.visits) ? iconButton("flame", showing ? "Hide the visits" : "Show where people were, last 30 days", () => toggleVisits(area), { on: showing }) : null,
    ]),
  ];
}

function drawObjectPanel() {
  const panel = $("objectPanel");
  let content = null;
  if (selected.kind === "animals" || selected.kind === "sensors") {
    const sensor = sensorById(selected.id);
    if (sensor) content = sensorPanel(sensor);
  } else if (selected.kind === "detectors") {
    const detector = detectorsOf().find((d) => d.id === selected.id);
    if (detector) content = detectorPanel(detector);
  } else if (selected.kind === "reports") {
    const report = detections.reports.get(selected.id);
    const place = report && reportPlace(report);
    if (place) content = reportPanel(report, place);
  } else if (selected.kind === "areas") {
    const area = areas.find((a) => a.id === selected.id);
    if (area) content = areaPanel(area);
  }
  panel.hidden = !content;
  if (content) panel.replaceChildren(...content);
}

function redraw() {
  drawSensors();
  drawTracks();
  drawFinds();
  drawAreas();
  drawPanel();
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

/** Where a selected thing is, to fly there. */
function placeOf(kind, id) {
  if (kind === "animals" || kind === "sensors") return (sensorById(id) || {}).place || null;
  if (kind === "detectors") return detectorsOf().find((d) => d.id === id) || null;
  if (kind === "reports") return detections.reports.has(id) ? reportPlace(detections.reports.get(id)) : null;
  return null;
}

async function select(kind, id, fly = false) {
  selected = { kind, id };
  if (kind && id) showRow(kind, id); // a hidden row that is picked is shown again
  redraw();
  if (!kind) return;
  if (fly) {
    const area = kind === "areas" && areas.find((a) => a.id === id);
    if (area && area.points.length > 2) map.fit(area.points, { animate: true });
    const place = placeOf(kind, id);
    if (place) map.flyTo(place);
  }
  if (kind !== "animals" && kind !== "sensors") return;
  try {
    await loadRecent(id);
  } catch (error) {
    const text = explain(error);
    if (text) toast(`${id}: ${text}`, true);
  }
  if (isSelected(kind, id)) redraw();
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

/** The visits of a living lab as discs on the map, larger where more people were. */
async function toggleVisits(area) {
  if (visits.area === area.id) visits = { area: "", cells: [] };
  else {
    try {
      const query = new URLSearchParams({ start: new Date(Date.now() - 30 * DAY).toISOString(), end: new Date().toISOString(), livingLabID: area.id, cellSize: 250 });
      const answer = await account.api.call("GET", `/visitation/?${query}`);
      visits = { area: area.id, cells: ((answer && answer.cells) || []).map((cell) => ({ lat: cell.centroid.latitude, lng: cell.centroid.longitude, count: cell.count })) };
    } catch (error) {
      const text = explain(error);
      if (text) toast(text, true);
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
      drawSensors();
      drawPanel();
    }
  };
  await Promise.all([worker(), worker(), worker()]);
}

/** The living labs, and the zones of the account when it may have any. */
async function loadAreas() {
  const next = [];
  for (const kind of ["livinglabs", "zones"]) {
    if (kind === "zones" && !hasScope(SCOPES.zones)) continue;
    try {
      const { records } = await listRecords(kind);
      for (const record of records) {
        const points = (record.definition || []).map((p) => ({ lat: p.latitude, lng: p.longitude })).filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng));
        next.push({ id: String(record.ID), name: titleOf(kind, record), kind, record, points });
      }
    } catch (error) {
      if (!explain(error)) return;
    }
  }
  areas = next;
  drawAreas();
  drawPanel();
}

async function reload(force = false) {
  try {
    sensors = await loadSensors(force);
  } catch (error) {
    const text = explain(error);
    if (text) note($("mapNote"), text, "error");
    return;
  }
  const problem = listError();
  note($("mapNote"), problem ? `Could not list the deployed sensors: ${problem}` : sensors.length || canListSensors() ? "" : "Your account cannot list the animals with a sensor (that needs the herd-manager role). Add a sensor by its ID on the Sensors page.", problem ? "warn" : "");
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
  for (const button of document.querySelectorAll("#layerTabs [role=tab]")) {
    button.addEventListener("click", () => {
      openTab(button.dataset.tab);
      drawPanel();
    });
  }
  openTab(TABS.includes(choices.tab) ? choices.tab : "animals");
  $("layerReset").addEventListener("click", () => {
    resetChoices();
    tracks.clear();
    $("mapTrackHours").value = "168";
    redraw();
  });
  $("mapTracksButton").addEventListener("click", () => showCard("tracksCard", $("tracksCard").hidden));
  $("tracksClose").addEventListener("click", () => showCard("tracksCard", false));
  $("mapTrackHours").addEventListener("change", redraw);
  $("mapClearTracks").addEventListener("click", () => {
    tracks.clear();
    redraw();
  });
  $("layerFindSearch").addEventListener("click", () => {
    const problem = searchBox(map.bounds());
    if (problem) toast(problem, true);
  });
  $("layerFindStop").addEventListener("click", stopSearch);
  onDetections(() => {
    if ($("view-map").hidden) return;
    drawFinds();
    drawPanel();
    if (["detectors", "reports"].includes(selected.kind)) drawObjectPanel();
  });
  document.addEventListener("themechange", drawPanel); // the track buttons follow the theme
}

/** Waits until the search that is running has ended. */
async function searchDone() {
  for (let tries = 0; tries < 150 && detections.busy; tries++) await new Promise((resolve) => setTimeout(resolve, 200));
}

/**
 * Shows the page. The address can point at something:
 * `?animal=ID` or `?sensor=ID` (with `&track=1` for the track), `?detector=NAME`, `?report=ID`, `?area=ID`,
 * `?at=LAT,LNG`, and `?layers=TAB` to open the layers panel at a tab.
 */
export async function show({ query }) {
  if (!map) {
    map = new LiveMap($("liveMap"), {
      // the map knows one layer of sensors; here it is an animal when the sensor is on one
      onPick: (kind, id) => select(kind === "sensors" && sensorById(id) ? tabOf(sensorById(id)) : kind, id),
      onNothing: () => select("", ""),
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
  const areasLoaded = loadAreas();
  if (hasScope(SCOPES.detections) || hasScope(SCOPES.reports)) loadDetections();
  if (query.layers) {
    openTab(TABS.includes(query.layers) ? query.layers : "animals");
    showCard("layerPanel", true);
    drawPanel();
  }
  const wanted = query.animal ? sensorByAnimal(query.animal) : query.sensor ? sensorById(query.sensor) : null;
  if (wanted) {
    await select(tabOf(wanted), wanted.id, true);
    if (query.track) await toggleTrack(wanted.id, true);
  }
  if (query.area) {
    await areasLoaded;
    if (areas.some((area) => area.id === query.area)) select("areas", query.area, true);
  }
  if (query.detector || query.report) {
    await searchDone();
    const detector = query.detector && detectorsOf().find((d) => d.name === query.detector);
    if (detector) select("detectors", detector.id, true);
    if (query.report && detections.reports.has(query.report)) select("reports", query.report, true);
  }
  if (query.at) {
    const [lat, lng] = query.at.split(",").map(Number);
    if (Number.isFinite(lat) && Number.isFinite(lng)) map.flyTo({ lat, lng });
  }
  if (Object.keys(query).length) history.replaceState(null, "", buildHash("map"));
}

/** Forgets what belongs to the account that signed out. */
export function reset() {
  sensors = [];
  areas = [];
  tracks.clear();
  selected = { kind: "", id: "" };
  visits = { area: "", cells: [] };
  fitted = false;
  if (!map || !map.map) return;
  setMeasuring(false);
  for (const kind of ["sensors", "detectors", "reports", "areas", "visits"]) map.setItems(kind, []);
  map.setTracks([]);
  for (const id of ["objectPanel", "layerPanel", "tracksCard"]) $(id).hidden = true;
}
