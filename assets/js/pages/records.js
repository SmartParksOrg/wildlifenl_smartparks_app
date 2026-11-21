// The list page and the record page of every kind of record described in records.js. What
// they show comes from the data itself: a field that holds another record is a link to it, a
// place is drawn on a small map, and a list inside a record becomes a table.

import { buildHash, toTime, webLink, words } from "../lib.js";
import { MapView } from "../map.js";
import { TYPES, getRecord, linkOf, listRecords, recordHash, relatedRecords, titleOf } from "../records.js";
import { explain, hasScope } from "../session.js";
import { $, DataTable, el, facts, formatMoment, note, plural, toast } from "../ui.js";

const PLACE_FIELDS = ["place", "location", "startLocation", "endLocation"];

let listTable = null;
let map = null;
let run = 0;

function isPoint(value) {
  return Boolean(value) && typeof value === "object" && Number.isFinite(value.latitude) && Number.isFinite(value.longitude);
}

function isMoment(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}T/.test(value);
}

function pointText(point) {
  return `${point.latitude.toFixed(5)}, ${point.longitude.toFixed(5)}`;
}

/** A value as text, for a cell of a table. Moments stay as they are, so they sort. */
function textOf(field, value) {
  if (value == null || value === "") return "";
  if (typeof value === "boolean") return value ? "yes" : "no";
  if (isPoint(value)) return pointText(value);
  if (Array.isArray(value)) {
    if (value.length && value.every(isPoint)) return `outline of ${plural(value.length, "point")}`;
    const parts = value.map((item) => textOf(field, item)).filter(Boolean);
    return parts.length > 4 ? `${parts.slice(0, 4).join(", ")} and ${parts.length - 4} more` : parts.join(", ");
  }
  const link = linkOf(field, value);
  if (link) return link.text;
  if (typeof value === "object") {
    return (
      value.name ||
      value.text ||
      Object.entries(value)
        .filter(([key, inner]) => key !== "$schema" && inner != null && inner !== "" && typeof inner !== "object")
        .map(([key, inner]) => `${words(key).toLowerCase()} ${inner}`)
        .join(", ")
    );
  }
  return String(value);
}

/** A value as it stands on a record page: a link where it points at another record. */
function nodeOf(field, value) {
  if (Array.isArray(value) && value.length && value.every((item) => linkOf(field, item))) {
    return el("span", { class: "row" }, value.map((item) => el("a", { class: "badge", href: linkOf(field, item).href, text: linkOf(field, item).text })));
  }
  const link = linkOf(field, value);
  if (link) return el("a", { href: link.href, text: link.text });
  if (isMoment(value)) return formatMoment(toTime(value));
  if (field === "uri" && webLink(value)) return el("a", { href: webLink(value), target: "_blank", rel: "noopener noreferrer", text: value });
  return textOf(field, value);
}

/** Rows for a DataTable from records: the text per column and, aside, where cells link to. */
function tableOf(type, records, columns) {
  const rows = records.map((record) => {
    const row = { __links: {} };
    for (const column of columns) {
      row[column] = textOf(column, record[column]);
      const link = Array.isArray(record[column]) ? null : linkOf(column, record[column]);
      if (link) row.__links[column] = link.href;
    }
    if (type && record.ID != null && columns.length && !row.__links[columns[0]]) row.__links[columns[0]] = recordHash(type, record.ID);
    return row;
  });
  const moments = columns.filter((column) => records.some((record) => isMoment(record[column])));
  return {
    rows,
    options: {
      columns,
      labels: Object.fromEntries(columns.map((column) => [column, words(column)])),
      format: Object.fromEntries(moments.map((column) => [column, (value) => formatMoment(toTime(value))])),
      link: columns.map((column) => ({ column, href: (row) => row.__links[column] || "" })),
      sortKey: moments[0] || columns[0],
      sortDir: moments[0] ? -1 : 1,
      raw: records,
    },
  };
}

function columnsOf(records) {
  const keys = new Set();
  for (const record of records) for (const key of Object.keys(record)) if (key !== "$schema") keys.add(key);
  return [...keys].slice(0, 8);
}

// ---------------------------------------------------------------------------------------------
// A list

async function showList(type) {
  const def = TYPES[type];
  const mine = ++run;
  $("recordsTitle").textContent = def.plural;
  $("recordsDescription").textContent = def.description;
  note($("recordsNote"), "");
  if (!listTable) listTable = new DataTable($("recordsTable"), { filename: "wildlifenl" });
  listTable.filename = `wildlifenl-${type}`;
  listTable.setRows([], { empty: "Loading…" });
  try {
    const { records, own } = await listRecords(type);
    if (mine !== run) return;
    const { rows, options } = tableOf(type, records, def.columns);
    listTable.setRows(rows, { ...options, empty: `No ${def.plural.toLowerCase()} to show.` });
    const needs = def.needs && def.needs.length && !hasScope(def.needs);
    note(
      $("recordsNote"),
      [own ? `You see your own ${def.plural.toLowerCase()}. All of them need one of these roles: ${def.needs.join(", ")}.` : needs && !def.list ? `The list of ${def.plural.toLowerCase()} needs one of these roles: ${def.needs.join(", ")}. Records you opened through a link are listed.` : "", !records.length || def.list ? def.hint || "" : ""].filter(Boolean).join(" "),
    );
  } catch (error) {
    const text = explain(error);
    if (text && mine === run) note($("recordsNote"), text, "error");
  }
}

