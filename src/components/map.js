import * as d3 from "d3";
import * as topojson from "topojson-client";

import { escapeHtml, yearToString } from "./lib.js";

/** @type {import('./lib.js').HistEvent} */

/**
 * Get color based on key and dark mode. Dark mode is typically set from
 * an Observable reactive variable.
 *
 * @param {'landFill'
 *   | 'unclaimedFill'
 *   | 'landStroke'
 *   | 'landHighlight'
 *   | 'seaFill'
 *   | 'sphereStroke'
 *   | 'pointFill'
 *   | 'pointStroke'
 *   | 'tooltipBg'
 *   | 'tooltipFg'
 *   | 'glow'} key
 * @param {boolean} dark A reactive variable indicating dark mode.
 * @returns {string}
 */
export function getColor(key, dark = false) {
  // Mostly greyscale palette.
  return {
    landFill: dark ? "#5a5a5a" : "#c4c4c4",
    unclaimedFill: dark ? "#4a4a4a" : "#d6d6d6",
    landHighlight: dark ? "#ffffff" : "#000000",
    landStroke: dark ? "#e0e0e0" : "#222222",
    seaFill: dark ? "#2b2b2b" : "#efefef",
    sphereStroke: dark ? "#777777" : "#999999",
    pointFill: dark ? "#f0f0f0" : "#3a3a3a",
    pointStroke: dark ? "#111111" : "#ffffff",
    tooltipBg: dark ? "#222222" : "#ffffff",
    tooltipFg: dark ? "#eeeeee" : "#222222",
    // A white halo on a light page is invisible and a black one reads as a
    // shadow, so light mode glows mid-grey.
    glow: dark ? "#ffffff" : "#555555",
  }[key];
}

const tooltip = getTooltipElement();

/**
 * Whether the ruler's threads are pinned (by clicking the ruler). Kept here
 * rather than as page state so that toggling it doesn't re-render the map, and
 * so it survives the re-renders that choosing an event causes.
 */
let threadsPinned = false;

/**
 * Two dots belong to the same event if they share a year and description.
 * (events.py emits one row per linked Wikipedia page with coordinates, so a
 * single event may appear as several dots.)
 */
function sameEvent(a, b) {
  return a && b && a.year === b.year && a.description === b.description;
}

/**
 * @param {Object} options
 * @param {Object|null} options.geodata Historical basemap TopoJSON.
 *   Drawn only when non-null.
 * @param {Object} options.land Borderless land TopoJSON (world-atlas land-50m).
 * @param {number} [options.width=1000]
 * @param {boolean} [options.dark=false]
 * @param {HistEvent[]} [options.events=[]] Events occurring on this day in history.
 * @param {HistEvent|null} [options.chosenEvent=null] The selected event, if any.
 * @param {(e: HistEvent|null) => void} [options.onSelect] Called with the
 *   clicked event, or null to clear the selection.
 * @param {Object | null} [options.timeline=null] If given, a timeline ruler is
 *   drawn in a band above the map, in the same SVG. Takes the options of
 *   drawTimelineRuler, minus width and dark.
 * @returns {SVGSVGElement}
 */
