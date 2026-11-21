// The About page: what the app is, and where to read more.

import { account } from "../session.js";
import { $, el, facts } from "../ui.js";

let version = "";

function link(href, text) {
  return el("a", { href, target: "_blank", rel: "noopener", text });
}

function draw() {
  const { baseUrl } = account.session;
  facts($("aboutLinks"), [
    ["WildlifeNL", link("https://wildlifenl.nl", "wildlifenl.nl, the research programme")],
    ["WildlifeNL API", link(`${baseUrl}/`, `${new URL(baseUrl).host}, the documentation of the server you are signed in to`)],
    ["Smart Parks", link("https://www.smartparks.org", "smartparks.org")],
    ["Smart Parks Protect", link("https://github.com/SmartParksOrg/smartparks-protect", "The platform that sends the collar data")],
    ["Source code", link("https://github.com/SmartParksOrg/wildlifenl_smartparks_app", "github.com/SmartParksOrg/wildlifenl_smartparks_app")],
    ["Report a problem", link("https://github.com/SmartParksOrg/wildlifenl_smartparks_app/issues", "Open an issue on GitHub")],
    ["Version", version || "Unknown"],
  ]);
}

export function show() {
  draw();
  if (version) return;
  fetch("VERSION")
    .then((response) => (response.ok ? response.text() : ""))
    .then((text) => {
      version = text.trim();
      if (account.session) draw();
    })
    .catch(() => {});
}

export function reset() {}
