const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Stable date formatter — avoids SSR/client locale hydration mismatches. */
export function formatDate(iso: string, opts: { year?: boolean } = {}) {
  // Parse as UTC so server and client agree.
  const [y, m, d] = iso.split("-").map(Number);
  const month = MONTHS[(m ?? 1) - 1];
  return opts.year ? `${month} ${d}, ${y}` : `${month} ${d}`;
}
