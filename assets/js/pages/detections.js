// Detections in a period and a circle on the map.

import { ago, columnsOf, flatten, toLocalInput, toPoint, toTime } from "../lib.js";
import { MapView } from "../map.js";
import { account, explain } from "../session.js";
import { loadSensors } from "../store.js";
import { $, DataTable, busy, formatMoment, note, tiles } from "../ui.js";

const HOUR = 3600 * 1000;
const COLUMNS = ["start", "end", "deploymentID", "sensorType", "species.commonName", "species.name", "animals", "confidence", "location.latitude", "location.longitude", "uri", "user.name", "ID"];
const LEFT_OUT = ["species.advice", "species.behaviour", "species.description", "species.roleInNature", "species.category", "species.ID", "user.ID"];

let map = null;
let table = null;

async function load() {
  const target = $("detectionsNote");
  note(target, "");
  const start = toTime($("detectionsFrom").value);
  const end = toTime($("detectionsTo").value);
  if (!(start < end)) return note(target, "The period must end after it starts.", "error");
  try {
    const all = await account.api.detections({
      start: new Date(start).toISOString(),
      end: new Date(end).toISOString(),
      latitude: $("detectionsLat").value,
      longitude: $("detectionsLng").value,
      radius: Math.round(Number($("detectionsRadius").value) * 1000),
    });
    const wanted = $("detectionsDeployment").value.trim().toLowerCase();
    const detections = wanted ? all.filter((d) => String(d.deploymentID || "").toLowerCase().includes(wanted)) : all;
    const rows = detections.map((detection) => {
      const animals = detection.animals || [];
      const flat = flatten({ ...detection, animals: animals.length });
      for (const key of LEFT_OUT) delete flat[key];
      flat.confidence = animals.length ? `${Math.max(...animals.map((a) => a.confidence || 0))}%` : "";
      return flat;
    });
    const latest = Math.max(...detections.map((d) => toTime(d.start)).filter(Number.isFinite), -Infinity);
    tiles($("detectionsTiles"), [
      { label: "Detections", value: detections.length.toLocaleString(), note: wanted ? `${all.length.toLocaleString()} in the area` : "" },
      { label: "Species", value: new Set(detections.map((d) => d.species && d.species.ID)).size.toLocaleString() },
      { label: "Deployments", value: new Set(detections.map((d) => d.deploymentID)).size.toLocaleString() },
      { label: "Latest detection", value: ago(latest) || "None", note: formatMoment(latest) },
    ]);
    const present = columnsOf(rows);
    table.setRows(rows, { columns: [...COLUMNS.filter((c) => present.includes(c)), ...present.filter((c) => !COLUMNS.includes(c))], sortKey: "start", raw: detections });
    drawCircle();
    map.setPoints(
      detections
        .map((d) => ({ point: toPoint(d, "start"), d }))
        .filter((x) => x.point)
        .map(({ point, d }) => ({ ...point, d })),
      { fit: false, describe: (p) => [(p.d.species && (p.d.species.commonName || p.d.species.name)) || "Detection", [formatMoment(p.t), p.d.deploymentID, p.d.sensorType]] },
    );
    map.fitCircle();
    if (!detections.length) note(target, all.length ? "No detection in the area matches that deployment ID." : "No detections in this circle and period. Click the map to move the circle, or choose a longer period.", "warn");
  } catch (error) {
    note(target, explain(error), "error");
  }
}

const DEFAULT_DAYS = 30;
const UTRECHT = { lat: 52.09, lng: 5.12 }; // the middle of the country, when no sensor says where to look

function setPeriod() {
  $("detectionsFrom").value = toLocalInput(Date.now() - DEFAULT_DAYS * 24 * HOUR);
  $("detectionsTo").value = toLocalInput(Date.now() + 60 * 1000);
}

/** Draws the search circle from the form; a click on the map moves it there. */
function drawCircle(fit = false) {
  const center = { lat: Number($("detectionsLat").value), lng: Number($("detectionsLng").value) };
  const radius = Math.min(10, Math.max(0.1, Number($("detectionsRadius").value) || 10)) * 1000;
  if (!Number.isFinite(center.lat) || !Number.isFinite(center.lng)) return;
  map.setCircle(center, radius, (place) => {
    $("detectionsLat").value = place.lat.toFixed(5);
    $("detectionsLng").value = place.lng.toFixed(5);
    drawCircle();
  });
  if (fit) map.fitCircle();
}

/** The circle starts where the sensors are, which is where one most likely wants to look. */
async function setCentre() {
  let place = UTRECHT;
  try {
    const sensor = (await loadSensors()).find((s) => s.place);
    if (sensor) place = sensor.place;
  } catch (error) {
    explain(error);
  }
  $("detectionsLat").value = place.lat.toFixed(5);
  $("detectionsLng").value = place.lng.toFixed(5);
  drawCircle(true);
}

export async function show() {
  if (map) return;
  map = new MapView($("detectionsMap"));
  table = new DataTable($("detectionsTable"), { filename: "wildlifenl-detections", empty: "Choose a period and a place and load the detections." });
  setPeriod();
  $("detectionsForm").addEventListener("submit", (event) => {
    event.preventDefault();
    if (event.target.reportValidity()) busy(event.submitter || event.target.querySelector("button[type=submit]"), load);
  });
  for (const id of ["detectionsLat", "detectionsLng", "detectionsRadius"]) $(id).addEventListener("change", () => drawCircle());
  await setCentre();
}

export function reset() {
  if (!map) return;
  table.setRows([]);
  map.setPoints([], { fit: false });
  $("detectionsTiles").replaceChildren();
  note($("detectionsNote"), "");
  setPeriod();
  setCentre();
}
