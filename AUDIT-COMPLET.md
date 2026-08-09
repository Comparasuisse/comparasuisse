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

## ⚙️ Architecture hybride (processus standard depuis le 03.08.2026)

L'audit n'est plus déclenché exclusivement à la main : un scan quotidien
automatisé décide chaque matin si un AUDIT COMPLET manuel est nécessaire,
ou si le catalogue est stable et n'a besoin d'aucune intervention.

### 1. Scan quotidien automatisé (rapide, sans jugement)

Le script **`scripts/_audit-catalog.mjs`** est planifié par le Task Scheduler
Windows (voir **`scripts/install-daily-audit-task.ps1`** pour l'installer,
défaut : 07:00, rattrapage si PC éteint). À chaque run il :

1. Parcourt **toutes les offres** du catalogue qui ont une `url` (277 offres,
   ~175 URLs uniques au 03.08.2026).
2. Charge chaque URL via Playwright headless (Chrome local).
3. Extrait les prix visibles avec la même regex que `audit-random.mjs`
   (les fragments sont recollés — voir `scripts/lib/audit-lib.mjs`).
4. Compare le prix stocké au prix trouvé sur la page.
5. **Flague explicitement** quatre types de cas ambigus :
   - **Prix inextractable** → `PAGE_VIDE` ou `NON_VÉRIFIABLE`
     (page SPA bloquée sur un loader, protection bot, prix « à partir de… »).
   - **Mots-clés marketing agressifs** dans le texte visible :
     `à vie`, `pour toujours`, `countdown`, `il te reste`, `expire`,
     `à saisir`, `jusqu'au`, `flash promo`, `aktion`, `national day`,
     `summer deal`, `last chance`, etc.
     (liste maintenue dans `SUSPICIOUS_KEYWORDS`).
   - **Écart de prix** peu importe le sens (hausse ou baisse) →
     verdict `ÉCART` avec les prix trouvés + suggestions à ±15%.
   - **TIMEOUT** : la vérification a dépassé le hard timeout (20 s par
     défaut, `hardTimeout` dans `audit-lib.mjs`). Cf. § 7 ci-dessous
     pour le contexte de cette garde-fou.
6. Écrit un rapport rolling dans **`scripts/daily-audit-log.md`**
   (le run le plus récent en tête) + met à jour
   **`scripts/daily-audit-state.json`** avec la date du dernier run
   et la date de la dernière passe complète manuelle validée.

Ce script **ne modifie jamais `index.html`** et n'auto-corrige rien.
C'est un capteur, pas un correcteur.

### 2. Décision : AUDIT COMPLET manuel oui / non

Le rapport ouvre par un verdict binaire :

- **🚨 AUDIT COMPLET REQUIS** si l'une de ces conditions est vraie :
  - au moins un cas flagué (écart, illisible, mot-clé suspect), OU
  - au moins **1 jour** s'est écoulé depuis la dernière passe complète
    manuelle (seuil `DAYS_BEFORE_FORCED_FULL_PASS` = 1, comparateur `>=` :
    trigger dès le lendemain d'une passe complète — audit exhaustif
    quotidien souhaité).
- **✅ Pas de trigger** sinon : le catalogue est réputé stable, aucune
  intervention nécessaire ce jour.

### 3. AUDIT COMPLET manuel (Playwright + jugement)

Quand le trigger tombe, on relance la méthode manuelle décrite plus bas
(vagues Wx, browser MCP, jugement sur les cas ambigus, commits par vague).
La **différence importante** : on ne re-visite pas tout le catalogue à
chaque fois — on cible :

