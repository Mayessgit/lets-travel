-- ============================================================
--  booking_soap_db : plateforme de réservation (hôtels, vols, événements)
--  Compatible MariaDB (XAMPP) / MySQL 8
--  Import : phpMyAdmin > Importer, ou  mysql -u root < schema.sql
--  (bases existantes : utiliser database/migration_v2.sql)
-- ============================================================

SET NAMES utf8mb4;  -- évite les accents corrompus quel que soit le client d'import

DROP DATABASE IF EXISTS booking_soap_db;
CREATE DATABASE booking_soap_db CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE booking_soap_db;

-- ------------------------------------------------------------
-- users
-- ------------------------------------------------------------
CREATE TABLE users (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  name          VARCHAR(100) NOT NULL,
  email         VARCHAR(150) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  phone         VARCHAR(30)  NULL,
  avatar        MEDIUMTEXT   NULL,          -- photo de profil (data URL JPEG/PNG/WebP, ~20 Ko)
  role          ENUM('USER','ADMIN') NOT NULL DEFAULT 'USER',
  created_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- ------------------------------------------------------------
-- services : hôtels, vols, événements
-- ------------------------------------------------------------
CREATE TABLE services (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  name        VARCHAR(150) NOT NULL,
  type        ENUM('HOTEL','FLIGHT','EVENT') NOT NULL,
  description TEXT NULL,
  location    VARCHAR(150) NOT NULL,
  image_url   VARCHAR(500) NULL,            -- ex: /images/hotel-tunis.jpg ou https://...
  price       DECIMAL(10,2) NOT NULL CHECK (price >= 0),
  created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_services_type (type),
  INDEX idx_services_location (location)
) ENGINE=InnoDB;

-- ------------------------------------------------------------
-- availabilities : un créneau (service + date) avec son stock de places
-- ------------------------------------------------------------
CREATE TABLE availabilities (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  service_id      INT NOT NULL,
  date            DATE NOT NULL,
  total_slots     INT NOT NULL,
  available_slots INT NOT NULL,
  UNIQUE KEY uq_service_date (service_id, date),
  CONSTRAINT chk_slots CHECK (available_slots >= 0 AND available_slots <= total_slots),
  CONSTRAINT fk_av_service FOREIGN KEY (service_id) REFERENCES services(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- ------------------------------------------------------------
-- promo_codes : réductions en pourcentage (gérées par un admin)
-- ------------------------------------------------------------
CREATE TABLE promo_codes (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  code       VARCHAR(30) NOT NULL UNIQUE,
  percent    TINYINT NOT NULL CHECK (percent BETWEEN 1 AND 100),
  valid_from DATE NOT NULL,
  valid_to   DATE NOT NULL,
  max_uses   INT NULL,                      -- NULL = nombre d'utilisations illimité
  used_count INT NOT NULL DEFAULT 0,
  active     TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT chk_promo_dates CHECK (valid_to >= valid_from)
) ENGINE=InnoDB;

-- ------------------------------------------------------------
-- reservations
-- ------------------------------------------------------------
CREATE TABLE reservations (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  user_id         INT NOT NULL,
  service_id      INT NOT NULL,
  availability_id INT NOT NULL,
  quantity        INT NOT NULL CHECK (quantity > 0),
  total_price     DECIMAL(10,2) NOT NULL,   -- prix final, remise déduite
  promo_code      VARCHAR(30) NULL,         -- code appliqué (historique)
  discount_amount DECIMAL(10,2) NULL,       -- montant de la remise
  status          ENUM('PENDING','CONFIRMED','CANCELLED') NOT NULL DEFAULT 'PENDING',
  created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_res_user (user_id),
  INDEX idx_res_status (status),
  INDEX idx_res_created (created_at),
  CONSTRAINT fk_res_user    FOREIGN KEY (user_id)         REFERENCES users(id)          ON DELETE CASCADE,
  CONSTRAINT fk_res_service FOREIGN KEY (service_id)      REFERENCES services(id)       ON DELETE RESTRICT,
  CONSTRAINT fk_res_avail   FOREIGN KEY (availability_id) REFERENCES availabilities(id) ON DELETE RESTRICT
) ENGINE=InnoDB;

-- ------------------------------------------------------------
-- payments (1 paiement par réservation)
-- ------------------------------------------------------------
CREATE TABLE payments (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  reservation_id  INT NOT NULL UNIQUE,
  amount          DECIMAL(10,2) NOT NULL,
  method          VARCHAR(30) NOT NULL,
  transaction_ref VARCHAR(60) NOT NULL UNIQUE,
  status          ENUM('PENDING','PAID','FAILED','REFUNDED') NOT NULL DEFAULT 'PENDING',
  created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_pay_status (status),
  INDEX idx_pay_created (created_at),
  CONSTRAINT fk_pay_res FOREIGN KEY (reservation_id) REFERENCES reservations(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- ------------------------------------------------------------
-- favorites : services mis de côté par un utilisateur
-- ------------------------------------------------------------
CREATE TABLE favorites (
  user_id    INT NOT NULL,
  service_id INT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, service_id),
  CONSTRAINT fk_fav_user    FOREIGN KEY (user_id)    REFERENCES users(id)    ON DELETE CASCADE,
  CONSTRAINT fk_fav_service FOREIGN KEY (service_id) REFERENCES services(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- ------------------------------------------------------------
-- reviews : un avis par utilisateur et par service (réservation confirmée exigée)
-- ------------------------------------------------------------
CREATE TABLE reviews (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  user_id    INT NOT NULL,
  service_id INT NOT NULL,
  rating     TINYINT NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment    VARCHAR(1000) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_review_user_service (user_id, service_id),
  INDEX idx_reviews_service (service_id),
  CONSTRAINT fk_review_user    FOREIGN KEY (user_id)    REFERENCES users(id)    ON DELETE CASCADE,
  CONSTRAINT fk_review_service FOREIGN KEY (service_id) REFERENCES services(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- ------------------------------------------------------------
-- notifications : fil d'activité de chaque utilisateur
-- ------------------------------------------------------------
CREATE TABLE notifications (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  user_id    INT NOT NULL,
  type       VARCHAR(30) NOT NULL,          -- RESERVATION_CREATED, PAYMENT_ACCEPTED…
  title      VARCHAR(150) NOT NULL,
  message    VARCHAR(500) NOT NULL,
  is_read    TINYINT(1) NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_notif_user (user_id, is_read, created_at),
  CONSTRAINT fk_notif_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- ------------------------------------------------------------
-- audit_logs : trace des actions d'administration
--  Pas de suppression en cascade : le journal survit à la suppression de l'admin.
-- ------------------------------------------------------------
CREATE TABLE audit_logs (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  admin_id   INT NULL,
  action     VARCHAR(50) NOT NULL,
  entity     VARCHAR(30) NOT NULL,
  entity_id  INT NULL,
  details    VARCHAR(500) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_audit_created (created_at),
  CONSTRAINT fk_audit_admin FOREIGN KEY (admin_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB;

-- ============================================================
--  Données de démonstration
--  Admin : admin@booking.tn / Admin123!     Utilisateur : user@booking.tn / User1234!
--  (à changer avant tout déploiement)
-- ============================================================
INSERT INTO users (name, email, password_hash, phone, role) VALUES
-- Téléphones : 8 chiffres, préfixe 20–29, 50–59 ou 90–99 (règle de validators.phone).
 ('Administrateur', 'admin@booking.tn', '$2b$10$LIYQMG/k8e9V0M5lq7w9pOA6PGPW0vLYrXM7LhrF45WJBqjNUaqMW', '50000000', 'ADMIN'),
 ('Utilisateur Test', 'user@booking.tn', '$2b$10$LbrabO07lkM1v7B8n5kwIeVegR8A2OKFN4PYz6lR5jGxFrZbQvLz2', '20000000', 'USER');

INSERT INTO services (name, type, description, location, price) VALUES
 ('Hôtel Tunis Palace',     'HOTEL',  'Hôtel 5 étoiles en centre-ville, petit-déjeuner inclus.', 'Tunis',     180.00),
 ('Hôtel Sousse Beach',     'HOTEL',  'Hôtel en bord de mer avec piscine et spa.',               'Sousse',    120.00),
 ('Vol Tunis - Paris',      'FLIGHT', 'Vol direct Tunis-Carthage vers Paris CDG.',               'Tunis',     310.00),
 ('Vol Tunis - Istanbul',   'FLIGHT', 'Vol direct vers Istanbul, bagage en soute inclus.',       'Tunis',     275.00),
 ('Festival International de Carthage', 'EVENT', 'Soirée de gala au théâtre antique de Carthage.',  'Carthage',   60.00),
 ('Conférence Tech Tunisia','EVENT',  'Conférence annuelle sur le numérique et l''IA.',           'Tunis',      45.00);

-- Créneau d'exemple de l'Hôtel Tunis Palace : 30 places dont 12 disponibles.
-- Date relative (aujourd'hui + 11 jours) pour que la démo reste réservable quel que soit le jour d'import.
INSERT INTO availabilities (service_id, date, total_slots, available_slots) VALUES
 (1, DATE_ADD(CURDATE(), INTERVAL 11 DAY), 30, 12);

-- Autres créneaux, relatifs à la date du jour pour rester toujours réservables
INSERT INTO availabilities (service_id, date, total_slots, available_slots) VALUES
 (1, DATE_ADD(CURDATE(), INTERVAL 20 DAY), 30, 30),
 (2, DATE_ADD(CURDATE(), INTERVAL 7 DAY),  40, 40),
 (2, DATE_ADD(CURDATE(), INTERVAL 14 DAY), 40, 25),
 (3, DATE_ADD(CURDATE(), INTERVAL 10 DAY), 150, 150),
 (3, DATE_ADD(CURDATE(), INTERVAL 17 DAY), 150, 90),
 (4, DATE_ADD(CURDATE(), INTERVAL 12 DAY), 120, 120),
 (5, DATE_ADD(CURDATE(), INTERVAL 30 DAY), 500, 500),
 (6, DATE_ADD(CURDATE(), INTERVAL 25 DAY), 200, 200);

-- Code promo de démonstration : -10 %, valable 90 jours, 100 utilisations.
INSERT INTO promo_codes (code, percent, valid_from, valid_to, max_uses, used_count, active) VALUES
 ('WELCOME10', 10, CURDATE(), DATE_ADD(CURDATE(), INTERVAL 90 DAY), 100, 0, 1);
