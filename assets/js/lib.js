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

/** The page and its parameters from a location hash like `#/sensors/A1?range=168`. */
export function parseHash(hash) {
  const [path, query = ""] = String(hash || "").replace(/^#\/?/, "").split("?");
  const parts = path.split("/").filter(Boolean).map(decodeURIComponent);
  return { page: parts[0] || "", id: parts[1] || "", query: Object.fromEntries(new URLSearchParams(query)) };
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
