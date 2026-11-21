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
assets/js/detections.js  Detections and reports: searching an area, remembered places
assets/js/people.js      People on the move: tracking readings, contacts, sent messages, alarms
assets/js/records.js     Every other kind of record: where it is read and what it links to
assets/js/rights.js      The API's own description, read once: its calls and the roles they ask for
assets/js/writes.js      What a person can change: the actions per kind of record
assets/js/form.js        The dialog with the form of a change, or the question to confirm one
assets/js/ui.js          Building blocks: elements, callouts, tiles, DataTable, MultiPicker
assets/js/map.js         MapView (a page's small map) and LiveMap (the live map)
assets/js/chart.js       LineChart on ECharts, loaded on first use
assets/js/app.js         Sign-in, the frame (top bar, folding navigation, search) and the router
assets/js/pages/*.js     One module per page: map (with map-layers), sensors (the Animals and Sensors
                         lists), sensor (the animal page and the sensor page), explore, detections,
                         records (every other list and record), database, about, account
tests/lib.test.js        Unit tests for lib.js
.nojekyll                Tells GitHub Pages to serve the files untouched
```

Rule of thumb: logic that can be wrong in a subtle way goes in `lib.js` with a test. A page module reads inputs, asks `store.js` for data and draws.

## Pages and addresses

The address after `#` chooses the page: `#/map`, `#/animals`, `#/animals/{animal id}`, `#/sensors`, `#/sensors/{sensor id}`, `#/explore`, `#/detections`, `#/data/{kind}`, `#/data/{kind}/{id}`, `#/database`, `#/about`, `#/account`. `parseHash` and `buildHash` in `lib.js` read and write it. `app.js` shows the matching section and calls the page module's `show(route)`; on sign out it calls every module's `reset()`.

- `#/map?animal={id}&track=1` selects an animal and draws its track; `?sensor=`, `?detector=`, `?report=`, `?area=`, `?at=lat,lng` and `?layers={tab}` work the same way. The page then cleans the address.
- `#/explore?sensors=a,b&metrics=temperature,speed&range=168&bucket=1h` is the whole state of the data explorer, so a link reproduces a view.

## Frame

The frame follows `AppLayout.tsx` of Protect. The top bar is on every screen: the logo with the product name, the search, the server (shown when it is not the live one) and the theme switch. The navigation column folds to a narrow rail with one button; the choice is kept under `wnl-sidebar`. Below 1024 px the column is a drawer that the menu button opens.

The search is a native `<dialog>`. It lists the pages and the sensors of `store.js` and filters as you type; Ctrl K or Cmd K opens it.

The name of the app is `APP_NAME` in `api.js`. WildlifeNL also uses it in the login email and to tell tokens apart: one token per email address and app name. Renaming the app therefore gives people a new token at their next sign-in; a stored session keeps working.

## Database page

`databaseModel` in `lib.js` reads the API's OpenAPI document (`GET /openapi.json`) and returns the tables, their fields in plain words (`fieldKind`) and the links between them. A link is a field that refers to another table, or an `...ID` field named after one. Inputs (`...Record`, `...InputBody`), errors and small values inside a table (`Point`, `Accelero`) are left out.

`DATA_GROUPS` in `lib.js` holds the one thing the API cannot tell: which subject a table belongs to, its name in plain words and one line of explanation. A table the API adds later shows up under "Other" with its own name until someone adds it there.

`pages/database.js` draws the model as SVG: a column per subject, a box per table, a curve per link. A click on a box highlights its links and lists its fields.

## Animals and sensors

A sensor deployment in WildlifeNL ties a sensor to an animal, the way Protect ties a device to an entity. The app follows Protect: the animal is the object people see, the sensor the technical source. In the code the sensor stays the key, because the readings hang under the sensor ID: `store.js` holds sensors, each with its `animal` when it is on one, and `sensorByAnimal` goes from an animal to its sensor.

- The Animals list and the Sensors list are one module (`pages/sensors.js`) with two descriptions in `LISTS`.
- The animal page and the sensor page are one module (`pages/sensor.js`): the same facts, track, charts and readings, led by the animal or by the sensor, with a button to the other side.
- On the live map the Animals tab holds the animals and the Sensors tab every sensor. A sensor on an animal is `off` there: it is drawn as a sensor only once it is ticked or picked, because its animal is on the map already. The map draws both in one clustered layer and tells them apart by the first letter of the item ID (`a:` or `s:`).

## People

`people.js` reads what WildlifeNL knows about people on the move: tracking readings (where the recreation app recorded someone), contacts (a phone near an animal's sensor), conveyances (the messages and alarms shown to someone) and alarms. Every account may read its own (`.../me/`); a researcher gets those of every experiment (`.../experiment/{id}`), and an administrator or researcher all alarms. A part that is refused leaves the rest standing. Names come from the records that name a person, then from `GET /user/{id}` for the ones still unknown.

On the live map people are a layer with a track per person, in the same track colours as the animals (a track key is a sensor ID, or `p:` and a user ID). Contacts and alarms join the reports in the Events tab; an event ID starts with `r:`, `c:` or `l:`. An alarm is placed at what caused it, else in the middle of its zone (`alarmPlace`).

## Other records

`records.js` describes every kind of record that has no page of its own (`TYPES`): where its list and a single record are read, which roles that needs, the columns of its list and the lists that hang under one record. `pages/records.js` draws a list page and a record page for all of them from the data itself.

Links come from two places. `FIELD_TYPES` says which kind of record a field holds by the field's name (`species`, `user`, `zone`, `questionnaire` and so on), and `linkOf` turns such a value into a link; it also knows that a `sensorID` leads to a sensor page, an animal to an animal page and a `deploymentID` to the detections of that detector. Every record that passes by is kept in memory (`keep`), so a record page can show what was seen of it elsewhere when the account may not read it directly.

To add a kind of record: add it to `TYPES`, add the field names that point at it to `FIELD_TYPES`, and add it to `DATA_GROUPS` in `lib.js` so the Database page names it.

A kind with a `mine` path also has a list of the account's own records at `#/data/{kind}?mine=1`, read from that path: My reports, My alarms, My messages and My experiments. A kind marked `own` only ever holds the account's own (zones, answers), so its list is named "My ..." without a second address.

## Navigation

The navigation in `index.html` has a section per audience: Monitor, Mine, Research, Analyze, Admin and Reference. One rule decides who sees an entry: it shows when the account has one of the roles under `data-needs` and none of those under `data-not`. Both name a key of `SCOPES` in `api.js`; an entry without either is for every account. `drawAccount` in `app.js` applies the rule and leaves out a section without entries. A page that sits in two sections (Species under Admin and under Reference, the people under Admin and under Monitor) is shown in one of them through `data-not`.

The search lists the entries the account sees, so it needs no list of its own.

## Changing things

The app reads the roles for a write call, and the fields the call takes, from the OpenAPI document of the server it is signed in to (`GET /openapi.json`). Nothing about a write call is copied into the code except which ones the app offers and where.

- `rights.js` fetches the document once per session (`loadApi`, which the Database page shares) and keeps the calls by method and path. `apiOperations` in `lib.js` reads per call the roles (`security`), whether it needs a token and the schema of its body.
- `writes.js` holds `ACTIONS`: per kind of record the buttons, each one call (`["POST", "/zone/"]`), above the list or on the page of a record. A button is drawn when the server has the call, the account has one of its roles and `show(record)` agrees. `drawActions(target, kind, where, record, after)` is all a page calls.
- `formFields` in `lib.js` turns the schema of a body into fields: it skips what is `readOnly`, and names a kind per field (text, number, moment, choice, place, outline, details, list of details). `formValues` fills a form from a record (`speciesID` from `species.ID`, the way the API returns what it takes) and `formBody` turns the form back into the body. Both have tests.
- `form.js` draws the fields in a native `<dialog>`. The browser checks what is needed, the shortest length, the pattern and the bounds; `formBody` checks the rest. A field named after a kind of record (`REFERS` in `writes.js`) is a list to pick from. A place is two numbers or a click on the map of the dialog; an outline is drawn there corner by corner. Optional details are shown by a rule of the action (`when`) or ticked by the person.
- An error of the API is shown in the dialog, which stays open with what was typed.
- An action with `run(record)` does everything itself in place of one form and one call; its `call` only says which call decides who may. "Answer the questions" is one.
- After a change `runAction` drops what `records.js` remembered of the record (`forget`), keeps the answer when it is the record itself (`remember`), and the page reads again.

Facts from the API's source that shaped the actions:

- The calls that delete an answer option, a question, a questionnaire, a message or an experiment name no role, but the API only carries them out for the owner of the experiment. The app asks for `researcher` there (`needs`) and hides the buttons on an experiment of someone else (`own`).
- An experiment, and what hangs under it, can only be changed before it starts.
- A new sensor deployment ends every earlier deployment of that sensor at the new start.
- `PUT /profile/me/` replaces the whole profile, also the token for notifications the phone app stored (`firebaseCloudMessagingToken`). The form does not show that field and sends it back as it was (`hide`).
- A zone and a living lab need an outline of three or more points. A deactivated zone cannot be switched on again.
- A report of type 1, 2 or 3 needs the details of a sighting, damage or a collision.

### Answering a questionnaire

`POST /interaction/` answers with the report and, when a running experiment has a questionnaire for that kind of report and place, with that questionnaire, its questions and their answer options. `answering.js` asks them through the dialog of `form.js`, one form per question, and sends one `POST /response/` per picked answer option. The rules are pure functions in `lib.js`:

- `openQuestion(questions, answered)` gives the next question: the questions go by `index`, and a picked answer option with a `nextQuestionID` jumps to that question when it comes later. A jump back is not followed, so a questionnaire always ends. Of several picked options the first in order with a jump decides.
- `answeredOf(responses, interactionID)` reads what was answered from `GET /responses/me/`. That is why stopping halfway needs no draft: the next time, the first question without a response is asked.
- `responseBodies` puts a typed text with the first picked option, because the API only takes a text on its own for a question with at most one answer option.

A format of an open answer (`openResponseFormat`) is the `pattern` of the input; the API checks it again and its refusal shows in the dialog. A message the API returns with a response (a conveyance) is shown as a notice.

The reports an account made itself (`GET /interactions/me/`) join the reports found on the map in `detections.js` (`loadOwnReports`), so they are on the live map for every account.

To offer another call: add an action to `ACTIONS`. To check by hand, sign in on the test server. Not offered on purpose: the calls of machines and phone apps (readings, detections, tracking readings, contacts, responses) and deleting the own profile.

## Sensors and readings

`store.js` is the one place that knows which sensors exist. A sensor comes from one of three sources:

- `GET /borne-sensor-deployment/active/`, which only herd managers may call.
- The animals a search of the live map found (`addFound`), for an area manager or wildlife manager. `GET /animals/` answers with the animals whose last position is inside a circle and a period, each with its deployments; `sensorOfAnimal` in `lib.js` picks the sensor it carries. They are kept under `wnl-found-animals:{server}:{user}` without their readings.
- The IDs the user added, kept under `wnl-sensors`.

From there every page treats them alike. `loadSensors()` and `loadReadings(id)` fetch once and keep the result in memory until `force` or sign out; all pages share that cache, so opening a sensor page after the map costs no request.

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
| `GET /openapi.json` | The Database page, and the roles and fields of every call that changes something | none |

The roles for reading are also in `SCOPES` in `api.js`; the Account page draws its first table from it. When the API changes, update `SCOPES`, this table and the README together. The roles for changing are not in the code: they are read from the server, see "Changing things".

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
| `wnl-found-animals:{server}:{user}` | `localStorage` | The animals a search of the live map found, each with the sensor it carries |
| `wnl-basemap` | `localStorage` | The chosen base map |
| `wnl-sidebar` | `localStorage` | Whether the navigation column is folded |
| `wnl-terrain` | `localStorage` | Whether 3D terrain is on |
| `wnl-map-layers` | `localStorage` | The layers panel: the open tab and per tab the hidden rows, the rows switched on that are off by default, folded groups, arrangement and sorting |
| `wnl-report-places:{server}` | `localStorage` | The places where reports were found |
| `wnl-server` | `localStorage` | The platform of the last sign-in, chosen again next time |
| `wnl-detection-places:{server}` | `localStorage` | The places where detections were found, so the next visit asks only there |
| `wl_nl_client` | `localStorage` | The key of the app before 2.0.0. Read once, moved to `wnl-session`, then removed |

## Map

`map.js` has two classes on a shared base. `MapView` draws the points of one page with an optional track. `LiveMap` draws a marker per sensor, a coloured line and points per track, and the detections; it tells the page about clicks through callbacks. Markers are made the way Protect makes them (`markerImage`): a white disc with a green ring and the species icon, blue with a halo when selected, a rounded square for a sensor without an animal. The sensor source is clustered with Protect's values (radius 28 px, up to zoom 14), so markers that would overlap become one disc with a count. `MapView` can also draw a search circle and report clicks beside its points, which the detections page uses. Both take their data as plain lists and rebuild their GeoJSON sources in `sources()`, so after a style change (`style.load`) the same data is drawn again.

`BASEMAPS` holds the base maps. Four are OpenFreeMap vector styles (`positron`, `liberty`, `bright`, `fiord`), the same as in Protect. Three are picture tiles wrapped in a small style by `rasterStyle`: Esri World Imagery, the PDOK aerial photo of the Netherlands and OpenTopoMap. None needs a key, which is why they replace Protect's MapTiler satellite layer. `dark: true` marks a ground that needs light labels and the lighter track colours. The choice is stored under `wnl-basemap`; the default follows the theme. Labels use the font `Noto Sans Regular`, the glyphs OpenFreeMap serves, also on the picture maps.

3D terrain (`setTerrain`, `applyTerrain`) uses the open Terrain Tiles on AWS in the `terrarium` encoding, again without a key: a hillshade layer under the data and MapLibre's terrain with Protect's exaggeration (1.3) and pitch (55). The choice is stored under `wnl-terrain`. A style change drops sources and layers, so terrain and data are applied again on `style.load`.

The layers panel (`pages/map-layers.js`) follows the one of Protect: a tab per kind, and `drawTab` gives every tab the same search, arrangement, sorting, folding groups with a three-state tick, and the line to show, hide, unfold or fold all. What the person chose is kept under `wnl-map-layers`. `LiveMap.setItems(kind, items)` takes what each layer shows; an item carries `selected`, and the map tells the page what was clicked through `onPick(kind, id)`.

The live map page (`pages/map.js`) places its controls as Protect does: the Layers button top left, the tools as square buttons top right (`.map-tools`), MapLibre's zoom, north and locate bottom right, and the panels in one column beside the tools (`.map-cards`), where the layers panel shrinks so the selected sensor always fits under it. On a phone the column rises from the bottom. Measuring is a mode of `LiveMap`: while it is on, a click adds a point to a dashed line and the page adds up the legs.

A track draws every fix in its line but at most 2000 dots, and the popup of a point is made on the click, so a track of tens of thousands of points appears at once. A track is known by its slot in `TRACK_COLORS` (Protect's track colours), with a lighter set of the same hues for a dark ground.

## Detections

`GET /detections/` needs a centre and a radius of at most 10 km, and the API has no list of detectors. `detections.js` is the one module that deals with that; the live map and the Detections page both read from it and hear about changes through `onDetections`.

- `searchBox` covers a box with a honeycomb of circles (`circleGrid` in `lib.js`) and asks them one by one. More than 300 circles are refused with a hint to zoom in.
- The API does not measure a radius over the ground: it takes a metre as 0.00001 degree in every direction (`models/Circle.go` in its source). Its 10 km is a circle of 0.1 degree, which in the Netherlands reaches 11 km north and south but under 7 km east and west. `circleGrid` and `coverPlaces` therefore work in degrees. Up to 2.4.0 they worked in metres, which left about an eighth of a searched view unasked.
- A search of an area also asks `GET /animals/` for an account that may read animals but not list the deployments (`searchesAnimals`). It asks for the last 48 hours only: the API sends every reading of the asked period along with each animal. Animals move, so no places are remembered for them and the load of the known places leaves them out.
- `searchCircle` spaces the requests 700 ms apart, about 85 a minute, under the API's default of 120 requests a minute per token (`RATE_LIMIT_MAX_REQUESTS` in the API's source). A `429` answer is waited out for 20 seconds and tried again.
- Every place with a detection is kept in `localStorage` under `wnl-detection-places:{server}`, rounded to about 100 metres. `coverPlaces` turns those places into the fewest circles, and that is all `loadDetections` asks.
- `detectorsOf` groups detections into detectors, one per `deploymentID` and place. The live map draws them as a diamond with a camera, Protect's shape for events.
- Reports from people (`GET /interactions/`, the same kind of call) are searched in the same circles and kept in `detections.reports`.

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

1. Check by hand: sign in with a code, sign in with a token, the live map with a track and the tabs of the layers panel, the search, the animals list, an animal page and its sensor page, the data explorer, detections, a few record lists and records, the database page, the two tables on the Account page, a change on the test server (a report, a zone drawn on the map, the own profile), sign out, reload while signed in.
2. Update `VERSION` and move the Unreleased entries in `CHANGELOG.md` under the new version and date.
3. Commit and push to `main`. GitHub Pages publishes within a minute or two.

Browsers cache the JavaScript files for about ten minutes on GitHub Pages; a hard reload shows a new release at once.
