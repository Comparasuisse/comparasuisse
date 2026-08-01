# AUDIT COMPLET — Méthodologie d'audit exhaustif du catalogue

**Déclencheur** : les mots-clés **« AUDIT COMPLET »**, **« AUDIT TOTAL »**,
**« relance l'audit »** dans une future conversation (même à froid, sans contexte
préalable) doivent te faire relire ce fichier intégralement et enchaîner
**automatiquement** les vagues Wx dans l'ordre, sans demander la permission
entre chaque vague.

Ce document capture noir sur blanc la méthode validée pendant la campagne
Ex1-Ex5 du 01-02 août 2026. Ne raccourcis jamais cette méthode pour aller
plus vite.

---

## 🎯 Comportement autonome

**Une seule validation utilisateur à la fin de tout le processus, pas par vague.**

- Le déclencheur unique = « AUDIT COMPLET » (ou synonyme)
- Après ce mot-clé, enchaîne les 5 vagues **sans t'arrêter** entre chacune
- Chaque changement confirmé par vérif live va **directement en commit local**
  au fur et à mesure — n'attends pas de « go » utilisateur intermédiaire
- À la toute fin, présente **un seul récap consolidé** de toute la campagne
  et le résultat du test QA final, puis **attends « push »** — c'est la seule
  validation manuelle requise

### Deux exceptions autorisées pour t'arrêter

1. **Décision éditoriale ambiguë** que tu ne peux pas trancher seul.
   Exemples de la campagne d'origine :
   - Aldi Mobile : afficher les prix promo action ou les prix réguliers ?
   - Sky Fiber+Séries : prix initial (42.90) ou prix long-terme (40.90) ?
   - Inclusion d'un plan limite : Smart 63.95 CHF-only, worth-it ou pas ?

   Dans ces cas → recommandation motivée + `AskUserQuestion` avec les 2-3
   options, reprends après réponse.

2. **Contexte technique insuffisant** pour continuer correctement (trop de
   tokens consommés, contexte compressé qui a perdu l'état de la vague en
   cours, etc.). Dans ce cas → prépare un message de reprise self-contained
   (comme celui utilisé le 01.08.2026 pour reprendre après Ex1a) avec :
   - État du repo (commits locaux ahead)
   - Vague en cours + où tu t'étais arrêté
   - Rappel des règles absolues (jamais push sans mot « push », etc.)
   - Suite du plan (vagues restantes)

   Rends la main à l'utilisateur pour qu'il ouvre une nouvelle session avec
   ce message. **Ne considère jamais un audit comme "terminé prématurément"
   pour cause de contexte** — sépare toujours en plusieurs sessions.

---

## 📋 Découpage en vagues (adapté à la charge de contexte par session)

Chaque vague Wx couvre environ 4-6 opérateurs et rentre confortablement dans
une session. Ne change pas ce découpage sans raison technique — il est
calibré sur l'expérience Ex1-Ex5.

### W1 — Petits opérateurs et grosses corrections

**W1a — Mtel** (audit exhaustif via sitemap, +9 offres possibles)
**W1b — Lebara** (audit exhaustif catalogue, +11 offres possibles)
**W1c — yallo** (Swiss Max, Europe/Europe Max/Europe Plus, ~4 plans actifs)
**W1d — Netplus** (combos : vérifier si vraie remise ou modèle à la carte)

### W2 — Grands opérateurs suisses (Swisscom + réseau)

- **Sunrise** (Swiss Travel / Swiss Travel+ / Swiss Connect Lite / Europe+
  / Young / Global / Travel East / Iconic Bundle)
- **Swisscom** (blue Mobile S/M/L/XL)
- **Salt** (Start Max / Swiss Max / Travel / Europe XL/Max/XXL / Smart /
  Swiss Travel / Swiss XXL / Travel Max) — attention à la distinction
  abo mobile vs SIM Data (Swiss 10GB, Europe Data, Surf Unlimited)
- **Coop Mobile** (Swiss S/M/L, Extra S/L, Europe M/L)
- **Migros Mobile** (Swiss Start/Classic/Max/Travel)

### W3 — TV et streaming

