/**
 * Operational settings / feature flags (not railway rules — those live in
 * rules/railway-rules.json and are applied by `rules:sync`).
 */
export const SEED_SETTINGS = [
  { key: "feature.web_push", value: true, description: "Enable Web Push reminders" },
  { key: "feature.email_notifications", value: false, description: "Enable email reminders (needs provider)" },
  { key: "feature.sms_notifications", value: false, description: "Enable SMS reminders (needs provider)" },
  { key: "irctc.adapter", value: "manual", description: "Active IRCTC adapter. V1 supports only: manual" },
];
