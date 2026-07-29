const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Stable date formatter — avoids SSR/client locale hydration mismatches. */
export function formatDate(iso: string, opts: { year?: boolean } = {}) {
  // Parse as UTC so server and client agree.
  //
  // Take only the date portion first: the API returns timestamps, and splitting the raw
  // value on "-" leaves "29T17:58:53.735Z" as the day, which Number() turns into NaN and
  // the UI renders as "Jul NaN". Every call site used to carry its own .slice(0, 10) to
  // avoid that — those are now redundant, and the next caller cannot get it wrong.
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  const month = MONTHS[(m ?? 1) - 1];
  return opts.year ? `${month} ${d}, ${y}` : `${month} ${d}`;
}
