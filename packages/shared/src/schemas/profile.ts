import { z } from "zod";

export const SUPPORTED_LANGUAGES = ["en", "hi", "mr", "gu", "ta", "te", "kn", "bn"] as const;
export const DEFAULT_TIMEZONE = "Asia/Kolkata";

const ianaTimezone = z.string().refine(
  (tz) => {
    try {
      new Intl.DateTimeFormat("en", { timeZone: tz });
      return true;
    } catch {
      return false;
    }
  },
  { message: "Unknown timezone" },
);

export const notificationPreferencesSchema = z.object({
  push: z.boolean().default(true),
  email: z.boolean().default(false),
  sms: z.boolean().default(false),
});
export type NotificationPreferences = z.infer<typeof notificationPreferencesSchema>;

export const updateProfileSchema = z
  .object({
    fullName: z.string().trim().min(1).max(100),
    email: z.email().max(254).nullable(),
    preferredLanguage: z.enum(SUPPORTED_LANGUAGES),
    timezone: ianaTimezone,
    notificationPreferences: notificationPreferencesSchema,
  })
  .partial()
  .strict();
export type UpdateProfileInput = z.input<typeof updateProfileSchema>;

/**
 * IRCTC account link. V1 stores the user ID only — there is deliberately no
 * password field anywhere in the schema or API.
 */
export const irctcUserIdSchema = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9_.-]{3,35}$/, "IRCTC User ID can contain letters, numbers, _ . - (3–35 characters)");

export const upsertIrctcAccountSchema = z
  .object({
    irctcUserId: irctcUserIdSchema,
    keepSignedInPreference: z.boolean().default(false),
  })
  .strict();
export type UpsertIrctcAccountInput = z.input<typeof upsertIrctcAccountSchema>;
