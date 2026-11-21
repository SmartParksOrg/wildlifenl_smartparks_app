// The signed-in account: the token, the API client and what the account may do.

import { ApiError, DEFAULT_API_URL, WildlifeNlClient } from "./api.js";

const SESSION_KEY = "wnl-session";
const LEGACY_KEY = "wl_nl_client"; // the single-file app before 2.0.0

/** `session` is `{baseUrl, token, email, userID, name, scopes}` or null; `api` is its client. */
export const account = { session: null, api: null, onSignOut: () => {} };

function readStored(storage, key) {
  try {
    return JSON.parse(storage.getItem(key) || "null");
  } catch {
    return null;
  }
}

/** The stored session, or the token the old app remembered, moved to the new key. */
export function loadSession() {
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

/** Stores the session; without `remember` it stays where it was. */
export function saveSession(remember) {
  const keep = remember ?? localStorage.getItem(SESSION_KEY) !== null;
  localStorage.removeItem(SESSION_KEY);
  sessionStorage.removeItem(SESSION_KEY);
  (keep ? localStorage : sessionStorage).setItem(SESSION_KEY, JSON.stringify(account.session));
}

export function openSession(session) {
  account.session = session;
  account.api = new WildlifeNlClient(session.baseUrl, session.token);
}

export function signOut(message = "") {
  localStorage.removeItem(SESSION_KEY);
  sessionStorage.removeItem(SESSION_KEY);
  account.session = null;
  account.api = null;
  account.onSignOut(message);
}

export function hasScope(needed) {
  return needed.length === 0 || needed.some((scope) => account.session.scopes.includes(scope));
}

/** Turns a failed call into text for a callout; a refused token ends the session. */
export function explain(error) {
  if (error instanceof ApiError && error.status === 401 && account.session) {
    signOut("WildlifeNL no longer accepts this token. Sign in again.");
    return "";
  }
  if (!(error instanceof ApiError)) console.error(error);
  return error.message || String(error);
}

export async function refreshProfile() {
  const { session, api } = account;
  const profile = await api.profile();
  session.email = profile.email || session.email;
  session.userID = profile.ID || session.userID;
  session.name = profile.name || "";
  session.scopes = (profile.roles || []).map((role) => role.name).filter(Boolean);
  saveSession();
}
