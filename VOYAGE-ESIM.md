# Catégorie Voyage — reconnaissance des fournisseurs eSIM

État au 13.08.2026. Document de travail du chantier « Voyage » : solutions
courtes et ponctuelles pour un voyage, de 1 jour à 4 semaines. **Les
abonnements mensuels avec engagement n'entrent pas dans ce périmètre** —
Salt Travel, Sunrise Swiss Travel et consorts restent dans l'onglet Mobile.

Tous les faits ci-dessous ont été relevés en Playwright sur les sites
officiels. Aucun chiffre ne provient d'un comparateur tiers : le secteur de
l'eSIM est saturé de sites d'affiliation dont les grilles tarifaires sont
périmées ou arrangées.

---

## 1. Fournisseurs retenus

Les cinq demandés, plus un sixième trouvé en recherche et retenu pour sa
pertinence suisse.

| Fournisseur | Page des forfaits Europe | Statut |
|---|---|---|
| **Airalo** | `airalo.com/europe-esim` | ✅ accessible |
| **Saily** | `saily.com/esim-europe/` | ✅ accessible |
| **Holafly** | `esim.holafly.com/fr/esim-europe/` | ✅ accessible |
| **Nomad** | `getnomad.app/en/europe-eSIM` | ✅ accessible |
| **Ubigi** | `cellulardata.ubigi.com/rates-and-coverage/europe-data-plans/` | ✅ une page par forfait |
| **Yesim** | `yesim.app` | ✅ accessible — éditeur suisse |

Écartés à ce stade, à réévaluer : aloSIM, Jetpac, Instabridge, Maya Mobile —
présents sur le marché mais sans notoriété particulière côté suisse.

## 2. La devise n'est pas la même partout — point structurant

C'est la découverte qui commande la modélisation. Sondés depuis un contexte
suisse (locale fr-CH, fuseau Europe/Zurich) :

| Fournisseur | Devise affichée |
|---|---|
| Airalo | **CHF** |
| Saily | **CHF** (et interface en français) |
| Nomad | **CHF** |
| Holafly | à confirmer |
| Ubigi | **USD** — « US$23 », aucune localisation |
| Yesim | **EUR** |

Un tri par prix croissant qui mélangerait CHF, USD et EUR serait faux, et
faux au détriment des fournisseurs les moins chers. Deux conséquences pour
`travelData` :

- un champ **`currency`** obligatoire sur chaque offre ;
- un **prix converti en CHF** pour le tri et la comparaison, la devise
  d'origine restant affichée pour que le visiteur retrouve le montant qu'il
  paiera réellement. Le taux utilisé et sa date doivent être visibles :
  annoncer un prix en francs qui n'existe sur aucune page fournisseur
  demande de dire d'où il sort.

## 3. Appels et SMS — vérifié, pas supposé

L'hypothèse « les eSIM voyage sont data-only » se confirme mais souffre des
exceptions, d'où le champ `callsIncluded` (`oui` / `non` / `option`).

- **Holafly Europe : non.** Réponse officielle de leur FAQ produit :
  « L'eSIM l'Europe vous offre uniquement des données mobiles, sans numéro
  local pour appels ou SMS. » Ils renvoient vers WhatsApp.
- **Yesim : non**, malgré les apparences. Sa page d'accueil affiche les mots
  `calls`, `SMS` et `Hotspot`, ce qui en faisait le candidat le plus sérieux
  à un `oui`. Sa FAQ, une fois dépliée, tranche l'inverse : « Our prepaid
  eSIM phone plans are designed for data-only solutions and do not come with
  a mobile phone number. » Les mots étaient ceux des questions, pas des
  réponses — l'exemple même du chiffre qu'on aurait eu tort de supposer.
- **Airalo : non** pour les forfaits collectés. La page qualifie sa gamme de
  « data only » dans le libellé de son onglet Data.
- **Saily, Nomad, Ubigi** : à confirmer sur leurs pages produit.

