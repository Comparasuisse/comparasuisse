# Whitelist NON_VÉRIFIABLE — journal d'investigation

Une offre whitelistée n'est lue par personne : le scan quotidien
court-circuite Playwright avant même de charger la page. Ce fichier existe
pour que chaque entrée restante soit justifiée par une investigation écrite,
et pour qu'on ne re-tente pas indéfiniment les mêmes pistes mortes.

**Règle** : une entrée ne reste ici que si la page ne peut **structurellement
pas** livrer son prix. « Difficile » n'est pas une raison suffisante.

Historique de la liste : 78 offres (17.08) → 74 → **32** (18.08, après
challenge à l'extracteur) → **23** (18.08, après investigation manuelle).

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

## RESTANT À INVESTIGUER — 23 offres sur 8 URLs

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
