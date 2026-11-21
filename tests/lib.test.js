import assert from "node:assert/strict";
import { test } from "node:test";

import { ago, flatten, problemText, toCsv, toPoint, toTime, withinWindow } from "../assets/js/lib.js";

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

test("toPoint reads a reading and a detection", () => {
  const reading = toPoint({ sensorID: "A1", timestamp: "2026-11-21T10:00:00Z", location: { latitude: 52.1, longitude: 5.3 } });
  assert.deepEqual([reading.t, reading.lat, reading.lng], [T0, 52.1, 5.3]);
  assert.equal(reading.raw.sensorID, "A1");
  const detection = toPoint({ start: "2026-11-21T10:00:00Z", location: { latitude: 52.1, longitude: 5.3 } }, "start");
  assert.equal(detection.t, T0);
});

test("toPoint refuses records without a time or a location", () => {
  assert.equal(toPoint({ sensorID: "A1", timestamp: "2026-11-21T10:00:00Z", temperature: 12 }), null);
  assert.equal(toPoint({ location: { latitude: 52, longitude: 5 } }), null);
  assert.equal(toPoint({ timestamp: "2026-11-21T10:00:00Z", location: { latitude: 520, longitude: 5 } }), null);
  assert.equal(toPoint({ timestamp: "2026-11-21T10:00:00Z", location: { latitude: 52 } }), null);
  assert.equal(toPoint(null), null);
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
