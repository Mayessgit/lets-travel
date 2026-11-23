# Règles métier

Chaque règle indique **où** elle est implémentée et **quel test** la vérifie
(`backend/tests/flow.test.js`, lancé par `npm test` dans `backend/`).

## Règle 1 — Réserver exige d'être authentifié

- Implémentation : `backend/src/services/bookingService.js` → `createReservation()` appelle `requireAuth(headers)`
  en première instruction. `requireAuth` (`backend/src/auth.js`) lit le JWT dans l'en-tête SOAP `AuthToken`,
  le vérifie (`jsonwebtoken`) et recharge le rôle en base.
- Erreurs : `AUTH_REQUIRED` (en-tête absent), `INVALID_TOKEN` (token invalide, expiré ou compte supprimé).
- Test : **« règle 1 : réservation impossible sans authentification »** (appel sans token → `AUTH_REQUIRED`,
  appel avec `faux.token` → `INVALID_TOKEN`).

Toutes les lectures personnelles (`getReservation`, `getUserReservations`, `getPayment`, `updateUser`,
`deleteUser`) appliquent la même exigence, plus `assertOwnerOrAdmin` pour l'accès aux données d'autrui
(test **« droits : un utilisateur ne voit que ses données, les routes admin sont protégées »**).

## Règle 2 — Stock suffisant, sans survente

- Implémentation : `bookingService.createReservation()` ouvre une transaction (`withTransaction` de
  `src/db.js`), verrouille la ligne du créneau avec `SELECT *, (date < CURDATE()) AS is_past FROM availabilities
  WHERE id = ? FOR UPDATE`, puis :
  1. refuse une date passée → `DATE_PASSED` ;
  2. refuse si `available_slots < quantity` → `NOT_ENOUGH_SLOTS` ;
  3. décrémente sinon (`UPDATE availabilities SET available_slots = available_slots - ?`).
  La quantité est bornée à 100 (`MAX_QUANTITY`, erreur `VALIDATION_ERROR`).
- Test : **« règles 2 et 5 : réservation et décrément du stock »** (demande `availableSlots + 1` → 
  `NOT_ENOUGH_SLOTS`) et **« concurrence : 15 réservations simultanées pour 5 places => jamais de survente »**
  (exactement 5 succès, 10 refus, stock final à 0).
- Défense supplémentaire : contrainte SQL `chk_slots`
  (`available_slots >= 0 AND available_slots <= total_slots`), voir `docs/BASE_DE_DONNEES.md`.

## Règle 3 — `CONFIRMED` uniquement si le paiement est `PAID`

- Implémentation : `backend/src/services/paymentService.js` → `createPayment()`. Le montant est recalculé
  côté serveur (`reservations.total_price`) ; le statut vaut `FAILED` si `simulateFailure` vaut `true`, `PAID`
  sinon ; **seul** le cas `PAID` exécute `UPDATE reservations SET status = 'CONFIRMED'`. Les deux écritures
  sont dans la même transaction : pas de réservation confirmée sans paiement enregistré.
- Erreurs : `ALREADY_PAID` (réservation déjà confirmée), `RESERVATION_CANCELLED`, `PAYMENT_EXISTS`.
- Test : **« règle 3 : paiement échoué puis réussi, la réservation devient CONFIRMED »** (après l'échec la
  réservation reste `PENDING`, après le succès elle est `CONFIRMED`, puis `ALREADY_PAID`).
- Parcours client : « Mes réservations » → « Payer » ouvre une **page de paiement dédiée**
  (`frontend/src/PaymentPage.jsx`) qui recharge la réservation, vérifie qu'elle est toujours `PENDING`, puis
  envoie `createPayment` avec le moyen choisi (carte, PayPal ou virement). Les données de carte ne quittent
  jamais le navigateur : seuls `reservationId`, `method` et `simulateFailure` sont transmis. Un échec laisse
  l'utilisateur sur la page pour réessayer ; une erreur serveur (réservation expirée, annulée) ramène à la
  liste avec un toast.

## Règle 4 — L'annulation passe la réservation à `CANCELLED`

- Implémentation : `backend/src/domain.js` → `cancelReservationTx(conn, r)` met
  `reservations.status = 'CANCELLED'`. Elle est appelée par :
  - `bookingService.cancelReservation()` (client ou admin, après `assertOwnerOrAdmin`),
  - `paymentService.refundPayment()` (admin),
  - `expiry.expirePendingReservations()` (expiration automatique).
- Erreur : `ALREADY_CANCELLED` si la réservation est déjà annulée (le statut `CANCELLED` est terminal).
- Test : **« règles 4 et 5 : annulation => places restituées et paiement remboursé »**.