- **Sky** (Mobile Swiss+/Europe+, Fiber standalone, Fiber+Séries, Fiber+Sport)
- **Teleboy** (5 Internet tiers, 3 Mobile tiers, TV standalone, combo TV+Internet)
- **Zattoo** (Premium 14, Ultimate 22, HOME bundle avec Init7)
- **TeleKing / KingTV** (Silber, Gold, Platin — attention aux dates de promo
  qui bougent souvent)
- **CanalPlus Suisse** (Famille, Sport, Ciné Séries, La Totale)
- **Init7** (Easy7, Fiber7, TV7 inclus, bundles avec Zattoo Home)

### W4 — Câblo-opérateurs et alternatifs

- **Quickline** (5 Internet S/M/L/XL, 4 Mobile S/M/L/XL, combo Internet L+TV)
- **iWay** (4 Internet 20/100/1000/10000, 3 Mobile Basic/Classic/Premium,
  3 TV Classic/Premium/Top, combos Internet+TV)
- **VTX** (3 Pack Internet 50M/100M/1 GIGA MAX, 5 Mobile Swiss 5Go/Swiss/
  Europe Data/Europe/International)
- **Galaxus** (3 Internet 200/1G/10G Fiber, 3 Mobile Basic/CH Illimité/
  International)

### W5 — MVNO

