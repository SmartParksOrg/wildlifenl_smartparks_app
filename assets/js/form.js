// The dialog that asks a person for the fields of a change, or to confirm one. The fields come
// from `formFields` in lib.js, so a form follows what the API says a call takes. A place is
// typed or clicked on a map, an outline is drawn on it.

import { formBody, localInput } from "./lib.js";
import { MapView } from "./map.js";
import { explain } from "./session.js";
import { $, busy, el, icon, note, plural } from "./ui.js";

let map = null;
let settle = null;

function hint(field) {
  return field.description ? el("span", { class: "hint", text: field.description }) : null;
}

/** The name of a field, with a word for the ones that may stay empty. */
function caption(field) {
  return field.required && !field.nullable ? field.label : `${field.label} (optional)`;
}

function labelled(field, control) {
  return el("label", { class: "field" }, [el("span", { text: caption(field) }), control, hint(field)]);
}

function select(field, options, value) {
  const node = el("select", { required: field.required && !field.nullable }, [
    el("option", { value: "", text: field.required && !field.nullable ? "Choose…" : "None" }),
    ...options.map((option) => el("option", { value: option.value, text: option.label, selected: value != null && String(option.value) === String(value) })),
  ]);
  return { node: labelled(field, node), read: () => node.value };
}

/** Several of a list of choices, a tick each. */
function ticks(field, options) {
  const boxes = options.map((option) => el("input", { type: "checkbox", value: option.value }));
  const node = el("fieldset", { class: "form-group" }, [el("legend", { text: caption(field) }), hint(field), ...options.map((option, index) => el("label", { class: "check" }, [boxes[index], el("span", { text: option.label })]))]);
  return { node, read: () => boxes.filter((box) => box.checked).map((box) => box.value) };
}

/** One value: a text, a number, a moment, a tick or a choice. */
function scalar(field, value, choices) {
  if (field.kind === "ticks") return ticks(field, choices || []);
  if (choices) return select(field, choices, value);
  if (field.kind === "choice") return select(field, field.options.map((option) => ({ value: option, label: option })), value);
  if (field.kind === "yesno") {
    const node = el("input", { type: "checkbox", checked: Boolean(value) });
    return { node: el("div", { class: "field" }, [el("label", { class: "check" }, [node, el("span", { text: field.label })]), hint(field)]), read: () => node.checked };
  }
  if (field.kind === "longtext") {
    const node = el("textarea", { rows: 3, required: field.required && Boolean(field.minLength), minlength: field.minLength });
    node.value = value == null ? "" : String(value);
    return { node: labelled(field, node), read: () => node.value };
  }
  const number = field.kind === "integer" || field.kind === "number";
  const type = number ? "number" : { moment: "datetime-local", date: "date", email: "email", url: "url" }[field.kind] || "text";
  const node = el("input", {
    type,
    // a text the API asks for without a shortest length may stay empty
    required: field.required && !field.nullable && (type !== "text" || Boolean(field.minLength)),
    minlength: field.minLength,
    pattern: field.pattern,
    min: field.min,
    max: field.max,
    step: field.kind === "number" ? "any" : null,
    autocomplete: "off",
    spellcheck: type === "text" && !field.pattern ? null : "false",
  });
  node.value = value == null ? "" : field.kind === "moment" ? localInput(value) : field.kind === "date" ? String(value).slice(0, 10) : String(value);
  return { node: labelled(field, node), read: () => node.value };
}

/** A place: latitude and longitude, typed or clicked on the map. */
function point(field, value, places) {
  const input = (label, limit, start) => {
    const node = el("input", { type: "number", step: "any", min: -limit, max: limit, required: field.required, placeholder: label, "aria-label": `${field.label}: ${label.toLowerCase()}` });
    node.value = start == null ? "" : String(start);
    return node;
  };
  const latitude = input("Latitude", 90, value && value.latitude);
  const longitude = input("Longitude", 180, value && value.longitude);
  const button = el("button", { class: "btn outline sm", type: "button", "aria-pressed": "false" }, [icon("pin"), "Set on the map"]);
  const place = {
    button,
    words: `Click the map to set ${field.label.toLowerCase()}.`,
    points: () => (latitude.value !== "" && longitude.value !== "" ? [{ lat: Number(latitude.value), lng: Number(longitude.value) }] : []),
    outline: () => [],
    click: ({ lat, lng }) => {
      latitude.value = lat.toFixed(6);
      longitude.value = lng.toFixed(6);
    },
  };
  places.push(place);
  return {
    node: el("div", { class: "field" }, [el("span", { text: caption(field) }), el("div", { class: "form-place" }, [latitude, longitude, button]), hint(field)]),
    read: () => ({ latitude: latitude.value, longitude: longitude.value }),
  };
}

