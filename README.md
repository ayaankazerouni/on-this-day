# On This Day

A map of historical events sourced from Wikipedia's On This Day feed.

To run the site locally as an [Observable Notebook-Kit](https://observablehq.com/notebook-kit/) site:

Make sure you have Node v24 installed. I'm using v24.22.3.

* Install node dependencies: `npm install`
* Set `WIKI_USERNAME` to your Wikimedia username or your email address. It's sent to Wikimedia's APIs as contact information, and `npm run dev` and `npm run build` refuse to start without it.
* `npm run dev` to run the dev server at [https://localhost:5173](https://localhost:5173)

The data loader's output (the day's events) is cached in `src/.observable/cache` and keyed by the loader's code, not the date, so the local preview keeps showing the day it first ran. Run `npm run clean` to clear the cache and fetch the current day's events on the next page load. CI starts with no cache, so every build fetches the current day's events.

## Basemaps

The historical borders are a local snapshot of [aourednik/historical-basemaps](https://github.com/aourednik/historical-basemaps), refreshed by calling `map_utils/get-basemaps.sh`.
The build doesn't download them.

* `map_utils/get-basemaps.sh` downloads the GeoJSON, converts it to TopoJSON in `src/data/topo-data/` (via `convert-to-topojson.sh`), and indexes the result in `src/data/basemaps.json` (via `make-basemap-index.sh`). These data files are checked in to the repo. 
* `make-basemap-index.sh src/data/topo-data src/data/basemaps.json` re-indexes the existing files without downloading.
* `convert-to-topojson.sh` needs `geo2topo` (`npm install -g topojson-server`).

The scripts are written for macOS: `convert-to-topojson.sh` uses BSD `stat -f%z` for its size summary, which won't work on Linux.

