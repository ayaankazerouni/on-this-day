import * as d3 from "d3";

import { yearToString } from "./lib.js";
import { getColor } from "./map.js";

const HEIGHT = 56;
/** Inset of the ruler from each side of its container, in pixels. */
const MARGIN_X = 40;
const BASELINE_Y = 34;
const TICK_HALF = 6;

const BASEMAPS_SOURCE_URL = "https://github.com/aourednik/historical-basemaps";

/** Narrowest the blurred band is drawn, in pixels, so it stays visible on wide domains. */
const MIN_BAND_PX = 10;

/** Each ruler gets its own blur filter id, so re-renders (e.g. a theme change) don't clash. */
let filterCount = 0;

const tooltip = d3
  .select("body")
  .append("div")
  .attr("class", "timeline-tooltip")
  .style("position", "absolute")
  .style("visibility", "hidden")
  .style("pointer-events", "none")
  .style("z-index", "1000");

/**
 * The basemap the map draws for a given year: the closest basemap year,
 * ties going to the earlier one. Same rule as lib.js's getClosestTimePeriod.
 *
 * @param {number} year
 * @param {number[]} years Basemap years, sorted ascending.
 */
function closest(year, years) {
  return years.reduce((a, b) => (Math.abs(b - year) < Math.abs(a - year) ? b : a));
}

/**
 * The range of years for which `basemapYear` is the closest basemap, i.e.
 * every event year in this range is drawn on this basemap. Runs from halfway
 * to the previous basemap year to halfway to the next one; open-ended at the
 * first and last basemap.
 *
 * @param {number} basemapYear
 * @param {number[]} years Basemap years, sorted ascending.
 * @returns {[number, number]}
 */
function basemapRange(basemapYear, years) {
  const i = years.indexOf(basemapYear);
  const lo = i > 0 ? (years[i - 1] + basemapYear) / 2 : -Infinity;
  const hi = i < years.length - 1 ? (basemapYear + years[i + 1]) / 2 : Infinity;
  return [lo, hi];
}

/**
 * A horizontal ruler showing how far back in history today's events go.
 *
 * - The domain spans the day's earliest to latest event, extended to include
 *   the basemaps those events are drawn on.
 * - Every basemap year in the domain is a tick (hover for its year).
 * - When an event is chosen, a blurred band marks the years its basemap
 *   stands in for (fuzzy on purpose: borders aren't a precise date), and a
 *   crisp marker shows the event's own year.
 *
 * @param {Object} options
 * @param {number[]} options.basemapYears Years with a basemap.
 * @param {number[]} options.eventYears Years of the day's events.
 * @param {number | null} [options.basemapYear=null] The basemap currently drawn, if any.
 * @param {number | null} [options.eventYear=null] The chosen event's year, if any.
 * @param {number} [options.width=1000]
 * @param {boolean} [options.dark=false]
 * @returns {SVGSVGElement | null} Null if there are no events.
 */
