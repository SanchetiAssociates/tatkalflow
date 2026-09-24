-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "OtpSessionStatus" AS ENUM ('PENDING', 'VERIFIED', 'EXPIRED', 'LOCKED');

-- CreateEnum
CREATE TYPE "Gender" AS ENUM ('MALE', 'FEMALE', 'TRANSGENDER');

-- CreateEnum
CREATE TYPE "BerthPreference" AS ENUM ('NO_PREFERENCE', 'LOWER', 'MIDDLE', 'UPPER', 'SIDE_LOWER', 'SIDE_UPPER');

-- CreateEnum
CREATE TYPE "FoodPreference" AS ENUM ('NO_PREFERENCE', 'VEG', 'NON_VEG');

-- CreateEnum
CREATE TYPE "Quota" AS ENUM ('TATKAL', 'PREMIUM_TATKAL', 'GENERAL');

-- CreateEnum
CREATE TYPE "JourneyState" AS ENUM ('DRAFT', 'SCHEDULED', 'PREPARING', 'READY', 'TATKAL_OPEN', 'USER_ACTION_REQUIRED', 'PAYMENT_PENDING', 'CONFIRMED', 'FAILED', 'EXPIRED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "BookingStatus" AS ENUM ('SCHEDULED', 'PREPARING', 'USER_ACTION_REQUIRED', 'PAYMENT_PENDING', 'BOOKED', 'RAC', 'WAITLISTED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ScheduledJobKind" AS ENUM ('PREPARATION', 'NOTIFY_T_MINUS_24H', 'NOTIFY_T_MINUS_15M', 'NOTIFY_T_MINUS_5M', 'NOTIFY_T_MINUS_1M', 'OPENING');

-- CreateEnum
CREATE TYPE "ScheduledJobStatus" AS ENUM ('PENDING', 'QUEUED', 'RUNNING', 'COMPLETED', 'FAILED', 'DEAD_LETTER', 'CANCELLED');

-- CreateEnum
CREATE TYPE "NotificationChannel" AS ENUM ('PUSH', 'EMAIL', 'SMS', 'IN_APP');

-- CreateEnum
CREATE TYPE "NotificationStatus" AS ENUM ('PENDING', 'SENT', 'FAILED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "RuleStatus" AS ENUM ('DRAFT', 'ACTIVE', 'RETIRED');

-- CreateEnum
CREATE TYPE "AuditActorType" AS ENUM ('USER', 'SYSTEM', 'ADMIN');

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('USER', 'ADMIN');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "mobile" VARCHAR(32) NOT NULL,
    "mobile_verified_at" TIMESTAMPTZ(3),
    "full_name" VARCHAR(100),
    "email" VARCHAR(254),
    "preferred_language" VARCHAR(8) NOT NULL DEFAULT 'en',
    "timezone" VARCHAR(64) NOT NULL DEFAULT 'Asia/Kolkata',
    "notification_preferences" JSONB NOT NULL DEFAULT '{"push":true,"email":false,"sms":false}',
    "role" "UserRole" NOT NULL DEFAULT 'USER',
    "last_login_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "otp_sessions" (
    "id" UUID NOT NULL,
    "mobile" VARCHAR(32) NOT NULL,
    "code_hash" VARCHAR(128) NOT NULL,
    "status" "OtpSessionStatus" NOT NULL DEFAULT 'PENDING',
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "max_attempts" INTEGER NOT NULL,
    "send_count" INTEGER NOT NULL DEFAULT 1,
    "last_sent_at" TIMESTAMPTZ(3) NOT NULL,
    "verified_at" TIMESTAMPTZ(3),
    "request_ip_hash" VARCHAR(128),
    "provider" VARCHAR(32) NOT NULL,
    "provider_ref" VARCHAR(128),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "otp_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth_sessions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "family_id" UUID NOT NULL,
    "refresh_token_hash" VARCHAR(128) NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "last_used_at" TIMESTAMPTZ(3),
    "rotated_at" TIMESTAMPTZ(3),
    "revoked_at" TIMESTAMPTZ(3),
    "revoked_reason" VARCHAR(64),
    "user_agent" VARCHAR(512),
    "ip_hash" VARCHAR(128),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "auth_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "irctc_accounts" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "irctc_user_id" VARCHAR(64) NOT NULL,
    "keep_signed_in_preference" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "irctc_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "passengers" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "age" INTEGER NOT NULL,
    "gender" "Gender" NOT NULL,
    "berth_preference" "BerthPreference" NOT NULL DEFAULT 'NO_PREFERENCE',
    "food_preference" "FoodPreference" NOT NULL DEFAULT 'NO_PREFERENCE',
    "senior_citizen_opt_in" BOOLEAN NOT NULL DEFAULT false,
    "concession_code" VARCHAR(32),
    "nationality" VARCHAR(2) NOT NULL DEFAULT 'IN',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "passengers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stations" (
    "id" UUID NOT NULL,
    "code" VARCHAR(8) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "search_text" VARCHAR(200) NOT NULL,
    "state" VARCHAR(64),
    "zone" VARCHAR(16),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "dataset_version" VARCHAR(32) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "stations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trains" (
    "id" UUID NOT NULL,
    "number" VARCHAR(8) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "from_station_code" VARCHAR(8),
    "to_station_code" VARCHAR(8),
    "classes" JSONB NOT NULL DEFAULT '[]',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "dataset_version" VARCHAR(32) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "trains_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "journeys" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "from_station_code" VARCHAR(8) NOT NULL,
    "to_station_code" VARCHAR(8) NOT NULL,
    "journey_date" DATE NOT NULL,
    "quota" "Quota" NOT NULL DEFAULT 'TATKAL',
    "state" "JourneyState" NOT NULL DEFAULT 'DRAFT',
    "any_train_allowed" BOOLEAN NOT NULL DEFAULT false,
    "use_next_available_class" BOOLEAN NOT NULL DEFAULT true,
    "consider_auto_upgradation" BOOLEAN NOT NULL DEFAULT true,
    "preferences" JSONB NOT NULL DEFAULT '{}',
    "tatkal_opens_at" TIMESTAMPTZ(3),
    "tatkal_rule_snapshot" JSONB,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "journeys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "journey_passengers" (
    "id" UUID NOT NULL,
    "journey_id" UUID NOT NULL,
    "passenger_id" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "journey_passengers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "journey_train_preferences" (
    "id" UUID NOT NULL,
    "journey_id" UUID NOT NULL,
    "priority" INTEGER NOT NULL,
    "train_number" VARCHAR(8) NOT NULL,
    "train_name" VARCHAR(120),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "journey_train_preferences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "journey_class_preferences" (
    "id" UUID NOT NULL,
    "journey_id" UUID NOT NULL,
    "priority" INTEGER NOT NULL,
    "class_code" VARCHAR(4) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "journey_class_preferences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "booking_schedules" (
    "id" UUID NOT NULL,
    "journey_id" UUID NOT NULL,
    "kind" "ScheduledJobKind" NOT NULL,
    "run_at" TIMESTAMPTZ(3) NOT NULL,
    "status" "ScheduledJobStatus" NOT NULL DEFAULT 'PENDING',
    "idempotency_key" VARCHAR(160) NOT NULL,
    "queue_job_id" VARCHAR(64),
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "last_error" VARCHAR(1000),
    "completed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "booking_schedules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "booking_sessions" (
    "id" UUID NOT NULL,
    "journey_id" UUID NOT NULL,
    "state" "JourneyState" NOT NULL,
    "adapter" VARCHAR(32) NOT NULL,
    "current_step" VARCHAR(48),
    "attempted_class" VARCHAR(4),
    "idempotency_key" VARCHAR(160) NOT NULL,
    "started_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ended_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "booking_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bookings" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "journey_id" UUID,
    "booking_session_id" UUID,
    "status" "BookingStatus" NOT NULL,
    "pnr" VARCHAR(10),
    "train_number" VARCHAR(8),
    "train_name" VARCHAR(120),
    "journey_date" DATE NOT NULL,
    "from_station_code" VARCHAR(8) NOT NULL,
    "to_station_code" VARCHAR(8) NOT NULL,
    "class_code" VARCHAR(4),
    "quota" "Quota" NOT NULL,
    "passenger_snapshot" JSONB NOT NULL,
    "transaction_ref" VARCHAR(64),
    "fare_paise" INTEGER,
    "booked_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "bookings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pnr_records" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "pnr" VARCHAR(10) NOT NULL,
    "train_number" VARCHAR(8),
    "journey_date" DATE,
    "current_status" VARCHAR(120),
    "last_checked_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "pnr_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "journey_id" UUID,
    "channel" "NotificationChannel" NOT NULL,
    "template_key" VARCHAR(64) NOT NULL,
    "title" VARCHAR(160) NOT NULL,
    "body" VARCHAR(1000) NOT NULL,
    "status" "NotificationStatus" NOT NULL DEFAULT 'PENDING',
    "idempotency_key" VARCHAR(160) NOT NULL,
    "scheduled_for" TIMESTAMPTZ(3),
    "sent_at" TIMESTAMPTZ(3),
    "failure_reason" VARCHAR(500),
    "read_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL,
    "user_id" UUID,
    "actor_type" "AuditActorType" NOT NULL,
    "action" VARCHAR(64) NOT NULL,
    "entity_type" VARCHAR(48),
    "entity_id" VARCHAR(64),
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "ip_hash" VARCHAR(128),
    "user_agent" VARCHAR(512),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "railway_rules" (
    "id" UUID NOT NULL,
    "rule_key" VARCHAR(64) NOT NULL,
    "value" JSONB NOT NULL,
    "source" VARCHAR(500) NOT NULL,
    "effective_from" TIMESTAMPTZ(3) NOT NULL,
    "effective_to" TIMESTAMPTZ(3),
    "last_verified_at" TIMESTAMPTZ(3),
    "status" "RuleStatus" NOT NULL DEFAULT 'DRAFT',
    "notes" VARCHAR(2000),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "railway_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "application_settings" (
    "id" UUID NOT NULL,
    "key" VARCHAR(64) NOT NULL,
    "value" JSONB NOT NULL,
    "description" VARCHAR(500),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "application_settings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_mobile_key" ON "users"("mobile");

-- CreateIndex
CREATE INDEX "otp_sessions_mobile_created_at_idx" ON "otp_sessions"("mobile", "created_at");

-- CreateIndex
CREATE INDEX "otp_sessions_request_ip_hash_created_at_idx" ON "otp_sessions"("request_ip_hash", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "auth_sessions_refresh_token_hash_key" ON "auth_sessions"("refresh_token_hash");

-- CreateIndex
CREATE INDEX "auth_sessions_user_id_idx" ON "auth_sessions"("user_id");

-- CreateIndex
CREATE INDEX "auth_sessions_family_id_idx" ON "auth_sessions"("family_id");

-- CreateIndex
CREATE UNIQUE INDEX "irctc_accounts_user_id_key" ON "irctc_accounts"("user_id");

-- CreateIndex
CREATE INDEX "passengers_user_id_deleted_at_idx" ON "passengers"("user_id", "deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "stations_code_key" ON "stations"("code");

-- CreateIndex
CREATE INDEX "stations_search_text_idx" ON "stations"("search_text");

-- CreateIndex
CREATE UNIQUE INDEX "trains_number_key" ON "trains"("number");

-- CreateIndex
CREATE INDEX "journeys_user_id_journey_date_idx" ON "journeys"("user_id", "journey_date");

-- CreateIndex
CREATE INDEX "journeys_state_tatkal_opens_at_idx" ON "journeys"("state", "tatkal_opens_at");

-- CreateIndex
CREATE UNIQUE INDEX "journey_passengers_journey_id_passenger_id_key" ON "journey_passengers"("journey_id", "passenger_id");

-- CreateIndex
CREATE UNIQUE INDEX "journey_train_preferences_journey_id_priority_key" ON "journey_train_preferences"("journey_id", "priority");

-- CreateIndex
CREATE UNIQUE INDEX "journey_class_preferences_journey_id_priority_key" ON "journey_class_preferences"("journey_id", "priority");

-- CreateIndex
CREATE UNIQUE INDEX "booking_schedules_idempotency_key_key" ON "booking_schedules"("idempotency_key");

-- CreateIndex
CREATE INDEX "booking_schedules_status_run_at_idx" ON "booking_schedules"("status", "run_at");

-- CreateIndex
CREATE UNIQUE INDEX "booking_sessions_idempotency_key_key" ON "booking_sessions"("idempotency_key");

-- CreateIndex
CREATE INDEX "booking_sessions_journey_id_idx" ON "booking_sessions"("journey_id");

-- CreateIndex
CREATE UNIQUE INDEX "bookings_booking_session_id_key" ON "bookings"("booking_session_id");

-- CreateIndex
CREATE INDEX "bookings_user_id_journey_date_idx" ON "bookings"("user_id", "journey_date");

-- CreateIndex
CREATE INDEX "bookings_pnr_idx" ON "bookings"("pnr");

-- CreateIndex
CREATE UNIQUE INDEX "pnr_records_user_id_pnr_key" ON "pnr_records"("user_id", "pnr");

-- CreateIndex
CREATE UNIQUE INDEX "notifications_idempotency_key_key" ON "notifications"("idempotency_key");

-- CreateIndex
CREATE INDEX "notifications_user_id_created_at_idx" ON "notifications"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "notifications_status_scheduled_for_idx" ON "notifications"("status", "scheduled_for");

-- CreateIndex
CREATE INDEX "audit_logs_user_id_created_at_idx" ON "audit_logs"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_logs_action_created_at_idx" ON "audit_logs"("action", "created_at");

-- CreateIndex
CREATE INDEX "railway_rules_rule_key_status_effective_from_idx" ON "railway_rules"("rule_key", "status", "effective_from");

-- CreateIndex
CREATE UNIQUE INDEX "application_settings_key_key" ON "application_settings"("key");

-- AddForeignKey
ALTER TABLE "auth_sessions" ADD CONSTRAINT "auth_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "irctc_accounts" ADD CONSTRAINT "irctc_accounts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "passengers" ADD CONSTRAINT "passengers_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journeys" ADD CONSTRAINT "journeys_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journey_passengers" ADD CONSTRAINT "journey_passengers_journey_id_fkey" FOREIGN KEY ("journey_id") REFERENCES "journeys"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journey_passengers" ADD CONSTRAINT "journey_passengers_passenger_id_fkey" FOREIGN KEY ("passenger_id") REFERENCES "passengers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journey_train_preferences" ADD CONSTRAINT "journey_train_preferences_journey_id_fkey" FOREIGN KEY ("journey_id") REFERENCES "journeys"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journey_class_preferences" ADD CONSTRAINT "journey_class_preferences_journey_id_fkey" FOREIGN KEY ("journey_id") REFERENCES "journeys"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_schedules" ADD CONSTRAINT "booking_schedules_journey_id_fkey" FOREIGN KEY ("journey_id") REFERENCES "journeys"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_sessions" ADD CONSTRAINT "booking_sessions_journey_id_fkey" FOREIGN KEY ("journey_id") REFERENCES "journeys"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_journey_id_fkey" FOREIGN KEY ("journey_id") REFERENCES "journeys"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_booking_session_id_fkey" FOREIGN KEY ("booking_session_id") REFERENCES "booking_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pnr_records" ADD CONSTRAINT "pnr_records_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

