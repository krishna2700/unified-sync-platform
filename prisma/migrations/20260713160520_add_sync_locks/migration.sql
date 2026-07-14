-- CreateTable
CREATE TABLE "sync_locks" (
    "provider" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "locked_at" TIMESTAMP(3) NOT NULL,
    "lock_owner" TEXT,

    CONSTRAINT "sync_locks_pkey" PRIMARY KEY ("provider","entity_type")
);

-- AddForeignKey
ALTER TABLE "sync_locks" ADD CONSTRAINT "sync_locks_provider_fkey" FOREIGN KEY ("provider") REFERENCES "providers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
