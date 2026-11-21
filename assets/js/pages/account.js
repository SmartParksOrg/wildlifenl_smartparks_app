// The account: profile, roles and what they allow.

import { SCOPES } from "../api.js";
import { account, explain, hasScope, refreshProfile, signOut } from "../session.js";
import { $, busy, el, facts, toast } from "../ui.js";

let wired = false;

function draw() {
  const { session } = account;
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
        const ok = hasScope(needed);
        return el("tr", {}, [el("td", { text: what }), el("td", { text: needed.join(", ") }), el("td", {}, el("span", { class: `badge ${ok ? "ok" : "bad"}` }, [el("i", { class: `dot ${ok ? "ok" : "bad"}` }), ok ? "Allowed" : "Not allowed"]))]);
      }),
    ),
  );
}

function wire() {
  wired = true;
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
