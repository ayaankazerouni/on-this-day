import { USER_AGENT } from "./user-agent.js";

const SPARQL_ENDPOINT = "https://query.wikidata.org/sparql";

/**
 * Most QIDs per SPARQL request. A batch can exceed this only if a single
 * event has more pages than this, since an event is never split across batches.
 */
const QIDS_PER_QUERY = 100;

/**
 * Issues a SPARQL query to the Wikidata query service.
 *
 * Sent as a URL-encoded POST (SPARQL 1.1 Protocol §2.1.2), which the query
 * service recommends for larger queries to avoid URL length limits. The facts
 * query lists up to QIDS_PER_QUERY QIDs, so it is large. POST results aren't
 * cached by the service, but each day's query is unique anyway.
 *
 * @see {@link https://www.mediawiki.org/wiki/Wikidata_Query_Service/User_Manual#SPARQL_endpoint}
 * @see {@link https://www.w3.org/TR/sparql11-protocol/#query-via-post-urlencoded}
 * @see {@link https://www.wikidata.org/wiki/Wikidata:SPARQL_query_service/A_gentle_introduction_to_the_Wikidata_Query_Service}
 *
 * @param {string} query A SPARQL query string
 */
export async function sparql(query) {
  const response = await fetch(SPARQL_ENDPOINT, {
    method: "POST",
    headers: {
      "User-Agent": USER_AGENT,
      Accept: "application/sparql-results+json",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ query, format: "json" }),
  });

  if (!response.ok) throw new Error(`SPARQL query failed: ${response.status}`);

  return (await response.json()).results.bindings;
}

/**
 * A date statement on a Wikidata item.
 *
 * @typedef {Object} WikidataDate
 * @property {"P585" | "P580" | "P582" | "P571" | "P576" | "P577" | "P1619"} property
 *   P585 (point in time), P580 (start time), P582 (end time), P571 (inception),
 *   P576 (dissolved, abolished or demolished date), P577 (publication date),
 *   or P1619 (date of official opening).
 * @property {number} year Negative for BCE.
 * @property {number} month 1-indexed. Meaningless when precision < 10.
 * @property {number} day Meaningless when precision < 11.
 * @property {number} precision 9 = year, 10 = month, 11 = day.
 */

/**
 * The facts about a Wikidata item that the event-selection rules use.
 *
 * @typedef {Object} ItemFacts
 * @property {WikidataDate[]} dates Non-deprecated date statements; see DATE_PROPERTIES.
 * @property {string[]} partOf QIDs from P361 (part of).
 * @property {string[]} location QIDs from P276 (location).
 * @property {string[]} adminArea QIDs from P131 (located in the administrative territorial entity).
 * @property {string[]} country QIDs from P17 (country).
 * @property {{lat: number, lon: number} | null} coordinates From P625 (coordinate location), if any.
 * @property {string | null} image Commons file URL (Special:FilePath) from P18 (image), if any.
 * @property {boolean} isPlace Whether the item is an instance of a place (see PLACE_CLASSES)
 * @property {boolean} isHuman Whether the item is an instance of a human (Q5)
 */

/** @returns {ItemFacts} Facts for an item we know nothing about. */
export function emptyFacts() {
  return {
    dates: [],
    partOf: [],
    location: [],
    adminArea: [],
    country: [],
    coordinates: null,
    image: null,
    isPlace: false,
    isHuman: false,
  };
}

/**
 * Date properties fetched for each item. The first three describe when
 * something happened. The rest describe when something was created, ended,
 * released, or opened; events.js only counts those on an exact-day match.
 */
const DATE_PROPERTIES = new Set([
  "P585", // point in time
  "P580", // start time
  "P582", // end time
  "P571", // inception
  "P576", // dissolved, abolished or demolished date
  "P577", // publication date
  "P1619", // date of official opening
]);

