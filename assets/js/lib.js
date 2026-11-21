// Pure helpers: no DOM, no network. Everything here is covered by tests/lib.test.js.

/** Milliseconds since the epoch for an ISO string, a Date or a number in seconds or
 * milliseconds; NaN when the value is not a moment. */
export function toTime(value) {
  if (value == null || value === "") return NaN;
  if (value instanceof Date) return value.getTime();
  if (typeof value === "number") return value > 1e11 ? value : value * 1000;
  const text = String(value).trim();
  if (/^\d+(\.\d+)?$/.test(text)) return toTime(Number(text));
  return Date.parse(text);
}

/** One level object with dotted keys; arrays stay as they are. */
export function flatten(record) {
  const out = {};
  const step = (value, prefix) => {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      const entries = Object.entries(value);
      if (entries.length === 0 && prefix) out[prefix] = value;
      for (const [key, inner] of entries) {
        if (key === "$schema") continue;
        step(inner, prefix ? `${prefix}.${key}` : key);
      }
    } else if (prefix) {
      out[prefix] = value;
    }
  };
  step(record, "");
  return out;
}

export function cellText(value) {
  if (value == null) return "";
  return typeof value === "object" ? JSON.stringify(value) : String(value);
}

export function toCsv(rows, columns) {
  const cols = columns || columnsOf(rows);
  const escape = (value) => {
    const text = cellText(value);
    return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  return [cols.map(escape).join(","), ...rows.map((row) => cols.map((c) => escape(row[c])).join(","))].join("\n");
}

export function columnsOf(rows) {
  const seen = new Set();
  for (const row of rows) for (const key of Object.keys(row)) seen.add(key);
  return [...seen];
}

/** A point `{t, lat, lng, raw}` from a WildlifeNL record: its `location` (`latitude`,
 * `longitude`) and the moment under `timeKey`. Null when the record has no usable moment or
 * location, like a reading that carries a temperature only. */
export function toPoint(record, timeKey = "timestamp") {
  const location = record && record.location;
  if (!location || location.latitude == null || location.longitude == null) return null;
  const t = toTime(record[timeKey]);
  const lat = Number(location.latitude);
  const lng = Number(location.longitude);
  const valid = Number.isFinite(t) && Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
  return valid ? { t, lat, lng, raw: record } : null;
}

/** Keeps the items whose moment lies within the window; a missing bound is open. */
export function withinWindow(items, from, to, timeOf = (item) => item.t) {
  const start = Number.isFinite(from) ? from : -Infinity;
  const end = Number.isFinite(to) ? to : Infinity;
  return items.filter((item) => {
    const t = timeOf(item);
    return t >= start && t <= end;
  });
}

/** "3 minutes ago" style text for a moment in the past. */
export function ago(t, now = Date.now()) {
  if (!Number.isFinite(t)) return "";
  const seconds = Math.max(0, Math.round((now - t) / 1000));
  if (seconds < 60) return "just now";
  const units = [
    ["minute", 60],
    ["hour", 3600],
    ["day", 86400],
  ];
  let label = "";
  for (const [name, size] of units) {
    if (seconds >= size) {
      const count = Math.floor(seconds / size);
      label = `${count} ${name}${count === 1 ? "" : "s"} ago`;
    }
  }
  return label;
}

/** The human message of a failed request: the problem document's detail when there is one. */
export function problemText(status, body) {
  if (body && typeof body === "object") {
    const details = Array.isArray(body.errors) ? body.errors.map((e) => [e.location, e.message].filter(Boolean).join(": ")).filter(Boolean) : [];
    const detail = typeof body.detail === "string" ? body.detail : Array.isArray(body.detail) ? body.detail.map((d) => d.msg || JSON.stringify(d)).join("; ") : "";
    const text = [detail || body.title, ...details].filter(Boolean).join(" ");
    if (text) return text;
  }
  if (typeof body === "string" && body.trim()) return body.trim().slice(0, 300);
  return `The server answered ${status}`;
}

/** Metres between two points on the sphere. */
export function distanceMeters(a, b) {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371008.8 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** The points of a sensor's readings that carry a location, oldest first. */
export function trackOf(readings) {
  return readings
    .map((reading) => toPoint(reading))
    .filter(Boolean)
    .sort((a, b) => a.t - b.t);
}

/** What the data explorer can chart. `value` reads the number from one reading; `speed` is
 * derived from two fixes in a row and has no `value`. */
export const METRICS = {
  temperature: { label: "Temperature", unit: "°C", value: (r) => r.temperature },
  altitude: { label: "Altitude", unit: "m", value: (r) => r.altitude },
  speed: { label: "Speed", unit: "km/h" },
  "accelero.x": { label: "Acceleration x", unit: "", value: (r) => r.accelero && r.accelero.x },
  "accelero.y": { label: "Acceleration y", unit: "", value: (r) => r.accelero && r.accelero.y },
  "accelero.z": { label: "Acceleration z", unit: "", value: (r) => r.accelero && r.accelero.z },
};

/** `[time, value]` pairs of one metric from a sensor's readings, oldest first. Speed is the
 * straight-line distance between two fixes over the time between them. */
export function metricSeries(readings, metric) {
  if (metric === "speed") {
    const track = trackOf(readings);
    const series = [];
    for (let i = 1; i < track.length; i++) {
      const seconds = (track[i].t - track[i - 1].t) / 1000;
      if (seconds > 0) series.push([track[i].t, (distanceMeters(track[i - 1], track[i]) / seconds) * 3.6]);
    }
    return series;
  }
  const read = METRICS[metric].value;
  return readings
    .map((reading) => [toTime(reading.timestamp), read(reading)])
    .filter(([t, value]) => Number.isFinite(t) && typeof value === "number" && Number.isFinite(value))
    .sort((a, b) => a[0] - b[0]);
}

/** The mean per bucket of `bucketMs`, stamped at the bucket's start; the series itself when
 * `bucketMs` is 0. */
export function bucketSeries(series, bucketMs) {
  if (!bucketMs) return series;
  const sums = new Map();
  for (const [t, value] of series) {
    const key = Math.floor(t / bucketMs) * bucketMs;
    const sum = sums.get(key) || [0, 0];
    sum[0] += value;
    sum[1] += 1;
    sums.set(key, sum);
  }
  return [...sums.entries()].sort((a, b) => a[0] - b[0]).map(([t, [total, count]]) => [t, total / count]);
}

const MINUTE = 60000;
export const BUCKETS = { raw: 0, "15m": 15 * MINUTE, "1h": 60 * MINUTE, "6h": 360 * MINUTE, "1d": 1440 * MINUTE };

/** A bucket that keeps a chart of `spanMs` at a few hundred points: every reading up to two
 * days, then wider buckets. */
export function autoBucket(spanMs) {
  const days = spanMs / (1440 * MINUTE);
  if (!Number.isFinite(days) || days > 180) return "1d";
  if (days > 45) return "6h";
  if (days > 8) return "1h";
  if (days > 2) return "15m";
  return "raw";
}

/** The address when it is a plain web link, else an empty text. Data from a server is only
 * made clickable through this, so a `javascript:` address can never become a link. */
export function webLink(value) {
  return /^https?:\/\/[^\s]+$/i.test(String(value || "").trim()) ? String(value).trim() : "";
}

/** The page and its parameters from a location hash like `#/sensors/A1?range=168`; a record
 * page has a third part, `#/data/species/{id}`. */
export function parseHash(hash) {
  const [path, query = ""] = String(hash || "").replace(/^#\/?/, "").split("?");
  const parts = path.split("/").filter(Boolean).map(decodeURIComponent);
  return { page: parts[0] || "", id: parts[1] || "", sub: parts[2] || "", query: Object.fromEntries(new URLSearchParams(query)) };
}

/** The hash for a page, an optional id and query values; empty values are left out. */
export function buildHash(page, id = "", query = {}) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) if (value !== "" && value != null) params.set(key, value);
  const text = params.toString();
  return `#/${page}${id ? `/${encodeURIComponent(id)}` : ""}${text ? `?${text}` : ""}`;
}

/** "1.2 km" or "340 m". */
export function formatDistance(metres) {
  if (!Number.isFinite(metres)) return "";
  return metres >= 1000 ? `${(metres / 1000).toFixed(metres >= 10000 ? 0 : 1)} km` : `${Math.round(metres)} m`;
}

/** The length of a track in metres. */
export function trackLength(track) {
  let total = 0;
  for (let i = 1; i < track.length; i++) total += distanceMeters(track[i - 1], track[i]);
  return total;
}

/** The complete objects at the start of a JSON array that may be cut off, like
 * `[{"a":1},{"b":2},{"c"`. Used to read the newest readings without the whole answer. */
export function leadingObjects(text) {
  const objects = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (inString) {
      if (char === "\\") i++;
      else if (char === '"') inString = false;
    } else if (char === '"') inString = true;
    else if (char === "{") {
      if (depth === 0) start = i;
      depth++;
    } else if (char === "}") {
      depth--;
      if (depth === 0) objects.push(JSON.parse(text.slice(start, i + 1)));
    }
  }
  return objects;
}