- **Les cas flagués** listés dans `scripts/daily-audit-log.md` (obligatoire).
- **Un tour de vérification légère** sur le reste du catalogue au moins
  quotidien (obligatoire — c'est le rôle du seuil à 1 jour).

Une fois la passe manuelle validée, commitée et pushée, exécuter :

```bash
node scripts/_audit-catalog.mjs --mark-full-pass
```

pour enregistrer la date dans le state et remettre le compteur à zéro.
Sans cette étape, le trigger « overdue » se re-déclenchera dès le
lendemain.

### 4. Commandes utiles

```bash
node scripts/_audit-catalog.mjs                       # run complet
node scripts/_audit-catalog.mjs --limit 20            # premiers 20 (debug)
node scripts/_audit-catalog.mjs --category mobile     # subset catégorie
node scripts/_audit-catalog.mjs --dry-run             # inventaire sans Playwright
node scripts/_audit-catalog.mjs --mark-full-pass      # marque passe manuelle validée

# Sonde Playwright ciblée — outil de la passe MANUELLE (ajoutée le 09.08.2026).
# Rend la page dans un vrai Chrome et remonte prix + widgets countdown +
# mentions « à vie » + deadlines des scripts inline, ce que WebFetch rate.
node scripts/audit-probe.mjs <url>                    # une URL
node scripts/audit-probe.mjs urls.txt                 # un lot (1 URL par ligne)
node scripts/audit-probe.mjs urls.txt --grep=rabais   # extrait les lignes matchant
PROBE_OUT=out.json node scripts/audit-probe.mjs urls.txt --full   # + innerText complet

# Installation / suppression de la tâche planifiée Windows (PowerShell) :
pwsh -File scripts\install-daily-audit-task.ps1                 # crée / met à jour
pwsh -File scripts\install-daily-audit-task.ps1 -TimeOfDay 08:30
pwsh -File scripts\install-daily-audit-task.ps1 -Uninstall
```

### 5. Fichiers produits par le pipeline

| Fichier | Rôle |
|---|---|
| `scripts/daily-audit-log.md` | Rapport humain rolling (récent en haut, garde les runs précédents) |
| `scripts/daily-audit-state.json` | État machine : dernier run, dernière passe complète, historique 30 derniers runs |
| `scripts/daily-audit-cron.log` | stdout/stderr du run planifié (généré par Task Scheduler) |
| `scripts/lib/audit-lib.mjs` | Helpers partagés (chargement `index.html`, extraction prix, détection mots-clés) |

### 6. Que faire si le script échoue silencieusement

- Vérifier `scripts/daily-audit-cron.log` — si Chrome/Node manque, l'erreur
  y sera loggée.
- Vérifier que la tâche est bien enregistrée :
  `Get-ScheduledTask -TaskName ComparasuisseDailyAudit`
- Forcer un run test :
  `Start-ScheduledTask -TaskName ComparasuisseDailyAudit`
- Un run manuel qui échoue → charger `index.html` a peut-être introduit
  une nouvelle `const NAME = …` référencée dans les data arrays qui n'est
  pas dans `HELPER_CONST_NAMES` de `audit-lib.mjs`. L'ajouter là.

### 7. Garde-fous de robustesse (post-incident 03.08.2026)

Trois protections ont été ajoutées après un premier déploiement pathologique
où plusieurs runs se sont empilés parce que certaines pages « hanguaient »
indéfiniment (Sunrise Swiss Travel+ 82 min, Lebara Relax S 68 min, Wingo
Swiss Max 59 min avant erreur, etc.). Playwright peut caler dans
`page.evaluate` ou `page.close` quand le contexte Chrome sature ou qu'un
SPA garde une boucle JS active.

| Garde-fou | Où | Comportement |
|---|---|---|
| **Hard timeout par page** | `audit-lib.mjs` `checkOffer(hardTimeout=20000)` | `Promise.race` : si la vérif dépasse 20 s, on émet un verdict `TIMEOUT` et on ferme la page en fire-and-forget. Le run continue sans être bloqué. |
| **Navigation timeout court** | `audit-lib.mjs` `setDefaultNavigationTimeout(15000)` | `page.goto` timeout à 15 s au lieu du défaut Playwright 30 s. |
| **Lock file** | `scripts/daily-audit.lock` | Un nouveau run refuse de démarrer si un précédent tourne encore (PID vérifié). Exit code 75 (EX_TEMPFAIL, retry-friendly). Un lock de plus de 90 min est considéré zombie et écrasé. Libéré via `process.on("exit")`. |
| **Historique borné** | `_audit-catalog.mjs` `MAX_RUNS_KEPT_IN_LOG=7` | Le rapport `daily-audit-log.md` ne garde que les 7 derniers blocs `# Daily audit — YYYY-MM-DD` — évite l'accumulation en cas de runs multi-quotidiens ou de tests répétés. |

Si des runs zombies traînent malgré ces garde-fous :

```powershell
# Kill tous les node + wscript + Chrome enfants de node
Get-Process -Name node, wscript -EA SilentlyContinue | Stop-Process -Force
# Puis Chrome enfants de node — voir scripts/cleanup-zombies.ps1 s'il est ajouté
```

Le lock file peut être supprimé à la main si vraiment coincé :
`Remove-Item scripts\daily-audit.lock`.

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

### Étape 2 — Playwright/browser MCP OBLIGATOIRE, WebFetch en pré-scan seulement

Voir [[feedback-webfetch-screenshot-ground-truth]],
[[feedback-no-reports-playwright-inline]] et
[[feedback-playwright-always-for-prices]].

**Règle absolue** : pour toute vérification de prix ou de promo,
**ne jamais se fier à un simple WebFetch** — même si le résumé retourné
paraît complet. Toute promo à durée limitée / countdown / bandeau flash
peut être **chargée en JavaScript uniquement** et donc **invisible pour
un fetch statique**. Cas concret raté malgré l'audit Ex1-Ex5 complet :
Mucho Europe Full affichait « RABAIS -62% DISPONIBLE 1j 11h 44min 26sec »
sur son widget `.timer-container`, invisible via curl/WebFetch → 5 offres
Mucho ont vécu 24h dans nos données sans countdown.

**Protocole obligatoire pour chaque offre auditée** :

1. **WebFetch d'abord** est autorisé uniquement comme pré-scan grossier
   pour identifier les URLs / structures. Ne jamais s'en tenir là pour
   confirmer un prix ou une promo.
2. **Browser MCP systématique** : `mcp__Claude_Browser__navigate` sur la
   page produit, attendre le rendu complet (2-3 s si SPA), puis :
   - `javascript_tool` pour inspecter le DOM finalisé
   - Chercher explicitement : `.timer-container`, `.countdown`,
     `[class*="expirable"]`, `lib-countdown`, `.pack-expirable-offer`,
     et tout texte du style « n jours n h n min n sec » /
     « RABAIS DISPONIBLE » / « À saisir »
   - Extraire toute `new Date("…")` des scripts inline (souvent le format
     `YYYY-MM-DDTHH:MM:SS`)
3. **Screenshot obligatoire** si un doute persiste (widget non extractible
   par le DOM, timing complexe, promo qui semble « à vie » mais avec
   fenêtre de souscription cachée). Un rabais annoncé « permanent » /
   « à vie » sur la page peut malgré tout avoir une deadline pour
   verrouiller ce tarif (modèle Mucho : « rabais à vie une fois souscrit
   avant la deadline, sinon retour au prix catalogue »).
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
Aldi 20.07-15.08, widget `lib-countdown` CHmobile, etc.) doit avoir :

