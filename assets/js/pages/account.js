// The account: profile, roles and what they allow, to read and to change.

import { SCOPES } from "../api.js";
import { operationLabel } from "../lib.js";
import { loadApi, writeOperations } from "../rights.js";
import { account, explain, hasScope, refreshProfile, signOut } from "../session.js";
import { onSharing, setSharing, sharing, showsNearby } from "../sharing.js";
import { $, busy, el, facts, formatMoment, note, plural, toast } from "../ui.js";
import { drawActions, inApp } from "../writes.js";

let wired = false;

function badge(ok, yes, no) {
  return el("span", { class: `badge ${ok ? "ok" : "bad"}` }, [el("i", { class: `dot ${ok ? "ok" : "bad"}` }), ok ? yes : no]);
}

/** What the account may change: every call of the API that writes, with the roles the API
 * itself names for it on this server. */
async function drawRights() {
  const table = $("rightsTable");
  note($("rightsNote"), "");
  try {
    await loadApi();
  } catch (error) {
    const text = explain(error);
    if (text) note($("rightsNote"), `Could not read what your account may change: ${text}`, "error");
    return;
  }
  const calls = writeOperations()
    .map((operation) => ({ operation, label: operationLabel(operation.summary), ok: hasScope(operation.roles) }))
    .sort((a, b) => Number(b.ok) - Number(a.ok) || a.label.localeCompare(b.label));
  table.replaceChildren(
    el("thead", {}, el("tr", {}, ["What", "Needs one of these roles", "Your account", "In this app"].map((text) => el("th", { text })))),
    el(
      "tbody",
      {},
      calls.map(({ operation, label, ok }) =>
        el("tr", {}, [el("td", { text: label }), el("td", { text: operation.roles.join(", ") || "Any account" }), el("td", {}, badge(ok, "Allowed", "Not allowed")), el("td", { text: inApp(operation.method, operation.path) ? "Yes" : "No" })]),
      ),
    ),
  );
}

function drawSharing() {
  $("sharingSwitch").checked = sharing.on;
  // what sharing gives back depends on what the roles of the account read anyway
  $("sharingReturn").textContent = showsNearby() ? "In return the live map shows what WildlifeNL finds near you, of the kinds your roles do not let you read: animals, detections or reports." : "Your roles already read the animals, detections and reports, so the map shows you nothing new in return.";
  const near = hasScope(SCOPES.animalsNear) ? "" : ` Near you: ${plural(sharing.animals.length, "animal")}.`;
  $("sharingStatus").textContent = !sharing.on ? sharing.message : sharing.last ? `Last sent ${formatMoment(sharing.last)}.${near}` : sharing.message || "Looking for your position…";
}

function draw() {
  const { session } = account;
  drawSharing();
  facts($("accountFacts"), [
    ["Name", session.name || "Not set"],
    ["Email address", session.email || "Unknown"],
    ["User ID", session.userID || "Unknown"],
    ["Server", new URL(session.baseUrl).host],
    ["Roles", session.scopes.length ? el("span", { class: "row" }, session.scopes.map((scope) => el("span", { class: "badge", text: scope }))) : "None. The account can sign in but reads only what every user may read."],
  ]);
  const access = [
    ["The animals with a sensor", SCOPES.deployments],
    ["Readings: the track and measurements of an animal or a sensor", SCOPES.readings],
    ["Detections, reports from others and visits of a living lab", SCOPES.detections],
    ["Zones", SCOPES.zones],
    ["Experiments with their questionnaires, messages and responses", SCOPES.research],
    ["Other people: where they were, their contacts and messages (every account sees its own)", SCOPES.research],
    ["All alarms (every account sees its own)", SCOPES.alarms],
    ["The accounts", SCOPES.profiles],
  ];

  $("accessTable").replaceChildren(
    el("thead", {}, el("tr", {}, ["What", "Needs one of these roles", "Your account"].map((text) => el("th", { text })))),
    el(
      "tbody",
      {},
      access.map(([what, needed]) => {
        return el("tr", {}, [el("td", { text: what }), el("td", { text: needed.join(", ") }), el("td", {}, badge(hasScope(needed), "Allowed", "Not allowed"))]);
      }),
    ),
  );
  drawRights();
  // the profile as WildlifeNL holds it now, read when the form opens
  drawActions($("accountActions"), "account", "record", () => account.api.profile(), async () => {
    await refreshProfile();
    draw();
  });
}

function wire() {
  wired = true;
  $("sharingSwitch").addEventListener("change", (event) => setSharing(event.target.checked));
  onSharing(() => account.session && drawSharing());
  $("signOutButton2").addEventListener("click", () => signOut());
  $("copyToken").addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(account.session.token);
      toast("Copied the token. Treat it like a password.");
    } catch {
      toast("The browser refused access to the clipboard", true);
    }
  });
  $("refreshProfile").addEventListener("click", (event) =>
    busy(event.currentTarget, async () => {
      try {
        await refreshProfile();
        draw();
        toast("Profile refreshed");
      } catch (error) {
        const text = explain(error);
        if (text) toast(text, true);
      }
    }),
  );
}

export function show() {
  if (!wired) wire();
  draw();
}

export function reset() {}
