// What WildlifeNL knows about people on the move: where the recreation app recorded them
// (tracking readings), when a phone was near an animal's sensor (contacts), the messages and
// alarms that were shown to them (conveyances) and the alarms themselves.
//
// Every account may read its own; a researcher may read those of every experiment, and an
// administrator or researcher all alarms. This module reads what the account may and keeps
// it for the live map and the record pages.

import { SCOPES } from "./api.js";
import { toTime } from "./lib.js";
import { account, explain, hasScope } from "./session.js";

/** `tracks` holds per user ID the places of that person, oldest first. */
export const people = { tracks: new Map(), names: new Map(), contacts: [], conveyances: [], alarms: [], experiments: [], loaded: false, busy: false, message: "" };

const listeners = new Set();
let loading = null;

/** Calls `listener` when the people data changed. */
export function onPeople(listener) {
  listeners.add(listener);
}

function changed() {
  for (const listener of listeners) listener();
}

/** A list the account may read for itself, plus that of every experiment for a researcher.
 * A part that is refused or fails leaves the rest standing. */
async function collect(own, perExperiment) {
  const lists = [];
  const read = async (path) => {
    try {
      lists.push(await account.api.list(path));
    } catch (error) {
      if (error.status === 401) throw error;
    }
  };
  await read(own);
  for (const experiment of people.experiments) await read(perExperiment(experiment.ID));
  return lists.flat();
}

function unique(items, keyOf) {
  const seen = new Map();
  for (const item of items) seen.set(keyOf(item), item);
  return [...seen.values()];
}

async function load() {
  const { api, session } = account;
  people.experiments = [];
  if (hasScope(SCOPES.research)) {
    try {
      people.experiments = await api.list("/experiments/");
    } catch (error) {
      if (error.status === 401) throw error;
    }
  }
  const readings = unique(await collect("/tracking-readings/me/", (id) => `/tracking-readings/experiment/${id}`), (r) => `${r.userID}|${r.timestamp}`);
  people.contacts = unique(await collect("/contacts/me/", (id) => `/contacts/experiment/${id}`), (c) => c.ID);
  people.conveyances = unique(await collect("/conveyances/me/", (id) => `/conveyances/experiment/${id}`), (c) => c.ID);
  try {
    people.alarms = await api.list(hasScope(SCOPES.alarms) ? "/alarms/" : "/alarms/me/");
  } catch (error) {
    if (error.status === 401) throw error;
    people.alarms = [];
  }

  people.tracks = new Map();
  for (const reading of readings) {
    const place = reading.location;
    const t = toTime(reading.timestamp);
    if (!reading.userID || !place || !Number.isFinite(place.latitude) || !Number.isFinite(place.longitude) || !Number.isFinite(t)) continue;
    if (!people.tracks.has(reading.userID)) people.tracks.set(reading.userID, []);
    people.tracks.get(reading.userID).push({ t, lat: place.latitude, lng: place.longitude, raw: reading });
  }
  for (const track of people.tracks.values()) track.sort((a, b) => a.t - b.t);

  // names: from what names a person, then asked per person for the ones still unknown
  // the names known from an earlier load stay, so a refresh does not ask them again
  people.names = new Map([...people.names, [session.userID, session.name || session.email || "You"]]);
  for (const item of [...people.contacts, ...people.conveyances]) if (item.user && item.user.ID) people.names.set(item.user.ID, item.user.name);
  const unknown = [...people.tracks.keys()].filter((id) => !people.names.has(id)).slice(0, 40);
  await Promise.all(
    unknown.map(async (id) => {
      try {
        const user = await api.call("GET", `/user/${encodeURIComponent(id)}`);
        if (user && user.name) people.names.set(id, user.name);
      } catch {
        /* the ID stands in for the name */
      }
    }),
  );
}

/** Reads the people data once; `force` reads it again. */
export function loadPeople(force = false) {
  if (people.loaded && !force) return Promise.resolve();
  if (!loading) {
    people.busy = true;
    people.message = "";
    changed();
    loading = load()
      .then(() => (people.loaded = true))
      .catch((error) => {
        people.message = explain(error);
      })
      .finally(() => {
        loading = null;
        people.busy = false;
        changed();
      });
  }
  return loading;
}

/** Adds a position the account just shared to its own track, when the tracks are loaded;
 * else the next load reads it from WildlifeNL. */
export function addOwnReading(reading) {
  const place = reading.location;
  const t = toTime(reading.timestamp);
  const id = account.session.userID;
  if (!people.loaded || !place || !Number.isFinite(place.latitude) || !Number.isFinite(place.longitude) || !Number.isFinite(t)) return;
  if (!people.tracks.has(id)) people.tracks.set(id, []);
  people.tracks.get(id).push({ t, lat: place.latitude, lng: place.longitude, raw: { userID: id, timestamp: reading.timestamp, location: place } });
  changed();
}

export function personName(id) {
  return people.names.get(id) || `Person ${String(id).slice(0, 8)}`;
}

function pointOf(place) {
  return place && Number.isFinite(place.latitude) && Number.isFinite(place.longitude) ? { lat: place.latitude, lng: place.longitude } : null;
}

/** Where a contact began. */
export function contactPlace(contact) {
  return pointOf(contact.startLocation) || pointOf(contact.endLocation);
}

/** Where an alarm was raised: at what caused it, else in the middle of its zone. */
export function alarmPlace(alarm) {
  const cause = pointOf(alarm.detection && alarm.detection.location) || pointOf(alarm.interaction && (alarm.interaction.place || alarm.interaction.location)) || pointOf(alarm.animal && alarm.animal.location);
  if (cause) return cause;
  const outline = ((alarm.zone && alarm.zone.definition) || []).map(pointOf).filter(Boolean);
  if (!outline.length) return null;
  return { lat: outline.reduce((sum, p) => sum + p.lat, 0) / outline.length, lng: outline.reduce((sum, p) => sum + p.lng, 0) / outline.length };
}

/** What caused an alarm, in a few words. */
export function alarmCause(alarm) {
  if (alarm.animal) return `${alarm.animal.identifier || "an animal"} came inside`;
  if (alarm.detection) return "a detection inside";
  if (alarm.interaction) return "a report inside";
  return "";
}

/** Forgets the people data of the account that signed out. */
export function resetPeople() {
  Object.assign(people, { tracks: new Map(), names: new Map(), contacts: [], conveyances: [], alarms: [], experiments: [], loaded: false, busy: false, message: "" });
  loading = null;
}
