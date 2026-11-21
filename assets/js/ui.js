// Small building blocks every page uses: elements, messages, tiles, facts and the data table.

import { cellText, columnsOf, toCsv } from "./lib.js";

const PAGE_SIZE = 200;

export const $ = (id) => document.getElementById(id);

export function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key === "class") node.className = value;
    else if (key === "text") node.textContent = value;
    else if (key.startsWith("on")) node.addEventListener(key.slice(2), value);
    else if (value !== false && value != null) node.setAttribute(key, value === true ? "" : value);
  }
  for (const child of [].concat(children)) if (child != null && child !== false) node.append(child);
  return node;
}

/** An icon from the sprite in index.html. */
export function icon(name) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("class", "icon");
  svg.setAttribute("aria-hidden", "true");
  const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
  use.setAttribute("href", `#i-${name}`);
  svg.append(use);
  return svg;
}

export function toast(message, isError = false) {
  const node = el("div", { class: `toast${isError ? " error" : ""}`, text: message });
  $("toasts").append(node);
  setTimeout(() => node.remove(), isError ? 6000 : 2500);
}

/** Shows a callout, or hides it when there is no text. */
export function note(target, text, kind = "") {
  target.hidden = !text;
  target.className = `callout${kind ? ` ${kind}` : ""}`;
  target.textContent = text || "";
}

/** Runs an async action with the button disabled and spinning; returns its result. */
export async function busy(button, action) {
  button.disabled = true;
  button.classList.add("loading");
  try {
    return await action();
  } finally {
    button.disabled = false;
    button.classList.remove("loading");
  }
}

export function tiles(target, items) {
  target.replaceChildren(
    ...items.map((item) =>
      el("div", { class: "tile" }, [
        el("div", { class: "tile-label", text: item.label }),
        el("div", { class: "tile-value", text: item.value, title: item.value }),
        el("div", { class: "tile-note", text: item.note || " ", title: item.note || "" }),
      ]),
    ),
  );
}

/** A two column list of terms and values; a value is text or a node, empty values are skipped. */
export function facts(target, pairs) {
  target.replaceChildren(...pairs.filter(([, value]) => value != null && value !== "").flatMap(([term, value]) => [el("dt", { text: term }), el("dd", {}, value)]));
}

