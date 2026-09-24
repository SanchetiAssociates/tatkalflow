import "dotenv/config";
import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";
import { createContainer } from "./container.js";
import { createPrisma } from "./db.js";
import { systemClock } from "./lib/clock.js";
import { createOtpProvider } from "./modules/otp/otp-provider.js";

const config = loadConfig();
const db = createPrisma(config.DATABASE_URL, config.DATABASE_POOL_MAX);
const otpProvider = createOtpProvider(config.OTP_PROVIDER, { mockFixedCode: config.MOCK_OTP_FIXED_CODE });
const app = await buildApp(createContainer({ config, db, clock: systemClock, otpProvider }));

async function shutdown(signal: string) {
  app.log.info({ signal }, "shutting down");
  await app.close();
  await db.$disconnect();
  process.exit(0);
}
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

await app.listen({ port: config.PORT, host: config.HOST });
