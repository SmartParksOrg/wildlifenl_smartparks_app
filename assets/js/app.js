// The user interface: sign-in, the three pages and the glue between them. Pure logic lives in
// lib.js, the servers in api.js, the map in map.js.

import { APP_NAME, ApiError, DEFAULT_API_URL, SCOPES, WildlifeNlClient } from "./api.js";
import { ago, cellText, columnsOf, flatten, toCsv, toLocalInput, toPoint, toTime, withinWindow } from "./lib.js";
import { MapView } from "./map.js";

const SESSION_KEY = "wnl-session";
const LEGACY_KEY = "wl_nl_client"; // the single-file app before 2.0.0
const PAGE_SIZE = 200;
const HOUR = 3600 * 1000;

const $ = (id) => document.getElementById(id);

// ---------------------------------------------------------------------------------------------
// Small building blocks

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key === "class") node.className = value;
    else if (key === "text") node.textContent = value;
    else if (key.startsWith("on")) node.addEventListener(key.slice(2), value);
    else if (value !== false && value != null) node.setAttribute(key, value === true ? "" : value);
  }
  for (const child of [].concat(children)) if (child != null) node.append(child);
  return node;
}

function toast(message, isError = false) {
  const node = el("div", { class: `toast${isError ? " error" : ""}`, text: message });
  $("toasts").append(node);
  setTimeout(() => node.remove(), isError ? 6000 : 2500);
}

/** Shows a callout, or hides it when there is no text. */
function note(target, text, kind = "") {
  target.hidden = !text;
  target.className = `callout${kind ? ` ${kind}` : ""}`;
  target.textContent = text || "";
}

/** Runs an async action with the button disabled and spinning; returns its result. */
async function busy(button, action) {
  button.disabled = true;
  button.classList.add("loading");
  try {
    return await action();
  } finally {
    button.disabled = false;
    button.classList.remove("loading");
  }
}

function tiles(target, items) {
  target.replaceChildren(
    ...items.map((item) =>
      el("div", { class: "tile" }, [
        el("div", { class: "tile-label" }, item.label),
        el("div", { class: "tile-value", text: item.value, title: item.value }),
        el("div", { class: "tile-note", text: item.note || " ", title: item.note || "" }),
      ]),
    ),
  );
}

