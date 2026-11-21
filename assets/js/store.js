// The sensors this account works with and their readings, fetched once and kept in memory.
//
// A sensor comes from WildlifeNL's active deployments (which only herd managers may list) or
// from the IDs the user added by hand, which are remembered in this browser.

import { SCOPES } from "./api.js";
import { trackOf } from "./lib.js";
import { account, hasScope } from "./session.js";

const ADDED_KEY = "wnl-sensors";

/** @typedef {{id:string, name:string, animal:object|null, species:string, start:string, added:boolean, place:{lat:number,lng:number,t:number}|null}} Sensor */

const state = {
  /** @type {Sensor[]|null} */ sensors: null,
  /** @type {Promise<Sensor[]>|null} */ loading: null,
  /** @type {Map<string, Promise<object[]>>} */ readings: new Map(),
  /** @type {Map<string, {readings:object[], track:object[]}>} */ loaded: new Map(),
  listError: "",
};

function addedIds() {
  try {
    const ids = JSON.parse(localStorage.getItem(ADDED_KEY) || "[]");
    return Array.isArray(ids) ? ids.filter((id) => typeof id === "string" && id) : [];
  } catch {
    return [];
  }
}

function saveAdded(ids) {
  localStorage.setItem(ADDED_KEY, JSON.stringify(ids));
}

function fromDeployment(deployment) {
  const animal = deployment.animal || null;
  const species = animal && animal.species ? animal.species.commonName || animal.species.name || "" : "";
  const location = animal && animal.location;
  const located = location && Number.isFinite(location.latitude) && Number.isFinite(location.longitude) && (location.latitude !== 0 || location.longitude !== 0);
  return {
    id: deployment.sensorID,
    name: (animal && animal.name) || deployment.sensorID,
    animal,
    species,
    start: deployment.start || "",
    added: false,
    // the animal's current location, until the sensor's own readings are loaded
    place: located ? { lat: location.latitude, lng: location.longitude, t: NaN } : null,
  };
}

async function fetchSensors() {
  const byId = new Map();
  state.listError = "";
  if (hasScope(SCOPES.deployments)) {
    try {
      for (const deployment of await account.api.activeDeployments()) {
        if (deployment.sensorID && !byId.has(deployment.sensorID)) byId.set(deployment.sensorID, fromDeployment(deployment));
      }
    } catch (error) {
      if (error.status === 401) throw error;
      state.listError = error.message;
    }
  }
  for (const id of addedIds()) {
    if (byId.has(id)) byId.get(id).added = true;
    else byId.set(id, { id, name: id, animal: null, species: "", start: "", added: true, place: null });
  }
  const sensors = [...byId.values()].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  for (const sensor of sensors) applyLoaded(sensor);
  return sensors;
}

function applyLoaded(sensor) {
  const loaded = state.loaded.get(sensor.id);
  if (!loaded || !loaded.track.length) return;
  const last = loaded.track[loaded.track.length - 1];
  sensor.place = { lat: last.lat, lng: last.lng, t: last.t };
}

/** The sensors, from memory unless `force`. */
export function loadSensors(force = false) {
  if (force) state.sensors = null;
  if (state.sensors) return Promise.resolve(state.sensors);
  if (!state.loading) {
    state.loading = fetchSensors()
      .then((sensors) => (state.sensors = sensors))
      .finally(() => (state.loading = null));
  }
  return state.loading;
}

/** Why the deployed sensors could not be listed, or an empty text. */
export function listError() {
  return state.listError;
}

export function canListSensors() {
  return hasScope(SCOPES.deployments);
}

export function sensorById(id) {
  return (state.sensors || []).find((sensor) => sensor.id === id) || null;
}

/** Remembers a sensor ID typed by the user. */
export function addSensor(id) {
  const ids = addedIds();
  if (!ids.includes(id)) saveAdded([...ids, id]);
  state.sensors = null;
}

export function removeSensor(id) {
  saveAdded(addedIds().filter((other) => other !== id));
  state.sensors = null;
}

/** All readings of a sensor and its track `{readings, track}`, fetched once. A failed fetch
 * is not kept, so the next call tries again. */
export function loadReadings(id, force = false) {
  if (force) {
    state.readings.delete(id);
    state.loaded.delete(id);
  }
  if (!state.readings.has(id)) {
    const promise = account.api
      .readings(id)
      .then((readings) => {
        const data = { readings, track: trackOf(readings) };
        state.loaded.set(id, data);
        const sensor = sensorById(id);
        if (sensor) applyLoaded(sensor);
        return data;
      })
      .catch((error) => {
        state.readings.delete(id);
        throw error;
      });
    state.readings.set(id, promise);
  }
  return state.readings.get(id);
}

/** The readings of a sensor when they are already in memory. */
export function loadedReadings(id) {
  return state.loaded.get(id) || null;
}

/** Forgets everything, on sign out. */
export function resetStore() {
  state.sensors = null;
  state.loading = null;
  state.readings.clear();
  state.loaded.clear();
  state.listError = "";
}
