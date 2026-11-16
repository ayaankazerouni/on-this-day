import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { MONTHS } from "../components/months.js";
import { emptyFacts, getItemFacts } from "./wikidata.js";

/**
 * @typedef {import("./wikidata.js").ItemFacts} ItemFacts
 * @typedef {import("./wikidata.js").WikidataDate} WikidataDate
 */

/**
 * @typedef {Object} PageImage
 * @property {string} source
 * @property {number} [width] Absent for images taken from Wikidata (P18, image).
 * @property {number} [height] Absent for images taken from Wikidata (P18, image).
 */

/**
 * The Wikipedia page shown for an event (title, link, image).
 *
 * @typedef {Object} Page
 * @property {number} pageid
 * @property {string} title
 * @property {string} url
 * @property {PageImage} [thumbnail] Absent if neither Wikipedia nor Wikidata has an image.
 */

/**
 * The page a dot's coordinates came from.
 *
 * @typedef {Object} Location
 * @property {string} title
 * @property {string | null} wikibaseItem
 */

/**
 * One dot on the map. An event placed at several locations produces several
 * Events with the same year, description, and page.
 *
 * @typedef {Object} Event
 * @property {number} day
 * @property {string} month
 * @property {number} year
 * @property {string} description
 * @property {number} longitude
 * @property {number} latitude
 * @property {Location} location
 * @property {Page} page
 */

/**
 * A page from the onthisday feed (a Wikipedia page summary). Only the
 * fields used here are listed.
 *
 * @typedef {Object} FeedPage
 * @property {number} pageid
 * @property {string} title
 * @property {{normalized?: string}} [titles]
 * @property {string} [wikibase_item]
 * @property {{lat: number, lon: number}} [coordinates]
 * @property {PageImage} [thumbnail]
 * @property {{desktop: {page: string}}} content_urls
 */

/**
 * The date of an event from the feed: the requested month and day, and the
 * event's year in history.
 *
 * @typedef {Object} FeedDate
 * @property {number} year Negative for BCE.
 * @property {number} month
 * @property {number} day
 */

/**
 * Last year in which some country still used the Julian calendar (Greece
 * switched in 1923). Up to then, Wikipedia may give an event's date in the
 * Julian calendar, while the query service always gives Gregorian dates.
 *
 * - Wikipedia: https://en.wikipedia.org/wiki/Wikipedia:Manual_of_Style/Dates_and_numbers#Julian_and_Gregorian_calendars
 * - Query service: https://www.mediawiki.org/wiki/Wikibase/Indexing/RDF_Dump_Format (Time)
 */
const LAST_JULIAN_YEAR = 1923;

/** Days since the epoch for a (Gregorian) date. Works for any year. */
function dayNumber(year, month, day) {
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  return Math.round(date.getTime() / 86_400_000);
}

/** The (Gregorian) month, 1-indexed, of a day number from `dayNumber`. */
function monthOf(dayNum) {
  return new Date(dayNum * 86_400_000).getUTCMonth() + 1;
}

/**
 * Days to add to a Julian-calendar date to get the same day in the Gregorian
 * calendar. The gap grows by one day each century year that is a leap year in
 * Julian but not Gregorian (1700, 1800, 1900, …), taking effect after February.
 * E.g. 6 days in 1066, 10 in 1582, 11 in 1752, 13 in 1917.
 */
function julianToGregorianOffset(year, month) {
  const y = month <= 2 ? year - 1 : year;
  return Math.floor(y / 100) - Math.floor(y / 400) - 2;
}

/**
 * Day numbers the feed's date might correspond to in the (Gregorian) query
 * service: the date as given, and, if it could be a Julian date, its
 * Gregorian equivalent.
 *
 * @param {FeedDate} target
 * @returns {number[]}
 */
function candidateDays(target) {
  const asGiven = dayNumber(target.year, target.month, target.day);
  if (target.year > LAST_JULIAN_YEAR) return [asGiven];
  const offset = julianToGregorianOffset(target.year, target.month);
  return offset === 0 ? [asGiven] : [asGiven, asGiven + offset];
}

/**
 * Whether a Wikidata year equals the feed's year. BCE years may be off by one,
 * depending on whether a year 0 is counted, so allow that.
 */
