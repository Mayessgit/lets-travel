-- ============================================================
--  migration_v2.sql : mise à niveau d'une base booking_soap_db existante
--  (installation neuve : utiliser database/schema.sql à la place)
--  Import : phpMyAdmin > Importer, ou  mysql -u root < migration_v2.sql
--  Idempotent : peut être relancé sans erreur.
-- ============================================================

SET NAMES utf8mb4;
USE booking_soap_db;

-- ------------------------------------------------------------
-- Codes promo
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS promo_codes (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  code       VARCHAR(30) NOT NULL UNIQUE,
  percent    TINYINT NOT NULL CHECK (percent BETWEEN 1 AND 100),
  valid_from DATE NOT NULL,
  valid_to   DATE NOT NULL,
  max_uses   INT NULL,
  used_count INT NOT NULL DEFAULT 0,
  active     TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT chk_promo_dates CHECK (valid_to >= valid_from)
) ENGINE=InnoDB;

-- ------------------------------------------------------------
-- Favoris
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS favorites (
  user_id    INT NOT NULL,
  service_id INT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, service_id),
  CONSTRAINT fk_fav_user    FOREIGN KEY (user_id)    REFERENCES users(id)    ON DELETE CASCADE,
  CONSTRAINT fk_fav_service FOREIGN KEY (service_id) REFERENCES services(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- ------------------------------------------------------------
-- Avis (1 par utilisateur et par service)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS reviews (
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
-- Notifications
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS notifications (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  user_id    INT NOT NULL,
  type       VARCHAR(30) NOT NULL,
  title      VARCHAR(150) NOT NULL,
  message    VARCHAR(500) NOT NULL,
  is_read    TINYINT(1) NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_notif_user (user_id, is_read, created_at),
  CONSTRAINT fk_notif_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- ------------------------------------------------------------
-- Journal d'audit (admin_id en SET NULL : la trace est conservée)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS audit_logs (
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

-- ------------------------------------------------------------
-- Réservations : code promo appliqué et montant de la remise
-- ------------------------------------------------------------
ALTER TABLE reservations ADD COLUMN IF NOT EXISTS promo_code VARCHAR(30) NULL AFTER total_price;
ALTER TABLE reservations ADD COLUMN IF NOT EXISTS discount_amount DECIMAL(10,2) NULL AFTER promo_code;

-- ------------------------------------------------------------
-- Index utiles au tableau de bord
-- ------------------------------------------------------------
ALTER TABLE reservations ADD INDEX IF NOT EXISTS idx_res_status (status);
ALTER TABLE reservations ADD INDEX IF NOT EXISTS idx_res_created (created_at);
ALTER TABLE payments     ADD INDEX IF NOT EXISTS idx_pay_status (status);
ALTER TABLE payments     ADD INDEX IF NOT EXISTS idx_pay_created (created_at);

-- ------------------------------------------------------------
-- Code promo de démonstration (ignoré s'il existe déjà)
-- ------------------------------------------------------------
INSERT IGNORE INTO promo_codes (code, percent, valid_from, valid_to, max_uses, used_count, active) VALUES
 ('WELCOME10', 10, CURDATE(), DATE_ADD(CURDATE(), INTERVAL 90 DAY), 100, 0, 1);