function download(filename, text, mime) {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  el("a", { href: url, download: filename }).click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function formatMoment(t) {
  return Number.isFinite(t) ? new Date(t).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "";
}

function plural(count, word) {
  return `${count.toLocaleString()} ${word}${count === 1 ? "" : "s"}`;
}

function sortValue(value) {
  if (value == null || value === "") return null;
  if (typeof value === "number") return value;
  const text = cellText(value);
  if (/^-?\d+(\.\d+)?$/.test(text)) return Number(text);
  if (/^\d{4}-\d{2}-\d{2}T/.test(text)) return Date.parse(text);
  return text.toLowerCase();
}

/** A sortable, filterable table of flat rows with CSV and JSON export. Renders 200 rows at a
 * time so a sensor with years of readings stays fast. */
class DataTable {
  constructor(container, { filename, empty = "Nothing loaded yet." }) {
    this.filename = filename;
    this.empty = empty;
    this.rows = [];
    this.raw = [];
    this.columns = [];
    this.sortKey = null;
    this.sortDir = -1;
    this.shown = PAGE_SIZE;
    this.filter = el("input", { type: "search", placeholder: "Filter rows", "aria-label": "Filter rows", oninput: () => this.draw(true) });
    this.count = el("span", { class: "table-count" });
    this.head = el("thead");
    this.body = el("tbody");
    this.more = el("div", { class: "table-more" });
    this.scroll = el("div", { class: "table-scroll" }, el("table", { class: "table" }, [this.head, this.body]));
    this.emptyNode = el("div", { class: "empty", text: empty });
    container.replaceChildren(
      el("div", { class: "table-tools" }, [
        this.filter,
        this.count,
        el("button", { class: "btn outline sm", type: "button", text: "Copy JSON", onclick: () => this.copyJson() }),
        el("button", { class: "btn outline sm", type: "button", text: "Download CSV", onclick: () => this.downloadCsv() }),
      ]),
      this.scroll,
      this.emptyNode,
      this.more,
    );
    this.draw();
  }

  /** @param rows flat objects; `raw` is what Copy JSON gives (the server's own records) */
  setRows(rows, { columns, sortKey, sortDir = -1, raw } = {}) {
    this.rows = rows;
    this.raw = raw || rows;
    this.columns = columns || columnsOf(rows);
    this.sortKey = sortKey || this.columns[0] || null;
    this.sortDir = sortDir;
    this.draw(true);
  }

  visibleRows() {
    const query = this.filter.value.trim().toLowerCase();
    let rows = this.rows;
    if (query) rows = rows.filter((row) => this.columns.some((c) => cellText(row[c]).toLowerCase().includes(query)));
    const key = this.sortKey;
    if (!key) return rows;
    return [...rows].sort((a, b) => {
      const x = sortValue(a[key]);
      const y = sortValue(b[key]);
      if (x === null || y === null) return (x === null) - (y === null); // empty cells last
      if (typeof x !== typeof y) return String(x).localeCompare(String(y)) * this.sortDir;
      return (x < y ? -1 : x > y ? 1 : 0) * this.sortDir;
    });
  }

  draw(reset = false) {
    if (reset) this.shown = PAGE_SIZE;
    const rows = this.visibleRows();
    const has = this.rows.length > 0;
    this.scroll.hidden = !has;
    this.emptyNode.hidden = has;
    this.count.textContent = has ? (rows.length === this.rows.length ? plural(rows.length, "row") : `${rows.length.toLocaleString()} of ${plural(this.rows.length, "row")}`) : "";
    this.head.replaceChildren(
      el(
        "tr",
        {},
        this.columns.map((key) => {
          const active = key === this.sortKey;
          return el("th", { "aria-sort": active ? (this.sortDir > 0 ? "ascending" : "descending") : null }, [
            el("button", {
              type: "button",
              text: `${key}${active ? (this.sortDir > 0 ? " ▲" : " ▼") : ""}`,
              onclick: () => {
                this.sortDir = active ? -this.sortDir : 1;
                this.sortKey = key;
                this.draw(true);
              },
            }),
          ]);
        }),
      ),
    );
    this.body.replaceChildren(
      ...rows.slice(0, this.shown).map((row) =>
        el(
          "tr",
          {},
          this.columns.map((key) => {
            const text = cellText(row[key]);
            return el("td", { text, title: text.length > 30 ? text : null });
          }),
        ),
      ),
    );
    const left = rows.length - this.shown;
    this.more.replaceChildren(
      left > 0
        ? el("button", {
            class: "btn outline sm",
            type: "button",
            text: `Show ${Math.min(left, PAGE_SIZE).toLocaleString()} more (${left.toLocaleString()} left)`,
            onclick: () => {
              this.shown += PAGE_SIZE;
              this.draw();
            },
          })
        : "",
    );
  }

  async copyJson() {
    if (!this.raw.length) return toast("Nothing to copy yet");
    try {
      await navigator.clipboard.writeText(JSON.stringify(this.raw, null, 2));
      toast("Copied JSON to the clipboard");
    } catch {
      toast("The browser refused access to the clipboard", true);
    }
  }

  downloadCsv() {
    if (!this.rows.length) return toast("Nothing to download yet");
    download(`${this.filename}-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "")}.csv`, toCsv(this.visibleRows(), this.columns), "text/csv");
  }
}

// ---------------------------------------------------------------------------------------------
// Session

/** @type {{baseUrl:string, token:string, email:string, userID:string, name:string, scopes:string[]}|null} */
let session = null;
/** @type {WildlifeNlClient|null} */
let api = null;

function readStored(storage, key) {
  try {
    return JSON.parse(storage.getItem(key) || "null");
  } catch {
    return null;
  }
}

function loadSession() {
  const stored = readStored(localStorage, SESSION_KEY) || readStored(sessionStorage, SESSION_KEY);
  if (stored && stored.token && stored.baseUrl) return stored;
  const legacy = readStored(localStorage, LEGACY_KEY);
  if (legacy) localStorage.removeItem(LEGACY_KEY);
  if (!legacy || !legacy.token) return null;
  // the old app only stored a token the user asked it to remember, so it stays remembered
  const migrated = { baseUrl: legacy.baseUrl || DEFAULT_API_URL, token: legacy.token, email: "", userID: "", name: "", scopes: [] };
  localStorage.setItem(SESSION_KEY, JSON.stringify(migrated));
  return migrated;
}

function saveSession(remember) {
  const keep = remember ?? localStorage.getItem(SESSION_KEY) !== null;
  localStorage.removeItem(SESSION_KEY);
  sessionStorage.removeItem(SESSION_KEY);
  (keep ? localStorage : sessionStorage).setItem(SESSION_KEY, JSON.stringify(session));
}

function signOut(message = "") {
  localStorage.removeItem(SESSION_KEY);
  sessionStorage.removeItem(SESSION_KEY);
  session = null;
  api = null;
  showAuth(message);
}

function hasScope(needed) {
  return needed.length === 0 || needed.some((scope) => session.scopes.includes(scope));
}

/** Turns a failed call into text for a callout; a refused token ends the session. */
function explain(error) {
  if (error instanceof ApiError && error.status === 401 && session) {
    signOut("WildlifeNL no longer accepts this token. Sign in again.");
    return "";
  }
  if (!(error instanceof ApiError) && !(error instanceof SyntaxError)) console.error(error);
  return error.message || String(error);
}

async function refreshProfile() {
  const profile = await api.profile();
  session.email = profile.email || session.email;
  session.userID = profile.ID || session.userID;
  session.name = profile.name || "";
  session.scopes = (profile.roles || []).map((role) => role.name).filter(Boolean);
  saveSession();
}

// ---------------------------------------------------------------------------------------------
// Sign-in

const auth = { mode: "email", email: "" };

function authClient() {
  return new WildlifeNlClient($("authBaseUrl").value || DEFAULT_API_URL);
}

function setAuthMode(mode) {
  auth.mode = mode;
  $("emailForm").hidden = mode !== "email";
  $("codeForm").hidden = mode !== "code";
  $("tokenForm").hidden = mode !== "token";
  $("authModeToggle").textContent = mode === "token" ? "Sign in with an email code" : "I already have a token";
  $("authDescription").textContent =
    mode === "code"
      ? `We sent a code to ${auth.email}. It can take a minute to arrive.`
      : mode === "token"
        ? "Paste a WildlifeNL bearer token. It is checked against your profile."
        : "Sign in with your WildlifeNL account. You get a code by email, no password needed.";
  note($("authError"), "");
  note($("authInfo"), "");
  const focus = { email: "authEmail", code: "authCode", token: "authToken" }[mode];
  $(focus).focus();
}

function showAuth(message = "") {
  $("app").hidden = true;
  $("auth").hidden = false;
  $("authPhoto").style.backgroundImage = `url("assets/img/auth-background-${1 + Math.floor(Math.random() * 2)}.webp")`;
  $("authBaseUrl").value = $("authBaseUrl").value || DEFAULT_API_URL;
  $("authCode").value = "";
  $("authToken").value = "";
  setAuthMode("email");
  if (message) note($("authInfo"), message, "warn");
}

async function startSession(client, credential, remember) {
  api = client;
  session = {
    baseUrl: client.baseUrl,
    token: client.token,
    email: credential.email || "",
    userID: credential.userID || "",
    name: "",
    scopes: credential.scopes || [],
  };
  await refreshProfile(); // also proves the token works before anything is stored
  saveSession(remember);
  showApp();
}

function wireAuth() {
  const fail = (error) => note($("authError"), explain(error), "error");

  const sendCode = (button) =>
    busy(button, async () => {
      note($("authError"), "");
      try {
        await authClient().requestCode(auth.email);
        setAuthMode("code");
      } catch (error) {
        fail(error);
      }
    });

  $("emailForm").addEventListener("submit", (event) => {
    event.preventDefault();
    const input = $("authEmail");
    if (!input.checkValidity()) return fail(new ApiError("Enter a valid email address"));
    auth.email = input.value.trim().toLowerCase();
    sendCode(event.submitter || event.target.querySelector("button"));
  });

  $("codeForm").addEventListener("submit", (event) => {
    event.preventDefault();
    const code = $("authCode").value.replace(/\D/g, "");
    if (code.length !== 6) return fail(new ApiError("The code has six digits"));
    busy(event.target.querySelector("button[type=submit]"), async () => {
      note($("authError"), "");
      try {
        const client = authClient();
        const credential = await client.redeemCode(auth.email, code);
        client.token = credential.token;
        await startSession(client, credential, $("authRemember").checked);
      } catch (error) {
        // WildlifeNL drops the code after three wrong attempts
        fail(error.status === 403 ? new ApiError("That code is not right or has expired. After three wrong tries you need a new code.") : error);
      }
    });
  });

  // a pasted or autofilled code signs in without another click
  $("authCode").addEventListener("input", (event) => {
    if (/^\d{6}$/.test(event.target.value)) $("codeForm").requestSubmit();
  });

  $("tokenForm").addEventListener("submit", (event) => {
    event.preventDefault();
    const token = $("authToken").value.trim().replace(/^Bearer\s+/i, "");
    if (!token) return fail(new ApiError("Paste the token first"));
    busy(event.target.querySelector("button"), async () => {
      note($("authError"), "");
      try {
        const client = authClient();
        client.token = token;
        await startSession(client, {}, $("authRemember").checked);
      } catch (error) {
        session = null;
        api = null;
        fail(error.status === 401 ? new ApiError("WildlifeNL does not know this token") : error);
      }
    });
  });

  $("resendCode").addEventListener("click", async (event) => {
    await sendCode(event.target);
    if (auth.mode === "code" && $("authError").hidden) note($("authInfo"), "A new code is on its way. Older codes no longer work.");
  });
  $("otherEmail").addEventListener("click", () => setAuthMode("email"));
  $("authModeToggle").addEventListener("click", () => setAuthMode(auth.mode === "token" ? "email" : "token"));
}

// ---------------------------------------------------------------------------------------------
// App frame

const VIEWS = ["readings", "detections", "account"];
const maps = {};
const tables = {};

function mapFor(view) {
  if (!maps[view]) maps[view] = new MapView($(`${view}Map`));
  return maps[view];
}

function route() {
  if (!session) return;
  const wanted = location.hash.replace(/^#\/?/, "");
  const view = VIEWS.includes(wanted) ? wanted : "readings";
  for (const name of VIEWS) $(`view-${name}`).hidden = name !== view;
  for (const link of document.querySelectorAll(".nav-item")) {
    const active = link.dataset.view === view;
    link.classList.toggle("active", active);
    if (active) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  }
  if (view !== "account") mapFor(view); // a map is built the first time its page is visible
  if (view === "account") drawAccount();
  document.title = `${document.querySelector(`.nav-item[data-view="${view}"] span`).textContent} · ${APP_NAME}`;
}

function showApp() {
  $("auth").hidden = true;
  $("app").hidden = false;
  $("topbarUser").textContent = session.email;
  resetPages();
  route();
  loadSensors();
}

function resetPages() {
  tables.readings = new DataTable($("readingsTable"), { filename: "wildlifenl-readings", empty: "Pick a sensor and load its readings." });
  tables.detections = new DataTable($("detectionsTable"), { filename: "wildlifenl-detections", empty: "Choose a period and an area and load the detections." });
  for (const id of ["readingsTiles", "detectionsTiles"]) $(id).replaceChildren();
  for (const id of ["readingsNote", "detectionsNote"]) note($(id), "");
  for (const map of Object.values(maps)) map.setPoints([], { fit: false });
  const now = Date.now();
  $("detectionsFrom").value = toLocalInput(now - 7 * 24 * HOUR);
  $("detectionsTo").value = toLocalInput(now + 60 * 1000);
}

const THEMES = { system: ["monitor", "Theme: follows the device"], light: ["sun", "Theme: light"], dark: ["moon", "Theme: dark"] };

function drawThemeButton() {
  const [icon, label] = THEMES[window.wnlTheme.get()] || THEMES.system;
  const button = $("themeButton");
  button.querySelector("use").setAttribute("href", `#i-${icon}`);
  button.title = label;
  button.setAttribute("aria-label", label);
}

// ---------------------------------------------------------------------------------------------
// Sensor readings

/** Fills the sensor suggestions from the active deployments, which only herd managers may list. */
async function loadSensors() {
  const list = $("sensorList");
  list.replaceChildren();
  if (!hasScope(SCOPES.deployments)) {
    note($("readingsNote"), "Your account cannot list the deployed sensors (that needs the herd-manager role). Type the sensor ID yourself.");
    return;
  }
  try {
    const deployments = await api.activeDeployments();
    const seen = new Set();
    for (const deployment of deployments) {
      if (!deployment.sensorID || seen.has(deployment.sensorID)) continue;
      seen.add(deployment.sensorID);
      const animal = deployment.animal || {};
      const species = animal.species ? animal.species.commonName || animal.species.name : "";
      list.append(el("option", { value: deployment.sensorID, label: [animal.name, species && `(${species})`].filter(Boolean).join(" ") }));
    }
    note($("readingsNote"), seen.size ? "" : "WildlifeNL has no active sensor deployments. You can still type a sensor ID: readings are kept before a deployment exists.");
  } catch (error) {
    const text = explain(error);
    if (text) note($("readingsNote"), `Could not list the deployed sensors: ${text}`, "warn");
  }
}

const READING_COLUMNS = ["timestamp", "sensorID", "location.latitude", "location.longitude", "altitude", "temperature", "accelero.x", "accelero.y", "accelero.z", "userID"];

function orderedColumns(rows, preferred) {
  const present = columnsOf(rows);
  return [...preferred.filter((c) => present.includes(c)), ...present.filter((c) => !preferred.includes(c))];
}

async function loadReadings(button) {
  const sensor = $("readingsSensor").value.trim();
  const period = $("readingsPeriod").value;
  note($("readingsNote"), "");
  try {
    const all = await api.readings(sensor);
    const from = period === "all" ? NaN : Date.now() - Number(period) * HOUR;
    const readings = withinWindow(all, from, NaN, (r) => toTime(r.timestamp));
    const points = readings.map(toPoint).filter(Boolean);
    const times = readings.map((r) => toTime(r.timestamp)).filter(Number.isFinite);
    const latest = times.length ? Math.max(...times) : NaN;
    const temperatures = readings.map((r) => r.temperature).filter((v) => typeof v === "number");
    tiles($("readingsTiles"), [
      { label: "Readings", value: readings.length.toLocaleString(), note: period === "all" ? "All time" : `${all.length.toLocaleString()} in total for this sensor` },
      { label: "With a location", value: points.length.toLocaleString(), note: `${(readings.length - points.length).toLocaleString()} without` },
      { label: "Latest reading", value: ago(latest) || "None", note: formatMoment(latest) },
      {
        label: "Temperature",
        value: temperatures.length ? `${Math.min(...temperatures).toFixed(1)} to ${Math.max(...temperatures).toFixed(1)} °C` : "None",
        note: temperatures.length ? plural(temperatures.length, "reading") : "",
      },
    ]);
    const rows = readings.map(flatten);
    tables.readings.setRows(rows, { columns: orderedColumns(rows, READING_COLUMNS), sortKey: "timestamp", raw: readings });
    mapFor("readings").setPoints(
      points.map((p) => ({
        ...p,
        title: p.raw.sensorID,
        lines: [formatMoment(p.t), `${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}`, typeof p.raw.temperature === "number" ? `${p.raw.temperature} °C` : ""].filter(Boolean),
      })),
    );
    if (!all.length) note($("readingsNote"), `WildlifeNL has no readings for sensor ${sensor}. Check the ID: the Protect integration sends the device's DevEUI, IMEI or serial unless it is set up otherwise.`, "warn");
    else if (!readings.length) note($("readingsNote"), `No readings in this period. The sensor has ${plural(all.length, "reading")} in total; choose a longer period.`, "warn");
  } catch (error) {
    note($("readingsNote"), explain(error), "error");
  }
}

// ---------------------------------------------------------------------------------------------
// Detections

const DETECTION_COLUMNS = ["start", "end", "deploymentID", "sensorType", "species.commonName", "species.name", "animals", "confidence", "location.latitude", "location.longitude", "uri", "user.name", "ID"];
const SPECIES_TEXT = ["species.advice", "species.behaviour", "species.description", "species.roleInNature", "species.category", "species.ID", "user.ID"];

async function loadDetections() {
  note($("detectionsNote"), "");
  const start = toTime($("detectionsFrom").value);
  const end = toTime($("detectionsTo").value);
  if (!(start < end)) return note($("detectionsNote"), "The period must end after it starts.", "error");
  try {
    const all = await api.detections({
      start: new Date(start).toISOString(),
      end: new Date(end).toISOString(),
      latitude: $("detectionsLat").value,
      longitude: $("detectionsLng").value,
      radius: Math.round(Number($("detectionsRadius").value) * 1000),
    });
    const wanted = $("detectionsDeployment").value.trim().toLowerCase();
    const detections = wanted ? all.filter((d) => String(d.deploymentID || "").toLowerCase().includes(wanted)) : all;
    const rows = detections.map((detection) => {
      const animals = detection.animals || [];
      const flat = flatten({ ...detection, animals: animals.length });
      for (const key of SPECIES_TEXT) delete flat[key];
      flat.confidence = animals.length ? `${Math.max(...animals.map((a) => a.confidence || 0))}%` : "";
      return flat;
    });
    const latest = Math.max(...detections.map((d) => toTime(d.start)).filter(Number.isFinite), -Infinity);
    tiles($("detectionsTiles"), [
      { label: "Detections", value: detections.length.toLocaleString(), note: wanted ? `${all.length.toLocaleString()} in the area` : "" },
      { label: "Species", value: new Set(detections.map((d) => d.species && d.species.ID)).size.toLocaleString() },
      { label: "Deployments", value: new Set(detections.map((d) => d.deploymentID)).size.toLocaleString() },
      { label: "Latest detection", value: ago(latest) || "None", note: formatMoment(latest) },
    ]);
    tables.detections.setRows(rows, { columns: orderedColumns(rows, DETECTION_COLUMNS), sortKey: "start", raw: detections });
    mapFor("detections").setPoints(
      detections
        .map((d) => ({ point: toPoint(d, "start"), d }))
        .filter((x) => x.point)
        .map(({ point, d }) => ({
          ...point,
          title: (d.species && (d.species.commonName || d.species.name)) || "Detection",
          lines: [formatMoment(point.t), d.deploymentID, d.sensorType].filter(Boolean),
        })),
    );
    if (!detections.length) note($("detectionsNote"), all.length ? "No detection in the area matches that deployment ID." : "No detections in this period and area. Try a longer period or a larger radius.", "warn");
  } catch (error) {
    note($("detectionsNote"), explain(error), "error");
  }
}

// ---------------------------------------------------------------------------------------------
// Account

function facts(target, pairs) {
  target.replaceChildren(...pairs.flatMap(([term, value]) => [el("dt", { text: term }), el("dd", {}, value)]));
}

let version = "";

function drawAccount() {
  facts($("accountFacts"), [
    ["Name", session.name || "Not set"],
    ["Email address", session.email || "Unknown"],
    ["User ID", session.userID || "Unknown"],
    [
      "Roles",
      session.scopes.length
        ? el("span", { class: "row" }, session.scopes.map((scope) => el("span", { class: "badge", text: scope })))
        : "None. The account can sign in but reads only what every user may read.",
    ],
  ]);
  const access = [
    ["List deployed sensors", SCOPES.deployments],
    ["Sensor readings", SCOPES.readings],
    ["Detections", SCOPES.detections],
  ];
  $("accessTable").replaceChildren(
    el("thead", {}, el("tr", {}, ["What", "Needs one of these roles", "Your account"].map((text) => el("th", { text })))),
    el(
      "tbody",
      {},
      access.map(([what, needed]) => {
        const ok = hasScope(needed);
        return el("tr", {}, [
          el("td", { text: what }),
          el("td", { text: needed.join(", ") }),
          el("td", {}, el("span", { class: `badge ${ok ? "ok" : "bad"}` }, [el("i", { class: `dot ${ok ? "ok" : "bad"}` }), ok ? "Allowed" : "Not allowed"])),
        ]);
      }),
    ),
  );
  facts($("aboutFacts"), [
    ["WildlifeNL API", el("a", { href: `${session.baseUrl}/`, target: "_blank", rel: "noopener", text: session.baseUrl })],
    ["App version", version || "Unknown"],
    ["Source", el("a", { href: "https://github.com/SmartParksOrg/wildlifenl_smartparks_app", target: "_blank", rel: "noopener", text: "github.com/SmartParksOrg/wildlifenl_smartparks_app" })],
  ]);
}

// ---------------------------------------------------------------------------------------------
// Wiring

function wireApp() {
  const submit = (formId, action) =>
    $(formId).addEventListener("submit", (event) => {
      event.preventDefault();
      if (!event.target.reportValidity()) return;
      busy(event.submitter || event.target.querySelector("button[type=submit]"), action);
    });
  submit("readingsForm", loadReadings);
  submit("detectionsForm", loadDetections);

  $("readingsTrack").addEventListener("change", (event) => mapFor("readings").setTrack(event.target.checked));
  $("detectionsUseMap").addEventListener("click", () => {
    const center = mapFor("detections").center();
    if (!center) return;
    $("detectionsLat").value = center.lat.toFixed(5);
    $("detectionsLng").value = center.lng.toFixed(5);
  });

  $("themeButton").addEventListener("click", () => {
    const order = Object.keys(THEMES);
    window.wnlTheme.set(order[(order.indexOf(window.wnlTheme.get()) + 1) % order.length]);
    drawThemeButton();
  });
  for (const id of ["signOutButton", "signOutButton2"]) $(id).addEventListener("click", () => signOut());
  $("copyToken").addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(session.token);
      toast("Copied the token. Treat it like a password.");
    } catch {
      toast("The browser refused access to the clipboard", true);
    }
  });
  $("refreshProfile").addEventListener("click", (event) =>
    busy(event.target, async () => {
      try {
        await refreshProfile();
        drawAccount();
        loadSensors();
        toast("Profile refreshed");
      } catch (error) {
        const text = explain(error);
        if (text) toast(text, true);
      }
    }),
  );
  window.addEventListener("hashchange", route);
}

async function start() {
  wireAuth();
  wireApp();
  drawThemeButton();
  fetch("VERSION")
    .then((response) => (response.ok ? response.text() : ""))
    .then((text) => (version = text.trim()))
    .catch(() => {});

  session = loadSession();
  if (!session) return showAuth();
  try {
    api = new WildlifeNlClient(session.baseUrl, session.token);
  } catch {
    return signOut();
  }
  showApp(); // show at once from the stored session, then confirm it with the server
  try {
    await refreshProfile();
    $("topbarUser").textContent = session.email;
    if (!$("view-account").hidden) drawAccount();
    loadSensors();
  } catch (error) {
    const text = explain(error);
    if (text) toast(`Could not refresh your profile: ${text}`, true);
  }
}

start();
