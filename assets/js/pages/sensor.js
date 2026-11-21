// One sensor with everything WildlifeNL holds for it, like the device page of Smart Parks
// Protect: facts, the track, charts and every reading.

import { PALETTE, LineChart } from "../chart.js";
import { METRICS, ago, autoBucket, BUCKETS, bucketSeries, buildHash, columnsOf, flatten, formatDistance, metricSeries, toTime, trackLength, withinWindow } from "../lib.js";
import { MapView } from "../map.js";
import { explain } from "../session.js";
import { addSensor, loadReadings, loadSensors, removeSensor, sensorById } from "../store.js";
import { $, DataTable, busy, el, facts, formatMoment, note, plural } from "../ui.js";

const HOUR = 3600 * 1000;
const READING_COLUMNS = ["timestamp", "location.latitude", "location.longitude", "altitude", "temperature", "accelero.x", "accelero.y", "accelero.z", "userID", "sensorID"];
const CHART_METRICS = ["temperature", "altitude", "speed"];

let map = null;
let table = null;
let charts = [];
let id = "";
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
  $("sensorTitle").textContent = id;
  $("sensorSubtitle").textContent = sensor && sensor.animal ? [sensor.animal.name, sensor.species].filter(Boolean).join(", ") : "Borne sensor";
  $("sensorOnMap").href = buildHash("map", "", { sensor: id, track: 1 });
  $("sensorExplore").href = buildHash("explore", "", { sensors: id, metrics: "temperature", range: $("sensorPeriod").value });
  const keep = $("sensorKeep");
  keep.hidden = Boolean(sensor && !sensor.added);
  keep.textContent = sensor ? "Remove from my sensors" : "Add to my sensors";
}

function drawFacts(sensor, readings, track) {
  const times = readings.map((r) => toTime(r.timestamp)).filter(Number.isFinite);
  const systems = [...new Set(readings.map((r) => r.userID).filter(Boolean))];
  facts($("sensorFacts"), [
    ["Sensor ID", id],
    ["Source", sensor && sensor.animal ? "Active deployment" : "Added by hand, no active deployment known"],
    ["Deployed since", sensor && sensor.start ? formatMoment(toTime(sensor.start)) : ""],
    ["Readings", readings.length.toLocaleString()],
    ["With a position", track.length.toLocaleString()],
    ["First reading", times.length ? formatMoment(Math.min(...times)) : "none"],
    ["Last reading", times.length ? formatMoment(Math.max(...times)) : "none"],
    ["Sent by", systems.length ? systems.join(", ") : ""],
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
    ["Acceleration", value(accelero, accelero && `x ${accelero.accelero.x}, y ${accelero.accelero.y}, z ${accelero.accelero.z}`)],
  ]);

  const animal = sensor && sensor.animal;
  facts(
    $("sensorAnimal"),
    animal
      ? [
          ["Name", animal.name],
          ["Species", animal.species ? [animal.species.commonName, animal.species.name && `(${animal.species.name})`].filter(Boolean).join(" ") : ""],
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
  map.setPoints(points.map((p) => ({ ...p, title: formatMoment(p.t), lines: [`${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}`, typeof p.raw.temperature === "number" ? `${p.raw.temperature} °C` : ""] })));

  for (const chart of charts) chart.dispose();
  charts = [];
  const span = Number.isFinite(from) ? Date.now() - from : Infinity;
  const bucket = BUCKETS[autoBucket(span)];
  const cards = [];
  for (const [index, metric] of CHART_METRICS.entries()) {
    const data = bucketSeries(metricSeries(inPeriod, metric), bucket);
    if (!data.length) continue;
    const area = el("div", { class: "chart small" });
    cards.push(el("div", { class: "card stack" }, [el("h2", { text: `${METRICS[metric].label}${METRICS[metric].unit ? `, ${METRICS[metric].unit}` : ""}` }), area]));
    charts.push({ area, content: { unit: METRICS[metric].unit, series: [{ name: METRICS[metric].label, color: PALETTE[index], data }] } });
  }
  $("sensorCharts").replaceChildren(...cards);
  charts = charts.map(({ area, content }) => {
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
    empty: readings.length ? `No readings in this period. The sensor has ${plural(readings.length, "reading")} in total; choose a longer period.` : "WildlifeNL has no readings for this sensor.",
  });
}

async function load(force = false) {
  const mine = id;
  note($("sensorNote"), "");
  try {
    await loadSensors();
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

function wire() {
  wired = true;
  map = new MapView($("sensorMap"));
  table = new DataTable($("sensorTable"), { filename: "wildlifenl-readings" });
  $("sensorPeriod").addEventListener("change", () => load());
  $("sensorRefresh").addEventListener("click", (event) => busy(event.currentTarget, () => load(true)));
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

export async function show({ id: sensorId }) {
  if (!wired) wire();
  if (sensorId !== id) {
    id = sensorId;
    table.setRows([]);
    map.setPoints([], { fit: false });
    for (const target of ["sensorFacts", "sensorLatest", "sensorAnimal", "sensorCharts"]) $(target).replaceChildren();
    $("sensorTrackText").textContent = "";
  }
  drawHeader(sensorById(id));
  await load();
}

export function reset() {
  id = "";
}
