# Checklist obligatoire à chaque ajout ou modification d'offre

## 🚨 RÈGLE ABSOLUE #1 : jamais de `git push` sans autorisation explicite

**Cette règle prime sur tout le reste.** Elle est la plus importante du projet
côté workflow.

- **NE JAMAIS** exécuter `git push` sans que le propriétaire l'ait demandé
  explicitement dans un message, peu importe le contexte : commit prêt, suite
  logique évidente, "go", "applique", validation d'un plan, etc.
- Le mot **"push"** (ou synonyme direct : "on pousse", "envoie", "publie",
  "déploie") doit apparaître **littéralement** dans la demande courante.
- **Correspondances valides** : `go push`, `go commit + push`, `push maintenant`,
  `on pousse`, `envoie ça`, `déploie sur main`.
- **Correspondances invalides** : `go`, `go commit`, `applique`, `procède`,
  `on y va`, `valide`, `commit local`, `enchaîne`, `continue`.
- Une autorisation "push" vaut pour **un seul push**. Le prochain commit
  nécessite une nouvelle autorisation, même dans la même session.
- Un `git push --force` exige une demande **encore plus explicite** — jamais
  déduit d'un "push" simple.

**Pourquoi cette règle** : chaque push déclenche un rebuild Netlify (facturé)
et surtout un déploiement en prod que le propriétaire veut valider AVANT
qu'il parte. La règle a été enfreinte plusieurs fois par le passé —
d'où l'insistance sur l'explicite absolu du mot "push".

---

## 🚨 RÈGLE ABSOLUE #1.5 : Playwright/browser MCP OBLIGATOIRE pour toute vérif prix/promo

**Ne jamais se fier à un simple WebFetch** pour confirmer un prix, un
rabais, ou l'absence de promo à durée limitée. Toute page produit
opérateur peut contenir un widget countdown ou bandeau flash chargé
**uniquement en JavaScript**, invisible pour un fetch statique.

**Protocole obligatoire à chaque vérif live d'offre** :

1. WebFetch autorisé uniquement comme pré-scan grossier (identifier les
   URLs, la structure).
2. `mcp__Claude_Browser__navigate` sur la page produit + attendre le
   rendu complet (2-3 s pour SPA).
3. `javascript_tool` pour inspecter le DOM finalisé et chercher
   **explicitement** les patterns de countdown :
   - Élément visible avec texte `n jours n h n min n sec`
   - Widget `<lib-countdown>` Angular
   - Bandeau `<slt-announcement-bar>`
   - Div `.timer-container` / `.plan-countdown` / `.pack-expirable-offer`
   - Texte type « À saisir », « Rabais disponible », « Encore n h »
4. Screenshot obligatoire si un doute persiste sur la visibilité du
   widget ou sur son état actif.
5. Si countdown détecté → extraire deadline via `new Date("…")` inline,
   ou calcul `now + msLeft` depuis les valeurs affichées, et créer
   entrée `promoData` dédiée (voir AUDIT-COMPLET.md §3).

**Pourquoi cette règle** : la campagne d'audit Ex1-Ex5 (01.08.2026) a
vérifié tous les prix Mucho via extraction DOM `.entire`+`.decimal` mais
n'a pas capturé les 5 countdowns cachés (Mini/Swiss/Europe Surf/Europe/
Europe Full pointaient vers deadline flash `2026-08-03T11:59:59`). Le
02.08.2026, remontée utilisateur sur Mucho Europe Full a révélé le
manque : « RABAIS -62% DISPONIBLE 1j 11h 44min 26sec » sur widget
`.timer-container`. Même chose découverte le lendemain sur CHmobile
Plus + Europe (widget `<lib-countdown>`).

Un rabais annoncé « permanent » / « à vie » / « sans date » peut
malgré tout avoir une fenêtre de souscription limitée (prix verrouillé
à vie SI souscrit pendant la fenêtre). Ne pas se fier à la formulation
marketing seule.

Voir AUDIT-COMPLET.md pour le chantier récurrent **AUDIT COUNTDOWN**
qui repasse périodiquement toutes les offres marquées « à vie » avec
Playwright.

---

## Règle absolue #2 (ajout de données)

Rien n'est ajouté dans `mobileData` / `internetData` / `tvData` /
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
- `third-party-capture` — Capture texte tierce d'un document officiel non parseable
  directement (ex. PDF Swisscom senderliste publié en format image → capture texte
  via expertfries.ch). Cas rare : oblige à renseigner `channelsSourceNote` ou une
  mention équivalente dans `details` pour signaler le repli.