**Constat qui se dessine** : sur les quatre fournisseurs vérifiés, aucun
n'inclut d'appels ni de SMS. Si les deux derniers confirment, l'onglet devra
le dire une fois clairement plutôt que de répéter « appels : non » sur chaque
carte — l'information utile devient alors « aucune eSIM voyage ne remplace
votre numéro, prévoyez WhatsApp ».

## 3 bis. Partage de connexion

- **Yesim : oui**, confirmé par sa FAQ : le partage est « enabled by default »
  et sans frais supplémentaire.
- **Airalo** : rien sur les pages de forfaits. Reste à `null` — non vérifié
  n'est pas la même chose que non autorisé.

## 4. Particularités relevées, à refléter dans les données

- **Saily** : son « illimité » est bridé — 3 Go/jour à pleine vitesse, puis
  1 Mb/s. Annoncer « illimité » sans cette nuance induirait en erreur.
- **Airalo** : la page Europe couvre **41 pays**, celle de Saily **35**. Les
  périmètres régionaux diffèrent d'un fournisseur à l'autre : la couverture
  doit être stockée par offre, jamais déduite du mot « Europe ».
- **Ubigi** : son catalogue mélange des forfaits courts (7 à 30 jours) et des
  formules à 12 mois. **Seuls les courts entrent dans le périmètre.**
- **Airalo** : trois onglets sur la page produit — Data, Unlimited, Standard.
  Ne lire que celui affiché par défaut ferait manquer les forfaits à volume
  fixe. Même piège que les tableaux repliés de Wingo.

## 5. Obstacles techniques d'extraction

- **Saily, Nomad, Ubigi** répondent **HTTP 403 à curl** ; Playwright passe.
- **Holafly** : sa bannière de consentement injecte plusieurs milliers de
  caractères dans `innerText`, ce qui noie les forfaits. Le masquage en
  `display:none` ne suffit pas — il faut retirer les nœuds du DOM avant
  lecture.
- **Saily** est un configurateur : volume et durée se choisissent, le prix se
  recalcule. Extraire la grille complète impose de parcourir les
  combinaisons, pas de lire la page une fois.
- **Ubigi** publie **une page par forfait**, à collecter depuis l'index des
  forfaits par région.

## 6. Ampleur restante

Estimation pour le lot 1 — Europe, Royaume-Uni, USA, Canada, Turquie et
forfaits mondiaux, soit 6 zones × 6 fournisseurs :

| Fournisseur | Forfaits Europe constatés | Estimation lot 1 |
|---|---|---|
| Airalo | ~14 (3 onglets) | ~70 |
| Saily | ~12 (configurateur) | ~60 |
| Holafly | ~8 | ~45 |
| Nomad | ~10 | ~55 |
| Ubigi | ~8 courts | ~45 |
| Yesim | ~10 | ~55 |
| **Total** | | **~330 offres** |

Ces volumes justifient l'approche par lots demandée : une zone à la fois,
commit à chaque lot.

## 7. Modèle de données proposé

```js
{
  provider: "Airalo",              // fournisseur
  name: "Europe 7 jours illimité", // nom du forfait
  destinations: ["Europe"],        // libellés de zone
  countries: ["FR","DE","IT", …],  // pays couverts, pour la recherche
  countryCount: 41,
  dataGB: Infinity,                // ou un nombre
  dataNote: "3 Go/jour puis 1 Mb/s", // nuance si l'illimité est bridé
  days: 7,                         // validité
  price: 22.50,
  currency: "CHF",
  priceCHF: 22.50,                 // converti, pour le tri
  callsIncluded: "non",            // oui | non | option
  hotspot: true,                   // partage de connexion
  url: "https://www.airalo.com/europe-esim",
  sourceType: "product-page",
  verifiedAt: "2026-08-13"
}
```

Le champ `countries` conditionne la recherche de destination demandée pour
l'onglet : c'est lui qui permet de taper « Portugal » et de voir remonter les
forfaits Europe qui le couvrent, sans imposer 190 cases à cocher.
