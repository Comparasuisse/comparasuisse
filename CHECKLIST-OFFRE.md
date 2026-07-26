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