function sameYear(wikidataYear, feedYear) {
  return wikidataYear === feedYear || (feedYear < 0 && Math.abs(wikidataYear - feedYear) === 1);
}

/**
 * How well an item's dates match the event's date (signal 4).
 *
 * Scores:
 *   - 3: any day-precision date on the event's date. This is the only score
 *        that inception, dissolved, publication, and official opening dates
 *        (P571, P576, P577, P1619) count towards.
 *   - 2: the event's date falls inside a day-precision start–end range
 *        (P580 start time – P582 end time)
 *   - 1: only the year (or month) of a point in time (P585) matches, or the
 *        year falls inside a coarser start–end range
 *   - 0: no match
 *
 * `span` is the length in days of the range that matched (0 for point
 * matches), used to prefer the most specific of several candidates.
 *
 * BCE dates are only ever compared by year.
 *
 * @param {WikidataDate[]} dates
 * @param {FeedDate} target
 * @returns {{score: number, span: number}}
 */
function dateMatch(dates, target) {
  const byDay = target.year > 0;
  const candidates = candidateDays(target);
  const candidateMonths = candidates.map(monthOf);
  const toDay = (d) => dayNumber(d.year, d.month, d.day);

  // 3: exact day.
  if (byDay) {
    const exact = dates.some((d) => d.precision >= 11 && candidates.includes(toDay(d)));
    if (exact) return { score: 3, span: 0 };
  }

  // 2: inside a day-precision range.
  const starts = dates.filter((d) => d.property === "P580"); // start time
  const ends = dates.filter((d) => d.property === "P582"); // end time
  if (byDay) {
    const dayStarts = starts.filter((d) => d.precision >= 11).map(toDay);
    const dayEnds = ends.filter((d) => d.precision >= 11).map(toDay);
    if (dayStarts.length && dayEnds.length) {
      const start = Math.min(...dayStarts);
      const end = Math.max(...dayEnds);
      if (candidates.some((t) => start <= t && t <= end)) {
        return { score: 2, span: end - start };
      }
    }
  }

  // 1: year (and month, where known) only.
  const coarse = dates.some(
    (d) =>
      d.property === "P585" && // point in time
      d.precision >= 9 &&
      sameYear(d.year, target.year) &&
      // A Julian date's Gregorian equivalent can fall in the next month, so
      // accept the month of either candidate day.
      (!byDay || d.precision < 10 || candidateMonths.includes(d.month))
  );
  if (coarse) return { score: 1, span: 0 };

  const yearStarts = starts
    .filter((d) => d.precision >= 9)
    .map((d) => d.year);
  const yearEnds = ends
    .filter((d) => d.precision >= 9)
    .map((d) => d.year);
  if (yearStarts.length && yearEnds.length) {
    const start = Math.min(...yearStarts);
    const end = Math.max(...yearEnds);
    const inRange =
      (start <= target.year && target.year <= end) ||
      sameYear(start, target.year) ||
      sameYear(end, target.year);
    if (inRange) {
      return { score: 1, span: (end - start) * 365 };
    }
  }

  return { score: 0, span: 0 };
}

/**
 * Find the page about the event itself, if there is one.
 *
 * 1. Candidates are pages whose Wikidata dates match the event's date (signal 4);
 *    only the best-scoring candidates are kept.
 * 2. Among those, drop any candidate that another candidate is part of (P361),
 *    keeping the more specific event, e.g. a battle over its war (signal 3).
 * 3. Then prefer the shortest matching date range, then feed order.
 *
 * @param {FeedPage[]} pages
 * @param {(page: FeedPage) => ItemFacts} factsOf
 * @param {FeedDate} target
 * @returns {{page: FeedPage, score: number} | null}
 */
function findEventPage(pages, factsOf, target) {
  let candidates = pages
    .map((page, index) => ({ page, index, ...dateMatch(factsOf(page).dates, target) }))
    .filter((c) => c.score > 0);
  if (!candidates.length) return null;

  const best = Math.max(...candidates.map((c) => c.score));
  candidates = candidates.filter((c) => c.score === best);

  if (candidates.length > 1) {
    const narrower = candidates.filter(
      (c) =>
        !candidates.some(
          (other) => other !== c && factsOf(other.page).partOf.includes(c.page.wikibase_item)
        )
    );
    if (narrower.length) candidates = narrower;
  }

  candidates.sort((a, b) => a.span - b.span || a.index - b.index);
  return { page: candidates[0].page, score: best };
}