/** The marker icon for a species, by the genus of its Latin name; `generic` when unknown and
 * `sensor` for a sensor without an animal. The files are in assets/img/icons. */
const GENUS_ICONS = {
  canis: "canid",
  vulpes: "canid",
  bison: "bison",
  bos: "cow",
  capreolus: "deer",
  cervus: "red_deer",
  dama: "fallow_deer",
  sus: "wild_boar",
  meles: "badger",
  equus: "wild_horse",
  lepus: "hare",
  oryctolagus: "rabbit",
};

export function speciesIcon(latinName) {
  if (!latinName) return "sensor";
  const name = String(latinName).trim().toLowerCase();
  if (name === "canis lupus") return "wolf";
  return GENUS_ICONS[name.split(/\s+/)[0]] || "generic";
}

// ---------------------------------------------------------------------------------------------
// The database page: what WildlifeNL stores, read from its OpenAPI document

/** The groups of the database page, in the order they are drawn, with the tables in each and
 * a line in plain words per table. A table the API adds later lands in "Other". */
export const DATA_GROUPS = [
  {
    name: "Animals and sensors",
    tables: {
      Species: ["Species", "The kinds of animals WildlifeNL knows, with advice for people who meet one."],
      Animal: ["Animal", "One animal that carries a sensor, with its species and where it is now."],
      BorneSensorDeployment: ["Sensor deployment", "Which sensor is on which animal, and since when."],
      BorneSensorReading: ["Sensor reading", "One message from a collar: time, position, temperature, movement."],
      Detection: ["Detection", "A camera trap or other sensor saw one or more animals of a species."],
    },
  },
  {
    name: "People",
    tables: {
      User: ["User", "Someone with an account: a name and an ID."],
      Profile: ["Profile", "The personal details of a user and the roles the user has."],
      Role: ["Role", "What a user may do, such as herd manager or data system."],
      Credential: ["Login", "The token an app uses to act for a user."],
      TrackingReading: ["Tracking reading", "Where a user of the recreation app was at a moment."],
      Contact: ["Contact", "A user's phone was near an animal's sensor for some time."],
    },
  },
  {
    name: "Areas",
    tables: {
      LivingLab: ["Living lab", "A research area with its boundary."],
      Zone: ["Zone", "An area a user draws to be warned about certain species."],
      Visitation: ["Visits", "How busy each part of a living lab is with people."],
    },
  },
  {
    name: "Reports",
    tables: {
      Interaction: ["Report", "A person reports a sighting, damage or a collision with an animal."],
      InteractionType: ["Report type", "The kinds of reports: sighting, damage, collision."],
    },
  },
  {
    name: "Alarms and messages",
    tables: {
      Alarm: ["Alarm", "An animal, a detection or a report came inside a zone."],
      Message: ["Message", "A text of an experiment that is shown to people in a situation."],
      Conveyance: ["Sent message", "A message or alarm that was shown to a user."],
    },
  },
  {
    name: "Research",
    tables: {
      Experiment: ["Experiment", "A study in a living lab with a start and an end."],
      Questionnaire: ["Questionnaire", "A list of questions that belongs to an experiment."],
      Question: ["Question", "One question of a questionnaire."],
      Answer: ["Answer option", "One answer a person can pick for a question."],
      Response: ["Response", "What a person answered."],
    },
  },
];

