-- CreateTable
CREATE TABLE "providers" (
    "id" TEXT NOT NULL,
    "source_system" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "providers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "canonical_contacts" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "source_id" TEXT NOT NULL,
    "email" TEXT,
    "first_name" TEXT,
    "last_name" TEXT,
    "phone" TEXT,
    "company" TEXT,
    "lifecycle_stage" TEXT,
    "source_created_at" TIMESTAMP(3),
    "source_updated_at" TIMESTAMP(3),
    "synced_at" TIMESTAMP(3),
    "raw" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "canonical_contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "canonical_deals" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "source_id" TEXT NOT NULL,
    "deal_name" TEXT NOT NULL,
    "stage" TEXT NOT NULL,
    "amount_minor" BIGINT,
    "currency" TEXT,
    "pipeline" TEXT,
    "close_date" TIMESTAMP(3),
    "primary_contact_source_id" TEXT,
    "source_created_at" TIMESTAMP(3),
    "source_updated_at" TIMESTAMP(3),
    "synced_at" TIMESTAMP(3),
    "raw" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "canonical_deals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "canonical_events" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "source_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "location" TEXT,
    "start_at" TIMESTAMP(3) NOT NULL,
    "end_at" TIMESTAMP(3) NOT NULL,
    "timezone" TEXT,
    "status" TEXT NOT NULL,
    "organizer_email" TEXT,
    "attendees" JSONB NOT NULL DEFAULT '[]',
    "is_recurring" BOOLEAN NOT NULL DEFAULT false,
    "recurring_event_source_id" TEXT,
    "source_created_at" TIMESTAMP(3),
    "source_updated_at" TIMESTAMP(3),
    "synced_at" TIMESTAMP(3),
    "raw" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "canonical_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "canonical_payments" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "source_id" TEXT NOT NULL,
    "amount_minor" BIGINT NOT NULL,
    "currency" TEXT NOT NULL,
    "raw_status" TEXT NOT NULL,
    "canonical_status" TEXT NOT NULL,
    "customer_ref" TEXT,
    "occurred_at" TIMESTAMP(3) NOT NULL,
    "description" TEXT,
    "source_created_at" TIMESTAMP(3),
    "source_updated_at" TIMESTAMP(3),
    "synced_at" TIMESTAMP(3),
    "raw" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "canonical_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sync_cursors" (
    "provider" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "issued_at" TIMESTAMP(3) NOT NULL,
    "expires_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sync_cursors_pkey" PRIMARY KEY ("provider","entity_type")
);

-- CreateTable
CREATE TABLE "sync_metadata" (
    "provider" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "last_sync_status" TEXT NOT NULL,
    "last_sync_mode" TEXT NOT NULL,
    "last_sync_started_at" TIMESTAMP(3),
    "last_sync_completed_at" TIMESTAMP(3),
    "last_successful_sync_at" TIMESTAMP(3),
    "consecutive_failure_count" INTEGER NOT NULL DEFAULT 0,
    "records_processed_last_run" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sync_metadata_pkey" PRIMARY KEY ("provider","entity_type")
);

-- CreateTable
CREATE TABLE "job_history" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "outcome" TEXT,
    "started_at" TIMESTAMP(3) NOT NULL,
    "finished_at" TIMESTAMP(3),
    "records_fetched" INTEGER NOT NULL DEFAULT 0,
    "records_upserted" INTEGER NOT NULL DEFAULT 0,
    "records_failed" INTEGER NOT NULL DEFAULT 0,
    "error_summary" TEXT,

    CONSTRAINT "job_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "failure_logs" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "entity_type" TEXT,
    "job_id" TEXT,
    "error_code" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "context" JSONB NOT NULL DEFAULT '{}',
    "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "failure_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_events" (
    "id" TEXT NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processing_status" TEXT NOT NULL DEFAULT 'received',
    "processed_at" TIMESTAMP(3),
    "error" TEXT,

    CONSTRAINT "webhook_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "idempotency_keys" (
    "key" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'claimed',
    "result" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "idempotency_keys_pkey" PRIMARY KEY ("key","scope")
);

