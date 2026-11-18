/**
 * User-Agent for requests to Wikimedia APIs (the onthisday feed and the
 * Wikidata query service). Wikimedia asks clients to identify themselves and
 * give contact information; this gives a Wikimedia username.
 *
 * WIKI_USERNAME is checked before `npm run dev` and `npm run build` (see
 * check-env.js); the check here covers the data loader being run some other way.
 *
 * @see {@link https://foundation.wikimedia.org/wiki/Policy:Wikimedia_Foundation_User-Agent_Policy}
 */
const username = process.env.WIKI_USERNAME;
if (!username) throw new Error("WIKI_USERNAME is not set; see README.md");

export const USER_AGENT = `OnThisDayMap/1.0 (${username})`;
