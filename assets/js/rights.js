// What the API of this session offers: its own description (the OpenAPI document), read once
// per server, and the calls in it with the roles that may make them. The roles for reading
// are in SCOPES in api.js; the calls that change something are looked up here, so the app
// follows the server it is signed in to.

import { apiOperations } from "./lib.js";
import { account } from "./session.js";

const state = { server: "", document: null, loading: null, operations: new Map() };

/** The API's description of everything it offers and stores, fetched once per server. */
export function loadApi() {
  const { baseUrl } = account.session;
  if (state.document && state.server === baseUrl) return Promise.resolve(state.document);
  if (!state.loading) {
    state.loading = account.api
      .openapi()
      .then((document) => {
        // a sign out while the answer was on its way leaves nothing behind
        if (account.session && account.session.baseUrl === baseUrl) {
          state.server = baseUrl;
          state.document = document;
          state.operations = new Map(apiOperations(document).map((operation) => [`${operation.method} ${operation.path}`, operation]));
        }
        return document;
      })
      .finally(() => (state.loading = null));
  }
  return state.loading;
}

/** A call by its method and path as the API writes it (`/zone/{id}`), or null when this
 * server does not have it. Known after `loadApi`. */
export function operationOf(method, path) {
  return state.operations.get(`${method} ${path}`) || null;
}

/** The calls that change something and need a token. Known after `loadApi`. */
export function writeOperations() {
  return [...state.operations.values()].filter((operation) => operation.method !== "GET" && !operation.open);
}

export function resetRights() {
  state.server = "";
  state.document = null;
  state.operations = new Map();
}
