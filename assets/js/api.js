// The WildlifeNL API client. It throws ApiError with a message a person can read.

import { leadingObjects, problemText } from "./lib.js";

export const DEFAULT_API_URL = "https://live-api-wildlifenl.uu.nl";
/** The platforms offered at sign-in. A token belongs to one of them. */
export const SERVERS = [
  { label: "Live", url: DEFAULT_API_URL },
  { label: "Test", url: "https://test-api-wildlifenl.uu.nl" },
];
/** The name WildlifeNL shows in the login email. A token belongs to an email address and an
 * app name together, so this app gets its own token and never replaces the one Protect uses. */
export const APP_NAME = "WildlifeNL Protect";
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
  reports: ["nature-area-manager", "wildlife-manager", "herd-manager"],
  visits: ["nature-area-manager", "wildlife-manager", "herd-manager"],
  zones: ["land-user", "wildlife-manager"],
  animal: ["herd-manager"],
  report: ["wildlife-manager", "researcher"],
  research: ["researcher"],
  alarms: ["administrator", "researcher"],
  profiles: ["administrator"],
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

  /** The newest readings of a sensor without downloading all of them. The API has no limit
   * or time filter and a sensor can hold megabytes, but it answers newest first, so this
   * reads the first `maxBytes` of the answer and hangs up. `complete` tells whether that
   * was the whole answer. */
  async recentReadings(sensorId, maxBytes = 65536) {
    const control = new AbortController();
    const timer = setTimeout(() => control.abort(), TIMEOUT_MS);
    try {
      const response = await fetch(`${this.baseUrl}/borne-sensor-readings/sensor/${encodeURIComponent(sensorId)}`, {
        headers: { Accept: "application/json", Authorization: `Bearer ${this.token}` },
        signal: control.signal,
        cache: "no-store",
      });
      if (!response.ok) {
        const text = await response.text();
        let body = text;
        try {
          body = JSON.parse(text);
        } catch {
          /* not a problem document */
        }
        throw new ApiError(problemText(response.status, body), response.status);
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let text = "";
      let complete = false;
      while (text.length < maxBytes) {
        const { done, value } = await reader.read();
        if (done) {
          complete = true;
          break;
        }
        text += decoder.decode(value, { stream: true });
      }
      return { readings: leadingObjects(text), complete };
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(`Could not read from ${new URL(this.baseUrl).host}. Check your connection.`);
    } finally {
      clearTimeout(timer);
      control.abort();
    }
  }

  /** What happened within `radius` metres of a point in a period: `kind` is `detections`,
   * `interactions` or `animals`. The API allows at most 10 km. */
  around(kind, { start, end, latitude, longitude, radius }) {
    const query = new URLSearchParams({ start, end, latitude, longitude, radius });
    return this.list(`/${kind}/?${query}`);
  }

  /** The API's own description of everything it offers and stores. */
  openapi() {
    return this.call("GET", "/openapi.json");
  }
}
