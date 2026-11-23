-- À exécuter UNE fois sur une base existante (phpMyAdmin > booking_soap_db > onglet SQL).
-- Conserve toutes vos données, contrairement à la réimportation de schema.sql.
ALTER TABLE services ADD COLUMN image_url VARCHAR(500) NULL AFTER location;

-- Exemple : une image par service (les fichiers sont à placer dans frontend/public/images/)
-- UPDATE services SET image_url = '/images/tunis-palace.jpg' WHERE name = 'Hôtel Tunis Palace';
