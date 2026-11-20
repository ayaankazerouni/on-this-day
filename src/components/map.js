import * as d3 from "d3";
import * as topojson from "topojson-client";

import { escapeHtml, getClosestTimePeriod, yearToString } from "./lib.js";

/**
 * One dot on the map, as made by the data loader. A type-only import, so no
 * Node code reaches the browser. Named HistEvent so it doesn't shadow the DOM's
 * Event.
 *
 * @typedef {import("../data/events.js").Event} HistEvent
 */

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

/**
 * Whether the ruler's threads are pinned (by clicking the ruler). Kept here
 * rather than as page state so that toggling it doesn't re-render the map, and
 * so it survives the re-renders caused by changing the chosen event.
 */
let threadsPinned = false;

/**
 * Two dots belong to the same event if they share a year and description.
 * (The data loader, events.js, emits one Event per dot, and an event placed
 * at several locations gets several dots.)
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
 *   drawTimelineRuler, minus events, width and dark.
 * @returns {SVGSVGElement}
 */
export function worldMap({
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
  const tooltip = getTooltipElement(dark);

  // Calculate responsive dimensions
  const height = width * 0.6; // Maintain aspect ratio
  const rulerHeight = timeline && events.length ? RULER_HEIGHT : 0;

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
    .style("overflow", "visible");

  // The map sits below the ruler's band. Anything that should draw between
  // the land and the dots (e.g. threads to the ruler) belongs in this group.
  const g = container.append("g").attr("transform", `translate(0, ${rulerHeight})`);

  const path = d3.geoPath(projection);

  // Sea.
  g.append("path")
    .datum(sphere)
    .attr("fill", getColor("seaFill", dark))
    .attr("stroke", getColor("sphereStroke", dark))
    .attr("stroke-width", 1)
    .attr("d", path);

  if (geodata) {
    // Historical borders for the selected event's time period.
    const regions = topojson
      .feature(geodata, geodata.objects.regions)
      .features.map(fixWinding);

    // Country/empire/region borders from historical-basemaps.
    g.append("g")
      .selectAll("path")
      .data(regions)
      .join("path")
      .attr("d", path)
      .attr("fill", (d) => getName(d) === null ?
        getColor("unclaimedFill", dark) : getColor("landFill", dark)
      )
      .attr("stroke", getColor("landStroke", dark),
      )
      .attr("stroke-width", 0.2)
      .on("mouseover", (_, d) => {
        const name = getName(d);
        if (name !== null) {
          tooltip.text(name).style("visibility", "visible");
        }
      })
      .on("mousemove", moveTooltip)
      .on("mouseout", hideTooltip);
  } else {
    // Just land.
    g.append("path")
      .datum(topojson.feature(land, land.objects.land))
      .attr("fill", getColor("landFill", dark))
      .attr("stroke", getColor("landStroke", dark))
      .attr("stroke-width", 0.2)
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
    .attr("fill", getColor("pointFill", dark))
    .attr("stroke", getColor("pointStroke", dark))
    .attr("r", (d) => isChosen(d) ? 8 : 5)
    .attr("opacity", (d) => chosenEvent && !isChosen(d) ? 0.5 : 1)
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

  // Timeline ruler in the band above the map. Drawn beneath `g`, so the
  // threads' upper ends lie on top of it and catch the mouse there.
  if (rulerHeight) {
    const ruler = drawTimelineRuler(container.insert("g", ":first-child"), {
      ...timeline,
      events,
      width,
      dark,
    });
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
      .call(hoverAndSelect);

    // A barcode tick can be hovered and clicked like its event's thread,
    // whether or not the threads are showing.
    ruler.ticks.call(hoverAndSelect);

    /** Hovering highlights the event's threads and dots; clicking (de)selects it. */
    function hoverAndSelect(selection) {
      selection
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
          // Don't let the click reach the page, which would clear the selection
          // (see index.html), or the ruler, which would toggle the pin.
          event.stopPropagation();
          hideTooltip();
          onSelect(isChosen(d) ? null : d);
        });
    }

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

      ruler.markYear(hoveredEvent?.year ?? null);
      ruler.setState({ pinned: threadsPinned, hovering });
    }

    // The ruler counts as hovered while the pointer is in its band, judged by
    // position rather than by ruler.group's mouseenter/leave: threads draw on
    // top of the ruler, so moving onto one would "leave" the ruler, hiding the
    // threads (and the one under the pointer with them).
    const setHovering = (value) => {
      if (value === hovering) return;
      hovering = value;
      update();
    };
    container
      .on("mousemove.ruler", (event) => setHovering(d3.pointer(event)[1] < rulerHeight))
      .on("mouseleave.ruler", () => setHovering(false));

    ruler.group
      .style("cursor", "pointer")
      .on("click", (event) => {
        // Pinning shouldn't also clear the selection, which the page does on
        // any click that reaches it.
        event.stopPropagation();
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
 * Fix winding order for regions larger than a hemisphere.
 * 
 * d3-geo uses a winding order convention (exterior ring for regions
 * smaller than a hemisphere must be clockwise; exterior ring for regions
 * larger than a hemisphere must be anticlockwise).
 * 
 * Some of the basemap regions are wound the wrong way, so their "inside"
 * encompasses the rest of the globe instead of the region itself.
 * 
 * @see {@link https://d3js.org/d3-geo}
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
 * The map's tooltip, coloured for the current theme.
 *
 * There's one tooltip per page, shared by every render of the map: it's
 * created on first use (hidden), then reused, so re-renders and module reloads
 * don't leave extra elements on the page. Its colours are reset each call, so
 * it follows theme changes.
 *
 * @param {boolean} dark
 * @returns A d3 selection of the tooltip element.
 */
function getTooltipElement(dark = false) {
  return d3
    .select("body")
    .selectAll("div.map-tooltip")
    .data([null])
    .join((enter) =>
      enter
        .append("div")
        .attr("class", "map-tooltip")
        .style("position", "absolute")
        .style("visibility", "hidden")
        .style("border", "1px solid #ddd")
        .style("border-radius", "4px")
        .style("padding", "8px")
        .style("font-size", "14px")
        .style("font-family", "Avenir, sans-serif")
        .style("box-shadow", "0 2px 4px rgba(0,0,0,0.1)")
        .style("pointer-events", "none")
        .style("z-index", "1000")
        .style("max-width", "300px"),
    )
    .style("background-color", getColor("tooltipBg", dark))
    .style("color", getColor("tooltipFg", dark));
}

// ---------------------------------------------------------------------------
// Timeline ruler, drawn in a band above the map.
// ---------------------------------------------------------------------------

/** Height of the band the ruler occupies, in pixels. */
const RULER_HEIGHT = 56;
/** Inset of the ruler from each side of its container, in pixels. */
const MARGIN_X = 40;
const BASELINE_Y = 34;

/** Distance from the right end of the ruler to the padlock's centre, in pixels. */
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

/**
 * Width of the invisible stroke that catches the mouse for each thread and
 * barcode tick, in pixels.
 */
const THREAD_HIT_WIDTH = 7;

/** How much the padlock grows while it shines. */
const LOCK_SHINE_SCALE = 1.15;

/**
 * Rulers narrower than this, in pixels, crowd their ticks together, so they
 * draw the barcode and baseline thinner (the `narrow` widths below).
 */
const NARROW_RULER_WIDTH = 600;

/**
 * Barcode ticks, one per event: stroke width on wide and narrow rulers
 * (thicker than a hairline, thinner than THREAD_HIT_WIDTH) and half-height,
 * in pixels.
 */
const BARCODE_TICK = { width: { wide: 3, narrow: 1.5 }, halfHeight: 7 };

/**
 * Opacity of each barcode tick when the threads are unpinned and pinned. Low,
 * so the barcode stays in the background, and so overlapping ticks (several
 * events in close years) read darker.
 */
const BARCODE_OPACITY = { unpinned: 0.35, pinned: 0.6 };

/**
 * Baseline stroke width on wide and narrow rulers, when the threads are
 * unpinned and pinned; under BARCODE_TICK.width for the same ruler.
 */
const BASELINE_WIDTH = {
  wide: { unpinned: 1, pinned: 2 },
  narrow: { unpinned: 0.75, pinned: 1.25 },
};

/** Each ruler gets its own filter ids, so re-renders (e.g. a theme change) don't clash. */
let filterCount = 0;

/**
 * A horizontal ruler showing how far back in history today's events go.
 *
 * - The domain spans the day's earliest to latest event, extended to include
 *   the basemaps those events are drawn on.
 * - A barcode marks each event's year.
 * - When an event is chosen, a crisp marker shows its year.
 *
 * Draws into `parent`, a group inside a larger SVG (the map's), occupying a
 * band RULER_HEIGHT tall from the group's origin.
 *
 * @param {d3.Selection<SVGGElement>} parent The group to draw into.
 * @param {Object} options
 * @param {number[]} options.basemapYears Years with a basemap.
 * @param {HistEvent[]} options.events The day's events; the barcode marks each one's year.
 * @param {number | null} [options.eventYear=null] The chosen event's year, if any.
 * @param {number} [options.width=1000]
 * @param {boolean} [options.dark=false]
 * @returns {{
 *   x: d3.ScaleLinear<number, number>,
 *   baselineY: number,
 *   group: d3.Selection<SVGGElement>,
 *   ticks: d3.Selection<SVGLineElement, HistEvent>,
 *   markYear: (year: number | null) => void,
 *   setState: (state: {pinned: boolean, hovering: boolean}) => void,
 * } | null}
 *   The ruler's year scale, baseline height (in `parent`'s coordinates),
 *   group, and per-event tick hit targets (both for attaching interactions);
 *   `markYear`, to mark a hovered event's year (null to clear); and `setState`,
 *   to show whether the threads are pinned and the ruler hovered. Null (and
 *   nothing drawn) if there are no events.
 */
function drawTimelineRuler(
  parent,
  {
    basemapYears,
    events,
    eventYear = null,
    width = 1000,
    dark = false,
  },
) {
  if (!events.length) return null;

  const years = [...basemapYears].sort((a, b) => a - b);

  // Domain: earliest to latest event, widened to include their basemaps.
  let [lo, hi] = d3.extent(events, (d) => d.year);
  lo = Math.min(lo, getClosestTimePeriod(lo, years));
  hi = Math.max(hi, getClosestTimePeriod(hi, years));
  if (lo === hi) {
    lo -= 50;
    hi += 50;
  }

  const x = d3.scaleLinear().domain([lo, hi]).range([MARGIN_X, width - MARGIN_X]);
  const inDomain = (y) => lo <= y && y <= hi;

  const size = width < NARROW_RULER_WIDTH ? "narrow" : "wide";
  const tickWidth = BARCODE_TICK.width[size];
  const baselineWidth = BASELINE_WIDTH[size];

  const label = [
    `Timeline from ${yearToString(lo)} to ${yearToString(hi)}`,
    eventYear !== null ? `, chosen event in ${yearToString(eventYear)}` : "",
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

  // Baseline through the whole domain, beneath the ticks: holds a sparse
  // barcode together and shows the ruler is one thing to point at.
  const baseline = svg
    .append("line")
    .attr("x1", x(lo))
    .attr("x2", x(hi))
    .attr("y1", BASELINE_Y)
    .attr("y2", BASELINE_Y)
    .attr("stroke", getColor("landStroke", dark))
    .attr("stroke-opacity", 0.5)
    .attr("stroke-width", baselineWidth.unpinned)
    .style("pointer-events", "none");

  // Barcode: a tick at each event's year. Its hit targets (below) share this
  // geometry.
  const tickedEvents = events.filter((d) => inDomain(d.year));
  const tickAt = (lines) =>
    lines
      .attr("x1", (d) => x(d.year))
      .attr("x2", (d) => x(d.year))
      .attr("y1", BASELINE_Y - BARCODE_TICK.halfHeight)
      .attr("y2", BASELINE_Y + BARCODE_TICK.halfHeight);
  const barcode = svg
    .append("g")
    .attr("stroke", getColor("landStroke", dark))
    .attr("stroke-width", tickWidth)
    .attr("stroke-opacity", BARCODE_OPACITY.unpinned)
    .style("pointer-events", "none");
  barcode.selectAll("line").data(tickedEvents).join("line").call(tickAt);

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

  // Padlock just past the right end of the ruler, showing whether the
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

  // Transparent hit targets over the barcode's ticks: wider than the ticks, so
  // they're easy to point at without drawing the ticks heavier. Above the
  // ruler's other marks, bar the hover marker (below), which ignores the mouse.
  const ticks = svg
    .append("g")
    .attr("class", "timeline-tick-targets")
    .selectAll("line")
    .data(tickedEvents)
    .join("line")
    .call(tickAt)
    .attr("stroke", "transparent")
    .attr("stroke-width", THREAD_HIT_WIDTH);

  // Marker and year label for a hovered event (see markYear). Ignores the
  // mouse, so the tick targets beneath it still catch it.
  const hoverMark = svg
    .append("g")
    .attr("visibility", "hidden")
    .style("pointer-events", "none");
  const hoverTick = hoverMark
    .append("line")
    // Taller than the barcode's ticks, so it stands out from them.
    .attr("y1", BASELINE_Y - 10)
    .attr("y2", BASELINE_Y + 10)
    .attr("stroke", getColor("landHighlight", dark))
    .attr("stroke-width", 1.5)
    .attr("stroke-opacity", 0.6);
  const hoverLabel = hoverMark
    .append("text")
    .attr("class", "timeline-hover-label")
    .attr("y", BASELINE_Y - 12);

  /** Mark a hovered event's year on the ruler, or clear the mark (null). */
  function markYear(year) {
    if (year === null) {
      hoverMark.attr("visibility", "hidden");
      return;
    }
    const at = x(year);
    hoverTick.attr("x1", at).attr("x2", at);
    hoverLabel
      .attr("x", at)
      .attr("text-anchor", at < width * 0.2 ? "start" : at > width * 0.8 ? "end" : "middle")
      .text(yearToString(year));
    hoverMark.attr("visibility", "visible");
  }

  /**
   * Show whether the threads are pinned and the ruler hovered. The padlock
   * shows while either holds: open on hover, closed while pinned. Pinning also
   * darkens the barcode and thickens the baseline.
   */
  function setState({ pinned, hovering }) {
    lock.attr("visibility", pinned || hovering ? "visible" : "hidden");
    shackle.attr("d", pinned ? SHACKLE_CLOSED : SHACKLE_OPEN);
    // Shine while pinned and hovered: clicking here would act on this lock.
    const shine = pinned && hovering;
    icon
      .attr("filter", shine ? `url(#${glowId})` : null)
      .attr("opacity", shine ? 1 : 0.8)
      .style("transform", shine ? `scale(${LOCK_SHINE_SCALE})` : null);
    barcode.attr("stroke-opacity", pinned ? BARCODE_OPACITY.pinned : BARCODE_OPACITY.unpinned);
    baseline.attr("stroke-width", pinned ? baselineWidth.pinned : baselineWidth.unpinned);
    svg.attr("aria-pressed", pinned);
  }

  return { x, baselineY: BASELINE_Y, group: svg, ticks, markYear, setState };
}
