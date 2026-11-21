// The layers panel of the live map, built like the one of Smart Parks Protect: a tab per
// kind of thing, and in each tab a search, a way to arrange and sort the rows, groups that
// fold, a tick per row and per group, and a line to show, hide, unfold or fold everything.

import { $, el, icon } from "../ui.js";

const KEY = "wnl-map-layers";

function read() {
  try {
    const stored = JSON.parse(localStorage.getItem(KEY) || "{}");
    return stored && typeof stored === "object" ? stored : {};
  } catch {
    return {};
  }
}

/** What the person chose in the panel, kept in this browser: per tab the hidden rows, the
 * rows that are off by default and were switched on (`shown`), the folded groups, whether
 * the rows are grouped and how they are sorted. */
export const choices = { tab: "animals", hidden: {}, shown: {}, folded: {}, flat: {}, sort: {}, ...read() };

export function saveChoices() {
  try {
    localStorage.setItem(KEY, JSON.stringify(choices));
  } catch {
    /* the choices last for this page only */
  }
}

export function resetChoices() {
  Object.assign(choices, { hidden: {}, shown: {}, folded: {}, flat: {}, sort: {} });
  saveChoices();
}

export function isCustomised() {
  return [choices.hidden, choices.shown, choices.folded, choices.flat, choices.sort].some((part) => Object.values(part).some((value) => (Array.isArray(value) ? value.length : value)));
}

function setOf(part, tab) {
  return new Set(choices[part][tab] || []);
}

function store(part, tab, set) {
  choices[part][tab] = [...set];
  saveChoices();
}

/** Whether a row of a tab is shown on the map. A row that is `off` by default is only shown
 * once it was ticked. */
export function isShown(tab, id, off = false) {
  return off ? (choices.shown[tab] || []).includes(id) : !(choices.hidden[tab] || []).includes(id);
}

/** Shows a row, whatever its default. */
export function show(tab, id, off = false) {
  const part = off ? "shown" : "hidden";
  const set = setOf(part, tab);
  if (off ? !set.has(id) && set.add(id) : set.delete(id)) store(part, tab, set);
}

/** A tick that can also be half on: some of the rows below are shown. */
function tick(checked, half, label, onChange) {
  const box = el("input", { type: "checkbox", "aria-label": label, checked });
  box.indeterminate = half && !checked;
  box.addEventListener("change", () => onChange(box.checked));
  return box;
}

/**
 * Draws one tab.
 * @param tab the key of the tab, under which its choices are kept
 * @param items `{id, name, sub, group, time, icon, selected, off, actions}`: `group` is the
 *   name of the group, `time` what "by last update" sorts on, `icon` a file of
 *   assets/img/icons, `off` a row that is not shown until it is ticked, `actions` nodes at
 *   the end of the row
 * @param options `{target, noun, groupLabel, empty, onChange, onPick, onDraw}`: `groupLabel`
 *   names the arrangement ("Per species"); `onChange` runs when what is shown changed,
 *   `onDraw` after every draw, also one that only folds or sorts
 */
