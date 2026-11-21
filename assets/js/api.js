// The two servers this app talks to: WildlifeNL (always) and Smart Parks Protect (only for the
// comparison). Both clients throw ApiError with a message a person can read.

import { problemText } from "./lib.js";

export const DEFAULT_API_URL = "https://live-api-wildlifenl.uu.nl";
/** The name WildlifeNL shows in the login email. A token belongs to an email address and an
 * app name together, so this app gets its own token and never replaces the one Protect uses. */
export const APP_NAME = "Smart Parks WildlifeNL check";
const TIMEOUT_MS = 30000;

export class ApiError extends Error {
  constructor(message, status = 0) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

export function cleanBaseUrl(url) {
  const text = String(url || "").trim().replace(/\/+$/, "");
  if (!/^https?:\/\/[^\s/]+/i.test(text)) throw new ApiError("Enter a full address that starts with https://");
  return text;
}

async function request(url, { method = "GET", headers = {}, body } = {}) {
  let response;
  try {
    response = await fetch(url, {
      method,
      headers: { Accept: "application/json", ...headers },
      body,
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
  } catch (error) {
    if (error.name === "TimeoutError") throw new ApiError(`No answer from ${new URL(url).host} within ${TIMEOUT_MS / 1000} seconds`);
    throw new ApiError(`Could not reach ${new URL(url).host}. Check the address and your connection; the server must also allow requests from this page (CORS).`);
  }
  const text = await response.text();
  let data = text;
  if (text && /json/i.test(response.headers.get("content-type") || "")) {
    try {
      data = JSON.parse(text);
    } catch {
      throw new ApiError(`${new URL(url).host} sent an answer that is not valid JSON`, response.status);
    }
  }
  if (!response.ok) throw new ApiError(problemText(response.status, data), response.status);
  return text ? data : null;
}

/** Roles that may call each read endpoint, from the API's OpenAPI document (version 20260826).
 * An empty list means every signed-in account. */
export const SCOPES = {
  deployments: ["herd-manager"],
  readings: ["land-user", "nature-area-manager", "wildlife-manager", "herd-manager"],
  detections: ["nature-area-manager", "wildlife-manager", "herd-manager"],
};

export class WildlifeNlClient {
  constructor(baseUrl, token = "") {
    this.baseUrl = cleanBaseUrl(baseUrl);
    this.token = token;
  }

  call(method, path, body) {
    const headers = {};
    if (this.token) headers.Authorization = `Bearer ${this.token}`;
    if (body !== undefined) headers["Content-Type"] = "application/json";
    return request(this.baseUrl + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  }

  /** Step one of the login: WildlifeNL emails a six digit code. */
  requestCode(email) {
    return this.call("POST", "/auth/", { displayNameApp: APP_NAME, email });
  }

  /** Step two: the code for a credential with `token`, `scopes`, `email` and `userID`. */
  redeemCode(email, code) {
    return this.call("PUT", "/auth/", { email, code });
  }

  profile() {
    return this.call("GET", "/profile/me/");
  }

  async list(path) {
    const data = await this.call("GET", path);
    return Array.isArray(data) ? data : [];
  }

  activeDeployments() {
    return this.list("/borne-sensor-deployment/active/");
  }

  readings(sensorId) {
    return this.list(`/borne-sensor-readings/sensor/${encodeURIComponent(sensorId)}`);
  }

  detections({ start, end, latitude, longitude, radius }) {
    const query = new URLSearchParams({ start, end, latitude, longitude, radius });
    return this.list(`/detections/?${query}`);
  }

  species() {
    return this.list("/species/");
  }
}

/** Read access to a Smart Parks Protect server, for the comparison. The access token lives in
 * memory only. */
export class ProtectClient {
  constructor(baseUrl) {
    this.baseUrl = cleanBaseUrl(baseUrl);
    this.token = "";
  }

  async login(email, password) {
    const body = new URLSearchParams({ username: email, password });
    const answer = await request(`${this.baseUrl}/api/v1/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    if (!answer || !answer.access_token) throw new ApiError("Protect did not return an access token");
    this.token = answer.access_token;
  }

  async get(path, params = {}) {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) if (value !== undefined && value !== "") query.set(key, value);
    const suffix = query.size ? `?${query}` : "";
    return request(`${this.baseUrl}/api/v1${path}${suffix}`, { headers: { Authorization: `Bearer ${this.token}` } });
  }

  async projects() {
    const page = await this.get("/projects", { limit: 100 });
    return page?.items || [];
  }

  async devices(projectId) {
    const page = await this.get("/devices", { project_id: projectId, limit: 500 });
    return page?.items || [];
  }

  /** The device's own fixes in the window, newest first, at most 1000 (the server's bound). */
  async positions(projectId, deviceId, from, to) {
    const rows = await this.get(`/projects/${projectId}/positions`, {
      device_id: deviceId,
      from: from ? new Date(from).toISOString() : undefined,
      to: to ? new Date(to).toISOString() : undefined,
      limit: 1000,
    });
    return Array.isArray(rows) ? rows : [];
  }
}
