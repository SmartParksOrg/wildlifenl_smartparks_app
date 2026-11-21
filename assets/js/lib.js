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
