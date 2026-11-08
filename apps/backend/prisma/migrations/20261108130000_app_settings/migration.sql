-- CreateTable
CREATE TABLE "AppSettings" (
    "ownerId" TEXT NOT NULL PRIMARY KEY,
    "valuesJson" TEXT NOT NULL,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "ModelPrice" (
    "ownerId" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "inputPerMtok" REAL NOT NULL,
    "outputPerMtok" REAL NOT NULL,
    "asOf" TEXT NOT NULL,
    "updatedAt" DATETIME NOT NULL,

    PRIMARY KEY ("ownerId", "model")
);