- `assumption` — Déduction ou extrapolation non vérifiable publiquement (à utiliser
  avec parcimonie ; oblige à noter dans `details` la nature de l'hypothèse)

**Backfill progressif** : les offres pré-existantes ne sont pas rétro-marquées
en masse (trop imprécis) ; elles reçoivent leurs champs `verifiedAt`+`sourceType`
au fur et à mesure des audits ou modifications.

---

## 🎯 Booléens 3-états : `null` par défaut, jamais de déduction marketing

Tout champ booléen à **3 états** (`true` / `false` / `null`) doit être `null`
par défaut tant que la donnée n'est pas **explicitement confirmée tier par tier**
sur la source officielle de l'opérateur. Jamais de déduction depuis un texte
marketing général, même si la supposition semble raisonnable.

Concerne notamment : `routerAllowed`, `ownRouterAllowed`, `streaming`,
`autoRenew`, `chUnlimited`, `roamUnlimited`, `networkChoice`, et tout futur
champ optionnel à 3 états.

**Convention côté rendu** :
- `true` → affiche la pill positive (« 🔧 Autorisé pour routeur »)
- `false` → affiche la pill négative (« 📵 Non autorisé pour routeur »)
- `null` → **rien affiché** (neutre — on ne prétend rien)

**Convention côté filtre** : `if (routerOnly && item.routerAllowed !== true)
return false;` — un champ `null` ne passe pas un filtre restrictif, par prudence.
L'utilisateur qui coche « routeur uniquement » ne veut voir QUE ce qui est
explicitement confirmé, pas ce qui « pourrait probablement » convenir.

### Exemple concret (2026-07-27) : MaxiData vs Digital Republic

**Digital Republic** (`digitalrepublic.ch/en/smart-devices/`) documente
explicitement, tier par tier, sur la page produit :
- Flat 0.4/1/10 : aucune mention router → `routerAllowed: false`
- Flat 50/300/2000 : mention « For Routers and Laptops » / « For Router and
  mobile Hotspots » → `routerAllowed: true`

→ Données **source-vérifiées par tier**, pill affichée avec confiance.

**MaxiData** (`maxiconnect.ch/fr/maxidata`) ne documente PAS l'autorisation
router par tier. Le pitch général mentionne bien « Pour tablettes, routeurs
mobiles et objets connectés » et « Routeur mobile en option », mais rien
n'est écrit sur Small vs Classic vs Plus vs Ultra individuellement.

→ Ma valeur initiale `routerAllowed: true` était une **déduction marketing**,
pas une vérif. Corrigée en `routerAllowed: null` (commit 38862ea) : plus aucune
pill affichée, et le filtre « router-only » exclut désormais MaxiData jusqu'à
confirmation formelle (contact support ou update de la page produit).

**Why** : la promesse du comparateur est la fiabilité. Un badge « 🔧 Autorisé
routeur » qui s'avère faux à l'usage détruit la confiance bien plus vite qu'un
badge absent. Dans le doute, on n'affiche pas — l'utilisateur peut toujours
cliquer sur « Voir l'offre » pour vérifier lui-même sur la page opérateur.

---

## 📦 Offres combo : vraie remise obligatoire avant ajout

Pour tout ajout d'offre **combo** (Internet+TV, Mobile+Internet, Multi-service,
etc.) dans `comboData` : **vérifier explicitement s'il existe une vraie remise
combo par rapport à la somme des prix standalone des composants**, AVANT ajout.

**Test à faire systématiquement** :
1. Noter le prix standalone de chaque composant (ex : Internet 44.90 + TV 14.90 séparés)
2. Noter le prix total combo affiché par l'opérateur (ex : 56.80 pour le pack)
3. Comparer : différence > 0 = vraie remise combo → ajout justifié
4. Différence = 0 = simple addition = **NE PAS AJOUTER**

**Pourquoi cette règle** : le visiteur peut déjà comparer les 2 services
séparément dans leurs onglets respectifs (Internet, TV, Mobile). Ajouter un
combo sans rabais dans `comboData` n'apporte aucune valeur — juste du bruit
qui gonfle artificiellement le compteur « X offres combos ». La promesse
implicite du comparateur combo est : « voici les vraies remises quand tu
regroupes tes abos ». Un « faux combo » brise cette promesse.

**Cas rencontrés le 2026-07-27 (audit systématique)** :

