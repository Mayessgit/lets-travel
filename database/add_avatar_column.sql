-- À exécuter UNE fois sur une base existante (phpMyAdmin > booking_soap_db > onglet SQL).
ALTER TABLE users ADD COLUMN avatar MEDIUMTEXT NULL AFTER phone;
