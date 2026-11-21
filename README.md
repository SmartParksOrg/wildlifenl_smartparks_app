# WildlifeNL Protect

A small web app that shows what the [WildlifeNL](https://wildlifenl.nl) data platform holds: sensor readings and detections, on a map and in a table. Smart Parks uses it to check by hand that the data [Smart Parks Protect](https://github.com/SmartParksOrg/smartparks-protect) sends to WildlifeNL has arrived.

Open it: **https://smartparksorg.github.io/wildlifenl_smartparks_app/**

It is a static site: plain HTML, CSS and JavaScript, no build step and no server of its own. GitHub Pages serves the `main` branch as it is. Everything runs in your browser and talks directly to the WildlifeNL API.

## What it does

The pages follow the structure of Smart Parks Protect. An animal is what people follow, like an entity in Protect; the sensor it carries is the technical source behind it, like a device.

| Page | What you see |
| --- | --- |
| Live map | The animals at their last position, with tracks, and as further layers the sensors without an animal, the detectors, reports from people, living labs and zones |
| Animals | Every animal with a sensor: species, last seen, last position. A page per animal with its track, charts and readings |
| Sensors | The sensors behind the animals, and where a sensor is added by its ID. A page per sensor with the same data from the technical side |
| Detections | What camera traps and other detectors saw, as a list |
| Reports | What people reported: a sighting, damage or a collision with an animal |
| Alarms | An animal, a detection or a report came inside a zone |
| Data explorer | Temperature, altitude, speed and acceleration over time, one chart per metric and one line per animal |
| Database | What WildlifeNL stores and how it hangs together, with a link from each kind of record to its list in the app |
| Living labs, Zones | The research areas with their boundary and visits, and the zones you drew |
| Experiments | The studies with their questionnaires, messages, responses and more |
| Species, People | The species WildlifeNL knows, and the accounts with their roles |
| Account, About | Your roles and what they allow; what the app is |

Every table can be sorted, filtered, copied as JSON and downloaded as CSV. The app has a light and a dark theme and works on a phone.

The frame is the one of Protect: a top bar with the search (Ctrl K finds an animal, a sensor or a page) and a navigation column that folds away. On a narrow screen the navigation opens from the menu button.

### What your account sees

WildlifeNL decides per role what an account may read, and the navigation only shows what yours may open. The Account page lists it.

| To see | Role |
| --- | --- |
| The animals and their sensors | `herd-manager`; the readings of a sensor also `land-user`, `nature-area-manager` or `wildlife-manager` |
| Detections, reports from others, visits of a living lab | `nature-area-manager`, `wildlife-manager` or `herd-manager` |
| Zones | `land-user` or `wildlife-manager` |
| Experiments and everything under them | `researcher` |
| All alarms | `administrator` or `researcher`; every account sees its own |
| The accounts | `administrator` |
| Species, living labs, report types, roles | Any account |

An account without `herd-manager` can still add a sensor by its ID on the Sensors page; added sensors are remembered in the browser. For a Protect device the ID is what its integration sends: by default the device's primary identity (DevEUI, IMEI or serial), see `sensor_id_source` in the integration's settings. WildlifeNL keeps readings even before a herd manager has registered the sensor on an animal.

### Records are linked

Where a record names another one, the app links to it: an animal to its species and its sensor, a report to its species, its kind and the person who made it, an alarm to its zone and its animal, an experiment to its living lab, questionnaires and messages. A record with a place has a small map and a "Show on map" button.

### Live map

The map is laid out like the live map of Protect.

- **Layers** (top left) opens a panel with a tab per kind: Animals, Sensors, Detectors, Reports and Areas. Each tab has a search, a choice to group the rows or not, sorting by name or by last update, groups that fold, a tick per row and per group, and a line to show, hide, unfold or fold everything. Reset puts it all back.
- **Animals** are grouped per species. The route button draws the track of an animal and the target button goes to it. The Sensors tab holds only sensors that are not on an animal.
- **Areas** are the living labs, and your zones if you have any. The panel of a living lab can show where people were in the last 30 days.
- **Tools** (top right, square buttons): the base map, 3D terrain, measuring a distance, and the tracks with their length (24 hours to everything) once a track is on. Up to eight tracks at a time, each in its own colour.
- **Base maps:** Light, Streets, Bright and Night from OpenFreeMap, Satellite (Esri World Imagery), Aerial photo of the Netherlands (PDOK) and Topographic (OpenTopoMap). The default follows the theme. None needs a key.
- **Markers:** an animal is a disc with the icon of its species, a sensor without an animal a rounded square, a detector a diamond with a camera and a report a sand coloured diamond. Animals that would overlap become one disc with a number; click it to zoom in.
- **Click anything** for its panel, with icon buttons to its page, its data and its place.

### Detections

A detection is a record that a camera trap or another detector saw animals of one species. In WildlifeNL's own design detections are something to see on a map, and a fresh one raises an alarm for people who drew a zone around that place. The app follows that, in the way Protect shows events: a layer on the live map and a list.

- **On the live map** every detector is a diamond with a camera. Click one for what it saw: the number of detections, the latest, the species and who sent them, with buttons to its detections and to the newest picture.
- **The Detections page** is the list: time, species, number of animals, confidence, description, detector, who sent it and a link to the picture. Filter by period, species and detector. A click on a detector goes to it on the map.

WildlifeNL answers a detection query only within 10 km of a point and has no list of detectors, so the app has to look for them:

- **Search this view** (under Layers on the live map, in the Detectors and Reports tabs) asks circle by circle until the view is covered, for detections and for reports, at a pace that stays under the API's limit of 120 requests a minute. Stop ends it.
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

Choose metrics and up to eight animals. Each metric gets its own chart, the charts share the crosshair and the zoom, and the table below holds the same numbers. Speed is derived from two fixes in a row. The view is in the address, so a link reproduces it. With the automatic bucket the app averages per 15 minutes, hour, 6 hours or day when the period gets long.

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