/** Which ItemFacts list each item-valued property goes into. */
const ITEM_PROPERTIES = {
  P361: "partOf", // part of
  P276: "location", // location
  P131: "adminArea", // located in the administrative territorial entity
  P17: "country", // country
};

/**
 * Classes whose instances (including instances of their subclasses)
 * count as places. A page about any of these is named by its own title.
 * Anything else with coordinates (e.g., oil pipeline, building) is named
 * by where it is.
 */
const PLACE_CLASSES = [
  "Q486972", // human settlement
  "Q56061", // administrative territorial entity
  "Q6256", // country
  "Q82794", // geographic region
  "Q271669", // landform
  "Q15324", // body of water
];

/**
 * Build the query for one batch of QIDs.
 *
 * Each UNION branch returns one kind of fact, with ?prop saying which. Using
 * UNION (rather than several OPTIONALs) keeps the result to one row per fact,
 * instead of one row per combination of facts.
 *
 * @param {string[]} qids
 */
function factsQuery(qids) {
  return `
    SELECT ?item ?prop ?value ?precision ?valueLabel WHERE {
      VALUES ?item { ${qids.map((q) => `wd:${q}`).join(" ")} }
      {
        # Dates, via the full statement so we get precision and can skip deprecated ranks.
        VALUES (?prop ?p ?psv) {
          ("P585" p:P585 psv:P585)  # point in time
          ("P580" p:P580 psv:P580)  # start time
          ("P582" p:P582 psv:P582)  # end time
          ("P571" p:P571 psv:P571)  # inception
          ("P576" p:P576 psv:P576)  # dissolved, abolished or demolished date
          ("P577" p:P577 psv:P577)  # publication date
          ("P1619" p:P1619 psv:P1619)  # date of official opening
        }
        ?item ?p ?statement .
        ?statement ?psv ?timeNode ;
                   wikibase:rank ?rank .
        ?timeNode wikibase:timeValue ?value ;
                  wikibase:timePrecision ?precision .
        FILTER(?rank != wikibase:DeprecatedRank)
      }
      UNION
      {
        # Everything else: best-rank ("truthy") values only.
        VALUES (?prop ?wdt) {
          ("P361" wdt:P361)  # part of
          ("P276" wdt:P276)  # location
          ("P131" wdt:P131)  # located in the administrative territorial entity
          ("P17" wdt:P17)    # country
          ("P625" wdt:P625)  # coordinate location
          ("P18" wdt:P18)    # image
        }
        ?item ?wdt ?value .
        # English name of item values (e.g. places); other values have none.
        OPTIONAL { ?value rdfs:label ?valueLabel . FILTER(LANG(?valueLabel) = "en") }
      }
      UNION
      {
        # Is the item a place? One row per place class that it's an instance of.
        # Walk up from the item's classes, never down from the place classes:
        # their subclass trees are huge. So ?value is filtered, not bound up
        # front (which would make the planner start there), and the path is
        # geared forward (subject to object).
        ?item wdt:P31 ?class .
        ?class wdt:P279* ?value .
        hint:Prior hint:gearing "forward" .
        FILTER(?value IN (${PLACE_CLASSES.map((q) => `wd:${q}`).join(", ")}))
        BIND("isPlace" AS ?prop)
      }
      UNION
      {
        # Is the item a person?
        ?item wdt:P31 ?value .
        FILTER(?value = wd:Q5)
        BIND("isHuman" as ?prop)
      }
    }`;
}

/** "http://www.wikidata.org/entity/Q43" -> "Q43"; null for anything else (e.g. unknown values). */
function toQid(uri) {
  return uri.match(/\/entity\/(Q\d+)$/)?.[1] ?? null;
}

/**
 * Parse an xsd:dateTime from the query service. Parsed by hand because
 * `Date` mishandles BCE years and years below 100.
 *
 * @param {string} value e.g. "2023-02-06T00:00:00Z" or "-0490-01-01T00:00:00Z"
 */
