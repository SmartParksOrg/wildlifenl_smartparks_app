// The frame of the app: sign-in, the navigation and which page is shown. Each page lives in
// pages/ and exports `show(route)` and `reset()`.

import { APP_NAME, ApiError, DEFAULT_API_URL, WildlifeNlClient } from "./api.js";
import { parseHash } from "./lib.js";
import * as accountPage from "./pages/account.js";
import * as detectionsPage from "./pages/detections.js";
import * as explorePage from "./pages/explore.js";
import * as mapPage from "./pages/map.js";
import * as sensorPage from "./pages/sensor.js";
import * as sensorsPage from "./pages/sensors.js";
import { account, explain, loadSession, openSession, refreshProfile, saveSession, signOut } from "./session.js";
import { resetStore } from "./store.js";
import { $, busy, note, toast } from "./ui.js";

/** The section of each page, its module and the navigation entry it lights up. */
const PAGES = {
  map: { view: "map", module: mapPage, nav: "map", title: "Live map" },
  sensors: { view: "sensors", module: sensorsPage, nav: "sensors", title: "Sensors" },
  sensor: { view: "sensor", module: sensorPage, nav: "sensors", title: "Sensor" },
  explore: { view: "explore", module: explorePage, nav: "explore", title: "Data explorer" },
  detections: { view: "detections", module: detectionsPage, nav: "detections", title: "Detections" },
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

function showApp() {
  $("auth").hidden = true;
  $("app").hidden = false;
  $("sidebarUser").textContent = account.session.email;
  $("sidebarUser").title = account.session.email;
  route();
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
  drawThemeButton();
  $("themeButton").addEventListener("click", () => {
    const order = Object.keys(THEMES);
    window.wnlTheme.set(order[(order.indexOf(window.wnlTheme.get()) + 1) % order.length]);
    drawThemeButton();
  });
  $("signOutButton").addEventListener("click", () => signOut());
  window.addEventListener("hashchange", route);
  account.onSignOut = (message) => {
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
    $("sidebarUser").textContent = account.session.email;
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
