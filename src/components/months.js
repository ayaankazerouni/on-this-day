// No imports here: this module is shared by the browser (via lib.js) and by
// Node data loaders (via src/data/events.js), so it must not depend on
// browser-only (observablehq:stdlib) or Node-only (node:fs) modules.

/**
 * @example { name: "January", days: 31 }
 */
export const MONTHS = [
  { name: "January", days: 31 },
  { name: "February", days: 29 },
  { name: "March", days: 31 },
  { name: "April", days: 30 },
  { name: "May", days: 31 },
  { name: "June", days: 30 },
  { name: "July", days: 31 },
  { name: "August", days: 31 },
  { name: "September", days: 30 },
  { name: "October", days: 31 },
  { name: "November", days: 30 },
  { name: "December", days: 31 },
];
