// Sharing the own position with WildlifeNL, as the phone apps do. It is off until the person
// switches it on, and it only runs while this page is open and on screen: a browser gives no
// position to a page in the background.
//
// WildlifeNL keeps every position that is sent, and answers with what is near: the animals,
// detections and reports within a few hundred metres, and a message when an experiment has
// one for this place. That is how an account without a role to read them gets to see what
// is around. An account whose roles read a kind anyway finds it on the map already, so of
// that kind nothing is added: it would only show the same things twice.

import { SCOPES } from "./api.js";
import { addFinds } from "./detections.js";
import { addOwnReading } from "./people.js";
import { account, explain, hasScope } from "./session.js";
import { toast } from "./ui.js";

const KEY = "wnl-share-location";
/** The phone apps send a position this often. */
const EVERY_MS = 10 * 60 * 1000;
const MESSAGE_MS = 12000;

/** `animals` are the animals WildlifeNL found near the last position that was sent, for an
 * account that cannot read animals otherwise. */
export const sharing = { on: false, last: 0, message: "", animals: [] };

/** What is near, of a kind the roles of the account do not read anyway. */
const unlessRead = (scope, list) => (hasScope(scope) ? [] : list || []);

/** Whether sharing shows this account anything on the map that its roles do not. */
export function showsNearby() {
  return [SCOPES.animalsNear, SCOPES.detections, SCOPES.reports].some((scope) => !hasScope(scope));
}

const listeners = new Set();
let timer = null;
let sending = false;

/** Calls `listener` when sharing went on or off, or a position was sent. */
export function onSharing(listener) {
  listeners.add(listener);
}

function changed() {
  for (const listener of listeners) listener();
}

/** The choice belongs to one account on one server, so the next person who signs in on this
 * device does not share a position without having asked for it. */
function owner() {
  return `${new URL(account.session.baseUrl).host}|${account.session.userID}`;
}

function position() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error("This browser cannot give a position."));
    navigator.geolocation.getCurrentPosition(resolve, (error) => reject(Object.assign(new Error(error.code === 1 ? "The browser may not use your position. Allow it for this site and switch sharing on again." : "The device could not find its position."), { denied: error.code === 1 })), { enableHighAccuracy: true, timeout: 20000, maximumAge: 60000 });
  });
}

async function send() {
  if (sending) return;
  sending = true;
  const { api } = account;
  try {
    const { coords } = await position();
    if (!sharing.on || account.api !== api) return; // switched off or signed out while the device looked for its position
    // WildlifeNL refuses a moment that is not in its past
    const reading = await api.call("POST", "/tracking-reading/", { location: { latitude: coords.latitude, longitude: coords.longitude }, timestamp: new Date(Date.now() - 1000).toISOString() });
    sharing.last = Date.now();
    sharing.message = "";
    const near = reading || {};
    sharing.animals = unlessRead(SCOPES.animalsNear, near.animals);
    addFinds({ found: unlessRead(SCOPES.detections, near.detections), reports: unlessRead(SCOPES.reports, near.interactions) });
    if (reading) addOwnReading(reading);
    const message = reading && reading.conveyance && reading.conveyance.message;
    if (message && message.text) toast(message.name ? `${message.name}: ${message.text}` : message.text, false, MESSAGE_MS);
  } catch (error) {
    if (error.denied) setSharing(false); // nothing to share without a position
    sharing.message = explain(error);
    if (sharing.message) toast(sharing.message, true);
  } finally {
    sending = false;
    changed();
  }
}

/** Sends a position when sharing is on, the page is on screen and the last one is old. */
function due() {
  if (sharing.on && account.session && document.visibilityState === "visible" && Date.now() - sharing.last >= EVERY_MS) send();
}

function run(on) {
  sharing.on = on;
  clearInterval(timer);
  timer = on ? setInterval(due, 60000) : null;
  if (!on) sharing.animals = [];
  changed();
  due();
}

/** Switches sharing on or off for this account on this device, and remembers it. */
export function setSharing(on) {
  try {
    if (on) localStorage.setItem(KEY, owner());
    else localStorage.removeItem(KEY);
  } catch {
    /* the choice lasts for this page only */
  }
  sharing.last = 0;
  sharing.message = "";
  run(on);
}

/** Goes on with sharing after a sign-in, when this account chose it on this device. */
export function startSharing() {
  let stored = "";
  try {
    stored = localStorage.getItem(KEY) || "";
  } catch {
    /* off */
  }
  run(stored === owner());
}

/** Stops at sign out. The choice stays, so the same account goes on with it next time. */
export function resetSharing() {
  clearInterval(timer);
  timer = null;
  Object.assign(sharing, { on: false, last: 0, message: "", animals: [] });
  changed();
}

document.addEventListener("visibilitychange", due);
