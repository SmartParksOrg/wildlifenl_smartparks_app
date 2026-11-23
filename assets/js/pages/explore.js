// The data explorer: one chart per metric with a line per sensor, like the data explorer of
// Smart Parks Protect. The view lives in the address, so a link reproduces it.

import { PALETTE, LineChart } from "../chart.js";
import { BUCKETS, METRICS, autoBucket, bucketSeries, buildHash, metricSeries, toCsv, toTime, withinWindow } from "../lib.js";
import { explain } from "../session.js";
import { loadReadings, loadSensors, refreshSensors, sensorById } from "../store.js";
import { $, DataTable, MultiPicker, download, el, fileStamp, note, toast } from "../ui.js";

const HOUR = 3600 * 1000;
const DEFAULT_RANGE = "168";

let metricPicker = null;
let sensorPicker = null;
let table = null;
/** the charts drawn, each `{metric, chart}` */
let charts = [];
let run = 0;
/** sensor id to its slot in PALETTE: a sensor keeps its colour while it stays chosen */
const colours = new Map();

function list(text) {
  return text ? text.split(",").filter(Boolean) : [];
}

function navigate(change) {
  const state = { metrics: metricPicker.values().join(","), sensors: sensorPicker.values().join(","), range: $("exploreRange").value, bucket: $("exploreBucket").value, ...change };
  if (state.range === DEFAULT_RANGE) state.range = "";
  if (state.bucket === "auto") state.bucket = "";
  location.hash = buildHash("explore", "", state);
}

function colourOf(id, chosen) {
  for (const key of [...colours.keys()]) if (!chosen.includes(key)) colours.delete(key);
  if (!colours.has(id)) {
    const used = new Set(colours.values());
    colours.set(id, PALETTE.findIndex((_, index) => !used.has(index)));
  }
  return PALETTE[colours.get(id)];
}

function clear() {
  for (const { chart } of charts) chart.dispose();
  charts = [];
  $("exploreCharts").replaceChildren();
  $("exploreTable").hidden = true;
}

/** Draws the charts and the table. `keep` is for a refresh: charts of the same metrics take
 * the new data in place, so their zoom stays, and so does the sorting of the table. */
async function render(metrics, ids, keep = false) {
  const mine = ++run;
  if (!keep) clear();
  note($("exploreNote"), "");
  const ready = metrics.length > 0 && ids.length > 0;
  const empty = $("exploreEmpty");
  empty.hidden = ready;
  empty.querySelector("strong").textContent = metrics.length ? "Choose an animal" : "Choose a metric to start";
  $("exploreBucketHint").textContent = "";
  if (!ready) return;

  const range = $("exploreRange").value;
  const from = range === "all" ? NaN : Date.now() - Number(range) * HOUR;
  let loaded;
  try {
    loaded = await Promise.all(ids.map((id) => loadReadings(id)));
  } catch (error) {
    const text = explain(error);
    if (text && mine === run) note($("exploreNote"), text, "error");
    return;
  }
  if (mine !== run) return;

  const readings = loaded.map((data) => withinWindow(data.readings, from, NaN, (r) => toTime(r.timestamp)));
  const times = readings.flat().map((r) => toTime(r.timestamp)).filter(Number.isFinite);
  const span = Number.isFinite(from) ? Date.now() - from : times.length ? Math.max(...times) - Math.min(...times) : 0;
  const chosen = $("exploreBucket").value;
  const bucketKey = chosen === "auto" ? autoBucket(span) : chosen;
  const select = $("exploreBucket");
  $("exploreBucketHint").textContent = chosen === "auto" ? `Now: ${[...select.options].find((o) => o.value === bucketKey).text.toLowerCase()}` : "";

  const names = ids.map((id) => {
    const sensor = sensorById(id);
    return sensor && sensor.name !== id ? `${sensor.name} (${id})` : id;
  });
  const rows = new Map();
  const without = [];
  const drawn = [];
  for (const metric of metrics) {
    const { label, unit } = METRICS[metric];
    const series = ids
      .map((id, index) => ({ id, name: names[index], color: colourOf(id, ids), data: bucketSeries(metricSeries(readings[index], metric), BUCKETS[bucketKey]) }))
      .filter((s) => s.data.length);
    if (!series.length) {
      without.push(label.toLowerCase());
      continue;
    }
    for (const s of series) {
      for (const [t, value] of s.data) {
        const key = `${t}|${s.id}`;
        if (!rows.has(key)) rows.set(key, { time: new Date(t).toISOString(), sensor: s.id });
        rows.get(key)[metric] = Math.round(value * 1000) / 1000;
      }
    }
    drawn.push({ metric, title: unit ? `${label}, ${unit}` : label, content: { unit, series } });
  }
  if (keep && drawn.length === charts.length && drawn.every((item, index) => item.metric === charts[index].metric)) {
    drawn.forEach((item, index) => charts[index].chart.set(item.content));
  } else {
    clear();
    for (const { metric, title, content } of drawn) {
      const area = el("div", { class: "chart" });
      $("exploreCharts").append(el("div", { class: "card stack" }, [el("h2", { text: title }), area]));
      const chart = new LineChart(area);
      chart.set(content);
      charts.push({ metric, chart });
    }
  }
  if (without.length) note($("exploreNote"), `No ${without.join(", ")} data for the chosen animals in this period.`, "warn");

  // the table view of the charts: the same numbers, one row per moment and sensor
  $("exploreTable").hidden = rows.size === 0;
  table.setRows([...rows.values()], { columns: ["time", "sensor", ...metrics.filter((m) => !without.includes(METRICS[m].label.toLowerCase()))], sortKey: "time", keep });
}

