# Plateforme de réservation — Service Web SOAP

Mini-projet SOA : une plateforme unique pour **réserver des hôtels, des vols et des événements**.
Le backend expose un **service Web SOAP** (XML/WSDL) consommé par un frontend **React** ; les données
vivent dans **MySQL/MariaDB**. Le paiement est simulé (aucune banque réelle n'est contactée).

## Fonctionnalités

- **Catalogue public** : lister, consulter et rechercher les services (mot-clé, type, lieu, prix maximum, date).
- **Disponibilités** : un stock de places par service et par date ; consultation publique des créneaux futurs.
- **Réservation** : création authentifiée, modification de la quantité tant que la réservation est en attente,
  annulation par le client ou par l'administrateur.
- **Paiement simulé** : carte, PayPal ou virement ; `simulateFailure` force un échec pour démontrer le scénario.
  Une réservation ne devient `CONFIRMED` qu'après un paiement `PAID`.
- **Expiration automatique** : une réservation `PENDING` non payée est annulée au bout de 15 minutes
  (`RESERVATION_TTL_MINUTES`) et ses places retournent au stock.
- **Compte utilisateur** : inscription, connexion JWT, profil (nom, téléphone, photo recadrée côté navigateur),
  changement de mot de passe, suppression de compte.
- **Administration** : CRUD des services, gestion des dates et du stock, suivi des réservations et des paiements,
  remboursement, gestion des utilisateurs (rôle, réinitialisation du mot de passe, suppression).
- **Tableau de bord administrateur** (onglet par défaut) : période 7 / 30 / 90 jours, 8 cartes KPI (revenu avec
  évolution vs période précédente, réservations, utilisateurs, taux d'occupation, panier moyen, attente,
  remboursements, services), courbes et barres en SVG fait main, donut par type, top 5 des services, alertes
  de dates presque complètes et dernières réservations.
- **Favoris, avis et recherche avancée** : cœur sur chaque service et page « Mes favoris » ; notes de 1 à 5
  réservées aux clients ayant une réservation confirmée (un avis par service) ; tri (prix, note, nom), filtre
  de note minimale, pagination « Voir plus », puces des filtres actifs.
- **Notifications et factures** : cloche avec pastille de non-lues (rafraîchissement toutes les 30 s),
  historique « Mes paiements » et facture imprimable (`window.print()`, aucune bibliothèque PDF).
- **Codes promo** : remise en pourcentage validée côté serveur (activation, dates, quota), consommée dans la
  transaction de la réservation et restituée à l'annulation ou à l'expiration.
- **Journal d'audit et modération** : traçabilité des actions d'administration (services, stock, rôles,
  remboursements, avis, promos), onglets Avis / Codes promo / Journal, tableaux avec recherche, tri,
  pagination 10 par page et export CSV (UTF-8 avec BOM).
- **Confort** : mode sombre mémorisé (préférence système par défaut), interface responsive jusqu'à 360 px,
  libellés `aria-label` sur les boutons-icônes et focus visible.
- **Sécurité applicative** : bcrypt, JWT en en-tête SOAP, rôles `USER`/`ADMIN`, validation stricte des entrées,
  verrou d'anti force brute sur la connexion, protection du dernier administrateur.

## Stack technique

| Couche | Technologies |
|---|---|
| Frontend | Vite 5, React 18 (ESM), CSS maison — aucune bibliothèque de routage ni de composants |
| Backend | Node.js 18+, Express 4, `soap` (node-soap), `mysql2`, `jsonwebtoken`, `bcryptjs` (CommonJS) |
| Base | MySQL 8 / MariaDB (XAMPP), moteur InnoDB |
| Contrat | Un seul WSDL `backend/src/wsdl/booking.wsdl` (document/literal, 44 opérations), 6 points d'accès |
| Tests | `node:test` + client SOAP réel contre la base (`backend/tests/flow.test.js` + `v2.test.js`, 30 tests) |

## Arborescence

```
booking-soap/
├── README.md                       Ce fichier
├── database/
│   ├── schema.sql                  Création de booking_soap_db + données de démonstration
│   ├── migration_v2.sql            Migration des bases existantes (favoris, avis, notifications,
│   │                               audit, codes promo, colonnes promo + index) — idempotent
│   ├── update_phone_format.sql     Migration : téléphones au format tunisien (8 chiffres)
│   ├── add_avatar_column.sql       Migration : colonne users.avatar
│   └── add_image_column.sql        Migration : colonne services.image_url
├── backend/
│   ├── server.js                   Express + 4 points d'accès SOAP + middleware XML « entre guillemets »
│   ├── package.json                Scripts start / dev / test / generate-collection
│   ├── .env.example                Modèle de configuration (à copier en .env)
│   ├── scripts/
│   │   └── generate-collection.js  Génère docs/requests/*.xml et la collection Postman/Thunder Client
│   ├── src/
│   │   ├── config.js               Configuration (port, base, JWT, TTL, anti force brute, CORS)
│   │   ├── db.js                   Pool mysql2 + helper de transaction
│   │   ├── auth.js                 bcrypt, JWT, requireAuth / requireAdmin / assertOwnerOrAdmin
│   │   ├── validators.js           Validation et normalisation des entrées SOAP
│   │   ├── mappers.js              Lignes SQL (snake_case) → objets SOAP (camelCase)
│   │   ├── domain.js               Annulation + restitution des places, SQL des services et des avis
│   │   ├── notifications.js        Notifications écrites dans la transaction de l'action
│   │   ├── audit.js                Journal d'audit des actions d'administration
│   │   ├── promo.js                Validité, consommation et restitution des codes promo
│   │   ├── expiry.js               Annulation des réservations PENDING expirées
│   │   ├── errors.js               SOAP Faults + enveloppe `handler()`
│   │   ├── loginLimiter.js         Compteur d'échecs de connexion en mémoire
│   │   ├── wsdl/booking.wsdl       Contrat maintenu à la main
│   │   └── services/               userService, availabilityService, bookingService, paymentService,
│   │                               engagementService (favoris, avis, notifications), adminService (dashboard,
│   │                               audit, modération, promos)
│   └── tests/
│       ├── flow.test.js            Tests d'intégration v1 (vrais appels SOAP, base réelle)
│       └── v2.test.js              Tests d'intégration v2 (dashboard, engagement, admin, promos)
├── frontend/
│   ├── index.html · vite.config.js
│   ├── public/images/              Images par défaut des services (hotel.jpg, flight.jpg, event.jpg)
│   └── src/
│       ├── main.jsx · App.jsx      Navigation par état, recherche avancée, réservation, favoris, thème
│       ├── AdminPage.jsx           8 onglets : dashboard, services, réservations, paiements, utilisateurs,
│       │                           avis, codes promo, journal
│       ├── Dashboard.jsx           KPI + graphiques SVG faits main (aire, barres, donut, barres horizontales)
│       ├── ServiceCard.jsx         Carte service : favori, étoiles, avis dépliables, code promo
│       ├── AccountPages.jsx        Mes favoris, Mes paiements, facture imprimable
│       ├── Notifications.jsx       Cloche + menu déroulant (rafraîchissement 30 s)
│       ├── DataTable.jsx           Tableau : recherche, tri, pagination 10/page, export CSV
│       ├── PaymentPage.jsx         Paiement dédié (données de carte jamais transmises)
│       ├── ProfilePage.jsx         Profil, photo, mot de passe, suppression de compte
│       ├── theme.js · phone.js     Mode sombre mémorisé · validation du téléphone
│       ├── soap.js                 Client SOAP minimal (fetch + DOMParser)
│       └── styles.css              Feuille de style unique (+ thème sombre, impression)
└── docs/
    ├── BASE_DE_DONNEES.md          Modèle de données et contraintes
    ├── API_SOAP.md                 Référence des 26 opérations et des codes d'erreur
    ├── REGLES_METIER.md            Règles implémentées, droits, concurrence
    ├── ARCHITECTURE.md             Diagrammes Mermaid + sécurité
    ├── PLAN_RAPPORT.md             Plan du rapport de mini-projet
    ├── booking-soap.postman_collection.json  Collection générée (Thunder Client / Postman)
    ├── requests/<service>/*.xml    Une enveloppe SOAP prête à l'emploi par opération
    └── captures/README.md          Liste des captures d'écran à réaliser
```

## Installation sous Windows / XAMPP (PowerShell)

Les chemins contiennent des espaces : **mettez-les toujours entre guillemets** dans PowerShell.

### 1. Démarrer MySQL

Ouvrir le **panneau de contrôle XAMPP** et cliquer sur *Start* en face de **MySQL** (Apache n'est pas nécessaire).

### 2. Créer la base de données

Méthode recommandée — **phpMyAdmin** : <http://localhost/phpmyadmin> → onglet *Importer* → choisir
`database\schema.sql` → *Exécuter*.

> ⚠️ `schema.sql` exécute `DROP DATABASE IF EXISTS booking_soap_db` : il **remet la base à zéro**
> (structure + données de démo). C'est la commande de réinitialisation officielle du projet.
>
> **Base déjà en service ?** N'importez pas `schema.sql` : importez `database\migration_v2.sql`
> (phpMyAdmin → *Importer*). Il crée les tables `favorites`, `reviews`, `notifications`, `audit_logs`,
> `promo_codes`, ajoute `reservations.promo_code` / `discount_amount` et les index du tableau de bord, sans
> toucher aux données existantes. Le script est idempotent.

Variante en ligne de commande (PowerShell ne gère pas `<`, on passe donc par `cmd`) :

```powershell
cd "C:\MDW 3.1\At SOA\Mini Projet\booking-soap\booking-soap"
cmd /c '"C:\xampp\mysql\bin\mysql.exe" -u root < "database\schema.sql"'
```

### 3. Backend

```powershell
cd "C:\MDW 3.1\At SOA\Mini Projet\booking-soap\booking-soap\backend"
Copy-Item .env.example .env
notepad .env            # définir au minimum JWT_SECRET (et DB_PASSWORD si root en a un)
npm install
npm start
```

Le serveur affiche les URLs des quatre WSDL. Pour le développement avec rechargement automatique :
`npm run dev`.

### 4. Frontend

```powershell
cd "C:\MDW 3.1\At SOA\Mini Projet\booking-soap\booking-soap\frontend"
npm install
npm run dev
```

### 5. Vérifier

- Santé du service : <http://localhost:4000/health> → `{"status":"ok"}`
- WSDL : <http://localhost:4000/soap/user?wsdl>
- Application : <http://localhost:5173>

## Variables d'environnement (`backend/.env`)

| Variable | Défaut | Rôle |
|---|---|---|
| `PORT` | `4000` | Port d'écoute du backend |
| `PUBLIC_URL` | `http://localhost:4000` | URL injection dans le WSDL (`soap:address`) |
| `DB_HOST` / `DB_PORT` | `localhost` / `3306` | Connexion MySQL (XAMPP) |
| `DB_USER` / `DB_PASSWORD` | `root` / vide | Identifiants MySQL |
| `DB_NAME` | `booking_soap_db` | Nom de la base |
| `JWT_SECRET` | *(obligatoire)* | Clé de signature des tokens ; un secret de développement est utilisé avec un avertissement si absent |
| `JWT_EXPIRES_IN` | `2h` | Durée de validité du token |
| `RESERVATION_TTL_MINUTES` | `15` | Délai avant annulation automatique d'une réservation non payée |
| `LOGIN_MAX_ATTEMPTS` | `5` | Nombre d'échecs de connexion avant blocage temporaire |
| `LOGIN_LOCK_MINUTES` | `15` | Durée du blocage (fenêtre glissante du compteur) |
| `CORS_ORIGIN` | `http://localhost:3000,http://localhost:5173` | Origines autorisées, séparées par des virgules |

Côté frontend, `VITE_API_URL` (fichier `frontend/.env`, à créer depuis `frontend/.env.example`) doit correspondre
à l'adresse et au port du backend. Par exemple, si `PORT=4001` dans `backend/.env`, utiliser
`VITE_API_URL=http://localhost:4001`, puis redémarrer Vite. Aucun fichier `.env` n'est versionné.

## Comptes de démonstration

| Compte | Mot de passe | Rôle |
|---|---|---|
| `admin@booking.tn` | `Admin123!` | ADMIN |
| `user@booking.tn` | `User1234!` | USER |

Un code promo de démonstration est fourni : **`WELCOME10`** (-10 %, valable 90 jours, 100 utilisations).

Les créneaux de démonstration sont **relatifs à la date d'import** (`DATE_ADD(CURDATE(), INTERVAL n DAY)`),
afin que la démonstration reste toujours réservable.

## URLs utiles

| Ressource | URL |
|---|---|
| Frontend React | <http://localhost:5173> |
| Santé | <http://localhost:4000/health> |
| UserService (WSDL) | `http://localhost:4000/soap/user?wsdl` |
| AvailabilityService (WSDL) | `http://localhost:4000/soap/availability?wsdl` |
| BookingService (WSDL) | `http://localhost:4000/soap/booking?wsdl` |
| PaymentService (WSDL) | `http://localhost:4000/soap/payment?wsdl` |
| EngagementService (WSDL) | `http://localhost:4000/soap/engagement?wsdl` |
| AdminService (WSDL) | `http://localhost:4000/soap/admin?wsdl` |

Toutes les opérations et leurs codes d'erreur sont détaillés dans [`docs/API_SOAP.md`](docs/API_SOAP.md).

## Tests

```powershell
cd "C:\MDW 3.1\At SOA\Mini Projet\booking-soap\booking-soap\backend"
npm test
```

- Prérequis : **MySQL démarré** et `schema.sql` importé (les tests utilisent la vraie base).
- **30 tests** couvrent l'inscription, la connexion, la recherche, les règles 1 à 5, la concurrence (15 réservations
  simultanées pour 5 places), l'expiration, les droits par rôle, le profil, le dernier administrateur,
  l'effacement du téléphone, l'anti force brute et l'option `includeAll` (`flow.test.js`), puis les favoris,
  les avis, la recherche avancée, les codes promo, les notifications, `getMyPayments`, le tableau de bord,
  le journal d'audit et la modération (`v2.test.js`).
- Les deux fichiers tournent **séquentiellement** (`node --test --test-concurrency=1`) : ils partagent le même
  port et la même base.
- Les comptes `test.*@example.com` et les services `Test *` créés par les tests sont supprimés à la fin.

Build du frontend :

```powershell
cd "C:\MDW 3.1\At SOA\Mini Projet\booking-soap\booking-soap\frontend"
npm run build
```

## Collection de requêtes

```powershell
cd "C:\MDW 3.1\At SOA\Mini Projet\booking-soap\booking-soap\backend"
npm run generate-collection
```

Génère `docs/requests/<service>/<operation>.xml` (44 enveloppes, dossiers `engagement/` et `admin/` compris) et
`docs/booking-soap.postman_collection.json` (collection Postman v2.1 importable dans Thunder Client).
Voir la section « Tester avec Thunder Client » de [`docs/API_SOAP.md`](docs/API_SOAP.md).

## Documentation

- [Modèle de données](docs/BASE_DE_DONNEES.md)
- [Référence de l'API SOAP](docs/API_SOAP.md)
- [Règles métier et droits](docs/REGLES_METIER.md)
- [Architecture et sécurité](docs/ARCHITECTURE.md)
- [Plan du rapport](docs/PLAN_RAPPORT.md)

## Dépannage

| Symptôme | Cause probable | Solution |
|---|---|---|
| `connection refused` / « Serveur injoignable » dans l'interface | Backend non démarré | Lancer `npm start` dans `backend/` et vérifier <http://localhost:4000/health> |
| `ECONNREFUSED 127.0.0.1:3306` | MySQL arrêté | Démarrer MySQL dans le panneau XAMPP, puis relancer le backend |
| `Access denied for user 'root'@'localhost'` | Mot de passe MySQL différent de `.env` | Renseigner `DB_PASSWORD` dans `backend/.env` |
| `Invalid XML` renvoyé par Thunder Client | Le corps est envoyé comme une chaîne JSON entre guillemets | Corrigé par le middleware de `server.js` : si le corps commence par `"`, il est déballé avant node-soap ; vérifier tout de même que le corps est en mode **XML/Text** |
| `INVALID_TOKEN` | Token expiré (2 h) ou compte supprimé | Refaire `loginUser` et mettre à jour la variable `token` |
| `DATE_PASSED` lors d'une réservation | La date du créneau est antérieure à aujourd'hui | Choisir un créneau futur, ou réimporter `schema.sql` (les créneaux de démo sont relatifs à la date du jour) |
| Accents corrompus (Ã©, ?) | Connexion ou import sans `utf8mb4` | `schema.sql` commence par `SET NAMES utf8mb4` ; importer avec phpMyAdmin et vérifier `CHARACTER SET utf8mb4` sur la base |
| Port déjà utilisé (`EADDRINUSE`) | Un autre backend ou processus écoute | `Get-NetTCPConnection -LocalPort 4000` puis arrêter le processus, ou changer `PORT` (et `PUBLIC_URL`) dans `backend/.env` ; faire correspondre `VITE_API_URL` dans `frontend/.env` |
| Le frontend ne joint pas l'API (erreur CORS) | Origine absente de `CORS_ORIGIN` | Ajouter l'URL exacte du frontend dans `CORS_ORIGIN`, puis redémarrer le backend |
