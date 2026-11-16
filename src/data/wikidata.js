const SPARQL_ENDPOINT = "https://query.wikidata.org/sparql";

/**
 * Most QIDs per SPARQL request. A batch can exceed this only if a single
 * event has more pages than this, since an event is never split across batches.
 */
const QIDS_PER_QUERY = 100;

/**
 * Issues a SPARQL query to the Wikidata query service
 * 
 * @see {@link https://www.wikidata.org/wiki/Wikidata:SPARQL_query_service/A_gentle_introduction_to_the_Wikidata_Query_Service}
 *
 * @param {string} query A SPARQL query string
 */
export async function sparql(query) {
  const url = `${SPARQL_ENDPOINT}?${new URLSearchParams({ query, format: "json" })}`;

  const response = await fetch(url, {
    headers: {
      "User-Agent": `MapHistory/1.0 (${process.env.WIKI_USERNAME ?? ""})`,
      Accept: "application/sparql-results+json",
    },
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
    SELECT ?item ?prop ?value ?precision WHERE {
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
 * Fetch the facts the event-selection rules need for a set of Wikidata items.
 *
 * @param {string[]} qids e.g. ["Q116691303", "Q43"]
 * @returns {Promise<[number, Map<string, ItemFacts>]>} A promised tuple containing:
 *   - The number of requests made to the query service
 *   - A map from every requested QID to its facts (empty facts if none were found)
 */
export async function getItemFacts(qids) {
  /** @type {Map<string, ItemFacts>} */
  const facts = new Map(qids.map((q) => [q, emptyFacts()]));
  let requests = 0;

  for (let i = 0; i < qids.length; i += QIDS_PER_QUERY) {
    const batch = qids.slice(i, i + QIDS_PER_QUERY);
    const rows = await sparql(factsQuery(batch));
    requests++;

    for (const row of rows) {
      // Get the list of facts for the current item.
      // It'll be appended to in this block.
      const item = facts.get(toQid(row.item.value));
      if (!item) continue;

      const prop = row.prop.value;
      const value = row.value.value;

      if (DATE_PROPERTIES.has(prop)) {
        const time = parseTime(value);
        if (time) {
          item.dates.push({
            ...time,
            property: prop,
            precision: Number(row.precision.value)
          });
        }
      } else if (prop in ITEM_PROPERTIES) {
        const qid = toQid(value);
        if (qid) {
          item[ITEM_PROPERTIES[prop]].push(qid);
        }
      } else if (prop === "P625") { // coordinate location
        item.coordinates ??= parsePoint(value);
      } else if (prop === "P18") { // image
        item.image ??= value;
      }
    }
  }

  return [requests, facts];
}