export async function worldMap({
  geodata = null,
  land,
  width = 1000,
  dark = false,
  events = [],
  chosenEvent = null,
  onSelect = () => {},
  timeline = null,
} = {}) {
  const sphere = { type: "Sphere" };

  // Calculate responsive dimensions
  const height = width * 0.6; // Maintain aspect ratio
  const rulerHeight = timeline?.eventYears.length ? RULER_HEIGHT : 0;

  // Create projection with responsive scale
  const padding = 20;
  const projection = d3.geoNaturalEarth1().fitExtent(
    [
      [padding, padding],
      [width - padding, height - padding],
    ],
    sphere,
  );

  const container = d3
    .create("svg")
    .attr("width", width)
    .attr("height", rulerHeight + height)
    .style("display", "block")
    // The ruler's top label can overhang the band at either end.
    .style("overflow", "visible");

  // The map sits below the ruler's band. Anything that should draw between
  // the land and the dots (e.g. threads to the ruler) belongs in this group.
  const g = container.append("g").attr("transform", `translate(0,${rulerHeight})`);

  const path = d3.geoPath(projection);

  // Sea. Clicking it clears the selection.
  g.append("path")
    .datum(sphere)
    .attr("fill", getColor("seaFill", dark))
    .attr("stroke", getColor("sphereStroke", dark))
    .attr("stroke-width", 1)
    .attr("d", path)
    .on("click", () => {
      if (chosenEvent) onSelect(null);
    });

  if (geodata) {
    // Historical borders for the selected event's time period.
    const regions = topojson
      .feature(geodata, geodata.objects.regions)
      .features.map(fixWinding);
    const point = [chosenEvent?.longitude, chosenEvent?.latitude];
    const containsChosenEvent = (d) =>
      chosenEvent !== null && d3.geoContains(d, point);

    g.append("g")
      .selectAll("path")
      .data(regions)
      .join("path")
      .attr("d", path)
      .attr("fill", (d) => getName(d) === null ?
        getColor("unclaimedFill", dark) : getColor("landFill", dark)
      )
      .attr("stroke", (d) =>
        containsChosenEvent(d)
          ? getColor("landHighlight", dark)
          : getColor("landStroke", dark),
      )
      .attr("stroke-width", (d) => (containsChosenEvent(d) ? 1 : 0.5))
      // Light borders on a dark fill read fainter than dark on light, so dark
      // mode needs a higher opacity for unselected borders to show as clearly.
      .attr("stroke-opacity", (d) => (containsChosenEvent(d) ? 1 : dark ? 0.55 : 0.3))
      .on("mouseover", (_, d) => {
        const name = getName(d);
        if (name !== null) {
          tooltip.html(`${name}`).style("visibility", "visible");
        }
      })
      .on("mousemove", moveTooltip)
      .on("mouseout", hideTooltip);
  } else {
    // No selection: plain land, no borders.
    g.append("path")
      .datum(topojson.feature(land, land.objects.land))
      .attr("fill", getColor("landFill", dark))
      .attr("stroke", "none")
      .attr("d", path)
      .style("pointer-events", "none");
  }

  const isChosen = (d) => sameEvent(d, chosenEvent);

  // Threads from each dot to its year on the ruler. The group is added here so
  // it draws between the land and the dots; it's filled in once the ruler (and
  // its scale) exists, below.
  const threads = g
    .append("g")
    .attr("class", "timeline-threads")
    .attr("fill", "none");

  const dots = g
    .append("g")
    .selectAll("circle")
    .data(events)
    .join("circle")
    .attr("fill", (d) =>
      isChosen(d) ? getColor("landHighlight", dark) : getColor("pointFill", dark),
    )
    .attr("stroke", getColor("pointStroke", dark))
    .attr("r", (d) => (isChosen(d) ? 8 : 5))
    .attr("opacity", (d) => (chosenEvent && !isChosen(d) ? 0.3 : 0.8))
    .style("cursor", "pointer")
    .attr(
      "transform",
      (d) => `translate(${projection([d.longitude, d.latitude])})`,
    )
    .on("click", (event, d) => {
      event.stopPropagation();
      hideTooltip();
      // Any of the chosen event's dots deselects it, not just the one clicked.
      onSelect(isChosen(d) ? null : d);
    })
    .on("mouseover", (event, d) => {
      // Bring the hovered dot above any dots it overlaps.
      d3.select(event.currentTarget).raise();
      showEventTooltip(d);
    })
    .on("mousemove", moveTooltip)
    .on("mouseout", () => {
      hideTooltip();
      // Put the chosen event's dots back on top once the hover ends.
      dots.filter(isChosen).raise();
    });

  // Draw the chosen event's dots on top of the dimmed ones.
  dots.filter(isChosen).raise();

  // Timeline ruler in the band above the map.
  if (rulerHeight) {
    const ruler = drawTimelineRuler(container.append("g"), { ...timeline, width, dark });
    drawThreads(ruler);
  }

  /**
   * Draw a thread from every dot to its year on the ruler.
   *
   * - All threads show while the ruler is hovered, and stay when it's clicked
   *   (pinned). The chosen event's threads always show, and are focused.
   * - Shown threads can be hovered (highlighting the event's threads and dots,
   *   with a tooltip and a marker on the ruler) and clicked (choosing the event).
   */
  function drawThreads(ruler) {
    // Vertical cubic Bézier: leaves the dot straight up and meets the ruler
    // at a right angle, with both control points halfway between the ends.
    const link = d3.linkVertical();
    // The ruler is outside `g`, so its baseline is above `g`'s origin.
    const rulerY = ruler.baselineY - rulerHeight;
    const threadPath = (d) =>
      link({
        source: projection([d.longitude, d.latitude]),
        target: [ruler.x(d.year), rulerY],
      });

    // Visible threads, too thin to point at, so they ignore the mouse...
    const paths = threads
      .append("g")
      .style("pointer-events", "none")
      .selectAll("path")
      .data(events)
      .join("path")
      .attr("stroke", getColor("landHighlight", dark))
      .attr("d", threadPath);

    // ...and a wide, transparent twin of each that catches it instead. Being in
    // the threads group, these sit above the land and below the dots.
    const hits = threads
      .append("g")
      .selectAll("path")
      .data(events)
      .join("path")
      .attr("d", threadPath)
      .attr("stroke", "transparent")
      .attr("stroke-width", THREAD_HIT_WIDTH)
      // "visibleStroke", not "stroke": plain "stroke" catches the mouse even
      // while the path is hidden.
      .style("pointer-events", "visibleStroke")
      .style("cursor", "pointer")
      .on("mouseover", (_, d) => {
        hoveredEvent = d;
        update();
        dots.filter((p) => sameEvent(p, d)).raise();
        showEventTooltip(d);
      })
      .on("mousemove", moveTooltip)
      .on("mouseout", () => {
        hoveredEvent = null;
        update();
        hideTooltip();
        dots.filter(isChosen).raise();
      })
      .on("click", (event, d) => {
        // Don't let the click reach the sea, which would clear the selection.
        event.stopPropagation();
        hideTooltip();
        onSelect(isChosen(d) ? null : d);
      });

    // Marker and year label on the ruler for the hovered thread's event.
    const hoverMark = ruler.group
      .append("g")
      .attr("visibility", "hidden")
      .style("pointer-events", "none");
    const hoverTick = hoverMark
      .append("line")
      .attr("y1", ruler.baselineY - 8)
      .attr("y2", ruler.baselineY + 8)
      .attr("stroke", getColor("landHighlight", dark))
      .attr("stroke-width", 1.5)
      .attr("stroke-opacity", 0.6);
    const hoverLabel = hoverMark
      .append("text")
      .attr("class", "timeline-hover-label")
      .attr("y", ruler.baselineY - 10);

    let hovering = false;
    /** @type {HistEvent | null} The event whose thread is under the mouse. */
    let hoveredEvent = null;
    const isHovered = (d) => sameEvent(d, hoveredEvent);
    const isShown = (d) => threadsPinned || hovering || isChosen(d);

    function update() {
      const visibility = (d) => (isShown(d) ? "visible" : "hidden");
      // With pointer-events: visibleStroke, hidden hit paths don't catch the mouse.
      hits.attr("visibility", visibility);
      paths
        .attr("visibility", visibility)
        .attr("stroke-width", (d) =>
          isChosen(d) ? THREAD_STYLE.focused.width
          : isHovered(d) ? THREAD_STYLE.hovered.width
          : THREAD_STYLE.normal.width,
        )
        .attr("stroke-opacity", (d) =>
          isChosen(d) ? THREAD_STYLE.focused.opacity
          : isHovered(d) ? THREAD_STYLE.hovered.opacity
          : THREAD_STYLE.normal.opacity,
        );
      // Hovered above the rest, chosen above all.
      paths.filter(isHovered).raise();
      paths.filter(isChosen).raise();

      if (hoveredEvent) {
        const at = ruler.x(hoveredEvent.year);
        hoverTick.attr("x1", at).attr("x2", at);
        hoverLabel
          .attr("x", at)
          .attr("text-anchor", at < width * 0.2 ? "start" : at > width * 0.8 ? "end" : "middle")
          .text(yearToString(hoveredEvent.year));
        hoverMark.attr("visibility", "visible");
      } else {
        hoverMark.attr("visibility", "hidden");
      }

      // Lock: open on hover, closed while pinned. Pinning also thickens the ruler.
      ruler.lock.group.attr("visibility", threadsPinned || hovering ? "visible" : "hidden");
      ruler.lock.shackle.attr("d", threadsPinned ? SHACKLE_CLOSED : SHACKLE_OPEN);
      // Shine while pinned and hovered: clicking here would act on this lock.
      const shine = threadsPinned && hovering;
      ruler.lock.icon
        .attr("filter", shine ? `url(#${ruler.lock.glowId})` : null)
        .attr("opacity", shine ? 1 : 0.8)
        .style("transform", shine ? `scale(${LOCK_SHINE_SCALE})` : null);
      ruler.baseline.attr(
        "stroke-width",
        threadsPinned ? BASELINE_WIDTH.pinned : BASELINE_WIDTH.unpinned,
      );
      ruler.group.attr("aria-pressed", threadsPinned);
    }

    ruler.group
      .style("cursor", "pointer")
      .on("mouseenter", () => {
        hovering = true;
        update();
      })
      .on("mouseleave", () => {
        hovering = false;
        update();
      })
      .on("click", (event) => {
        // Let the basemaps source link work without toggling the pin.
        if (event.target.closest("a")) return;
        threadsPinned = !threadsPinned;
        update();
      });

    update();
  }

  /** Show the tooltip for an event (shared by its dots and threads). */
  function showEventTooltip(d) {
    const date = `${d.month} ${d.day}, ${yearToString(d.year)}`;
    const name = d.location?.name;
    const place = name ? `${escapeHtml(name)} — ` : "";
    tooltip
      .html(`<strong>${date}</strong><br/>${place}${escapeHtml(d.description)}`)
      .style("visibility", "visible");
  }

  function moveTooltip(event) {
    tooltip
      .style("top", event.pageY + 10 + "px")
      .style("left", event.pageX + 10 + "px");
  }

  function hideTooltip() {
    tooltip.style("visibility", "hidden");
  }

  return container.node();
}

