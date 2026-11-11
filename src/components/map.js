import * as d3 from "d3";
import { FileAttachment } from "observablehq:stdlib";
import * as topojson from "topojson-client";

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
 *   | 'tooltipFg'} key
 * @param {boolean} dark A reactive variable indicating dark mode.
 * @returns {string}
 */
function getColor(key, dark = false) {
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
  }[key];
}

const tooltip = getTooltipElement();

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
 * @param {FileAttachment|Object|null} options.geodata Historical basemap
 *   (TopoJSON or a FileAttachment for it). Drawn only when non-null.
 * @param {Object} options.land Borderless land TopoJSON (world-atlas land-50m).
 * @param {number} [options.width=1000]
 * @param {boolean} [options.dark=false]
 * @param {HistEvent[]} [options.events=[]] Events occurring on this day in history.
 * @param {HistEvent|null} [options.chosenEvent=null] The selected event, if any.
 * @param {(e: HistEvent|null) => void} [options.onSelect] Called with the
 *   clicked event, or null to clear the selection.
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
} = {}) {
  // If geodata is a FileAttachment, await its JSON
  if (geodata?.json) {
    geodata = await geodata.json();
  }

  const sphere = { type: "Sphere" };

  // Calculate responsive dimensions
  const height = width * 0.6; // Maintain aspect ratio

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
    .attr("height", height);

  const g = container.append("g");

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
    const regions = topojson.feature(geodata, geodata.objects.regions);
    const point = [chosenEvent?.longitude, chosenEvent?.latitude];
    const containsChosenEvent = (d) =>
      chosenEvent !== null && d3.geoContains(d, point);

    g.append("g")
      .selectAll("path")
      .data(regions.features)
      .join("path")
      .attr("d", path)
      .attr("fill", getColor("landFill", dark))
      .attr("stroke", (d) =>
        containsChosenEvent(d)
          ? getColor("landHighlight", dark)
          : getColor("landStroke", dark),
      )
      .attr("stroke-width", (d) => (containsChosenEvent(d) ? 1.5 : 0.5))
      .attr("stroke-opacity", (d) => (containsChosenEvent(d) ? 1 : 0.3))
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
      onSelect(d === chosenEvent ? null : d);
    })
    .on("mouseover", (_, d) => {
      const bce = d.year < 0 ? "BCE" : "CE";
      const date = `${d.month} ${d.day}, ${Math.abs(d.year)} ${bce}`;
      tooltip
        .html(`<strong>${date}</strong><br/>${d.description}`)
        .style("visibility", "visible");
    })
    .on("mousemove", moveTooltip)
    .on("mouseout", hideTooltip);

  // Draw the chosen event's dots on top of the dimmed ones.
  dots.filter(isChosen).raise();

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