function refName(schema) {
  if (!schema || typeof schema !== "object") return "";
  if (schema.$ref) return schema.$ref.split("/").pop();
  if (schema.items) return refName(schema.items);
  return "";
}

function isList(schema) {
  return [].concat(schema.type || []).includes("array");
}

/** A field or table name of the API in plain words: `locationTimestamp` is "Location timestamp". */
export function words(name) {
  const spaced = String(name).replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/ID$/, " ID").trim();
  return (spaced.charAt(0).toUpperCase() + spaced.slice(1).toLowerCase()).replace(/\bid\b/gi, "ID");
}

/** The kind of a field in words a person without a technical background reads. */
export function fieldKind(schema, label = (name) => words(name)) {
  const ref = refName(schema);
  if (ref === "Point") return isList(schema) ? "outline on the map" : "place on the map";
  if (ref) return isList(schema) ? `list of ${label(ref).toLowerCase()}s` : label(ref).toLowerCase();
  if (isList(schema)) return "list";
  if (schema.enum) return `one of: ${schema.enum.join(", ")}`;
  const type = [].concat(schema.type || []).find((t) => t !== "null");
  if (schema.format === "date-time") return "date and time";
  if (schema.format === "date") return "date";
  if (schema.format === "uuid") return "ID";
  if (schema.format === "email") return "email address";
  if (schema.format === "uri") return "web address";
  return { string: "text", integer: "whole number", number: "number", boolean: "yes or no", object: "details" }[type] || "text";
}

