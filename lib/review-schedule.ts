export type ReviewSchedule = Record<string, { stage: number; due: number }>;
export function parseReviewSchedule(value: unknown): ReviewSchedule {
  const clean: ReviewSchedule = Object.create(null);
  if (!value || typeof value !== 'object' || Array.isArray(value)) return clean;
  for (const [key, item] of Object.entries(value)) {
    if (!item || typeof item !== 'object') continue;
    const { stage, due } = item as { stage: number; due: number };
    if (Number.isInteger(stage) && stage >= 0 && stage <= 5 && Number.isFinite(due) && due >= 0) clean[key] = { stage, due };
  }
  return clean;
}
