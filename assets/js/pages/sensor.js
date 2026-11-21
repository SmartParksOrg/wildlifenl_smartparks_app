// The page of an animal and the page of a sensor. They are the same view of the same data,
// like an entity and its device in Smart Parks Protect: the animal is what people follow, the
// sensor is the technical source behind it. The animal page leads with the animal, the sensor
// page with the sensor; a sensor without an animal only has the second.

import { SCOPES } from "../api.js";
import { PALETTE, LineChart } from "../chart.js";
import { METRICS, ago, autoBucket, BUCKETS, bucketSeries, buildHash, columnsOf, flatten, formatDistance, metricSeries, toTime, trackLength, withinWindow } from "../lib.js";
import { MapView } from "../map.js";
import { recordHash } from "../records.js";
import { account, explain, hasScope } from "../session.js";
import { addSensor, loadReadings, loadSensors, removeSensor, sensorByAnimal, sensorById } from "../store.js";
import { $, DataTable, busy, el, facts, formatMoment, note, plural } from "../ui.js";
import { drawActions } from "../writes.js";

const HOUR = 3600 * 1000;
const READING_COLUMNS = ["timestamp", "location.latitude", "location.longitude", "altitude", "temperature", "accelero.x", "accelero.y", "accelero.z", "userID", "sensorID"];
const CHART_METRICS = ["temperature", "altitude", "speed"];

let map = null;
let table = null;
let charts = [];
/** the sensor whose data is shown, and whether the page leads with its animal */
let id = "";
let asAnimal = false;
let wired = false;

function periodStart() {
  const value = $("sensorPeriod").value;
  return value === "all" ? NaN : Date.now() - Number(value) * HOUR;
}

function latestValue(readings, read) {
  let best = null;
  for (const reading of readings) {
    if (typeof read(reading) !== "number") continue;
    if (!best || toTime(reading.timestamp) > toTime(best.timestamp)) best = reading;
  }
  return best;
}

function drawHeader(sensor) {
  const animal = sensor && sensor.animal;
  $("sensorTitle").textContent = asAnimal && animal ? animal.name : id;
  $("sensorSubtitle").textContent = asAnimal && animal ? [sensor.species, `sensor ${id}`].filter(Boolean).join(", ") : animal ? `Sensor on ${animal.name}` : "Sensor without an animal";
  $("sensorOnMap").href = buildHash("map", "", animal ? { animal: animal.ID, track: 1 } : { sensor: id, track: 1 });
  $("sensorExplore").href = buildHash("explore", "", { sensors: id, metrics: "speed", range: $("sensorPeriod").value });
  // the way to the other side: from the animal to its sensor and back
  const other = $("sensorOther");
  other.hidden = !animal;
  if (animal) {
    other.href = asAnimal ? buildHash("sensors", id) : buildHash("animals", animal.ID);
    other.textContent = asAnimal ? "Open the sensor" : "Open the animal";
  }
  const keep = $("sensorKeep");
  keep.hidden = asAnimal || Boolean(sensor && !sensor.added);
  keep.textContent = sensor ? "Remove from my sensors" : "Add to my sensors";
  // what the account may change about the animal; the page then shows the animal's new sensor
  if (asAnimal && animal) drawActions($("sensorActions"), "animals", "record", animal, () => show({ page: "animals", id: animal.ID }));
  else $("sensorActions").replaceChildren();
  // the card of the side the page is about comes first
  $("sensorAnimalCard").style.order = asAnimal ? -1 : 1;
}

