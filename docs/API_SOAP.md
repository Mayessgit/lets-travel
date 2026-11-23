# API SOAP — référence

Contrat unique, maintenu à la main : [`backend/src/wsdl/booking.wsdl`](../backend/src/wsdl/booking.wsdl).
Style **document/literal**, namespace `http://booking.example.com/soap`, **44 opérations** réparties sur
6 points d'accès. Le même WSDL est servi sur chacun d'eux (`?wsdl`).

| Service | URL | Opérations |
|---|---|---|
| `UserService` | `http://localhost:4000/soap/user` | 6 |
| `AvailabilityService` | `http://localhost:4000/soap/availability` | 9 |
| `BookingService` | `http://localhost:4000/soap/booking` | 6 |
| `PaymentService` | `http://localhost:4000/soap/payment` | 6 |
| `EngagementService` | `http://localhost:4000/soap/engagement` | 10 (voir §8.1) |
| `AdminService` | `http://localhost:4000/soap/admin` | 7 (voir §8.2) |

Toutes les requêtes sont des `POST` avec `Content-Type: text/xml; charset=utf-8` et un corps XML complet.
Les réponses sont du XML SOAP. Toute erreur métier est un **SOAP Fault** en HTTP 500 (voir §5).

## 1. En-tête d'authentification

Le jeton renvoyé par `loginUser` se transmet dans l'**en-tête SOAP**, jamais dans le corps ni dans l'URL :

```xml
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"
                  xmlns:tns="http://booking.example.com/soap">
  <soapenv:Header>
    <tns:AuthToken>eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...</tns:AuthToken>
  </soapenv:Header>
  <soapenv:Body>
    <!-- opération -->
  </soapenv:Body>
</soapenv:Envelope>
```

- Le préfixe `Bearer ` est toléré (`auth.extractToken` le retire).
- Le token est un **JWT HS256** contenant `sub` (identifiant) et `role`, valable `JWT_EXPIRES_IN` (2 h).
- `requireAuth` recharge le rôle en base à chaque appel : une suppression de compte ou une rétrogradation
  s'applique immédiatement.
- En-tête absent → `AUTH_REQUIRED` ; token invalide, expiré ou compte supprimé → `INVALID_TOKEN`.
- Rôle insuffisant → `FORBIDDEN` ; ressource appartenant à un autre utilisateur → `FORBIDDEN`.

