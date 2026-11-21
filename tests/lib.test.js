import assert from "node:assert/strict";
import { test } from "node:test";

import { BUCKETS, ago, circleGrid, countPerDay, coverPlaces, databaseModel, fieldKind, speciesIcon, autoBucket, bucketSeries, buildHash, distanceMeters, flatten, formatDistance, leadingObjects, metricSeries, parseHash, problemText, toCsv, toPoint, toTime, trackLength, trackOf, withinWindow } from "../assets/js/lib.js";

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

const reading = (minutes, extra) => ({ sensorID: "A1", timestamp: new Date(T0 + minutes * 60000).toISOString(), ...extra });

test("distanceMeters is close to the known length of a degree", () => {
  const metres = distanceMeters({ lat: 52, lng: 5 }, { lat: 53, lng: 5 });
  assert.ok(Math.abs(metres - 111195) < 100, String(metres));
  assert.equal(distanceMeters({ lat: 52, lng: 5 }, { lat: 52, lng: 5 }), 0);
});

test("trackOf keeps located readings in time order and trackLength adds the legs", () => {
  const track = trackOf([
    reading(20, { location: { latitude: 52.02, longitude: 5 } }),
    reading(10, { temperature: 11 }),
    reading(0, { location: { latitude: 52, longitude: 5 } }),
    reading(10, { location: { latitude: 52.01, longitude: 5 } }),
  ]);
  assert.deepEqual(track.map((p) => p.lat), [52, 52.01, 52.02]);
  assert.ok(Math.abs(trackLength(track) - 2224) < 5, String(trackLength(track)));
  assert.equal(trackLength([]), 0);
});

test("metricSeries reads values, skips readings without one and sorts by time", () => {
  const readings = [reading(10, { temperature: 12 }), reading(0, { temperature: 10 }), reading(5, { altitude: 3 }), reading(7, { accelero: { x: 1, y: 2, z: 3 } })];
  assert.deepEqual(metricSeries(readings, "temperature"), [[T0, 10], [T0 + 600000, 12]]);
  assert.deepEqual(metricSeries(readings, "accelero.z"), [[T0 + 420000, 3]]);
  assert.deepEqual(metricSeries(readings, "altitude"), [[T0 + 300000, 3]]);
});

test("metricSeries derives speed from fixes in a row", () => {
  const readings = [reading(0, { location: { latitude: 52, longitude: 5 } }), reading(60, { location: { latitude: 52.01, longitude: 5 } }), reading(60, { location: { latitude: 52.01, longitude: 5 } })];
  const speed = metricSeries(readings, "speed");
  assert.equal(speed.length, 1); // the second fix at the same moment gives no speed
  assert.equal(speed[0][0], T0 + 3600000);
  assert.ok(Math.abs(speed[0][1] - 1.112) < 0.01, String(speed[0][1]));
});

test("bucketSeries takes the mean per bucket and passes raw data through", () => {
  const series = [[T0, 10], [T0 + 60000, 20], [T0 + 3600000, 7]];
  assert.deepEqual(bucketSeries(series, BUCKETS["1h"]), [[T0, 15], [T0 + 3600000, 7]]);
  assert.equal(bucketSeries(series, BUCKETS.raw), series);
});

test("autoBucket widens with the period", () => {
  const day = 86400000;
  assert.equal(autoBucket(day), "raw");
  assert.equal(autoBucket(7 * day), "15m");
  assert.equal(autoBucket(30 * day), "1h");
  assert.equal(autoBucket(90 * day), "6h");
  assert.equal(autoBucket(Infinity), "1d");
});

test("parseHash and buildHash agree", () => {
  assert.deepEqual(parseHash("#/sensors/70B3%2F1?range=168&track=1"), { page: "sensors", id: "70B3/1", query: { range: "168", track: "1" } });
  assert.deepEqual(parseHash(""), { page: "", id: "", query: {} });
  assert.equal(buildHash("sensors", "70B3/1", { range: 168, empty: "" }), "#/sensors/70B3%2F1?range=168");
  assert.equal(buildHash("map"), "#/map");
  const hash = buildHash("explore", "", { sensors: "A,B", metrics: "temperature" });
  assert.deepEqual(parseHash(hash).query, { sensors: "A,B", metrics: "temperature" });
});

test("formatDistance picks metres or kilometres", () => {
  assert.equal(formatDistance(340.4), "340 m");
  assert.equal(formatDistance(1234), "1.2 km");
  assert.equal(formatDistance(45678), "46 km");
  assert.equal(formatDistance(NaN), "");
});

test("leadingObjects reads the whole objects of a cut-off array", () => {
  const full = JSON.stringify([{ a: 1, nested: { b: "x}y" } }, { c: 'quote " and brace {' }, { d: [1, { e: 2 }] }]);
  assert.equal(leadingObjects(full).length, 3);
  assert.deepEqual(leadingObjects(full.slice(0, full.indexOf('{"d"') + 8)), [{ a: 1, nested: { b: "x}y" } }, { c: 'quote " and brace {' }]);
  assert.deepEqual(leadingObjects('[{"a":1},{"b":"cut'), [{ a: 1 }]);
  assert.deepEqual(leadingObjects("null"), []);
  assert.deepEqual(leadingObjects(""), []);
});