-- CreateTable
CREATE TABLE "payment_status_mappings" (
    "provider" TEXT NOT NULL,
    "raw_status" TEXT NOT NULL,
    "canonical_status" TEXT NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payment_status_mappings_pkey" PRIMARY KEY ("provider","raw_status")
);

-- CreateTable
CREATE TABLE "canonical_record_audit" (
    "id" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "source_id" TEXT NOT NULL,
    "internal_id" TEXT NOT NULL,
    "operation" TEXT NOT NULL,
    "job_id" TEXT,
    "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "snapshot" JSONB NOT NULL,

    CONSTRAINT "canonical_record_audit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "canonical_contacts_email_idx" ON "canonical_contacts"("email");

-- CreateIndex
CREATE INDEX "canonical_contacts_provider_source_updated_at_idx" ON "canonical_contacts"("provider", "source_updated_at");

-- CreateIndex
CREATE UNIQUE INDEX "canonical_contacts_provider_source_id_key" ON "canonical_contacts"("provider", "source_id");

-- CreateIndex
CREATE INDEX "canonical_deals_provider_stage_idx" ON "canonical_deals"("provider", "stage");

-- CreateIndex
CREATE INDEX "canonical_deals_close_date_idx" ON "canonical_deals"("close_date");

-- CreateIndex
CREATE UNIQUE INDEX "canonical_deals_provider_source_id_key" ON "canonical_deals"("provider", "source_id");

-- CreateIndex
CREATE INDEX "canonical_events_provider_start_at_idx" ON "canonical_events"("provider", "start_at");

-- CreateIndex
CREATE INDEX "canonical_events_start_at_end_at_idx" ON "canonical_events"("start_at", "end_at");

-- CreateIndex
CREATE UNIQUE INDEX "canonical_events_provider_source_id_key" ON "canonical_events"("provider", "source_id");

-- CreateIndex
CREATE INDEX "canonical_payments_canonical_status_occurred_at_idx" ON "canonical_payments"("canonical_status", "occurred_at");

-- CreateIndex
CREATE INDEX "canonical_payments_provider_occurred_at_idx" ON "canonical_payments"("provider", "occurred_at");

-- CreateIndex
CREATE UNIQUE INDEX "canonical_payments_provider_source_id_key" ON "canonical_payments"("provider", "source_id");

-- CreateIndex
CREATE INDEX "job_history_provider_entity_type_started_at_idx" ON "job_history"("provider", "entity_type", "started_at" DESC);

-- CreateIndex
CREATE INDEX "job_history_outcome_idx" ON "job_history"("outcome");

-- CreateIndex
CREATE INDEX "failure_logs_provider_occurred_at_idx" ON "failure_logs"("provider", "occurred_at" DESC);

-- CreateIndex
CREATE INDEX "failure_logs_error_code_idx" ON "failure_logs"("error_code");

-- CreateIndex
CREATE UNIQUE INDEX "webhook_events_idempotency_key_key" ON "webhook_events"("idempotency_key");

-- CreateIndex
CREATE INDEX "webhook_events_provider_received_at_idx" ON "webhook_events"("provider", "received_at" DESC);

-- CreateIndex
CREATE INDEX "canonical_record_audit_entity_type_source_id_idx" ON "canonical_record_audit"("entity_type", "source_id");

-- CreateIndex
CREATE INDEX "canonical_record_audit_occurred_at_idx" ON "canonical_record_audit"("occurred_at");

-- AddForeignKey
ALTER TABLE "canonical_contacts" ADD CONSTRAINT "canonical_contacts_provider_fkey" FOREIGN KEY ("provider") REFERENCES "providers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "canonical_deals" ADD CONSTRAINT "canonical_deals_provider_fkey" FOREIGN KEY ("provider") REFERENCES "providers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "canonical_events" ADD CONSTRAINT "canonical_events_provider_fkey" FOREIGN KEY ("provider") REFERENCES "providers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "canonical_payments" ADD CONSTRAINT "canonical_payments_provider_fkey" FOREIGN KEY ("provider") REFERENCES "providers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sync_cursors" ADD CONSTRAINT "sync_cursors_provider_fkey" FOREIGN KEY ("provider") REFERENCES "providers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sync_metadata" ADD CONSTRAINT "sync_metadata_provider_fkey" FOREIGN KEY ("provider") REFERENCES "providers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_history" ADD CONSTRAINT "job_history_provider_fkey" FOREIGN KEY ("provider") REFERENCES "providers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "failure_logs" ADD CONSTRAINT "failure_logs_provider_fkey" FOREIGN KEY ("provider") REFERENCES "providers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "failure_logs" ADD CONSTRAINT "failure_logs_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "job_history"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webhook_events" ADD CONSTRAINT "webhook_events_provider_fkey" FOREIGN KEY ("provider") REFERENCES "providers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_status_mappings" ADD CONSTRAINT "payment_status_mappings_provider_fkey" FOREIGN KEY ("provider") REFERENCES "providers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "canonical_record_audit" ADD CONSTRAINT "canonical_record_audit_provider_fkey" FOREIGN KEY ("provider") REFERENCES "providers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CheckConstraint: Prisma Schema Language has no native CHECK support, so business-rule
-- constraints are hand-added here. Keep this block in sync with the domain value objects
-- (src/domain/value-objects) if the vocabularies ever change.

-- providers.source_system
ALTER TABLE "providers"
  ADD CONSTRAINT "provider_source_system_valid"
  CHECK ("source_system" IN ('crm', 'payments', 'calendar'));

-- canonical_deals.amount_minor
ALTER TABLE "canonical_deals"
  ADD CONSTRAINT "deal_amount_non_negative"
  CHECK ("amount_minor" IS NULL OR "amount_minor" >= 0);

-- canonical_events.status / start-end ordering
ALTER TABLE "canonical_events"
  ADD CONSTRAINT "event_status_valid"
  CHECK ("status" IN ('confirmed', 'tentative', 'cancelled'));
ALTER TABLE "canonical_events"
  ADD CONSTRAINT "event_end_after_start"
  CHECK ("end_at" >= "start_at");

-- canonical_payments.amount_minor / canonical_status / currency
ALTER TABLE "canonical_payments"
  ADD CONSTRAINT "payment_amount_non_negative"
  CHECK ("amount_minor" >= 0);
ALTER TABLE "canonical_payments"
  ADD CONSTRAINT "payment_canonical_status_valid"
  CHECK ("canonical_status" IN ('collected', 'pending', 'failed', 'refunded', 'cancelled', 'unknown'));
ALTER TABLE "canonical_payments"
  ADD CONSTRAINT "payment_currency_iso4217_format"
  CHECK ("currency" ~ '^[A-Z]{3}$');

-- sync_metadata.last_sync_status / last_sync_mode
ALTER TABLE "sync_metadata"
  ADD CONSTRAINT "sync_metadata_status_valid"
  CHECK ("last_sync_status" IN ('success', 'partial_failure', 'failed', 'in_progress'));
ALTER TABLE "sync_metadata"
  ADD CONSTRAINT "sync_metadata_mode_valid"
  CHECK ("last_sync_mode" IN ('incremental', 'full'));

-- job_history.mode / outcome
ALTER TABLE "job_history"
  ADD CONSTRAINT "job_history_mode_valid"
  CHECK ("mode" IN ('incremental', 'full'));
ALTER TABLE "job_history"
  ADD CONSTRAINT "job_history_outcome_valid"
  CHECK ("outcome" IS NULL OR "outcome" IN ('success', 'partial_failure', 'failed'));

-- webhook_events.processing_status
ALTER TABLE "webhook_events"
  ADD CONSTRAINT "webhook_event_status_valid"
  CHECK ("processing_status" IN ('received', 'processed', 'failed'));

-- idempotency_keys.status
ALTER TABLE "idempotency_keys"
  ADD CONSTRAINT "idempotency_key_status_valid"
  CHECK ("status" IN ('claimed', 'completed'));

-- payment_status_mappings.canonical_status
ALTER TABLE "payment_status_mappings"
  ADD CONSTRAINT "payment_status_mapping_canonical_valid"
  CHECK ("canonical_status" IN ('collected', 'pending', 'failed', 'refunded', 'cancelled', 'unknown'));

-- canonical_record_audit.operation
ALTER TABLE "canonical_record_audit"
  ADD CONSTRAINT "canonical_record_audit_operation_valid"
  CHECK ("operation" IN ('created', 'updated'));