/**
 * Coordinates for a page: Wikipedia's (from the feed) first, then Wikidata's (P625, coordinate location).
 *
 * @param {FeedPage} page
 * @param {ItemFacts} facts
 * @returns {{lat: number, lon: number} | null}
 */
function coordinatesOf(page, facts) {
  if (page.coordinates) return { lat: page.coordinates.lat, lon: page.coordinates.lon };
  return facts.coordinates;
}

/**
 * Choose which of the event's pages to place dots at.
 *
 * - If there's an event page with coordinates, use only that.
 * - If there's an event page without coordinates, use the event's other pages
 *   that it names as its location (P276), else administrative area (P131),
 *   else country (P17) (signal 1).
 * - Otherwise keep the most specific places: drop any page that another page
 *   is located in (P276 location / P131 administrative area / P17 country).
 *   Everything left gets a dot.
 *
 * @param {FeedPage[]} pages
 * @param {FeedPage | null} eventPage
 * @param {(page: FeedPage) => ItemFacts} factsOf
 * @returns {{page: FeedPage, coordinates: {lat: number, lon: number}}[]}
 */
function pickCoordinatePages(pages, eventPage, factsOf) {
  const located = pages
    .map((page) => ({ page, coordinates: coordinatesOf(page, factsOf(page)) }))
    .filter((p) => p.coordinates);

  if (eventPage) {
    const own = located.find((p) => p.page === eventPage);
    if (own) return [own];

    const eventFacts = factsOf(eventPage);
    for (const key of ["location", "adminArea", "country"]) {
      const linked = located.filter((p) => eventFacts[key].includes(p.page.wikibase_item));
      if (linked.length) return linked;
    }
  }

  const containedBy = (inner) => {
    const f = factsOf(inner);
    return [...f.location, ...f.adminArea, ...f.country];
  };
  return located.filter(
    (p) =>
      !located.some(
        (other) => other !== p && containedBy(other.page).includes(p.page.wikibase_item)
      )
  );
}

/**
 * The page to show for an event (title, link, image).
 *
 * @param {FeedPage} page
 * @param {ItemFacts} facts
 * @returns {Page}
 */
function toPage(page, facts) {
  /** @type {Page} */
  const result = {
    pageid: page.pageid,
    title: page.titles?.normalized ?? page.title,
    url: page.content_urls.desktop.page,
  };

  if (page.thumbnail) {
    result.thumbnail = {
      source: page.thumbnail.source,
      width: page.thumbnail.width,
      height: page.thumbnail.height,
    };
  } else if (facts.image) {
    // P18 (image) comes back as http://commons.wikimedia.org/wiki/Special:FilePath/<file>.
    // Ask for a thumbnail roughly the size of the feed's (330px).
    result.thumbnail = { source: `${facts.image.replace(/^http:/, "https:")}?width=330` };
  }

  return result;
}

/**
 * Download events for all days of the year and save to JSON files.
 *
 * Creates one JSON file per month (01.json, 02.json, etc.) in the specified directory.
 * Each file contains all events from all days in that month.
 *
 * @param {string} directoryPath Path to directory relative to project root where JSON files will be saved
 * @returns {Promise<void>}
 */
export async function downloadEvents(directoryPath) {
  // Create the directory if it doesn't exist
  await mkdir(directoryPath, { recursive: true });

  let totalWikiCalls = 0;

  for (let monthNum = 1; monthNum <= MONTHS.length; monthNum++) {
    const monthInfo = MONTHS[monthNum - 1];
    const monthName = monthInfo.name;
    const numDays = monthInfo.days;
    /** @type {Event[]} */
    const monthEvents = [];

    console.log(`Downloading events for ${monthName}...`);

    for (let day = 1; day <= numDays; day++) {
      const [wikiCalls, events] = await getEventsOnDay(monthNum, day);
      totalWikiCalls += wikiCalls;
      monthEvents.push(...events);
    }

    // Save month's events to a JSON file
    const outputFile = path.join(directoryPath, `${String(monthNum).padStart(2, "0")}.json`);
    await writeFile(outputFile, JSON.stringify(monthEvents, null, 2));

    console.log(`  Saved ${monthEvents.length} events to ${outputFile}`);
  }

  console.log(`\nTotal wiki calls made: ${totalWikiCalls}`);
}

