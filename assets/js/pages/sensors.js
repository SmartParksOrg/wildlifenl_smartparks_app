// The list of sensors, like the devices list of Smart Parks Protect.

import { ago, buildHash, toTime } from "../lib.js";
import { explain } from "../session.js";
import { addSensor, canListSensors, listError, loadRecent, loadSensors, recentReadings } from "../store.js";
import { $, DataTable, busy, note } from "../ui.js";

const COLUMNS = ["sensor", "animal", "species", "last_reading", "last_position", "readings", "deployed_since", "source"];
const LABELS = { sensor: "Sensor ID", animal: "Animal", species: "Species", last_reading: "Last reading", last_position: "Last position", readings: "Readings", deployed_since: "Deployed since", source: "Source" };

let table = null;
let sensors = [];
let run = 0;

function rowOf(sensor) {
  const loaded = recentReadings(sensor.id);
  const times = loaded ? loaded.readings.map((r) => toTime(r.timestamp)).filter(Number.isFinite) : [];
  const last = loaded && loaded.track.length ? loaded.track[loaded.track.length - 1].t : NaN;
  return {
    sensor: sensor.id,
    animal: sensor.animal ? sensor.animal.name : "",
    species: sensor.species,
    last_reading: !loaded ? "loading…" : times.length ? ago(Math.max(...times)) : "none",
    last_position: !loaded ? "" : Number.isFinite(last) ? ago(last) : loaded.complete ? "none" : "not recently",
    // the list reads only the newest part of a large sensor, so the total is not known
    readings: !loaded ? null : loaded.complete ? loaded.readings.length : `over ${loaded.readings.length}`,
    deployed_since: sensor.start ? sensor.start.slice(0, 10) : "",
    source: sensor.animal ? "Deployment" : "Added by hand",
  };
}

function draw() {
  table.setRows(sensors.map(rowOf), {
    columns: COLUMNS,
    labels: LABELS,
    sortKey: table.sortKey && COLUMNS.includes(table.sortKey) ? table.sortKey : "sensor",
    sortDir: table.sortKey ? table.sortDir : 1,
    link: { column: "sensor", href: (row) => buildHash("sensors", row.sensor) },
    raw: sensors,
    empty: canListSensors() ? "WildlifeNL has no active sensor deployments. Add a sensor by its ID." : "No sensors yet. Add a sensor by its ID.",
  });
}

/** Fills the reading columns in the background, three sensors at a time, from the newest
 * part of each sensor's readings. */
async function fillReadings() {
  const mine = ++run;
  const queue = sensors.filter((sensor) => !recentReadings(sensor.id));
  const worker = async () => {
    for (let sensor = queue.shift(); sensor && mine === run; sensor = queue.shift()) {
      try {
        await loadRecent(sensor.id);
      } catch (error) {
        if (!explain(error)) return; // signed out
      }
      if (mine === run) draw();
    }
  };
  await Promise.all([worker(), worker(), worker()]);
}

async function reload(force = false) {
  try {
    sensors = await loadSensors(force);
  } catch (error) {
    const text = explain(error);
    if (text) note($("sensorsNote"), text, "error");
    return;
  }
  const problem = listError();
  note(
    $("sensorsNote"),
    problem ? `Could not list the deployed sensors: ${problem}` : canListSensors() ? "" : "Your account cannot list the deployed sensors (that needs the herd-manager role). Sensors you add by ID are remembered in this browser.",
    problem ? "warn" : "",
  );
  draw();
  fillReadings();
}

export async function show() {
  if (!table) {
    table = new DataTable($("sensorsTable"), { filename: "wildlifenl-sensors" });
    $("sensorsRefresh").addEventListener("click", (event) => busy(event.currentTarget, () => reload(true)));
    $("sensorsAddForm").addEventListener("submit", (event) => {
      event.preventDefault();
      const id = $("sensorsAddInput").value.trim();
      if (id.length < 2) return;
      addSensor(id);
      location.hash = buildHash("sensors", id);
    });
  }
  $("sensorsAddInput").value = "";
  await reload();
}

export function reset() {
  run++;
  sensors = [];
  if (table) table.setRows([]);
}