/** An outline: the corners of an area, clicked on the map one by one. */
function outline(field, value, places) {
  let corners = (Array.isArray(value) ? value : []).map((corner) => ({ lat: Number(corner.latitude), lng: Number(corner.longitude) })).filter((corner) => Number.isFinite(corner.lat) && Number.isFinite(corner.lng));
  const count = el("span", { class: "hint" });
  const button = el("button", { class: "btn outline sm", type: "button", "aria-pressed": "false" }, [icon("pin"), "Draw on the map"]);
  const place = {
    button,
    words: "Click the map to add the corners, one after the other.",
    points: () => corners,
    outline: () => corners,
    click: (corner) => corners.push(corner),
    changed: () => (count.textContent = corners.length ? plural(corners.length, "corner") : "No corners yet"),
  };
  place.changed();
  places.push(place);
  const change = (next) => {
    corners = next;
    place.redraw();
  };
  return {
    node: el("div", { class: "field" }, [
      el("span", { text: field.label }),
      el("div", { class: "row" }, [
        button,
        el("button", { class: "btn outline sm", type: "button", onclick: () => change(corners.slice(0, -1)) }, [icon("undo"), "Remove the last corner"]),
        el("button", { class: "btn outline sm", type: "button", onclick: () => change([]) }, [icon("trash"), "Start again"]),
        count,
      ]),
      hint(field),
    ]),
    read: () => corners.map((corner) => ({ latitude: corner.lat, longitude: corner.lng })),
  };
}

/** Details with fields of their own. Optional details are there when their rule in `when`
 * says so, or else when the person ticks them. */
function group(field, value, context) {
  const inner = controls(field.fields, value || {}, { ...context, choices: {}, when: {} });
  const body = el("div", { class: "form-grid" }, inner.map((control) => control.node));
  const rule = context.when[field.name];
  const tick = !field.required && !rule ? el("input", { type: "checkbox", checked: Boolean(value) }) : null;
  const node = el("fieldset", { class: "form-group" }, [el("legend", {}, tick ? el("label", { class: "check" }, [tick, el("span", { text: field.label })]) : field.label), hint(field), body]);
  const included = () => (rule ? Boolean(rule(context.values())) : tick ? tick.checked : true);
  const refresh = () => {
    const on = included();
    node.disabled = !on; // a switched off part is not checked by the browser
    node.hidden = Boolean(rule) && !on;
    body.hidden = !on;
    for (const control of inner) if (control.refresh) control.refresh();
  };
  return { node, refresh, read: () => (included() ? Object.fromEntries(inner.map((control) => [control.name, control.read()])) : null) };
}

/** Several details of one kind, each on a row that can be removed. */
function list(field, value, context) {
  const rows = [];
  const body = el("div", { class: "stack" });
  const add = (start) => {
    const inner = controls(field.fields, start || {}, { ...context, choices: {}, when: {} });
    const row = { inner };
    row.node = el("div", { class: "form-row" }, [
      ...inner.map((control) => control.node),
      el("button", { class: "btn outline icon", type: "button", "aria-label": "Remove this row", title: "Remove this row", onclick: () => {
        rows.splice(rows.indexOf(row), 1);
        row.node.remove();
      } }, icon("trash")),
    ]);
    rows.push(row);
    body.append(row.node);
    for (const control of inner) if (control.refresh) control.refresh();
  };
  for (const item of Array.isArray(value) ? value : []) add(item);
  const node = el("fieldset", { class: "form-group" }, [el("legend", { text: field.label }), hint(field), body, el("div", {}, el("button", { class: "btn outline sm", type: "button", onclick: () => add() }, "Add a row"))]);
  return { node, read: () => rows.map((row) => Object.fromEntries(row.inner.map((control) => [control.name, control.read()]))) };
}

function controls(fields, values, context) {
  return fields.map((field) => {
    const value = values[field.name];
    const make = { point, outline }[field.kind];
    const control = make ? make(field, value, context.places) : field.kind === "group" ? group(field, value, context) : field.kind === "list" ? list(field, value, context) : scalar(field, value, context.choices[field.name]);
    return { name: field.name, plain: field.kind !== "group" && field.kind !== "list", ...control };
  });
}

