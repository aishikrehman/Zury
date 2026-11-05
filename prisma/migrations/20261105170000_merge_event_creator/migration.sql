-- Event Creator and Zury Administrator are one role now: event creators become administrators.
DELETE ec FROM `UserGlobalRole` ec JOIN `UserGlobalRole` pa ON pa.`userId` = ec.`userId` AND pa.`role` = 'platform-admin' WHERE ec.`role` = 'event-creator';
UPDATE `UserGlobalRole` SET `role` = 'platform-admin' WHERE `role` = 'event-creator';
DELETE FROM `RolePermissionChange` WHERE `role` = 'event-creator';
