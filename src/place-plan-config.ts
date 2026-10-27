// Change this single value back to 120_000 after the first verified test if desired.
export const PLACE_PLAN_LIFETIME_MS = 300_000;
export const MAX_PLACE_PLAN_OBSERVATION_SPAN_MS = PLACE_PLAN_LIFETIME_MS + 60_000;

export const remainingPlanSeconds = (expiresAt: string, now = Date.now()): number =>
  Math.max(0, Math.ceil((Date.parse(expiresAt) - now) / 1000));
