import { z } from "zod";

export const GENDERS = ["MALE", "FEMALE", "TRANSGENDER"] as const;
export const BERTH_PREFERENCES = ["NO_PREFERENCE", "LOWER", "MIDDLE", "UPPER", "SIDE_LOWER", "SIDE_UPPER"] as const;
export const FOOD_PREFERENCES = ["NO_PREFERENCE", "VEG", "NON_VEG"] as const;

export type Gender = (typeof GENDERS)[number];
export type BerthPreference = (typeof BERTH_PREFERENCES)[number];
export type FoodPreference = (typeof FOOD_PREFERENCES)[number];

export const GENDER_LABELS: Record<Gender, string> = { MALE: "Male", FEMALE: "Female", TRANSGENDER: "Transgender" };
export const BERTH_LABELS: Record<BerthPreference, string> = {
  NO_PREFERENCE: "No preference",
  LOWER: "Lower",
  MIDDLE: "Middle",
  UPPER: "Upper",
  SIDE_LOWER: "Side lower",
  SIDE_UPPER: "Side upper",
};
export const FOOD_LABELS: Record<FoodPreference, string> = { NO_PREFERENCE: "No preference", VEG: "Veg", NON_VEG: "Non-veg" };

/** Soft cap on saved profiles per account (abuse guard, not a railway rule). */
export const MAX_SAVED_PASSENGERS = 50;

/**
 * Letters (any script), combining marks, spaces and . ' - only. Railway
 * name-length limits are NOT enforced here; they belong to the rules service
 * once verified.
 */
const passengerName = z
  .string()
  .trim()
  .transform((s) => s.replace(/\s+/g, " "))
  .pipe(
    z
      .string()
      .min(1, "Enter the passenger's name")
      .max(100, "Name is too long")
      .regex(/^[\p{L}\p{M}][\p{L}\p{M} .'-]*$/u, "Use letters, spaces, . ' or - only"),
  );

/**
 * No identity-document fields: none are collected at this stage.
 * `seniorCitizenOptIn` and `childBerthOptIn` record the user's wish only;
 * whether they apply is decided by current (verified) rules at booking time.
 */
const passengerFields = {
  name: passengerName,
  // An empty form field must not coerce to 0: blank → "Enter the age".
  age: z.preprocess(
    (v) => (v === "" || v === null || (typeof v === "string" && v.trim() === "") ? undefined : v),
    z.coerce.number({ error: "Enter the age" }).int("Age must be a whole number").min(0, "Age can't be negative").max(125, "Check the age"),
  ),
  gender: z.enum(GENDERS, { message: "Select a gender" }),
  berthPreference: z.enum(BERTH_PREFERENCES),
  foodPreference: z.enum(FOOD_PREFERENCES),
  seniorCitizenOptIn: z.boolean(),
  childBerthOptIn: z.boolean(),
};

export const passengerInputSchema = z
  .object({
    ...passengerFields,
    berthPreference: passengerFields.berthPreference.default("NO_PREFERENCE"),
    foodPreference: passengerFields.foodPreference.default("NO_PREFERENCE"),
    seniorCitizenOptIn: passengerFields.seniorCitizenOptIn.default(false),
    childBerthOptIn: passengerFields.childBerthOptIn.default(true),
  })
  .strict();
export type PassengerInput = z.input<typeof passengerInputSchema>;

/**
 * Built from the default-free fields: a partial update must only touch the
 * fields the client sent (a `.partial()` of the input schema would re-apply
 * defaults and silently reset other preferences).
 */
export const passengerUpdateSchema = z.object(passengerFields).partial().strict();
export type PassengerUpdate = z.input<typeof passengerUpdateSchema>;

export interface PassengerDto {
  id: string;
  name: string;
  age: number;
  gender: Gender;
  berthPreference: BerthPreference;
  foodPreference: FoodPreference;
  seniorCitizenOptIn: boolean;
  childBerthOptIn: boolean;
  lastUsedAt: string | null;
  createdAt: string;
  updatedAt: string;
}
