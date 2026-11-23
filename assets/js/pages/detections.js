// The Detections page: a list of what camera traps and other detectors saw, like the events
// list of Smart Parks Protect. The detectors themselves are a layer of the live map, which
// is also where an area is searched for them.

import { counted, detections, loadDetections, onDetections, refreshDetections, setPeriod, speciesName, stopSearch } from "../detections.js";
import { buildHash, webLink } from "../lib.js";
import { recordHash } from "../records.js";
import { $, DataTable, MultiPicker, formatMoment, note, plural } from "../ui.js";

const COLUMNS = ["time", "species", "animals", "confidence", "description", "detector", "sensor_type", "source", "uri", "id"];
const LABELS = { time: "Time", species: "Detection", animals: "Animals", confidence: "Confidence", description: "Description", detector: "Detector", sensor_type: "Sensor type", source: "Sent by", uri: "Picture", id: "ID" };

/** What is known of the animals of a detection, in a few words: "female, adult, grazing". */
function animalText(animals) {
  const parts = new Set();
  for (const animal of animals) for (const value of [animal.description, animal.sex, animal.lifeStage, animal.condition, animal.behaviour]) if (value) parts.add(value);
  return [...parts].join(", ");
}

let table = null;
let speciesPicker = null;
let detectorPicker = null;

function draw() {
  if (!table || $("view-detections").hidden) return;
  const all = [...detections.found.values()];
  // a chosen value stays in the list while its detections are still loading, or are not in
  // this period, so a filter from a link is not lost
  const options = (keyOf, picker) => {
    const list = counted(all, keyOf).map(([name, count]) => ({ value: name, label: name, note: count.toLocaleString() }));
    return [...list, ...picker.values().filter((value) => !list.some((o) => o.value === value)).map((value) => ({ value, label: value, note: "0" }))];
  };
  speciesPicker.set(options(speciesName, speciesPicker), speciesPicker.values());
  detectorPicker.set(options((d) => d.deploymentID, detectorPicker), detectorPicker.values());
  const species = new Set(speciesPicker.values());
  const detectors = new Set(detectorPicker.values());
  const shown = all.filter((d) => (!species.size || species.has(speciesName(d))) && (!detectors.size || detectors.has(d.deploymentID)));

  $("detectionsFrom").value = detections.from;
  $("detectionsTo").value = detections.to;
  $("detectionsProgress").textContent = detections.progress || (all.length ? (shown.length === all.length ? plural(all.length, "detection") : `${shown.length.toLocaleString()} of ${plural(all.length, "detection")}`) : "");
  $("detectionsStop").hidden = !detections.busy;
  note($("detectionsNote"), detections.busy ? "" : detections.message, all.length ? "error" : "");

  const rows = shown.map((detection) => {
    const animals = detection.animals || [];
    const latin = detection.species && detection.species.name;
    return {
      time: detection.start,
      species: latin && latin !== speciesName(detection) ? `${speciesName(detection)} (${latin})` : speciesName(detection),
      species_id: detection.species ? detection.species.ID : "",
      animals: animals.length,
      confidence: animals.length ? `${Math.max(...animals.map((a) => a.confidence || 0))}%` : "",
      description: animalText(animals),
      detector: detection.deploymentID,
      sensor_type: detection.sensorType || "",
      // the data system that sent it, for example Smart Parks Protect for AddaxAI Connect cameras
      source: (detection.user && detection.user.name) || "",
      uri: detection.uri || "",
      id: detection.ID,
    };
  });
  table.setRows(rows, {
    columns: COLUMNS,
    labels: LABELS,
    sortKey: table.sortKey && COLUMNS.includes(table.sortKey) ? table.sortKey : "time",
    sortDir: table.sortKey ? table.sortDir : -1,
    format: { time: (value) => formatMoment(Date.parse(value)) },
    link: [
      { column: "species", href: (row) => (row.species_id ? recordHash("species", row.species_id) : "") },
      { column: "detector", href: (row) => buildHash("map", "", { detector: row.detector }), title: "Show on map" },
      { column: "uri", href: (row) => webLink(row.uri), text: "open", title: "Open the picture in the system that made the detection", external: true },
    ],
    raw: shown,
    empty: detections.busy ? "Loading…" : "No detections to show.",
    keep: true,
  });
}

function list(text) {
  return text ? text.split(",").filter(Boolean) : [];
}

/** Shows the page; `?detector=A,B` and `?species=X` set the filters. */
export function show({ query }) {
  if (!table) {
    table = new DataTable($("detectionsTable"), { filename: "wildlifenl-detections" });
    speciesPicker = new MultiPicker($("detectionsSpecies"), { placeholder: "All species", noun: "species", onChange: draw });
    detectorPicker = new MultiPicker($("detectionsDetectors"), { placeholder: "All detectors", noun: "detectors", onChange: draw });
    for (const id of ["detectionsFrom", "detectionsTo"]) $(id).addEventListener("change", () => setPeriod($("detectionsFrom").value, $("detectionsTo").value));
    $("detectionsStop").addEventListener("click", stopSearch);
    $("detectionsRefresh").addEventListener("click", () => loadDetections(true));
    onDetections(draw);
  }
  // a link from the map names a detector before its detections are in the picker
  if (query.detector) detectorPicker.set(list(query.detector).map((value) => ({ value, label: value })), list(query.detector));
  if (query.species) speciesPicker.set(list(query.species).map((value) => ({ value, label: value })), list(query.species));
  loadDetections();
  draw();
}

/** Asks the known places again; what is new joins the list. */
export function refresh() {
  return refreshDetections();
}

export function reset() {
  if (!table) return;
  speciesPicker.set([], []);
  detectorPicker.set([], []);
  table.setRows([]);
}
