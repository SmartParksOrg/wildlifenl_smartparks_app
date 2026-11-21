# WildlifeNL Protect

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
| Detections | What camera traps and other detectors saw, as a list; the detectors are a layer of the live map | `nature-area-manager`, `wildlife-manager` or `herd-manager` |
| Database | What WildlifeNL stores and how it hangs together, as a drawing with a plain explanation per kind of record | Any account |
| Account | Your profile, your roles and what they allow | Any account |
| About | What the app is, with links | Any account |

Every table can be sorted, filtered, copied as JSON and downloaded as CSV. The app has a light and a dark theme and works on a phone.

The frame is the one of Protect: a top bar with the search (Ctrl K finds a sensor, an animal or a page) and a navigation column that folds away. On a narrow screen the navigation opens from the menu button.

### Where the sensors come from

WildlifeNL lets only `herd-manager` accounts list the deployed sensors. Those accounts see all active deployments, with the animal each sensor is on. Every account can also add a sensor by its ID on the Sensors page; added sensors are remembered in the browser. For a Protect device the ID is what its integration sends: by default the device's primary identity (DevEUI, IMEI or serial), see `sensor_id_source` in the integration's settings. WildlifeNL keeps readings even before a herd manager has registered the sensor.

### Live map

The map is laid out like the live map of Protect.

- **Layers** (top left) opens the list of sensors: tick one to show or hide it, search by name or ID, draw its track with the route button and go to it with the target button. The detectors are a layer there too, see Detections below.
- **Tools** (top right, square buttons): the base map, 3D terrain, measuring a distance, and the tracks with their length (24 hours to everything) once a track is on. Up to eight tracks at a time, each in its own colour.
- **Base maps:** Light, Streets, Bright and Night from OpenFreeMap, Satellite (Esri World Imagery), Aerial photo of the Netherlands (PDOK) and Topographic (OpenTopoMap). The default follows the theme. None needs a key.
- **Zoom, north and your own position** are bottom right.
- **Markers:** the icon of the species in a ring, a rounded square for a sensor without an animal. Sensors that would overlap become one disc with a number; click it to zoom in.
- **Click a marker** for the sensor's panel: last seen, position, temperature, and icon buttons for the track, centring the map, the sensor page and the data explorer.
- **Click a track point** for the time and the values of that fix.

### Detections

A detection is a record that a camera trap or another detector saw animals of one species. In WildlifeNL's own design detections are something to see on a map, and a fresh one raises an alarm for people who drew a zone around that place. The app follows that, in the way Protect shows events: a layer on the live map and a list.

- **On the live map** every detector is a diamond with a camera. Click one for what it saw: the number of detections, the latest, the species and who sent them, with buttons to its detections and to the newest picture.
- **The Detections page** is the list: time, species, number of animals, confidence, description, detector, who sent it and a link to the picture. Filter by period, species and detector. A click on a detector goes to it on the map.

WildlifeNL answers a detection query only within 10 km of a point and has no list of detectors, so the app has to look for them:

- **Search this view** (under Layers on the live map) asks circle by circle until the view is covered, at a pace that stays under the API's limit of 120 requests a minute. Most of the Netherlands takes about three and a half minutes. Stop ends it.
- **Places with detections are remembered** in the browser, per server. From then on the map and the list open with the detections of those places, which takes a request per detector area.
- **The period** is set on the Detections page (the last 90 days at first) and also holds for the map. A search only finds detectors with a detection in that period, so choose a long period before the first search.

#### Detections from AddaxAI Connect

Camera trap pictures classified by [AddaxAI Connect](https://github.com/PetervanLunteren/AddaxAI-Connect) reach WildlifeNL through Smart Parks Protect: Protect turns a classified picture into a species detection event, and its WildlifeNL integration posts that as a detection. Here is how such a detection shows up:

| In this app | Comes from |
| --- | --- |
| Detector | The camera's identity in Protect (`sensor_id_source` of the integration) |
| Time | The moment the picture was taken |
| Detection | The species, which WildlifeNL looks up by the name Protect sends |
| Confidence | The best classification confidence, as a percentage |
| Description | The title of the Protect event, such as "Wolf at Waterhole north" |
| Sent by | The WildlifeNL account of the Protect integration |
| Picture | The link back to AddaxAI Connect |

A picture with two species becomes two detections at the same moment. A camera without a location in Protect sends nothing.

### Data explorer

Choose metrics and up to eight sensors. Each metric gets its own chart, the charts share the crosshair and the zoom, and the table below holds the same numbers. Speed is derived from two fixes in a row. The view is in the address, so a link reproduces it. With the automatic bucket the app averages per 15 minutes, hour, 6 hours or day when the period gets long.

## Sign in

1. Enter the email address of your WildlifeNL account.
2. WildlifeNL sends a six digit code to that address. Type or paste it.

That is all: there is no password. With "Keep me signed in on this device" the token stays in the browser until you sign out; without it the token is gone when you close the tab.

If you already have a bearer token, choose "I already have a token" and paste it.

Choose the platform on the sign-in card: Live, Test, or another address. The app remembers the last one. A token belongs to one platform.

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

MIT, see [LICENSE](LICENSE). The Smart Parks logo and the photographs under `assets/img/` belong to Smart Parks and are not covered by the MIT license. The marker icons under `assets/img/icons/` are EarthRanger's, under the Apache License 2.0; see the README in that folder. Map data and imagery belong to their providers, named in the corner of each map.