function drawFacts(sensor, readings, track) {
  const times = readings.map((r) => toTime(r.timestamp)).filter(Number.isFinite);
  const systems = [...new Set(readings.map((r) => r.userID).filter(Boolean))];
  facts($("sensorFacts"), [
    ["Sensor ID", asAnimal ? el("a", { href: buildHash("sensors", id), text: id }) : id],
    ["Source", sensor && sensor.animal ? "Active deployment" : "Added by hand, no active deployment known"],
    ["Deployed since", sensor && sensor.start ? formatMoment(toTime(sensor.start)) : ""],
    ["Readings", readings.length.toLocaleString()],
    ["With a position", track.length.toLocaleString()],
    ["First reading", times.length ? formatMoment(Math.min(...times)) : "none"],
    ["Last reading", times.length ? formatMoment(Math.max(...times)) : "none"],
    ["Sent by", systems.length ? el("span", { class: "row" }, systems.map((system) => el("a", { href: recordHash("people", system), text: system }))) : ""],
  ]);

  const last = track[track.length - 1];
  const temperature = latestValue(readings, (r) => r.temperature);
  const altitude = latestValue(readings, (r) => r.altitude);
  const accelero = latestValue(readings, (r) => r.accelero && r.accelero.x);
  const value = (reading, text) => (reading ? el("span", {}, [text, el("small", { class: "hint", text: `  ${ago(toTime(reading.timestamp))}` })]) : "none");
  facts($("sensorLatest"), [
    ["Last seen", times.length ? ago(Math.max(...times)) : "never"],
    ["Position", last ? `${last.lat.toFixed(5)}, ${last.lng.toFixed(5)}` : "none yet"],
    ["Position time", last ? `${formatMoment(last.t)} (${ago(last.t)})` : ""],
    ["Temperature", value(temperature, temperature && `${temperature.temperature} °C`)],
    ["Altitude", value(altitude, altitude && `${Math.round(altitude.altitude)} m`)],
    ["Acceleration", value(accelero, accelero && ["x", "y", "z"].map((axis) => `${axis} ${Number(accelero.accelero[axis]).toFixed(2)}`).join(", "))],
  ]);

  const animal = sensor && sensor.animal;
  facts(
    $("sensorAnimal"),
    animal
      ? [
          ["Name", asAnimal ? animal.name : el("a", { href: buildHash("animals", animal.ID), text: animal.name })],
          ["Species", animal.species ? el("a", { href: recordHash("species", animal.species.ID), text: [animal.species.commonName, animal.species.name && `(${animal.species.name})`].filter(Boolean).join(" ") }) : ""],
          ["Animal ID", animal.ID],
        ]
      : [["Deployment", "WildlifeNL links readings to an animal once a herd manager registers this sensor ID as a deployment. Readings are kept until then."]],
  );
}

function drawPeriod(readings, track) {
  const from = periodStart();
  const inPeriod = withinWindow(readings, from, NaN, (r) => toTime(r.timestamp));
  const points = withinWindow(track, from, NaN);

  $("sensorTrackText").textContent = points.length ? `${plural(points.length, "position")}, ${formatDistance(trackLength(points))}` : "No positions in this period";
  map.setTrack(true);
  map.setPoints(points, { describe: (p) => [formatMoment(p.t), [`${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}`, typeof p.raw.temperature === "number" ? `${p.raw.temperature} °C` : ""]] });

  for (const chart of charts) chart.dispose();
  const span = Number.isFinite(from) ? Date.now() - from : Infinity;
  const bucket = BUCKETS[autoBucket(span)];
  const cards = [];
  const drawn = [];
  for (const [index, metric] of CHART_METRICS.entries()) {
    const data = bucketSeries(metricSeries(inPeriod, metric), bucket);
    if (!data.length) continue;
    const area = el("div", { class: "chart small" });
    cards.push(el("div", { class: "card stack" }, [el("h2", { text: `${METRICS[metric].label}${METRICS[metric].unit ? `, ${METRICS[metric].unit}` : ""}` }), area]));
    drawn.push({ area, content: { unit: METRICS[metric].unit, series: [{ name: METRICS[metric].label, color: PALETTE[index], data }] } });
  }
  $("sensorCharts").replaceChildren(...cards);
  charts = drawn.map(({ area, content }) => {
    const chart = new LineChart(area);
    chart.set(content);
    return chart;
  });

  const rows = inPeriod.map(flatten);
  const present = columnsOf(rows);
  table.setRows(rows, {
    columns: [...READING_COLUMNS.filter((c) => present.includes(c)), ...present.filter((c) => !READING_COLUMNS.includes(c))],
    sortKey: "timestamp",
    raw: inPeriod,
    empty: readings.length ? `No readings in this period. There are ${plural(readings.length, "reading")} in total; choose a longer period.` : "WildlifeNL has no readings for this sensor.",
  });
}

