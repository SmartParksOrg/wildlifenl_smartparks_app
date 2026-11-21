# Smart Parks WildlifeNL check

A small web app that shows what the [WildlifeNL](https://wildlifenl.nl) data platform holds: sensor readings and detections, on a map and in a table. Smart Parks uses it to check by hand that the data [Smart Parks Protect](https://github.com/SmartParksOrg/smartparks-protect) sends to WildlifeNL has arrived.

Open it: **https://smartparksorg.github.io/wildlifenl_smartparks_app/**

It is a static site: plain HTML, CSS and JavaScript, no build step and no server of its own. GitHub Pages serves the `main` branch as it is. Everything runs in your browser and talks directly to the WildlifeNL API.

## What it does

The pages follow the structure of Smart Parks Protect: a live map, a list with a page per object, and a data explorer.

| Page | What you see | WildlifeNL role you need |
| --- | --- | --- |
| Live map | A marker per sensor at its last position. The layers panel chooses which sensors show, draws their tracks and adds the detections in view | `land-user`, `nature-area-manager`, `wildlife-manager` or `herd-manager` |
| Sensors | Every sensor with its animal, last reading, last position and number of readings | The same |
| Sensor page | Everything WildlifeNL holds for one sensor: facts, latest values, the track, charts and every reading | The same |
| Data explorer | Temperature, altitude, speed and acceleration over time, one chart per metric and one line per sensor | The same |
| Detections | Camera trap and other detections in a period and a circle of at most 10 km | `nature-area-manager`, `wildlife-manager` or `herd-manager` |
| Account | Your profile, your roles and what they allow | Any account |

Every table can be sorted, filtered, copied as JSON and downloaded as CSV. The app has a light and a dark theme and works on a phone.

### Where the sensors come from

WildlifeNL lets only `herd-manager` accounts list the deployed sensors. Those accounts see all active deployments, with the animal each sensor is on. Every account can also add a sensor by its ID, on the Sensors page or in the layers panel of the map; added sensors are remembered in the browser. For a Protect device the ID is what its integration sends: by default the device's primary identity (DevEUI, IMEI or serial), see `sensor_id_source` in the integration's settings. WildlifeNL keeps readings even before a herd manager has registered the sensor.

### Live map

- **Base map:** Light, Streets, Bright or Night; the default follows the theme.
- **Layers:** tick a sensor to show or hide it, search by name or ID, and use the route button to draw its track. Up to eight tracks at a time, each in its own colour. The track length is 24 hours to everything.
- **Click a marker** for the sensor's panel: last seen, position, temperature, links to the sensor page and its data, and the track button.
- **Click a track point** for the time and the values of that fix.

### Data explorer

Choose metrics and up to eight sensors. Each metric gets its own chart, the charts share the crosshair and the zoom, and the table below holds the same numbers. Speed is derived from two fixes in a row. The view is in the address, so a link reproduces it. With the automatic bucket the app averages per 15 minutes, hour, 6 hours or day when the period gets long.

## Sign in

1. Enter the email address of your WildlifeNL account.
2. WildlifeNL sends a six digit code to that address. Type or paste it.

That is all: there is no password. With "Keep me signed in on this device" the token stays in the browser until you sign out; without it the token is gone when you close the tab.

If you already have a bearer token, choose "I already have a token" and paste it.

The app signs in to the live server. Under "Server" on the sign-in card you can choose the test server (`https://test-api-wildlifenl.uu.nl`) instead. A token belongs to one server.

Good to know:

- WildlifeNL gives one token per email address and app name. This app signs in under its own name, so it never replaces the token your Protect integration uses.
- The account Protect sends data with has the `data-system` role. That role may write readings but not read them. To check the data, sign in with an account that has one of the roles in the table above, or ask the WildlifeNL administrator to add one.

## Run it locally

```bash
git clone https://github.com/SmartParksOrg/wildlifenl_smartparks_app.git
cd wildlifenl_smartparks_app
python3 -m http.server 8080
```

Open http://localhost:8080. The files must be served over HTTP; opening `index.html` from disk does not work because browsers block JavaScript modules there.

Run the tests with `npm test` (Node 20 or newer, nothing to install).

## Documentation

- [DEVELOPERS.md](DEVELOPERS.md): how the code is organised, the API calls, sign-in and storage, how to update the map library.
- [CONTRIBUTING.md](CONTRIBUTING.md) and [CONVENTIONS.md](CONVENTIONS.md): how to work on this repository.
- [CHANGELOG.md](CHANGELOG.md): what changed per version.
- [SECURITY.md](SECURITY.md): how to report a security problem and how the app handles tokens.

## License

MIT, see [LICENSE](LICENSE). The Smart Parks logo and the photographs under `assets/img/` belong to Smart Parks and are not covered by the MIT license.
