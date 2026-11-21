import * as d3 from "d3";

/**
 * @typedef {import("../data/events.js").Event} HistEvent
 */


/**
 * A group of dots packed together: its members, the centre and radius of the
 * circle enclosing it, and each member's position relative to that centre
 * (slots[i] is members[i]'s).
 *
 * @typedef {Object} Group
 * @property {{event: HistEvent, x: number, y: number}[]} members
 * @property {number} x
 * @property {number} y
 * @property {number} r Radius of the circle enclosing the group.
 * @property {number} dotRadius Radius every member is drawn at: the normal
 *   radius, or smaller if the group was shrunk to fit (see packDots).
 * @property {{x: number, y: number}[]} slots
 * @property {Set<Group>} blocked Groups this one overlaps but mustn't merge
 *   with, because packing them together would move a dot too far. A new
 *   (merged) group starts with none, so it gets a fresh try against them.
 */

/** Slack for floating-point error when comparing distances, in pixels. */
const EPSILON = 1e-6;

/**
 * Where to draw each event's dot, and how big, so that overlapping dots are
 * packed into tight groups without moving any dot more than `maxShift` from
 * its true position.
 *
 * 1. Every dot starts as a group of one, at its true (projected) position.
 * 2. Take the pair of groups that overlaps most (skipping blocked pairs), and
 *    try to merge them (tryMerge): pack them together, at their dots' radius
 *    and then at smaller radii, stepping down to `minRadius`.
 *    - The first packing in which no dot is more than `maxShift` from its true
 *      position replaces the pair. It's larger than either part, so it can
 *      now overlap others; later rounds catch that.
 *    - If none fits, try keeping them apart instead (trySeparate): shrink
 *      both groups' dots, a step at a time, until the groups no longer
 *      overlap each other.
 *    - If that fails too, block the pair: the two groups stay, overlapping.
 * 3. Stop once no unblocked pair overlaps. A dot with no neighbours stays put,
 *    at full size.
 *
 * Each round merges two groups, shrinks them, or blocks a pair. Merging
 * leaves fewer groups, shrinking only ever makes dots smaller (down to
 * `minRadius`), and there are only so many pairs to block, so the loop
 * always ends.
 *
 * @param {HistEvent[]} events
 * @param {(lonLat: [number, number]) => [number, number] | null} projection
 * @param {Object} [options]
 * @param {number} [options.radius=5] Normal radius of a dot, in pixels.
 * @param {number} [options.minRadius=radius] Smallest radius a group's dots may
 *   be shrunk to so that the group fits within `maxShift`. The default,
 *   `radius`, never shrinks.
 * @param {number} [options.shrinkStep=0.25] How much smaller each try is, in pixels.
 * @param {number} [options.padding=0] Gap kept between packed dots, in pixels.
 * @param {number} [options.maxShift=Infinity] Furthest a dot may be drawn from
 *   its true position, in pixels. Never less than the normal packing radius:
 *   two dots at the same position must each move that far to stop covering
 *   each other completely (which would also leave one with no hover target).
 * @returns {Map<HistEvent, {position: [number, number], radius: number}>}
 *   Where each event's dot is drawn, and its radius.
 */
export function packDots(
  events,
  projection,
  { radius = 5, minRadius = radius, shrinkStep = 0.25, padding = 0, maxShift = Infinity } = {},
) {
  const options = {
    minRadius: Math.min(minRadius, radius),
    shrinkStep,
    padding,
    shiftLimit: Math.max(maxShift, radius + padding / 2),
  };

  /** @type {{event: HistEvent, x: number, y: number}[]} True positions. */
  const dots = events.map((event) => {
    const [x, y] = projection([event.longitude, event.latitude]);
    return { event, x, y };
  });

  /** @type {Group[]} */
  let groups = dots.map((dot) => ({
    members: [dot],
    x: dot.x,
    y: dot.y,
    r: radius + padding / 2,
    dotRadius: radius,
    slots: [{ x: 0, y: 0 }],
    blocked: new Set(),
  }));

  while (true) {
    const pair = mostOverlapping(groups);
    if (!pair) break;
    const [a, b] = pair;
    const replacements = tryMerge(a, b, options) ?? trySeparate(a, b, options);
    if (!replacements) {
      a.blocked.add(b);
      b.blocked.add(a);
      continue;
    }
    groups = groups.filter((g) => g !== a && g !== b);
    groups.push(...replacements);
  }

  const layout = new Map();
  for (const group of groups) {
    group.members.forEach((dot, i) => {
      layout.set(dot.event, {
        position: [group.x + group.slots[i].x, group.y + group.slots[i].y],
        radius: group.dotRadius,
      });
    });
  }
  return layout;
}

/**
 * Pack two groups' dots together, as large as will fit, trying the radii from
 * shrinkingRadii in turn.
 *
 * @param {Group} a
 * @param {Group} b
 * @param {{minRadius: number, shrinkStep: number, padding: number, shiftLimit: number}} options
 * @returns {[Group] | null} The first packing that moves no dot further than
 *   `shiftLimit`, or null if none does.
 */
function tryMerge(a, b, { minRadius, shrinkStep, padding, shiftLimit }) {
  const members = [...a.members, ...b.members];
  for (const dotRadius of shrinkingRadii(a, b, minRadius, shrinkStep)) {
    const group = packGroup(members, dotRadius, padding);
    if (largestShift(group) <= shiftLimit + EPSILON) return [group];
  }
  return null;
}

