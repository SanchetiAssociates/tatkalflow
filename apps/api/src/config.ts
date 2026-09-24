import { z } from "zod";

const secret = (name: string) =>
  z.string().min(32, `${name} must be at least 32 characters (use \`openssl rand -base64 48\`)`);

const envSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    PORT: z.coerce.number().int().default(8787),
    HOST: z.string().default("127.0.0.1"),
    LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
    DATABASE_URL: z.string().url(),
    /** Max pooled connections. Keep low for PGlite; raise for PostgreSQL. */
    DATABASE_POOL_MAX: z.coerce.number().int().min(1).default(5),

    JWT_ACCESS_SECRET: secret("JWT_ACCESS_SECRET"),
    ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().min(60).max(3600).default(900),
    REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).max(90).default(30),

    OTP_HASH_PEPPER: secret("OTP_HASH_PEPPER"),
    IP_HASH_PEPPER: secret("IP_HASH_PEPPER"),
    OTP_PROVIDER: z.string().default("mock"),
    OTP_TTL_SECONDS: z.coerce.number().int().min(60).max(900).default(300),
    OTP_MAX_VERIFY_ATTEMPTS: z.coerce.number().int().min(1).max(10).default(5),
    OTP_RESEND_COOLDOWN_SECONDS: z.coerce.number().int().min(10).default(30),
    OTP_MAX_SENDS_PER_SESSION: z.coerce.number().int().min(1).max(10).default(3),
    OTP_MAX_REQUESTS_PER_MOBILE_PER_HOUR: z.coerce.number().int().min(1).default(5),
    OTP_MAX_REQUESTS_PER_IP_PER_HOUR: z.coerce.number().int().min(1).default(20),
    OTP_LOCKOUT_THRESHOLD: z.coerce.number().int().min(1).default(3),
    OTP_LOCKOUT_MINUTES: z.coerce.number().int().min(1).default(60),
    /** Development only: every mock OTP is this value, so no code is ever logged. */
    MOCK_OTP_FIXED_CODE: z
      .string()
      .regex(/^\d{6}$/)
      .optional(),

    CORS_ORIGINS: z
      .string()
      .default("http://localhost:5173")
      .transform((s) => s.split(",").map((o) => o.trim()).filter(Boolean)),
    COOKIE_SECURE: z
      .enum(["true", "false"])
      .default("true")
      .transform((v) => v === "true"),
    TRUST_PROXY: z
      .enum(["true", "false"])
      .default("false")
      .transform((v) => v === "true"),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV !== "production") return;
    if (env.OTP_PROVIDER === "mock") {
      ctx.addIssue({ code: "custom", path: ["OTP_PROVIDER"], message: "The mock OTP provider cannot run in production" });
    }
    if (env.MOCK_OTP_FIXED_CODE) {
      ctx.addIssue({ code: "custom", path: ["MOCK_OTP_FIXED_CODE"], message: "Must not be set in production" });
    }
    if (!env.COOKIE_SECURE) {
      ctx.addIssue({ code: "custom", path: ["COOKIE_SECURE"], message: "Secure cookies are required in production" });
    }
    const secrets = [env.JWT_ACCESS_SECRET, env.OTP_HASH_PEPPER, env.IP_HASH_PEPPER];
    if (new Set(secrets).size !== secrets.length) {
      ctx.addIssue({ code: "custom", message: "JWT_ACCESS_SECRET, OTP_HASH_PEPPER and IP_HASH_PEPPER must all differ" });
    }
  });

export type AppConfig = z.infer<typeof envSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    // Report which variables are wrong, never their values.
    const problems = parsed.error.issues.map((i) => `  - ${i.path.join(".") || "(env)"}: ${i.message}`).join("\n");
    throw new Error(`Invalid configuration:\n${problems}`);
  }
  return parsed.data;
}