/**
 * d3-geo reads a polygon's inside from its ring order: wound the wrong way,
 * a ring encloses the rest of the globe. Some basemap regions are (e.g. Chile
 * from 1920 on), which covers the sea and catches its clicks. So flip any
 * polygon larger than a hemisphere. Checked per polygon, so only the bad parts
 * of a multi-part region are flipped.
 *
 * @param {Object} feature A GeoJSON feature
 * @returns {Object} The feature, with any inverted polygons rewound
 */
function fixWinding(feature) {
  const fix = (rings) =>
    d3.geoArea({ type: "Polygon", coordinates: rings }) > 2 * Math.PI
      ? rings.map((ring) => [...ring].reverse())
      : rings;
  const g = feature.geometry;
  if (g?.type === "Polygon") {
    return { ...feature, geometry: { ...g, coordinates: fix(g.coordinates) } };
  }
  if (g?.type === "MultiPolygon") {
    return { ...feature, geometry: { ...g, coordinates: g.coordinates.map(fix) } };
  }
  return feature;
}

/**
 * @typedef {Object} Region
 * @property {string} NAME
 * @property {string} SUBJECTO
 * @property {string} PARTOF
 */
/**
 * @param {Region} d A GeoJSON feature
 * @returns { string | null }
 */
function getName(d) {
  const { NAME, SUBJECTO, PARTOF } = d.properties;

  if (NAME === null || NAME === "unclaimed") {
    return null;
  }

  const subjectoDiffers = SUBJECTO && SUBJECTO !== NAME;
  const partofDiffers = PARTOF && PARTOF !== NAME;

  if (!subjectoDiffers && !partofDiffers) {
    return NAME;
  }

  if (subjectoDiffers && partofDiffers && SUBJECTO !== PARTOF) {
    return `${NAME} (${SUBJECTO}, ${PARTOF})`;
  }

  const qualifier = subjectoDiffers ? SUBJECTO : PARTOF;
  return `${NAME} (${qualifier})`;
}