/**
 * Keep two overlapping groups apart by shrinking them: repack each, on its
 * own, at the same smaller radius, stepping down as in tryMerge, until the
 * two no longer overlap. (Used when they can't merge: smaller dots may simply
 * stop overlapping, without moving anywhere.)
 *
 * @param {Group} a
 * @param {Group} b
 * @param {{minRadius: number, shrinkStep: number, padding: number, shiftLimit: number}} options
 * @returns {[Group, Group] | null} The two repacked groups, or null if they
 *   still overlap at `minRadius` (or a repacking moves a dot too far).
 */
function trySeparate(a, b, { minRadius, shrinkStep, padding, shiftLimit }) {
  for (const dotRadius of shrinkingRadii(a, b, minRadius, shrinkStep)) {
    const groups = [packGroup(a.members, dotRadius, padding), packGroup(b.members, dotRadius, padding)];
    const fits = groups.every((g) => largestShift(g) <= shiftLimit + EPSILON);
    if (fits && overlapOf(groups[0], groups[1]) <= EPSILON) return groups;
  }
  return null;
}

/**
 * The radii to try for two groups, largest first: the smaller of their dot
 * radii, then smaller by `shrinkStep` at a time, ending exactly at
 * `minRadius`. Starting from the smaller radius means a group that has been
 * shrunk never grows back.
 *
 * @param {Group} a
 * @param {Group} b
 * @param {number} minRadius
 * @param {number} shrinkStep
 */
function* shrinkingRadii(a, b, minRadius, shrinkStep) {
  const start = Math.min(a.dotRadius, b.dotRadius);
  for (let step = 0; ; step++) {
    // Computed from the start each time (not decremented), so rounding
    // errors don't build up.
    const radius = Math.max(minRadius, start - step * shrinkStep);
    yield radius;
    if (radius <= minRadius) return;
  }
}

/**
 * How far two groups' enclosing circles overlap, in pixels: positive if they
 * overlap, zero if they touch, negative if there's a gap.
 *
 * @param {Group} a
 * @param {Group} b
 */
function overlapOf(a, b) {
  return a.r + b.r - Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * Furthest any of a group's dots is drawn from its true position, in pixels.
 *
 * @param {Group} group
 */
function largestShift(group) {
  return d3.max(group.members, (dot, i) =>
    Math.hypot(group.x + group.slots[i].x - dot.x, group.y + group.slots[i].y - dot.y),
  );
}

/**
 * The two groups whose enclosing circles overlap most, or null if none do.
 * Touching doesn't count as overlapping, and blocked pairs are skipped.
 *
 * @param {Group[]} groups
 * @returns {[Group, Group] | null}
 */
function mostOverlapping(groups) {
  let best = null;
  let bestOverlap = EPSILON;
  for (let i = 0; i < groups.length; i++) {
    for (let j = i + 1; j < groups.length; j++) {
      const a = groups[i];
      const b = groups[j];
      if (a.blocked.has(b)) continue;
      const overlap = overlapOf(a, b);
      if (overlap > bestOverlap) {
        best = [a, b];
        bestOverlap = overlap;
      }
    }
  }
  return best;
}

/**
 * Pack dots into a tight group, centred on the mean of their true positions.
 *
 * d3.packSiblings places equal circles touching each other, around the
 * origin, but knows nothing about where each dot belongs. So the packed
 * positions (slots) are handed out afterwards: repeatedly give the closest
 * remaining slot–dot pair to each other. Dots then keep roughly their
 * relative arrangement, e.g. the westernmost dot gets a western slot.
 *
 * @param {{event: HistEvent, x: number, y: number}[]} dots
 * @param {number} dotRadius Radius each dot is drawn at, in pixels.
 * @param {number} padding Gap kept between packed dots, in pixels.
 * @returns {Group}
 */
function packGroup(dots, dotRadius, padding) {
  // Each dot takes up its radius plus half the gap on every side.
  const r = dotRadius + padding / 2;
  const x = d3.mean(dots, (dot) => dot.x);
  const y = d3.mean(dots, (dot) => dot.y);

  // The packed positions as offsets from the group's centre.
  // packSiblings arranges around the origin.
  const slots = d3.packSiblings(dots.map(() => ({ r })));
  // The smallest circle enclosing the packed siblings.
  const enclosing = d3.packEnclose(slots);

  // Every slot–dot pair, by index, with the squared distance from the slot's
  // place on screen to the dot's true position. Closest first; ties go to the
  // earlier slot, then the earlier dot.
  const pairs = [];
  slots.forEach((slot, slotIndex) => {
    dots.forEach((dot, dotIndex) => {
      const distSq = (x + slot.x - dot.x) ** 2 + (y + slot.y - dot.y) ** 2;
      pairs.push({ slotIndex, dotIndex, distSq });
    });
  });
  pairs.sort(
    (a, b) => a.distSq - b.distSq || a.slotIndex - b.slotIndex || a.dotIndex - b.dotIndex,
  );

  /** slotIndexOfDot[dotIndex] is the index of the slot given to that dot. */
  const slotIndexOfDot = new Array(dots.length);
  const slotTaken = new Array(slots.length).fill(false);
  for (const { slotIndex, dotIndex } of pairs) {
    if (slotTaken[slotIndex] || slotIndexOfDot[dotIndex] !== undefined) continue;
    slotTaken[slotIndex] = true;
    slotIndexOfDot[dotIndex] = slotIndex;
  }

  return {
    members: dots,
    x,
    y,
    r: enclosing.r,
    dotRadius,
    slots: slotIndexOfDot.map((slotIndex) => ({ x: slots[slotIndex].x, y: slots[slotIndex].y })),
    blocked: new Set(),
  };
}
