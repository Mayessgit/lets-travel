# Plan du rapport de mini-projet

Plan proposé pour le rapport écrit (10 à 20 pages). Chaque partie renvoie au document technique correspondant
du dossier `docs/`.

## Page de garde

Titre du mini-projet, matière (SOA), nom de l'étudiant, année universitaire, encadrant.

## 1. Introduction

- Contexte : digitalisation de la réservation de voyages (hôtels, vols, événements).
- Problématique : comment exposer un système d'information hétérogène via un **service Web SOAP** unique,
  consommable par plusieurs clients ?
- Objectifs du projet et périmètre (paiement simulé, pas d'intégration bancaire réelle).
- Annonce du plan.

## 2. Cahier des charges

- Acteurs : visiteur, client authentifié, administrateur.
- Fonctionnalités attendues par acteur (catalogue, recherche, réservation, paiement, administration, profil).
- Contraintes techniques : architecture orientée services, WSDL unique, base relationnelle, frontend séparé.
- Règles métier à respecter (les 5 règles + expiration, cf. [`REGLES_METIER.md`](REGLES_METIER.md)).
- Environnement : Windows, XAMPP (MySQL), Node.js, React.

## 3. Conception

### 3.1 Architecture générale

- Schéma React → SOAP/XML → Express/node-soap → MySQL, quatre services SOAP.
- Rôle de chaque couche, séparation contrat / implémentation / accès aux données.
- Source : [`ARCHITECTURE.md`](ARCHITECTURE.md) section 1.

### 3.2 Modèle de données

- Diagramme entité-relation, description des cinq tables, clés étrangères et comportements `ON DELETE`.
- Justification de `payments.reservation_id UNIQUE` (relation 1:1) et des contraintes `CHECK` sur le stock.
- Source : [`BASE_DE_DONNEES.md`](BASE_DE_DONNEES.md).

### 3.3 Contrat de service (WSDL)

- Choix document/literal, un seul WSDL pour quatre points d'accès.
- Tableau récapitulatif des 26 opérations, types de messages, en-tête `AuthToken`.
- Source : [`API_SOAP.md`](API_SOAP.md) sections 1 à 3.

### 3.4 Scénarios dynamiques

- Diagramme de séquence « rechercher → réserver → payer ».
- Diagrammes d'états de `reservations.status` et `payments.status`.
- Source : [`ARCHITECTURE.md`](ARCHITECTURE.md) sections 2 et 3.

## 4. Implémentation

### 4.1 Backend

- Organisation des fichiers (`src/services`, couche commune `auth`/`validators`/`errors`/`mappers`/`domain`).
- Gestion des erreurs : `handler()` et SOAP Faults avec `detail/code`.
- Transactions et verrous `SELECT … FOR UPDATE` (gestion de la concurrence).
- Tâche d'expiration des réservations impayées (`src/expiry.js`).
- Extrait de code commenté : `createReservation` et `createPayment`.

### 4.2 Frontend

- Client SOAP minimal (`soap.js` : construction XML, `DOMParser`, extraction du Fault).
- Navigation par état, espace client (recherche, réservation, paiement, profil) et espace admin.
- Gestion de session (token en `localStorage`, déconnexion sur `INVALID_TOKEN`).

### 4.3 Sécurité

- bcrypt, JWT en en-tête SOAP, rôles et contrôles d'accès, validation des entrées, requêtes paramétrées.
- Anti force brute, protection du dernier administrateur.
- Limites connues et pistes (HTTPS, rate limiting par IP, refresh token, désactivation de compte).
- Source : [`ARCHITECTURE.md`](ARCHITECTURE.md) section 4.

### 4.4 Extraits d'échanges SOAP

- Requête/réponse `loginUser`, `createReservation`, `createPayment`, exemple de SOAP Fault.
- Source : [`API_SOAP.md`](API_SOAP.md) sections 4 et 5.

## 5. Tests et validation

- Stratégie : tests d'intégration `node:test` contre le vrai service SOAP et la vraie base (20 tests).
- Tableau des scénarios couverts : inscription/connexion, droits, règles 1 à 5, concurrence (15 requêtes
  simultanées pour 5 places), expiration, remboursement, profil, anti force brute, `includeAll`.
- Tests manuels via Thunder Client / la collection générée.
- Résultats obtenus et limites (pas de tests unitaires isolés, pas de tests end-to-end navigateur).
- Source : [`REGLES_METIER.md`](REGLES_METIER.md) et `backend/tests/flow.test.js`.

## 6. Captures d'écran

- Insérer les captures listées dans [`captures/README.md`](captures/README.md), avec une légende par écran.
- Ordre conseillé : accueil, recherche, dates, réservation, paiement, mes réservations, profil, administration
  (services, dates, réservations, paiements, utilisateurs), réponse SOAP et Fault.

## 7. Conclusion

- Bilan : objectifs atteints, service SOAP complet et documenté, frontend fonctionnel, jeu de tests vert.
- Difficultés rencontrées (WSDL maintenu à la main, concurrence, gestion des erreurs SOAP, dates de démo
  relatives).
- Perspectives : HTTPS, rate limiting par IP, refresh tokens, désactivation de compte, paiement réel,
  journal d'audit, pagination des listes d'administration.

## Annexes

- A. Script de création de la base (`database/schema.sql`).
- B. Collection de requêtes (`docs/booking-soap.postman_collection.json`) et enveloppes
  (`docs/requests/`).
- C. Guide d'installation et de dépannage (`README.md`).
- D. Liste des codes d'erreur (`API_SOAP.md` section 6).
