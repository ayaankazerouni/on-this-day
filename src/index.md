---
toc: false
---

<link rel="stylesheet" href="styles.css" >

```js
// Load components
import { worldMap } from "./components/map.js";
import { timelineRuler } from "./components/timeline.js";
import {
  getGeoData,
  getClosestTimePeriod,
  yearToString
} from "./components/lib.js";
import { MONTHS } from "./components/months.js";
```

```js
// Load data
const basemaps = (await FileAttachment("data/time-periods.json").json()).years;
const onThisDay = (await FileAttachment("data/on-this-day.json").json());
const land = await FileAttachment("data/land-50m.json").json();
const timePeriods = basemaps.map(d => d.year);
```

```js
// Reactive variables
const dark = Generators.dark();
const width = Generators.width(document.querySelector("#map"));
```

```js
// The event selected by clicking a dot on the map (null if none).
// Mutable values can only be reassigned in the cell that declares them,
// so the setter lives here too.
const chosenEvent = Mutable(null);
const setChosenEvent = (e) => { chosenEvent.value = e; };
```

```js
// Basemap for the time period closest to the chosen event (none if nothing is chosen).
const closestYear = chosenEvent
  ? getClosestTimePeriod(+chosenEvent.year, timePeriods)
  : null;
const geodata = chosenEvent
  ? getGeoData(
      basemaps[timePeriods.indexOf(closestYear)].filename.replace("geojson", "json")
    )
  : null;
```

```js
const map = await worldMap({
  geodata,
  land,
  width,
  dark,
  events: onThisDay,
  chosenEvent,
  onSelect: setChosenEvent,
});
```

```js
// How far back today's events go, with the drawn basemap's era highlighted.
const ruler = timelineRuler({
  basemapYears: timePeriods,
  eventYears: onThisDay.map((d) => d.year),
  basemapYear: closestYear,
  eventYear: chosenEvent?.year ?? null,
  width,
  dark,
});
```

```js
// Take the date from the data, not the visitor's clock.
// The data is built once a day (in UTC), so the two can disagree.
// Fall back to the visitor's date only if there's no data.
const today = new Date();
const month = onThisDay[0]?.month ?? MONTHS[today.getMonth()].name;
const day = onThisDay[0]?.day ?? today.getDate();
const dateString = `${month} ${day}`;
```
# On This Day In History

<span style='font-size: 1.2em'>
  <em>${dateString} (UTC)</em>
</span>

<div class="grid grid-cols-4">
  <div class="grid-colspan-1">
    <div class="card event-info">
      ${chosenEvent
        ? html`${chosenEvent.page?.thumbnail
              ? html`<a href=${chosenEvent.page.url} target="_blank" rel="noopener">
                  <img
                    class="event-thumbnail"
                    src=${chosenEvent.page.thumbnail.source}
                    alt=${chosenEvent.page.title}
                    loading="lazy">
                </a>`
              : ""}
          <h2>${chosenEvent.month} ${chosenEvent.day}, ${yearToString(chosenEvent.year)}</h2>
          <p>${chosenEvent.description}</p>
          ${chosenEvent.page
            ? html`<p><a href=${chosenEvent.page.url} target="_blank" rel="noopener">
                ${chosenEvent.page.title} on Wikipedia ↗</a></p>`
            : ""}`
        : html`<p>Click on an event to see the historical borders of the day.</p>`}
    </div>
    <p class="attribution">
      Events from <a href="https://en.wikipedia.org/" target="_blank" rel="noopener">Wikipedia</a>
      · <a href="https://www.wikidata.org/" target="_blank" rel="noopener">Powered by Wikidata</a>
    </p>
  </div>
  <div class="grid-colspan-3" id="map">
    ${ruler}
    ${map}
  </div>
</div>
