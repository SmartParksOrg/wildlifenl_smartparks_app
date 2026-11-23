// Automatic refresh. WildlifeNL sends nothing to the app by itself, so while the app is open
// on screen it reads the page on screen again every so often. A line under the top bar fills
// up until the next refresh. How often is a choice per device, on the Account page.

import { detections } from "./detections.js";
import { countdownText } from "./lib.js";
import { explain } from "./session.js";
import { $, toast } from "./ui.js";

const KEY = "wnl-refresh";
/** The choices in seconds; 0 is off. Once a minute keeps a page current without asking
 * WildlifeNL more than it needs to. */
export const REFRESH_CHOICES = [
  { seconds: 0, label: "Off" },
  { seconds: 30, label: "Every 30 seconds" },
  { seconds: 60, label: "Every minute" },
  { seconds: 120, label: "Every 2 minutes" },
  { seconds: 300, label: "Every 5 minutes" },
  { seconds: 900, label: "Every 15 minutes" },
];
const DEFAULT_SECONDS = 60;

const state = {
  every: read(),
  /** the refresh of the page on screen, or null when that page has nothing to refresh */
  target: null,
  last: Date.now(),
  running: false,
  timer: 0,
  /** the text of the last failed refresh, so the same problem is not shown every minute */
  problem: "",
};

function read() {
  try {
    const stored = localStorage.getItem(KEY);
    return stored !== null && REFRESH_CHOICES.some((choice) => String(choice.seconds) === stored) ? Number(stored) : DEFAULT_SECONDS;
  } catch {
    return DEFAULT_SECONDS;
  }
}

/** How often the app refreshes, in seconds; 0 is off. */
export function refreshEvery() {
  return state.every;
}

export function setRefreshEvery(seconds) {
  state.every = seconds;
  try {
    localStorage.setItem(KEY, String(seconds));
  } catch {
    /* the choice lasts until the page is closed */
  }
  state.last = Date.now();
  tick();
}

/** The page on screen tells what to do on a refresh: its `refresh()`, or null for nothing. */
export function refreshPage(refresh) {
  state.target = refresh || null;
  tick();
}

/** Starts the countdown, after sign-in. */
export function startRefresh() {
  state.last = Date.now();
  state.problem = "";
  if (!state.timer) state.timer = setInterval(tick, 1000);
  tick();
}

/** Stops it, on sign out. */
export function stopRefresh() {
  clearInterval(state.timer);
  state.timer = 0;
  state.target = null;
  tick();
}

/** Why the countdown waits: the app is not on screen, a form is open, or a search of an area
 * is running and already asks WildlifeNL as much as it may. */
function pause() {
  if (document.hidden) return "while the app is not on screen";
  if (document.querySelector("dialog[open]")) return "while a form is open";
  if (detections.busy) return "while a search runs";
  return "";
}

function draw(fraction, text, running = false) {
  const bar = $("refreshBar");
  bar.classList.toggle("running", running);
  bar.firstElementChild.style.transform = `scaleX(${fraction})`;
  bar.title = text;
  bar.setAttribute("aria-valuenow", String(Math.round(fraction * 100)));
  bar.setAttribute("aria-valuetext", text);
}

function tick() {
  const bar = $("refreshBar");
  const on = Boolean(state.timer && state.every && state.target);
  bar.hidden = !on;
  if (!on || state.running) return;
  const left = state.last + state.every * 1000 - Date.now();
  const waiting = pause();
  if (left <= 0 && !waiting) return run();
  const fraction = Math.min(1, Math.max(0, 1 - left / (state.every * 1000)));
  draw(fraction, left <= 0 ? `Next refresh ${waiting}` : `Next refresh ${countdownText(left)}`);
}

async function run() {
  state.running = true;
  draw(1, "Refreshing…", true);
  try {
    await state.target();
    state.problem = "";
  } catch (error) {
    const text = explain(error);
    if (text && text !== state.problem) toast(`Could not refresh: ${text}`, true);
    state.problem = text || "";
  }
  state.running = false;
  state.last = Date.now();
  tick();
}

// back on screen after the next refresh was due: refresh at once
document.addEventListener("visibilitychange", tick);
