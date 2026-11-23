// Line charts on Apache ECharts, with the look of the Smart Parks Protect explore chart. The
// library is only fetched when a page first draws a chart.

const ECHARTS_URL = "https://unpkg.com/echarts@6.1.0/dist/echarts.min.js";
const ECHARTS_HASH = "sha384-C2iskrW/uPW46KzOjrvJIQo4YkV8lkD+QS0CrDN18IIPIpT/g2USu8bTP3nvmIAD";
const GROUP = "wnl-charts"; // charts on one page share the crosshair and the zoom

/** Protect's series palette: brand colours first, one colour per series, never reused. */
export const PALETTE = ["#52735E", "#D9825F", "#5C7FA3", "#B39A4A", "#8A6BA3", "#B86B5C", "#3E8E7E", "#8A7A4F"];

let loading = null;

function loadEcharts() {
  if (window.echarts) return Promise.resolve(window.echarts);
  if (!loading) {
    loading = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = ECHARTS_URL;
      script.integrity = ECHARTS_HASH;
      script.crossOrigin = "anonymous";
      script.onload = () => resolve(window.echarts);
      script.onerror = () => {
        loading = null;
        reject(new Error("The chart library could not be loaded."));
      };
      document.head.append(script);
    });
  }
  return loading;
}

function theme() {
  return document.documentElement.classList.contains("dark")
    ? { text: "#9fb0a6", grid: "#2d3d35", tooltipBg: "rgba(26,35,32,0.96)", tooltipText: "#e6ece8", zoom: "rgba(144,174,155,0.25)" }
    : { text: "#6B7280", grid: "#E5E7EB", tooltipBg: "rgba(255,255,255,0.96)", tooltipText: "#111827", zoom: "rgba(82,115,94,0.18)" };
}

function formatValue(value, unit) {
  const number = Math.abs(value) >= 100 ? value.toFixed(0) : Math.abs(value) >= 10 ? value.toFixed(1) : value.toFixed(2);
  return unit ? `${number} ${unit}` : number;
}

/** One chart of one measure: a line per series on a shared time axis. */
export class LineChart {
  /** @param {HTMLElement} container */
  constructor(container) {
    this.container = container;
    this.chart = null;
    this.content = null;
    this.onTheme = () => this.draw();
    document.addEventListener("themechange", this.onTheme);
    this.resize = new ResizeObserver(() => this.chart && this.chart.resize());
    this.resize.observe(container);
  }

  /** @param {{unit:string, series:{name:string, color:string, data:number[][]}[]}} content */
  async set(content) {
    this.content = content;
    try {
      await loadEcharts();
    } catch (error) {
      this.container.textContent = error.message;
      return;
    }
    this.draw();
  }

  draw() {
    if (!this.content || !window.echarts) return;
    if (!this.chart) {
      this.chart = window.echarts.init(this.container);
      this.chart.group = GROUP;
      window.echarts.connect(GROUP);
    }
    const { unit, series } = this.content;
    const colours = theme();
    // drawn again with new data or another theme, a chart stays zoomed where the person put it
    const zoom = ((this.chart.getOption() || {}).dataZoom || [])[0];
    const range = zoom && Number.isFinite(zoom.start) ? { start: zoom.start, end: zoom.end } : {};
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    this.chart.setOption(
      {
        animation: !reduced,
        animationDuration: 300,
        color: series.map((s) => s.color),
        grid: { left: 8, right: 16, top: series.length > 1 ? 36 : 12, bottom: 44, containLabel: true },
        // a legend only when there is more than one line; the card's title names a single one
        legend: series.length > 1 ? { top: 0, left: 0, type: "scroll", icon: "roundRect", itemWidth: 12, itemHeight: 3, textStyle: { color: colours.text } } : undefined,
        tooltip: {
          trigger: "axis",
          axisPointer: { type: "line", lineStyle: { color: colours.text, width: 1 } },
          backgroundColor: colours.tooltipBg,
          borderColor: colours.grid,
          textStyle: { color: colours.tooltipText, fontSize: 12 },
          valueFormatter: (value) => (typeof value === "number" ? formatValue(value, unit) : "none"),
        },
        xAxis: { type: "time", axisLine: { lineStyle: { color: colours.grid } }, axisLabel: { color: colours.text, hideOverlap: true }, splitLine: { show: false } },
        yAxis: {
          type: "value",
          scale: true,
          axisLabel: { color: colours.text, formatter: (value) => (unit ? `${value} ${unit}` : value) },
          splitLine: { lineStyle: { color: colours.grid } },
        },
        dataZoom: [
          { type: "inside", filterMode: "none", ...range },
          { type: "slider", ...range, height: 18, bottom: 8, borderColor: colours.grid, textStyle: { color: colours.text }, brushSelect: false, showDataShadow: false, filterMode: "none", fillerColor: colours.zoom, handleStyle: { color: colours.tooltipBg, borderColor: colours.text }, moveHandleStyle: { color: colours.text } },
        ],
        series: series.map((s) => ({
          name: s.name,
          type: "line",
          data: s.data,
          showSymbol: s.data.length < 60,
          symbolSize: 5,
          lineStyle: { width: 2 },
          emphasis: { focus: "series" },
          sampling: "lttb",
        })),
      },
      { notMerge: true },
    );
  }

  dispose() {
    document.removeEventListener("themechange", this.onTheme);
    this.resize.disconnect();
    if (this.chart) this.chart.dispose();
    this.chart = null;
  }
}
