-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_WikiSite" (
    "dbname" TEXT NOT NULL PRIMARY KEY,
    "url" TEXT NOT NULL,
    "family" TEXT NOT NULL,
    "sitename" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT '',
    "localName" TEXT NOT NULL DEFAULT '',
    "lang" TEXT,
    "closed" BOOLEAN NOT NULL DEFAULT false,
    "private" BOOLEAN NOT NULL DEFAULT false,
    "fetchedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "new_WikiSite" ("closed", "dbname", "family", "fetchedAt", "lang", "private", "sitename", "url") SELECT "closed", "dbname", "family", "fetchedAt", "lang", "private", "sitename", "url" FROM "WikiSite";
DROP TABLE "WikiSite";
ALTER TABLE "new_WikiSite" RENAME TO "WikiSite";
CREATE INDEX "WikiSite_lang_idx" ON "WikiSite"("lang");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

