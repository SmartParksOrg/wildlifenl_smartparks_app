// Maps on MapLibre GL JS. MapView is the small map of a page (points and a track); LiveMap
// is the live map with a marker per sensor, coloured tracks, the detectors and the measuring
// line.

const FONT = ["Noto Sans Regular"]; // the glyphs OpenFreeMap serves
const GLYPHS = "https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf";

/** A base map of picture tiles from one address, as a MapLibre style. */
function rasterStyle(tiles, attribution, maxzoom) {
  return {
    version: 8,
    glyphs: GLYPHS,
    sources: { base: { type: "raster", tiles: [tiles], tileSize: 256, maxzoom, attribution } },
    layers: [{ id: "base", type: "raster", source: "base" }],
  };
}

/** The base maps. The first five are OpenFreeMap's vector styles, the ones Protect uses; the
 * photo and topographic ones are free picture tiles that need no key. The default follows
 * the theme: Light by day, Night at night. `dark` marks a ground that needs light labels. */
export const BASEMAPS = {
  auto: { label: "Follows the theme", style: "positron" },
  liberty: { label: "Streets", style: "liberty" },
  positron: { label: "Light", style: "positron" },
  bright: { label: "Bright", style: "bright" },
  dark: { label: "Night", style: "fiord", dark: true },
  satellite: {
    label: "Satellite",
    dark: true,
    style: rasterStyle("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", "Imagery © Esri, Maxar, Earthstar Geographics", 19),
  },
  aerial: {
    label: "Aerial photo (Netherlands)",
    dark: true,
    style: rasterStyle("https://service.pdok.nl/hwh/luchtfotorgb/wmts/v1_0/Actueel_orthoHR/EPSG:3857/{z}/{x}/{y}.jpeg", "Aerial photo © Beeldmateriaal Nederland, CC BY 4.0", 19),
  },
  topo: {
    label: "Topographic",
    style: rasterStyle("https://a.tile.opentopomap.org/{z}/{x}/{y}.png", "Map © OpenTopoMap (CC BY-SA), data © OpenStreetMap contributors", 17),
  },
};
/** Elevation for the 3D terrain: the open Terrain Tiles on AWS, no key needed. */
const TERRAIN_TILES = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png";
const TERRAIN_EXAGGERATION = 1.3;
const TERRAIN_PITCH = 55;
const TERRAIN_KEY = "wnl-terrain";
const BASEMAP_KEY = "wnl-basemap";
const NETHERLANDS = { center: [5.3, 52.1], zoom: 6.5 };
const GREEN = "#52735E";
const MAX_TRACK_DOTS = 2000;
/** Protect's value: markers group when they would overlap, not before. */
const CLUSTER_RADIUS_PX = 28;
/** The layers a click can hit, the one on top first. */
const CLICKABLE = ["sensors", "sensor-clusters", "detectors", "reports", "track-points", "areas"];

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

/** Whether the ground of a base map is dark, so labels and tracks must be light. */
function nightMap(key) {
  return key === "auto" ? darkTheme() : Boolean(BASEMAPS[key] && BASEMAPS[key].dark);
}

/** The MapLibre style of a base map: an OpenFreeMap address or a picture tile style. */
function styleOf(key) {
  const style = key === "auto" && darkTheme() ? "fiord" : (BASEMAPS[key] || BASEMAPS.auto).style;
  return typeof style === "string" ? `https://tiles.openfreemap.org/styles/${style}` : style;
}

