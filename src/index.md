---
toc: false
---

<link rel="stylesheet" href="styles.css" >

```js
// Load components
import { worldMap } from "./components/map.js";
import {
  getGeoData,
  getClosestTimePeriod,
  yearToString
} from "./components/lib.js";
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
const date = new Date();
const month = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December"
][date.getMonth()];
const day = date.getDate();
const dateString = `${month} ${day}`;
```

# On This Day In History

<span style='font-size: 1.2em'>
  <em>${dateString}</em>
</span>

<div class="grid grid-cols-4">
  <div class="grid-colspan-3" id="map">
    ${map}
  </div>
  <div class="card event-info">
    ${chosenEvent
      ? html`<h2>${yearToString(chosenEvent.year)}</h2>
        <p>${chosenEvent.description}</p>
        <small>
          Showing borders from ${yearToString(closestYear)}, the closest available year.
          (<a href="https://github.com/aourednik/historical-basemaps">Source: historical-basemaps</a>)
        </small>`
      : html`<p>Click on an event to see the historical borders of the day.</p>`}
  </div>
</div>