- Une entrée `promoData` dédiée avec `to:"YYYY-MM-DD"` (ou
  `to:"YYYY-MM-DDTHH:MM:SS"` pour deadline à l'heure précise, comme
  Mucho Nano `2026-08-03T11:59:59`)
- L'URL de l'entrée `promoData` doit **matcher exactement** l'URL de
  l'offre mobileData/internetData/tvData/comboData pour que
  `bannerForOffer(item)` la retrouve via `promoByUrl` et injecte le
  bandeau sur la carte d'origine
- Vérifier en browser que le bandeau `⏰ Il te reste HH:MM:SS` s'affiche
  bien et que le compteur défile en temps réel via `tickPromoBanners`

Chercher la vraie heure de fin sur la page officielle :
- Dans un `<script>` en `new Date("YYYY-MM-DDTHH:MM:SS")` (pattern Mucho,
  Sky Mobile)
- Dans un tag `<slt-announcement-bar text="…jusqu'au X">` (pattern GoMo)
- Sur widget Angular custom `<lib-countdown>` : extraire les valeurs
  `[jours, heures, minutes, secondes]` puis calculer `deadline = now + msLeft`
  (pattern CHmobile)
- Sur `.timer-container` / `.pack-expirable-offer` : chercher le composant
  dataflow dans les scripts inline (pattern Mucho)
- Si la deadline exacte n'est pas extractible, utiliser
  `to:"YYYY-MM-DD"` (jour uniquement) qui via `endOfDayLocal` traduit en
  23:59:59.999 — fallback acceptable si drift < 1 jour

**Un rabais annoncé « permanent »/« à vie »/« sans date » peut malgré tout
avoir une fenêtre de souscription limitée** — le prix est verrouillé À
VIE si tu souscris pendant la fenêtre, mais la fenêtre elle-même est
limitée. Ne pas se fier à la formulation marketing seule : chercher le
widget countdown visible avant de conclure « pas de deadline ».

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

