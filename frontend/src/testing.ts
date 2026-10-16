// Follows APP_ENV (set at build time in vite.config.ts): on in dev, always off in prod. While on:
// - opening Today doesn't mark the outfit of the day as seen (the Home ring, glow, sweep and badge stay),
// - the Home card's daily entrance animation replays on every visit instead of once a day.
const appEnv = (import.meta as unknown as { env?: { VITE_APP_ENV?: string } }).env?.VITE_APP_ENV;
export const KEEP_OOTD_UNSEEN_FOR_TESTING = appEnv === "dev";