async function load(force = false) {
  const mine = id;
  note($("sensorNote"), "");
  try {
    drawHeader(sensorById(mine));
    const { readings, track } = await loadReadings(mine, force);
    if (mine !== id) return;
    const sensor = sensorById(mine);
    drawFacts(sensor, readings, track);
    drawPeriod(readings, track);
    if (!readings.length) note($("sensorNote"), `WildlifeNL has no readings for sensor ${mine}. Check the ID: the Protect integration sends the device's DevEUI, IMEI or serial unless it is set up otherwise.`, "warn");
  } catch (error) {
    const text = explain(error);
    if (text && mine === id) note($("sensorNote"), text, "error");
  }
}

function clear() {
  table.setRows([]);
  map.setPoints([], { fit: false });
  for (const target of ["sensorFacts", "sensorLatest", "sensorAnimal", "sensorCharts"]) $(target).replaceChildren();
  $("sensorTrackText").textContent = "";
}

function wire() {
  wired = true;
  map = new MapView($("sensorMap"));
  table = new DataTable($("sensorTable"), { filename: "wildlifenl-readings" });
  $("sensorPeriod").addEventListener("change", () => id && load());
  $("sensorRefresh").addEventListener("click", (event) => busy(event.currentTarget, () => (id ? load(true) : Promise.resolve())));
  $("sensorKeep").addEventListener("click", async () => {
    if (sensorById(id)) {
      removeSensor(id);
      location.hash = buildHash("sensors");
    } else {
      addSensor(id);
      await loadSensors();
      drawHeader(sensorById(id));
    }
  });
}

/** An animal that is not on a sensor the account knows: what WildlifeNL says about it. */
async function showLoneAnimal(animalId) {
  id = "";
  clear();
  $("sensorTitle").textContent = "Animal";
  $("sensorSubtitle").textContent = "";
  for (const target of ["sensorOther", "sensorKeep"]) $(target).hidden = true;
  $("sensorActions").replaceChildren();
  note($("sensorNote"), "This animal is not on one of the sensors you see, so there is no track or reading to show.", "warn");
  if (!hasScope(SCOPES.animal)) return;
  try {
    const animal = await account.api.call("GET", `/animal/${encodeURIComponent(animalId)}`);
    $("sensorTitle").textContent = animal.name;
    $("sensorSubtitle").textContent = animal.species ? animal.species.commonName || animal.species.name : "";
    facts($("sensorAnimal"), [
      ["Name", animal.name],
      ["Species", animal.species ? el("a", { href: recordHash("species", animal.species.ID), text: animal.species.commonName || animal.species.name }) : ""],
      ["Animal ID", animal.ID],
    ]);
    drawActions($("sensorActions"), "animals", "record", animal, () => show({ page: "animals", id: animal.ID }));
  } catch (error) {
    const text = explain(error);
    if (text) note($("sensorNote"), text, "error");
  }
}

/** Shows `#/animals/{animal id}` or `#/sensors/{sensor id}`. */
export async function show({ page, id: wanted }) {
  if (!wired) wire();
  asAnimal = page === "animals";
  let sensorId = wanted;
  if (asAnimal) {
    try {
      await loadSensors();
    } catch (error) {
      const text = explain(error);
      if (text) note($("sensorNote"), text, "error");
      return;
    }
    const sensor = sensorByAnimal(wanted);
    if (!sensor) return showLoneAnimal(wanted);
    sensorId = sensor.id;
  }
  if (sensorId !== id) {
    id = sensorId;
    clear();
  }
  try {
    await loadSensors();
  } catch (error) {
    if (!explain(error)) return;
  }
  await load();
}

export function reset() {
  id = "";
}