export function download(filename, text, mime) {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  el("a", { href: url, download: filename }).click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function formatMoment(t) {
  return Number.isFinite(t) ? new Date(t).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "";
}

export function plural(count, word) {
  return `${count.toLocaleString()} ${word}${count === 1 ? "" : "s"}`;
}

export function fileStamp() {
  return new Date().toISOString().slice(0, 19).replace(/[:T]/g, "");
}

function sortValue(value) {
  if (value == null || value === "") return null;
  if (typeof value === "number") return value;
  const text = cellText(value);
  if (/^-?\d+(\.\d+)?$/.test(text)) return Number(text);
  if (/^\d{4}-\d{2}-\d{2}T/.test(text)) return Date.parse(text);
  return text.toLowerCase();
}

/** A sortable, filterable table of flat rows with CSV and JSON export. Renders 200 rows at a
 * time so a sensor with years of readings stays fast. `link` turns the cells of one column
 * into links, `onRow` makes a whole row clickable. */
export class DataTable {
  constructor(container, { filename, empty = "Nothing loaded yet.", tools = true }) {
    this.filename = filename;
    this.rows = [];
    this.raw = [];
    this.columns = [];
    this.labels = {};
    this.link = null;
    this.sortKey = null;
    this.sortDir = -1;
    this.shown = PAGE_SIZE;
    this.filter = el("input", { type: "search", placeholder: "Filter rows", "aria-label": "Filter rows", oninput: () => this.draw(true) });
    this.count = el("span", { class: "table-count" });
    this.head = el("thead");
    this.body = el("tbody");
    this.more = el("div", { class: "table-more" });
    this.scroll = el("div", { class: "table-scroll" }, el("table", { class: "table" }, [this.head, this.body]));
    this.emptyNode = el("div", { class: "empty", text: empty });
    container.replaceChildren(
      el("div", { class: "table-tools" }, [
        this.filter,
        this.count,
        tools ? el("button", { class: "btn outline sm", type: "button", text: "Copy JSON", onclick: () => this.copyJson() }) : null,
        tools ? el("button", { class: "btn outline sm", type: "button", text: "Download CSV", onclick: () => this.downloadCsv() }) : null,
      ]),
      this.scroll,
      this.emptyNode,
      this.more,
    );
    this.draw();
  }

  /** @param rows flat objects; `raw` is what Copy JSON gives (the server's own records) */
  setRows(rows, { columns, labels = {}, sortKey, sortDir = -1, raw, link = null, empty } = {}) {
    this.rows = rows;
    this.raw = raw || rows;
    this.columns = columns || columnsOf(rows);
    this.labels = labels;
    this.link = link;
    this.sortKey = sortKey || this.columns[0] || null;
    this.sortDir = sortDir;
    if (empty) this.emptyNode.textContent = empty;
    this.draw(true);
  }

  visibleRows() {
    const query = this.filter.value.trim().toLowerCase();
    let rows = this.rows;
    if (query) rows = rows.filter((row) => this.columns.some((c) => cellText(row[c]).toLowerCase().includes(query)));
    const key = this.sortKey;
    if (!key) return rows;
    return [...rows].sort((a, b) => {
      const x = sortValue(a[key]);
      const y = sortValue(b[key]);
      if (x === null || y === null) return (x === null) - (y === null); // empty cells last
      if (typeof x !== typeof y) return String(x).localeCompare(String(y)) * this.sortDir;
      return (x < y ? -1 : x > y ? 1 : 0) * this.sortDir;
    });
  }

  draw(reset = false) {
    if (reset) this.shown = PAGE_SIZE;
    const rows = this.visibleRows();
    const has = this.rows.length > 0;
    this.scroll.hidden = !has;
    this.emptyNode.hidden = has;
    this.count.textContent = has ? (rows.length === this.rows.length ? plural(rows.length, "row") : `${rows.length.toLocaleString()} of ${plural(this.rows.length, "row")}`) : "";
    this.head.replaceChildren(
      el(
        "tr",
        {},
        this.columns.map((key) => {
          const active = key === this.sortKey;
          return el("th", { "aria-sort": active ? (this.sortDir > 0 ? "ascending" : "descending") : null }, [
            el("button", {
              type: "button",
              text: `${this.labels[key] || key}${active ? (this.sortDir > 0 ? " ▲" : " ▼") : ""}`,
              onclick: () => {
                this.sortDir = active ? -this.sortDir : 1;
                this.sortKey = key;
                this.draw(true);
              },
            }),
          ]);
        }),
      ),
    );
    this.body.replaceChildren(
      ...rows.slice(0, this.shown).map((row) =>
        el(
          "tr",
          {},
          this.columns.map((key) => {
            const text = cellText(row[key]);
            const href = this.link && this.link.column === key && text ? this.link.href(row) : null;
            if (href) return el("td", {}, el("a", { href, text }));
            return el("td", { text, title: text.length > 30 ? text : null });
          }),
        ),
      ),
    );
    const left = rows.length - this.shown;
    this.more.replaceChildren(
      left > 0
        ? el("button", {
            class: "btn outline sm",
            type: "button",
            text: `Show ${Math.min(left, PAGE_SIZE).toLocaleString()} more (${left.toLocaleString()} left)`,
            onclick: () => {
              this.shown += PAGE_SIZE;
              this.draw();
            },
          })
        : "",
    );
  }

  async copyJson() {
    if (!this.raw.length) return toast("Nothing to copy yet");
    try {
      await navigator.clipboard.writeText(JSON.stringify(this.raw, null, 2));
      toast("Copied JSON to the clipboard");
    } catch {
      toast("The browser refused access to the clipboard", true);
    }
  }

  downloadCsv() {
    if (!this.rows.length) return toast("Nothing to download yet");
    download(`${this.filename}-${fileStamp()}.csv`, toCsv(this.visibleRows(), this.columns), "text/csv");
  }
}

/** A dropdown with checkboxes, the multi-select of the data explorer. `options` are
 * `{value, label, note}`; `onChange` gets the chosen values in the order of the options. */
export class MultiPicker {
  constructor(container, { placeholder, noun, max = Infinity, onChange }) {
    this.placeholder = placeholder;
    this.noun = noun;
    this.max = max;
    this.onChange = onChange;
    this.options = [];
    this.chosen = new Set();
    this.summary = el("summary", { class: "picker-summary" });
    this.list = el("div", { class: "picker-list" });
    this.details = el("details", { class: "picker" }, [this.summary, this.list]);
    container.replaceChildren(this.details);
    document.addEventListener("click", (event) => {
      if (!this.details.contains(event.target)) this.details.open = false;
    });
  }

  set(options, chosen) {
    this.options = options;
    this.chosen = new Set(chosen.filter((value) => options.some((o) => o.value === value)).slice(0, this.max));
    this.draw();
  }

  values() {
    return this.options.map((o) => o.value).filter((value) => this.chosen.has(value));
  }

  draw() {
    const values = this.values();
    const first = this.options.find((o) => o.value === values[0]);
    this.summary.textContent = values.length === 0 ? this.placeholder : values.length === 1 ? first.label : `${values.length} ${this.noun}`;
    this.summary.classList.toggle("placeholder", values.length === 0);
    const full = values.length >= this.max;
    this.list.replaceChildren(
      ...(this.options.length
        ? this.options.map((option) => {
            const checked = this.chosen.has(option.value);
            const box = el("input", { type: "checkbox", checked, disabled: full && !checked });
            box.addEventListener("change", () => {
              if (box.checked) this.chosen.add(option.value);
              else this.chosen.delete(option.value);
              this.draw();
              this.onChange(this.values());
            });
            return el("label", { class: "picker-option" }, [box, el("span", { text: option.label }), option.note ? el("small", { text: option.note }) : null]);
          })
        : [el("div", { class: "picker-empty", text: "Nothing to choose from yet." })]),
      full && Number.isFinite(this.max) ? el("div", { class: "picker-empty", text: `At most ${this.max} at a time.` }) : "",
    );
  }
}
