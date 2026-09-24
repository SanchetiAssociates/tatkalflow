import { z } from "zod";

/**
 * Indian mobile numbers: 10 digits starting 6–9. Accepts common input forms
 * ("98200 12345", "+91 9820012345", "09820012345") and normalises to E.164.
 */
export const mobileNumberSchema = z
  .string()
  .trim()
  .transform((raw) => raw.replace(/[\s()-]/g, ""))
  .transform((raw) => raw.replace(/^(\+91|0091|91(?=\d{10}$)|0(?=\d{10}$))/, ""))
  .pipe(z.string().regex(/^[6-9]\d{9}$/, "Enter a valid 10-digit Indian mobile number"))
  .transform((digits) => `+91${digits}`);

export const OTP_LENGTH = 6;

export const otpCodeSchema = z
  .string()
  .trim()
  .regex(new RegExp(`^\\d{${OTP_LENGTH}}$`), `Enter the ${OTP_LENGTH}-digit code`);

export const requestOtpSchema = z.object({
  mobile: mobileNumberSchema,
});
export type RequestOtpInput = z.input<typeof requestOtpSchema>;

export const verifyOtpSchema = z.object({
  otpSessionId: z.uuid(),
  code: otpCodeSchema,
});
export type VerifyOtpInput = z.input<typeof verifyOtpSchema>;

export const requestOtpResponseSchema = z.object({
  otpSessionId: z.uuid(),
  expiresAt: z.iso.datetime(),
  resendAvailableAt: z.iso.datetime(),
});
export type RequestOtpResponse = z.infer<typeof requestOtpResponseSchema>;

export const authTokensResponseSchema = z.object({
  accessToken: z.string(),
  accessTokenExpiresAt: z.iso.datetime(),
  user: z.object({
    id: z.uuid(),
    mobile: z.string(),
    fullName: z.string().nullable(),
    isNewUser: z.boolean(),
  }),
});
export type AuthTokensResponse = z.infer<typeof authTokensResponseSchema>;
