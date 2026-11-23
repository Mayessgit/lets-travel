-- ============================================================
--  Migration : format des numéros de téléphone (8 chiffres)
--  À exécuter une seule fois sur une base déjà installée :
--    phpMyAdmin (booking_soap_db) > Importer, ou
--    mysql -u root booking_soap_db < database/update_phone_format.sql
--  Nouvelle règle : ^(2|5|9)[0-9]{7}$ (20–29, 50–59, 90–99).
-- ============================================================

USE booking_soap_db;

-- 1) Convertit « +216XXXXXXXX » en ses 8 derniers chiffres.
UPDATE users SET phone = RIGHT(phone, 8) WHERE phone REGEXP '^[+]216[0-9]{8}$';

-- 2) Vide les numéros qui ne respectent toujours pas la règle (trop courts, espaces, lettres…).
UPDATE users SET phone = NULL WHERE phone IS NOT NULL AND phone NOT REGEXP '^(2|5|9)[0-9]{7}$';
