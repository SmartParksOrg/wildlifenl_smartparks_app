// The frame of the app: sign-in, the navigation and which page is shown. Each page lives in
// pages/ and exports `show(route)` and `reset()`.

import { APP_NAME, ApiError, DEFAULT_API_URL, WildlifeNlClient } from "./api.js";
import { buildHash, parseHash } from "./lib.js";
import * as aboutPage from "./pages/about.js";
import * as accountPage from "./pages/account.js";
import * as databasePage from "./pages/database.js";
import * as detectionsPage from "./pages/detections.js";
import * as explorePage from "./pages/explore.js";
import * as mapPage from "./pages/map.js";
import * as sensorPage from "./pages/sensor.js";
import * as sensorsPage from "./pages/sensors.js";
import { account, explain, loadSession, openSession, refreshProfile, saveSession, signOut } from "./session.js";
import { loadSensors, resetStore } from "./store.js";
import { $, busy, el, icon, note, toast } from "./ui.js";

/** The section of each page, its module and the navigation entry it lights up. */
const PAGES = {
  map: { view: "map", module: mapPage, nav: "map", title: "Live map" },
  sensors: { view: "sensors", module: sensorsPage, nav: "sensors", title: "Sensors" },
  sensor: { view: "sensor", module: sensorPage, nav: "sensors", title: "Sensor" },
  explore: { view: "explore", module: explorePage, nav: "explore", title: "Data explorer" },
  detections: { view: "detections", module: detectionsPage, nav: "detections", title: "Detections" },
  database: { view: "database", module: databasePage, nav: "database", title: "Database" },
  about: { view: "about", module: aboutPage, nav: "about", title: "About" },
  account: { view: "account", module: accountPage, nav: "account", title: "Account" },
};

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
  $({ email: "authEmail", code: "authCode", token: "authToken" }[mode]).focus();
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
  openSession({ baseUrl: client.baseUrl, token: client.token, email: credential.email || "", userID: credential.userID || "", name: "", scopes: credential.scopes || [] });
  try {
    await refreshProfile(); // proves the token works before anything is stored
  } catch (error) {
    account.session = null;
    account.api = null;
    throw error;
  }
  saveSession(remember);
  showApp();
}