## 🎯 AUDIT COUNTDOWN — chantier récurrent séparé

**Déclencheur** : le mot-clé **« AUDIT COUNTDOWN »** dans une future
conversation lance ce chantier de manière autonome (règles identiques à
AUDIT COMPLET : enchaîne sans validation intermédiaire, ne s'arrête que
pour décision éditoriale ambiguë ou contexte épuisé, récap consolidé
final avant « push »).

**Objectif** : détecter les countdowns / fenêtres promo cachées en
JavaScript sur les pages des opérateurs, que le catalogue actuel marque
à tort comme « rabais à vie / permanent ».

**Pourquoi c'est un chantier récurrent** : ces fenêtres promo peuvent
apparaître ou disparaître **sans préavis** (marketing operator décide
d'un flash sale du jour au lendemain). Le catalogue peut donc être
correct un jour et périmé le lendemain. Cas concret :
- Ex1-Ex5 (01.08.2026) a vérifié tous les prix Mucho via
  `.entire`+`.decimal`, sans regarder les countdowns → **5 offres Mucho
  ont vécu 24h dans nos données sans countdown**, alors qu'un widget
  `.timer-container` avec deadline `2026-08-03T11:59:59` était affiché
  sur chaque page produit.
- Même chose pour CHmobile Plus + Europe : widget `lib-countdown`
  Angular affichant `1j 0h 22m 24s` restants sans deadline dans un
  attribut extractable, découvert lors de cette passe AUDIT COUNTDOWN.

**Protocole AUDIT COUNTDOWN** :

1. Grep de toutes les offres actuellement marquées « à vie » /
   « permanent » / sans `promoData` associée :
   ```bash
   awk '/const mobileData/,/^\];/' index.html | grep -E 'à vie' | \
     grep -oE 'name:"[^"]+"|url:"[^"]+"' | paste -d' ' - -
   ```
   Répéter pour internetData / tvData / prepaidData / dataOnlyData /
   comboData.
2. Pour chaque URL identifiée, navigate en browser MCP + screenshot
   plein-écran + inspection DOM. Chercher explicitement :
   - Élément visible avec texte `n jours n h n min n sec` (mucho pattern)
   - Widget `<lib-countdown>` Angular (chmobile pattern)
   - Bandeau `<slt-announcement-bar>` (gomo pattern)
   - Div `.timer-container` / `.plan-countdown` / `.pack-expirable-offer`
   - Texte type « À saisir », « Rabais disponible », « Encore n h »
3. Si widget visible + valeurs qui décrémentent → **vraie promo à
   durée limitée**. Extraire deadline via :
   - `new Date("…")` dans les scripts inline
   - Calcul `now + msLeft` à partir des valeurs affichées (jours,
     heures, minutes, secondes)
   - Data attribute `data-end` / `data-target` sur le widget
4. Si `.plan-countdown` invisible / texte trouvé uniquement dans HTML
   raw sans widget visible → **faux positif** (mention CGV ou
   configuration inactive). Ne pas ajouter de countdown.
5. Créer ou mettre à jour l'entrée `promoData` correspondante avec :
   - `to:"YYYY-MM-DDTHH:MM:SS"` (deadline précise) ou `to:"YYYY-MM-DD"`
     (fallback fin-de-jour si drift < 1 j acceptable)
   - `url` matching **exactement** l'URL de l'entrée mobileData/etc.
   - `warning` sur l'entrée d'origine mentionnant la deadline
6. Vérifier en browser que le bandeau urgent s'affiche et ticke.

**Fréquence recommandée** : mensuelle, ou dès qu'un feedback utilisateur
mentionne un countdown non couvert (comme la remontée du 02.08.2026 sur
Mucho Europe Full).

---

## 🔗 AUDIT LIENS — chantier récurrent séparé

**Déclencheur** : le mot-clé **« AUDIT LIENS »** dans une future
conversation lance ce chantier de manière autonome (règles identiques à
AUDIT COMPLET / AUDIT COUNTDOWN : enchaîne sans validation intermédiaire,
ne s'arrête que pour décision éditoriale ambiguë ou contexte épuisé,
récap consolidé final avant « push »).

**Objectif** : garantir que chaque URL enregistrée dans
`mobileData` / `internetData` / `tvData` / `comboData` / `prepaidData` /
`dataOnlyData` / `promoData` pointe vers **la page produit exacte** de
l'offre concernée, pas vers une page catalogue/liste générale qui
regroupe plusieurs offres différentes. Un lien « Voir l'offre → » du
comparateur doit atterrir directement sur la description/checkout de
l'offre que le visiteur a vue.

**Pourquoi c'est un chantier récurrent** : la structure d'URL d'un
opérateur peut changer sans préavis (Mucho a migré 3 offres vers un
listing commun à un moment, Sunrise lance/retire régulièrement des
pages produit individuelles). Les cas historiques déjà découverts :
- Mucho (Europe Surf / Europe / Europe Full) pointaient tous vers
  `/fr/abos/europe-appel-internet` (liste commune, remontée
  utilisateur 02.08.2026) — corrigé vers
  `www.mucho.ch/fr/abo/mucho{europesurf,europe,europefull}` individuels
- Coop Mobile (Extra S / Extra L / Europe L) pointaient tous vers
  `/fr/abonnement-mobile` (landing) — corrigé vers
  `/fr/abonnement-mobile/{extra-s,extra-l,europe-l}` individuels
- CHmobile Plus / Europe pointaient vers `chmobile.ch/fr/` (landing) —
  corrigé vers `/fr/plus` et `/fr/europe`
- Sunrise Swiss Connect Lite / Swiss Travel+ pointaient vers
  `/fr/mobile` ou `/fr/mobile/abonnement-mobile` (landing) — corrigé
  vers `/fr/mobile/swiss-connect-lite` et `/fr/mobile/swiss-travel-plus`
- iWay Internet (les 4 tiers) pointaient tous vers `/internet/abos/`
  (landing) — corrigé vers `/internet/{20,100,1000,10-gbit-s}/` individuels

**Protocole AUDIT LIENS** :

1. **Inventaire URLs partagées** — grep de toutes les URLs utilisées
   par >1 offre (potentielles listes) :
   ```bash
   grep -oE 'url:"[^"]+"' index.html | sort | uniq -c | sort -rn | \
     awk '$1 > 1' | head -40
   ```
2. **Pour chaque URL partagée** :
   - Si toutes les offres qui pointent dessus sont **le même produit
     rendu dans plusieurs blocs data** (ex. Home Supermax + TV présent
     dans comboData ET promoData avec URL identique → normal, la
     jointure promoByUrl exige ce matching) → laisser tel quel
   - Si les offres sont **distinctes** (ex. Salt Start Max + Salt
     Travel + Salt Europe Max tous vers `/fr/mobile`) → URL suspecte,
     à vérifier
3. **Pour chaque URL suspecte** : tester avec `curl -sL -o /dev/null
   -w "%{http_code}"` les variantes `/{plan-slug}`, `/{plan-slug}.html`,
   `/abo/{plan-slug}`, `/plans/{plan-slug}`, `/produit/{plan-slug}` sur
   le domaine de l'opérateur. Si un 200 est trouvé → URL individuelle
   existe.
4. **Vérifier avec browser MCP** que la page trouvée présente bien
   l'offre spécifique (nom, prix correspondant, pas juste un redirect
   silencieux vers la landing).