## Règle 5 — Places décrémentées à la réservation, restituées à l'annulation

- Implémentation :
  - décrément : `bookingService.createReservation()` (voir règle 2) ;
  - ajustement : `bookingService.updateReservation()` calcule `delta = nouvelleQuantité - ancienneQuantité`,
    verrouille le créneau (`FOR UPDATE`), refuse un delta supérieur au stock (`NOT_ENOUGH_SLOTS`) et met à jour
    le stock et `total_price` (prix unitaire figé à la réservation) ;
  - restitution : `domain.cancelReservationTx()` fait
    `UPDATE availabilities SET available_slots = available_slots + quantity`, après avoir verrouillé la ligne
    du créneau.
- Tests : **« règles 2 et 5 »** (stock avant/après réservation), **« modification de quantité tant que la
  réservation est en attente »**, **« règles 4 et 5 »** (stock restauré à sa valeur initiale après annulation).

## Expiration automatique (réservations impayées)

- Implémentation : `backend/src/expiry.js` →
  - `expirePendingReservations()` sélectionne les réservations `PENDING` dont
    `created_at < NOW() - INTERVAL ? MINUTE` (`RESERVATION_TTL_MINUTES`, 15 par défaut), puis pour chacune
    ouvre une transaction, **reverrouille** la ligne (`SELECT ... WHERE id = ? AND status = 'PENDING' FOR UPDATE`)
    et la re-vérifie : un paiement arrivé entre-temps n'est donc jamais annulé ;
  - `startExpiryJob()` lance le traitement au démarrage puis toutes les 60 s (`setInterval(...).unref()` pour
    ne pas retenir le processus).
- Effet : statut `CANCELLED`, places restituées, paiement éventuel `PAID` remboursé (`REFUNDED`).
- Test : **« expiration : une réservation impayée est annulée, une payée est épargnée »** (les dates de
  création sont vieillies de 30 min en base, puis `expirePendingReservations()` est appelé directement).
- Affichage : la page de paiement et « Mes réservations » rappellent le délai (« annulée automatiquement
  après N minutes »), la valeur venant de `RESERVATION_TTL_MINUTES` (15 par défaut) et restant alignée côté
  frontend via `VITE_RESERVATION_TTL_MINUTES`, initialisée à 15.

## Remboursement

Deux chemins, un seul comportement :

| Déclencheur | Opération | Qui | Effet |
|---|---|---|---|
| Le client annule une réservation payée | `cancelReservation` | propriétaire ou admin | réservation `CANCELLED`, paiement `PAID → REFUNDED`, places restituées |
| L'administrateur rembourse | `refundPayment` | admin | idem, mais refuse un paiement non `PAID` (`NOT_REFUNDABLE`) |

Implémentation : `paymentService.refundPayment()` verrouille le paiement (`FOR UPDATE`), vérifie
`status === 'PAID'`, verrouille la réservation puis délègue à `cancelReservationTx`, qui exécute
`UPDATE payments SET status = 'REFUNDED' WHERE reservation_id = ? AND status = 'PAID'`.
Tests : **« règles 4 et 5 »** (remboursement automatique) et **« remboursement administrateur »**
(`FORBIDDEN` pour un USER, `NOT_REFUNDABLE` au second passage).

## Relation paiement / réservation

- La relation est **1:1**, garantie par `payments.reservation_id UNIQUE` (voir `docs/BASE_DE_DONNEES.md`).
- `createPayment` : si une ligne existe déjà et n'est pas `FAILED` → `PAYMENT_EXISTS` ; si elle est `FAILED`,
  la ligne est **mise à jour** (nouvelle `transaction_ref`, nouveau statut) — un seul paiement par réservation.
- `getPaymentByReservation` renvoie l'unique paiement, ou `NOT_FOUND`.
- Test : **« règle 3 »** vérifie que `getPaymentByReservation` renvoie l'identifiant du paiement réussi.

## Droits par rôle

Rôles : `USER` (client) et `ADMIN`. Un utilisateur n'accède qu'à **ses** données ;
`assertOwnerOrAdmin` lève `FORBIDDEN` sinon. Un admin accède à tout mais ne peut pas se retirer le dernier rôle
administratif.

