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
const GREEN_DARK = "#2F4A3A";
const CORAL = "#D9825F";

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
      else map.addSource(id, { type: "geojson", data });
    }
    for (const layer of this.layers(nightMap(this.basemap))) if (!map.getLayer(layer.id)) map.addLayer(layer);
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
    this.showTrack = false;
    if (!this.map) return;
    this.map.on("click", "points", (event) => {
      const feature = event.features && event.features[0];
      if (feature) this.popup(feature.geometry.coordinates, feature.properties.html);
    });
    this.pointer("points");
  }

  /** @param {{lat:number,lng:number,t?:number,title?:string,lines?:string[]}[]} points */
  setPoints(points, { fit = true } = {}) {
    this.points = points;
    this.draw();
    if (fit) this.fit(points);
  }

  setTrack(show) {
    this.showTrack = show;
    this.draw();
  }

  sources() {
    const ordered = [...this.points].sort((a, b) => (a.t || 0) - (b.t || 0));
    const latest = ordered[ordered.length - 1];
    return {
      points: collection(ordered.map((p) => pointFeature(p.lng, p.lat, { latest: p === latest ? 1 : 0, html: popupHtml(p.title, p.lines) }))),
      track: { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: this.showTrack && ordered.length > 1 ? ordered.map((p) => [p.lng, p.lat]) : [] } },
    };
  }

  layers(night) {
    const colour = night ? "#90ae9b" : GREEN;
    return [
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
  constructor(container, { onSensor, onNothing }) {
    super(container);
    this.sensors = [];
    this.tracks = [];
    this.detections = [];
    this.selected = "";
    if (!this.map) return;
    this.map.on("click", (event) => {
      const hits = this.map.queryRenderedFeatures(event.point, { layers: ["sensors", "track-points", "detections"].filter((id) => this.map.getLayer(id)) });
      const hit = hits[0];
      if (!hit) return onNothing();
      if (hit.layer.id === "sensors") return onSensor(hit.properties.id);
      this.popup(hit.geometry.coordinates, hit.properties.html);
    });
    for (const layer of ["sensors", "track-points", "detections"]) this.pointer(layer);
  }

  /** @param {{id:string,name:string,lat:number,lng:number}[]} sensors */
  setSensors(sensors) {
    this.sensors = sensors;
    this.draw();
  }

  setSelected(id) {
    this.selected = id || "";
    this.draw();
  }

  /** @param {{id:string,name:string,slot:number,points:{lat:number,lng:number,t:number,lines:string[]}[]}[]} tracks */
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
      "track-points": collection(this.tracks.flatMap((t) => t.points.map((p) => pointFeature(p.lng, p.lat, { color: colours[t.slot], html: popupHtml(t.name, p.lines) })))),
      detections: collection(this.detections.map((d) => pointFeature(d.lng, d.lat, { html: popupHtml(d.title, d.lines) }))),
      sensors: collection(this.sensors.map((s) => pointFeature(s.lng, s.lat, { id: s.id, name: s.name, selected: s.id === this.selected ? 1 : 0 }))),
    };
  }

  layers(night) {
    const selected = ["==", ["get", "selected"], 1];
    return [
      { id: "track-lines", type: "line", source: "track-lines", layout: { "line-join": "round", "line-cap": "round" }, paint: { "line-color": ["get", "color"], "line-width": 2.5, "line-opacity": 0.9 } },
      { id: "track-points", type: "circle", source: "track-points", paint: { "circle-radius": 3.5, "circle-color": "#ffffff", "circle-stroke-color": ["get", "color"], "circle-stroke-width": 2 } },
      { id: "detections", type: "circle", source: "detections", paint: { "circle-radius": 6, "circle-color": CORAL, "circle-stroke-color": "#ffffff", "circle-stroke-width": 2 } },
      {
        id: "sensors",
        type: "circle",
        source: "sensors",
        paint: {
          "circle-radius": ["case", selected, 11, 8],
          "circle-color": ["case", selected, GREEN, "#ffffff"],
          "circle-stroke-color": ["case", selected, "#ffffff", GREEN],
          "circle-stroke-width": 3,
        },
      },
      {
        id: "sensor-labels",
        type: "symbol",
        source: "sensors",
        layout: { "text-field": ["get", "name"], "text-font": FONT, "text-size": 12, "text-offset": [0, 1.3], "text-anchor": "top", "text-optional": true, "text-max-width": 12 },
        paint: { "text-color": night ? "#e6ece8" : GREEN_DARK, "text-halo-color": night ? "#121917" : "#ffffff", "text-halo-width": 1.5 },
      },
    ];
  }
}