5. **Corriger dans les données** : mettre à jour `url:` de l'entrée
   concernée. Si l'entrée a une `promoData` matching via `promoByUrl`,
   corriger AUSSI l'URL de la promoData pour que le countdown reste
   fonctionnel.
6. **Si aucune page dédiée n'existe** pour l'offre précise (certains
   opérateurs comme Talk Talk / Aldi / Quickline / Lycamobile /
   MaxiConnect n'ont qu'une seule landing regroupant tous leurs plans) :
   laisser l'URL landing telle quelle. Ce n'est pas une erreur — c'est
   une contrainte de l'opérateur.

**Cas légitimes de landing partagée** (vérifiés le 02.08.2026,
aucune correction possible) :
- Talk Talk (7 mobile plans → `/fr/`)
- Aldi Mobile (6 plans → `/fr/`)
- MaxiConnect Mobile (5 plans → `/fr/`)
- Quickline (5 plans → `/fr/`)
- Lycamobile (5 plans → `/fr/plans/`)
- Digital Republic Smart Devices (6 tiers SIM Data → `/en/smart-devices/`)
- Digital Republic Mobile (3 plans Flat Mobile Swiss / Flat Mobile /
  Flat Mobile Plus → `/fr/mobile/`, constaté le 09.08.2026) : les pages
  produit individuelles ont été supprimées par l'opérateur (404), les 3
  plans sont désormais fusionnés sur une page unique à ancres
