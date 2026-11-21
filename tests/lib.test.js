import assert from "node:assert/strict";
import { test } from "node:test";

import { STATUS, ago, comparePositions, distanceMeters, flatten, parseCsv, parsePositions, problemText, toCsv, toPoint, toTime, withinWindow } from "../assets/js/lib.js";

const T0 = Date.parse("2026-11-21T10:00:00Z");

test("toTime reads ISO text, seconds and milliseconds", () => {
  assert.equal(toTime("2026-11-21T10:00:00Z"), T0);
  assert.equal(toTime(T0 / 1000), T0);
  assert.equal(toTime(String(T0)), T0);
  assert.ok(Number.isNaN(toTime("")));
  assert.ok(Number.isNaN(toTime("not a date")));
});

test("flatten gives dotted keys, keeps arrays and drops $schema", () => {
  assert.deepEqual(flatten({ $schema: "x", a: 1, location: { latitude: 52, longitude: 5 }, list: [1, 2] }), {
    a: 1,
    "location.latitude": 52,
    "location.longitude": 5,
    list: [1, 2],
  });
});

test("toCsv quotes commas, quotes and line breaks", () => {
  assert.equal(toCsv([{ a: 'say "hi"', b: "x,y" }, { a: null, b: [1] }]), 'a,b\n"say ""hi""","x,y"\n,[1]');
});

test("parseCsv handles quotes, semicolons and CRLF", () => {
  assert.deepEqual(parseCsv('a,b\r\n"1,5","two ""x"""\r\n'), [
    ["a", "b"],
    ["1,5", 'two "x"'],
  ]);
  assert.deepEqual(parseCsv("a;b\n1;2"), [
    ["a", "b"],
    ["1", "2"],
  ]);
});

test("toPoint reads a WildlifeNL reading", () => {
  const point = toPoint({ sensorID: "A1", timestamp: "2026-11-21T10:00:00Z", location: { latitude: 52.1, longitude: 5.3 } });
  assert.deepEqual([point.t, point.lat, point.lng], [T0, 52.1, 5.3]);
});

test("toPoint reads a Protect position and a GeoJSON feature", () => {
  const position = toPoint({ time: "2026-11-21T10:00:00Z", geometry: { type: "Point", coordinates: [5.3, 52.1] } });
  assert.deepEqual([position.t, position.lat, position.lng], [T0, 52.1, 5.3]);
  const feature = toPoint({ type: "Feature", properties: { time: "2026-11-21T10:00:00Z" }, geometry: { type: "Point", coordinates: [5.3, 52.1] } });
  assert.deepEqual([feature.t, feature.lat, feature.lng], [T0, 52.1, 5.3]);
});

test("toPoint refuses records without a time or a location", () => {
  assert.equal(toPoint({ sensorID: "A1", timestamp: "2026-11-21T10:00:00Z", temperature: 12 }), null);
  assert.equal(toPoint({ latitude: 52, longitude: 5 }), null);
  assert.equal(toPoint({ time: "2026-11-21T10:00:00Z", latitude: 520, longitude: 5 }), null);
  assert.equal(toPoint(null), null);
});

test("parsePositions reads JSON arrays, paged answers, GeoJSON and CSV", () => {
  const json = parsePositions('[{"time":"2026-11-21T10:00:00Z","geometry":{"type":"Point","coordinates":[5.3,52.1]}},{"time":"x"}]');
  assert.equal(json.points.length, 1);
  assert.equal(json.skipped, 1);
  const paged = parsePositions('{"items":[{"timestamp":"2026-11-21T10:00:00Z","latitude":52.1,"longitude":5.3}]}');
  assert.equal(paged.points.length, 1);
  const geo = parsePositions('{"type":"FeatureCollection","features":[{"type":"Feature","properties":{"time":"2026-11-21T10:00:00Z"},"geometry":{"type":"Point","coordinates":[5.3,52.1]}}]}');
  assert.equal(geo.format, "GeoJSON");
  assert.equal(geo.points[0].lat, 52.1);
  const csv = parsePositions("Time,Latitude,Longitude\n2026-11-21T10:00:00Z,52.1,5.3\n2026-11-21T11:00:00Z,,\n");
  assert.equal(csv.format, "CSV");
  assert.equal(csv.points.length, 1);
  assert.equal(csv.skipped, 1);
  assert.throws(() => parsePositions("[not json"));
});

