import type { AppConfig } from "./config.js";
import type { Db } from "./db.js";
import type { Clock } from "./lib/clock.js";
import { AuditService } from "./modules/audit/audit.service.js";
import { AuthService } from "./modules/auth/auth.service.js";
import { OtpService } from "./modules/auth/otp.service.js";
import { TokenService } from "./modules/auth/token.service.js";
import type { OTPProvider } from "./modules/otp/otp-provider.js";
import { RailwayRulesService } from "./modules/rules/railway-rules.service.js";

export interface AppContainer {
  config: AppConfig;
  db: Db;
  clock: Clock;
  otpProvider: OTPProvider;
  audit: AuditService;
  otp: OtpService;
  tokens: TokenService;
  auth: AuthService;
  rules: RailwayRulesService;
}

export function createContainer(deps: { config: AppConfig; db: Db; clock: Clock; otpProvider: OTPProvider }): AppContainer {
  const { config, db, clock, otpProvider } = deps;
  const audit = new AuditService(db);
  const otp = new OtpService(db, otpProvider, clock, audit, config);
  const tokens = new TokenService(db, clock, audit, config);
  const auth = new AuthService(db, clock, otp, tokens, audit);
  const rules = new RailwayRulesService(db, clock, audit);
  return { config, db, clock, otpProvider, audit, otp, tokens, auth, rules };
}
