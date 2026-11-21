// Detections in a period and a circle on the map.

import { ago, columnsOf, flatten, toLocalInput, toPoint, toTime } from "../lib.js";
import { MapView } from "../map.js";
import { account, explain } from "../session.js";
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
    map.setPoints(
      detections
        .map((d) => ({ point: toPoint(d, "start"), d }))
        .filter((x) => x.point)
        .map(({ point, d }) => ({ ...point, d })),
      { describe: (p) => [(p.d.species && (p.d.species.commonName || p.d.species.name)) || "Detection", [formatMoment(p.t), p.d.deploymentID, p.d.sensorType]] },
    );
    if (!detections.length) note(target, all.length ? "No detection in the area matches that deployment ID." : "No detections in this period and area. Try a longer period or move the centre; WildlifeNL searches at most 10 km around it.", "warn");
  } catch (error) {
    note(target, explain(error), "error");
  }
}

function setPeriod() {
  $("detectionsFrom").value = toLocalInput(Date.now() - 7 * 24 * HOUR);
  $("detectionsTo").value = toLocalInput(Date.now() + 60 * 1000);
}

export function show() {
  if (map) return;
  map = new MapView($("detectionsMap"));
  table = new DataTable($("detectionsTable"), { filename: "wildlifenl-detections", empty: "Choose a period and an area and load the detections." });
  setPeriod();
  $("detectionsForm").addEventListener("submit", (event) => {
    event.preventDefault();
    if (event.target.reportValidity()) busy(event.submitter || event.target.querySelector("button[type=submit]"), load);
  });
  $("detectionsUseMap").addEventListener("click", () => {
    const center = map.center();
    if (!center) return;
    $("detectionsLat").value = center.lat.toFixed(5);
    $("detectionsLng").value = center.lng.toFixed(5);
  });
}

export function reset() {
  if (!map) return;
  table.setRows([]);
  map.setPoints([], { fit: false });
  $("detectionsTiles").replaceChildren();
  note($("detectionsNote"), "");
  setPeriod();
}
