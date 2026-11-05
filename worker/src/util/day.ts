export function utcDay(now: number = Date.now()): string {
  return new Date(now).toISOString().slice(0, 10).replace(/-/g, "");
}

/** Compact UTC hour stamp, e.g. `2026110514`, for hourly rate buckets. */
export function utcHour(now: number = Date.now()): string {
  return new Date(now).toISOString().slice(0, 13).replace(/[-T]/g, "");
}