function wireAuth() {
  const fail = (error) => note($("authError"), error.message || String(error), "error");

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
// Pages

function route() {
  if (!account.session) return;
  const parsed = parseHash(location.hash);
  const key = parsed.page === "sensors" && parsed.id ? "sensor" : parsed.page in PAGES && parsed.page !== "sensor" ? parsed.page : "map";
  const page = PAGES[key];
  for (const other of Object.values(PAGES)) $(`view-${other.view}`).hidden = other !== page;
  $("content").classList.toggle("bleed", key === "map");
  $("content").scrollTop = 0;
  for (const link of document.querySelectorAll(".nav-item")) {
    const active = link.dataset.view === page.nav;
    link.classList.toggle("active", active);
    if (active) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  }
  document.title = `${key === "sensor" ? parsed.id : page.title} · ${APP_NAME}`;
  Promise.resolve(page.module.show(parsed)).catch((error) => {
    const text = explain(error);
    if (text) toast(text, true);
  });
}

function drawAccount() {
  const { session } = account;
  $("sidebarUser").textContent = session.email || "Account";
  const host = new URL(session.baseUrl).host;
  const chip = $("serverChip");
  chip.textContent = host.startsWith("test-") ? "Test server" : host.startsWith("live-") ? "" : host;
  chip.title = `Connected to ${host}`;
}

function showApp() {
  $("auth").hidden = true;
  $("app").hidden = false;
  drawAccount();
  route();
}

// ---------------------------------------------------------------------------------------------
// Navigation column: folds away on a wide screen, slides in as a drawer on a narrow one

const SIDEBAR_KEY = "wnl-sidebar";

function wireSidebar() {
  const app = $("app");
  const fold = (hidden) => {
    app.classList.toggle("sidebar-hidden", hidden);
    try {
      localStorage.setItem(SIDEBAR_KEY, hidden ? "hidden" : "shown");
    } catch {
      /* the choice lasts for this page only */
    }
  };
  let stored = "";
  try {
    stored = localStorage.getItem(SIDEBAR_KEY);
  } catch {
    /* shown by default */
  }
  app.classList.toggle("sidebar-hidden", stored === "hidden");
  const drawer = (open) => app.classList.toggle("drawer-open", open);
  // the same button folds the column on a wide screen and closes the drawer on a narrow one
  $("sidebarHide").addEventListener("click", () => (app.classList.contains("drawer-open") ? drawer(false) : fold(true)));
  $("sidebarShow").addEventListener("click", () => fold(false));
  $("menuButton").addEventListener("click", () => drawer(true));
  $("sidebarBackdrop").addEventListener("click", () => drawer(false));
  $("sidebar").addEventListener("click", (event) => {
    if (event.target.closest(".nav-item")) drawer(false);
  });
}

// ---------------------------------------------------------------------------------------------
// Search: pages, sensors and animals, opened from the top bar or with Ctrl K

const search = { items: [], shown: [], active: 0 };

function drawSearch() {
  const query = $("searchInput").value.trim().toLowerCase();
  search.shown = search.items.filter((item) => !query || `${item.label} ${item.sub}`.toLowerCase().includes(query)).slice(0, 30);
  search.active = Math.min(search.active, Math.max(0, search.shown.length - 1));
  $("searchResults").replaceChildren(
    ...(search.shown.length
      ? search.shown.map((item, index) =>
          el("a", { class: `search-item${index === search.active ? " active" : ""}`, href: item.href, role: "option", "aria-selected": String(index === search.active), onclick: () => $("searchDialog").close() }, [
            icon(item.icon),
            el("span", { text: item.label }),
            el("small", { text: item.sub }),
          ]),
        )
      : [el("div", { class: "picker-empty", text: "Nothing found." })]),
  );
  const active = $("searchResults").querySelector(".active");
  if (active) active.scrollIntoView({ block: "nearest" });
}

async function openSearch() {
  if (!account.session || $("searchDialog").open) return;
  const pages = Object.entries(PAGES)
    .filter(([key]) => key !== "sensor")
    .map(([key, page]) => ({ label: page.title, sub: "Page", icon: "search", href: buildHash(key) }));
  search.items = pages;
  search.active = 0;
  $("searchInput").value = "";
  $("searchDialog").showModal();
  drawSearch();
  try {
    const sensors = await loadSensors();
    search.items = [...sensors.map((s) => ({ label: s.name, sub: [s.name !== s.id ? s.id : "", s.species, "Sensor"].filter(Boolean).join(" · "), icon: "sensor", href: buildHash("sensors", s.id) })), ...pages];
    drawSearch();
  } catch (error) {
    explain(error);
  }
}

function wireSearch() {
  $("searchButton").addEventListener("click", openSearch);
  document.addEventListener("keydown", (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
      event.preventDefault();
      openSearch();
    }
  });
  const dialog = $("searchDialog");
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) dialog.close(); // a click on the backdrop
  });
  $("searchInput").addEventListener("input", () => {
    search.active = 0;
    drawSearch();
  });
  $("searchInput").addEventListener("keydown", (event) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const count = search.shown.length;
      if (count) search.active = (search.active + (event.key === "ArrowDown" ? 1 : count - 1)) % count;
      drawSearch();
    } else if (event.key === "Enter" && search.shown[search.active]) {
      event.preventDefault();
      location.hash = search.shown[search.active].href;
      dialog.close();
    }
  });
}

const THEMES = { system: ["monitor", "Theme: follows the device"], light: ["sun", "Theme: light"], dark: ["moon", "Theme: dark"] };

function drawThemeButton() {
  const [name, label] = THEMES[window.wnlTheme.get()] || THEMES.system;
  const button = $("themeButton");
  button.querySelector("use").setAttribute("href", `#i-${name}`);
  button.title = label;
  button.setAttribute("aria-label", label);
}

async function start() {
  wireAuth();
  wireSidebar();
  wireSearch();
  drawThemeButton();
  $("themeButton").addEventListener("click", () => {
    const order = Object.keys(THEMES);
    window.wnlTheme.set(order[(order.indexOf(window.wnlTheme.get()) + 1) % order.length]);
    drawThemeButton();
  });
  $("signOutButton").addEventListener("click", () => signOut());
  window.addEventListener("hashchange", route);
  account.onSignOut = (message) => {
    if ($("searchDialog").open) $("searchDialog").close();
    resetStore();
    for (const page of Object.values(PAGES)) page.module.reset();
    showAuth(message);
  };

  const stored = loadSession();
  if (!stored) return showAuth();
  try {
    openSession(stored);
  } catch {
    return signOut();
  }
  showApp(); // show at once from the stored session, then confirm it with the server
  try {
    const before = account.session.scopes.join();
    await refreshProfile();
    drawAccount();
    if (account.session.scopes.join() !== before) {
      // the roles changed since the last visit, so what the account may list changed too
      resetStore();
      route();
    }
  } catch (error) {
    const text = explain(error);
    if (text) toast(`Could not refresh your profile: ${text}`, true);
  }
}

start();
