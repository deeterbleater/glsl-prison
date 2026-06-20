CREATE TABLE "Run" (
  "id" TEXT NOT NULL,
  "prompt" TEXT NOT NULL,
  "mode" TEXT NOT NULL,
  "model" TEXT,
  "public" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Run_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Attempt" (
  "id" TEXT NOT NULL,
  "runId" TEXT NOT NULL,
  "attemptNumber" INTEGER NOT NULL,
  "fragment" TEXT NOT NULL,
  "mode" TEXT NOT NULL,
  "model" TEXT,
  "status" TEXT NOT NULL,
  "compileOk" BOOLEAN,
  "compileLog" TEXT,
  "statsJson" JSONB,
  "scoreJson" JSONB,
  "critique" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Attempt_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Capture" (
  "id" TEXT NOT NULL,
  "attemptId" TEXT NOT NULL,
  "t" DOUBLE PRECISION NOT NULL,
  "imageUrl" TEXT,
  "dataUrl" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Capture_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Attempt_runId_idx" ON "Attempt"("runId");
CREATE INDEX "Capture_attemptId_idx" ON "Capture"("attemptId");

ALTER TABLE "Attempt"
  ADD CONSTRAINT "Attempt_runId_fkey"
  FOREIGN KEY ("runId") REFERENCES "Run"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Capture"
  ADD CONSTRAINT "Capture_attemptId_fkey"
  FOREIGN KEY ("attemptId") REFERENCES "Attempt"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