/**
 * @param {boolean} dark
 * @returns A d3 selection representing the tooltip element, initially invisible.
 */
function getTooltipElement(dark = false) {
  const tooltip = d3
    .select("body")
    .append("div")
    .style("position", "absolute")
    .style("visibility", "hidden")
    .style("background-color", getColor("tooltipBg", dark))
    .style("border", "1px solid #ddd")
    .style("border-radius", "4px")
    .style("padding", "8px")
    .style("font-size", "14px")
    .style("font-family", "Avenir, sans-serif")
    .style("color", getColor("tooltipFg", dark))
    .style("box-shadow", "0 2px 4px rgba(0,0,0,0.1)")
    .style("pointer-events", "none")
    .style("z-index", "1000")
    .style("max-width", "300px");

  return tooltip;
}

// ---------------------------------------------------------------------------
// Timeline ruler, drawn in a band above the map.
// ---------------------------------------------------------------------------

/** Height of the band the ruler occupies, in pixels. */
const RULER_HEIGHT = 56;
/** Inset of the ruler from each side of its container, in pixels. */
const MARGIN_X = 40;
const BASELINE_Y = 34;

const BASEMAPS_SOURCE_URL = "https://github.com/aourednik/historical-basemaps";

/** Narrowest the blurred band is drawn, in pixels, so it stays visible on wide domains. */
const MIN_BAND_PX = 10;

