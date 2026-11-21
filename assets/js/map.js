// Maps on MapLibre GL JS with the base maps Smart Parks Protect uses (OpenFreeMap, no key).
// MapView is the small map of a page (points and a track); LiveMap is the live map with a
// marker per sensor, coloured tracks and detections.

/** The default follows the theme: Light by day, Night at night. */
export const BASEMAPS = {
  auto: { label: "Follows the theme", style: "positron" },
  liberty: { label: "Streets", style: "liberty" },
  positron: { label: "Light", style: "positron" },
  bright: { label: "Bright", style: "bright" },
  dark: { label: "Night", style: "fiord" },
};
const BASEMAP_KEY = "wnl-basemap";
const NETHERLANDS = { center: [5.3, 52.1], zoom: 6.5 };
const FONT = ["Noto Sans Regular"]; // the glyphs OpenFreeMap serves
const GREEN = "#52735E";
const CORAL = "#D9825F";
const MAX_TRACK_DOTS = 2000;
/** Protect's value: markers group when they would overlap, not before. */
const CLUSTER_RADIUS_PX = 28;
const CLICKABLE = ["sensors", "sensor-clusters", "track-points", "detections"];
/** WildlifeNL answers a detection query within at most this many metres of a point. */
export const MAX_RADIUS_M = 10000;

/** One colour per track, in the order Protect uses, and a lighter set of the same hues for a
 * dark ground. A track is known by its slot, so it keeps its hue when the ground changes. */
export const TRACK_COLORS = ["#2F4A3A", "#b45309", "#1d4ed8", "#be185d", "#0f766e", "#6d28d9", "#a16207", "#374151"];
const TRACK_COLORS_NIGHT = ["#90ae9b", "#f0a35e", "#7aa7f7", "#f08fc0", "#5ecfc0", "#b79cf5", "#e0c060", "#c5ccd3"];

/** The colour of a track slot on the page itself, which follows the theme. */
export function trackColor(slot) {
  return (darkTheme() ? TRACK_COLORS_NIGHT : TRACK_COLORS)[slot];
}

function darkTheme() {
  return document.documentElement.classList.contains("dark");
}

export function loadBasemap() {
  try {
    const value = localStorage.getItem(BASEMAP_KEY);
    return value in BASEMAPS ? value : "auto";
  } catch {
    return "auto";
  }
}

function saveBasemap(key) {
  try {
    localStorage.setItem(BASEMAP_KEY, key);
  } catch {
    /* the choice lasts for this page only */
  }
}

function nightMap(key) {
  return key === "dark" || (key === "auto" && darkTheme());
}

function styleUrl(key) {
  const style = nightMap(key) ? "fiord" : (BASEMAPS[key] || BASEMAPS.auto).style;
  return `https://tiles.openfreemap.org/styles/${style}`;
}

export function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[c]);
}

function popupHtml(title, lines) {
  return `<strong>${escapeHtml(title || "")}</strong>${(lines || []).filter(Boolean).map((line) => `<br>${escapeHtml(line)}`).join("")}`;
}

function collection(features) {
  return { type: "FeatureCollection", features };
}

/** A circle of `radius` metres around a point as a polygon, for the search area. */
function circleFeature(center, radius) {
  const ring = [];
  const latStep = radius / 111320;
  const lngStep = radius / (111320 * Math.cos((center.lat * Math.PI) / 180));
  for (let i = 0; i <= 64; i++) {
    const angle = (i / 64) * 2 * Math.PI;
    ring.push([center.lng + lngStep * Math.cos(angle), center.lat + latStep * Math.sin(angle)]);
  }
  return { type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [ring] } };
}

// Marker images, drawn the way Smart Parks Protect draws them: a white disc with a ring in
// the state colour and the icon of the species inside. A sensor without an animal is a
// rounded square, Protect's shape for devices.
const MARKER_COLOURS = { normal: GREEN, selected: "#2563EB" };
const SELECTED_HALO = "rgba(37, 99, 235, 0.28)";
const iconTexts = new Map();

function markerId(iconName, state) {
  return `marker:${iconName}:${state}`;
}

function iconText(name) {
  if (!iconTexts.has(name)) {
    iconTexts.set(
      name,
      fetch(`assets/img/icons/${name}.svg`)
        .then((response) => (response.ok ? response.text() : ""))
        .catch(() => ""),
    );
  }
  return iconTexts.get(name);
}