/** The map of the form: it shows every place of the form, and a click goes to the place
 * whose button was pressed last. */
function wirePlaces(places) {
  $("formMapBlock").hidden = !places.length;
  if (!places.length) return;
  if (!map) map = new MapView($("formMap"));
  let active = places[0];
  const draw = (fit = false) => {
    for (const place of places) if (place.changed) place.changed();
    const points = places.flatMap((place) => place.points());
    map.setPoints(points, { fit });
    map.setArea(places.flatMap((place) => place.outline()), { fit: false });
  };
  const choose = (place) => {
    active = place;
    for (const other of places) other.button.setAttribute("aria-pressed", String(other === place));
    $("formMapHint").textContent = place.words;
  };
  for (const place of places) {
    place.redraw = () => draw();
    place.button.addEventListener("click", () => {
      choose(place);
      $("formMap").scrollIntoView({ behavior: "smooth", block: "nearest" });
    });
  }
  map.onClick = (spot) => {
    active.click(spot);
    draw();
  };
  $("formFields").addEventListener("input", () => draw()); // a typed latitude or longitude moves its point
  choose(active);
  draw(true);
}

/**
 * Opens the dialog and resolves to `{result}` once `send` succeeded, or to null when the
 * person cancelled.
 * @param title what is about to happen, `subtitle` the record it happens to
 * @param text an explanation above the fields; with no fields the dialog asks to confirm
 * @param fields from `formFields`, `values` what they start with
 * @param choices per field name the `{value, label}` options of a list to pick from
 * @param when per name of optional details a rule `(values) => boolean` for showing them
 * @param send makes the call with the body; what it throws is shown in the dialog
 */
export function openForm({ title, subtitle = "", text = "", fields = [], values = {}, choices = {}, when = {}, submit = "Save", danger = false, send }) {
  const dialog = $("formDialog");
  if (settle) settle(null); // a form that was still open makes way
  $("formTitle").textContent = title;
  $("formSubtitle").textContent = subtitle;
  $("formSubtitle").hidden = !subtitle;
  $("formText").textContent = text;
  $("formText").hidden = !text;
  note($("formError"), "");
  const button = $("formSubmit");
  button.textContent = submit;
  button.className = `btn ${danger ? "destructive" : "primary"}`;

  // a fresh node per form, so the listeners of the last form are gone
  const target = el("div", { class: "stack", id: "formFields" });
  $("formFields").replaceWith(target);
  const places = [];
  let all = [];
  const read = () => Object.fromEntries(all.map((control) => [control.name, control.read()]));
  // a rule in `when` sees the plain values of the form, not the details it decides about
  const plain = () => Object.fromEntries(all.filter((control) => control.plain).map((control) => [control.name, control.read()]));
  all = controls(fields, values, { choices, when, places, values: plain });
  target.append(...all.map((control) => control.node));
  const refresh = () => {
    for (const control of all) if (control.refresh) control.refresh();
  };
  target.addEventListener("change", refresh);
  refresh();

  return new Promise((resolve) => {
    settle = resolve;
    $("formForm").onsubmit = async (event) => {
      event.preventDefault();
      note($("formError"), "");
      let body;
      try {
        body = formBody(fields, read());
      } catch (error) {
        return note($("formError"), error.message, "error");
      }
      await busy(button, async () => {
        try {
          const result = await send(body);
          settle = null;
          dialog.close();
          resolve({ result });
        } catch (error) {
          const problem = explain(error); // empty when the token was refused and the session ended
          if (problem) note($("formError"), problem, "error");
        }
      });
    };
    if (!dialog.open) dialog.showModal();
    wirePlaces(places);
  });
}

/** Closes the dialog as if the person cancelled. */
export function closeForm() {
  if ($("formDialog").open) $("formDialog").close();
}

export function wireForm() {
  $("formCancel").addEventListener("click", closeForm);
  // Esc does not close the dialog while a call is on its way, so its answer is not lost
  $("formDialog").addEventListener("cancel", (event) => {
    if ($("formSubmit").disabled) event.preventDefault();
  });
  $("formDialog").addEventListener("close", () => {
    // the browser tells of a close a moment later; by then the next form of a row of
    // questions may be open, and that one is not cancelled
    if ($("formDialog").open) return;
    if (map) map.onClick = null;
    if (settle) settle(null);
    settle = null;
  });
}
