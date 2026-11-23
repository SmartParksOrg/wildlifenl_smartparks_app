# WildlifeNL Protect

A small web app that shows what the [WildlifeNL](https://wildlifenl.nl) data platform holds: sensor readings and detections, on a map and in a table. Where your account may, it also changes things: it adds an animal, puts a sensor on it, draws a zone or sets up an experiment. Smart Parks uses it to check by hand that the data [Smart Parks Protect](https://github.com/SmartParksOrg/smartparks-protect) sends to WildlifeNL has arrived.

Open it: **https://smartparksorg.github.io/wildlifenl_smartparks_app/**

It is a static site: plain HTML, CSS and JavaScript, no build step and no server of its own. GitHub Pages serves the `main` branch as it is. Everything runs in your browser and talks directly to the WildlifeNL API.

## What it does

The pages follow the structure of Smart Parks Protect. An animal is what people follow, like an entity in Protect; the sensor it carries is the technical source behind it, like a device.

| Page | What you see |
| --- | --- |
| Live map | The animals at their last position, with tracks, and as further layers the sensors, people, detectors, events (reports, contacts and alarms), living labs and zones |
| Animals | Every animal with a sensor: identifier, species, last seen, last position. A page per animal with its track, charts and readings |
| Sensors | The sensors behind the animals, and where a sensor is added by its ID. A page per sensor with the same data from the technical side |
| Detections | What camera traps and other detectors saw, as a list |
| People | The people in the data you may read, each with where the recreation app recorded them, their contacts with animals, the messages they got and the reports they made |
| Reports | What people reported: a sighting, damage or a collision with an animal |
| Contacts | A person's phone was near an animal's sensor for some time |
| Alarms | An animal, a detection or a report came inside a zone |
| Messages | The messages and alarms that were shown to people, with who got them and why |
| Data explorer | Temperature, altitude, speed and acceleration over time, one chart per metric and one line per animal |
| Database | What WildlifeNL stores and how it hangs together, with a link from each kind of record to its list in the app |
| My reports, My answers, My messages, My alarms, My zones | What is yours: the reports you made, what you answered, the messages you got, and the zones you drew with their alarms |
| Experiments | The studies with their questionnaires, messages, responses and more |
| Accounts, Roles, Report types | The people with an account and what each may do, for an administrator |
| Species, Living labs | The species WildlifeNL knows, and the research areas with their boundary and visits |
| Account, About | Your roles and what they allow you to read and to change; what the app is |

Every table can be sorted, filtered, copied as JSON and downloaded as CSV. The app has a light and a dark theme and works on a phone.

The frame is the one of Protect: a top bar with the search (Ctrl K finds an animal, a sensor or a page) and a navigation column that folds away. On a narrow screen the navigation opens from the menu button.

### Automatic refresh

WildlifeNL does not send new data to the app, so the app reads it again by itself: the live map, the lists of animals and sensors, the page of an animal or a sensor, the data explorer, detections and every other list and record. A thin line under the top bar fills up until the next refresh and glides while one runs. A refresh keeps what you did: the map view, what you picked, the tracks, the zoom of a chart, and the sorting and filter of a table.

Once a minute by default. On the Account page you choose every 30 seconds, every minute, every 2, 5 or 15 minutes, or off; the choice holds for that device. The refresh waits while the app is not on screen, while a form is open and while a search of an area runs, and comes at once when it was due in the meantime. The refresh buttons on the pages still work.

### What your account sees

WildlifeNL decides per role what an account may read, and the navigation only shows what yours may open. The Account page lists it.

The navigation has a section per reason to come here:

| Section | For | Holds |
| --- | --- | --- |
| Monitor | The roles that read the data of everyone | The live map, animals, sensors, detections, people, reports, contacts, alarms and messages |
| Mine | Every account | Your own reports, answers and messages; with `land-user` or `wildlife-manager` also your zones and their alarms |
| Research | `researcher` | Experiments |
| Analyze | Any account, the data explorer with a role that reads readings | Data explorer and Database |
| Admin | `administrator` | Accounts, roles, species, living labs and report types |
| Reference | Everyone who is no administrator | Species and living labs, to read |

A list that exists for everyone and for yourself, such as Reports and My reports, is one page with a button to go from one to the other.

| To see | Role |
| --- | --- |
| The animals and their sensors | `herd-manager` sees them all; `nature-area-manager` and `wildlife-manager` find the animals in an area by searching it on the live map |
| The readings of a sensor: the track, charts and measurements of an animal | `herd-manager` |
| Detections, reports from others, visits of a living lab | `nature-area-manager`, `wildlife-manager` or `herd-manager` |
| Zones | `land-user` or `wildlife-manager` |
| Experiments and everything under them | `researcher` |
| Where other people were, their contacts and the messages they got | `researcher`, per experiment; every account sees its own |
| All alarms | `administrator` or `researcher`; every account sees its own |
| The accounts | `administrator` |
| Species, living labs, report types, roles | Any account |

A herd manager can also add a sensor by its ID on the Sensors page, for one that is not on an animal yet; added sensors are remembered in the browser. For a Protect device the ID is what its integration sends: by default the device's primary identity (DevEUI, IMEI or serial), see `sensor_id_source` in the integration's settings. WildlifeNL keeps readings even before a herd manager has registered the sensor on an animal.

### What your account can change

The app reads from WildlifeNL itself which changes it accepts and which roles each one asks for, on the server you signed in to. Where your roles allow a change, a button for it stands on the page it belongs to. The Account page lists every change with whether your account may make it.

| To change | Where | Role |
| --- | --- | --- |
| Add an animal, put a sensor on an animal | Animals, the page of an animal | `herd-manager` |
| Draw a zone, add or remove its species, deactivate it | Zones, the page of a zone | `land-user` or `wildlife-manager` |
| Make a report: a sighting, damage or a collision, and answer the questions an experiment has about it | Reports, the page of a report | Any account |
| Add an experiment, change, end or delete it, add its questionnaires, questions, answer options and messages, copy a questionnaire | Experiments and the pages under it | `researcher`, and only for your own experiments, before they start |
| Add or change a species, a living lab or a report type | Species, Living labs, Report types | `administrator` |
| Add a person, give or take away a role | People, the page of a person | `administrator` |
| Change your own profile | Account | Any account |

A form asks for exactly what WildlifeNL takes, checks it before it is sent, and shows the answer of WildlifeNL when it refuses. A place is typed or clicked on a map, an area is drawn on it. Deleting and deactivating ask first.

The app does not send readings, detections or contacts; those come from collars, camera traps and the phone apps. It also cannot delete your account.

A contact is a phone that was near the collar of an animal, which the phone apps notice over Bluetooth. A web page cannot scan for Bluetooth devices nearby, and this app never connects to a collar, so contacts are only shown here.

### Experiments

An experiment is upcoming until its start, live until its end, and ended after that; the list of experiments shows which, with how many questionnaires and messages it has and how many were answered and sent.

- **Before it starts** you can change your own experiment and everything under it. Its page says what it still misses, such as a questionnaire without questions.
- **A questionnaire** has a page with its questions in the order they are asked. Add a question, add its answer options, and let an answer option go on to a later question to skip the ones in between. WildlifeNL cannot change a question or an answer option; delete it and add it again.
- **Copy to another experiment** makes the same questionnaire, with its questions, answer options and jumps, in one of your experiments that has not started.
- **A message** is tied to a trigger: an encounter with a species within the metres and minutes you give, an answer option of a questionnaire, or an alarm for a species. The form asks for what the chosen trigger needs.
- **Delete** removes what hangs under a record with it, and says first how much that is.
- **Once it is live** nothing can be changed any more; you can end it. The pages say so in place of the buttons.
- **The results** are the lists on the page of an experiment: reports, responses, sent messages, contacts and tracking readings. Each can be filtered, copied as JSON and downloaded as CSV.

"Search this area" in the panel of a living lab on the live map looks for the detections, reports and animals inside the box around it.

### Share my location

On the Account page you can switch on "Share my location". It is off until you do, and the choice holds for your account on that device only. While it is on and the app is open on your screen, the app sends your position to WildlifeNL at once and then every 10 minutes, as the WildlifeNL phone apps do. A browser gives no position to a page in the background, so sharing pauses when the phone locks or you look at another tab. A chip in the top bar shows that sharing is on.

WildlifeNL keeps every position. Researchers can see where you were, and a running experiment can send you a message when you are near an animal. In return the live map shows what WildlifeNL finds near you, of the kinds your roles do not let you read: animals and reports under Events, camera traps under Detectors. An account whose roles read a kind anyway, such as a wildlife manager with the animals, finds it on the map already and gets nothing added of that kind. Your own track is under People.

### Questions about a report

A running experiment can have a questionnaire for the kind of report you make. WildlifeNL then sends it back with your report, and the app asks its questions one at a time: pick one answer, tick several, or write a text, as the question allows. An answer can skip questions that no longer apply. Each answer is sent at once, so you can stop halfway and go on later with "Answer the questions" on the page of the report. My answers lists what you answered.

### Records are linked

Where a record names another one, the app links to it: an animal to its species and its sensor, a report to its species, its kind and the person who made it, an alarm to its zone and its animal, an experiment to its living lab, questionnaires and messages. A record with a place has a small map and a "Show on map" button.

### Live map

The map is laid out like the live map of Protect.

- **Layers** (top left) opens a panel with a tab per kind: Animals, Sensors, People, Detectors, Events and Areas. Each tab has a search, a choice to group the rows or not, sorting by name or by last update, groups that fold, a tick per row and per group, and a line to show, hide, unfold or fold everything. Reset puts it all back.
- **Animals** are grouped per species. The route button draws the track of an animal and the target button goes to it. An area manager or wildlife manager, who may not list the herd's sensors, finds the animals with **Search this view**: every animal with a sensor whose last position is in the view and under 48 hours old. Found animals are remembered in the browser and have a page with the last position WildlifeNL keeps of them. Their track and charts need `herd-manager`, the only role that may read the readings of a sensor.
- **Sensors** lists every sensor, to look at the data from the side of the sensor. A sensor on an animal is drawn as a sensor once you tick or pick it; until then its animal stands for it.
- **People** are where the recreation app last recorded them, each with a track like an animal.
- **Events** are the reports from people, the contacts between a person and an animal, and the alarms, grouped per kind.
- **Areas** are the living labs, and your zones if you have any. The panel of a living lab can show where people were in the last 30 days.
- **Tools** (top right, square buttons): the base map, 3D terrain, measuring a distance, and the tracks with their length (24 hours to everything) once a track is on. Up to eight tracks at a time, each in its own colour.
- **Base maps:** Light, Streets, Bright and Night from OpenFreeMap, Satellite (Esri World Imagery), Aerial photo of the Netherlands (PDOK) and Topographic (OpenTopoMap). The default follows the theme. None needs a key.
- **Markers:** an animal is a disc with the icon of its species, a sensor a rounded square, a person a disc with a person, a detector a diamond with a camera, and a report, a contact or an alarm a sand coloured diamond. Animals that would overlap become one disc with a number; click it to zoom in.
- **Click anything** for its panel, with icon buttons to its page, its data and its place. The name at the top of the panel also opens its page.

### Detections

A detection is a record that a camera trap or another detector saw animals of one species. In WildlifeNL's own design detections are something to see on a map, and a fresh one raises an alarm for people who drew a zone around that place. The app follows that, in the way Protect shows events: a layer on the live map and a list.

- **On the live map** every detector is a diamond with a camera. Click one for what it saw: the number of detections, the latest, the species and who sent them, with buttons to its detections and to the newest picture.
- **The Detections page** is the list: time, species, number of animals, confidence, description, detector, who sent it and a link to the picture. Filter by period, species and detector. A click on a detector goes to it on the map.

WildlifeNL answers a detection query only within 10 km of a point and has no list of detectors, so the app has to look for them:

- **Search this view** (under Layers on the live map, in the Detectors and Events tabs) asks circle by circle until the view is covered, for detections and for reports, at a pace that stays under the API's limit of 120 requests a minute. Stop ends it.
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

- [DEVELOPERS.md](DEVELOPERS.md): how the code is organised, the API calls, how changes are made, sign-in and storage, how to update the map library.
- [CONTRIBUTING.md](CONTRIBUTING.md) and [CONVENTIONS.md](CONVENTIONS.md): how to work on this repository.
- [CHANGELOG.md](CHANGELOG.md): what changed per version.
- [SECURITY.md](SECURITY.md): how to report a security problem and how the app handles tokens.

## License

MIT, see [LICENSE](LICENSE). The Smart Parks logo and the photographs under `assets/img/` belong to Smart Parks and are not covered by the MIT license. The marker icons under `assets/img/icons/` are EarthRanger's, under the Apache License 2.0; see the README in that folder. Map data and imagery belong to their providers, named in the corner of each map.
