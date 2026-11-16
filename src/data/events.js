import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { MONTHS } from "../components/lib";

/**
 * @typedef {Object} PageImage
 * @property {string} source
 * @property {number} width
 * @property {number} height
 */

/**
 * @typedef {Object} Page
 * @property {string} pageid
 * @property {string} title
 * @property {PageImage} thumbnail
 * @property {string} url
 */

/**
 * @typedef {Object} Event
 * @property {number} day
 * @property {string} month
 * @property {number} year
 * @property {string} description
 * @property {number} longitude
 * @property {number} latitude
 * @property {Page} [page]
 */

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
 *   - The number of requests made to the API (always 1 for this endpoint)
 *   - A list of Event objects with coordinates from linked pages
 */
export async function getEventsOnDay(month, day) {
  if (month < 1 || month > MONTHS.length) {
    throw new RangeError(`${month} is not a valid month number`);
  } else if (day < 1 || day > MONTHS[month - 1].days) {
    throw new RangeError(`${day} is not a valid day number for ${MONTHS[month - 1].name}`);
  }

  const url = `https://api.wikimedia.org/feed/v1/wikipedia/en/onthisday/events/${month}/${day}`;

  const headers = { "User-Agent": `MapHistory/1.0 (${process.env.WIKI_USERNAME ?? ""})` };
  const response = await fetch(url, { headers });
  if (!response.ok) {
    throw new Error(`Request to ${url} failed: ${response.status} ${response.statusText}`);
  }
  const data = await response.json();

  /** @type {Event[]} */
  const eventsOnDay = [];

  // The API returns an 'events' array
  for (const event of data.events ?? []) {
    const year = event.year;
    const description = event.text ?? "";

    // Look through the pages array for any with coordinates
    for (const page of event.pages ?? []) {
      const coordinates = page.coordinates;
      if (coordinates) {
        /** @type {Event} */
        const eventObj = {
          day: day,
          month: MONTHS[month - 1].name,
          year: year,
          description: description,
          latitude: coordinates.lat,
          longitude: coordinates.lon,
          page: {
            pageid: page.pageid,
            title: page.title,
            thumbnail: page.thumbnail,
            url: page.content_urls.desktop.page,
          },
        };
        eventsOnDay.push(eventObj);
      }
    }

    // TODO: Of the pages in this event:
    // 1. Identify which one is the "event" page, i.e., the best
    // target for the summary image and link when the event is selected.
    // 2. Figure out which is (are) the best target(s) from which to draw
    // coordinates. If the "event" page is identified and has coordinates,
    // that should be the target.
  }

  return [1, eventsOnDay];
}