function wire() {
  metricPicker = new MultiPicker($("exploreMetrics"), { placeholder: "Choose metrics", noun: "metrics", onChange: () => navigate() });
  sensorPicker = new MultiPicker($("exploreSensors"), { placeholder: "Choose animals", noun: "animals", max: PALETTE.length, onChange: () => navigate() });
  table = new DataTable($("exploreTable"), { filename: "wildlifenl-explore" });
  $("exploreRange").addEventListener("change", () => navigate());
  $("exploreBucket").addEventListener("change", () => navigate());
  $("exploreExport").addEventListener("click", () => {
    if (!table.rows.length) return toast("Choose a metric and an animal first");
    download(`wildlifenl-explore-${fileStamp()}.csv`, toCsv(table.visibleRows(), table.columns), "text/csv");
  });
}

export async function show({ query }) {
  if (!metricPicker) wire();
  let sensors = [];
  try {
    sensors = await loadSensors();
  } catch (error) {
    const text = explain(error);
    if (text) note($("exploreNote"), text, "error");
    return;
  }
  const ids = list(query.sensors);
  // a sensor from a link that is not in the list can still be charted
  const options = [...sensors.map((s) => ({ value: s.id, label: s.name, note: s.name !== s.id ? s.id : s.species })), ...ids.filter((id) => !sensorById(id)).map((id) => ({ value: id, label: id }))];
  sensorPicker.set(options, ids);
  metricPicker.set(Object.entries(METRICS).map(([value, metric]) => ({ value, label: metric.label, note: metric.unit })), list(query.metrics));
  $("exploreRange").value = [...$("exploreRange").options].some((o) => o.value === query.range) ? query.range : DEFAULT_RANGE;
  $("exploreBucket").value = query.bucket in BUCKETS ? query.bucket : "auto";
  await render(metricPicker.values(), sensorPicker.values());
}

/** Reads the newest readings again and draws the same view with them. */
export async function refresh() {
  if (!metricPicker) return;
  const problem = await refreshSensors();
  await render(metricPicker.values(), sensorPicker.values(), true);
  if (problem) note($("exploreNote"), problem, "warn");
}

export function reset() {
  run++;
  colours.clear();
  clear();
}
