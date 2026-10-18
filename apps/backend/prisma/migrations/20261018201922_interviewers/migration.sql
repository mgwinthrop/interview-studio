-- Hand-edited. Prisma's generated rebuild dropped "topicId" without copying it. This version
-- copies it: every existing session keeps its old "topicId" value in "interviewerId", and "interviewerJson"
-- (the interviewer snapshot) is NULL on every existing row. No other column changes.
-- ConversationTurn and Report are not touched; their foreign keys reference "Session"("id").

-- CreateTable
CREATE TABLE "Interviewer" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ownerId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "definitionJson" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL,
    "updatedAt" DATETIME NOT NULL
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Session" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ownerId" TEXT NOT NULL DEFAULT 'local',
    "interviewerId" TEXT NOT NULL,
    "interviewerJson" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "phase" TEXT NOT NULL DEFAULT 'intro',
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" DATETIME
);
INSERT INTO "new_Session" ("endedAt", "id", "interviewerId", "interviewerJson", "ownerId", "phase", "startedAt", "status") SELECT "endedAt", "id", "topicId", NULL, "ownerId", "phase", "startedAt", "status" FROM "Session";
DROP TABLE "Session";
ALTER TABLE "new_Session" RENAME TO "Session";
CREATE INDEX "Session_ownerId_idx" ON "Session"("ownerId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "Interviewer_ownerId_idx" ON "Interviewer"("ownerId");
