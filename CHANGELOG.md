# Changelog

All notable changes to this project. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the versions follow [Semantic Versioning](https://semver.org/).

## Unreleased

## 2.0.0 - 2026-11-21

A rewrite of the single-file client into a small app with the look of Smart Parks Protect.

### Added

- Sign in with a code by email (`POST /auth/`, then `PUT /auth/`), with the option to stay signed in on the device. Signing in with an existing token still works.
- Protect check: compares the positions Smart Parks Protect holds for a device with the readings WildlifeNL received, from a Protect server or from a JSON, GeoJSON or CSV file. Shows what is in both, what differs in location, what is missing and what only WildlifeNL has.
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
