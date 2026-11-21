# Developers

How the app is built and why. Read [CONVENTIONS.md](CONVENTIONS.md) first.

## Principles

- **No build step.** GitHub Pages serves the repository as it is. There is no framework, no bundler and no `node_modules`. The JavaScript is standard ES modules that the browser loads directly.
- **One dependency.** MapLibre GL JS draws the maps. It comes from a CDN at a pinned version with an integrity hash. Everything else is the web platform.
- **The look of Protect.** The colour tokens in `assets/app.css` are the same as in `services/frontend/src/index.css` of Smart Parks Protect, and the components (card, button variants, callout, sidebar, sign-in card over a photograph) follow its shadcn/ui components. Rules use the tokens, never a hex value.
- **Nothing leaves the browser except API calls.** No analytics, no backend, no cookies.

## Files

```
index.html            The whole page: sign-in and the three views
VERSION               The version, shown on the Account page
assets/app.css        Design tokens and all styling
assets/img/           Logo, favicon and sign-in photographs (from Smart Parks Protect)
assets/js/theme.js    Sets the theme before the first paint
assets/js/lib.js      Pure functions: times, flattening, CSV. No DOM, no network
assets/js/api.js      WildlifeNlClient
assets/js/map.js      MapView, a small wrapper around MapLibre
assets/js/app.js      The user interface
tests/lib.test.js     Unit tests for lib.js
.nojekyll             Tells GitHub Pages to serve the files untouched
```

Rule of thumb: logic that can be wrong in a subtle way goes in `lib.js` with a test. `app.js` only reads inputs, calls `lib.js` and `api.js`, and draws.

## WildlifeNL API

The app follows the OpenAPI document the API serves at its root (`/openapi.json`), version `20260826`. The source is open: [UtrechtUniversity/wildlifenl](https://github.com/UtrechtUniversity/wildlifenl). The API sends `Access-Control-Allow-Origin: *`, so a static page can call it.

| Call | Used for | Roles |
| --- | --- | --- |
| `POST /auth/` | Ask for a login code by email (`displayNameApp`, `email`) | none |
| `PUT /auth/` | Trade the code for a credential (`token`, `scopes`, `email`, `userID`) | none |
| `GET /profile/me/` | Check the token, read the name and the roles | any account |
| `GET /borne-sensor-deployment/active/` | Suggestions for the sensor ID | `herd-manager` |
| `GET /borne-sensor-readings/sensor/{id}` | All readings of a sensor | `land-user`, `nature-area-manager`, `wildlife-manager`, `herd-manager` |
| `GET /detections/` | Detections by `start`, `end`, `latitude`, `longitude`, `radius` (metres) | `nature-area-manager`, `wildlife-manager`, `herd-manager` |

The roles are also in `SCOPES` in `api.js`; the Account page draws its access table from it. When the API changes, update `SCOPES`, this table and the README together.

Errors are problem documents (`application/problem+json` with `title`, `detail` and sometimes `errors`). `problemText` in `lib.js` turns them into one sentence. A list endpoint answers `null` when there is nothing; `WildlifeNlClient.list` turns that into an empty array.

The readings endpoint has no time filter, so the app fetches all readings of a sensor and filters by period in the browser. The table renders 200 rows at a time to stay fast with large sensors.

## Sign-in

Facts from the API's source that shaped the sign-in:

- The code has six digits. Three wrong tries delete the request; the user then needs a new code. A new code replaces the old one.
- A credential belongs to an email address and an app name together. Logging in again under the same app name returns the same token. `APP_NAME` in `api.js` is this app's name; do not change it without a reason, because users would get a new token and the name appears in the login email.
- Tokens do not expire and the API has no logout call. "Sign out" removes the token from the browser, nothing more.
- The API caches the roles of a token. After an administrator changes a role it can take a while before the API honours it.

The flow in `app.js`: `requestCode`, then `redeemCode`, then `startSession`, which calls `GET /profile/me/` before it stores anything. Signing in with a pasted token skips the first two steps. Any `401` later ends the session and returns to the sign-in card (`explain`).

## Browser storage

| Key | Where | Content |
| --- | --- | --- |
| `wnl-session` | `localStorage` when "Keep me signed in" is on, else `sessionStorage` | API address, token, email, user ID, name, roles |
| `wnl-theme` | `localStorage` | `light`, `dark` or `system` |
| `wl_nl_client` | `localStorage` | The key of the app before 2.0.0. Read once, moved to `wnl-session`, then removed |

## Map

`MapView` in `map.js` draws coloured points, an optional track and a popup. The basemaps are OpenFreeMap's `positron` (light) and `fiord` (dark), the same source Protect uses, without an API key. A map is created the first time its page is visible. On a theme change the style is replaced and the layers are added again in the `style.load` handler.

MapLibre is pinned at 5.24.1, the last line that ships a single script that works from a CDN. Version 6 is modules only and needs its worker file served from the same origin, which would mean vendoring it or adding a build step. To update the pin, change the version in both tags in `index.html` and replace the integrity hashes:

```bash
curl -sL https://unpkg.com/maplibre-gl@VERSION/dist/maplibre-gl.js | openssl dgst -sha384 -binary | openssl base64 -A
curl -sL https://unpkg.com/maplibre-gl@VERSION/dist/maplibre-gl.css | openssl dgst -sha384 -binary | openssl base64 -A
```

If the script fails to load, the map area says so and the tables keep working.

## Content security policy

`index.html` carries a policy in a `<meta>` tag, because GitHub Pages cannot send headers. Scripts load only from this site and `unpkg.com`; there are no inline scripts, which is why the theme code is its own file. `connect-src` allows this site (also when served locally over HTTP) and any HTTPS address, because the WildlifeNL API address is a setting and the map tiles come from OpenFreeMap. `worker-src blob:` is for MapLibre's worker. A new external resource needs a new entry there.

## Tests

`npm test` runs `node --test`, which finds `tests/lib.test.js`. No packages to install. CI (`.github/workflows/ci.yml`) runs the same on every push and pull request.

There is no automated browser test in the repository, to keep it free of dependencies. Before a release, go through the checklist below in a browser, on a desktop and on a phone width, in both themes.

## Release

1. Check by hand: sign in with a code, sign in with a token, load readings, load detections, sign out, reload while signed in.
2. Update `VERSION` and move the Unreleased entries in `CHANGELOG.md` under the new version and date.
3. Commit and push to `main`. GitHub Pages publishes within a minute or two.

Browsers cache the JavaScript files for about ten minutes on GitHub Pages; a hard reload shows a new release at once.
