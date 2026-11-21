// A small wrapper around MapLibre GL JS: coloured points, an optional track and a popup.
// The basemaps are the ones Smart Parks Protect uses (OpenFreeMap, no key needed).

const STYLES = {
  light: "https://tiles.openfreemap.org/styles/positron",
  dark: "https://tiles.openfreemap.org/styles/fiord",
};
const NETHERLANDS = { center: [5.3, 52.1], zoom: 6 };

function isDark() {
  return document.documentElement.classList.contains("dark");
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[c]);
}

export class MapView {
  /** @param {HTMLElement} container */
  constructor(container) {
    this.container = container;
    this.points = [];
    this.showTrack = false;
    this.map = null;
    if (!window.maplibregl) {
      container.innerHTML = '<p class="map-missing">The map library could not be loaded. The tables still work.</p>';
      return;
    }
    this.map = new window.maplibregl.Map({
      container,
      style: STYLES[isDark() ? "dark" : "light"],
      ...NETHERLANDS,
      attributionControl: { compact: true },
    });
    this.map.addControl(new window.maplibregl.NavigationControl({ showCompass: false }), "top-right");
    this.map.addControl(new window.maplibregl.ScaleControl(), "bottom-left");
    this.map.on("style.load", () => this.draw());
    this.map.on("click", "points", (event) => this.popup(event));
    this.map.on("mouseenter", "points", () => (this.map.getCanvas().style.cursor = "pointer"));
    this.map.on("mouseleave", "points", () => (this.map.getCanvas().style.cursor = ""));
    new ResizeObserver(() => this.map.resize()).observe(container);
    document.addEventListener("themechange", () => this.map.setStyle(STYLES[isDark() ? "dark" : "light"]));
  }

  /** @param {{lat:number,lng:number,t?:number,color?:string,title?:string,lines?:string[]}[]} points */
  setPoints(points, { fit = true } = {}) {
    this.points = points;
    if (!this.map) return;
    if (this.map.isStyleLoaded()) this.draw();
    if (fit && points.length) {
      const bounds = new window.maplibregl.LngLatBounds();
      for (const p of points) bounds.extend([p.lng, p.lat]);
      this.map.fitBounds(bounds, { padding: 48, maxZoom: 15, duration: 0 });
    }
  }

  setTrack(show) {
    this.showTrack = show;
    if (this.map && this.map.isStyleLoaded()) this.draw();
  }

  center() {
    return this.map ? this.map.getCenter() : null;
  }

  draw() {
    const map = this.map;
    const ordered = [...this.points].sort((a, b) => (a.t || 0) - (b.t || 0));
    const latest = ordered.length ? ordered[ordered.length - 1] : null;
    const features = ordered.map((p) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: [p.lng, p.lat] },
      properties: {
        color: p.color || "#52735e",
        latest: p === latest ? 1 : 0,
        html: `<strong>${escapeHtml(p.title || "")}</strong>${(p.lines || []).map((l) => `<br>${escapeHtml(l)}`).join("")}`,
      },
    }));
    const track = {
      type: "Feature",
      geometry: { type: "LineString", coordinates: this.showTrack && ordered.length > 1 ? ordered.map((p) => [p.lng, p.lat]) : [] },
      properties: {},
    };
    const data = { points: { type: "FeatureCollection", features }, track };
    for (const [id, value] of Object.entries(data)) {
      const source = map.getSource(id);
      if (source) source.setData(value);
      else map.addSource(id, { type: "geojson", data: value });
    }
    if (!map.getLayer("track")) {
      map.addLayer({
        id: "track",
        type: "line",
        source: "track",
        layout: { "line-join": "round", "line-cap": "round" },
        paint: { "line-color": isDark() ? "#90ae9b" : "#52735e", "line-width": 2, "line-opacity": 0.8 },
      });
    }
    if (!map.getLayer("points")) {
      map.addLayer({
        id: "points",
        type: "circle",
        source: "points",
        // the newest point is larger; the white halo keeps a point readable on both basemaps
        paint: {
          "circle-radius": ["case", ["==", ["get", "latest"], 1], 8, 4.5],
          "circle-color": ["get", "color"],
          "circle-stroke-color": "#ffffff",
          "circle-stroke-width": ["case", ["==", ["get", "latest"], 1], 2.5, 1.5],
        },
      });
    }
  }

  popup(event) {
    const feature = event.features && event.features[0];
    if (!feature) return;
    new window.maplibregl.Popup({ closeButton: false, maxWidth: "280px" })
      .setLngLat(feature.geometry.coordinates)
      .setHTML(feature.properties.html)
      .addTo(this.map);
  }
}
