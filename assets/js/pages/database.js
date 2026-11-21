// The Database page: the tables WildlifeNL keeps and how they belong together, read from the
// API's own description and drawn as boxes in a column per subject.

import { databaseModel } from "../lib.js";
import { account, explain } from "../session.js";
import { $, el, note } from "../ui.js";

const NS = "http://www.w3.org/2000/svg";
const BOX = { width: 168, height: 40, gapX: 44, gapY: 16, top: 34, left: 8 };

let model = null;
let server = "";
let selected = "";

function svg(tag, attrs = {}, text = "") {
  const node = document.createElementNS(NS, tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
  if (text) node.textContent = text;
  return node;
}

/** Where each box goes: a column per group, the tables of the group below each other. */
function layout() {
  const places = new Map();
  const rows = model.groups.map(() => 0);
  for (const table of model.tables) {
    const row = rows[table.group]++;
    places.set(table.name, { x: BOX.left + table.group * (BOX.width + BOX.gapX), y: BOX.top + row * (BOX.height + BOX.gapY), column: table.group });
  }
  // the width keeps room on the right for the links that bend around the last column
  return { places, width: BOX.left + model.groups.length * (BOX.width + BOX.gapX), height: BOX.top + Math.max(...rows) * (BOX.height + BOX.gapY) };
}

/** A line between two boxes: around the side when they are in one column, else across. */
function linkPath(a, b) {
  const midA = a.y + BOX.height / 2;
  const midB = b.y + BOX.height / 2;
  if (a.column === b.column) {
    const x = a.x + BOX.width;
    const bend = 16 + Math.min(18, Math.abs(midA - midB) / 8);
    return `M${x},${midA} C${x + bend},${midA} ${x + bend},${midB} ${x},${midB}`;
  }
  const [left, right, y1, y2] = a.x < b.x ? [a, b, midA, midB] : [b, a, midB, midA];
  const x1 = left.x + BOX.width;
  const x2 = right.x;
  const mid = (x1 + x2) / 2;
  return `M${x1},${y1} C${mid},${y1} ${mid},${y2} ${x2},${y2}`;
}

function neighbours(name) {
  return model.links.filter((link) => link.from === name || link.to === name).map((link) => (link.from === name ? link.to : link.from));
}

function drawGraph() {
  const graph = $("databaseGraph");
  const { places, width, height } = layout();
  graph.setAttribute("viewBox", `0 0 ${width} ${height}`);
  // the drawing scales to the card; on a narrow screen it keeps a readable size and scrolls
  graph.style.minWidth = `${Math.min(width, 900)}px`;
  const near = selected ? new Set([selected, ...neighbours(selected)]) : null;
  const nodes = [];
  model.groups.forEach((group, index) => {
    nodes.push(svg("text", { class: `graph-group g${index}`, x: BOX.left + index * (BOX.width + BOX.gapX), y: 16 }, group));
  });
  for (const link of model.links) {
    const on = selected && (link.from === selected || link.to === selected);
    nodes.push(svg("path", { class: `graph-link${on ? " on" : selected ? " off" : ""}`, d: linkPath(places.get(link.from), places.get(link.to)) }));
  }
  for (const table of model.tables) {
    const place = places.get(table.name);
    const state = !near ? "" : table.name === selected ? " selected" : near.has(table.name) ? " near" : " off";
    const box = svg("g", { class: `graph-box g${table.group}${state}`, transform: `translate(${place.x},${place.y})`, tabindex: 0, role: "button", "aria-label": `${table.label}: ${table.description}` });
    box.append(svg("rect", { width: BOX.width, height: BOX.height, rx: 8 }), svg("text", { x: BOX.width / 2, y: BOX.height / 2 + 4.5, "text-anchor": "middle" }, table.label), svg("title", {}, table.description));
    const pick = () => select(table.name === selected ? "" : table.name);
    box.addEventListener("click", pick);
    box.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        pick();
      }
    });
    nodes.push(box);
  }
  graph.replaceChildren(...nodes);
  $("databaseLegend").replaceChildren(el("span", { text: `${model.tables.length} kinds of records, ${model.links.length} links` }));
}

function drawDetail() {
  const target = $("databaseDetail");
  const table = model.tables.find((t) => t.name === selected);
  target.hidden = !table;
  if (!table) return;
  const linked = neighbours(table.name).map((name) => model.tables.find((t) => t.name === name));
  target.replaceChildren(
    el("h2", {}, [el("i", { class: `dot g${table.group}` }), table.label]),
    el("p", { text: table.description || "A kind of record in WildlifeNL." }),
    linked.length
      ? el("div", { class: "row" }, [el("span", { class: "hint", text: "Belongs together with" }), ...linked.map((other) => el("button", { class: "badge", type: "button", onclick: () => select(other.name) }, [el("i", { class: `dot g${other.group}` }), other.label]))])
      : null,
    el(
      "div",
      { class: "table-scroll" },
      el("table", { class: "table wrap" }, [
        el("thead", {}, el("tr", {}, ["What", "Kind", "Meaning"].map((text) => el("th", { text })))),
        el(
          "tbody",
          {},
          table.fields.map((field) => el("tr", {}, [el("td", { text: field.label }), el("td", { text: field.kind }), el("td", { text: field.description })])),
        ),
      ]),
    ),
    el("p", { class: "hint", text: `In the API this is called ${table.name}. The field names there are: ${table.fields.map((f) => f.name).join(", ")}.` }),
  );
}

function select(name) {
  selected = name;
  drawGraph();
  drawDetail();
  if (name) $("databaseDetail").scrollIntoView({ behavior: "smooth", block: "nearest" });
}

export async function show() {
  const { baseUrl } = account.session;
  if (model && server === baseUrl) return;
  note($("databaseNote"), "");
  try {
    model = databaseModel(await account.api.openapi());
    server = baseUrl;
    selected = "";
    drawGraph();
    drawDetail();
  } catch (error) {
    const text = explain(error);
    if (text) note($("databaseNote"), `Could not read the description of the database: ${text}`, "error");
  }
}

export function reset() {
  model = null;
  selected = "";
  $("databaseGraph").replaceChildren();
  $("databaseDetail").hidden = true;
}
