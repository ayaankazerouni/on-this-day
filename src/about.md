---
toc: false
theme: ['slate', 'wide']
---

# About 

<link rel="stylesheet" href="./styles.css"/>

Just for fun, a little map of Wikipedia's On This Day Events.
[Here's the code.](https://github.com/ayaankazerouni/map-history)

## The data

The map shows two types of data, each with its own caveats:

**Historical borders**, collected and made available by André Ourednik ([`aourednik/historical-basemaps`](https://github.com/aourednik/historical-basemaps)).

Ourednik emphasises:

> When using the data, keep in mind that
> * historical boundaries are even more disputed than contemporary ones, that
> * the actual concept of territory and national boundary becomes meaningful, in Europe, only since the [Peace of Westphalia](https://en.wikipedia.org/wiki/Peace_of_Westphalia) (1648), that
> * areas of civilizations actually overlap, especially in ancient history, and that
> * overlaying these ancient vector maps on contemporary physical maps can be misleading; rivers, lakes, shorelines _do_ change very much over millennia; think for instance about the evolution of the [Aral Sea](https://en.wikipedia.org/wiki/Aral_Sea) since the 1980s.

**"On this day" events**, obtained from the Wikimedia `onthisday` Feed API. See the code for this on GitHub ([`ayaankazerouni/map-history`](https://github.com/ayaankazerouni/map-history)).
Only events with coordinates (locations) were included.
If an event contained multiple coordinates, the event is included twice, once at each place.