// ---------------------------------------------------------------------------------------------
// One record

function placesOf(record) {
  return PLACE_FIELDS.filter((field) => isPoint(record[field])).map((field) => ({ lat: record[field].latitude, lng: record[field].longitude, t: 0, label: words(field) }));
}

function outlineOf(record) {
  return Array.isArray(record.definition) ? record.definition.filter(isPoint).map((p) => ({ lat: p.latitude, lng: p.longitude })) : [];
}

function mapLink(type, record) {
  if (type === "livinglabs" || type === "zones") return buildHash("map", "", { area: record.ID });
  if (type === "reports") return buildHash("map", "", { report: record.ID });
  const place = placesOf(record)[0];
  return place ? buildHash("map", "", { at: `${place.lat},${place.lng}` }) : "";
}

function card(title, body) {
  return el("div", { class: "card stack" }, [el("h2", { text: title }), body]);
}

async function showRecord(type, id) {
  const def = TYPES[type];
  const mine = ++run;
  const extra = $("recordExtra");
  $("recordTitle").textContent = def.label;
  $("recordSubtitle").textContent = "";
  $("recordBack").href = recordHash(type);
  $("recordBack").textContent = `All ${def.plural.toLowerCase()}`;
  $("recordOnMap").hidden = true;
  $("recordMapCard").hidden = true;
  $("recordFacts").replaceChildren();
  extra.replaceChildren();
  note($("recordNote"), "");
  let record;
  try {
    record = await getRecord(type, id);
  } catch (error) {
    const text = explain(error);
    if (text && mine === run) note($("recordNote"), text, "error");
    return;
  }
  if (mine !== run) return;
  if (!record) {
    const needs = def.getNeeds && def.getNeeds.length ? ` Opening one directly needs one of these roles: ${def.getNeeds.join(", ")}.` : "";
    return note($("recordNote"), `This ${def.label.toLowerCase()} is not known here.${needs}`, "warn");
  }
  $("recordTitle").textContent = titleOf(type, record);
  $("recordSubtitle").textContent = def.label;
  $("recordCopy").onclick = async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(record, null, 2));
      toast("Copied JSON to the clipboard");
    } catch {
      toast("The browser refused access to the clipboard", true);
    }
  };

  const fields = Object.entries(record).filter(([field]) => field !== "$schema");
  const lists = fields.filter(([field, value]) => Array.isArray(value) && value.length && value.every((item) => item && typeof item === "object" && !isPoint(item)) && !value.every((item) => linkOf(field, item)));
  facts($("recordFacts"), fields.filter(([field]) => !lists.some(([name]) => name === field)).map(([field, value]) => [words(field), nodeOf(field, value)]));

  // where it is: a point, or the outline of an area
  const places = placesOf(record);
  const outline = outlineOf(record);
  const onMap = mapLink(type, record);
  $("recordOnMap").hidden = !onMap;
  if (onMap) $("recordOnMap").href = onMap;
  $("recordMapCard").hidden = !(places.length || outline.length > 2);
  if (places.length || outline.length > 2) {
    if (!map) map = new MapView($("recordMap"));
    map.setPoints(places, { describe: (place) => [place.label, [`${place.lat.toFixed(5)}, ${place.lng.toFixed(5)}`]] });
    map.setArea(outline.length > 2 ? outline : []);
  }

  // lists inside the record, then the lists that hang under it
  for (const [field, value] of lists) {
    const inner = { answers: "answers", questions: "questions", borneSensorDeployments: "" }[field] || "";
    const target = el("div");
    extra.append(card(words(field), target));
    const { rows, options } = tableOf(inner, value, columnsOf(value));
    new DataTable(target, { filename: `wildlifenl-${type}-${field}`, tools: false }).setRows(rows, options);
  }
  for (const relation of def.related || []) {
    if (!hasScope(relation.needs || [])) continue;
    const target = el("div", { class: "empty", text: "Loading…" });
    extra.append(card(relation.label, target));
    relatedRecords(relation, record)
      .then((rows) => {
        if (mine !== run) return;
        target.className = "";
        const table = tableOf(relation.type || "", rows, relation.columns || columnsOf(rows));
        new DataTable(target, { filename: `wildlifenl-${type}-related`, empty: "Nothing here.", tools: false }).setRows(table.rows, table.options);
        if (relation.onMap && rows.length && map) {
          map.setPoints(
            rows.filter((row) => isPoint(row.location)).map((row) => ({ lat: row.location.latitude, lng: row.location.longitude, t: row.count, count: row.count })),
            { fit: false, describe: (point) => [plural(point.count, "visit"), [`${point.lat.toFixed(5)}, ${point.lng.toFixed(5)}`]] },
          );
        }
      })
      .catch((error) => {
        const text = explain(error);
        if (text && mine === run) target.textContent = text;
      });
  }
}

/** Shows the list of a kind, or one record of it; an unknown kind goes to the species. */
export async function show({ id: type, sub }) {
  const known = type in TYPES ? type : "species";
  $("view-records").hidden = Boolean(sub);
  $("view-record").hidden = !sub;
  if (sub) await showRecord(known, sub);
  else await showList(known);
}

export function reset() {
  run++;
  if (listTable) listTable.setRows([]);
}