/**
 * Get the events that occurred on the given month and day using the Wikimedia onthisday API.
 *
 * @param {number} month A month number (1-indexed).
 * @param {number} day The day of the month.
 *
 * @returns {Promise<[number, Event[]]>} A promised tuple containing:
 *   - The number of requests made (1 to the onthisday feed, plus the Wikidata queries)
 *   - A list of Event objects, one per dot. Events with no coordinates are dropped.
 */
export async function getEventsOnDay(month, day) {
  if (month < 1 || month > MONTHS.length) {
    throw new RangeError(`${month} is not a valid month number`);
  } else if (day < 1 || day > MONTHS[month - 1].days) {
    throw new RangeError(`${day} is not a valid day number for ${MONTHS[month - 1].name}`);
  }

  const url = `https://api.wikimedia.org/feed/v1/wikipedia/en/onthisday/events/${month}/${day}`;

  const headers = {
    "User-Agent": `MapHistory/1.0 (${process.env.WIKI_USERNAME ?? ""})`
  };
  const response = await fetch(url, { headers });
  if (!response.ok) {
    throw new Error(`Request to ${url} failed: ${response.status} ${response.statusText}`);
  }
  const data = await response.json();
  const feedEvents = data.events ?? [];

  // Wikidata facts for every page on this day, grouped by event so that each
  // event's pages are queried together (needed for the containment check).
  const qidGroups = feedEvents
    .map((e) => [...new Set((e.pages ?? []).map((p) => p.wikibase_item).filter(Boolean))])
    .filter((group) => group.length > 0);
  const [wikidataRequests, facts] = await getItemFacts(qidGroups);
  const noFacts = emptyFacts();
  /** @param {FeedPage} page */
  const factsOf = (page) => facts.get(page.wikibase_item) ?? noFacts;

  /** @type {Event[]} */
  const eventsOnDay = [];
  const stats = {
    events: feedEvents.length,
    dropped: 0,
    byScore: { 3: 0, 2: 0, 1: 0 },
    noEventPage: 0
  };

  for (const event of feedEvents) {
    /** @type {FeedPage[]} */
    const pages = event.pages ?? [];
    if (!pages.length) {
      stats.dropped++;
      continue;
    }

    const target = { year: event.year, month, day };
    const found = findEventPage(pages, factsOf, target);
    const eventPage = found?.page ?? null;

    const dots = pickCoordinatePages(pages, eventPage, factsOf);
    if (!dots.length) {
      // This is a map: no coordinates, no event.
      stats.dropped++;
      continue;
    }

    if (found)
      stats.byScore[found.score]++;
    else
      stats.noEventPage++;

    // The page shown is the event page if found, else the feed's first page.
    // It need not be one of the pages the dots came from.
    const shownPage = eventPage ?? pages[0];
    const page = toPage(shownPage, factsOf(shownPage));

    for (const dot of dots) {
      eventsOnDay.push({
        day,
        month: MONTHS[month - 1].name,
        year: event.year,
        description: event.text ?? "",
        latitude: dot.coordinates.lat,
        longitude: dot.coordinates.lon,
        location: {
          title: dot.page.titles?.normalized ?? dot.page.title,
          wikibaseItem: dot.page.wikibase_item ?? null,
        },
        page,
      });
    }
  }

  // stderr, so it shows in the Framework console without ending up in the data.
  console.warn(
    `${MONTHS[month - 1].name} ${day}: ${stats.events} events, ${stats.dropped} dropped (no coordinates). ` +
      `Event page found by exact date: ${stats.byScore[3]}, date range: ${stats.byScore[2]}, ` +
      `year only: ${stats.byScore[1]}; none found: ${stats.noEventPage}.`
  );

  return [1 + wikidataRequests, eventsOnDay];
}
