import type { FastifyInstance } from "fastify";
import { notificationPreferencesSchema, updateProfileSchema, upsertIrctcAccountSchema } from "@tatkalflow/shared";
import type { AppContainer } from "../../container.js";
import type { User } from "../../generated/prisma/client.js";
import { Errors } from "../../lib/errors.js";
import { authenticate, requestContext, requireAuth } from "../../http/request-context.js";
import { AuditActions } from "../audit/audit.service.js";

function toProfile(user: User) {
  return {
    id: user.id,
    mobile: user.mobile,
    fullName: user.fullName,
    email: user.email,
    preferredLanguage: user.preferredLanguage,
    timezone: user.timezone,
    notificationPreferences: notificationPreferencesSchema.parse(user.notificationPreferences ?? {}),
    createdAt: user.createdAt.toISOString(),
  };
}

export async function meRoutes(app: FastifyInstance, c: AppContainer) {
  const auth = { preHandler: authenticate(c.tokens) };

  app.get("/api/me", auth, async (request) => {
    const { userId } = requireAuth(request);
    const user = await c.db.user.findFirst({ where: { id: userId, deletedAt: null } });
    if (!user) throw Errors.unauthorized();
    return toProfile(user);
  });

  app.patch("/api/me", auth, async (request) => {
    const { userId } = requireAuth(request);
    const input = updateProfileSchema.parse(request.body);
    const user = await c.db.user.update({ where: { id: userId }, data: input });
    const ctx = requestContext(request, c.config);
    await c.audit.record({
      action: AuditActions.PROFILE_UPDATED,
      userId,
      entityType: "user",
      entityId: userId,
      // Field names only — values (email etc.) stay out of the audit trail.
      metadata: { fields: Object.keys(input) },
      ipHash: ctx.ipHash,
      userAgent: ctx.userAgent,
    });
    return toProfile(user);
  });

  // ── IRCTC account: user ID only. There is no password field, by design. ──

  app.get("/api/me/irctc-account", auth, async (request) => {
    const { userId } = requireAuth(request);
    const account = await c.db.irctcAccount.findFirst({ where: { userId, deletedAt: null } });
    return {
      linked: Boolean(account),
      irctcUserId: account?.irctcUserId ?? null,
      keepSignedInPreference: account?.keepSignedInPreference ?? false,
      signInMode: "manual" as const,
      notice: "TatkalFlow never stores your IRCTC password. You will sign in on IRCTC yourself; IRCTC may ask you to authenticate again.",
    };
  });

  app.put("/api/me/irctc-account", auth, async (request) => {
    const { userId } = requireAuth(request);
    const input = upsertIrctcAccountSchema.parse(request.body);
    const account = await c.db.irctcAccount.upsert({
      where: { userId },
      create: { userId, irctcUserId: input.irctcUserId, keepSignedInPreference: input.keepSignedInPreference },
      update: { irctcUserId: input.irctcUserId, keepSignedInPreference: input.keepSignedInPreference, deletedAt: null },
    });
    const ctx = requestContext(request, c.config);
    await c.audit.record({
      action: AuditActions.IRCTC_ACCOUNT_LINKED,
      userId,
      entityType: "irctc_account",
      entityId: account.id,
      ipHash: ctx.ipHash,
      userAgent: ctx.userAgent,
    });
    return { linked: true, irctcUserId: account.irctcUserId, keepSignedInPreference: account.keepSignedInPreference, signInMode: "manual" as const };
  });

  app.delete("/api/me/irctc-account", auth, async (request, reply) => {
    const { userId } = requireAuth(request);
    const result = await c.db.irctcAccount.updateMany({
      where: { userId, deletedAt: null },
      data: { deletedAt: c.clock.now() },
    });
    if (result.count > 0) {
      const ctx = requestContext(request, c.config);
      await c.audit.record({ action: AuditActions.IRCTC_ACCOUNT_REMOVED, userId, entityType: "irctc_account", ipHash: ctx.ipHash, userAgent: ctx.userAgent });
    }
    return reply.code(204).send();
  });
}