| Opérateur | Verdict | Justification |
|---|---|---|
| ✅ Sunrise Up Connect L + TV | **Ajouté** | -26% permanent, prix combo < somme standalone |
| ✅ Sky Fiber + Séries | **Ajouté** | Fiber 39.- + Sky Show ~14.90 = ~54 CHF vs 42.90 combo (-11) |
| ✅ Quickline Internet L + TV | **Ajouté** | TV 0.-/mois pendant 24m (économie ~15 CHF/mois) |
| ✅ Teleboy Home 1 Gbit/s + TV | **Ajouté** | TV combo 11.90 vs 14.90 standalone (-3 CHF/mois à vie) |
| ❌ SAK Digital | **Non ajouté** | Simulateur combo affiche la SOMME BRUTE des prix standalone : Internet S 33.- + TV S 17.- = 50.- combo (aucune remise). Modèle « à la carte » |
| ❌ iWay | **Non ajouté** | Documentation officielle : « does not offer fixed combo packages, but you can combine all their telephony packages with their internet packages as desired » |
| ❌ Green | **Non ajouté** | Modèle « flexible / mix and match » — packs personnalisables sans rabais combo forcé |
| ❌ Netplus (BLI BLA BLO) | **Non ajouté** | Packs personnalisables via partenaires locaux, aucun prix combo standardisé affiché |
| ❌ Migros Mobile | **Non ajouté** | URLs 404 (site en refonte), impossible d'auditer maintenant — à réessayer plus tard |

**Note importante sur les rabais non-mensuels** : certains opérateurs affichent
« Économisez jusqu'à X CHF » sur leurs combos, mais cette économie porte
uniquement sur les frais d'activation (99.- offerts, 79.- offerts, etc.), pas
sur les prix mensuels. C'est un rabais **one-shot**, pas un rabais combo à vie.
Ces cas doivent être classés comme « pas de vraie remise combo » sauf si
l'économie mensuelle est aussi présente. Exemple concret : le simulateur SAK
affiche « Sie sparen bis zu 247 CHF » qui correspond au cumul des frais
d'activation offerts, pas à un rabais mensuel — donc pas un vrai combo.

---

## ☎️ Opérateur qui vend de la téléphonie fixe → lire `TELEPHONIE-FIXE.md`

Avant d'intégrer un opérateur proposant une **ligne fixe**, appliquer
l'arbre de décision de `TELEPHONIE-FIXE.md`. Trois structures commerciales,
trois destinations différentes — à trancher **cas par cas sur le formulaire
de commande de l'opérateur**, jamais par analogie avec un opérateur voisin :

1. Téléphonie souscriptible **seule** → catégorie/entrée dédiée
2. Téléphonie **inséparable** de l'internet → `fixedLineIncluded: true`
   dans `internetData` (booléen 3 états, `null` par défaut)
3. **Forfait multi-services figé** à prix unique → `comboData`, et
   seulement s'il passe le test de remise combo ci-dessous

Premier cas tranché : **K-Sys** (14.08.2026) = cas 2.

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

## 🛡️ Règle absolue : vérif syntaxique après tout patch d'index.html

**Tout script qui écrit dans `index.html` DOIT valider la syntaxe JS du script
inline avant de terminer.** Le helper à utiliser :

```js
import { verifyIndexHtmlSyntax } from "./lib/verify-index-syntax.mjs";
// ... fs.writeFileSync("index.html", patched);
verifyIndexHtmlSyntax({ backupPath: BACKUP }); // exit(1) + rollback si cassé
```

Le helper extrait le plus gros `<script>` inline, le passe à `node --check`, et
en cas d'erreur : affiche l'erreur formatée + restaure depuis le backup fourni
+ `process.exit(1)`. Un fichier index.html cassé ne peut donc plus arriver
jusqu'au `git commit`.

**Scripts déjà câblés** :
- `scripts/apply-channels.mjs`
- `scripts/append-price-point.mjs`
- `scripts/audit-random.mjs` (mode `--history`)

**Pattern à respecter pour tout nouveau script qui modifie index.html** :

```js
const BAK = ".index.html.<script-name>.bak";
fs.copyFileSync("index.html", BAK);
try {
  fs.writeFileSync("index.html", newContent);
  verifyIndexHtmlSyntax({ backupPath: BAK });
} finally {
  try { fs.unlinkSync(BAK); } catch {}
}
```

**Why** : le commit 7e84e1c a poussé un `index.html` avec une erreur de syntaxe
JS globale (fragment orphelin de tableau, cassé par le bug d'idempotence du
regex de suppression dans `apply-channels.mjs`). Le site est resté totalement
bloqué en prod (aucun onglet cliquable, aucune offre visible) jusqu'au hotfix
5d1952f. Ce garde-fou empêche définitivement ce scénario : même si le regex
d'un script foire, le fichier ne peut plus atteindre le disque en état cassé.

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

## 📺 Règle absolue : liste des chaînes TV OBLIGATOIRE à chaque ajout `tvData` / `comboData`

Chaque fois qu'une offre TV est ajoutée (dans `tvData` OU dans une entrée
`comboData` qui inclut de la TV), la **liste complète des chaînes** doit être
extraite via `scripts/fetch-channels.mjs` et injectée dans le champ
`channelsList` (accordéon "Voir les chaînes" + recherche sur la carte).

