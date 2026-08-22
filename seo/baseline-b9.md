# B9 — mesure de référence, avant externalisation du catalogue

Relevé **le 22.08.2026 sur la production**, avant le push du lot SEO. Après ce
push, cette mesure n'est plus reproductible : les pages servies auront changé.
D'où ce fichier, qui la fige.

## Production, telle que servie

```
880 Ko de HTML décodé par page, identique sur les 11
  dont 783 Ko de JS inline (89 %)
       34 Ko de CSS inline
       16 Ko de JSON-LD
~143 Ko sur le fil (compression 6.2×)
DOM interactive   662 ms
DOM complete     1902 ms
23 requêtes
Total des 11 pages : 9.7 Mo
```

Le poids réseau n'est pas le problème : 143 Ko compressés, c'est ordinaire.
Le problème est que ces 783 Ko de JavaScript sont **inline**, ce qui a trois
conséquences qu'aucune compression ne corrige :

1. **Re-parsés à chaque navigation interne.** Le navigateur ne peut pas
   réutiliser le travail d'analyse d'une page à l'autre, puisque le code arrive
   à chaque fois dans un nouveau document.
2. **Aucune mise en cache possible entre les pages.** Un fichier `.js` ou
   `.json` séparé serait téléchargé une fois pour toute la visite ; inline, il
   repart avec chaque page.
3. **Chaque page transporte le catalogue entier** alors qu'elle n'en affiche
   qu'une catégorie.

## Composition réelle du JS inline

Relevée localement sur `index.html` le 22.08.2026 (`scratchpad/poids.mjs`).
C'est le chiffre qui décide de la suite : si les 774 Ko étaient de la logique,
il n'y aurait rien à externaliser.

```
index.html           900 Ko
  JS inline          774 Ko
  JSON-LD             16 Ko
  CSS inline          34 Ko

dont, dans le JS inline :
  travelData         247 Ko
  tvData             129 Ko
  mobileData         102 Ko
  comboData           46 Ko
  internetData        39 Ko
  promoData           32 Ko
  prepaidData         19 Ko
  dataOnlyData        18 Ko
  ------------------------
  données            632 Ko  = 82 % du JS inline
  logique            142 Ko  = 18 %
```

**82 % du JavaScript de ce site est un catalogue, pas du code.**

## Ce que porterait chaque page après découpage par catégorie

```
/mobile/              102 Ko   (au lieu de 632)
/prepaid/              19 Ko
/internet/             39 Ko
/dataonly/             18 Ko
/tv/                  129 Ko
/combo/                46 Ko
/promotions/           32 Ko
/voyage/              247 Ko
/couverture-reseau/     0 Ko
/comparateur/         632 Ko   ← seul cas qui a besoin de tout
```

`/comparateur/` compare des offres de n'importe quelle catégorie : c'est la
seule page dont le besoin ne se réduit pas par découpage. Elle peut en revanche
charger à la demande les seules catégories réellement sélectionnées.

## Méthode de mesure pour l'après

`npx lighthouse` en local, pas PageSpeed Insights : PSI prend plusieurs minutes
par page et **il n'existe aucune donnée CrUX sur ce domaine** — le trafic est
trop faible pour que Google en publie. Les chiffres de terrain n'existent donc
pas ; seule la mesure en laboratoire est disponible, et elle suffit pour
comparer un avant et un après sur la même machine.

Ce qu'il faut regarder, dans l'ordre :

- **Total Blocking Time** et **temps de script** — c'est là que se voit le
  parse de 632 Ko de données ;
- **LCP** ;
- **DOM interactive**, comparable au 662 ms ci-dessus.

Ne pas comparer les valeurs locales aux valeurs de production ci-dessus : pas
de latence réseau, pas de compression identique. La comparaison qui vaut est
locale avant / locale après.

## Mesure locale « avant », 22.08.2026

