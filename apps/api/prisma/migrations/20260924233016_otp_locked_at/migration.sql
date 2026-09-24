-- AlterTable
ALTER TABLE "otp_sessions" ADD COLUMN     "locked_at" TIMESTAMPTZ(3);

-- CreateIndex
CREATE INDEX "otp_sessions_mobile_locked_at_idx" ON "otp_sessions"("mobile", "locked_at");