| Opération | Public | USER | ADMIN |
|---|---|---|---|
| `registerUser`, `loginUser` | ✅ | ✅ | ✅ |
| `getAllServices`, `getServiceById`, `searchServices`, `checkAvailability`, `getAvailableSlots` | ✅ | ✅ | ✅ |
| `getUser`, `updateUser`, `deleteUser` | ❌ | ✅ ses données | ✅ tous les comptes |
| `listUsers` | ❌ | ❌ | ✅ |
| `createReservation` | ❌ | ✅ | ✅ |
| `getReservation`, `cancelReservation`, `updateReservation` | ❌ | ✅ ses réservations | ✅ toutes |
| `getUserReservations` | ❌ | ✅ les siennes | ✅ celles d'un autre via `userId` |
| `getAllReservations` | ❌ | ❌ | ✅ |
| `createPayment`, `getPayment`, `getPaymentByReservation` | ❌ | ✅ ses paiements | ✅ tous |
| `refundPayment`, `getAllPayments` | ❌ | ❌ | ✅ |
| `createService`, `updateService`, `deleteService`, `setAvailability` | ❌ | ❌ | ✅ |
| Changement de rôle (`updateUser.role`) | ❌ | ❌ | ✅ (dernier ADMIN protégé) |

Détail des contrôles :

- `requireAdmin` : `createService`, `updateService`, `deleteService`, `setAvailability`, `listUsers`,
  `getAllReservations`, `getAllPayments`, `refundPayment`, et la modification de `role` dans `updateUser`.
- `assertOwnerOrAdmin` : `getUser`, `updateUser`, `deleteUser`, `getReservation`, `getUserReservations`,
  `cancelReservation`, `updateReservation`, `createPayment`, `getPayment`, `getPaymentByReservation`.

## Protection du dernier administrateur

`userService.assertNotLastAdmin(target)` refuse (`LAST_ADMIN`) une suppression ou une rétrogradation qui
laisserait zéro `ADMIN`. Pour la suppression de **son propre** compte, le mot de passe est vérifié **avant**
cette règle, afin de ne pas révéler l'état du système à un appelant non authentifié.
Test : **« dernier administrateur : ni rétrogradation ni suppression »** (mot de passe correct fourni,
le compte existe toujours après).

## Anti force brute

`backend/src/loginLimiter.js` conserve en mémoire (Map) les échecs par email en minuscules, dans une fenêtre
glissante de `LOGIN_LOCK_MINUTES` (15). `loginUser` appelle `assertNotLocked(email)` **avant** de comparer le
mot de passe : au-delà de `LOGIN_MAX_ATTEMPTS` (5) échecs, même un mot de passe correct renvoie
`TOO_MANY_ATTEMPTS`. Un succès remet le compteur à zéro (`recordSuccess`). Un timer `unref()` purge les entrées
expirées toutes les minutes.
Test : **« anti force brute : verrouillage après plusieurs échecs, succès remet à zéro »** (compte jetable
`test.lock.<timestamp>@example.com`, jamais les comptes de démo).

## Gestion de la concurrence

- Toutes les opérations qui modifient le stock ou l'argent passent par `withTransaction` (`src/db.js`) :
  `BEGIN` → travail → `COMMIT`, avec `ROLLBACK` automatique en cas d'erreur.
- Verrous de ligne explicites (`SELECT ... FOR UPDATE`) sur :
  - `availabilities` à la réservation (`createReservation`), à la modification de quantité
    (`updateReservation`), à l'annulation (`cancelReservationTx`) et à la mise à jour du stock
    (`setAvailability`) ;
  - `reservations` à l'annulation, à la modification, au paiement et à l'expiration ;
  - `payments` au paiement et au remboursement.
- Ordre de verrouillage constant (créneau → réservation → paiement dans les parcours concernés) pour limiter
  les risques d'interblocage.
- `is_past` est calculé **dans la requête verrouillée** (`date < CURDATE()`), donc la décision « date passée »
  est prise sur la même lecture que la décision de stock : pas de fenêtre de course.
- Test : **« concurrence : 15 réservations simultanées pour 5 places => jamais de survente »** — 5 succès,
  10 `NOT_ENOUGH_SLOTS`, stock final égal à 0.

## Règle 6 — Favoris

- Implémentation : `backend/src/services/engagementService.js` → `addFavorite` / `removeFavorite` /
  `getFavorites`. Les deux écritures sont **idempotentes** (`INSERT IGNORE`, `DELETE`), donc un double clic sur
  le cœur ne crée pas de doublon ni d'erreur. `addFavorite` vérifie d'abord que le service existe (`NOT_FOUND`).
- Interface : cœur sur chaque carte de service ; un visiteur non connecté est renvoyé vers la connexion. Page
  « Mes favoris » dans le menu.
- Tests : **« favoris : ajout idempotent, liste, retrait, authentification exigée »**.

## Règle 7 — Avis réservés aux clients ayant payé

- Implémentation : `engagementService.saveReview` exige qu'une réservation `CONFIRMED` existe pour ce couple
  (utilisateur, service) ; sinon `NOT_ELIGIBLE`. La note est bornée à 1–5 (`VALIDATION_ERROR` sinon) et un seul
  avis par service et par utilisateur (`UNIQUE (user_id, service_id)`, upsert).