**Format** : soit un array flat (`["RTS 1", "TF1", ...]`), soit un objet
catégorisé (`{"Généralistes":[...], "Sport":[...]}`) selon ce que la source
fournit.

**Sources acceptables** (par ordre de préférence) :
1. PDF officiel du fournisseur (Swisscom, Sunrise, etc.) → parseur pdfjs
2. Page HTML dédiée avec DOM extractible (Zattoo, Teleboy, KingTV, Init7,
   MTEL via `img alt` sur logos)
3. Fichier XSPF/M3U/JSON exposé par l'opérateur
4. Extraction manuelle depuis une capture texte tierce (avec `channelsSourceNote`
   qui documente la source)

**Si aucune source publique n'existe** (déjà rencontré sur MaxiTV et sur le
bouquet "Salt Home base") : ne PAS inventer une liste. Documenter clairement
dans `channelsList: null` + `channelsSourceNote` avec le raison (opérateur ne
publie pas de grille détaillée, seulement un pitch marketing "300+ chaînes",
etc.), et laisser le lien externe vers la page opérateur pour que le visiteur
puisse consulter directement.

**Réflexe systématique** : NE JAMAIS ajouter une offre TV sans avoir tenté
l'extraction via fetch-channels. Si tu ajoutes sans channelsList, tu dois
avoir tenté ET documenté pourquoi.

**Exemples de fallback documenté acceptables** :
- MaxiTV : `channelsSourceNote: "MaxiConnect ne publie pas de grille détaillée
  publique"`
- Salt Home base (avant extraction) : `channelsSourceNote: "Bouquet standard
  285 chaînes, liste PDF non publiée officiellement"`

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

- **1er septembre 2026 (idéalement dès disponibilité)** : check ciblé Wingo Swiss Smart et
  Swiss Plus. Sourcing forum (à confirmer publiquement) : Wingo Swiss Smart
  deviendrait disponible pour tous via wingo.ch directement, remplaçant
  Swiss Plus qui disparaîtrait. **Prix pressenti : 26.95 CHF** (précision
  contributeur redge 2026-07-27 : Swiss Plus 25.95 + 1 CHF migration, cohérent
  avec la hausse globale annoncée sur adaptation-2026). Situation vérifiée
  le 2026-07-27 : redirection `wingo-swiss-plus/` → `wingo-swiss-max` déjà
  active, page produit `wingo-swiss-smart` existe mais marquée « Abo
  actuellement indisponible » (spec confirmée : illimité CH + 3 Go UE/UK,
  réseau 5G Swisscom, frais 59.-, sans engagement). Prix non affiché sur
  wingo.ch. Chez mobilezone.ch : Swiss Smart 24M à 69.-/mois (revendeur
  avec engagement 24m, non représentatif du tarif wingo.ch direct à venir).
  « 2e SIM incluse » n'apparaît OFFICIELLEMENT que sur Wingo International
  Pro (communiqué mai 2026), pas sur Swiss Smart — donc l'affirmation
  du forumeur reste à confirmer début septembre.
  **Ne pas ajouter Swiss Smart aux données avant confirmation du prix
  officiel sur wingo.ch dès le 01.09** (juste valider 26.95 CHF, spec,
  2e SIM ou non — plutôt que deviner).

- **1er-2 août 2026** : re-vérifier manuellement les 3 offres SIM Data
  yallo (Go! S, Go! Max, Go!) suite à la hausse annoncée « Nouveaux prix
  dès le 1.8.2026 » visible sur yallo.ch/fr/internet-go. Prix actuels
  vérifiés le 2026-07-27 : Go! S 9.90 (vs 30.50), Go! Max 14.90 (vs 60.50),
  Go! 40.50 (pas de rabais). Après revérif, bumper prix + verifiedAt +
  ajouter point priceHistory via `scripts/append-price-point.mjs`.

- **Dès qu'un premier lien `affiliateUrl` sera activé** sur une offre
  (candidature Awin ou alao validée) : **remettre en place la phrase de
  divulgation d'affiliation dans le footer d'index.html**. Texte à
  restaurer : « Comparateur indépendant, financé par des commissions
  d'affiliation sur les offres marquées 🤝 Partenaire — sans impact sur
  ton prix ni sur le classement (toujours par prix croissant). ». Mettre
  aussi à jour la FAQ (question « Comparasuisse est-il vraiment un
  comparateur indépendant ? »), le FAQPage JSON-LD, et la section
  « Modèle économique » des mentions légales pour retirer la mention
  « aucune commission perçue actuellement ». La phrase actuelle
  « Comparateur indépendant. » suffit tant qu'aucun lien affilié n'est
  actif — la ré-activer avant serait de la publicité trompeuse (LCD).

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
