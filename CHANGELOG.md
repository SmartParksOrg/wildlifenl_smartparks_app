# Changelog

All notable changes to this project. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the versions follow [Semantic Versioning](https://semver.org/).

## Unreleased

### Added

- The app refreshes by itself, because WildlifeNL does not send new data: once a minute by default, every 30 seconds to every 15 minutes, or off, on the Account page. A thin line under the top bar fills up until the next refresh. The map view, what is picked, the tracks, the zoom of a chart and the sorting of a table stay as they are. The refresh waits while the app is not on screen, while a form is open and while a search runs.
- On the live map the name at the top of a panel opens the page of the animal, the sensor or whatever else was picked.

### Changed

- A refresh of the readings of a sensor reads only what is new, a few kilobytes, in place of every reading again.
- The period of the detections follows the day when it ends today, so an app that stays open sees the detections of the next day.

## 2.6.0 - 2026-11-22

Follows WildlifeNL API 20261122, now on the live and the test server.

### Changed

- An animal is known by its identifier, which WildlifeNL used to call its name. The page of an animal says Identifier.
- Only a herd manager may read the readings of a sensor now. Other accounts see the animals they found on the live map at the last position WildlifeNL keeps of them, with when that was, and without a track, charts or readings. The Sensors page and the data explorer are for herd managers only.

### Fixed

- Since WildlifeNL changed its API, animals showed their sensor ID in place of their name, and an area manager or wildlife manager got a refusal on the page of an animal and when picking one on the live map.

## 2.5.3 - 2026-11-22

Sign out on the live map.

### Fixed

- Sign out did nothing on the live map: the sign-in card did not come back until the page was reloaded.

## 2.5.2 - 2026-11-21

The live map on a phone held sideways.

### Fixed

- The live map on a phone held sideways: the tools at the top right ran into the zoom buttons, and the layers together with the panel of a picked animal were taller than the screen. On a low screen the map now shows one panel at a time, a panel scrolls within the room it has, and the two zoom buttons make way (zoom with two fingers).
- A picked place stays in sight beside the panel on a phone held sideways.
- On a phone, opening the layers closes the panel of what was picked, so the two never share the screen.

## 2.5.1 - 2026-11-21

Every page fits a phone, upright and sideways.

### Changed

- On a phone the live map shows one panel at a time: picking something closes the layers, and the picked place stays in sight above its panel. Held sideways, the panels stand at the left.
- On a small phone the top bar shows the name of the app in full and leaves out the logo; the chip for location sharing keeps its icon only.
- The tabs of the layers panel keep their whole names and scroll sideways when they do not fit.

### Fixed

- The page of a record was wider than a phone screen, so the right edge of its cards was cut off.
- In a form on a phone the latitude and longitude of a place were squeezed beside the button; the button now stands under them.
- The panel of a picked animal could cover the whole map and lose its top on a low screen.

## 2.5.0 - 2026-11-21

The core of the other WildlifeNL apps in this one: the admin tool, the research portal, the report app and the animal radar.

### Added

- The app can change things in WildlifeNL, where the account may: add an animal and put a sensor on it, draw a zone and choose its species, make a report, add, change, end and delete an experiment with its questionnaires, questions, answer options and messages, add and change species, living labs and report types, add a person and give or take away a role, and change the own profile. A button stands on the page the change belongs to.
- The Account page lists every change WildlifeNL accepts, the roles it asks for and whether the account may make it. The app reads this from the server it is signed in to.
- A form follows what WildlifeNL takes for a change. A place is typed or clicked on a map and an area is drawn on it. A refusal by WildlifeNL is shown in the form.

- The People page shows the profile of a person: email address, roles, gender, date of birth, postcode and how often the person visits nature. An administrator sees it for everyone, every other account for itself.

- Lists of what is yours: My reports, My answers, My messages, My alarms and My zones. A researcher goes from all experiments to the own ones with one button.

- Research: the list of experiments shows whether each is upcoming, live or ended, with its counts. The page of an experiment says what it still misses before it starts. A questionnaire has a page with its questions in order, their answer options and jumps, and can be copied to another experiment.
- The lists under a record, such as the responses of an experiment, can be filtered, copied as JSON and downloaded as CSV.
- "Search this area" in the panel of a living lab on the live map.
- Share my location, on the Account page: off until you switch it on, then your position goes to WildlifeNL every 10 minutes while the app is open on screen, as the phone apps do. The live map shows what WildlifeNL finds near you, of the kinds your roles do not let you read anyway: animals, detections or reports. A message of an experiment is shown as a notice.
- After a report the app asks the questions a running experiment has about it, and sends the answers. You can stop halfway and go on later from the page of the report.
- Your own reports are on the live map, under Events, for every account.
- An area manager or wildlife manager finds the animals in an area with "Search this view" on the live map. Found animals are remembered and have a page, a track and charts like the animals a herd manager lists.

### Changed

- The navigation has a section per audience: Monitor, Mine, Research, Analyze, Admin and Reference. A section and an entry only show when the roles of the account open them. Admin holds the accounts, roles, species, living labs and report types for an administrator; everyone else finds species and living labs under Reference.
- Deleting an experiment, a questionnaire or a question removes what hangs under it and says first how much that is. Before, WildlifeNL refused the delete as soon as there was anything under it.
- The buttons to change an experiment and what hangs under it only show for your own experiment before it starts, with a sentence that says why when they do not. "End now" only shows while an experiment is live.
- The form of a message asks for what its trigger needs, and names the five severities.
- Animals, Sensors, Detections and the Data explorer are left out of the navigation for an account whose roles cannot read them.
- The layers panel of the live map leaves out a tab that has nothing to show, such as Animals for an account that may not list them. Sensors stays, and Detectors and Events stay for an account that can search for them.

### Fixed

- "Search this view" left about an eighth of the view unsearched for detections and reports. WildlifeNL measures the radius of a search in degrees, not in metres over the ground, so a search reaches less far east and west than the app assumed.
- A field name that ends in ID, such as the sensor ID, had two spaces in its label.

## 2.4.0 - 2026-11-21

### Added

- Pages for the kinds of records the Database page shows: reports from people, alarms, living labs, zones, experiments with their questionnaires, messages and responses, species, people and roles. One list page and one record page draw all of them.
- Records are linked: a field that names another record is a link to it, and a record with a place has a small map and a "Show on map" button. The Database page links each kind of record to its list.
- People in the app: a People layer on the live map with a track per person, a People page with a page per person (where they were, their contacts with animals, the messages they got, the reports they made), and pages for contacts and for the messages shown to people.
- Live map layers for reports from people, contacts and alarms (together under Events), living labs and zones, and the visits of a living lab.
- The layers panel has a tab per kind, each with a search, grouping, sorting, folding groups, a tick per row and group, and show, hide, unfold and fold all, as in Protect.

### Changed

- Animals come first, as entities do in Protect. The map, the lists, the search and the data explorer are about animals; the sensor is the technical source behind an animal, with its own list and page. The Sensors tab of the map lists every sensor, so the data can also be looked at from the sensor.
- The navigation only shows what the account may read.
- Searching an area on the map looks for detections and for reports.

## 2.3.0 - 2026-11-21

### Added

- Detectors are a layer of the live map: a diamond per camera trap or other detector, with a panel for what it saw. "Search this view" looks for detectors area by area, and the places found are remembered for the next visit.
- The detections list shows the description, who sent a detection and a link to its picture, which is what detections from AddaxAI Connect through Protect carry.
- Base maps Satellite, Aerial photo of the Netherlands and Topographic, and 3D terrain. None needs a key.
- A measuring tool on the live map.
- The sign-in card has a Platform list: Live, Test or another address. The last choice is remembered.

### Changed

- The live map places its controls as Protect does: Layers top left, the base map, terrain, measure and tracks as square buttons top right, zoom and locate bottom right, and the panels in a column beside the tools.
- The Detections page is a list like the events of Protect, with filters for period, species and detector. It has no map of its own.
- The sensor panel on the map has icon buttons only.
- The track length moved to a Tracks card behind the tracks button.

### Removed

- Adding a sensor from the layers panel of the map. Sensors are added on the Sensors page.
- The form with latitude, longitude and radius on the detections page.

## 2.2.0 - 2026-11-21

### Added

- Database page: what WildlifeNL stores and how it hangs together, drawn from the API's own description, with a plain explanation per kind of record.
- About page with links.
- Search in the top bar (Ctrl K) for sensors, animals and pages.
- Marker icons per species and grouping of markers that overlap, as on the live map of Protect.
- A search circle on the detections map; a click moves it.

### Changed

- The app is called WildlifeNL Protect. WildlifeNL keys a token on the app name, so the next sign-in gives a new token; a stored session keeps working.
- The frame is the one of Protect: a top bar on every screen and a navigation column that folds away, a drawer on narrow screens.
- The layers and the selected sensor share the left side of the map and no longer cover each other. The track length moved to the bar above the map.
- The detections page starts at the sensors and looks back 30 days.

### Fixed

- Detections did not load with the old default of 200 km: the API accepts a radius of at most 10 km.

## 2.1.0 - 2026-11-21

The app now has the structure of Smart Parks Protect: a live map, a list with a page per sensor, and a data explorer.

### Added

- Live map: a marker per sensor, a layers panel to show, hide and search sensors, tracks in their own colour with a track length, a panel for the selected sensor, a choice of base maps and the detections in view.
- Sensors page: every sensor with its animal, last reading, last position and number of readings.
- Sensor page: facts, latest values, the animal, the track, charts of temperature, altitude and speed, and every reading.
- Data explorer: one chart per metric with a line per sensor, a range and a bucket, the same numbers as a table and as CSV. The view is in the address.
- Sensors can be added by ID and are remembered in the browser, for accounts that may not list the deployments.
- The sign-in card offers the live and the test server.

### Changed

- The navigation is a column with the logo, like Protect, and replaces the top bar.
- The sensor readings page is replaced by the Sensors list and the page per sensor.
- Readings are fetched once per sensor and shared by all pages. The sensors list and the map read only the newest part of a sensor's readings, so a sensor with tens of thousands of readings does not slow them down.
- The detection radius is at most 10 km, the limit of the API.

## 2.0.0 - 2026-11-21

A rewrite of the single-file client into a small app with the look of Smart Parks Protect.

### Added

- Sign in with a code by email (`POST /auth/`, then `PUT /auth/`), with the option to stay signed in on the device. Signing in with an existing token still works.
- Detections page: detections in a period and a circle on the map.
- Account page: profile, roles, what each role allows, and the app version.
- Light and dark theme that follow the device or the user's choice.
- Stat tiles, a period filter and a track on the sensor readings page.
- Unit tests, CI, a content security policy, and the repository documents: `DEVELOPERS.md`, `CONTRIBUTING.md`, `CONVENTIONS.md`, `SECURITY.md`, `CODE_OF_CONDUCT.md`.

### Changed

- Follows the WildlifeNL API version `20260826`. The sensor list comes from `GET /borne-sensor-deployment/active/`; the old `/borne-sensor-deployments/` path no longer exists.
- The Smart Parks colour system, components and layout of Smart Parks Protect replace the old styling.
- MapLibre GL JS with OpenFreeMap vector maps replaces Leaflet with OpenStreetMap raster tiles.
- The code moved from one HTML file to `index.html` plus `assets/`. It is still a static site without a build step.
- Tables render 200 rows at a time, so sensors with many readings stay fast.

### Removed

- The editable path template and query string. The API paths are fixed in `assets/js/api.js`.

### Migration

- A token remembered by the old app is taken over once and the old `wl_nl_client` entry is removed from the browser.

## 1.1.0 - 2025

- The sensor ID field became a dropdown filled from the deployed sensors.

## 1.0.0 - 2025

- First version: a single HTML file that queries the borne sensor readings of one sensor and shows them in a table and on a map.