export function loadTerrain() {
  try {
    return localStorage.getItem(TERRAIN_KEY) === "on";
  } catch {
    return false;
  }
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

// Marker images, drawn the way Smart Parks Protect draws them: a white disc with a ring in
// the state colour and the icon of the species inside. A sensor without an animal is a
// rounded square, Protect's shape for devices, and a detector is a diamond, its shape for
// events.
const DETECTOR_ICON = "camera_trap";
/** A report is drawn as a diamond with the icon of its species, in the sand of a warning. */
const REPORT_PREFIX = "report-";
const MARKER_COLOURS = { normal: GREEN, selected: "#2563EB" };
const REPORT_COLOUR = "#B8923F";
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
  const [, full, state] = id.split(":");
  const report = full.startsWith(REPORT_PREFIX);
  const name = report ? full.slice(REPORT_PREFIX.length) : full;
  const diamond = report || name === DETECTOR_ICON;
  const size = 64;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  const colour = state === "selected" ? MARKER_COLOURS.selected : report ? REPORT_COLOUR : GREEN;
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
  else if (diamond) {
    ctx.moveTo(size / 2, 3);
    ctx.lineTo(size - 3, size / 2);
    ctx.lineTo(size / 2, size - 3);
    ctx.lineTo(3, size / 2);
    ctx.closePath();
  } else ctx.arc(size / 2, size / 2, size / 2 - 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  const text = await iconText(name);
  if (text) {
    try {
      const picture = new Image(size, size);
      picture.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(text.replace(/currentColor/g, colour))}`;
      await picture.decode();
      const inset = diamond ? 18 : 14;
      ctx.drawImage(picture, inset, inset, size - inset * 2, size - inset * 2);
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
  /** @param {HTMLElement} container
   * @param controls the corner of the zoom, north and locate buttons */
  constructor(container, controls = "top-right") {
    this.container = container;
    this.basemap = loadBasemap();
    this.terrain = false;
    this.map = null;
    this.ready = false; // true once the style is in, so layers can be added
    if (!window.maplibregl) {
      container.innerHTML = '<p class="map-missing">The map library could not be loaded. The tables still work.</p>';
      return;
    }
    const gl = window.maplibregl;
    this.map = new gl.Map({ container, style: styleOf(this.basemap), ...NETHERLANDS, attributionControl: { compact: true }, maxPitch: 75 });
    this.map.addControl(new gl.NavigationControl({ visualizePitch: true }), controls);
    this.map.addControl(new gl.GeolocateControl({ positionOptions: { enableHighAccuracy: true } }), controls);
    this.map.addControl(new gl.ScaleControl(), "bottom-left");
    this.map.on("style.load", () => {
      this.ready = true;
      this.applyTerrain();
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
    this.map.setStyle(styleOf(this.basemap));
  }

  /** 3D terrain on any base map, as in Protect: the relief under the data and the ground
   * raised, with the camera tilted so it shows. */
  setTerrain(on) {
    this.terrain = on;
    try {
      localStorage.setItem(TERRAIN_KEY, on ? "on" : "off");
    } catch {
      /* the choice lasts for this page only */
    }
    if (!this.map || !this.ready) return;
    this.applyTerrain();
    this.map.easeTo({ pitch: on ? TERRAIN_PITCH : 0, duration: 600 });
  }

  /** A style change drops sources and layers, so this runs again after each one. */
  applyTerrain() {
    const map = this.map;
    // two sources of the same tiles: MapLibre draws the relief better when it does not share
    // its source with the raised ground
    const dem = { type: "raster-dem", tiles: [TERRAIN_TILES], encoding: "terrarium", tileSize: 256, maxzoom: 15, attribution: "Elevation: Terrain Tiles on AWS" };
    if (!this.terrain) {
      if (map.getTerrain()) map.setTerrain(null);
      if (map.getLayer("terrain-hillshade")) map.removeLayer("terrain-hillshade");
      for (const id of ["terrain-dem", "terrain-relief"]) if (map.getSource(id)) map.removeSource(id);
      return;
    }
    for (const id of ["terrain-dem", "terrain-relief"]) if (!map.getSource(id)) map.addSource(id, dem);
    if (!map.getLayer("terrain-hillshade")) {
      const first = this.layers(false).find((layer) => map.getLayer(layer.id));
      map.addLayer({ id: "terrain-hillshade", type: "hillshade", source: "terrain-relief", paint: { "hillshade-shadow-color": "#473B24", "hillshade-exaggeration": 0.4 } }, first && first.id);
    }
    if (!map.getTerrain()) map.setTerrain({ source: "terrain-dem", exaggeration: TERRAIN_EXAGGERATION });
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

  /** The box the map shows, `{south, west, north, east}`. */
  bounds() {
    if (!this.map) return null;
    const box = this.map.getBounds();
    return { south: box.getSouth(), west: box.getWest(), north: box.getNorth(), east: box.getEast() };
  }

  center() {
    return this.map ? this.map.getCenter() : null;
  }

  popup(lngLat, html) {
    new window.maplibregl.Popup({ closeButton: false, maxWidth: "280px" }).setLngLat(lngLat).setHTML(html).addTo(this.map);
  }

  pointer(layer) {
    this.map.on("mouseenter", layer, () => (this.map.getCanvas().style.cursor = "pointer"));
    this.map.on("mouseleave", layer, () => (this.map.getCanvas().style.cursor = this.measuring ? "crosshair" : ""));
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
    this.area = [];
    if (!this.map) return;
    this.map.on("click", "points", (event) => {
      const feature = event.features && event.features[0];
      const point = feature && this.ordered[feature.properties.index];
      if (point) this.popup(feature.geometry.coordinates, popupHtml(...this.describe(point)));
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

  /** Draws the outline of an area, `{lat, lng}` points, and shows it whole. */
  setArea(points) {
    this.area = points;
    this.draw();
    this.fit(points);
  }

  sources() {
    const ordered = [...this.points].sort((a, b) => (a.t || 0) - (b.t || 0));
    this.ordered = ordered;
    const last = ordered.length - 1;
    return {
      points: collection(ordered.map((p, index) => pointFeature(p.lng, p.lat, { latest: index === last ? 1 : 0, index }))),
      track: { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: this.showTrack && ordered.length > 1 ? ordered.map((p) => [p.lng, p.lat]) : [] } },
      area: collection(this.area.length > 2 ? [polygonFeature(this.area, {})] : []),
    };
  }

  layers(night) {
    const colour = night ? "#90ae9b" : GREEN;
    return [
      { id: "area-fill", type: "fill", source: "area", paint: { "fill-color": colour, "fill-opacity": 0.12 } },
      { id: "area-line", type: "line", source: "area", paint: { "line-color": colour, "line-width": 2 } },
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

/** The middle of an outline, good enough to hang a name on. */
function middleOf(points) {
  const sum = points.reduce((acc, p) => ({ lat: acc.lat + p.lat, lng: acc.lng + p.lng }), { lat: 0, lng: 0 });
  return { lat: sum.lat / points.length, lng: sum.lng / points.length };
}

function polygonFeature(points, properties) {
  const ring = points.map((p) => [p.lng, p.lat]);
  if (ring.length) ring.push(ring[0]);
  return { type: "Feature", properties, geometry: { type: "Polygon", coordinates: [ring] } };
}

/**
 * The live map. It draws what the page gives it and tells the page what was clicked:
 * - sensors: a marker with the icon of the species, grouped into a disc with a count where
 *   they would overlap
 * - detectors and reports: diamonds, Protect's shape for events
 * - areas: the outlines of living labs and zones
 * - tracks, the visits of an area as discs, and the measuring line
 * Every item carries `selected`; the page hears `onPick(kind, id)` and `onNothing()`.
 */
export class LiveMap extends BaseMap {
  /** `describePoint(track, point)` gives `[title, lines]` for the popup of a track point. */
  constructor(container, { onPick, onNothing, describePoint, onMeasure }) {
    super(container, "bottom-right");
    this.terrain = loadTerrain();
    if (this.map && this.terrain) this.map.setPitch(TERRAIN_PITCH);
    this.measuring = false;
    this.measure = [];
    this.items = { sensors: [], detectors: [], reports: [], areas: [], visits: [] };
    this.tracks = [];
    this.making = new Set();
    if (!this.map) return;
    this.map.on("click", async (event) => {
      if (this.measuring) return onMeasure({ lat: event.lngLat.lat, lng: event.lngLat.lng });
      const hits = this.map.queryRenderedFeatures(event.point, { layers: CLICKABLE.filter((id) => this.map.getLayer(id)) });
      const hit = hits[0];
      if (!hit) return onNothing();
      if (hit.layer.id === "sensor-clusters") {
        // a group opens: zoom in until its sensors stand apart
        const zoom = await this.map.getSource("sensors").getClusterExpansionZoom(hit.properties.cluster_id);
        return this.map.easeTo({ center: hit.geometry.coordinates, zoom: zoom + 0.5, duration: 500 });
      }
      if (hit.layer.id === "track-points") {
        const track = this.tracks[hit.properties.track];
        if (track) this.popup(hit.geometry.coordinates, popupHtml(...describePoint(track, track.points[hit.properties.point])));
        return;
      }
      onPick(hit.properties.kind, hit.properties.id);
    });
    for (const layer of CLICKABLE) this.pointer(layer);
  }

  /** Sensors that would overlap become one disc with a number, as in Protect. */
  sourceOptions(id) {
    return id === "sensors" ? { cluster: true, clusterRadius: CLUSTER_RADIUS_PX, clusterMaxZoom: 14 } : {};
  }

  markerOf(kind, item) {
    const name = kind === "detectors" ? DETECTOR_ICON : kind === "reports" ? `${REPORT_PREFIX}${item.icon}` : item.icon;
    return markerId(name, item.selected ? "selected" : "normal");
  }

  /** Draws, after making the marker images that are needed; a style change drops them. */
  draw() {
    if (!this.map || !this.ready) return;
    const needed = new Set();
    for (const kind of ["sensors", "detectors", "reports"]) for (const item of this.items[kind]) needed.add(this.markerOf(kind, item));
    for (const id of needed) {
      if (this.map.hasImage(id) || this.making.has(id)) continue;
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

  /**
   * What one layer shows. `kind` is `sensors`, `detectors` or `reports` (items
   * `{id, name, icon, lat, lng, selected}`), `areas` (`{id, name, points, selected}`) or
   * `visits` (`{lat, lng, count}`).
   */
  setItems(kind, items) {
    this.items[kind] = items;
    this.draw();
  }

  /** @param {{id:string,name:string,slot:number,points:{lat:number,lng:number,t:number}[]}[]} tracks */
  setTracks(tracks) {
    this.tracks = tracks;
    this.draw();
  }

  /** While measuring, a click adds a point to the line instead of selecting something. */
  setMeasuring(on) {
    this.measuring = on;
    if (this.map) this.map.getCanvas().style.cursor = on ? "crosshair" : "";
  }

  /** @param {{lat:number,lng:number}[]} points the measuring line */
  setMeasure(points) {
    this.measure = points;
    this.draw();
  }

  flyTo(place) {
    if (this.map) this.map.flyTo({ center: [place.lng, place.lat], zoom: Math.max(this.map.getZoom(), 13), duration: 600 });
  }

  sources() {
    const colours = nightMap(this.basemap) ? TRACK_COLORS_NIGHT : TRACK_COLORS;
    // an item joins the map once its marker image is made, a moment after the first draw
    const markers = (kind) =>
      collection(
        this.items[kind]
          .map((item) => ({ item, marker: this.markerOf(kind, item) }))
          .filter(({ marker }) => this.map.hasImage(marker))
          .map(({ item, marker }) => pointFeature(item.lng, item.lat, { kind, id: item.id, name: item.name, selected: item.selected ? 1 : 0, marker })),
      );
    const most = Math.max(1, ...this.items.visits.map((v) => v.count));
    return {
      areas: collection(this.items.areas.filter((a) => a.points.length > 2).map((a) => polygonFeature(a.points, { kind: "areas", id: a.id, selected: a.selected ? 1 : 0 }))),
      "area-names": collection(this.items.areas.filter((a) => a.points.length > 2).map((a) => ({ ...middleOf(a.points), name: a.name })).map((a) => pointFeature(a.lng, a.lat, { name: a.name }))),
      visits: collection(this.items.visits.map((v) => pointFeature(v.lng, v.lat, { share: Math.sqrt(v.count / most) }))),
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
      "measure-line": collection(this.measure.length > 1 ? [{ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: this.measure.map((p) => [p.lng, p.lat]) } }] : []),
      "measure-points": collection(this.measure.map((p) => pointFeature(p.lng, p.lat, {}))),
      reports: markers("reports"),
      detectors: markers("detectors"),
      sensors: markers("sensors"),
    };
  }

  layers(night) {
    const selected = ["==", ["get", "selected"], 1];
    const text = { "text-color": night ? "#e6ece8" : "#1f2a24", "text-halo-color": night ? "#121917" : "#ffffff", "text-halo-width": 1.2 };
    const marker = (id) => ({
      id,
      type: "symbol",
      source: id,
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
      paint: text,
    });
    const green = night ? "#90ae9b" : GREEN;
    return [
      { id: "areas", type: "fill", source: "areas", paint: { "fill-color": green, "fill-opacity": ["case", selected, 0.28, 0.12] } },
      { id: "area-lines", type: "line", source: "areas", paint: { "line-color": green, "line-width": ["case", selected, 3, 1.5] } },
      { id: "area-names", type: "symbol", source: "area-names", layout: { "text-field": ["get", "name"], "text-font": FONT, "text-size": 12, "text-max-width": 10 }, paint: { ...text, "text-color": night ? "#cfe0d6" : "#2F4A3A" } },
      { id: "visits", type: "circle", source: "visits", paint: { "circle-radius": ["interpolate", ["linear"], ["get", "share"], 0, 4, 1, 26], "circle-color": "#5C7FA3", "circle-opacity": 0.45, "circle-stroke-color": "#ffffff", "circle-stroke-width": 1 } },
      { id: "track-lines", type: "line", source: "track-lines", layout: { "line-join": "round", "line-cap": "round" }, paint: { "line-color": ["get", "color"], "line-width": 2.5, "line-opacity": 0.9 } },
      { id: "track-points", type: "circle", source: "track-points", paint: { "circle-radius": 3.5, "circle-color": "#ffffff", "circle-stroke-color": ["get", "color"], "circle-stroke-width": 2 } },
      { id: "measure-line", type: "line", source: "measure-line", paint: { "line-color": night ? "#ffffff" : "#1f2a24", "line-width": 2, "line-dasharray": [2, 2] } },
      { id: "measure-points", type: "circle", source: "measure-points", paint: { "circle-radius": 4, "circle-color": "#ffffff", "circle-stroke-color": night ? "#ffffff" : "#1f2a24", "circle-stroke-width": 2 } },
      marker("reports"),
      marker("detectors"),
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
      { ...marker("sensors"), filter: ["!", ["has", "point_count"]] },
    ];
  }
}