function parseTime(value) {
  const match = value.match(/^([+-]?)(\d+)-(\d{2})-(\d{2})/);
  if (!match) return null;
  const [, sign, y, m, d] = match;
  return { year: (sign === "-" ? -1 : 1) * Number(y), month: Number(m), day: Number(d) };
}

/**
 * Parse a WKT point from P625 (coordinate location). Points on other globes (e.g. the Moon) are
 * prefixed with the globe's URI and are ignored.
 *
 * @param {string} value e.g. "Point(37.032 37.174)" (longitude first)
 */
function parsePoint(value) {
  const match = value.match(/^Point\(([-\d.eE]+) ([-\d.eE]+)\)$/);
  return match ? { lon: Number(match[1]), lat: Number(match[2]) } : null;
}

/**
 * Pack groups of QIDs into batches of at most QIDS_PER_QUERY, never splitting
 * a group. A group larger than the limit gets a batch of its own.
 *
 * @param {string[][]} groups
 * @returns {string[][]}
 */
function packBatches(groups) {
  /** @type {Set<string>[]} */
  const batches = [];
  let current = new Set();

  for (const group of groups) {
    const added = group.filter((q) => !current.has(q)).length;
    if (current.size > 0 && current.size + added > QIDS_PER_QUERY) {
      batches.push(current);
      current = new Set();
    }
    group.forEach((q) => current.add(q));
  }
  if (current.size > 0) batches.push(current);

  return batches.map((b) => [...b]);
}

/**
 * Fetch the facts the event-selection rules need for a set of Wikidata items.
 *
 * QIDs are passed in groups, one per event, so that each event's pages are
 * queried together.
 *
 * @param {string[][]} qidGroups e.g. [["Q116691303", "Q43", "Q858"], ["Q1420045", "Q1973"]]
 * @returns {Promise<[number, Map<string, ItemFacts>, Map<string, string>]>} A promised tuple containing:
 *   - The number of requests made to the query service
 *   - A map from every requested QID to its facts (empty facts if none were found)
 *   - A map from QIDs named in the facts (location, admin area, etc.) to their English labels
 */
export async function getItemFacts(qidGroups) {
  const allQids = [...new Set(qidGroups.flat())];

  /** @type {Map<string, ItemFacts>} */
  const facts = new Map(allQids.map((q) => [q, emptyFacts()]));
  /** @type {Map<string, string>} */
  const labels = new Map();
  let requests = 0;

  // A QID shared by events in different batches is queried more than once.
  // Its own facts are the same each time, so keep only the first batch's.
  const fetched = new Set();

  for (const batch of packBatches(qidGroups)) {
    const rows = await sparql(factsQuery(batch));
    requests++;

    for (const row of rows) {
      // Get the list of facts for the current item.
      // It'll be appended to in this block.
      const qid = toQid(row.item.value);
      const item = facts.get(qid);
      if (!item) continue;

      const prop = row.prop.value;
      const value = row.value.value;

      if (fetched.has(qid)) continue;

      if (DATE_PROPERTIES.has(prop)) {
        const time = parseTime(value);
        if (time) {
          item.dates.push({
            ...time,
            property: prop,
            precision: Number(row.precision.value),
          });
        }
      } else if (prop in ITEM_PROPERTIES) {
        const valueQid = toQid(value);
        if (valueQid) {
          item[ITEM_PROPERTIES[prop]].push(valueQid);
          if (row.valueLabel) labels.set(valueQid, row.valueLabel.value);
        }
      } else if (prop === "P625") {
        // coordinate location
        item.coordinates ??= parsePoint(value);
      } else if (prop === "P18") {
        // image
        item.image ??= value;
      } else if (prop === "isPlace") {
        item.isPlace = true;
      } else if (prop === "isHuman") {
        item.isHuman = true;
      }
    }

    batch.forEach((q) => fetched.add(q));
  }

  return [requests, facts, labels];
}
