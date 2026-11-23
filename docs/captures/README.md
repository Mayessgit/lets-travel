# Captures d'écran

Liste des captures à réaliser **à la main** (aucune image factice n'est versionnée). Placez les fichiers dans ce
dossier `docs/captures/` avec exactement le nom indiqué, puis insérez-les dans le rapport avec
`![…](captures/01-accueil.png)`.

| # | Écran à capturer | Fichier attendu | Comment y accéder |
|---|---|---|---|
| 1 | Accueil : héros, barre de recherche et cartes de services | `01-accueil.png` | Ouvrir <http://localhost:5173> |
| 2 | Résultats de recherche filtrés | `02-recherche.png` | Saisir un mot-clé (ex. `Hôtel`), type `Hôtel`, prix max `200`, puis *Rechercher* |
| 3 | Dates d'un service (places libres) | `03-dates.png` | Carte « Hôtel Tunis Palace » → *Voir les dates* |
| 4 | Création d'une réservation (message de confirmation) | `04-reservation.png` | Choisir une date, quantité `2`, cliquer *Réserver* (connecté en `user@booking.tn`) |
| 5 | Page de paiement (formulaire + récapitulatif) | `05-paiement.png` | *Mes réservations* → *Payer* |
| 6 | Mes réservations (statuts `CONFIRMED` / `PENDING` / `CANCELLED`) | `06-mes-reservations.png` | *Mes réservations* |
| 7 | Mon profil (photo, informations, mot de passe, suppression) | `07-profil.png` | Cliquer sur son nom en haut à droite |
| 8 | Administration — onglet Services | `08-admin-services.png` | Connexion `admin@booking.tn` → *Administration* → *Services* |
| 9 | Administration — panneau Dates avec badges *Complet* / *Passée* | `09-admin-dates.png` | *Services* → bouton *Dates* d'un service (*inclut `includeAll`*) |
| 10 | Administration — onglet Réservations | `10-admin-reservations.png` | *Administration* → *Réservations* |
| 11 | Administration — onglet Paiements | `11-admin-paiements.png` | *Administration* → *Paiements* |
| 12 | Administration — onglet Utilisateurs (bouton *Mot de passe*) | `12-admin-utilisateurs.png` | *Administration* → *Utilisateurs* |
| 13 | Réponse SOAP dans Thunder Client (`loginUser` ou `createReservation`) | `13-thunder-client.png` | Collection importée → requête → *Send*, capture du corps XML de réponse |
| 14 | SOAP Fault (erreur métier) dans Thunder Client | `14-soap-fault.png` | Ex. `loginUser` avec un mauvais mot de passe, ou `createReservation` avec une quantité trop grande |

Conseils :

- Captures en **1600 px de large minimum**, format PNG, navigateur en mode clair pour rester lisible à
  l'impression.
- Vérifiez que les données affichées sont cohérentes (compte de démo, réservation réellement créée).
- Les captures 9, 14 sont optionnelles mais renforcent la démonstration (option `includeAll` et gestion
  d'erreur).
| 15 | Administration — Tableau de bord (KPI, courbes, donut, alertes) | `15-dashboard.png` | *Administration* → *Tableau de bord*, période 30 jours |
| 16 | Favoris et avis sur une carte de service (étoiles + formulaire) | `16-avis-favoris.png` | Carte d'un service réservé et payé → *Avis* ; cœur en haut à droite pour le favori |
| 17 | Facture imprimable (`FAC-<id>`) | `17-facture.png` | *Mes paiements* → *Facture* (puis *Imprimer / Enregistrer en PDF*) |
| 18 | Mode sombre (tableau de bord ou page de paiement) | `18-mode-sombre.png` | Bouton ☾/☀ dans l'en-tête |

Captures complémentaires utiles : *Mes favoris*, un code promo appliqué (prix barré + nouveau prix), la cloche de
notifications ouverte, et l'onglet *Journal* de l'administration.
