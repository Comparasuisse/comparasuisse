# Checklist obligatoire à chaque ajout ou modification d'offre

**Règle absolue** : rien n'est ajouté dans `mobileData` / `internetData` / `tvData` /
`comboData` / `promoData` sans avoir coché explicitement les 8 points ci-dessous
et **présenté le récap à l'utilisateur pour validation avant écriture**.

Cette checklist existe pour éviter les erreurs déjà rencontrées :
- Netplus / Quickline internet mal classées « sunrise » alors qu'elles sont sur
  réseau câble régional (extrapolation depuis leur mobile — jamais vérifié)
- Netplus TV Box affichée à 500h alors que le site officiel dit 1000h
  (lecture superficielle d'une source secondaire)

---

## Les 8 points à vérifier par offre

Pour chaque offre à ajouter/modifier, valider chaque point avec **✅ vérifié**,
**⚠️ estimé** (source secondaire ou déduction) ou **❌ non trouvé** (documenter
pourquoi).

| # | Champ | Ce qu'il faut vérifier | Où chercher |
|---|---|---|---|
| 1 | `price` | Prix mensuel exact en CHF | Fiche produit officielle + PDF factsheet |
| 2 | `beforePrice` | Prix catalogue AVANT rabais (si `promo:true`) | Idem |
| 3 | `chDataGB` / `speed` | Data Suisse (mobile) ou débit descendant Mbit/s (internet) | PDF factsheet mobile · page produit internet |
| 4 | `roamData` + `roamDataGB` + `countries` | Data roaming, pays inclus, zone géographique | PDF factsheet mobile |
| 5 | `chUnlimited` + appels/SMS | Illim CH ou tarif à la min, appels internationaux/roaming | PDF factsheet |
| 6 | `network` | Réseau porteur — **impératif de vérifier**, ne jamais extrapoler d'une offre mobile vers l'offre internet du même opérateur | Page « couverture », page « à propos », mention explicite. Si non-documenté publiquement (câblo-opérateurs régionaux) → utiliser `network:"regional"` et marquer `sourceType:"assumption"` |
| 7 | Engagement / durée min | Mois exacts, sans engagement, ou clause spécifique | PDF factsheet / CGV |
| 8 | Disponibilité géo | Nationale ou régionale ? Zones desservies ? | Page « couverture » ou checker d'adresse |

Pour les offres TV, ajouter aussi :
- `channels` : nombre exact affiché sur la page opérateur
- `replayDays` : jours de replay
- `recordingHours` : **heures d'enregistrement — lecture précise du chiffre sur la page produit officielle** (une des erreurs récurrentes)
- `streaming` : sans box requise (true) ou TV-Box obligatoire (false)

---

## Champs `verifiedAt` et `sourceType` (volet 3)

**À ajouter systématiquement** sur chaque nouvelle offre + à mettre à jour à
chaque re-vérification :

```js
{
  // ... autres champs
  verifiedAt: "2026-07-26",         // date ISO de la dernière vérif live
  sourceType: "factsheet-pdf",       // voir enum ci-dessous
}
```

**Enum `sourceType`** (par ordre de fiabilité décroissante) :
- `factsheet-pdf` — PDF officiel de l'opérateur (le plus fiable, valeurs contractuelles)
- `product-page` — Page produit HTML officielle
- `third-party` — Source secondaire de confiance (moneyland, alao, checkeverything, ictjournal, xavierstuder)
- `assumption` — Déduction ou extrapolation non vérifiable publiquement (à utiliser
  avec parcimonie ; oblige à noter dans `details` la nature de l'hypothèse)

**Backfill progressif** : les offres pré-existantes ne sont pas rétro-marquées
en masse (trop imprécis) ; elles reçoivent leurs champs `verifiedAt`+`sourceType`
au fur et à mesure des audits ou modifications.

---

## 📈 Historique de prix (`priceHistory`) — ajout automatique

Chaque offre peut porter un tableau `priceHistory: [{date:"YYYY-MM-DD", price:X.XX}, …]`
qui sert à générer un sparkline visible sur la carte quand ≥ 2 points existent.

**Règle transparence** : jamais de graphique avec un seul point (rien affiché
tant qu'on n'a pas au moins 2 vérifications à des dates différentes). La
mention « Suivi depuis DD MMM YYYY » apparaît sous le graphique.

**Quand ajouter un point** :
- **Ajout d'offre** avec `verifiedAt` + `sourceType` → 1 point initial
  (le script backfill `data:{date:verifiedAt, price:currentPrice}`).
- **Correction de prix** confirmée par vérif live → utiliser
  `node scripts/append-price-point.mjs "<name>" <price>` qui bumpe aussi verifiedAt.
- **Audit automatique** (`node scripts/audit-random.mjs N --history`) → ajoute
  un point uniquement si verdict OK et si dernier point > 30 jours (évite le
  bruit d'audits successifs sur des prix inchangés, tout en gardant une trace
  de vie du suivi dans le graphique sur la durée).

**Quand NE PAS ajouter** :
- Prix inchangé et dernier point < 30 jours → skip (bruit inutile).
- Verdict ÉCART, PAGE_VIDE, URL_MORTE ou ERREUR d'audit → aucune conclusion
  fiable, revue humaine nécessaire avant tout ajout.
- Offres sans `verifiedAt` → le helper refuse, il faut d'abord documenter
  la source (règle du workflow).

## 📅 Bump automatique de la date « Prix vérifiés le »

Le footer d'index.html contient une ligne :
```html
<span style="opacity:.7;">Prix vérifiés le [date]</span>
```

**Règle** : bumper cette date à la date du jour dans **chaque commit qui
contient au moins une vraie vérification de prix**, sans attendre que
l'utilisateur le demande.

**Qui compte comme « vraie vérification » — bumper :**
- Ajout d'une offre avec `sourceType: "product-page"` ou `"factsheet-pdf"`
  (fetch direct site officiel)
- Correction de prix confirmée par vérif live (Playwright / WebFetch)
- Passage de `audit-random.mjs` qui confirme un prix, même si aucun
  changement au final — le fait d'avoir revérifié compte
- Mise à jour de `verifiedAt` sur une entrée existante

**Qui ne compte PAS — laisser la date telle quelle :**
- Corrections de bugs UI/JS (filtres, badges, checkboxes)
- Ajout de fonctionnalités interface (comparaison, filtres, tri)
- Refactor CSS/design/textes descriptifs sans changement de prix
- Ajout de scripts sans vérif concrète
- Documentation (checklist, mentions légales, README)

**Why** : la date doit rester honnête pour le visiteur. « Prix vérifiés
aujourd'hui » ne doit pas signifier « j'ai poussé un commit UI » mais
bien « j'ai revérifié au moins un prix directement sur un site
officiel aujourd'hui ».

## ⚠️ Rappel critique : checkbox de filtre à mettre à jour

Après avoir ajouté une entrée à `tvData` ou `comboData` avec un `operator` qui
n'existe pas encore dans les checkboxes de filtre correspondantes, il FAUT
**impérativement** ajouter la checkbox `<input data-op="OperatorName">` dans le
HTML :

- `tvData` avec nouveau operator → ajouter dans `#tv-operator`
- `comboData` avec nouveau operator → ajouter dans `#combo-operator`

Sinon l'offre est **invisible silencieusement** : `selectedOps.includes(operator)`
retourne `false` par défaut → l'offre est filtrée out sans erreur console.
Le compteur affichera "N-1 / N offre(s)" et la grille manquera une carte.

Bug déjà survenu 2 fois : sur TV (Init7/Netplus/iWay/MaxiConnect/Teleking/
CanalPlus) et sur combo (Talk Talk).

Les onglets Mobile et Internet utilisent des checkboxes de RÉSEAU (pas
d'opérateur), donc ce bug ne peut pas y survenir pour un nouvel opérateur
sur un réseau existant. Il ne peut survenir que si on introduit un nouveau
type de réseau (comme "regional" pour Netplus/Quickline internet — checkbox
"Câble régional" ajoutée à ce moment-là).

## Workflow standard à chaque ajout

1. **Fetch live** de la page produit officielle (WebFetch, puis Playwright si JS lourd)
2. **Si PDF factsheet dispo** : parser via `scripts/fetch-channels.mjs` pattern ou
   script pdfjs-dist inline
3. **Remplir la checklist des 8 points** dans le message de présentation à l'user
4. **Attendre validation** avant modification de `index.html`
5. **Ajouter `verifiedAt` et `sourceType`** dans l'entrée
6. **Bumper la date** « Prix vérifiés le … » du footer (règle mémoire existante)
7. **Ne commit + push qu'après vérification browser locale + validation user
   explicite** (`go push` ou équivalent)

---

## Audit périodique (volet 2)

Script `scripts/audit-random.mjs` : tire N offres au hasard (seed = date du jour,
reproductible), fetch chaque URL en Playwright, compare prix affiché avec nos
données, génère un rapport `data/audit-YYYY-MM-DD.md`.

À lancer manuellement (ou hebdo si le user le souhaite) :
```bash
node scripts/audit-random.mjs        # 10 offres au hasard
node scripts/audit-random.mjs 20     # 20 offres au hasard
```

Le rapport liste les écarts détectés (prix non trouvé sur la page, page 404, etc.)
pour revue humaine — pas d'auto-correction.

---

## 🗓 Rappels temporels à revérifier manuellement

Certaines évolutions annoncées à l'avance méritent une revérif ciblée à la
date effective pour capter le changement dans `priceHistory`. Cocher/mettre
à jour au fur et à mesure.

- **Semaine du 18-20 septembre 2026** : revérifier manuellement TOUTES les
  offres Wingo (mobile + internet + TV + combo + promo, ~19 entrées) pour
  capter la hausse annoncée +1 CHF/mois et la migration vers de nouveaux
  plans (période officielle 1-18 septembre 2026, source
  wingo.ch/fr/adaptation-2026). Ce sera le **premier vrai test grandeur
  nature** du système priceHistory — le premier changement de prix visible
  sur les sparklines depuis leur lancement le 26 juillet 2026.

## Ce que cette méthode ne peut PAS attraper

Il faut être honnête sur les limites :
- **Prix promo qui changent en silence** entre 2 audits — inévitable, seul l'audit
  périodique les rattrape
- **Migrations réseau silencieuses** (ex. Netplus mobile Sunrise→Swisscom) — même
  problème
- **Chaînes TV ajoutées/retirées** au catalogue — le script `fetch-channels.mjs`
  doit être relancé périodiquement pour garder les listes à jour
- **Vraie disponibilité géo à une adresse précise** — nécessite un checker
  d'adresse, hors périmètre

Ces limites sont **assumées** : notre objectif n'est pas la perfection, c'est de
réduire le taux d'erreurs découvertes par les utilisateurs plutôt que par nous.