**W5a — MVNO Sunrise + Salt group 1**
- **Mucho** (Nano, Mini, Swiss, Europe Surf, Europe, Europe Full, +DATAMINI)
- **Swype** (Surf, Swiss, Surf Europe, Europe)
- **Spusu** (10, 15, legendär XXL, Europa, Europa XL — vérifier si spusu 1
  n'est pas ressuscitée)
- **GoMo** (Suisse, Europe + National Day Deal souvent en promo)

**W5b — MVNO Sunrise group 2**
- **Talk Talk** (SWISS LIGHT, Purple Deal, Swiss Extra Flex, International
  S/L, Swiss Premium, ALL IN, +Home Fast/Home ULTRA/Surf 100/Surf 1000)
- **CHmobile** (Plus, Europe — souvent en promo temporaire)
- **Aldi Mobile** (Basic, Medium, Swiss Unlimited, Swiss Unlimited Extra,
  International, Roaming Unlimited — souvent en AKTION saisonnière)
- **Digital Republic** (Flat Mobile Swiss, Flat Mobile, Flat Mobile Plus,
  Flat Home 4G, Flat Home 5G, + Smart Devices data tiers)

**W5c — MVNO Salt + Post + spécialistes**
- **Lycamobile** (Hello Swiss S/M/L/Max/Truly Unlimited/Daily, Surf UL)
- **Lidl Connect** (Swiss Abo 12 Go, Surf & Call, Swiss Unlimited, Europe,
  Smart Prepaid — souvent promos week-end)
- **Post Mobile** (Start, Swiss, Europe, World, Young + Surf 5 GB /
  Surf Unlimited en SIM Data)
- **MaxiMobile** + **MaxiData** (Small, Start, Classic, Plus, Ultra pour
  chaque)

### Opérateurs à intégrer si nouveaux apparus dans le marché

À vérifier ponctuellement : Wingo, TeleClub, Zattoo (déjà couvert),
Salt Home TV, Sky Show/Sport standalone, m-budget mobile.

---

## 🔬 Méthode d'audit par opérateur (à appliquer pour chacun)

### Étape 1 — Croiser sitemap × landing publique

Voir [[feedback-audit-sitemap-landing-check]] dans la mémoire.

1. **Fetch sitemap.xml** de l'opérateur pour lister toutes les URLs
   candidates. Attention aux sitemaps redirigés (Sunrise redirect
   `/aem/sitemap.xml` qui renvoie l'homepage SPA — dans ce cas, utiliser
   le browser MCP).
2. **Fetch la landing publique** (typiquement `/fr/mobile`,
   `/fr/abonnements`, `/fr/plans/…`) qui est LA source de vérité pour
   « ce qu'un nouveau client peut souscrire aujourd'hui ».
3. **Différence sitemap \ landing** = URLs orphelines. Vérifier
   ponctuellement (JSON-LD price vide, taille de page anormalement
   petite, absence des cards dans la nav de la landing) pour confirmer
   qu'elles sont bien retirées du catalogue → **ne pas ajouter**.
4. Le comparateur doit refléter ce qui est **réellement souscriptible**
   aujourd'hui, pas l'archive SEO.

### Étape 2 — WebFetch → si insuffisant, browser MCP inline

Voir [[feedback-webfetch-screenshot-ground-truth]] et
[[feedback-no-reports-playwright-inline]].

1. **WebFetch d'abord** pour un premier scan de prix.
2. **Ne pas faire confiance aveuglément** aux tableaux de prix retournés
   par WebFetch. Le petit modèle de résumé peut confondre prix barré /
   prix promo / prix hardware / prix marketing. Cas connu : VTX Mobile
   où WebFetch a listé les prix catalogue (19.95, 39.95) au lieu des
   prix promo courants (14.95, 44.95) confirmés au screenshot.
3. Si le résumé WebFetch **contredit nos données actuelles** ou paraît
   incohérent → **immédiatement** rendre la page dans le browser MCP
   (`mcp__Claude_Browser__navigate` puis `javascript_tool` /
   `computer{action:"screenshot"}`) et vérifier au DOM rendu.
4. **Zéro report** — jamais de « je verrai ça dans une passe Playwright
   dédiée plus tard ». Chaque cas se traite dans la vague en cours,
   quitte à passer plus de temps.
5. Sur les SPA Next.js (Sunrise, Sky, Init7…), le WebFetch retourne
   souvent la coque HTML sans les prix. Passer directement au browser.
6. Sur les sites à cookie modal bloquant (Spusu, Aldi, Mucho, Lidl…) :
   `document.querySelectorAll('[class*="cookie"], [class*="consent"], [role="dialog"]').forEach(m=>m.style.display='none')`
   pour débloquer sans accepter les cookies (règle privacy).

### Étape 3 — Vérification par tier

Pour chaque plan retenu, vérifier les 8 points de CHECKLIST-OFFRE.md :
`price`, `beforePrice` (si promo), `chDataGB`/`speed`, `roamData`+`roamDataGB`+
`countries`, `chUnlimited`+appels/SMS, `network`, engagement, disponibilité géo.

Extension pour TV : `channels`, `replayDays`, `recordingHours`, `streaming`.

Toujours renseigner `verifiedAt` (date du jour, format ISO) et `sourceType`
(`product-page` / `factsheet-pdf` / `third-party` / `third-party-capture` /
`assumption`).

### Étape 4 — Distinguer abo mobile vs SIM Data only

Un plan « SIM Data » a **uniquement de la data**, pas d'appels/SMS. Il va
dans `dataOnlyData`, pas `mobileData`. Exemples : Post Mobile Surf 5 GB
(4.95, data-only confirmée), Post Mobile Surf Unlimited (16.95, SIMO), Salt
Surf Unlimited (19.95), Digital Republic Data Flat 0.4/1/10/50/300/2000.

Vérifier chaque plan borderline via sa page produit avant de le classer.

---

## 🚨 Règles absolues (non négociables)

### 1. Jamais de `git push` sans le mot « push » explicite

Voir CHECKLIST-OFFRE.md ligne 3. Même après le récap consolidé final,
attendre le « push » de l'utilisateur.

### 2. Zéro report — chaque vague 100% complète

Voir [[feedback-no-reports-playwright-inline]]. Jamais de « passe dédiée
plus tard ». Un cas non-résolu doit être escaladé à l'utilisateur
immédiatement (voir décisions éditoriales ambiguës ci-dessus).

### 3. Countdowns temps réel — obligatoire pour toute promo à durée limitée

Toute promo dont la deadline est visible sur le site officiel (bandeau
« National Day Deal jusqu'au 03.08 », compte à rebours flash Mucho, action
Aldi 20.07-15.08, etc.) doit avoir :

- Une entrée `promoData` dédiée avec `to:"YYYY-MM-DD"` (ou
  `to:"YYYY-MM-DDTHH:MM:SS"` pour deadline à l'heure précise, comme
  Mucho Nano `2026-08-03T11:59:59`)
- L'URL de l'entrée `promoData` doit **matcher exactement** l'URL de
  l'offre mobileData/internetData/tvData/comboData pour que
  `bannerForOffer(item)` la retrouve via `promoByUrl` et injecte le
  bandeau sur la carte d'origine
- Vérifier en browser que le bandeau `⏰ Il te reste HH:MM:SS` s'affiche
  bien et que le compteur défile en temps réel via `tickPromoBanners`

Chercher la vraie heure de fin sur la page officielle : souvent dans un
`<script>` en `new Date("YYYY-MM-DDTHH:MM:SS")`, ou dans le tag
`slt-announcement-bar` avec attribut `text` mentionnant la date.

### 4. Checkboxes de filtre — vérifier à chaque nouvel opérateur/tier

Voir CHECKLIST-OFFRE.md lignes 288-309. Bug historique récurrent (3 fois
minimum : TV Init7/Netplus/iWay/MaxiConnect/Teleking/CanalPlus, combo Talk
Talk, dataOnly Post Mobile pendant Ex5c).

**Protocole obligatoire à chaque commit qui ajoute une entrée**
`tvData` / `comboData` / `dataOnlyData` avec un **operator non déjà présent** :

1. Grep les checkboxes existantes : `grep 'data-op="' index.html`
2. Vérifier que l'operator apparaît dans la bonne section :
   - `#tv-operator` pour `tvData`
   - `#combo-operator` pour `comboData`
   - `#dataonly-operator` pour `dataOnlyData`
3. Sinon, ajouter `<label class="net-chip"><input type="checkbox" data-op="OperatorName" checked><span>OperatorName</span></label>` dans la section correspondante
4. **Rechecker en browser** que les nouvelles offres apparaissent
   effectivement dans l'onglet (comme fait sur Post Mobile Surf 5 GB
   à Ex5c)