Modernes clients acceptent aussi `SOAPAction: http://booking.example.com/soap/<opération>` (facultatif,
node-soap route d'après le premier élément du `Body`).

## 2. Types de réponse

| Type | Champs (dans l'ordre du WSDL) |
|---|---|
| `User` | `id`, `name`, `email`, `phone`*, `avatar`*, `role`, `createdAt` |
| `Service` | `id`, `name`, `type`, `description`*, `location`, `imageUrl`*, `price`, `createdAt`, `averageRating`*, `reviewCount`* |
| `Availability` | `id`, `serviceId`, `date`, `totalSlots`, `availableSlots` |
| `Reservation` | `id`, `userId`, `serviceId`, `availabilityId`, `quantity`, `totalPrice`, `status`, `createdAt`, `serviceName`*, `serviceType`*, `date`*, `promoCode`*, `discountAmount`* |
| `Payment` | `id`, `reservationId`, `amount`, `method`, `transactionRef`, `status`, `createdAt`, `serviceName`*, `date`* |
| `Review` | `id`, `userId`, `serviceId`, `rating`, `comment`*, `createdAt`, `updatedAt`, `userName`*, `serviceName`* |
| `Notification` | `id`, `type`, `title`, `message`, `isRead`, `createdAt` |
| `PromoCode` | `id`, `code`, `percent`, `validFrom`, `validTo`, `maxUses`*, `usedCount`, `active` |
| `AuditEntry` | `id`, `adminId`*, `adminName`*, `action`, `entity`, `entityId`*, `details`*, `createdAt` |
| `KpiStats` | `totalUsers`, `newUsers`, `totalServices`, `totalReservations`, `pendingReservations`, `confirmedReservations`, `cancelledReservations`, `revenue`, `previousRevenue`, `reservationsInPeriod`, `previousReservations`, `refundedAmount`, `averageBasket`, `occupancyRate` |
| `DailyPoint` | `date`, `reservations`, `revenue` |
| `TypeStat` | `type`, `reservations`, `revenue` |
| `MethodStat` | `method`, `payments`, `amount` |
| `TopServiceStat` | `serviceId`, `name`, `type`, `reservations`, `revenue` |
| `LowAvailabilityStat` | `serviceId`, `serviceName`, `date`, `availableSlots`, `totalSlots` |
| `DashboardStats` | `kpis`, `daily[]`, `byType[]`, `byMethod[]`, `topServices[]`, `lowAvailability[]`, `recent[]` |

`*` = facultatif (`minOccurs="0"`) : les valeurs `NULL` en base sont **omises** de la réponse
(`backend/src/mappers.js`). `listUsers` ne renvoie volontairement jamais `avatar`.

## 3. Opérations

### 3.1 `UserService` — `/soap/user`

#### `registerUser` — public

| Paramètre | Type | Obligatoire | Contraintes |
|---|---|---|---|
| `name` | string | oui | 2 à 100 caractères |
| `email` | string | oui | format email, ≤ 150, stocké en minuscules |
| `password` | string | oui | 8 à 72 caractères, au moins une lettre et un chiffre |
| `phone` | string | non | **exactement 8 chiffres**, commençant par 20–29, 50–59 ou 90–99 (ni `+216`, ni espaces, ni tirets) |

Réponse : `user` (`User`). Le rôle est toujours `USER` (jamais choisi par le client).
Erreurs : `VALIDATION_ERROR`, `EMAIL_EXISTS`, `DUPLICATE`, `INTERNAL_ERROR`.

#### `loginUser` — public

| Paramètre | Type | Obligatoire | Contraintes |
|---|---|---|---|
| `email` | string | oui | format email |
| `password` | string | oui | ≤ 72 caractères |

Réponse : `token` (JWT) + `user`.
Erreurs : `VALIDATION_ERROR`, `BAD_CREDENTIALS` (email inconnu **ou** mot de passe faux),
`TOO_MANY_ATTEMPTS` (après `LOGIN_MAX_ATTEMPTS` échecs en `LOGIN_LOCK_MINUTES` minutes ; vérifié **avant**
la comparaison du mot de passe).

#### `getUser` — authentifié (propriétaire) ou admin

| Paramètre | Type | Obligatoire | Contraintes |
|---|---|---|---|
| `userId` | int | non | par défaut : l'utilisateur du token |

Réponse : `user`. Erreurs : `AUTH_REQUIRED`, `INVALID_TOKEN`, `VALIDATION_ERROR`, `FORBIDDEN`, `NOT_FOUND`.

#### `updateUser` — authentifié (propriétaire) ou admin

| Paramètre | Type | Obligatoire | Contraintes |
|---|---|---|---|
| `userId` | int | non | par défaut : soi-même |
| `name` | string | non | 2 à 100 caractères |
| `phone` | string | non | **exactement 8 chiffres** commençant par 20–29, 50–59 ou 90–99 ; une **chaîne vide est ignorée** (`opt()`) |
| `removePhone` | boolean | non | `true` → `phone = NULL` (prioritaire sur `phone`) |
| `avatar` | string | non | data URL JPEG/PNG/WebP, 150 000 caractères max (~110 Ko) |
| `removeAvatar` | boolean | non | `true` → `avatar = NULL` (prioritaire sur `avatar`) |
| `currentPassword` | string | non | **obligatoire** si l'appelant modifie son propre mot de passe |
| `password` | string | non | nouveau mot de passe (mêmes règles que `registerUser`) |
| `role` | string | non | `USER` ou `ADMIN` — **admin uniquement**, refuse de rétrograder le dernier ADMIN |

Réponse : `user`. Au moins un champ doit être fourni, sinon `VALIDATION_ERROR` (« Aucune donnée à modifier. »).
Réinitialisation par l'admin : `userId` + `password`, **sans** `currentPassword`, quand l'appelant est ADMIN et
vise un autre compte.
Erreurs : `AUTH_REQUIRED`, `INVALID_TOKEN`, `VALIDATION_ERROR`, `FORBIDDEN`, `NOT_FOUND`, `BAD_CREDENTIALS`,
`LAST_ADMIN`.

#### `deleteUser` — authentifié (propriétaire) ou admin

| Paramètre | Type | Obligatoire | Contraintes |
|---|---|---|---|
| `userId` | int | non | par défaut : soi-même |
| `password` | string | **oui pour son propre compte** | vérifié avant `LAST_ADMIN` ; inutile quand un admin supprime un autre compte |

Réponse : `message`.
Erreurs : `AUTH_REQUIRED`, `INVALID_TOKEN`, `VALIDATION_ERROR`, `FORBIDDEN`, `NOT_FOUND`, `BAD_CREDENTIALS`,
`LAST_ADMIN` (seul administrateur), `HAS_ACTIVE_RESERVATIONS` (réservations non annulées).

#### `listUsers` — admin

Aucun paramètre.
Réponse : `user*` (liste, **sans** `avatar`). Erreurs : `AUTH_REQUIRED`, `INVALID_TOKEN`, `FORBIDDEN`.

### 3.2 `AvailabilityService` — `/soap/availability`

#### `getAllServices` — public

| Paramètre | Type | Obligatoire | Contraintes |
|---|---|---|---|
| `type` | string | non | `HOTEL`, `FLIGHT` ou `EVENT` |

Réponse : `service*`. Erreurs : `VALIDATION_ERROR`.

#### `getServiceById` — public

| Paramètre | Type | Obligatoire | Contraintes |
|---|---|---|---|
| `serviceId` | int | oui | ≥ 1 |

Réponse : `service`. Erreurs : `VALIDATION_ERROR`, `NOT_FOUND`.

#### `searchServices` — public

| Paramètre | Type | Obligatoire | Contraintes |
|---|---|---|---|
| `keyword` | string | non | ≤ 100, cherche dans le nom et la description |
| `type` | string | non | `HOTEL`, `FLIGHT`, `EVENT` |
| `location` | string | non | ≤ 150, recherche partielle |
| `maxPrice` | decimal | non | ≥ 0 |
| `date` | string | non | `AAAA-MM-JJ` ; ne garde que les services ayant un créneau **avec des places** ce jour-là |

Réponse : `service*`. Erreurs : `VALIDATION_ERROR`.

#### `checkAvailability` — public

| Paramètre | Type | Obligatoire | Contraintes |
|---|---|---|---|
| `serviceId` | int | oui | ≥ 1 |
| `date` | string | oui | `AAAA-MM-JJ` |
| `quantity` | int | non | ≥ 1, défaut 1 |

Réponse : `available` (boolean), `availableSlots` (int), `availability` (facultatif : absent si aucun créneau).
Erreurs : `VALIDATION_ERROR`, `NOT_FOUND` (service inconnu).

#### `getAvailableSlots` — public

| Paramètre | Type | Obligatoire | Contraintes |
|---|---|---|---|
| `serviceId` | int | oui | ≥ 1 |
| `includeAll` | boolean | non | `true` → **toutes** les dates du service (passées, complètes), triées par date. Par défaut : dates ≥ aujourd'hui **et** `availableSlots > 0` |

Réponse : `availability*`. Erreurs : `VALIDATION_ERROR`, `NOT_FOUND`.
L'option `includeAll` est utilisée par l'onglet d'administration (« Dates ») pour afficher les badges
« Complet » et « Passée » ; le site public ne l'active jamais.

#### `createService` — admin

| Paramètre | Type | Obligatoire | Contraintes |
|---|---|---|---|
| `name` | string | oui | ≤ 150 |
| `type` | string | oui | `HOTEL`, `FLIGHT`, `EVENT` |
| `description` | string | non | ≤ 5 000 |
| `location` | string | oui | ≤ 150 |
| `imageUrl` | string | non | ≤ 500, doit commencer par `/` ou `http(s)://` |
| `price` | decimal | oui | ≥ 0 |

Réponse : `service`. Erreurs : `AUTH_REQUIRED`, `INVALID_TOKEN`, `FORBIDDEN`, `VALIDATION_ERROR`.

#### `updateService` — admin

| Paramètre | Type | Obligatoire | Contraintes |
|---|---|---|---|
| `serviceId` | int | oui | ≥ 1 |
| `name`, `type`, `description`, `location`, `imageUrl`, `price` | — | non | mêmes contraintes que `createService` |

Réponse : `service`. Au moins un champ modifiable est requis (`VALIDATION_ERROR`).
Erreurs : `AUTH_REQUIRED`, `INVALID_TOKEN`, `FORBIDDEN`, `VALIDATION_ERROR`, `NOT_FOUND`.

#### `deleteService` — admin

| Paramètre | Type | Obligatoire | Contraintes |
|---|---|---|---|
| `serviceId` | int | oui | ≥ 1 |

Réponse : `message`. Erreurs : `AUTH_REQUIRED`, `INVALID_TOKEN`, `FORBIDDEN`, `VALIDATION_ERROR`, `NOT_FOUND`,
`IN_USE` (au moins une réservation référence le service ou un de ses créneaux).

#### `setAvailability` — admin

| Paramètre | Type | Obligatoire | Contraintes |
|---|---|---|---|
| `serviceId` | int | oui | ≥ 1 |
| `date` | string | oui | `AAAA-MM-JJ` |
| `totalSlots` | int | oui | ≥ 0 ; ne peut pas descendre sous le nombre de places déjà réservées |

Réponse : `availability`. Le créneau est créé s'il n'existe pas, mis à jour sinon (contrainte
`UNIQUE (service_id, date)`), le stock libre étant recalculé (`total - réservées`).
Erreurs : `AUTH_REQUIRED`, `INVALID_TOKEN`, `FORBIDDEN`, `VALIDATION_ERROR`, `NOT_FOUND`, `BELOW_BOOKED`.

### 3.3 `BookingService` — `/soap/booking`

#### `createReservation` — authentifié

| Paramètre | Type | Obligatoire | Contraintes |
|---|---|---|---|
| `availabilityId` | int | oui | ≥ 1 |
| `quantity` | int | oui | 1 à 100 |

Réponse : `reservation` avec `status = PENDING`, `totalPrice = prix unitaire × quantity`.
Erreurs : `AUTH_REQUIRED`, `INVALID_TOKEN`, `VALIDATION_ERROR`, `NOT_FOUND`, `DATE_PASSED`,
`NOT_ENOUGH_SLOTS`.

#### `getReservation` — authentifié (propriétaire) ou admin

| Paramètre | Type | Obligatoire | Contraintes |
|---|---|---|---|
| `reservationId` | int | oui | ≥ 1 |

Réponse : `reservation`. Erreurs : `AUTH_REQUIRED`, `INVALID_TOKEN`, `VALIDATION_ERROR`, `NOT_FOUND`, `FORBIDDEN`.

#### `getUserReservations` — authentifié (propriétaire) ou admin

| Paramètre | Type | Obligatoire | Contraintes |
|---|---|---|---|
| `userId` | int | non | par défaut : soi-même ; un USER ne peut pas viser un autre compte |
| `status` | string | non | `PENDING`, `CONFIRMED`, `CANCELLED` |

Réponse : `reservation*` (plus récentes d'abord). Erreurs : `AUTH_REQUIRED`, `INVALID_TOKEN`,
`VALIDATION_ERROR`, `FORBIDDEN`.

#### `cancelReservation` — authentifié (propriétaire) ou admin

| Paramètre | Type | Obligatoire | Contraintes |
|---|---|---|---|
| `reservationId` | int | oui | ≥ 1 |

Réponse : `reservation` avec `status = CANCELLED`. Restitue les places et rembourse un paiement `PAID`.
Erreurs : `AUTH_REQUIRED`, `INVALID_TOKEN`, `VALIDATION_ERROR`, `NOT_FOUND`, `FORBIDDEN`, `ALREADY_CANCELLED`.

#### `updateReservation` — authentifié (propriétaire) ou admin

| Paramètre | Type | Obligatoire | Contraintes |
|---|---|---|---|
| `reservationId` | int | oui | ≥ 1 |
| `quantity` | int | oui | 1 à 100 |

Réponse : `reservation` recalculée (prix unitaire figé). Uniquement si `status = PENDING`.
Erreurs : `AUTH_REQUIRED`, `INVALID_TOKEN`, `VALIDATION_ERROR`, `NOT_FOUND`, `FORBIDDEN`, `NOT_EDITABLE`,
`NOT_ENOUGH_SLOTS`.

#### `getAllReservations` — admin

| Paramètre | Type | Obligatoire | Contraintes |
|---|---|---|---|
| `status` | string | non | `PENDING`, `CONFIRMED`, `CANCELLED` |

Réponse : `reservation*`. Erreurs : `AUTH_REQUIRED`, `INVALID_TOKEN`, `FORBIDDEN`, `VALIDATION_ERROR`.

### 3.4 `PaymentService` — `/soap/payment`

#### `createPayment` — authentifié (propriétaire) ou admin

| Paramètre | Type | Obligatoire | Contraintes |
|---|---|---|---|
| `reservationId` | int | oui | ≥ 1 |
| `method` | string | oui | `CARD`, `PAYPAL`, `BANK_TRANSFER` |
| `simulateFailure` | boolean | non | `true` → paiement `FAILED` (scénario de test) |

Réponse : `payment` (`PAID` → réservation `CONFIRMED` ; `FAILED` → la réservation reste `PENDING`).
Le montant est **toujours** recalculé côté serveur depuis `reservations.total_price`.
Après un `FAILED`, un nouvel appel réutilise la ligne (relation 1:1).
Erreurs : `AUTH_REQUIRED`, `INVALID_TOKEN`, `VALIDATION_ERROR`, `NOT_FOUND`, `FORBIDDEN`,
`RESERVATION_CANCELLED`, `ALREADY_PAID`, `PAYMENT_EXISTS`, `DUPLICATE`.

#### `getPayment` — authentifié (propriétaire) ou admin

| Paramètre | Type | Obligatoire | Contraintes |
|---|---|---|---|
| `paymentId` | int | oui | ≥ 1 |

Réponse : `payment`. Erreurs : `AUTH_REQUIRED`, `INVALID_TOKEN`, `VALIDATION_ERROR`, `NOT_FOUND`, `FORBIDDEN`.

#### `getPaymentByReservation` — authentifié (propriétaire) ou admin

| Paramètre | Type | Obligatoire | Contraintes |
|---|---|---|---|
| `reservationId` | int | oui | ≥ 1 |

Réponse : `payment`. Erreurs : `AUTH_REQUIRED`, `INVALID_TOKEN`, `VALIDATION_ERROR`, `NOT_FOUND`, `FORBIDDEN`.

#### `refundPayment` — admin

| Paramètre | Type | Obligatoire | Contraintes |
|---|---|---|---|
| `paymentId` | int | oui | ≥ 1 |

Réponse : `payment` (`REFUNDED`) ; la réservation passe à `CANCELLED` et les places sont restituées.
Erreurs : `AUTH_REQUIRED`, `INVALID_TOKEN`, `VALIDATION_ERROR`, `NOT_FOUND`, `FORBIDDEN`, `NOT_REFUNDABLE`
(seul un paiement `PAID` est remboursable).

#### `getAllPayments` — admin

| Paramètre | Type | Obligatoire | Contraintes |
|---|---|---|---|
| `status` | string | non | `PENDING`, `PAID`, `FAILED`, `REFUNDED` |

Réponse : `payment*`. Erreurs : `AUTH_REQUIRED`, `INVALID_TOKEN`, `FORBIDDEN`, `VALIDATION_ERROR`.

## 4. Exemples complets

### 4.1 `loginUser`

Requête (`POST http://localhost:4000/soap/user`, `Content-Type: text/xml`):

```xml
<?xml version="1.0" encoding="utf-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"
                  xmlns:tns="http://booking.example.com/soap">
  <soapenv:Body>
    <tns:loginUser>
      <tns:email>user@booking.tn</tns:email>
      <tns:password>User1234!</tns:password>
    </tns:loginUser>
  </soapenv:Body>
</soapenv:Envelope>
```

Réponse :

```xml
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"
               xmlns:tns="http://booking.example.com/soap">
  <soap:Body>
    <tns:loginUserResponse>
      <tns:token>eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOjIsInJvbGUiOiJVU0VSIn0...</tns:token>
      <tns:user>
        <tns:id>2</tns:id>
        <tns:name>Utilisateur Test</tns:name>
        <tns:email>user@booking.tn</tns:email>
        <tns:phone>20000000</tns:phone>
        <tns:role>USER</tns:role>
        <tns:createdAt>2026-11-08 10:12:45</tns:createdAt>
      </tns:user>
    </tns:loginUserResponse>
  </soap:Body>
</soap:Envelope>
```

### 4.2 `createReservation`

Requête (en-tête `AuthToken` obligatoire) :

```xml
<?xml version="1.0" encoding="utf-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"
                  xmlns:tns="http://booking.example.com/soap">
  <soapenv:Header>
    <tns:AuthToken>{{token}}</tns:AuthToken>
  </soapenv:Header>
  <soapenv:Body>
    <tns:createReservation>
      <tns:availabilityId>3</tns:availabilityId>
      <tns:quantity>2</tns:quantity>
    </tns:createReservation>
  </soapenv:Body>
</soapenv:Envelope>
```

Réponse :

```xml
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"
               xmlns:tns="http://booking.example.com/soap">
  <soap:Body>
    <tns:createReservationResponse>
      <tns:reservation>
        <tns:id>1</tns:id>
        <tns:userId>2</tns:userId>
        <tns:serviceId>2</tns:serviceId>
        <tns:availabilityId>3</tns:availabilityId>
        <tns:quantity>2</tns:quantity>
        <tns:totalPrice>240</tns:totalPrice>
        <tns:status>PENDING</tns:status>
        <tns:createdAt>2026-11-08 10:15:02</tns:createdAt>
        <tns:serviceName>Hôtel Sousse Beach</tns:serviceName>
        <tns:serviceType>HOTEL</tns:serviceType>
        <tns:date>2026-11-15</tns:date>
      </tns:reservation>
    </tns:createReservationResponse>
  </soap:Body>
</soap:Envelope>
```

### 4.3 `createPayment`

Requête :

```xml
<?xml version="1.0" encoding="utf-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"
                  xmlns:tns="http://booking.example.com/soap">
  <soapenv:Header>
    <tns:AuthToken>{{token}}</tns:AuthToken>
  </soapenv:Header>
  <soapenv:Body>
    <tns:createPayment>
      <tns:reservationId>1</tns:reservationId>
      <tns:method>CARD</tns:method>
    </tns:createPayment>
  </soapenv:Body>
</soapenv:Envelope>
```

Réponse (la réservation est passée `CONFIRMED` dans la même transaction) :

```xml
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"
               xmlns:tns="http://booking.example.com/soap">
  <soap:Body>
    <tns:createPaymentResponse>
      <tns:payment>
        <tns:id>1</tns:id>
        <tns:reservationId>1</tns:reservationId>
        <tns:amount>240</tns:amount>
        <tns:method>CARD</tns:method>
        <tns:transactionRef>TXN-9F3C1A7B2E40</tns:transactionRef>
        <tns:status>PAID</tns:status>
        <tns:createdAt>2026-11-08 10:16:20</tns:createdAt>
      </tns:payment>
    </tns:createPaymentResponse>
  </soap:Body>
</soap:Envelope>
```

## 5. Exemple de SOAP Fault

Tous les faults utilisent le statut HTTP **500** et le format SOAP 1.1. `faultstring` est le message en
français, `detail/code` le code stable exploité par le frontend
(`src/errors.js` → `fault(code, message)`).

```xml
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <soap:Fault>
      <faultcode>soap:Client</faultcode>
      <faultstring>Places insuffisantes : 1 disponible(s).</faultstring>
      <detail>
        <code>NOT_ENOUGH_SLOTS</code>
      </detail>
    </soap:Fault>
  </soap:Body>
</soap:Envelope>
```

`INTERNAL_ERROR` utilise `faultcode = soap:Server` ; tous les autres codes sont `soap:Client`.

## 6. Codes d'erreur

| Code | Message / signification | Opérations concernées |
|---|---|---|
| `VALIDATION_ERROR` | Champ manquant, invalide, hors bornes, énumération inconnue, « Aucune donnée à modifier. » | toutes |
| `AUTH_REQUIRED` | En-tête SOAP `AuthToken` absent | opérations authentifiées |
| `INVALID_TOKEN` | Token invalide ou expiré, ou compte supprimé | opérations authentifiées |
| `FORBIDDEN` | Rôle insuffisant ou ressource appartenant à un autre utilisateur | `getUser`, `updateUser`, `deleteUser`, `listUsers`, `createService`, `updateService`, `deleteService`, `setAvailability`, `getReservation`, `getUserReservations`, `cancelReservation`, `updateReservation`, `getAllReservations`, `createPayment`, `getPayment`, `getPaymentByReservation`, `getMyPayments`, `refundPayment`, `getAllPayments`, `deleteReview` (avis d'autrui), toutes les opérations d'`AdminService` |
| `NOT_ELIGIBLE` | Aucune réservation `CONFIRMED` pour ce service : impossible de le noter | `saveReview` |
| `PROMO_INVALID` | Code promo inconnu, désactivé, ou mal formé après normalisation | `createReservation`, `checkPromoCode` |
| `PROMO_EXPIRED` | Code promo hors de sa période de validité | `createReservation`, `checkPromoCode` |
| `PROMO_EXHAUSTED` | Nombre maximum d'utilisations du code atteint | `createReservation`, `checkPromoCode` |
| `BAD_CREDENTIALS` | Email ou mot de passe incorrect ; mot de passe actuel incorrect (changement ou suppression de son compte) | `loginUser`, `updateUser`, `deleteUser` |
| `TOO_MANY_ATTEMPTS` | Trop de tentatives : compte bloqué `LOGIN_LOCK_MINUTES` minutes | `loginUser` |
| `EMAIL_EXISTS` | Un compte existe déjà avec cet email | `registerUser` |
| `NOT_FOUND` | Utilisateur, service, disponibilité, réservation ou paiement introuvable | nombreuses |
| `LAST_ADMIN` | Opération refusée : il doit rester au moins un administrateur | `updateUser` (rôle), `deleteUser` |
| `HAS_ACTIVE_RESERVATIONS` | Réservations non annulées : compte non supprimable | `deleteUser` |
| `IN_USE` | Suppression impossible : des réservations sont liées au service ou au créneau | `deleteService` |
| `BELOW_BOOKED` | Le total de places ne peut pas descendre sous les places déjà réservées | `setAvailability` |
| `DATE_PASSED` | La date du créneau est déjà passée | `createReservation` |
| `NOT_ENOUGH_SLOTS` | Places insuffisantes sur le créneau | `createReservation`, `updateReservation` |
| `NOT_EDITABLE` | Seule une réservation `PENDING` peut être modifiée | `updateReservation` |
| `ALREADY_CANCELLED` | Réservation déjà annulée | `cancelReservation` |
| `RESERVATION_CANCELLED` | Réservation annulée : paiement impossible | `createPayment` |
| `ALREADY_PAID` | Réservation déjà confirmée (déjà payée) | `createPayment` |
| `PAYMENT_EXISTS` | Un paiement non échoué existe déjà pour cette réservation | `createPayment` |
| `NOT_REFUNDABLE` | Seul un paiement `PAID` peut être remboursé | `refundPayment` |
| `DUPLICATE` | Violation d'unicité SQL (`ER_DUP_ENTRY`), ex. `transaction_ref` | `registerUser`, `createPayment` |
| `INTERNAL_ERROR` | Erreur inattendue du serveur (détails journalisés côté serveur uniquement) | toutes |

## 7. Tester avec Thunder Client

1. Dans Thunder Client : **Collections → Import** → sélectionner
   `docs/booking-soap.postman_collection.json` (collection Postman v2.1 générée par
   `npm run generate-collection`). Un dossier par service contient les 44 requêtes.
2. Vérifier les variables de collection : `baseUrl` = `http://localhost:4000` et `token` (vide au départ).
3. Appeler **`UserService → loginUser`** (compte de démo `admin@booking.tn` / `Admin123!`), puis copier la valeur
   de `<tns:token>` dans la variable `token`.
4. Les requêtes protégées envoient l'en-tête `AuthToken` avec cette variable. Le corps doit rester en mode
   **XML/Text** (jamais JSON) avec `Content-Type: text/xml`.
5. Les enveloppes sont aussi disponibles à l'unité dans `docs/requests/<service>/<operation>.xml` (dossiers
   `engagement/` et `admin/` compris). Les
   identifiants d'exemple (`availabilityId = 3`, `reservationId = 1`, `paymentId = 1`…) correspondent aux
   données de démo : adaptez-les avec les valeurs renvoyées par vos propres appels.

## 8. Opérations v2 — engagement et administration

Deux points d'accès supplémentaires : `EngagementService` (`/soap/engagement`) et `AdminService`
(`/soap/admin`). Toutes leurs opérations exigent l'en-tête `AuthToken` (sauf `getServiceReviews`, public) ;
celles d'`AdminService` exigent en plus le rôle `ADMIN` (`requireAdmin` → `FORBIDDEN` sinon).

### 8.1 `EngagementService` — `/soap/engagement`

| Opération | Accès | Arguments | Réponse |
|---|---|---|---|
| `addFavorite` | auth | `serviceId` | `message` — idempotent |
| `removeFavorite` | auth | `serviceId` | `message` — idempotent |
| `getFavorites` | auth | — | `service[]` (avec `averageRating` / `reviewCount`) |
| `saveReview` | auth | `serviceId`, `rating` (1–5), `comment`* (≤ 1000) | `review` — crée ou remplace l'avis |
| `deleteReview` | auth | `reviewId` | `message` — propriétaire ou admin |
| `getServiceReviews` | **public** | `serviceId`, `limit`* (≤ 50, défaut 10), `offset`* | `review[]`, `averageRating`, `reviewCount` |
| `getMyNotifications` | auth | `unreadOnly`*, `limit`* (≤ 100, défaut 20) | `notification[]`, `unreadCount` |
| `markNotificationRead` | auth | `notificationId` | `notification` |
| `markAllNotificationsRead` | auth | — | `message`, `updated` |
| `checkPromoCode` | auth | `code` | `code`, `percent` — aperçu du prix |

Règles : `saveReview` renvoie `NOT_ELIGIBLE` sans réservation `CONFIRMED` pour ce service ; un seul avis par
utilisateur et par service (`UNIQUE (user_id, service_id)`), la nouvelle note remplace l'ancienne ;
`deleteReview` est réservé au propriétaire de l'avis ou à un administrateur.

### 8.2 `AdminService` — `/soap/admin`

| Opération | Arguments | Réponse |
|---|---|---|
| `getDashboardStats` | `days`* (7, 30 ou 90 — défaut 30) | `dashboard` (`KpiStats`, `DailyPoint[]`, `TypeStat[]`, `MethodStat[]`, `TopServiceStat[]`, `LowAvailabilityStat[]`, `Reservation[]`) |
| `getAuditLog` | `limit`* (≤ 200, défaut 50), `offset`* | `entry[]`, `total` |
| `getAllReviews` | `limit`*, `offset`* | `review[]`, `total` |
| `createPromoCode` | `code`, `percent` (1–100), `validFrom`, `validTo`, `maxUses`*, `active`* | `promo` |
| `listPromoCodes` | — | `promo[]` |
| `setPromoCodeActive` | `promoCodeId`, `active` | `promo` |
| `deletePromoCode` | `promoCodeId` | `message` |

`days` hors 7/30/90 → `VALIDATION_ERROR`. Le revenu exclut les paiements `REFUNDED` (comptés séparément dans
`refundedAmount`) ; `previousRevenue` / `previousReservations` couvrent la période précédente de même durée ;
`daily` contient exactement `days` entrées (jours à zéro compris) ; `occupancyRate` = places réservées /
places totales des créneaux à venir, en pourcentage ; `topServices` = 5 services les plus réservés ;
`lowAvailability` = jusqu'à 10 dates des 30 prochains jours ayant ≤ 20 % de places restantes.

### 8.3 Recherche avancée (`searchServices`)

Paramètres facultatifs ajoutés, sans changer le comportement par défaut (rétrocompatible) :

| Paramètre | Valeurs | Effet |
|---|---|---|
| `sortBy` | `price_asc`, `price_desc`, `rating`, `name` | tri (défaut : type puis nom) |
| `minRating` | 0–5 | ne garde que les services dont la note moyenne atteint ce seuil |
| `limit` | 1–100 | pagination ; **sans `limit`, tous les résultats sont renvoyés** |
| `offset` | ≥ 0 | décalage de pagination |

La réponse contient désormais `total` (nombre de résultats avant pagination). Toute autre valeur de `sortBy`
ou `minRating` hors bornes renvoie `VALIDATION_ERROR`.

### 8.4 `getMyPayments` (`PaymentService`)

`sans argument` → `payment[]` des paiements de l'utilisateur connecté, enrichis de `serviceName` et `date`.
L'opération est authentifiée : un utilisateur ne voit que ses propres paiements.
