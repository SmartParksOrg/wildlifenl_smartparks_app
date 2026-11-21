// The Animals list and the Sensors list, like the entities and the devices of Smart Parks
// Protect. They show the same sensors from two sides: the animals people follow, and the
// sensors as the technical source, which is also where a sensor is added by its ID.

import { ago, buildHash, toTime } from "../lib.js";
import { recordHash } from "../records.js";
import { explain } from "../session.js";
import { addSensor, canListSensors, listError, loadRecent, loadSensors, recentReadings } from "../store.js";
import { $, DataTable, busy, note } from "../ui.js";
import { drawActions } from "../writes.js";

/** The two lists: which sensors they hold, their columns and where a row leads. */
const LISTS = {
  animals: {
    table: "animalsTable",
    note: "animalsNote",
    filename: "wildlifenl-animals",
    holds: (sensor) => Boolean(sensor.animal),
    columns: ["animal", "species", "last_seen", "last_position", "sensor", "deployed_since"],
    labels: { animal: "Animal", species: "Species", last_seen: "Last seen", last_position: "Last position", sensor: "Sensor", deployed_since: "Sensor since" },
    sortKey: "animal",
    empty: () => (canListSensors() ? "WildlifeNL has no animals with an active sensor." : "The animals need the herd-manager role. A sensor you add by its ID is listed under Sensors."),
  },
  sensors: {
    table: "sensorsTable",
    note: "sensorsNote",
    filename: "wildlifenl-sensors",
    holds: () => true,
    columns: ["sensor", "animal", "last_reading", "last_position", "readings", "deployed_since", "source"],
    labels: { sensor: "Sensor ID", animal: "On animal", last_reading: "Last reading", last_position: "Last position", readings: "Readings", deployed_since: "Deployed since", source: "Source" },
    sortKey: "sensor",
    empty: () => (canListSensors() ? "WildlifeNL has no active sensor deployments. Add a sensor by its ID." : "No sensors yet. Add a sensor by its ID."),
  },
};

const tables = {};
let sensors = [];
let run = 0;
let current = "";

function rowOf(sensor) {
  const loaded = recentReadings(sensor.id);
  const times = loaded ? loaded.readings.map((r) => toTime(r.timestamp)).filter(Number.isFinite) : [];
  const last = loaded && loaded.track.length ? loaded.track[loaded.track.length - 1].t : NaN;
  const seen = !loaded ? "loading…" : times.length ? ago(Math.max(...times)) : "none";
  return {
    sensor: sensor.id,
    animal: sensor.animal ? sensor.animal.name : "",
    animal_id: sensor.animal ? sensor.animal.ID : "",
    species: sensor.species,
    species_id: sensor.animal && sensor.animal.species ? sensor.animal.species.ID : "",
    last_seen: seen,
    last_reading: seen,
    last_position: !loaded ? "" : Number.isFinite(last) ? ago(last) : loaded.complete ? "none" : "not recently",
    // the list reads only the newest part of a large sensor, so the total is not known
    readings: !loaded ? null : loaded.complete ? loaded.readings.length : `over ${loaded.readings.length}`,
    deployed_since: sensor.start ? sensor.start.slice(0, 10) : "",
    source: sensor.animal ? "Deployment" : "Added by hand",
  };
}

function draw() {
  const list = LISTS[current];
  const table = tables[current];
  const held = sensors.filter(list.holds);
  table.setRows(held.map(rowOf), {
    columns: list.columns,
    labels: list.labels,
    sortKey: table.sortKey && list.columns.includes(table.sortKey) ? table.sortKey : list.sortKey,
    sortDir: table.sortKey ? table.sortDir : 1,
    link: [
      { column: "sensor", href: (row) => buildHash("sensors", row.sensor) },
      { column: "animal", href: (row) => (row.animal_id ? buildHash("animals", row.animal_id) : "") },
      { column: "species", href: (row) => (row.species_id ? recordHash("species", row.species_id) : "") },
    ],
    raw: held,
    empty: list.empty(),
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
  const target = $(LISTS[current].note);
  try {
    sensors = await loadSensors(force);
  } catch (error) {
    const text = explain(error);
    if (text) note(target, text, "error");
    return;
  }
  const problem = listError();
  note(target, problem ? `Could not list the deployed sensors: ${problem}` : canListSensors() || current === "animals" ? "" : "Your account cannot list the deployed sensors (that needs the herd-manager role). Sensors you add by ID are remembered in this browser.", problem ? "warn" : "");
  draw();
  fillReadings();
}

function wire() {
  for (const [key, list] of Object.entries(LISTS)) tables[key] = new DataTable($(list.table), { filename: list.filename });
  for (const button of ["sensorsRefresh", "animalsRefresh"]) $(button).addEventListener("click", (event) => busy(event.currentTarget, () => reload(true)));
  $("sensorsAddForm").addEventListener("submit", (event) => {
    event.preventDefault();
    const id = $("sensorsAddInput").value.trim();
    if (id.length < 2) return;
    addSensor(id);
    location.hash = buildHash("sensors", id);
  });
}

/** Shows `#/animals` or `#/sensors`. */
export async function show({ page }) {
  if (!tables.sensors) wire();
  current = page === "animals" ? "animals" : "sensors";
  // a new animal has no sensor yet, so it opens on its own page, where a sensor is put on it
  if (current === "animals") drawActions($("animalsActions"), "animals", "list", null, (animal) => (animal && animal.ID ? (location.hash = buildHash("animals", animal.ID)) : reload(true)));
  $("sensorsAddInput").value = "";
  await reload();
}

export function reset() {
  run++;
  sensors = [];
  for (const table of Object.values(tables)) table.setRows([]);
}