Note : Mobile et Internet utilisent des checkboxes de **réseau** (pas
d'opérateur), donc ce bug n'y survient que si on introduit un nouveau
**type de réseau**.

### 5. Prépaid tab utilise réseau, pas operator — pas de bug possible

Vérifié à Ex5c : ajouter des Lycamobile Hello Swiss S/M/L n'a pas nécessité
de nouvelle checkbox car prepaid filtre par network uniquement.

### 6. Validation syntax après tout patch

Voir CHECKLIST-OFFRE.md lignes 247+ (règle absolue vérif syntaxique). Après
chaque edit d'index.html, lancer :

```bash
node -e "const fs=require('fs');const html=fs.readFileSync('index.html','utf8');const scripts=[...html.matchAll(/<script(?![^>]*src=)[^>]*>([\s\S]*?)<\/script>/g)].map(m=>m[1]);const largest=scripts.reduce((a,b)=>b.length>a.length?b:a,'');fs.writeFileSync('.check.tmp.mjs',largest);" && node --check .check.tmp.mjs && rm -f .check.tmp.mjs
```

### 7. Bump du footer « Prix vérifiés le … »

À chaque commit qui contient au moins une vraie vérification live, bumper la
ligne `<span style="opacity:.7;">Prix vérifiés le [date]</span>` du footer
d'index.html à la date du jour (règle mémoire existante).

---

## 📝 Protocole de fin de vague (autonome — pas de récap intermédiaire)

En mode AUDIT COMPLET, après chaque vague :

1. **Commit local** avec message détaillé (format existant : opérateur,
   changements listés, contexte, note aucun report). Toujours co-authored
   Claude.
2. **Ne présente PAS de récap à l'utilisateur** — enchaîne directement sur
   la vague suivante. Le récap détaillé arrivera à la fin.
3. **Log très concis** possible : « Vw commit `xxxxxxx` — N changements
   appliqués, aucun cas reporté. Passage à Wx+1. »
4. Ne demande jamais « dis go pour la suite » entre vagues. Enchaîne.

---

## 🧪 Protocole de fin d'audit (test QA final)

Après la dernière vague, avant de présenter le récap consolidé et
d'attendre « push », lancer un test QA complet en browser MCP sur le
fichier local `file:///.../index.html` :

### Tests obligatoires

1. **Comptage par onglet** — les 7 onglets s'ouvrent et affichent bien
   « X / X offre(s) » cohérent avec les ajouts/suppressions de la campagne.
2. **Filtres** — sur au moins l'onglet Mobile, tester :
   - Slider prix max (ex : 15 CHF → doit filtrer à N offres)
   - Checkbox réseau (ex : Salt only → doit filtrer)
   - Reset → tous les checkboxes back on → count original
3. **Checkboxes operator missing bug** — grep exhaustif de tous les
   opérateurs dans les 3 datasets vs les checkboxes existantes :
   ```js
   // dans le browser DOM
   const ops = [...document.querySelectorAll('input[data-op]')].map(c => ({op: c.dataset.op, section: c.closest('[id]')?.id}));
   ```
   Ensuite comparer avec les operators uniques dans dataOnlyData /
   tvData / comboData. Toute divergence = bug à corriger avant push.
4. **Comparateur** — sélectionner 2 offres via `+ Comparer`, cliquer
   « ⚖️ Comparaison », vérifier que le tableau s'affiche avec tous les
   champs (Prix, Réseau, Data, Roaming, Appels, Promo, Lien).
5. **Chaînes TV** — ouvrir un accordéon « Voir les chaînes », tester la
   recherche par mot (ex : « BBC » → doit filtrer les chaînes visibles).
6. **Countdowns** — vérifier que tous les bandeaux `⏰ Il te reste
   HH:MM:SS — jusqu'au ...` sont visibles pour toutes les promos < 48h,
   et que les secondes défilent (comparer 2 lectures espacées de ~3s).
7. **Post-changement** — pour chaque opérateur avec nouvelle offre ou
   suppression, vérifier dans le bon onglet que la carte apparaît (ou
   n'apparaît plus).

### Correction inline des bugs QA

Si le test QA détecte un bug (checkbox manquante, countdown qui ne
s'affiche pas, syntax error, prix cassé), corriger immédiatement dans
un commit `fix(...)` séparé avant de présenter le récap final. Pas de
récap avec « il reste ce bug à corriger ».

### Récap consolidé final

Format à respecter (une seule section unique en fin de conversation) :

```
## AUDIT COMPLET — Récap consolidé

**Total** : N commits locaux ahead de origin/main, XX opérateurs audités,
YY changements de données appliqués, ZZ bugs QA corrigés inline.

### Vagues (5 lignes)
- W1 : ... (N changements)
- W2 : ...
- W3 : ...
- W4 : ...
- W5 : ...

### Test QA (checklist ✅/❌)
- [ ] 7 onglets — counts corrects
- [ ] Filtres réactifs
- [ ] Toutes checkboxes operator présentes
- [ ] Comparateur fonctionnel
- [ ] Accordéons chaînes + recherche
- [ ] Countdowns temps réel visibles
- [ ] Aucun cas reporté

### Commits locaux (liste chronologique inverse)
...

**Confirmation : c'est bon pour le push. Dis « push » pour publier.**
```

Puis attendre. **Ne rien pousser** avant que le mot « push » n'apparaisse
littéralement dans le message utilisateur.

---

## 🔗 Références mémoire

Toutes les règles ci-dessus renvoient aux mémoires suivantes :

- [[feedback-audit-sitemap-landing-check]] — sitemap ≠ catalogue actif
- [[feedback-no-reports-playwright-inline]] — zéro report Playwright inline
- [[feedback-webfetch-screenshot-ground-truth]] — WebFetch summary ≠ DOM
- [[feedback-verify-offers-live]] — vérif live systématique
- [[feedback-verify-all-offers-workflow]] — passe catalogue complet
- [[feedback-show-before-push]] — validation UI avant push
- [[feedback-checklist-ajout-offre]] — 8 points obligatoires + verifiedAt/sourceType

Et à CHECKLIST-OFFRE.md pour les règles techniques (syntax check, bump
footer date, etc.).

---

## ⏱ Note sur la durée

Un AUDIT COMPLET est long : ~4-8 heures cumulées de travail effectif,
répartissables sur plusieurs sessions selon l'usage du contexte.
**Ne raccourcis JAMAIS** la méthode pour aller plus vite, même si l'utilisateur
te met la pression sur la durée : la valeur d'un catalogue précis vient
précisément de cette rigueur. Si le contexte s'épuise en cours, prépare le
message de reprise self-contained (voir exception #2 ci-dessus).
