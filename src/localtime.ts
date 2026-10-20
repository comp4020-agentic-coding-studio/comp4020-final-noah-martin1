// What time it is where a cook is, for the globe: "7:42 pm · dinner". The
// built-in cities (src/live.ts) each carry an IANA time zone, so daylight
// saving is right; a device location takes its nearest listed city's zone,
// or failing that, an hour per 15° of longitude (sea time, close enough to
// say whether it's lunch or dinner).

import { CITIES, nearestCity } from "./live.ts";

const ZONES: Record<string, string> = {
  sydney: "Australia/Sydney",
  melbourne: "Australia/Melbourne",
  brisbane: "Australia/Brisbane",
  perth: "Australia/Perth",
  adelaide: "Australia/Adelaide",
  canberra: "Australia/Sydney",
  hobart: "Australia/Hobart",
  darwin: "Australia/Darwin",
  auckland: "Pacific/Auckland",
  wellington: "Pacific/Auckland",
  christchurch: "Pacific/Auckland",
  honolulu: "Pacific/Honolulu",
  singapore: "Asia/Singapore",
  "kuala-lumpur": "Asia/Kuala_Lumpur",
  jakarta: "Asia/Jakarta",
  bangkok: "Asia/Bangkok",
  hanoi: "Asia/Ho_Chi_Minh",
  "ho-chi-minh-city": "Asia/Ho_Chi_Minh",
  manila: "Asia/Manila",
  "hong-kong": "Asia/Hong_Kong",
  taipei: "Asia/Taipei",
  shanghai: "Asia/Shanghai",
  beijing: "Asia/Shanghai",
  seoul: "Asia/Seoul",
  tokyo: "Asia/Tokyo",
  osaka: "Asia/Tokyo",
  mumbai: "Asia/Kolkata",
  delhi: "Asia/Kolkata",
  bengaluru: "Asia/Kolkata",
  kolkata: "Asia/Kolkata",
  karachi: "Asia/Karachi",
  dhaka: "Asia/Dhaka",
  colombo: "Asia/Colombo",
  dubai: "Asia/Dubai",
  "tel-aviv": "Asia/Jerusalem",
  amman: "Asia/Amman",
  beirut: "Asia/Beirut",
  istanbul: "Europe/Istanbul",
  cairo: "Africa/Cairo",
  casablanca: "Africa/Casablanca",
  lagos: "Africa/Lagos",
  accra: "Africa/Accra",
  "addis-ababa": "Africa/Addis_Ababa",
  nairobi: "Africa/Nairobi",
  johannesburg: "Africa/Johannesburg",
  "cape-town": "Africa/Johannesburg",
  london: "Europe/London",
  manchester: "Europe/London",
  edinburgh: "Europe/London",
  dublin: "Europe/Dublin",
  paris: "Europe/Paris",
  lyon: "Europe/Paris",
  amsterdam: "Europe/Amsterdam",
  brussels: "Europe/Brussels",
  berlin: "Europe/Berlin",
  munich: "Europe/Berlin",
  zurich: "Europe/Zurich",
  vienna: "Europe/Vienna",
  prague: "Europe/Prague",
  warsaw: "Europe/Warsaw",
  copenhagen: "Europe/Copenhagen",
  stockholm: "Europe/Stockholm",
  oslo: "Europe/Oslo",
  helsinki: "Europe/Helsinki",
  reykjavik: "Atlantic/Reykjavik",
  madrid: "Europe/Madrid",
  barcelona: "Europe/Madrid",
  lisbon: "Europe/Lisbon",
  rome: "Europe/Rome",
  milan: "Europe/Rome",
  athens: "Europe/Athens",
  "new-york": "America/New_York",
  boston: "America/New_York",
  chicago: "America/Chicago",
  austin: "America/Chicago",
  miami: "America/New_York",
  "los-angeles": "America/Los_Angeles",
  "san-francisco": "America/Los_Angeles",
  seattle: "America/Los_Angeles",
  toronto: "America/Toronto",
  montreal: "America/Toronto",
  vancouver: "America/Vancouver",
  "mexico-city": "America/Mexico_City",
  bogota: "America/Bogota",
  lima: "America/Lima",
  "sao-paulo": "America/Sao_Paulo",
  "rio-de-janeiro": "America/Sao_Paulo",
  santiago: "America/Santiago",
  "buenos-aires": "America/Argentina/Buenos_Aires",
};

// A city given by name ("Rome", or "near Rome" for a device location).
const BY_NAME = new Map(CITIES.map((c) => [c.name.toLowerCase(), c]));

export function zoneFor(city: string, lat: number | null, lng: number | null): string | null {
  const named = BY_NAME.get(city.replace(/^near /, "").toLowerCase());
  const c = named ?? (lat !== null && lng !== null ? nearestCity(lat, lng) : undefined);
  return c ? (ZONES[c.key] ?? null) : null;
}

export type Mealtime = "breakfast" | "lunch" | "afternoon" | "dinner" | "late" | "night";

// The meal a local hour belongs to: a cook at 7 pm is making dinner.
export function mealtime(hour: number): Mealtime {
  if (hour >= 5 && hour < 11) return "breakfast";
  if (hour >= 11 && hour < 15) return "lunch";
  if (hour >= 15 && hour < 17) return "afternoon";
  if (hour >= 17 && hour < 22) return "dinner";
  if (hour >= 22 || hour < 1) return "late";
  return "night";
}

export const MEAL_LABEL: Record<Mealtime, string> = {
  breakfast: "breakfast",
  lunch: "lunch",
  afternoon: "afternoon snack",
  dinner: "dinner",
  late: "late supper",
  night: "middle of the night",
};

export interface LocalTime {
  // "7:42 pm"
  time: string;
  hour: number;
  meal: Mealtime;
  // the zone's offset from UTC right now, in minutes (so the page can keep
  // the clock ticking without asking again)
  offset: number;
}

const formats = new Map<string, Intl.DateTimeFormat>();
function format(zone: string): Intl.DateTimeFormat {
  let f = formats.get(zone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-AU", { timeZone: zone, hour: "numeric", minute: "2-digit", hourCycle: "h23", timeZoneName: "longOffset" });
    formats.set(zone, f);
  }
  return f;
}

export function clockAt(minutes: number): string {
  const h = Math.floor(minutes / 60) % 24;
  const m = minutes % 60;
  return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h < 12 ? "am" : "pm"}`;
}

export function localTime(city: string, lat: number | null, lng: number | null, now = new Date()): LocalTime | null {
  const zone = zoneFor(city, lat, lng);
  let offset: number;
  if (zone) {
    const parts = format(zone).formatToParts(now);
    const off = parts.find((p) => p.type === "timeZoneName")?.value ?? "GMT";
    const m = /GMT([+-])(\d{2}):(\d{2})/.exec(off);
    offset = m ? (m[1] === "-" ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3])) : 0;
  } else if (lng !== null) {
    offset = Math.round(lng / 15) * 60;
  } else {
    return null;
  }
  const minutes = (((now.getUTCHours() * 60 + now.getUTCMinutes() + offset) % 1440) + 1440) % 1440;
  const hour = Math.floor(minutes / 60);
  return { time: clockAt(minutes), hour, meal: mealtime(hour), offset };
}
