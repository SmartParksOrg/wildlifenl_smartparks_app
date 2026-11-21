// The list page and the record page of every kind of record described in records.js. What
// they show comes from the data itself: a field that holds another record is a link to it, a
// place is drawn on a small map, and a list inside a record becomes a table.

import { buildHash, toTime, webLink, words } from "../lib.js";
import { MapView } from "../map.js";
import { TYPES, canList, getRecord, linkOf, listHash, listRecords, listTitle, recordHash, seesOwnOnly, relatedRecords, titleOf } from "../records.js";
import { loadApi, operationOf } from "../rights.js";
import { explain, hasScope } from "../session.js";
import { $, DataTable, el, facts, formatMoment, note, plural, toast } from "../ui.js";
import { drawActions } from "../writes.js";
import { experimentCard, questionsCard } from "./research.js";

/** A card of its own for a kind of record, and the list inside the record it stands for. */
const CARDS = { experiments: { draw: experimentCard }, questionnaires: { draw: questionsCard, field: "questions" } };

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
      labels: { ...Object.fromEntries(columns.map((column) => [column, words(column)])), ...((TYPES[type] && TYPES[type].labels) || {}) },
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

async function showList(type, own) {
  const def = TYPES[type];
  const mine = ++run;
  const name = def.plural.toLowerCase();
  $("recordsTitle").textContent = listTitle(type, own);
  $("recordsDescription").textContent = def.description;
  note($("recordsNote"), "");
  // from the own records to those of everyone and back, for an account that may read both
  const both = Boolean(def.mine) && hasScope(def.needs || []);
  $("recordsSwitch").hidden = !both;
  $("recordsSwitch").textContent = own ? `All ${name}` : listTitle(type, true);
  $("recordsSwitch").href = recordHash(type) + (own ? "" : "?mine=1");
  // what the account may add here; a new record opens on its own page
  drawActions($("recordsActions"), type, "list", null, (result) => (result && result.ID != null ? (location.hash = recordHash(type, result.ID)) : showList(type, own)));
  if (!listTable) listTable = new DataTable($("recordsTable"), { filename: "wildlifenl" });
  listTable.filename = `wildlifenl-${type}`;
  listTable.setRows([], { empty: "Loading…" });
  try {
    const { records, own: partly } = await listRecords(type, own);
    if (mine !== run) return;
    const { rows, options } = tableOf(type, records, def.columns);
    listTable.setRows(rows, { ...options, empty: `No ${name} to show.` });
    const needs = def.needs && def.needs.length && !hasScope(def.needs);
    // a list that was asked for as the own one needs no word on what the account misses
    const about = own && def.mine ? "" : partly && type === "people" ? def.hint : partly ? `You see your own ${name}. All of them need one of these roles: ${def.needs.join(", ")}.` : needs && !def.list ? `The list of ${name} needs one of these roles: ${def.needs.join(", ")}. Records you opened through a link are listed.` : "";
    note($("recordsNote"), [about, !(own && def.mine) && (!records.length || def.list) ? def.hint || "" : ""].filter((text, index, all) => text && all.indexOf(text) === index).join(" "));
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
  if (type === "people") return buildHash("map", "", { person: record.ID });
  if (type === "contacts") return buildHash("map", "", { event: `c:${record.ID}` });
  if (type === "alarms") return buildHash("map", "", { event: `l:${record.ID}` });
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
  $("recordBack").href = listHash(type);
  $("recordBack").textContent = def.own || seesOwnOnly(type) ? listTitle(type, true) : `All ${def.plural.toLowerCase()}`;
  $("recordOnMap").hidden = true;
  $("recordMapCard").hidden = true;
  $("recordFacts").replaceChildren();
  $("recordActions").replaceChildren();
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
  // what the account may change; afterwards the page is read again, or left when the record is gone
  drawActions($("recordActions"), type, "record", record, (result, action) => {
    if (action.opens && result && result.ID != null) return (location.hash = recordHash(action.opens, result.ID));
    if (!action.gone) return showRecord(type, id);
    if (canList(type)) location.hash = listHash(type);
    else history.back();
  });
  $("recordCopy").onclick = async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(record, null, 2));
      toast("Copied JSON to the clipboard");
    } catch {
      toast("The browser refused access to the clipboard", true);
    }
  };

  // the token for notifications of the phone app is of no use to a reader, and a field that
  // the card of the kind shows in full is not listed twice
  const own = CARDS[type];
  const fields = Object.entries(record).filter(([field]) => field !== "$schema" && field !== "firebaseCloudMessagingToken" && !(own && own.field === field));
  const lists = fields.filter(([field, value]) => Array.isArray(value) && value.length && value.every((item) => item && typeof item === "object" && !isPoint(item)) && !value.every((item) => linkOf(field, item)));
  facts($("recordFacts"), fields.filter(([field]) => !lists.some(([name]) => name === field)).map(([field, value]) => [words(field), nodeOf(field, value)]));

  // where it is: a point, or the outline of an area
  const places = placesOf(record);
  const outline = outlineOf(record);
  const onMap = mapLink(type, record);
  $("recordOnMap").hidden = !onMap;
  if (onMap) $("recordOnMap").href = onMap;
  const drawsOnMap = (def.related || []).some((relation) => relation.onMap);
  $("recordMapCard").hidden = !(places.length || outline.length > 2 || drawsOnMap);
  if (places.length || outline.length > 2 || drawsOnMap) {
    if (!map) map = new MapView($("recordMap"));
    map.setTrack(false);
    map.setPoints(places, { describe: (place) => [place.label, [`${place.lat.toFixed(5)}, ${place.lng.toFixed(5)}`]] });
    map.setArea(outline.length > 2 ? outline : []);
  }

  // the card of the kind, the lists inside the record, then the lists that hang under it
  if (own) extra.append(own.draw(record, () => showRecord(type, id)));
  for (const [field, value] of lists) {
    const inner = { answers: "answers", questions: "questions", borneSensorDeployments: "" }[field] || "";
    const target = el("div");
    extra.append(card(words(field), target));
    const { rows, options } = tableOf(inner, value, columnsOf(value));
    new DataTable(target, { filename: `wildlifenl-${type}-${field}`, tools: false }).setRows(rows, options);
  }
  // a list is left out on a server that does not have its call; when the description of the
  // API cannot be read, every list is tried
  const described = await loadApi().then(() => true, () => false);
  if (mine !== run) return;
  for (const relation of def.related || []) {
    if (!hasScope(relation.needs || [])) continue;
    if (relation.call && described && !operationOf("GET", relation.call)) continue;
    const target = el("div", { class: "empty", text: "Loading…" });
    extra.append(card(relation.label, target));
    relatedRecords(relation, record)
      .then((rows) => {
        if (mine !== run) return;
        target.className = "";
        const table = tableOf(relation.type || "", rows, relation.columns || columnsOf(rows));
        // with its tools, so a list under a record can be copied and downloaded
        new DataTable(target, { filename: `wildlifenl-${type}-${relation.type || "list"}`, empty: "Nothing here." }).setRows(table.rows, table.options);
        if (relation.onMap && rows.length && map) {
          map.setPoints(
            rows.filter((row) => isPoint(row.location)).map((row) => ({ lat: row.location.latitude, lng: row.location.longitude, t: row.timestamp ? toTime(row.timestamp) : row.count, count: row.count, timestamp: row.timestamp })),
            { fit: !outline.length, describe: (point) => [point.timestamp ? formatMoment(toTime(point.timestamp)) : plural(point.count, "visit"), [`${point.lat.toFixed(5)}, ${point.lng.toFixed(5)}`]] },
          );
          map.setTrack(Boolean(rows[0].timestamp)); // the places of a person are a track, the visits of an area are not
        }
      })
      .catch((error) => {
        const text = explain(error);
        if (text && mine === run) target.textContent = text;
      });
  }
}

/** Shows the list of a kind, or one record of it; an unknown kind goes to the species. */
export async function show({ id: type, sub, query }) {
  const known = type in TYPES ? type : "species";
  $("view-records").hidden = Boolean(sub);
  $("view-record").hidden = !sub;
  if (sub) await showRecord(known, sub);
  else await showList(known, Boolean(query.mine && TYPES[known].mine));
}

export function reset() {
  run++;
  if (listTable) listTable.setRows([]);
}