- VTX Mobile (5 plans → `/residential/mobile/abo-mobile`)
- Teleboy Internet/Mobile (multiples → landing par catégorie)
- Wingo mobile individuels : chaque plan a bien son URL propre
- Migros Mobile : URLs vers online-shop.mobile.migros.ch (checkout
  deep-links, techniquement corrects même si moins « descriptifs »)
- Swisscom blue Mobile S/M/L/XL : URLs individuelles OK
- CanalPlus (4 packs → `boutique.suisse.canalplus.com/`) : boutique
  bloque le probe direct (403), landing conservée

**Fréquence recommandée** : trimestrielle, ou dès qu'un feedback
utilisateur mentionne un lien qui aboutit sur une liste au lieu du
produit annoncé.

### Étape complémentaire — Recherche Google élargie (pages orphelines de campagne)

Le scan classique (sitemap + landing publique) rate un cas structurel : les
**pages promo orphelines** — pages produit qui existent chez un opérateur
mais qui ne sont liées depuis AUCUNE autre page de leur site. Elles servent
souvent d'atterrissage pour des campagnes Facebook / newsletter / display
sponso, et sont donc **invisibles au crawl standard** puisqu'aucun lien
interne n'y mène.

**Protocole complémentaire — à appliquer à chaque AUDIT LIENS et AUDIT COMPLET** :

Pour chaque opérateur du catalogue, lancer via `WebSearch` (ou équivalent) :

1. `site:{domaine-operateur}.ch promo` puis `deal` puis `offre limitée`
   puis `rabais` (4 mots-clés, un par requête, à combiner via OR si
   l'outil le permet)
2. `site:{domaine-operateur}.ch "CHF" mois` (capte toute page contenant
   un prix affiché — révèle les pages produit indexées mais orphelines)

Pour chaque URL retournée :
- Comparer avec la liste des URLs déjà présentes dans notre catalogue
  (grep sur `index.html`)
- Toute URL trouvée qui ne correspond à AUCUNE offre existante est un
  **candidat orphelin** — vérifier via browser MCP si c'est :
  - Une vraie offre commercialement active (à ajouter au catalogue)
  - Une page archive/historique (à ignorer)
  - Une variante géo/appareil-ciblée (à documenter)

**Limite honnête à assumer** : même avec cette recherche élargie, il
reste un risque résiduel de pages promo :

- **Ultra-récentes** (< 24-48h) — Google n'a pas encore indexé
- **Géo-ciblées** — visibles uniquement pour visiteurs d'une région ou
  d'un canton spécifique
- **Appareil-ciblées** — pages servies uniquement en mobile, ou avec
  un User-Agent spécifique
- **Facebook-exclusives** — landing pages liées uniquement depuis un
  Ads Manager, jamais indexées publiquement
- **Newsletter-only** — deep links envoyés par email à des segments
  clients existants

Ces cas échappent structurellement à toute méthode de scan automatique.
Ce n'est pas un échec de la méthodologie, c'est **une vraie limite du
web publicitaire moderne**. Les signalements utilisateur sur des pubs
vues (comme la remontée du 02.08.2026 sur yallo Home Cable M + TV depuis
Preispirat) restent **complémentaires et utiles** pour ces cas — nous
documentons systématiquement chaque page ajoutée via ce canal comme
« découvert via signal externe » dans le commit message.

**Fréquence recommandée pour la recherche Google** : mensuelle sur les
opérateurs actifs en promo (Wingo, Mucho, CHmobile, Coop, Aldi, Lidl,
GoMo, yallo, Talk Talk), trimestrielle sur les opérateurs stables
(Swisscom, Sunrise abo standard, Salt catalogue standard).

---

## 🔗 Références mémoire

Toutes les règles ci-dessus renvoient aux mémoires suivantes :

- [[feedback-audit-sitemap-landing-check]] — sitemap ≠ catalogue actif
- [[feedback-no-reports-playwright-inline]] — zéro report Playwright inline
- [[feedback-webfetch-screenshot-ground-truth]] — WebFetch summary ≠ DOM
- [[feedback-playwright-always-for-prices]] — Playwright/browser MCP
  obligatoire pour toute vérif prix/promo, jamais WebFetch seul
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
