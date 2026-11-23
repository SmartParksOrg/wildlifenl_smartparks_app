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
  const spaced = String(name).replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/\s*ID$/, " ID").trim();
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

/** WildlifeNL does not measure the radius of a search over the ground: it takes a metre as
 * 0.00001 degree, north to south and east to west alike (`models/Circle.go` in its source).
 * A radius of 10 km is therefore 0.1 degree around the point, which in the Netherlands is
 * 11 km to the north and south but under 7 km to the east and west. */
const DEGREES_PER_METRE = 0.00001;

/** The centres of searches of `radius` metres that together cover the box
 * `{south, west, north, east}`: a honeycomb, the pattern that needs the fewest circles. */
export function circleGrid(box, radius) {
  const reach = radius * DEGREES_PER_METRE;
  const rowStep = 1.5 * reach;
  const colStep = Math.sqrt(3) * reach;
  const centres = [];
  let row = 0;
  for (let lat = box.south; lat < box.north + rowStep; lat += rowStep, row++) {
    for (let lng = box.west + (row % 2 ? colStep / 2 : 0); lng < box.east + colStep; lng += colStep) centres.push({ lat, lng });
  }
  return centres;
}

/** The fewest searches that reach every known place: a place a search of `radius` metres
 * around an earlier centre reaches needs no search of its own. */
export function coverPlaces(places, radius) {
  const reach = radius * DEGREES_PER_METRE;
  const centres = [];
  for (const place of places) if (!centres.some((centre) => Math.hypot(centre.lat - place.lat, centre.lng - place.lng) <= reach)) centres.push({ lat: place.lat, lng: place.lng });
  return centres;
}

/** The sensor deployment that says which sensor an animal carries: the one that has not
 * ended, else the one that started last; null for an animal without one. */
export function sensorOfAnimal(animal) {
  const deployments = ((animal && animal.borneSensorDeployments) || []).filter((deployment) => deployment && deployment.sensorID);
  const newestFirst = [...deployments].sort((a, b) => toTime(b.start) - toTime(a.start));
  return newestFirst.find((deployment) => !deployment.end) || newestFirst[0] || null;
}

// ---------------------------------------------------------------------------------------------
// Writing: which calls the API offers, who may make them and the form of a call

/** Every call of the API from its OpenAPI document: `{method, path, summary, roles, open,
 * body}`. `roles` are the roles that may make the call, none meaning every signed-in account;
 * `open` says the call needs no token; `body` is the name of the schema it takes. */
export function apiOperations(openapi) {
  const operations = [];
  for (const [path, item] of Object.entries(openapi.paths || {})) {
    for (const [method, operation] of Object.entries(item)) {
      if (!["get", "post", "put", "patch", "delete"].includes(method)) continue;
      const security = operation.security || openapi.security || [];
      const content = (operation.requestBody && operation.requestBody.content) || {};
      operations.push({
        method: method.toUpperCase(),
        path,
        summary: operation.summary || "",
        roles: [...new Set(security.flatMap((need) => Object.values(need).flat()))],
        open: !security.some((need) => Object.keys(need).some(Boolean)),
        body: refName((content["application/json"] || Object.values(content)[0] || {}).schema),
      });
    }
  }
  return operations;
}

/** The summary of a call in the words of this app: "Add BorneSensorDeployment" is
 * "Add sensor deployment". */
export function operationLabel(summary) {
  const text = String(summary)
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .replace(/\binteraction type\b/g, "report type")
    .replace(/\binteraction\b/g, "report")
    .replace(/\bborne sensor\b/g, "sensor")
    .replace(/\bnew living lab\b/g, "living lab")
    .replace(/\s+/g, " ")
    .trim();
  return text.charAt(0).toUpperCase() + text.slice(1);
}

const LONG_TEXTS = ["description", "text", "notes", "advice", "behaviour", "roleInNature"];