/**
 * What WildlifeNL stores, from its OpenAPI document: `{groups, tables, links}`.
 * A table is a schema that is neither an input (`…Record`, `…InputBody`), an error, nor a
 * small value inside another table (a schema without an ID that no call returns on its own,
 * like `Point`). A link is a field that points at another table, or an `…ID` field named
 * after one.
 */
export function databaseModel(openapi) {
  const schemas = (openapi.components && openapi.components.schemas) || {};
  const known = Object.assign({}, ...DATA_GROUPS.map((group) => group.tables));
  const returned = new Set();
  for (const path of Object.values(openapi.paths || {})) {
    for (const operation of Object.values(path)) {
      for (const response of Object.values(operation.responses || {})) {
        for (const content of Object.values(response.content || {})) returned.add(refName(content.schema));
      }
    }
  }
  const isTable = (name) => name in known || (!/(Record|InputBody)$/.test(name) && !/^Error/.test(name) && returned.has(name) && "ID" in (schemas[name].properties || {}));
  const names = Object.keys(schemas).filter(isTable);
  const label = (name) => (known[name] ? known[name][0] : words(name));

  const tables = names.map((name) => {
    const properties = schemas[name].properties || {};
    const fields = Object.entries(properties)
      .filter(([field, schema]) => field !== "$schema" && !schema.writeOnly)
      .map(([field, schema]) => ({ name: field, label: words(field), kind: fieldKind(schema, (ref) => (names.includes(ref) ? label(ref) : "Detail")), description: schema.description || "", link: names.includes(refName(schema)) ? refName(schema) : "" }));
    const groupIndex = DATA_GROUPS.findIndex((group) => name in group.tables);
    return { name, label: label(name), description: known[name] ? known[name][1] : "", group: groupIndex < 0 ? DATA_GROUPS.length : groupIndex, fields };
  });

  const links = [];
  const seen = new Set();
  const add = (from, to, many) => {
    const key = [from, to].sort().join("|");
    if (from === to || seen.has(key)) return;
    seen.add(key);
    links.push({ from, to, many });
  };
  for (const name of names) {
    for (const [field, schema] of Object.entries(schemas[name].properties || {})) {
      const ref = refName(schema);
      if (names.includes(ref)) add(name, ref, isList(schema));
      const byId = /^(.+)ID$/.exec(field);
      const target = byId && names.find((other) => other.toLowerCase() === byId[1].toLowerCase());
      if (target) add(name, target, false);
    }
  }
  const groups = DATA_GROUPS.map((group) => group.name);
  if (tables.some((table) => table.group === DATA_GROUPS.length)) groups.push("Other");
  const order = Object.keys(known);
  const rank = (name) => (order.includes(name) ? order.indexOf(name) : order.length + names.indexOf(name));
  tables.sort((a, b) => a.group - b.group || rank(a.name) - rank(b.name));
  return { groups, tables, links };
}

// ---------------------------------------------------------------------------------------------
// Detections: WildlifeNL answers within a circle around a point, so an area is searched
// circle by circle

const METRES_PER_DEGREE = 111320;

/** The centres of circles of `radius` metres that together cover the box
 * `{south, west, north, east}`: a honeycomb, the pattern that needs the fewest circles. */
export function circleGrid(box, radius) {
  const rowStep = (1.5 * radius) / METRES_PER_DEGREE;
  const centres = [];
  let row = 0;
  for (let lat = box.south; lat < box.north + rowStep; lat += rowStep, row++) {
    const colStep = (Math.sqrt(3) * radius) / (METRES_PER_DEGREE * Math.cos((Math.min(Math.abs(lat), 85) * Math.PI) / 180));
    for (let lng = box.west + (row % 2 ? colStep / 2 : 0); lng < box.east + colStep; lng += colStep) centres.push({ lat, lng });
  }
  return centres;
}

/** The fewest searches that reach every known place: a place within `radius` metres of an
 * earlier centre needs no search of its own. */
export function coverPlaces(places, radius) {
  const centres = [];
  for (const place of places) if (!centres.some((centre) => distanceMeters(centre, place) <= radius)) centres.push({ lat: place.lat, lng: place.lng });
  return centres;
}
