-- CreateEnum
CREATE TYPE "RuleVerificationStatus" AS ENUM ('UNVERIFIED', 'VERIFIED', 'EXPIRED', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "StationDatasetStatus" AS ENUM ('ACTIVE', 'ARCHIVED');

-- AlterTable
ALTER TABLE "passengers" ADD COLUMN     "child_berth_opt_in" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "last_used_at" TIMESTAMPTZ(3);

-- AlterTable
ALTER TABLE "railway_rules" ADD COLUMN     "source_url" VARCHAR(1000),
ADD COLUMN     "verification_status" "RuleVerificationStatus" NOT NULL DEFAULT 'UNVERIFIED',
ADD COLUMN     "verified_by" VARCHAR(120);

-- AlterTable
ALTER TABLE "stations" ADD COLUMN     "aliases" JSONB NOT NULL DEFAULT '[]',
ALTER COLUMN "search_text" SET DATA TYPE VARCHAR(400);

-- CreateTable
CREATE TABLE "station_datasets" (
    "id" UUID NOT NULL,
    "version" VARCHAR(32) NOT NULL,
    "source" VARCHAR(500) NOT NULL,
    "source_url" VARCHAR(1000),
    "license" VARCHAR(200),
    "record_count" INTEGER NOT NULL,
    "checksum" VARCHAR(64) NOT NULL,
    "status" "StationDatasetStatus" NOT NULL DEFAULT 'ACTIVE',
    "notes" VARCHAR(2000),
    "imported_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "station_datasets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_stations" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "station_code" VARCHAR(8) NOT NULL,
    "is_favourite" BOOLEAN NOT NULL DEFAULT false,
    "use_count" INTEGER NOT NULL DEFAULT 0,
    "last_used_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "user_stations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "station_datasets_version_key" ON "station_datasets"("version");

-- CreateIndex
CREATE INDEX "user_stations_user_id_last_used_at_idx" ON "user_stations"("user_id", "last_used_at");

-- CreateIndex
CREATE UNIQUE INDEX "user_stations_user_id_station_code_key" ON "user_stations"("user_id", "station_code");

-- CreateIndex
CREATE UNIQUE INDEX "railway_rules_rule_key_effective_from_key" ON "railway_rules"("rule_key", "effective_from");

-- CreateIndex
CREATE INDEX "stations_is_active_idx" ON "stations"("is_active");

-- AddForeignKey
ALTER TABLE "user_stations" ADD CONSTRAINT "user_stations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

