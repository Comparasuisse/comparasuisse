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
| Holafly | **CHF** — confirmé le 13.08, sélecteur « FR - CHF (Fr) » |
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
- **Nomad : non** pour les forfaits collectés, mais la réponse méritait d'être
  cherchée. Sa FAQ dit d'abord l'inverse de ce qu'on attendait : « Some of
  Nomad's eSIMs include a local phone number. Check the plan details. » La
  fiche de chaque forfait, elle, tranche sans ambiguïté — elle porte
  « Service : Data Only » et « Local Number : No ». Nomad vend donc des eSIM
  avec numéro, mais aucune parmi celles du lot 1.
- **Ubigi : non.** Sa fiche produit décrit « one-time unlimited eSIM **data**
  plan » et ne mentionne ni voix ni SMS nulle part. C'est une conclusion par
  absence, mais cohérente de bout en bout : le catalogue entier s'intitule
  « data plans ».
- **Saily : option.** Ses forfaits de voyage sont data-only, mais Saily vend
  séparément un numéro américain à ajouter dans l'application
  (`saily.com/fr/esim-phone-number/`). C'est le seul `option` du lot.

**Constat définitif** : **aucun des 348 forfaits collectés n'inclut appels ni
SMS.** L'onglet doit le dire une fois, en tête, plutôt que de répéter
« appels : non » sur chaque carte — l'information utile est « aucune eSIM
voyage ne remplace votre numéro, prévoyez WhatsApp », avec la nuance que Saily
et Nomad vendent des numéros à part.

⚠️ **Un piège rencontré, à ne pas rejouer.** La page Saily porte une table
« Saily vs. les autres services eSIM » dont une ligne s'intitule « Numéro de
téléphone (SMS et appels) », cochée pour Saily et Airalo, décochée pour
Holafly, Nomad et Ubigi. C'est tentant, c'est structuré, et c'est un
argumentaire concurrentiel écrit par un des comparés — exactement la source
secondaire que ce chantier s'interdit. Elle contredit d'ailleurs la fiche
produit de Nomad sur son propre catalogue. Aucune ligne n'en a été tirée.

## 3 ter. Holafly — faits établis, prix encore à relever

Relevés le 13.08.2026 sur `esim.holafly.com/fr/esim-europe/`, une fois les
88 nœuds de la bannière de consentement retirés du DOM :

- **Devise CHF**, sélecteur « FR - CHF (Fr) ».
- **Un seul produit par destination** : données illimitées. Il n'y a pas de
  grille de volumes, seulement un prix qui dépend de la durée.
- **61 durées vendues**, de 1 à 60 jours. C'est une singularité réelle — aucun
  autre fournisseur ne vend la journée à la carte — mais enregistrer 31 lignes
  par destination remplirait le comparateur de quasi-doublons. Le collecteur
  retient huit durées de référence (1, 3, 5, 7, 10, 15, 20, 30) et la
  granularité au jour près sera dite dans la description de l'offre.
- **Partage de connexion : oui, mais plafonné à 1 Go par jour** — « Partagez
  1 Go de données par jour avec votre famille […] un forfait de 7 jours
  comprend 7 Go ». Sur un produit vendu comme illimité, la nuance compte.
- **Always On** : 1 Go/mois de données de secours une fois l'illimité épuisé,
  ce qui confirme au passage que l'illimité est régulé.

**Les prix sont relevés depuis le 13.08.2026** — mais pas par où on les
cherchait. Le détour vaut d'être noté, il resservira.

Trois tentatives de pilotage du sélecteur avaient échoué, le déclencheur
`button#calendarTrigger` restant obstinément sur « 1 » : clic programmatique
sur le jour voulu, sélection par plage, clic natif Playwright — ce dernier en
timeout, les cellules n'étant pas jugées actionnables. Le navigateur réel a
montré pourquoi ces pistes ne pouvaient pas aboutir telles quelles : **le
panneau n'est pas une liste de durées mais un vrai calendrier de dates**
(« Choisissez la date de début du forfait »), où l'on pose une date d'arrivée
puis une date de retour. Les « 61 boutons de jours » comptés dans le DOM
étaient les cases des mois affichés, pas des durées.

Piloter ce calendrier au clic pour 8 durées × 6 destinations aurait été long et
fragile. Il n'y en a pas besoin : **le site est un Astro, et Astro sérialise
les props de ses îlots dans le DOM**. L'élément

