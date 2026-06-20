ALTER TABLE "Run" ADD COLUMN "userId" TEXT;

CREATE INDEX "Run_userId_idx" ON "Run"("userId");