test("distanceMeters is close to the known length of a degree", () => {
  const metres = distanceMeters({ lat: 52, lng: 5 }, { lat: 53, lng: 5 });
  assert.ok(Math.abs(metres - 111195) < 100, String(metres));
  assert.equal(distanceMeters({ lat: 52, lng: 5 }, { lat: 52, lng: 5 }), 0);
});

test("comparePositions finds matches, moved, missing and extra", () => {
  const at = (minutes, lat = 52.1, lng = 5.3) => ({ t: T0 + minutes * 60000, lat, lng });
  const protect = [at(0), at(10), at(20), at(30)];
  const wildlifenl = [
    { ...at(0), t: T0 + 400 }, // same fix, stored 0.4 s later
    at(10, 52.2, 5.3), // same time, 11 km away
    at(30),
    at(45), // Protect never sent this one
  ];
  const result = comparePositions(protect, wildlifenl);
  assert.deepEqual(result.counts, { match: 2, moved: 1, missing: 1, extra: 1 });
  assert.equal(result.sent, 4);
  assert.equal(result.received, 4);
  const byStatus = Object.fromEntries(result.rows.map((row) => [row.status, row]));
  assert.equal(byStatus[STATUS.missing].t, T0 + 20 * 60000);
  assert.equal(byStatus[STATUS.extra].t, T0 + 45 * 60000);
  assert.ok(byStatus[STATUS.moved].distance > 11000);
  assert.deepEqual(
    result.rows.map((row) => row.t),
    [...result.rows.map((row) => row.t)].sort((a, b) => b - a),
  );
});

test("comparePositions uses each reading once and honours the tolerances", () => {
  const a = { t: T0, lat: 52.1, lng: 5.3 };
  const twice = comparePositions([a, { ...a }], [{ ...a }]);
  assert.deepEqual(twice.counts, { match: 1, moved: 0, missing: 1, extra: 0 });
  const late = [{ ...a, t: T0 + 5000 }];
  assert.equal(comparePositions([a], late, { toleranceSeconds: 1 }).counts.missing, 1);
  assert.equal(comparePositions([a], late, { toleranceSeconds: 10 }).counts.match, 1);
  const near = [{ ...a, lat: 52.1002 }]; // about 22 m north
  assert.equal(comparePositions([a], near, { toleranceMeters: 10 }).counts.moved, 1);
  assert.equal(comparePositions([a], near, { toleranceMeters: 50 }).counts.match, 1);
});

test("comparePositions pairs with the nearest reading in time", () => {
  const a = { t: T0, lat: 52.1, lng: 5.3 };
  const result = comparePositions([a], [{ ...a, t: T0 - 900 }, { ...a, t: T0 + 100 }]);
  assert.equal(result.rows.find((row) => row.status === STATUS.match).timeDelta, 0.1);
  assert.equal(result.counts.extra, 1);
});

test("withinWindow keeps both bounds and treats a missing bound as open", () => {
  const items = [{ t: 1 }, { t: 2 }, { t: 3 }];
  assert.deepEqual(withinWindow(items, 2, 3), [{ t: 2 }, { t: 3 }]);
  assert.deepEqual(withinWindow(items, NaN, 1), [{ t: 1 }]);
  assert.deepEqual(withinWindow(items, NaN, NaN).length, 3);
});

test("ago describes the past in the largest unit", () => {
  assert.equal(ago(T0 - 30 * 1000, T0), "just now");
  assert.equal(ago(T0 - 5 * 60 * 1000, T0), "5 minutes ago");
  assert.equal(ago(T0 - 3600 * 1000, T0), "1 hour ago");
  assert.equal(ago(T0 - 3 * 86400 * 1000, T0), "3 days ago");
  assert.equal(ago(NaN, T0), "");
});

test("problemText prefers the server's own explanation", () => {
  assert.equal(problemText(401, { title: "Unauthorized", status: 401, detail: "Invalid bearer token." }), "Invalid bearer token.");
  assert.equal(problemText(422, { title: "Unprocessable Entity", errors: [{ location: "body.email", message: "expected string to be RFC 5322 email" }] }), "Unprocessable Entity body.email: expected string to be RFC 5322 email");
  assert.equal(problemText(400, { detail: "LOGIN_BAD_CREDENTIALS" }), "LOGIN_BAD_CREDENTIALS");
  assert.equal(problemText(502, "<html>Bad gateway</html>"), "<html>Bad gateway</html>");
  assert.equal(problemText(500, null), "The server answered 500");
});