export function drawTab(tab, items, { target, noun, groupLabel, empty, onChange, onPick, onDraw }) {
  const hidden = setOf("hidden", tab);
  const shown = setOf("shown", tab);
  const folded = setOf("folded", tab);
  const on = (item) => (item.off ? shown.has(item.id) : !hidden.has(item.id));
  const turn = (item, value) => {
    if (item.off) value ? shown.add(item.id) : shown.delete(item.id);
    else value ? hidden.delete(item.id) : hidden.add(item.id);
  };
  const flat = Boolean(choices.flat[tab]) || !groupLabel;
  const byTime = choices.sort[tab] === "recent";
  const previous = target.querySelector("input[type=search]");
  const query = previous ? previous.value : "";
  const redraw = () => drawTab(tab, items, { target, noun, groupLabel, empty, onChange, onPick, onDraw });
  const changed = () => {
    store("hidden", tab, hidden);
    store("shown", tab, shown);
    onChange();
    redraw();
  };

  const term = query.trim().toLowerCase();
  const matching = items.filter((item) => !term || `${item.name} ${item.sub || ""} ${item.group || ""}`.toLowerCase().includes(term));
  const sorted = [...matching].sort((a, b) => (byTime ? (b.time || 0) - (a.time || 0) : 0) || a.name.localeCompare(b.name, undefined, { numeric: true }));
  const groups = new Map();
  for (const item of sorted) {
    const name = flat ? "" : item.group || "Other";
    if (!groups.has(name)) groups.set(name, []);
    groups.get(name).push(item);
  }
  const names = [...groups.keys()].sort((a, b) => a.localeCompare(b));

  const row = (item, depth) =>
    el("div", { class: `layer-row${item.selected ? " selected" : ""}`, style: `padding-left:${6 + depth * 18}px` }, [
      tick(on(item), false, `Show ${item.name}`, (value) => {
        turn(item, value);
        changed();
      }),
      item.icon ? el("img", { class: "layer-icon", src: `assets/img/icons/${item.icon}.svg`, alt: "" }) : null,
      el("button", { class: "layer-name", type: "button", onclick: () => onPick(item.id) }, [el("span", { text: item.name }), item.sub ? el("small", { text: item.sub }) : null]),
      ...(item.actions || []),
    ]);

  const rows = [];
  for (const name of names) {
    const members = groups.get(name);
    if (flat) {
      rows.push(...members.map((item) => row(item, 0)));
      continue;
    }
    const count = members.filter(on).length;
    const open = !folded.has(name) || Boolean(term);
    rows.push(
      el("div", { class: "layer-row header" }, [
        el("button", { class: "btn ghost icon xs", type: "button", "aria-label": open ? "Fold" : "Unfold", title: open ? "Fold" : "Unfold", "aria-expanded": String(open), onclick: () => {
          if (folded.has(name)) folded.delete(name);
          else folded.add(name);
          store("folded", tab, folded);
          redraw();
        } }, icon(open ? "chevron-down" : "chevron-right")),
        tick(count === members.length, count > 0, `Show ${name}`, (value) => {
          for (const item of members) turn(item, value);
          changed();
        }),
        el("strong", { class: "layer-group", text: name }),
        el("small", { class: "layer-count", text: count === members.length ? String(members.length) : `${count} of ${members.length}` }),
      ]),
    );
    if (open) rows.push(...members.map((item) => row(item, 1)));
  }

  const search = el("input", { type: "search", placeholder: "Search…", "aria-label": `Search ${noun}s`, value: query });
  search.addEventListener("input", () => {
    redraw();
    const next = target.querySelector("input[type=search]");
    next.focus();
    next.setSelectionRange(next.value.length, next.value.length);
  });
  const arrange = groupLabel
    ? el("select", { class: "layer-arrange", "aria-label": "Arrange the rows", onchange: (event) => {
        choices.flat[tab] = event.target.value === "flat";
        saveChoices();
        redraw();
      } }, [el("option", { value: "groups", text: groupLabel, selected: !flat }), el("option", { value: "flat", text: "Ungrouped", selected: flat })])
    : null;
  const sortButton = el("button", { class: "btn ghost icon sm", type: "button", title: byTime ? "By last update" : "By name", "aria-label": byTime ? "Sorted by last update, sort by name" : "Sorted by name, sort by last update", onclick: () => {
    choices.sort[tab] = byTime ? "" : "recent";
    saveChoices();
    redraw();
  } }, icon(byTime ? "sort-time" : "sort-name"));
  const shownCount = items.filter(on).length;
  const all = (value) => {
    for (const item of items) turn(item, value);
    changed();
  };
  const fold = (value) => {
    store("folded", tab, new Set(value ? names : []));
    redraw();
  };
  const link = (text, onclick) => el("button", { class: "btn link", type: "button", text, onclick });

  target.replaceChildren(
    el("div", { class: "layer-tools" }, [search, arrange, sortButton]),
    el("div", { class: "layer-list" }, rows.length ? rows : el("div", { class: "picker-empty" }, items.length ? `No ${noun} matches the search.` : empty)),
    items.length
      ? el("div", { class: "layer-foot" }, [
          el("span", { text: `${shownCount} of ${items.length} shown` }),
          link("Show all", () => all(true)),
          link("Hide all", () => all(false)),
          flat ? null : link("Unfold all", () => fold(false)),
          flat ? null : link("Fold all", () => fold(true)),
        ])
      : null,
  );
  if (onDraw) onDraw();
}

/** Marks the open tab and shows its rows. A tab that is left out makes way for the first
 * one that is there; the choice of the person is kept for when it is back. Returns the tab
 * that is open. */
function markTabs() {
  const buttons = [...document.querySelectorAll("#layerTabs [role=tab]")];
  const open = buttons.find((button) => button.dataset.tab === choices.tab && !button.hidden) || buttons.find((button) => !button.hidden) || buttons[0];
  for (const button of buttons) {
    const on = button === open;
    button.classList.toggle("active", on);
    button.setAttribute("aria-selected", String(on));
    $(`layerTab-${button.dataset.tab}`).hidden = !on;
  }
  open.scrollIntoView({ block: "nearest", inline: "nearest" }); // the row of tabs scrolls on a narrow screen
  return open.dataset.tab;
}

/** Switches the panel to a tab and marks its button. */
export function openTab(tab) {
  choices.tab = tab;
  saveChoices();
  return markTabs();
}

/** Leaves out the tabs in `empty`: the ones with nothing to show and no way to get
 * something. Returns the tab that is open. */
export function offerTabs(empty) {
  for (const button of document.querySelectorAll("#layerTabs [role=tab]")) button.hidden = empty.includes(button.dataset.tab);
  return markTabs();
}
