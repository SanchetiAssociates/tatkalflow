-- CreateEnum
CREATE TYPE "RacWaitlistPreference" AS ENUM ('CONFIRMED_ONLY', 'ALLOW_RAC', 'ALLOW_WAITLIST');

-- AlterTable
ALTER TABLE "journey_passengers" ADD COLUMN     "berth_preference" "BerthPreference" NOT NULL DEFAULT 'NO_PREFERENCE';

-- Backfill (hand-written): existing journeys keep each passenger's saved berth.
UPDATE "journey_passengers" AS jp SET "berth_preference" = p."berth_preference" FROM "passengers" AS p WHERE p."id" = jp."passenger_id";

-- AlterTable
ALTER TABLE "journeys" ADD COLUMN     "boarding_station_code" VARCHAR(8),
ADD COLUMN     "name" VARCHAR(60),
ADD COLUMN     "rac_waitlist_preference" "RacWaitlistPreference" NOT NULL DEFAULT 'ALLOW_WAITLIST',
ADD COLUMN     "rule_snapshot" JSONB,
ADD COLUMN     "template_id" UUID;

-- CreateTable
CREATE TABLE "journey_templates" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "name" VARCHAR(60) NOT NULL,
    "from_station_code" VARCHAR(8) NOT NULL,
    "to_station_code" VARCHAR(8) NOT NULL,
    "boarding_station_code" VARCHAR(8),
    "quota" "Quota" NOT NULL DEFAULT 'TATKAL',
    "any_train_allowed" BOOLEAN NOT NULL DEFAULT false,
    "use_next_available_class" BOOLEAN NOT NULL DEFAULT true,
    "consider_auto_upgradation" BOOLEAN NOT NULL DEFAULT true,
    "rac_waitlist_preference" "RacWaitlistPreference" NOT NULL DEFAULT 'ALLOW_WAITLIST',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "journey_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "journey_template_passengers" (
    "id" UUID NOT NULL,
    "template_id" UUID NOT NULL,
    "passenger_id" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "berth_preference" "BerthPreference" NOT NULL DEFAULT 'NO_PREFERENCE',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "journey_template_passengers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "journey_template_trains" (
    "id" UUID NOT NULL,
    "template_id" UUID NOT NULL,
    "priority" INTEGER NOT NULL,
    "train_number" VARCHAR(8) NOT NULL,
    "train_name" VARCHAR(120),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "journey_template_trains_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "journey_template_classes" (
    "id" UUID NOT NULL,
    "template_id" UUID NOT NULL,
    "priority" INTEGER NOT NULL,
    "class_code" VARCHAR(4) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "journey_template_classes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "journey_templates_user_id_deleted_at_idx" ON "journey_templates"("user_id", "deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "journey_template_passengers_template_id_passenger_id_key" ON "journey_template_passengers"("template_id", "passenger_id");

-- CreateIndex
CREATE UNIQUE INDEX "journey_template_trains_template_id_priority_key" ON "journey_template_trains"("template_id", "priority");

-- CreateIndex
CREATE UNIQUE INDEX "journey_template_trains_template_id_train_number_key" ON "journey_template_trains"("template_id", "train_number");

-- CreateIndex
CREATE UNIQUE INDEX "journey_template_classes_template_id_priority_key" ON "journey_template_classes"("template_id", "priority");

-- CreateIndex
CREATE UNIQUE INDEX "journey_template_classes_template_id_class_code_key" ON "journey_template_classes"("template_id", "class_code");

-- CreateIndex
CREATE UNIQUE INDEX "journey_class_preferences_journey_id_class_code_key" ON "journey_class_preferences"("journey_id", "class_code");

-- CreateIndex
CREATE UNIQUE INDEX "journey_train_preferences_journey_id_train_number_key" ON "journey_train_preferences"("journey_id", "train_number");

-- CreateIndex
CREATE INDEX "journeys_template_id_idx" ON "journeys"("template_id");

-- AddForeignKey
ALTER TABLE "journeys" ADD CONSTRAINT "journeys_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "journey_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journey_templates" ADD CONSTRAINT "journey_templates_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journey_template_passengers" ADD CONSTRAINT "journey_template_passengers_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "journey_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journey_template_passengers" ADD CONSTRAINT "journey_template_passengers_passenger_id_fkey" FOREIGN KEY ("passenger_id") REFERENCES "passengers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journey_template_trains" ADD CONSTRAINT "journey_template_trains_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "journey_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journey_template_classes" ADD CONSTRAINT "journey_template_classes_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "journey_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