`npx lighthouse` sur le site servi par `node scripts/serve-local.mjs 8899`,
profil mobile par défaut (ralentissement CPU 4×), Chrome local. À rejouer à
l'identique après le découpage — c'est la seule comparaison qui vaut, les
valeurs locales n'étant pas comparables à celles de la production.

| | /tv/ | /voyage/ |
|---|---|---|
| Score performance | 45 | 42 |
| First Contentful Paint | 6 758 ms | 7 089 ms |
| Largest Contentful Paint | 8 779 ms | 8 846 ms |
| Total Blocking Time | 131 ms | 97 ms |
| Travail du fil principal | 2 310 ms | 2 212 ms |
| **Script de la page : évaluation** | **376 ms** | **315 ms** |
| **Script de la page : parse** | **198 ms** | **115 ms** |

Les deux dernières lignes sont la cible du chantier : **574 ms de CPU sur /tv/,
430 ms sur /voyage/**, dépensés à analyser puis évaluer un catalogue dont la
page n'affiche qu'une catégorie. À titre de comparaison sur la même page, gtag
coûte 234 ms et Leaflet 26 ms.

Le FCP à 6,7 s sur une machine de bureau, avec un serveur qui répond en 1 ms,
dit la même chose autrement : rien ne s'affiche tant que ce bloc n'est pas
analysé.

Commandes exactes, pour rejouer :

```bash
node scripts/serve-local.mjs 8899 &
CHROME_PATH="C:/Program Files/Google/Chrome/Application/chrome.exe" \
  npx --yes lighthouse http://localhost:8899/tv/ \
  --only-categories=performance --output=json --output-path=lh-tv.json \
  --chrome-flags="--headless=new --no-sandbox" --quiet
```

## Mesure locale « après », 22.08.2026

Même commande, même machine, après externalisation du catalogue par catégorie,
report de gtag à la première interaction et retrait de Leaflet des dix pages
qui n'ont pas de carte.

| | /tv/ avant → après | /voyage/ avant → après |
|---|---|---|
| Score performance | 45 → **63** | 42 → **55** |
| First Contentful Paint | 6 758 → **3 524 ms** (−48 %) | 7 089 → **4 574 ms** (−35 %) |
| Largest Contentful Paint | 8 779 → **3 555 ms** (−60 %) | 8 846 → **4 874 ms** (−45 %) |
| Total Blocking Time | 131 → **0 ms** | 97 → **84 ms** |
| Travail du fil principal | 2 310 → **932 ms** (−60 %) | 2 212 → **1 364 ms** (−38 %) |
| Script de la page | 574 → **191 ms** (−67 %) | 429 → **96 ms** (−78 %) |

Poids HTML par page : de 850–940 Ko à **223–308 Ko**.

### Le piège du préchargement, qu'il vaut mieux avoir noté

La première version préchargeait les autres catégories en injectant des balises
`<script>`. Elles étaient donc **évaluées et rendues** — les mille offres du
catalogue reconstruites en arrière-plan trois secondes après l'affichage,
c'est-à-dire exactement le travail qu'on venait de retirer du chargement,
réintroduit plus tard. Le LCP s'améliorait déjà, mais le Total Blocking Time
passait de 131 à **346 ms** sur /tv/ et de 97 à **451 ms** sur /voyage/.

Remplacé par `<link rel="prefetch" as="script">`, qui descend le fichier dans
le cache **sans l'exécuter** : coût processeur nul, et la balise `<script>` du
clic le retrouve déjà présent. TBT retombé à 0 sur /tv/.

La leçon vaut au-delà de ce cas : déplacer du travail n'est pas le supprimer,
et une mesure qui ne regarde que le LCP ne le voit pas.

### Ce qui reste

/voyage/ garde 709 forfaits à rendre à l'arrivée : c'est la seule page dont le
fil principal reste au-dessus de la seconde. Le découpage par destination
(`/voyage/esim-thailande/` etc.) est ce qui le réglera — lot architecture.