export function timelineRuler({
  basemapYears,
  eventYears,
  basemapYear = null,
  eventYear = null,
  width = 1000,
  dark = false,
}) {
  if (!eventYears.length) return null;

  const years = [...basemapYears].sort((a, b) => a - b);

  // Domain: earliest to latest event, widened to include their basemaps.
  let [lo, hi] = d3.extent(eventYears);
  lo = Math.min(lo, closest(lo, years));
  hi = Math.max(hi, closest(hi, years));
  if (lo === hi) {
    lo -= 50;
    hi += 50;
  }

  const x = d3.scaleLinear().domain([lo, hi]).range([MARGIN_X, width - MARGIN_X]);
  const inDomain = (y) => lo <= y && y <= hi;

  const label = [
    `Timeline from ${yearToString(lo)} to ${yearToString(hi)}`,
    eventYear !== null ? `, chosen event in ${yearToString(eventYear)}` : "",
    basemapYear !== null ? `, borders from about ${yearToString(basemapYear)}` : "",
  ].join("");

  const svg = d3
    .create("svg")
    .attr("width", width)
    .attr("height", HEIGHT)
    .attr("viewBox", [0, 0, width, HEIGHT])
    .attr("role", "img")
    .attr("aria-label", label)
    .style("display", "block")
    .style("overflow", "visible");

  // Blurred band for the drawn basemap.
  if (basemapYear !== null) {
    const filterId = `timeline-blur-${++filterCount}`;
    svg
      .append("defs")
      .append("filter")
      .attr("id", filterId)
      // Room for the blur to spread past the band without being clipped.
      .attr("filterUnits", "userSpaceOnUse")
      .attr("x", -width)
      .attr("y", -HEIGHT)
      .attr("width", width * 3)
      .attr("height", HEIGHT * 3)
      .append("feGaussianBlur")
      .attr("stdDeviation", 4);

    const [rangeLo, rangeHi] = basemapRange(basemapYear, years);
    let x0 = x(Math.max(rangeLo, lo));
    let x1 = x(Math.min(rangeHi, hi));
    if (x1 - x0 < MIN_BAND_PX) {
      const mid = (x0 + x1) / 2;
      x0 = mid - MIN_BAND_PX / 2;
      x1 = mid + MIN_BAND_PX / 2;
    }

    svg
      .append("rect")
      .attr("x", x0)
      .attr("width", x1 - x0)
      .attr("y", BASELINE_Y - 10)
      .attr("height", 20)
      .attr("rx", 6)
      .attr("fill", getColor("landHighlight", dark))
      .attr("opacity", 0.3)
      .attr("filter", `url(#${filterId})`)
      .style("pointer-events", "none");
  }

  // Baseline.
  svg
    .append("line")
    .attr("x1", x(lo))
    .attr("x2", x(hi))
    .attr("y1", BASELINE_Y)
    .attr("y2", BASELINE_Y)
    .attr("stroke", getColor("landStroke", dark))
    .attr("stroke-opacity", 0.5);

  // A tick per basemap year, with a wider invisible hit area for hovering.
  const ticks = svg
    .append("g")
    .selectAll("g")
    .data(years.filter(inDomain))
    .join("g")
    .attr("transform", (y) => `translate(${x(y)},0)`);

  ticks
    .append("line")
    .attr("y1", BASELINE_Y - TICK_HALF)
    .attr("y2", BASELINE_Y + TICK_HALF)
    .attr("stroke", getColor("landStroke", dark))
    .attr("stroke-opacity", 0.6);

  ticks
    .append("rect")
    .attr("x", -5)
    .attr("width", 10)
    .attr("y", BASELINE_Y - 12)
    .attr("height", 24)
    .attr("fill", "transparent")
    .on("mouseover", (_, y) => {
      tooltip
        .text(`Basemap: ${yearToString(y)}`)
        .style("background-color", getColor("tooltipBg", dark))
        .style("color", getColor("tooltipFg", dark))
        .style("visibility", "visible");
    })
    .on("mousemove", (event) => {
      // Flip to the left of the pointer if the tooltip would run off the right edge.
      const tipWidth = tooltip.node().offsetWidth;
      const viewportRight = window.scrollX + document.documentElement.clientWidth;
      const left =
        event.pageX + 10 + tipWidth > viewportRight
          ? event.pageX - 10 - tipWidth
          : event.pageX + 10;
      tooltip.style("top", `${event.pageY + 10}px`).style("left", `${left}px`);
    })
    .on("mouseout", () => tooltip.style("visibility", "hidden"));

  // Crisp marker for the chosen event's year, echoing its dot on the map.
  if (eventYear !== null && inDomain(eventYear)) {
    const g = svg.append("g").style("pointer-events", "none");
    g.append("line")
      .attr("x1", x(eventYear))
      .attr("x2", x(eventYear))
      .attr("y1", BASELINE_Y - 12)
      .attr("y2", BASELINE_Y + 12)
      .attr("stroke", getColor("landHighlight", dark))
      .attr("stroke-width", 2);
    g.append("circle")
      .attr("cx", x(eventYear))
      .attr("cy", BASELINE_Y)
      .attr("r", 4)
      .attr("fill", getColor("landHighlight", dark))
      .attr("stroke", getColor("pointStroke", dark));
  }

  // Domain ends, below the baseline.
  svg
    .append("g")
    .attr("class", "timeline-end-labels")
    .selectAll("text")
    .data([
      [lo, "start"],
      [hi, "end"],
    ])
    .join("text")
    .attr("x", ([y]) => x(y))
    .attr("y", HEIGHT - 2)
    .attr("text-anchor", ([, anchor]) => anchor)
    .text(([y]) => yearToString(y));

  // One combined label above, so the event and basemap labels can't collide.
  if (eventYear !== null || basemapYear !== null) {
    const parts = [];
    if (basemapYear !== null) parts.push(`Borders from ~${yearToString(basemapYear)}`);

    const at = x(eventYear ?? basemapYear);
    const anchor = at < width * 0.2 ? "start" : at > width * 0.8 ? "end" : "middle";
    const text = svg
      .append("text")
      .attr("class", "timeline-label")
      .attr("x", at)
      .attr("y", 12)
      .attr("text-anchor", anchor);

    text.append("tspan").text(parts.join(" · "));

    // Credit the basemaps alongside the year they're drawn from.
    if (basemapYear !== null) {
      text.append("tspan").text(" (");
      text
        .append("a")
        .attr("href", BASEMAPS_SOURCE_URL)
        .attr("target", "_blank")
        .attr("rel", "noopener")
        .append("tspan")
        .text("source");
      text.append("tspan").text(")");
    }
  }

  return svg.node();
}