```
<astro-island component-url="/_astro/ProductPricing.…js" props="…">
```

porte les **90 variantes du produit, de 1 à 90 jours**, chacune avec son prix
dans une vingtaine de devises, CHF compris. C'est la source dont le composant
se sert lui-même pour afficher son total : on la lit, sans toucher au
calendrier. Le format encode chaque valeur en `[type, valeur]`, d'où le
dépaquetage récursif du collecteur.

Deux vérifications qui valident la lecture :

- la variante à 1 jour donne **3.50 CHF**, exactement le « Total 3,50 Fr »
  affiché à l'écran dans le navigateur réel ;
- les six destinations donnent **quatre grilles distinctes** (Europe, UK et
  Turquie partagent la même ; USA, Canada et Monde ont chacune la leur), avec
  des prix strictement croissants avec la durée.

Le même îlot voisin `CountriesModal` porte la **couverture réelle en ISO-3** —
33 pays pour l'Europe, 142 pour le forfait mondial. À utiliser plutôt que le
texte de la page : le « 200+ destinations » qu'on y lit est l'argumentaire de
Holafly sur tout son catalogue, pas le périmètre du forfait affiché. Un premier
jet l'avait pris pour la couverture et annonçait 200 pays sur chaque offre.

**Leçon générale** : sur un site rendu par un framework à îlots (Astro, mais la
même idée vaut pour les `props` de Next ou de Nuxt), l'état sérialisé du
composant est une source plus sûre, plus complète et plus rapide que le
pilotage de son interface. Le chercher **avant** de se battre avec l'UI.

**Contrôle de non-régression obligatoire** : si toutes les durées ressortent au
même prix, la collecte est fausse — c'est le symptôme exact qu'ont produit les
trois tentatives infructueuses, toutes bloquées sur le « à partir de 3,50 » de
l'en-tête. Le collecteur refuse désormais d'écrire son fichier dans ce cas.

## 3 bis. Partage de connexion

- **Yesim : oui**, confirmé par sa FAQ : le partage est « enabled by default »
  et sans frais supplémentaire.
- **Nomad : oui**, la fiche de chaque forfait porte « Hotspot : Yes ».
- **Ubigi : oui**, « Data sharing allowed » sur la fiche produit, assorti d'un
  « Fair Use Policy may apply ».
- **Holafly : oui mais plafonné** à 1 Go par jour (cf. § 3 ter).
- **Airalo** : rien sur les pages de forfaits. Reste à `null` — non vérifié
  n'est pas la même chose que non autorisé.

## 4. Particularités relevées, à refléter dans les données

- **Saily** : son « illimité » est bridé — 3 Go/jour à pleine vitesse, puis
  1 Mb/s. Annoncer « illimité » sans cette nuance induirait en erreur.
- **Nomad** : son illimité l'est tout autant, et la fiche produit le chiffre —
  « 2GB/day at 4G/5G. 1 Mbps after 2GB ». Le bridage n'est donc pas une
  particularité de Saily : c'est la règle du secteur, et le champ `dataNote`
  doit être renseigné partout où le fournisseur le publie.
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

Le lot 1 — Europe, Royaume-Uni, USA, Canada, Turquie et mondial — est
**collecté**. Décompte au 13.08.2026, données dans `data/voyage-*.json` :

| Fournisseur | Lus | Dans le périmètre | Devise |
|---|---|---|---|
| Airalo | 104 | **99** | CHF |
| Saily | 65 | **60** | CHF |
| Nomad | 54 | **52** | CHF |
| Ubigi | 78 | **51** | USD |
| Holafly | 48 | **48** | CHF |
| Yesim | 41 | **38** | EUR |
| **Total** | 390 | **348** | |

L'estimation initiale tablait sur ~330 : elle se tenait. L'écart tient surtout
à Airalo, dont les trois onglets rendent plus que prévu.

**Ce qui reste hors périmètre** (42 forfaits) : les formules à 12 mois d'Ubigi,
ses forfaits mondiaux de 90 à 360 jours, les 90/180/365 jours de Saily et de
Yesim, et les abonnements reconductibles — Nomad Pass et les plans `monthly`
d'Ubigi. Tous sont relevés et marqués `horsPerimetre`, pas jetés : si le
périmètre change un jour, la donnée est là.

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
