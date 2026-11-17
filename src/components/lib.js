/**
 * Split the input string into words (or phrases
 * if they are quoted).
 * @param {string} input
 * @returns {string[]} an array of strings
 */
export function tokenize(input) {
    const regex = /"([^"]*)"|\S+/g;
    let match;
    const tokens = [];

    while ((match = regex.exec(input)) !== null) {
        // If content was quoted, add the capture group
        //  to the list. Otherwise, add the match as is.
        tokens.push(match[1] ? match[1] : match[0]);
    }

    return tokens;
}

/**
 * @param {string} element An HTML string.
 * @returns The string with all HTML content stripped.
 */
export function stripHtml(element) {
  let tmp = document.createElement('div');
  tmp.innerHTML = element;
  return tmp.innerText || "";
}

/**
 * @param {string} text Plain text.
 * @returns The text with HTML special characters escaped, safe to insert as HTML.
 */
export function escapeHtml(text) {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * @typedef {Object} HistEvent
 * @property {number} year
 * @property {string} description
 */

/**
 * @param {string} searchTerms A search phrase
 * @returns {(e: HistEvent) => boolean} A predicate that checks if the event matches search terms.
 */
export function filterTest(searchTerms) {
  const lowerSearch = searchTerms.toLowerCase();

  return (e) => {
    const lowerDesc = e.description.toLowerCase();
    const tokenized = tokenize(lowerSearch);
    return tokenized.some(t => lowerDesc.includes(t));
  };
}

/**
 * Get the time period closest to the specified year.
 *
 * @param {number} year
 * @param {number[]} years A list of available time periods.
 * @returns {number} The closest time period to the specified year.
 */
export function getClosestTimePeriod(year, years) {
  return years.reduce((a, b) => {
    return Math.abs(b - year) < Math.abs(a - year) ? b : a;
  })
}

/**
 * Get the year as a string.
 * @param {number} year
 * @returns {string} A string representation of the year. For example:
 *  4 => "4 CE"
 *  -1 => "1 BCE"
 */
export function yearToString(year) {
  return year < 0 ? `${Math.abs(year)} BCE` : `${year} CE`;
}

/**
 * Load the TopoJSON for a historical basemap.
 *
 * The URL is a template literal so that Vite bundles every file in
 * data/topo-data/ and resolves the one named at runtime.
 *
 * @param {string} filename A file in data/topo-data/, e.g. "world_1914.json".
 * @returns {Promise<Object>} The basemap's TopoJSON.
 */
export async function getGeoData(filename) {
  const url = new URL(`../data/topo-data/${filename}`, import.meta.url);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Unable to load basemap: ${filename}`);
  return response.json();
}