function fieldOf(schemas, name, schema, required) {
  const ref = refName(schema);
  const types = [].concat(schema.type || []);
  const type = types.find((t) => t !== "null") || "";
  const field = { name, label: words(name), required, nullable: types.includes("null"), description: schema.description || "" };
  if (ref === "Point") return { ...field, kind: isList(schema) ? "outline" : "point" };
  if (ref && schemas[ref]) return { ...field, kind: isList(schema) ? "list" : "group", fields: schemaFields(schemas, ref) };
  if (schema.enum) return { ...field, kind: "choice", options: schema.enum.filter((option) => option != null) };
  if (type === "boolean") return { ...field, kind: "yesno" };
  if (type === "integer" || type === "number") return { ...field, kind: type, min: schema.minimum, max: schema.maximum };
  const kind = { "date-time": "moment", date: "date", email: "email", uri: "url" }[schema.format] || (LONG_TEXTS.includes(name) ? "longtext" : "text");
  return { ...field, kind, minLength: schema.minLength, pattern: schema.pattern };
}

function schemaFields(schemas, schemaName) {
  const schema = schemas[schemaName] || {};
  const required = schema.required || [];
  return Object.entries(schema.properties || {})
    .filter(([name, property]) => name !== "$schema" && !property.readOnly)
    .map(([name, property]) => fieldOf(schemas, name, property, required.includes(name)));
}

/**
 * The fields of the form for a schema of the API, without the ones only the API sets. A field
 * is `{name, label, kind, required, nullable, description}` and, by kind, `options`, `min`,
 * `max`, `minLength`, `pattern` or `fields`. The kinds: `text`, `longtext`, `email`, `url`,
 * `integer`, `number`, `yesno`, `choice`, `moment`, `date`, `point`, `outline` (a list of
 * points), `group` (details with fields of their own) and `list` (several such details).
 * A form can also hold a field of the kind `ticks`, several of a list of choices, which no
 * schema of the API asks for but a question of a questionnaire does.
 */
export function formFields(openapi, schemaName) {
  return schemaFields((openapi.components && openapi.components.schemas) || {}, schemaName);
}

