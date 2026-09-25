import { redactSensitive } from "@tatkalflow/shared";
import type { Db, Prisma } from "../../db.js";

export const AuditActions = {
  OTP_REQUESTED: "auth.otp_requested",
  OTP_RESENT: "auth.otp_resent",
  OTP_VERIFY_FAILED: "auth.otp_verify_failed",
  OTP_LOCKED: "auth.otp_locked",
  OTP_RATE_LIMITED: "auth.otp_rate_limited",
  USER_CREATED: "user.created",
  LOGIN_SUCCEEDED: "auth.login_succeeded",
  TOKEN_REFRESHED: "auth.token_refreshed",
  REFRESH_REUSE_DETECTED: "auth.refresh_reuse_detected",
  REFRESH_RACE: "auth.refresh_race",
  LOGOUT: "auth.logout",
  LOGOUT_ALL: "auth.logout_all",
  PROFILE_UPDATED: "user.profile_updated",
  IRCTC_ACCOUNT_LINKED: "irctc.account_linked",
  IRCTC_ACCOUNT_REMOVED: "irctc.account_removed",
  RULE_CHANGED: "rules.changed",
  PASSENGER_CREATED: "passenger.created",
  PASSENGER_UPDATED: "passenger.updated",
  PASSENGER_DELETED: "passenger.deleted",
  JOURNEY_CREATED: "journey.created",
  JOURNEY_DELETED: "journey.deleted",
  STATION_DATASET_IMPORTED: "stations.dataset_imported",
} as const;
export type AuditAction = (typeof AuditActions)[keyof typeof AuditActions];

export interface AuditEvent {
  action: AuditAction;
  userId?: string | null;
  actorType?: "USER" | "SYSTEM" | "ADMIN";
  entityType?: string;
  entityId?: string;
  metadata?: Record<string, unknown>;
  ipHash?: string | null;
  userAgent?: string | null;
}

type AuditWriter = Pick<Db, "auditLog"> | Prisma.TransactionClient;

export class AuditService {
  constructor(private readonly db: Db) {}

  /** Metadata is redacted before insert — callers cannot leak secrets by accident. */
  async record(event: AuditEvent, tx: AuditWriter = this.db): Promise<void> {
    await tx.auditLog.create({
      data: {
        action: event.action,
        userId: event.userId ?? null,
        actorType: event.actorType ?? (event.userId ? "USER" : "SYSTEM"),
        entityType: event.entityType ?? null,
        entityId: event.entityId ?? null,
        metadata: redactSensitive(event.metadata ?? {}) as Prisma.InputJsonValue,
        ipHash: event.ipHash ?? null,
        userAgent: event.userAgent?.slice(0, 512) ?? null,
      },
    });
  }
}
