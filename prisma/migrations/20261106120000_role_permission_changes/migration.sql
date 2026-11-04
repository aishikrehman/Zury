-- Superusers can change what each role may do.
CREATE TABLE "RolePermissionChange" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "kind" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "permission" TEXT NOT NULL,
    "allowed" BOOLEAN NOT NULL,
    "changedById" INTEGER,
    "changedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "RolePermissionChange_kind_role_permission_key" ON "RolePermissionChange"("kind", "role", "permission");
