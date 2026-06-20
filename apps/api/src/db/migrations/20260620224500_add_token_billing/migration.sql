CREATE TABLE "TokenBalance" (
  "userId" TEXT NOT NULL,
  "balanceTokens" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "TokenBalance_pkey" PRIMARY KEY ("userId")
);

CREATE TABLE "TokenLedgerEntry" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "tokenDelta" INTEGER NOT NULL,
  "balanceAfter" INTEGER NOT NULL,
  "model" TEXT,
  "runId" TEXT,
  "attemptId" TEXT,
  "promptTokens" INTEGER,
  "completionTokens" INTEGER,
  "totalTokens" INTEGER,
  "costUsdMicros" INTEGER,
  "stripeEventId" TEXT,
  "stripeSessionId" TEXT,
  "amountUsdCents" INTEGER,
  "description" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "TokenLedgerEntry_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "TokenLedgerEntry_userId_createdAt_idx" ON "TokenLedgerEntry"("userId", "createdAt");
CREATE INDEX "TokenLedgerEntry_runId_idx" ON "TokenLedgerEntry"("runId");
CREATE INDEX "TokenLedgerEntry_attemptId_idx" ON "TokenLedgerEntry"("attemptId");
CREATE UNIQUE INDEX "TokenLedgerEntry_stripeEventId_key" ON "TokenLedgerEntry"("stripeEventId");
CREATE UNIQUE INDEX "TokenLedgerEntry_stripeSessionId_key" ON "TokenLedgerEntry"("stripeSessionId");

ALTER TABLE "TokenLedgerEntry"
  ADD CONSTRAINT "TokenLedgerEntry_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "TokenBalance"("userId")
  ON DELETE CASCADE ON UPDATE CASCADE;
