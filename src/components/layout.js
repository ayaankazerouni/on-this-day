import * as d3 from "d3";

/**
 * @typedef {import("../data/events.js").Event} HistEvent
 */

/**
 * Where to draw each event's dot so that overlapping dots are packed into
 * tight groups.
 *
 * 1. Every dot starts as a group of one, at its true (projected) position.
 * 2. While any two groups overlap, merge the pair that overlaps most, and
 *    repack the merged group (packGroup). A repacked group is larger than
 *    either part, so it can now overlap others; the loop catches that.
 * 3. Stop once no two groups overlap. A dot with no neighbours stays put.
 *
 * @param {HistEvent[]} events
 * @param {(lonLat: [number, number]) => [number, number] | null} projection
 * @param {Object} [options]
 * @param {number} [options.radius=5] Radius each dot is packed at, in pixels.
 * @param {number} [options.padding=0] Gap kept between packed dots, in pixels.
 * @returns {Map<HistEvent, [number, number]>} Drawn position of each event's dot.
 */
export function packDots(events, projection, { radius = 5, padding = 0 } = {}) {
  const r = radius + padding / 2;

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
    r,
    slots: [{ x: 0, y: 0 }],
  }));

  for (;;) {
    const pair = mostOverlapping(groups);
    if (!pair) break;
    const [a, b] = pair;
    groups = groups.filter((g) => g !== a && g !== b);
    groups.push(packGroup([...a.members, ...b.members], r));
  }

  const positions = new Map();
  for (const group of groups) {
    group.members.forEach((dot, i) => {
      positions.set(dot.event, [group.x + group.slots[i].x, group.y + group.slots[i].y]);
    });
  }
  return positions;
}

/**
 * A group of dots packed together: its members, the centre and radius of the
 * circle enclosing it, and each member's position relative to that centre
 * (slots[i] is members[i]'s).
 *
 * @typedef {Object} Group
 * @property {{event: HistEvent, x: number, y: number}[]} members
 * @property {number} x
 * @property {number} y
 * @property {number} r
 * @property {{x: number, y: number}[]} slots
 */

/**
 * The two groups whose enclosing circles overlap most, or null if none do.
 * Touching doesn't count as overlapping.
 *
 * @param {Group[]} groups
 * @returns {[Group, Group] | null}
 */
function mostOverlapping(groups) {
  let best = null;
  let bestOverlap = 1e-6;
  for (let i = 0; i < groups.length; i++) {
    for (let j = i + 1; j < groups.length; j++) {
      const a = groups[i];
      const b = groups[j];
      const overlap = a.r + b.r - Math.hypot(a.x - b.x, a.y - b.y);
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
 * @param {number} r
 * @returns {Group}
 */
function packGroup(dots, r) {
  const x = d3.mean(dots, (d) => d.x);
  const y = d3.mean(dots, (d) => d.y);

  const circles = d3.packSiblings(dots.map(() => ({ r })));
  // packSiblings centres the group's enclosing circle on the origin.
  const enclosing = d3.packEnclose(circles);

  // Every slot–dot pair, closest first; ties go to the earlier slot, then dot.
  const pairs = [];
  circles.forEach((c, s) => {
    dots.forEach((d, m) => {
      pairs.push({ s, m, dist: (x + c.x - d.x) ** 2 + (y + c.y - d.y) ** 2 });
    });
  });
  pairs.sort((p, q) => p.dist - q.dist || p.s - q.s || p.m - q.m);

  const slotOf = new Array(dots.length);
  const slotTaken = new Array(circles.length).fill(false);
  for (const { s, m } of pairs) {
    if (slotTaken[s] || slotOf[m] !== undefined) continue;
    slotTaken[s] = true;
    slotOf[m] = s;
  }

  return {
    members: dots,
    x,
    y,
    r: enclosing.r,
    slots: dots.map((_, m) => ({ x: circles[slotOf[m]].x, y: circles[slotOf[m]].y })),
  };
}
