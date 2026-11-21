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

/** Splits CSV text into rows of cells; handles quotes, commas or semicolons and CRLF. */
export function parseCsv(text) {
  const firstLine = text.slice(0, text.search(/\r?\n|$/));
  const separator = firstLine.split(";").length > firstLine.split(",").length ? ";" : ",";
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"') quoted = true;
    else if (char === separator) {
      row.push(cell);
      cell = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      if (row.some((c) => c !== "")) rows.push(row);
      row = [];
      cell = "";
    } else cell += char;
  }
  row.push(cell);
  if (row.some((c) => c !== "")) rows.push(row);
  return rows;
}

const TIME_KEYS = ["time", "timestamp", "recorded_at", "recordedat", "datetime", "date", "original_time", "start"];
const LAT_KEYS = ["lat", "latitude", "location.latitude", "location-lat", "y"];
const LNG_KEYS = ["lng", "lon", "long", "longitude", "location.longitude", "location-long", "x"];

function pick(row, keys) {
  for (const key of keys) {
    for (const name of Object.keys(row)) {
      if (name.toLowerCase() === key && row[name] !== "" && row[name] != null) return row[name];
    }
  }
  return undefined;
}

function validPoint(t, lat, lng) {
  return Number.isFinite(t) && Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
}

/** A point `{t, lat, lng, raw}` from one record of any of the shapes this app meets: a
 * WildlifeNL reading (`timestamp`, `location.latitude`), a Smart Parks Protect position
 * (`time`, `geometry` as a GeoJSON point), a GeoJSON feature, or a flat row with time,
 * latitude and longitude columns. Null when the record has no moment or no location. */
export function toPoint(record) {
  if (!record || typeof record !== "object") return null;
  let source = record;
  let geometry = record.geometry;
  if (record.type === "Feature") {
    source = { ...(record.properties || {}) };
    geometry = record.geometry;
  }
  let lat;
  let lng;
  if (geometry && geometry.type === "Point" && Array.isArray(geometry.coordinates)) {
    [lng, lat] = geometry.coordinates.map(Number);
  } else {
    const flat = flatten(source);
    lat = Number(pick(flat, LAT_KEYS));
    lng = Number(pick(flat, LNG_KEYS));
    if (pick(flat, LAT_KEYS) === undefined || pick(flat, LNG_KEYS) === undefined) return null;
  }
  const t = toTime(pick(flatten(source), TIME_KEYS));
  return validPoint(t, lat, lng) ? { t, lat, lng, raw: record } : null;
}

/** Positions from pasted or uploaded text: a JSON array, a paged answer (`items`), a GeoJSON
 * feature collection, or CSV with a header row. Returns the points and how many records had
 * no usable time or location. */
export function parsePositions(text) {
  const trimmed = String(text || "").trim();
  if (!trimmed) return { points: [], skipped: 0, format: "empty" };
  let records;
  let format;
  if (trimmed[0] === "[" || trimmed[0] === "{") {
    const json = JSON.parse(trimmed);
    format = "JSON";
    if (Array.isArray(json)) records = json;
    else if (Array.isArray(json.features)) {
      records = json.features;
      format = "GeoJSON";
    } else records = json.items || json.results || json.data || json.positions || [json];
  } else {
    const rows = parseCsv(trimmed);
    const header = rows.shift() || [];
    records = rows.map((cells) => Object.fromEntries(header.map((name, i) => [name.trim(), cells[i] ?? ""])));
    format = "CSV";
  }
  const points = records.map(toPoint).filter(Boolean);
  return { points, skipped: records.length - points.length, format };
}

/** Metres between two points on the sphere. */
export function distanceMeters(a, b) {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371008.8 * Math.asin(Math.min(1, Math.sqrt(h)));
}

export const STATUS = {
  match: "match",
  moved: "moved",
  missing: "missing",
  extra: "extra",
};

/**
 * Compares what Protect sent with what WildlifeNL holds. Both lists hold `{t, lat, lng}`.
 * Every Protect position is paired with the nearest unused WildlifeNL reading within
 * `toleranceSeconds`. A pair is a `match` when the locations agree within `toleranceMeters`,
 * otherwise `moved`. A Protect position without a pair is `missing` at WildlifeNL; a
 * WildlifeNL reading without a pair is `extra`.
 */
export function comparePositions(protect, wildlifenl, { toleranceSeconds = 1, toleranceMeters = 10 } = {}) {
  const sent = [...protect].sort((a, b) => a.t - b.t);
  const received = [...wildlifenl].sort((a, b) => a.t - b.t);
  const used = new Array(received.length).fill(false);
  const tolerance = toleranceSeconds * 1000;
  const rows = [];
  let low = 0;
  for (const position of sent) {
    while (low < received.length && received[low].t < position.t - tolerance) low++;
    let best = -1;
    for (let i = low; i < received.length && received[i].t <= position.t + tolerance; i++) {
      if (used[i]) continue;
      if (best < 0 || Math.abs(received[i].t - position.t) < Math.abs(received[best].t - position.t)) best = i;
    }
    if (best < 0) {
      rows.push({ status: STATUS.missing, t: position.t, protect: position, wildlifenl: null, distance: null, timeDelta: null });
      continue;
    }
    used[best] = true;
    const reading = received[best];
    const distance = distanceMeters(position, reading);
    rows.push({
      status: distance <= toleranceMeters ? STATUS.match : STATUS.moved,
      t: position.t,
      protect: position,
      wildlifenl: reading,
      distance,
      timeDelta: (reading.t - position.t) / 1000,
    });
  }
  received.forEach((reading, i) => {
    if (!used[i]) rows.push({ status: STATUS.extra, t: reading.t, protect: null, wildlifenl: reading, distance: null, timeDelta: null });
  });
  rows.sort((a, b) => b.t - a.t);
  const counts = { match: 0, moved: 0, missing: 0, extra: 0 };
  for (const row of rows) counts[row.status]++;
  return { rows, counts, sent: sent.length, received: received.length };
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

/** The value of a `datetime-local` input for a moment, in the browser's time zone. */
export function toLocalInput(t) {
  const d = new Date(t);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
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
