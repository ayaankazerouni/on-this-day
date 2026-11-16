import { getEventsOnDay } from "./events.js";

const today = new Date();
const day = today.getDate();
const month = today.getMonth() + 1;

const [, onthisday] = await getEventsOnDay(month, day);

process.stdout.write(JSON.stringify(onthisday));