- Suppression : propriétaire ou administrateur ; toute autre tentative renvoie `FORBIDDEN`.
- Effet : `averageRating` et `reviewCount` sont recalculés en SQL (`AVG`/`COUNT` groupés, jamais de boucle
  N+1) et joints à **toutes** les réponses qui renvoient des services (`Service` du WSDL).
- Tests : **« avis : réservation confirmée exigée, note moyenne, mise à jour, droits »** et
  **« modération : l'admin supprime un avis et l'action est tracée »**.

## Règle 8 — Codes promo

- Implémentation : `backend/src/promo.js` (`lockPromo`, `loadPromo`, `releasePromo`, `discountFor`) appelé par
  `bookingService.createReservation` et `engagementService.checkPromoCode`.
- Validité, dans cet ordre : code inconnu ou inactif → `PROMO_INVALID` ; hors période → `PROMO_EXPIRED` ;
  quota atteint (`used_count >= max_uses`) → `PROMO_EXHAUSTED`.
- Consommation : la ligne du code est verrouillée (`SELECT ... FOR UPDATE`) et `used_count` est incrémenté
  **dans la même transaction** que la réservation ; un échec ultérieur (stock insuffisant) annule tout.
- Remise : `discount = arrondi(total × percent / 100)` ; `total_price` stocké est **net**, `discount_amount`
  conserve la remise. `updateReservation` réapplique le même pourcentage au nouveau total.
- Restitution : l'annulation ou l'expiration décrémente `used_count` (`GREATEST(used_count - 1, 0)`), le code
  redevient donc utilisable.
- Sans code promo, le comportement est strictement identique à la version précédente.
- Tests : **« codes promo : droits, création, aperçu, application, quota, expiration, restitution »** et
  **« modification de quantité : la remise suit le pourcentage du code promo »**.

## Règle 9 — Notifications transactionnelles

- Implémentation : `backend/src/notifications.js` (`notify(conn, userId, type, title, message)`), appelé avec la
  connexion de la transaction en cours depuis `bookingService` (réservation créée), `paymentService` (paiement
  accepté / refusé) et `domain.cancelReservationTx` (réservation annulée, paiement remboursé). `expiry.js`
  transmet la raison `expired` pour un message dédié.
- Conséquence : une notification n'existe que si l'action est validée (aucun fantôme après rollback).
- Lecture : `getMyNotifications` renvoie la liste et `unreadCount` ; `markNotificationRead` et
  `markAllNotificationsRead` mettent à jour le compteur. L'interface rafraîchit la cloche toutes les 30 s et
  libère le minuteur à la déconnexion.
- Tests : **« notifications : créées par les actions, compteur, lecture unitaire et globale »**.

## Règle 10 — Indicateurs du tableau de bord

- Implémentation : `backend/src/services/adminService.js` → `getDashboardStats`, agrégations SQL uniquement.
- Période : `days` ∈ {7, 30, 90} (défaut 30, sinon `VALIDATION_ERROR`) ; elle inclut aujourd'hui et couvre
  `days` jours. La période précédente est la fenêtre de même durée juste avant.
- `revenue` = somme des `payments.amount` au statut `PAID` créés sur la période ; les `REFUNDED` sont exclus et
  comptés dans `refundedAmount`. `averageBasket` = revenu / nombre de paiements `PAID`.
- `occupancyRate` = places réservées / places totales des créneaux **à venir**, arrondi à 0,1 % (0 si aucun
  créneau futur).
- `daily` contient exactement `days` entrées, jours sans activité compris (remplissage en mémoire après deux
  requêtes groupées).
- `lowAvailability` : dates des 30 prochains jours dont les places restantes sont ≤ 20 % du total.
- Tests : **« tableau de bord : droits, validation de days, cohérence des compteurs et du revenu »**.

## Règle 11 — Journal d'audit

- Implémentation : `backend/src/audit.js` (`audit(conn, adminId, action, entity, entityId, details)`), appelé par
  les opérations d'administration : services (création, modification, suppression), `setAvailability`,
  changement de rôle, suppression d'un utilisateur par un admin, annulation d'une réservation par un admin
  (sur le compte d'un autre), remboursement, suppression d'un avis, gestion des codes promo.
- Lecture : `getAuditLog` (admin uniquement) renvoie les entrées les plus récentes d'abord, avec `total`.
- Conservation : `admin_id` est en `ON DELETE SET NULL`, la trace survit à la suppression du compte admin.
- Tests : **« journal d'audit : réservé aux admins, alimenté par les actions »**.

