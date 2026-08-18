# Whitelist NON_VÉRIFIABLE — journal d'investigation

Une offre whitelistée n'est lue par personne : le scan quotidien
court-circuite Playwright avant même de charger la page. Ce fichier existe
pour que chaque entrée restante soit justifiée par une investigation écrite,
et pour qu'on ne re-tente pas indéfiniment les mêmes pistes mortes.

**Règle** : une entrée ne reste ici que si la page ne peut **structurellement
pas** livrer son prix. « Difficile » n'est pas une raison suffisante.

Historique de la liste : 78 offres (17.08) → 74 → **32** (18.08, après
challenge à l'extracteur) → **23** (18.08, après investigation manuelle) →
**19** (session 2) → **1** (session 3).

Ce journal se lit dans l'ordre : chaque session part de ce que la précédente
avait laissé, y compris de ses conclusions erronées — elles sont conservées
telles quelles, c'est le seul moyen de voir combien de fois un motif écrit une
fois a survécu sans être rejugé.

---

## Méthode appliquée à chaque URL

1. Navigateur réel, pas seulement Playwright headless.
2. Recherche du `sitemap.xml` / `robots.txt` pour débusquer des pages produit
   individuelles jamais découvertes.
3. Exploration des liens de la page elle-même (menus, ancres, « Voir les
   abonnements », « Tarifs »).
4. Clics sur tout ce qui peut révéler du contenu masqué : « Afficher tous les
   produits », onglets « Avec/Sans », sélecteurs de durée.
5. Inspection DOM structurelle : le prix est-il dans un conteneur nommé, même
   s'il est invisible à une lecture à plat ?
6. Défilement par paliers pour déclencher le lazy-load.

---

## RÉSOLUES — sorties de la whitelist

### MaxiConnect `/fr/mobile` (5 offres) et `/fr/maxidata` (4 offres)

**Motif d'origine** : « landing multi-plans, 8 montants pour 5 plans,
attribution 1-vs-1 impossible ».

**Ce qui a été tenté** : sitemap (`sitemap-index.xml` → `sitemap-0.xml`)
passé en revue — il confirme qu'aucune page produit individuelle n'existe,
seulement `/fr/mobile/`, `/fr/maxidata/`, `/fr/tarifs-mobile/` et des pages
wiki. Puis inspection DOM de la landing.

**Résultat : RÉSOLU.** Le motif d'origine était faux. Chaque plan vit dans un
conteneur `.plan-card` portant un `.plan-name`, et son prix est dans ce même
conteneur. L'attribution est triviale par sélecteur — c'est seulement
l'extraction à plat du texte qui ne pouvait pas la faire.

Relevé du 18.08.2026, nom par nom :

| Plan | Prix lu | Notre valeur |
|---|---|---|
| MaxiMobile Small | 9.90 | 9.90 ✅ |
| MaxiMobile Start | 21.90 | 21.90 ✅ |
| MaxiMobile Classic | 29.90 | 29.90 ✅ |
| MaxiMobile Plus | 44.90 | 44.90 ✅ |
| MaxiMobile Ultra | 59.90 | 59.90 ✅ |
| MaxiData Small | 5.00 | 5.00 ✅ |
| MaxiData Classic | 9.90 | 9.90 ✅ |
| MaxiData Plus | 19.90 | 19.90 ✅ |
| MaxiData Ultra | 29.90 | 29.90 ✅ |

Les neuf prix figurent en clair dans le texte de la page : le scan les
retrouvera. Sorties de la whitelist.

---

## Session 1 — 18.08.2026 — état à l'ouverture (23 offres sur 8 URLs)

### Quickline `/mobile` (4 offres) — investigation faite, NON résolue

**Ce qui a été tenté le 18.08.2026** :
- `robots.txt` → `sitemap_index.xml` dépouillé : **aucune page par abo**,
  et **aucune version française** (`/fr/mobile`, `/fr/mobile-abos`,
  `/fr/abonnements-mobiles` renvoient tous 404). Le site est germanophone,
  notre URL sert donc de l'allemand.
- Lien `/mobile/preise` découvert dans la page et exploré : c'est une grille
  de tarifs **à la minute** (appels, roaming), pas les prix mensuels.
- Ancre `#mobile-abos` suivie, défilement par paliers pour déclencher le
  lazy-load.

**État** : la page est une vitrine pour **Mobile L à CHF 9.–**. Les quatre
noms d'abos y apparaissent, mais seuls deux montants sont rendus — 9.– pour
Mobile L et 34.50 pour Mobile XL. Les prix de Mobile M (12.–) et Mobile S
(14.–) ne sont nulle part dans le texte rendu.

**Piste non encore explorée** : le tunnel de commande (« Abo auswählen »),
qui est peut-être le seul endroit où les quatre tarifs coexistent.

### Non encore investiguées

| URL | Offres |
|---|---|
| `teleking.ch/tv/angebote/` | 4 (KingTV Silber/Gold/Platin + promo) |
| `talktalk.ch/fr/mobile-prepaye/prepaid.html` | 4 (Prepaid GO + Season 1/3/6) |
| `abos.galaxus.ch/fr/mobile` | 3 |
| `abos.galaxus.ch/fr/internet` | 3 |
| `iway.ch/tv/` | 3 |
| `netplus.ch/fr/television/la-box-tv-3921` | 1 |
| `sunrise.ch/fr/internet-tv/abonnement-combine` | 1 |

Pour Galaxus, la piste connue est que les prix sont dessinés en glyphes
vectoriels — à re-challenger tout de même, notamment via le tunnel de
commande. Pour Sunrise, le prix EST accessible mais derrière un basculeur
« Avec TV » (documenté le 18.08) : reste à savoir si un robot sans clic peut
l'atteindre.

---

## Session 2 — 18.08.2026

### TeleKing `/tv/angebote/` (3 offres) — RÉSOLU

**Motif d'origine** : « prix rendus dans badges/images/SVG non captés par
innerText ». Faux, mais pour une raison plus intéressante.

**Ce qui a été tenté** : chargement dans le navigateur réel de l'utilisateur
(profil existant) → les trois prix s'affichent en clair, « CHF 14.-/
monatlich » après Silber, 19 après Gold, 23 après Platin. Puis reproduction
en Playwright, headless ET headed : les deux restent bloqués à 807
caractères sur le bandeau cookies. Ce n'est donc pas une question de mode
d'exécution mais d'**état de consentement** — le profil réel avait déjà
accepté, pas le contexte neuf.

Masquage de l'overlay sans l'accepter (règle privacy) : `innerText` tombe à
647 caractères et ne rend toujours rien, **mais le HTML servi contient
14.00, 19.00 et 23.00**. La page livre bien ses prix ; c'est `innerText` qui
ne les restitue pas.

**Résultat : RÉSOLU par amélioration de l'outil, pas par exception.**
`checkOffer` se replie désormais sur le HTML rendu quand `innerText` ne
donne pas le prix attendu. Vérifié : les trois KingTV remontent `OK
(html-rendu)`, et les cas normaux (Wingo Swiss Mini, Sunrise Easy Internet,
Wingo TV Max) restent `OK` par la voie normale, sans surcoût.

Ce repli profite à tout le catalogue, pas seulement à cette entrée.

### Mesure du repli HTML sur les 8 URLs restantes

| URL | innerText | HTML rendu |
|---|---|---|
| quickline.ch/mobile | 3/4 | 3/4 |
| abos.galaxus.ch/fr/mobile | 0/3 | 0/3 |
| abos.galaxus.ch/fr/internet | 1/3 | 1/3 |
| netplus.ch/…/la-box-tv-3921 | 0/1 | 0/1 |
| iway.ch/tv/ | 2/3 | 2/3 |
| **teleking.ch/tv/angebote/** | **0/3** | **3/3** ← résolu |
| sunrise.ch/…/abonnement-combine | 0/1 | 0/1 |
| talktalk.ch/…/prepaid.html | 0/4 | 0/4 |

Le HTML rendu ne débloque que TeleKing. Pour les autres, le montant n'est
réellement pas dans la page servie : le chercher autrement ne suffira pas,
il faudra une interaction (clic, tunnel de commande) ou un rendu graphique.

---

## Session 3 — 18.08.2026 — les 7 URLs restantes

Bilan : **six URLs sur sept sont résolues**, aucune par exception. Chaque fois,
la page livrait son prix ; c'est l'outil qui ne savait pas le lire. La whitelist
tombe de 19 offres à 1.

Le fil conducteur mérite d'être noté, parce qu'il se répète : sur les six cas,
**aucun** ne correspondait au motif écrit dans la whitelist. « Prix en glyphes
vectoriels », « attribution 1-vs-1 impossible », « placeholders U+200C » — trois
diagnostics posés une fois, jamais rejugés, et faux au moment où on les relit.

### Talk Talk prépayé `/fr/mobile-prepaye/prepaid.html` (4 offres) — RÉSOLU

**Motif d'origine** : landing groupée, pas d'attribution 1-vs-1.

**Ce qu'on trouve** : les quatre montants sont dans le `innerText`, en clair,
chacun sous sa formule — 19.95 (Prepaid GO), 44.95 (Season 1), 79.95 (Season 3),
149.95 (Season 6). Tous conformes à nos valeurs.

Pourquoi l'extracteur les ratait : le montant est nu. Pas de « CHF », pas de
« /mois », et le seul mot de tarif de la page (« Détails du tarif ») arrive
APRÈS le nombre, hors de la fenêtre de `PRICE_LABEL_RE` qui ne regarde qu'en
avant. La seule chose qui désigne ce nombre comme un prix, c'est le bouton
« AJOUTER AU PANIER » juste en dessous.

**Correctif** : un montant à décimales posé juste avant un appel à l'action est
un prix. On lit désormais la fenêtre qui PRÉCÈDE le bouton d'achat, en ne
retenant que le dernier montant — celui qui touche le bouton. Les entiers nus
(quantités, numéros d'étape) restent hors de portée, `BARE_AMOUNT_RE` exigeant
deux décimales.

### iWay `/tv/` (3 offres) — RÉSOLU

**Motif d'origine** : « prix rendus dans badges/images/SVG ».

**Ce qu'on trouve** : les trois prix sont en texte. TV Classic et TV Premium
étaient d'ailleurs déjà lus (15.–, 20.–) ; seul TV Top 2.0 manquait. La page
écrit « CHF / Mt. 25.50 » : la devise et le montant sont séparés par la
périodicité, et ce montant-là, contrairement aux deux autres, n'a pas de tiret
final pour le trahir.

**Correctif** : normalisation de la périodicité intercalée entre devise et
montant. 15 / 20 / 25.50, conformes.

### Quickline `/mobile` (4 offres) — RÉSOLU

**Motif d'origine** : « landing multi-plans, attribution 1-vs-1 impossible » ;
la session 1 avait conclu que deux prix sur quatre n'étaient « nulle part dans
le texte rendu » et laissait comme piste le tunnel de commande.

**Ce qu'on trouve** : les quatre prix sont dans le texte, chacun sous son abo —
Mobile S 14.–/Mt., Mobile M 24.– 12.–/Mt., Mobile L 29.– 9.–/Mt., Mobile XL
69.– 34.50/Mt. (les trois derniers sont des promos 24 mois, ce que nous
stockons déjà). Trois d'entre eux étaient lus ; seul « 34.50/Mt. » échappait.

Pourquoi : on ne savait lire le mois qu'en français (« /mois », « /m. »). Un bon
tiers du catalogue pointe pourtant sur des pages germanophones, où le mois
s'abrège « /Mt. ». Le tunnel de commande n'a pas été nécessaire.

**Correctif** : `PRICE_RE` reconnaît « /Mt. », « /Mte. », « /Monat ».

### Galaxus `/fr/mobile` et `/fr/internet` (6 offres) — RÉSOLU

**Motif d'origine** : « prix dessinés en typographie décorative (glyphes
vectoriels) ; aucune lecture du DOM ne peut les rendre, seul un screenshot les
donne ».

Le motif décrivait bien le dessin — mais pas la page. Les montants sont des
**animations Lottie** (After Effects exporté en JSON, rendu en tracés). Le
dessin ne contient effectivement aucun texte. Sauf que l'animation dit son
nombre deux fois, ailleurs que dans son dessin :

| Où | Galaxus Mobile Basic |
|---|---|
| id du conteneur DOM | `lottie-karotti-12-image` |
| fichier téléchargé | `/assets/img/lottie/mobile/data-12.json` |
| nom interne du JSON | `Zahl_12` |

Relevé complet du 18.08.2026 : mobile 12 / 19 / 29, internet 27 / 34 / 39 — les
six conformes à nos valeurs, les mêmes qu'au screenshot du 12.08.

**Correctif** : `readLottieNumbers` croise les nombres lus dans le DOM avec ceux
des ressources Lottie réellement téléchargées, et ne retient que
l'intersection. La double confirmation est ce qui rend la lecture sûre : un id
parlant seul pourrait survivre à un changement de prix, une ressource seule
pourrait appartenir à une autre section ; les deux ensemble signifient que la
page a chargé, pour cette carte, l'animation de ce nombre-là.

**Pistes écartées au passage** : la fiche tarifaire PDF liée en pied de page
(`GalaxusMobile+Internet+TV_Tarifs_FR.pdf`) ne contient que les tarifs hors
forfait (minutes, roaming, options), aucun prix d'abonnement. Le tunnel
(`cockpit.galaxus.ch/b2c/home?product=4001`) redirige vers une authentification :
hors de portée, et hors de ce qu'on s'autorise.

### Sunrise `/fr/internet-tv/abonnement-combine` (1 offre) — RÉSOLU

**Motif d'origine** : « cards rendues avec des placeholders U+200C à la place
des libellés et des prix » (09.08.2026).

**Ce qu'on trouve** : plus de placeholders, la page rend son texte. Les trois
packs s'affichent d'abord **Sans TV** — 69.80 / 75.60 / 80.60. Un onglet
« Avec TV » les fait passer à 79.80 / **85.60** / 90.60. Notre offre est la
variante avec TV du pack Neighbors : 85.60, conforme.

**Correctif** : une **recette de pré-clic** plutôt qu'une whitelist. Le scan
bascule l'onglet, comme un visiteur, puis lit. Trois règles gardent le procédé
honnête : le geste doit être celui d'un visiteur ordinaire (jamais franchir un
paiement ou une authentification) ; le clic doit révéler le prix, pas le
négocier (pas de code promo, pas de durée d'engagement modifiée) ; l'échec du
clic n'est pas fatal — on lit la page telle quelle et l'offre ressort en ÉCART,
ce qui est le bon signal si la page a changé.

### Netplus `La Box TV` (1 offre) — NON RÉSOLU, et c'est structurel

La seule des sept où la page ne ment pas sur elle-même : `la-box-tv-3921` est
une page produit marketing qui ne porte **aucun montant**. Vérifié le
18.08.2026 : ni dans le texte (2892 caractères), ni dans le HTML servi — la
chaîne « 18.- » n'y figure nulle part. La landing `/fr/television/` (qui
redirige vers `/fr/tv-514`) n'en porte pas davantage.

Ce n'est pas un défaut de lecture : la page sœur `application-tv-mobile-547`,
elle, affiche son prix dans un tableau (« Abonnement mensuel (sans box TV) —
10.-/mois ») et se vérifie sans problème. net+ a simplement tarifé l'une et pas
l'autre.

Le prix existe, mais ailleurs : le configurateur `/fr/offres-combo/` énonce
« Box & Application TV — CHF 18.- » (relevé le 18.08.2026, conforme). C'est
d'ailleurs déjà l'URL des trois offres Internet net+, qui s'y vérifient
normalement.

**Décision** : l'entrée reste whitelistée, et l'URL visiteur reste la page
produit. La repointer vers le configurateur ferait gagner une vérification
automatique en dégradant la destination du visiteur — un mauvais échange. Si la
situation se reproduit sur d'autres offres, la bonne réponse sera un champ
distinct (URL visiteur ≠ URL de vérification), pas un compromis sur l'une des
deux.

### Ce que ça change dans l'outil

Cinq modifications dans `scripts/lib/audit-lib.mjs` :

1. `PRICE_RE` — abréviations mensuelles alémaniques `/Mt.` `/Mte.` `/Monat`.
2. `normalizePriceFragments` — périodicité intercalée entre devise et montant.
3. `extractPrices` — montant nu adossé à un bouton d'achat, lu en arrière.
4. `readLottieNumbers` — nombres dessinés en animation, à double confirmation.
5. `PRE_CLICK_RECIPES` — le scan peut désormais faire UN geste avant de lire.

Les trois premières profitent à tout le catalogue, pas seulement aux six URLs,
et ça se mesure : contrôle de non-régression sur 90 pages du catalogue, passées
à l'ancien et au nouvel extracteur avec le même texte rendu.

- **2 extractions modifiées sur 90**, jamais par retrait : **aucun prix perdu**.
- **1 offre bascule d'ÉCART en OK** sans qu'on l'ait cherchée — spusu legendär
  XL, dont le 19.90 s'écrit « /Mt. ». Les six abos spusu se vérifient
  désormais tous.
- Le second cas (MaxiData Small) gagne trois montants réellement présents sur
  la page ; son verdict, déjà OK, ne change pas.

C'est le sens de corriger l'outil plutôt que d'inscrire une exception : le
bénéfice déborde du cas qui l'a motivé.

---

## RESTANT — 1 offre sur 1 URL

| URL | Offres | Pourquoi c'est structurel | Prix connu |
|---|---|---|---|
| `netplus.ch/…/la-box-tv-3921` | 1 | page produit marketing sans aucun montant, ni en texte ni dans le HTML servi (vérifié 18.08.2026) | 18.- énoncé dans le configurateur `/fr/offres-combo/` |

Historique de la liste : 78 offres (17.08) → 74 → 32 → 23 → 19 (18.08) → **1**.
