// The sensors this account works with and their readings, fetched once and kept in memory.
//
// A sensor comes from WildlifeNL's active deployments (which only herd managers may list),
// from the animals a search of the live map found (for the managers who may not list the
// deployments), or from the IDs the user added by hand. The last two are remembered in this
// browser.
//
// Only a herd manager may read the readings of a sensor. Every other account knows an animal
// by the last position WildlifeNL keeps of it, and its sensor by nothing more.

import { ApiError, SCOPES } from "./api.js";
import { sensorOfAnimal, toTime, trackOf } from "./lib.js";
import { account, hasScope } from "./session.js";

const ADDED_KEY = "wnl-sensors";
const FOUND_KEY = "wnl-found-animals";

/** @typedef {{id:string, name:string, animal:object|null, species:string, start:string, added:boolean, found:boolean, place:{lat:number,lng:number,t:number}|null}} Sensor */

const state = {
  /** @type {Sensor[]|null} */ sensors: null,
  /** @type {Promise<Sensor[]>|null} */ loading: null,
  /** @type {Map<string, Promise<object[]>>} */ readings: new Map(),
  /** @type {Map<string, {readings:object[], track:object[]}>} */ loaded: new Map(),
  /** @type {Map<string, Promise<object>>} */ recent: new Map(),
  /** @type {Map<string, {readings:object[], track:object[], complete:boolean}>} */ recentLoaded: new Map(),
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

/** The animals a search found belong to one account on one server. */
function foundKey() {
  return `${FOUND_KEY}:${new URL(account.session.baseUrl).host}:${account.session.userID}`;
}

/** The found animals as deployments `{sensorID, start, animal}`, the shape WildlifeNL lists
 * the active deployments in. */
function foundDeployments() {
  try {
    const list = JSON.parse(localStorage.getItem(foundKey()) || "[]");
    if (!Array.isArray(list)) return [];
    // before API 20261122 an animal had a `name` where it now has an `identifier`
    return list.filter((item) => item && typeof item.sensorID === "string" && item.animal).map((item) => (item.animal.identifier || !item.animal.name ? item : { ...item, animal: { ...item.animal, identifier: item.animal.name } }));
  } catch {
    return [];
  }
}

function fromDeployment(deployment) {
  const animal = deployment.animal || null;
  const species = animal && animal.species ? animal.species.commonName || animal.species.name || "" : "";
  const location = animal && animal.location;
  const located = location && Number.isFinite(location.latitude) && Number.isFinite(location.longitude) && (location.latitude !== 0 || location.longitude !== 0);
  return {
    id: deployment.sensorID,
    name: (animal && animal.identifier) || deployment.sensorID,
    animal,
    species,
    start: deployment.start || "",
    added: false,
    found: false,
    // the animal's current location, until the sensor's own readings are loaded. The animals
    // a search found say when that was; the active deployments do not.
    place: located ? { lat: location.latitude, lng: location.longitude, t: toTime(animal.locationTimestamp) } : null,
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
  for (const deployment of foundDeployments()) {
    if (!byId.has(deployment.sensorID)) byId.set(deployment.sensorID, { ...fromDeployment(deployment), found: true });
  }
  // a sensor added by its ID shows nothing but its readings, so only for who may read them
  for (const id of canReadReadings() ? addedIds() : []) {
    if (byId.has(id)) byId.get(id).added = true;
    else byId.set(id, { id, name: id, animal: null, species: "", start: "", added: true, found: false, place: null });
  }
  const sensors = [...byId.values()].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  for (const sensor of sensors) applyLoaded(sensor);
  return sensors;
}

function applyLoaded(sensor) {
  const loaded = state.loaded.get(sensor.id) || state.recentLoaded.get(sensor.id);
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

/** Whether the account may read the readings of a sensor: its track, charts and measurements. */
export function canReadReadings() {
  return hasScope(SCOPES.readings);
}

/** The refusal for an account that may not read readings, before any request is made. */
function readingsRefused() {
  return Promise.reject(new ApiError(`The readings of a sensor need the ${SCOPES.readings.join(" or ")} role.`, 403));
}

export function sensorById(id) {
  return (state.sensors || []).find((sensor) => sensor.id === id) || null;
}

/** The sensor an animal carries, by the ID of the animal. */
export function sensorByAnimal(animalId) {
  return (state.sensors || []).find((sensor) => sensor.animal && String(sensor.animal.ID) === String(animalId)) || null;
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

/** Remembers the animals a search of the live map found, each with the sensor it carries,
 * so they are animals of this app like the ones a herd manager lists. An animal without a
 * sensor has nothing to follow and is left out. Returns how many were taken. */
export function addFound(animals) {
  const byId = new Map(foundDeployments().map((deployment) => [deployment.sensorID, deployment]));
  let taken = 0;
  for (const animal of animals) {
    const deployment = sensorOfAnimal(animal);
    if (!deployment) continue;
    // the animal without its deployments and their readings, which can be megabytes
    const { borneSensorDeployments, ...rest } = animal;
    byId.set(deployment.sensorID, { sensorID: deployment.sensorID, start: deployment.start || "", animal: rest });
    taken++;
  }
  if (taken) {
    localStorage.setItem(foundKey(), JSON.stringify([...byId.values()]));
    state.sensors = null;
  }
  return taken;
}

/** All readings of a sensor and its track `{readings, track}`, fetched once. A failed fetch
 * is not kept, so the next call tries again. */
export function loadReadings(id, force = false) {
  if (force) {
    state.readings.delete(id);
    state.loaded.delete(id);
    state.recent.delete(id);
    state.recentLoaded.delete(id);
  }
  if (!canReadReadings()) return readingsRefused();
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

/** The newest readings of a sensor `{readings, track, complete}`: the first part of the
 * answer only, which is enough for "last seen" and costs kilobytes where all readings can
 * cost megabytes. When that part turns out to be everything, it counts as fully loaded. */
export function loadRecent(id) {
  if (state.loaded.has(id)) return Promise.resolve({ ...state.loaded.get(id), complete: true });
  if (!canReadReadings()) return readingsRefused();
  if (!state.recent.has(id)) {
    const promise = account.api
      .recentReadings(id)
      .then(({ readings, complete }) => {
        const data = { readings, track: trackOf(readings), complete };
        state.recentLoaded.set(id, data);
        if (complete && !state.loaded.has(id)) {
          state.loaded.set(id, data);
          state.readings.set(id, Promise.resolve(data));
        }
        const sensor = sensorById(id);
        if (sensor) applyLoaded(sensor);
        return data;
      })
      .catch((error) => {
        state.recent.delete(id);
        throw error;
      });
    state.recent.set(id, promise);
  }
  return state.recent.get(id);
}

/** The newest readings in memory: all of them when loaded, else the recent part, else null. */
export function recentReadings(id) {
  const loaded = state.loaded.get(id);
  return loaded ? { ...loaded, complete: true } : state.recentLoaded.get(id) || null;
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
  state.recent.clear();
  state.recentLoaded.clear();
  state.listError = "";
}