test("speciesIcon picks an icon by the Latin name", () => {
  assert.equal(speciesIcon("Canis lupus"), "wolf");
  assert.equal(speciesIcon("Canis aureus"), "canid");
  assert.equal(speciesIcon("Vulpes vulpes"), "canid");
  assert.equal(speciesIcon("Sus scrofa"), "wild_boar");
  assert.equal(speciesIcon(" Bos taurus "), "cow");
  assert.equal(speciesIcon("Castor fiber"), "generic");
  assert.equal(speciesIcon(""), "sensor");
});

test("fieldKind describes a field in plain words", () => {
  assert.equal(fieldKind({ type: "string", format: "date-time" }), "date and time");
  assert.equal(fieldKind({ type: "string", format: "uuid" }), "ID");
  assert.equal(fieldKind({ type: ["string", "null"], enum: ["visual", "acoustic"] }), "one of: visual, acoustic");
  assert.equal(fieldKind({ type: "number", format: "double" }), "number");
  assert.equal(fieldKind({ type: "boolean" }), "yes or no");
  assert.equal(fieldKind({ $ref: "#/components/schemas/Point" }), "place on the map");
  assert.equal(fieldKind({ type: ["array", "null"], items: { $ref: "#/components/schemas/Point" } }), "outline on the map");
  assert.equal(fieldKind({ type: ["array", "null"], items: { $ref: "#/components/schemas/BorneSensorReading" } }, () => "Sensor reading"), "list of sensor readings");
});

test("databaseModel finds the tables, their fields and their links", () => {
  const ref = (name) => ({ $ref: `#/components/schemas/${name}` });
  const model = databaseModel({
    paths: { "/gadget/{id}": { get: { responses: { 200: { content: { "application/json": { schema: ref("Gadget") } } } } } } },
    components: {
      schemas: {
        Point: { properties: { latitude: { type: "number" }, longitude: { type: "number" } } },
        Species: { properties: { ID: { type: "string", format: "uuid" }, name: { type: "string", description: "The Latin binomen." } } },
        Animal: { properties: { $schema: { type: "string" }, ID: { type: "string", format: "uuid" }, species: ref("Species"), speciesID: { type: "string", writeOnly: true }, location: ref("Point") } },
        AnimalRecord: { properties: { ID: { type: "string" } } },
        BorneSensorDeployment: { properties: { sensorID: { type: "string" }, animal: ref("Animal"), borneSensorReadings: { type: ["array", "null"], items: ref("BorneSensorReading") } } },
        BorneSensorReading: { properties: { sensorID: { type: "string" }, userID: { type: "string" }, location: ref("Point") } },
        User: { properties: { ID: { type: "string" }, name: { type: "string" } } },
        Gadget: { properties: { ID: { type: "string" }, userID: { type: "string" } } },
        ErrorModel: { properties: { ID: { type: "string" } } },
      },
    },
  });
  assert.deepEqual(model.tables.map((t) => t.name), ["Species", "Animal", "BorneSensorDeployment", "BorneSensorReading", "User", "Gadget"]);
  assert.deepEqual(model.groups, ["Animals and sensors", "People", "Areas", "Reports", "Alarms and messages", "Research", "Other"]);
  const animal = model.tables.find((t) => t.name === "Animal");
  assert.equal(animal.label, "Animal");
  assert.deepEqual(animal.fields.map((f) => [f.name, f.kind, f.link]), [["ID", "ID", ""], ["species", "species", "Species"], ["location", "place on the map", ""]]);
  assert.equal(model.tables.find((t) => t.name === "Gadget").group, 6);
  assert.equal(model.tables.find((t) => t.name === "Species").fields[1].description, "The Latin binomen.");
  const pairs = model.links.map((l) => `${l.from}>${l.to}${l.many ? "*" : ""}`).sort();
  assert.deepEqual(pairs, ["Animal>Species", "BorneSensorDeployment>Animal", "BorneSensorDeployment>BorneSensorReading*", "BorneSensorReading>User", "Gadget>User"]);
});

test("circleGrid covers the whole box", () => {
  const box = { south: 52.0, west: 5.0, north: 52.5, east: 6.0 };
  const radius = 10000;
  const centres = circleGrid(box, radius);
  assert.ok(centres.length > 10 && centres.length < 40, String(centres.length));
  for (let lat = box.south; lat <= box.north; lat += 0.02) {
    for (let lng = box.west; lng <= box.east; lng += 0.02) {
      const nearest = Math.min(...centres.map((c) => distanceMeters(c, { lat, lng })));
      assert.ok(nearest <= radius, `(${lat}, ${lng}) is ${Math.round(nearest)} m from a centre`);
    }
  }
  assert.equal(circleGrid({ south: 52, west: 5, north: 52.001, east: 5.001 }, radius).length >= 1, true);
});

test("coverPlaces needs one search for places close together", () => {
  const haarlem = { lat: 52.39, lng: 4.59 };
  const near = { lat: 52.4, lng: 4.6 };
  const utrecht = { lat: 52.09, lng: 5.12 };
  assert.deepEqual(coverPlaces([haarlem, near, utrecht], 9000), [haarlem, utrecht]);
  assert.deepEqual(coverPlaces([], 9000), []);
});

test("countPerDay counts per local day and fills the empty days", () => {
  const day = (d, h) => new Date(2026, 10, d, h).getTime();
  const series = countPerDay([day(1, 9), day(1, 23), day(3, 1), NaN]);
  assert.deepEqual(series, [[day(1, 0), 2], [day(2, 0), 0], [day(3, 0), 1]]);
  assert.deepEqual(countPerDay([]), []);
});
