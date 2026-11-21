# Smart Parks WildlifeNL check

A small web app that shows what the [WildlifeNL](https://wildlifenl.nl) data platform holds, and checks that the data [Smart Parks Protect](https://github.com/SmartParksOrg/smartparks-protect) sends there arrives complete and correct.

Open it: **https://smartparksorg.github.io/wildlifenl_smartparks_app/**

It is a static site: plain HTML, CSS and JavaScript, no build step and no server of its own. GitHub Pages serves the `main` branch as it is. Everything runs in your browser and talks directly to the WildlifeNL API.

## What it does

| Page | What you see | WildlifeNL role you need |
| --- | --- | --- |
| Sensor readings | Positions, temperature and acceleration of one collar, on a map and in a table | `land-user`, `nature-area-manager`, `wildlife-manager` or `herd-manager` |
| Detections | Camera trap and other detections in a period and a circle on the map | `nature-area-manager`, `wildlife-manager` or `herd-manager` |
| Protect check | A comparison of Protect's positions with WildlifeNL's readings for the same sensor | The same as sensor readings |
| Account | Your profile, your roles and what they allow | Any account |

Every table can be sorted, filtered, copied as JSON and downloaded as CSV. The app follows the look of Smart Parks Protect, with a light and a dark theme, and works on a phone.

## Sign in

1. Enter the email address of your WildlifeNL account.
2. WildlifeNL sends a six digit code to that address. Type or paste it.

That is all: there is no password. With "Keep me signed in on this device" the token stays in the browser until you sign out; without it the token is gone when you close the tab.

If you already have a bearer token, choose "I already have a token" and paste it.

Good to know:

- WildlifeNL gives one token per email address and app name. This app signs in under its own name, so it never replaces the token your Protect integration uses.
- The account Protect sends data with has the `data-system` role. That role may write readings but not read them. To check the data, sign in with an account that has one of the roles in the table above, or ask the WildlifeNL administrator to add one.
- Only `herd-manager` accounts may list the deployed sensors. Other accounts type the sensor ID themselves.

## Check Protect data

The Protect check answers one question: did every position Protect holds for a device arrive in WildlifeNL, at the same time and place?

1. **WildlifeNL side.** Enter the sensor ID and a period. The sensor ID is what the Protect integration sends: by default the device's primary identity (DevEUI, IMEI or serial), see `sensor_id_source` in the integration's settings.
2. **Protect side.** Either connect to your Protect server (address, email address and password, then pick the project and the device), or upload or paste the positions as JSON, GeoJSON or CSV.
3. **Compare.** Every Protect position is paired with the WildlifeNL reading closest in time.

| Result | Meaning |
| --- | --- |
| In both | Same time (within the time tolerance) and same place (within the location tolerance) |
| Location differs | A reading exists at that time, but further away than the tolerance |
| Missing in WildlifeNL | Protect has the position, WildlifeNL has no reading at that time |
| Only in WildlifeNL | WildlifeNL has a reading Protect does not have |

How to read the result:

- Missing positions: look at the integration's deliveries in Protect. A delivery that failed or is still waiting explains a missing reading.
- Only in WildlifeNL: when a position is corrected in Protect, the integration sends a new reading and WildlifeNL keeps both. Data from another source under the same sensor ID also shows up here.
- Temperature readings have no location and are left out of the comparison; the result says how many.
- Protect returns at most 1000 positions per request. The app warns when a period reaches that bound.

To connect straight to a Protect server, that server must allow this page's address. Add it to `CORS_ORIGINS` in the server's `.env`:

```
CORS_ORIGINS=https://your-protect.example.org,https://smartparksorg.github.io
```

Without that, use the file or paste option. The Protect password is sent to your Protect server only and is never stored.

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