async function markerImage(id) {
  const [, name, state] = id.split(":");
  const size = 64;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  const colour = MARKER_COLOURS[state] || GREEN;
  if (state === "selected") {
    // the halo fills the image; the marker itself is drawn smaller inside it
    ctx.fillStyle = SELECTED_HALO;
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.translate(size / 2, size / 2);
    ctx.scale(0.8, 0.8);
    ctx.translate(-size / 2, -size / 2);
  }
  ctx.fillStyle = "#ffffff";
  ctx.strokeStyle = colour;
  ctx.lineWidth = state === "selected" ? 7 : 5;
  ctx.beginPath();
  if (name === "sensor") ctx.roundRect(4, 4, size - 8, size - 8, 10);
  else ctx.arc(size / 2, size / 2, size / 2 - 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  const text = await iconText(name);
  if (text) {
    try {
      const picture = new Image(size, size);
      picture.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(text.replace(/currentColor/g, colour))}`;
      await picture.decode();
      ctx.drawImage(picture, 14, 14, size - 28, size - 28);
    } catch {
      /* the ring alone still marks the place */
    }
  }
  return ctx.getImageData(0, 0, size, size);
}

function pointFeature(lng, lat, properties) {
  return { type: "Feature", geometry: { type: "Point", coordinates: [lng, lat] }, properties };
}

/** What both maps share: the map itself, its controls, the base map and redrawing the layers
 * after a style change. A subclass gives `sources()` and `layers()`. */
class BaseMap {
  /** @param {HTMLElement} container */
  constructor(container) {
    this.container = container;
    this.basemap = loadBasemap();
    this.map = null;
    this.ready = false; // true once the style is in, so layers can be added
    if (!window.maplibregl) {
      container.innerHTML = '<p class="map-missing">The map library could not be loaded. The tables still work.</p>';
      return;
    }
    const gl = window.maplibregl;
    this.map = new gl.Map({ container, style: styleUrl(this.basemap), ...NETHERLANDS, attributionControl: { compact: true } });
    this.map.addControl(new gl.NavigationControl({ visualizePitch: false }), "top-right");
    this.map.addControl(new gl.GeolocateControl({ positionOptions: { enableHighAccuracy: true } }), "top-right");
    this.map.addControl(new gl.ScaleControl(), "bottom-left");
    this.map.on("style.load", () => {
      this.ready = true;
      this.draw();
    });
    new ResizeObserver(() => this.map.resize()).observe(container);
    document.addEventListener("themechange", () => {
      if (this.basemap === "auto") this.restyle();
    });
  }

  setBasemap(key) {
    this.basemap = key in BASEMAPS ? key : "auto";
    saveBasemap(this.basemap);
    if (this.map) this.restyle();
  }

  restyle() {
    this.ready = false;
    this.map.setStyle(styleUrl(this.basemap));
  }

  /** Puts the sources and layers on the map, or refreshes the data of the ones that exist. */
  draw() {
    const map = this.map;
    if (!map || !this.ready) return;
    for (const [id, data] of Object.entries(this.sources())) {
      const source = map.getSource(id);
      if (source) source.setData(data);
      else map.addSource(id, { type: "geojson", data, ...this.sourceOptions(id) });
    }
    for (const layer of this.layers(nightMap(this.basemap))) if (!map.getLayer(layer.id)) map.addLayer(layer);
  }

  /** Extra options of a source, for a subclass that wants one clustered. */
  sourceOptions() {
    return {};
  }

  fit(points, { maxZoom = 15, animate = false } = {}) {
    if (!this.map || !points.length) return;
    const bounds = new window.maplibregl.LngLatBounds();
    for (const p of points) bounds.extend([p.lng, p.lat]);
    this.map.fitBounds(bounds, { padding: 64, maxZoom, duration: animate ? 600 : 0 });
  }

  center() {
    return this.map ? this.map.getCenter() : null;
  }

  popup(lngLat, html) {
    new window.maplibregl.Popup({ closeButton: false, maxWidth: "280px" }).setLngLat(lngLat).setHTML(html).addTo(this.map);
  }

  pointer(layer) {
    this.map.on("mouseenter", layer, () => (this.map.getCanvas().style.cursor = "pointer"));
    this.map.on("mouseleave", layer, () => (this.map.getCanvas().style.cursor = ""));
  }
}

/** Points with a popup and an optional track through them; the newest point is larger. */
export class MapView extends BaseMap {
  constructor(container) {
    super(container);
    this.points = [];
    this.ordered = [];
    this.describe = () => ["", []];
    this.showTrack = false;
    this.circle = null;
    this.onGround = null;
    if (!this.map) return;
    this.map.on("click", (event) => {
      const feature = this.map.getLayer("points") && this.map.queryRenderedFeatures(event.point, { layers: ["points"] })[0];
      const point = feature && this.ordered[feature.properties.index];
      if (point) this.popup(feature.geometry.coordinates, popupHtml(...this.describe(point)));
      else if (this.onGround) this.onGround(event.lngLat);
    });
    this.pointer("points");
  }

  /** @param {{lat:number,lng:number,t?:number}[]} points
   * @param describe gives `[title, lines]` for the popup of one point; it runs on a click,
   * so a track of thousands of points costs nothing up front */
  setPoints(points, { fit = true, describe } = {}) {
    this.points = points;
    if (describe) this.describe = describe;
    this.draw();
    if (fit) this.fit(points);
  }

  setTrack(show) {
    this.showTrack = show;
    this.draw();
  }

  /** Draws a search circle of `radius` metres and reports clicks beside the points. */
  setCircle(center, radius, onGround) {
    this.circle = { center, radius };
    this.onGround = onGround;
    this.draw();
  }

  fitCircle() {
    if (!this.circle) return;
    this.fit(circleFeature(this.circle.center, this.circle.radius).geometry.coordinates[0].map(([lng, lat]) => ({ lng, lat })));
  }

  sources() {
    const ordered = [...this.points].sort((a, b) => (a.t || 0) - (b.t || 0));
    this.ordered = ordered;
    const last = ordered.length - 1;
    return {
      circle: collection(this.circle ? [circleFeature(this.circle.center, this.circle.radius)] : []),
      points: collection(ordered.map((p, index) => pointFeature(p.lng, p.lat, { latest: index === last ? 1 : 0, index }))),
      track: { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: this.showTrack && ordered.length > 1 ? ordered.map((p) => [p.lng, p.lat]) : [] } },
    };
  }

  layers(night) {
    const colour = night ? "#90ae9b" : GREEN;
    return [
      { id: "circle-fill", type: "fill", source: "circle", paint: { "fill-color": colour, "fill-opacity": 0.08 } },
      { id: "circle-line", type: "line", source: "circle", paint: { "line-color": colour, "line-width": 1.5, "line-dasharray": [3, 2] } },
      { id: "track", type: "line", source: "track", layout: { "line-join": "round", "line-cap": "round" }, paint: { "line-color": colour, "line-width": 2, "line-opacity": 0.85 } },
      {
        id: "points",
        type: "circle",
        source: "points",
        // the white ring keeps a point readable on every base map
        paint: {
          "circle-radius": ["case", ["==", ["get", "latest"], 1], 8, 4.5],
          "circle-color": colour,
          "circle-stroke-color": "#ffffff",
          "circle-stroke-width": ["case", ["==", ["get", "latest"], 1], 2.5, 1.5],
        },
      },
    ];
  }
}

/** The live map: a labelled marker per sensor, a coloured track per chosen sensor and the
 * detections. The page hears about clicks through `onSensor`, `onTrackPoint` and `onNothing`. */
export class LiveMap extends BaseMap {
  /** `describePoint(track, point)` gives `[title, lines]` for the popup of a track point. */
  constructor(container, { onSensor, onNothing, describePoint }) {
    super(container);
    this.sensors = [];
    this.tracks = [];
    this.detections = [];
    this.selected = "";
    this.making = new Set();
    if (!this.map) return;
    this.map.on("click", async (event) => {
      const hits = this.map.queryRenderedFeatures(event.point, { layers: CLICKABLE.filter((id) => this.map.getLayer(id)) });
      const hit = hits[0];
      if (!hit) return onNothing();
      if (hit.layer.id === "sensors") return onSensor(hit.properties.id);
      if (hit.layer.id === "sensor-clusters") {
        // a group opens: zoom in until its sensors stand apart
        const zoom = await this.map.getSource("sensors").getClusterExpansionZoom(hit.properties.cluster_id);
        return this.map.easeTo({ center: hit.geometry.coordinates, zoom: zoom + 0.5, duration: 500 });
      }
      if (hit.layer.id === "detections") return this.popup(hit.geometry.coordinates, hit.properties.html);
      const track = this.tracks[hit.properties.track];
      if (track) this.popup(hit.geometry.coordinates, popupHtml(...describePoint(track, track.points[hit.properties.point])));
    });
    for (const layer of CLICKABLE) this.pointer(layer);
  }

  /** Sensors that would overlap become one disc with a number, as in Protect. */
  sourceOptions(id) {
    return id === "sensors" ? { cluster: true, clusterRadius: CLUSTER_RADIUS_PX, clusterMaxZoom: 14 } : {};
  }

  /** Draws, after making the marker images the sensors need; a style change drops them. */
  draw() {
    if (!this.map || !this.ready) return;
    const needed = [...new Set(this.sensors.map((s) => markerId(s.icon, s.id === this.selected ? "selected" : "normal")))];
    const missing = needed.filter((id) => !this.map.hasImage(id) && !this.making.has(id));
    for (const id of missing) {
      this.making.add(id);
      markerImage(id).then((image) => {
        this.making.delete(id);
        if (this.map.hasImage(id)) return;
        this.map.addImage(id, image, { pixelRatio: 2 });
        if (this.making.size === 0) super.draw();
      });
    }
    super.draw();
  }

  /** @param {{id:string,name:string,icon:string,lat:number,lng:number}[]} sensors */
  setSensors(sensors) {
    this.sensors = sensors;
    this.draw();
  }

  setSelected(id) {
    this.selected = id || "";
    this.draw();
  }

  /** @param {{id:string,name:string,slot:number,points:{lat:number,lng:number,t:number}[]}[]} tracks */
  setTracks(tracks) {
    this.tracks = tracks;
    this.draw();
  }

  /** @param {{lat:number,lng:number,title:string,lines:string[]}[]} detections */
  setDetections(detections) {
    this.detections = detections;
    this.draw();
  }

  flyTo(place) {
    if (this.map) this.map.flyTo({ center: [place.lng, place.lat], zoom: Math.max(this.map.getZoom(), 13), duration: 600 });
  }

  /** Half the diagonal of the view in metres, for a query "around what I see". */
  viewRadius() {
    const bounds = this.map.getBounds();
    return Math.round(bounds.getNorthEast().distanceTo(bounds.getSouthWest()) / 2);
  }

  sources() {
    const colours = nightMap(this.basemap) ? TRACK_COLORS_NIGHT : TRACK_COLORS;
    return {
      "track-lines": collection(
        this.tracks.filter((t) => t.points.length > 1).map((t) => ({ type: "Feature", properties: { color: colours[t.slot] }, geometry: { type: "LineString", coordinates: t.points.map((p) => [p.lng, p.lat]) } })),
      ),
      // the line has every fix; the dots are thinned on a long track, which keeps the map quick
      "track-points": collection(
        this.tracks.flatMap((t, track) => {
          const step = Math.ceil(t.points.length / MAX_TRACK_DOTS);
          const dots = [];
          for (let point = t.points.length - 1; point >= 0; point -= step) dots.push(pointFeature(t.points[point].lng, t.points[point].lat, { color: colours[t.slot], track, point }));
          return dots;
        }),
      ),
      detections: collection(this.detections.map((d) => pointFeature(d.lng, d.lat, { html: popupHtml(d.title, d.lines) }))),
      // a sensor joins the map once its marker image is made, a moment after the first draw
      sensors: collection(
        this.sensors
          .map((s) => ({ s, marker: markerId(s.icon, s.id === this.selected ? "selected" : "normal") }))
          .filter(({ marker }) => this.map.hasImage(marker))
          .map(({ s, marker }) => pointFeature(s.lng, s.lat, { id: s.id, name: s.name, selected: s.id === this.selected ? 1 : 0, marker })),
      ),
    };
  }

  layers(night) {
    const selected = ["==", ["get", "selected"], 1];
    return [
      { id: "track-lines", type: "line", source: "track-lines", layout: { "line-join": "round", "line-cap": "round" }, paint: { "line-color": ["get", "color"], "line-width": 2.5, "line-opacity": 0.9 } },
      { id: "track-points", type: "circle", source: "track-points", paint: { "circle-radius": 3.5, "circle-color": "#ffffff", "circle-stroke-color": ["get", "color"], "circle-stroke-width": 2 } },
      { id: "detections", type: "circle", source: "detections", paint: { "circle-radius": 6, "circle-color": CORAL, "circle-stroke-color": "#ffffff", "circle-stroke-width": 2 } },
      {
        id: "sensor-clusters",
        type: "circle",
        source: "sensors",
        filter: ["has", "point_count"],
        paint: { "circle-color": GREEN, "circle-radius": ["step", ["get", "point_count"], 16, 10, 20, 50, 26], "circle-stroke-width": 3, "circle-stroke-color": "#ffffff" },
      },
      {
        id: "sensor-cluster-count",
        type: "symbol",
        source: "sensors",
        filter: ["has", "point_count"],
        layout: { "text-field": ["get", "point_count_abbreviated"], "text-size": 12, "text-font": FONT },
        paint: { "text-color": "#ffffff" },
      },
      {
        id: "sensors",
        type: "symbol",
        source: "sensors",
        filter: ["!", ["has", "point_count"]],
        layout: {
          "icon-image": ["get", "marker"],
          "icon-size": ["case", selected, 1.25, 0.9],
          "icon-allow-overlap": true,
          "text-field": ["get", "name"],
          "text-font": FONT,
          "text-size": 11,
          "text-offset": [0, 1.8],
          "text-anchor": "top",
          "text-optional": true,
          "text-max-width": 12,
        },
        paint: { "text-color": night ? "#e6ece8" : "#1f2a24", "text-halo-color": night ? "#121917" : "#ffffff", "text-halo-width": 1.2 },
      },
    ];
  }
}