/** A moment of the API as the value of a `datetime-local` input, in the time of the device. */
export function localInput(moment) {
  const t = toTime(moment);
  if (!Number.isFinite(t)) return "";
  return new Date(t - new Date(t).getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

/** What a form shows for a record: per field its value, where `speciesID` is also found as
 * the ID of `species`, the way the API returns what it takes. */
export function formValues(fields, record) {
  const values = {};
  for (const field of fields) {
    let value = record ? record[field.name] : undefined;
    const inner = /^(.+)ID$/.exec(field.name);
    if (value == null && inner && record && record[inner[1]] && typeof record[inner[1]] === "object") value = record[inner[1]].ID;
    if (value == null) continue;
    if (field.kind === "group") values[field.name] = formValues(field.fields, value);
    else if (field.kind === "list") values[field.name] = [].concat(value).map((item) => formValues(field.fields, item));
    else values[field.name] = value;
  }
  return values;
}

function empty(value) {
  return value == null || value === "" || (typeof value === "number" && Number.isNaN(value));
}

function valueOf(field, value) {
  if (field.kind === "yesno") return Boolean(value);
  if (field.kind === "ticks") return Array.isArray(value) && value.length ? value : undefined;
  if (field.kind === "group") return value ? formBody(field.fields, value) : undefined;
  if (field.kind === "list") return Array.isArray(value) ? value.map((item) => formBody(field.fields, item)) : undefined;
  if (field.kind === "outline") return Array.isArray(value) && value.length ? value.map((point) => ({ latitude: Number(point.latitude), longitude: Number(point.longitude) })) : undefined;
  if (field.kind === "point") {
    if (!value || (empty(value.latitude) && empty(value.longitude))) return undefined;
    const point = { latitude: Number(value.latitude), longitude: Number(value.longitude) };
    if (empty(value.latitude) || empty(value.longitude) || !Number.isFinite(point.latitude) || !Number.isFinite(point.longitude)) throw new Error(`${field.label} needs a latitude and a longitude.`);
    return point;
  }
  if (empty(value)) return undefined;
  if (field.kind === "integer" || field.kind === "number") {
    const number = Number(value);
    if (!Number.isFinite(number) || (field.kind === "integer" && !Number.isInteger(number))) throw new Error(`${field.label} must be a ${field.kind === "integer" ? "whole " : ""}number.`);
    return number;
  }
  if (field.kind === "moment") {
    const t = toTime(value);
    if (!Number.isFinite(t)) throw new Error(`${field.label} is not a date and time.`);
    return new Date(t).toISOString();
  }
  return typeof value === "string" ? value.trim() : value;
}

/**
 * The body of a call from what a form holds: numbers as numbers, moments in UTC, and an empty
 * field left out. Where the API asks for a field and accepts it empty, it is sent as `null`
 * or as an empty text. Any other field the API needs throws an error a person can read.
 */
export function formBody(fields, values) {
  const body = {};
  for (const field of fields) {
    const value = valueOf(field, values ? values[field.name] : undefined);
    if (value !== undefined && value !== "") body[field.name] = value;
    else if (field.required && field.nullable && field.kind !== "outline") body[field.name] = null;
    else if (field.required && ["text", "longtext"].includes(field.kind) && !field.minLength) body[field.name] = "";
    else if (field.required) throw new Error(`${field.label} is needed.`);
  }
  return body;
}

// ---------------------------------------------------------------------------------------------
// Answering a questionnaire: the order of its questions and what goes to the API

const byIndex = (a, b) => (a.index || 0) - (b.index || 0);

/** The questions of a questionnaire in the order they are asked. */
export function questionOrder(questions) {
  return [...(questions || [])].sort(byIndex);
}

/**
 * The next question to ask, or null when the questionnaire is done. `answered` holds per
 * question ID the IDs of the answer options that were picked (none for an open answer).
 * After a question the next one in order follows, unless a picked answer option jumps to a
 * later question; of several picked options the first in order with such a jump decides.
 * A jump back is not followed, so a questionnaire always ends.
 */
export function openQuestion(questions, answered) {
  const order = questionOrder(questions);
  let at = 0;
  while (at < order.length) {
    const question = order[at];
    const picked = answered[question.ID];
    if (!picked) return question;
    const jump = [...(question.answers || [])]
      .sort(byIndex)
      .filter((answer) => picked.includes(answer.ID) && answer.nextQuestionID)
      .map((answer) => order.findIndex((other) => other.ID === answer.nextQuestionID))
      .find((target) => target > at);
    at = jump === undefined ? at + 1 : jump;
  }
  return null;
}

/** What was answered for a report, as `openQuestion` takes it, from the account's responses. */
export function answeredOf(responses, interactionID) {
  const answered = {};
  for (const response of responses || []) {
    const interaction = response.interactionID || (response.interaction && response.interaction.ID);
    const question = response.questionID || (response.question && response.question.ID);
    if (String(interaction) !== String(interactionID) || !question) continue;
    const answer = response.answerID || (response.answer && response.answer.ID);
    answered[question] = [...(answered[question] || []), ...(answer ? [answer] : [])];
  }
  return answered;
}

/**
 * The responses to send for one question: one per picked answer option. WildlifeNL only takes
 * a text of its own for a question with at most one answer option, so with picked options
 * the text goes along with the first.
 */
export function responseBodies(question, interactionID, picked, text) {
  const words = String(text || "").trim();
  const base = { interactionID, questionID: question.ID };
  if (picked.length) return picked.map((answerID, index) => ({ ...base, answerID, ...(index === 0 && words ? { text: words } : {}) }));
  if (!words) throw new Error("Give an answer first.");
  return [{ ...base, text: words }];
}

// ---------------------------------------------------------------------------------------------
// Research: the state of an experiment and what a questionnaire needs

/** Where an experiment stands: `upcoming` before its start, `completed` after its end, and
 * `live` in between; one without an end stays live. */
export function experimentStatus(experiment, now = Date.now()) {
  if (toTime(experiment.start) > now) return "upcoming";
  return toTime(experiment.end) <= now ? "completed" : "live";
}

/**
 * Why an experiment, and what hangs under it, cannot be changed by this account: a sentence,
 * or an empty text when it can. WildlifeNL only lets the owner change an experiment, and
 * only before it starts.
 */
export function whyLocked(experiment, userID, now = Date.now()) {
  const owner = experiment.user;
  if (owner && String(owner.ID) !== String(userID)) return `This experiment belongs to ${owner.name || "someone else"}. Only its owner can change it.`;
  const status = experimentStatus(experiment, now);
  if (status === "live") return "This experiment is live. WildlifeNL only takes changes to an experiment, its questionnaires and its messages before it starts. You can end it.";
  if (status === "completed") return "This experiment has ended and cannot be changed.";
  return "";
}

/** What an upcoming experiment still misses, as sentences; none when it is ready to start.
 * `questionnaires` carry their questions with answer options. */
export function readiness(questionnaires, messages) {
  const missing = [];
  if (!questionnaires.length && !messages.length) missing.push("It has no questionnaire and no message yet, so it would do nothing.");
  for (const questionnaire of questionnaires) {
    const questions = questionOrder(questionnaire.questions);
    if (!questions.length) missing.push(`The questionnaire "${questionnaire.name}" has no questions.`);
    for (const question of questions) {
      if (!(question.answers || []).length && !question.allowOpenResponse) missing.push(`Question ${question.index} of "${questionnaire.name}" has no answer options and takes no text, so nobody can answer it.`);
    }
  }
  return missing;
}

/**
 * What to send to copy the questions of a questionnaire: per question its body without the
 * questionnaire it goes to, and per answer option its body with `of` and `next`, the IDs of
 * the question it belongs to and jumps to in the original. The new IDs are only known once
 * the questions are made. A jump out of the questionnaire is dropped.
 */
export function copyBodies(questionnaire) {
  const questions = questionOrder(questionnaire.questions);
  const ids = new Set(questions.map((question) => question.ID));
  return {
    questions: questions.map((question) => ({
      from: question.ID,
      body: { text: question.text, description: question.description || "", index: question.index, allowMultipleResponse: Boolean(question.allowMultipleResponse), allowOpenResponse: Boolean(question.allowOpenResponse), ...(question.openResponseFormat ? { openResponseFormat: question.openResponseFormat } : {}) },
    })),
    answers: questions.flatMap((question) => [...(question.answers || [])].sort(byIndex).map((answer) => ({ of: question.ID, next: ids.has(answer.nextQuestionID) ? answer.nextQuestionID : null, body: { text: answer.text, index: answer.index } }))),
  };
}


/** All readings of a sensor after a refresh, newest first as the API answers. `older` is what
 * was loaded before; `newer` the newest part of the answer, `complete` when that part was the
 * whole answer. A reading that is in both is kept once, also one that arrived late with an
 * older moment. When `newer` does not reach back to the newest of `older`, readings in
 * between are missing and the answer is null: everything has to be read again. */
export function mergeReadings(older, newer, complete) {
  if (complete) return newer;
  const times = (list) => list.map((reading) => toTime(reading.timestamp)).filter(Number.isFinite);
  const newestOlder = Math.max(...times(older));
  const oldestNewer = Math.min(...times(newer));
  if (!(oldestNewer <= newestOlder)) return null;
  // only the older readings in the window of `newer` can be in both
  const known = new Set(older.filter((reading) => !(toTime(reading.timestamp) < oldestNewer)).map((reading) => JSON.stringify(reading)));
  const added = newer.filter((reading) => !known.has(JSON.stringify(reading)));
  if (!added.length) return older;
  const time = (reading) => {
    const t = toTime(reading.timestamp);
    return Number.isFinite(t) ? t : -Infinity;
  };
  return [...added, ...older].sort((a, b) => time(b) - time(a));
}

/** When the next refresh comes, in a few words: "in 45 seconds", "in 2 minutes". */
export function countdownText(ms) {
  const seconds = Math.max(0, Math.ceil(ms / 1000));
  if (seconds <= 1) return "now";
  if (seconds < 90) return `in ${seconds} seconds`;
  return `in ${Math.round(seconds / 60)} minutes`;
}
