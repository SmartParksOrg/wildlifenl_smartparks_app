# Developers

How the app is built and why. Read [CONVENTIONS.md](CONVENTIONS.md) first.

## Principles

- **No build step.** GitHub Pages serves the repository as it is. There is no framework, no bundler and no `node_modules`. The JavaScript is standard ES modules that the browser loads directly.
- **Two libraries.** MapLibre GL JS draws the maps and Apache ECharts the charts, the same two as in Protect. Both come from a CDN at a pinned version with an integrity hash. Everything else is the web platform.
- **The look of Protect.** The colour tokens in `assets/app.css` are the same as in `services/frontend/src/index.css` of Smart Parks Protect, and the components (card, button variants, callout, sidebar, sign-in card over a photograph) follow its shadcn/ui components. Rules use the tokens, never a hex value.
- **Nothing leaves the browser except API calls.** No analytics, no backend, no cookies.

## Files

```
index.html               The whole page: sign-in and a section per page
VERSION                  The version, shown on the Account page
assets/app.css           Design tokens and all styling
assets/img/              Logo, favicon and sign-in photographs (from Smart Parks Protect)
assets/img/icons/        Marker icons per species (EarthRanger's, as used in Protect)
assets/js/theme.js       Sets the theme before the first paint
assets/js/lib.js         Pure functions: times, tracks, metrics, buckets, CSV. No DOM, no network
assets/js/api.js         WildlifeNlClient
assets/js/session.js     The signed-in account: token storage, roles, sign out
assets/js/store.js       The sensors and their readings, fetched once and kept in memory
assets/js/detections.js  The detections: searching an area, remembered detector places
assets/js/ui.js          Building blocks: elements, callouts, tiles, DataTable, MultiPicker
assets/js/map.js         MapView (a page's small map) and LiveMap (the live map)
assets/js/chart.js       LineChart on ECharts, loaded on first use
assets/js/app.js         Sign-in, the frame (top bar, folding navigation, search) and the router
assets/js/pages/*.js     One module per page: map, sensors, sensor, explore, detections, database, about, account
tests/lib.test.js        Unit tests for lib.js
.nojekyll                Tells GitHub Pages to serve the files untouched
```

Rule of thumb: logic that can be wrong in a subtle way goes in `lib.js` with a test. A page module reads inputs, asks `store.js` for data and draws.

## Pages and addresses

The address after `#` chooses the page: `#/map`, `#/sensors`, `#/sensors/{id}`, `#/explore`, `#/detections`, `#/database`, `#/about`, `#/account`. `parseHash` and `buildHash` in `lib.js` read and write it. `app.js` shows the matching section and calls the page module's `show(route)`; on sign out it calls every module's `reset()`.

- `#/map?sensor={id}&track=1` selects a sensor and draws its track; the page then cleans the address.
- `#/explore?sensors=a,b&metrics=temperature,speed&range=168&bucket=1h` is the whole state of the data explorer, so a link reproduces a view.

## Frame

The frame follows `AppLayout.tsx` of Protect. The top bar is on every screen: the logo with the product name, the search, the server (shown when it is not the live one) and the theme switch. The navigation column folds to a narrow rail with one button; the choice is kept under `wnl-sidebar`. Below 1024 px the column is a drawer that the menu button opens.

The search is a native `<dialog>`. It lists the pages and the sensors of `store.js` and filters as you type; Ctrl K or Cmd K opens it.

The name of the app is `APP_NAME` in `api.js`. WildlifeNL also uses it in the login email and to tell tokens apart: one token per email address and app name. Renaming the app therefore gives people a new token at their next sign-in; a stored session keeps working.

## Database page

`databaseModel` in `lib.js` reads the API's OpenAPI document (`GET /openapi.json`) and returns the tables, their fields in plain words (`fieldKind`) and the links between them. A link is a field that refers to another table, or an `...ID` field named after one. Inputs (`...Record`, `...InputBody`), errors and small values inside a table (`Point`, `Accelero`) are left out.

`DATA_GROUPS` in `lib.js` holds the one thing the API cannot tell: which subject a table belongs to, its name in plain words and one line of explanation. A table the API adds later shows up under "Other" with its own name until someone adds it there.

`pages/database.js` draws the model as SVG: a column per subject, a box per table, a curve per link. A click on a box highlights its links and lists its fields.

## Sensors and readings

`store.js` is the one place that knows which sensors exist. A sensor comes from `GET /borne-sensor-deployment/active/` (herd managers only) or from the IDs the user added, kept in `localStorage` under `wnl-sensors`. `loadSensors()` and `loadReadings(id)` fetch once and keep the result in memory until `force` or sign out; all pages share that cache, so opening a sensor page after the map costs no request.

The API has no "latest reading" call, no limit and no time filter: one request returns every reading of a sensor, uncompressed. On the test server a simulated sensor holds about 26,000 readings, 4.5 MB per request. Two things keep the app quick:

- **Recent readings.** The API answers newest first (it sorts that way in its source). `WildlifeNlClient.recentReadings` reads the first 64 KB of the answer, a few hundred readings, and hangs up; `leadingObjects` in `lib.js` parses the whole objects of that cut-off text. The sensors list and the sensor panel on the map use `loadRecent`, which is why the list shows "over 423" readings for a large sensor: the total is not known until everything is loaded.
- **Everything only when needed.** A track, a sensor page and the data explorer need all readings and call `loadReadings`. The period is then filtered in the browser.

A deployment carries the animal's current location, which places the marker without any reading.

Measured against the test server with 13 sensors: the live map shows its markers in 0.4 s, the sensors list is complete in 1.2 s (about 0.6 MB), and the first track or sensor page of a large sensor takes about 1.5 s (4.5 MB).

## WildlifeNL API

The app follows the OpenAPI document the API serves at its root (`/openapi.json`), version `20260826` on the live server (`live-api-wildlifenl.uu.nl`) and `20261116` on the test server (`test-api-wildlifenl.uu.nl`); the calls this app uses are the same on both. The source is open: [UtrechtUniversity/wildlifenl](https://github.com/UtrechtUniversity/wildlifenl). The API sends `Access-Control-Allow-Origin: *`, so a static page can call it.

| Call | Used for | Roles |
| --- | --- | --- |
| `POST /auth/` | Ask for a login code by email (`displayNameApp`, `email`) | none |
| `PUT /auth/` | Trade the code for a credential (`token`, `scopes`, `email`, `userID`) | none |
| `GET /profile/me/` | Check the token, read the name and the roles | any account |
| `GET /borne-sensor-deployment/active/` | Suggestions for the sensor ID | `herd-manager` |
| `GET /borne-sensor-readings/sensor/{id}` | All readings of a sensor | `land-user`, `nature-area-manager`, `wildlife-manager`, `herd-manager` |
| `GET /detections/` | Detections by `start`, `end`, `latitude`, `longitude`, `radius` (metres, at most 10000) | `nature-area-manager`, `wildlife-manager`, `herd-manager` |

The roles are also in `SCOPES` in `api.js`; the Account page draws its access table from it. When the API changes, update `SCOPES`, this table and the README together.

Errors are problem documents (`application/problem+json` with `title`, `detail` and sometimes `errors`). `problemText` in `lib.js` turns them into one sentence. A list endpoint answers `null` when there is nothing; `WildlifeNlClient.list` turns that into an empty array.

Tables render 200 rows at a time to stay fast with large sensors.

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
| `wnl-sensors` | `localStorage` | The sensor IDs the user added by hand |
| `wnl-map-hidden` | `localStorage` | The sensors hidden on the live map |
| `wnl-basemap` | `localStorage` | The chosen base map |
| `wnl-sidebar` | `localStorage` | Whether the navigation column is folded |
| `wnl-terrain` | `localStorage` | Whether 3D terrain is on |
| `wnl-map-detectors` | `localStorage` | Whether the detectors layer is shown |
| `wnl-server` | `localStorage` | The platform of the last sign-in, chosen again next time |
| `wnl-detection-places:{server}` | `localStorage` | The places where detections were found, so the next visit asks only there |
| `wl_nl_client` | `localStorage` | The key of the app before 2.0.0. Read once, moved to `wnl-session`, then removed |

## Map

`map.js` has two classes on a shared base. `MapView` draws the points of one page with an optional track. `LiveMap` draws a marker per sensor, a coloured line and points per track, and the detections; it tells the page about clicks through callbacks. Markers are made the way Protect makes them (`markerImage`): a white disc with a green ring and the species icon, blue with a halo when selected, a rounded square for a sensor without an animal. The sensor source is clustered with Protect's values (radius 28 px, up to zoom 14), so markers that would overlap become one disc with a count. `MapView` can also draw a search circle and report clicks beside its points, which the detections page uses. Both take their data as plain lists and rebuild their GeoJSON sources in `sources()`, so after a style change (`style.load`) the same data is drawn again.

`BASEMAPS` holds the base maps. Four are OpenFreeMap vector styles (`positron`, `liberty`, `bright`, `fiord`), the same as in Protect. Three are picture tiles wrapped in a small style by `rasterStyle`: Esri World Imagery, the PDOK aerial photo of the Netherlands and OpenTopoMap. None needs a key, which is why they replace Protect's MapTiler satellite layer. `dark: true` marks a ground that needs light labels and the lighter track colours. The choice is stored under `wnl-basemap`; the default follows the theme. Labels use the font `Noto Sans Regular`, the glyphs OpenFreeMap serves, also on the picture maps.

3D terrain (`setTerrain`, `applyTerrain`) uses the open Terrain Tiles on AWS in the `terrarium` encoding, again without a key: a hillshade layer under the data and MapLibre's terrain with Protect's exaggeration (1.3) and pitch (55). The choice is stored under `wnl-terrain`. A style change drops sources and layers, so terrain and data are applied again on `style.load`.

The live map page (`pages/map.js`) places its controls as Protect does: the Layers button top left, the tools as square buttons top right (`.map-tools`), MapLibre's zoom, north and locate bottom right, and the panels in one column beside the tools (`.map-cards`), where the layers panel shrinks so the selected sensor always fits under it. On a phone the column rises from the bottom. Measuring is a mode of `LiveMap`: while it is on, a click adds a point to a dashed line and the page adds up the legs.

A track draws every fix in its line but at most 2000 dots, and the popup of a point is made on the click, so a track of tens of thousands of points appears at once. A track is known by its slot in `TRACK_COLORS` (Protect's track colours), with a lighter set of the same hues for a dark ground.

## Detections

`GET /detections/` needs a centre and a radius of at most 10 km, and the API has no list of detectors. `detections.js` is the one module that deals with that; the live map and the Detections page both read from it and hear about changes through `onDetections`.

- `searchBox` covers a box with a honeycomb of 10 km circles (`circleGrid` in `lib.js`) and asks them one by one. More than 300 circles are refused with a hint to zoom in.
- `searchCircle` spaces the requests 700 ms apart, about 85 a minute, under the API's default of 120 requests a minute per token (`RATE_LIMIT_MAX_REQUESTS` in the API's source). A `429` answer is waited out for 20 seconds and tried again.
- Every place with a detection is kept in `localStorage` under `wnl-detection-places:{server}`, rounded to about 100 metres. `coverPlaces` turns those places into the fewest circles, and that is all `loadDetections` asks.
- `detectorsOf` groups detections into detectors, one per `deploymentID` and place. The live map draws them with `LiveMap.setDetectors`, as a diamond with a camera, Protect's shape for events.

The design documents of the API (`docs/FunctionalDesign.md` in its repository) describe what detections are for: people view them on a map, and a detection of less than an hour old raises an alarm for every zone that contains it and lists its species.

A detection's `uri` comes from another system, so the app only makes it a link when `webLink` in `lib.js` accepts it as an `http` or `https` address.

### What Protect sends

The WildlifeNL connector of Protect (`shared/shared/integrations/connectors/wildlifenl.py`) posts one detection per species of a `SPECIES_DETECTION` event, which is how AddaxAI Connect pictures arrive: `deploymentID` is the camera's sensor ID, `sensorType` is `visual`, `start` and `end` are the capture time, `uri` is the link back, and `animals` holds one entry with the best confidence as a percentage and the event title as `description`.

Note for the Protect side: the test server (API `20261116`) wants the species as `speciesName`, the exact Latin name, where the live server (API `20260826`) still wants `speciesID`. The connector sends `speciesID`, so the test server refuses its detections until the connector follows.

MapLibre is pinned at 5.24.1, the last line that ships a single script that works from a CDN. Version 6 is modules only and needs its worker file served from the same origin, which would mean vendoring it or adding a build step. To update the pin, change the version in both tags in `index.html` and replace the integrity hashes:

```bash
curl -sL https://unpkg.com/maplibre-gl@VERSION/dist/maplibre-gl.js | openssl dgst -sha384 -binary | openssl base64 -A
curl -sL https://unpkg.com/maplibre-gl@VERSION/dist/maplibre-gl.css | openssl dgst -sha384 -binary | openssl base64 -A
```

If the script fails to load, the map area says so and the tables keep working.

## Charts

`chart.js` wraps Apache ECharts 6.1.0. The script (about 1 MB) is added to the page the first time a chart is drawn, from unpkg with an integrity hash, so the map and the lists do not pay for it. To update it, change `ECHARTS_URL` and `ECHARTS_HASH`; the hash is made the same way as for MapLibre.

Rules the charts follow: one chart per metric, never two scales in one chart; a line keeps its colour while its sensor stays chosen (`colours` in `pages/explore.js`); a legend only when there is more than one line; the table under the charts holds the same numbers. The series colours are Protect's chart palette (`PALETTE`).

`metricSeries`, `bucketSeries` and `autoBucket` in `lib.js` turn readings into the points of a line. Speed is the straight-line distance between two fixes over the time between them.

## Content security policy

`index.html` carries a policy in a `<meta>` tag, because GitHub Pages cannot send headers. Scripts load only from this site and `unpkg.com`; there are no inline scripts, which is why the theme code is its own file. `connect-src` allows this site (also when served locally over HTTP) and any HTTPS address, because the WildlifeNL API address is a setting and the map tiles come from OpenFreeMap. `worker-src blob:` is for MapLibre's worker. A new external resource needs a new entry there.

## Tests

`npm test` runs `node --test`, which finds `tests/lib.test.js`. No packages to install. CI (`.github/workflows/ci.yml`) runs the same on every push and pull request.

There is no automated browser test in the repository, to keep it free of dependencies. Before a release, go through the checklist below in a browser, on a desktop and on a phone width, in both themes.

## Release

1. Check by hand: sign in with a code, sign in with a token, the live map with a track, the search, the sensors list, a sensor page, the data explorer, detections, the database page, sign out, reload while signed in.
2. Update `VERSION` and move the Unreleased entries in `CHANGELOG.md` under the new version and date.
3. Commit and push to `main`. GitHub Pages publishes within a minute or two.

Browsers cache the JavaScript files for about ten minutes on GitHub Pages; a hard reload shows a new release at once.