/** Distance from the right end of the baseline to the padlock's centre, in pixels. */
const LOCK_OFFSET_X = 16;

/**
 * Padlock shackles, relative to the top-centre of the lock's body (which
 * starts at y = -2). Closed: both legs in the body. Open: raised, with only
 * the left leg still in the body.
 */
const SHACKLE_CLOSED = "M-3.5,-2 V-5 A3.5,3.5 0 0 1 3.5,-5 V-2";
const SHACKLE_OPEN = "M-3.5,-2 V-8 A3.5,3.5 0 0 1 3.5,-8 V-6";

/** Thread stroke styles: the chosen event's, a hovered event's, and the rest. */
const THREAD_STYLE = {
  focused: { width: 2, opacity: 0.8 },
  hovered: { width: 1.5, opacity: 0.6 },
  normal: { width: 0.75, opacity: 0.15 },
};

/** Width of the invisible stroke that catches the mouse for each thread, in pixels. */
const THREAD_HIT_WIDTH = 7;

/** How much the padlock grows while it shines. */
const LOCK_SHINE_SCALE = 1.15;

/** Baseline stroke width when the threads are unpinned and pinned. */
const BASELINE_WIDTH = { unpinned: 1, pinned: 2.5 };

/** Each ruler gets its own blur filter id, so re-renders (e.g. a theme change) don't clash. */
let filterCount = 0;

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
 * - When an event is chosen, a blurred band marks the years its basemap
 *   stands in for (fuzzy on purpose: borders aren't a precise date), and a
 *   crisp marker shows the event's own year.
 *
 * Draws into `parent`, a group inside a larger SVG (the map's), occupying a
 * band RULER_HEIGHT tall from the group's origin.
 *
 * @param {d3.Selection<SVGGElement>} parent The group to draw into.
 * @param {Object} options
 * @param {number[]} options.basemapYears Years with a basemap.
 * @param {number[]} options.eventYears Years of the day's events.
 * @param {number | null} [options.basemapYear=null] The basemap currently drawn, if any.
 * @param {number | null} [options.eventYear=null] The chosen event's year, if any.
 * @param {number} [options.width=1000]
 * @param {boolean} [options.dark=false]
 * @returns {{x: d3.ScaleLinear<number, number>, baselineY: number, group: d3.Selection<SVGGElement>} | null}
 *   The ruler's year scale, baseline height (in `parent`'s coordinates), and
 *   group (for attaching interactions), or null (and nothing drawn) if there
 *   are no events.
 */
function drawTimelineRuler(
  parent,
  {
    basemapYears,
    eventYears,
    basemapYear = null,
    eventYear = null,
    width = 1000,
    dark = false,
  },
) {
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

  // Named `svg` for brevity; it's a group within the shared SVG.
  const svg = parent
    .append("g")
    .attr("class", "timeline-ruler")
    .attr("role", "img")
    .attr("aria-label", label);

  // Invisible hit area covering the whole band, so hovering anywhere on the
  // ruler counts (not just on its thin marks).
  svg
    .append("rect")
    .attr("width", width)
    .attr("height", RULER_HEIGHT)
    .attr("fill", "transparent");

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
      .attr("y", -RULER_HEIGHT)
      .attr("width", width * 3)
      .attr("height", RULER_HEIGHT * 3)
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
  const baseline = svg
    .append("line")
    .attr("x1", x(lo))
    .attr("x2", x(hi))
    .attr("y1", BASELINE_Y)
    .attr("y2", BASELINE_Y)
    .attr("stroke", getColor("landStroke", dark))
    .attr("stroke-opacity", 0.5);

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
    .attr("y", RULER_HEIGHT - 2)
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

  // Padlock just past the right end of the baseline, showing whether the
  // threads are pinned. Hidden until the caller shows it.
  const lock = svg
    .append("g")
    .attr("transform", `translate(${x(hi) + LOCK_OFFSET_X},${BASELINE_Y - 2})`)
    .attr("visibility", "hidden")
    .style("pointer-events", "none");

  // Glow for the padlock: a blurred, tinted copy of its shape drawn behind it.
  const glowId = `timeline-lock-glow-${++filterCount}`;
  const glow = svg
    .append("defs")
    .append("filter")
    .attr("id", glowId)
    // Room for the halo around such a small shape.
    .attr("x", -1)
    .attr("y", -1)
    .attr("width", 3)
    .attr("height", 3);
  glow
    .append("feGaussianBlur")
    .attr("in", "SourceAlpha")
    .attr("stdDeviation", 2.5)
    .attr("result", "blur");
  glow
    .append("feFlood")
    .attr("flood-color", getColor("glow", dark))
    .attr("flood-opacity", 0.8);
  glow
    .append("feComposite")
    .attr("in2", "blur")
    .attr("operator", "in")
    .attr("result", "halo");
  const merge = glow.append("feMerge");
  merge.append("feMergeNode").attr("in", "halo");
  merge.append("feMergeNode").attr("in", "SourceGraphic");

  // The icon itself, in an inner group so it can scale about its own centre
  // without disturbing the outer group's positioning transform.
  const icon = lock
    .append("g")
    .attr("opacity", 0.8)
    .style("transform-box", "fill-box")
    .style("transform-origin", "center")
    .style("transition", "transform 150ms ease-out, opacity 150ms ease-out");
  icon
    .append("rect")
    .attr("x", -6)
    .attr("y", -2)
    .attr("width", 12)
    .attr("height", 9)
    .attr("rx", 1.5)
    .attr("fill", getColor("landStroke", dark));
  const shackle = icon
    .append("path")
    .attr("d", SHACKLE_OPEN)
    .attr("fill", "none")
    .attr("stroke", getColor("landStroke", dark))
    .attr("stroke-width", 1.5);

  return {
    x,
    baselineY: BASELINE_Y,
    group: svg,
    baseline,
    lock: { group: lock, icon, shackle, glowId },
  };
}
