# Téléphonie fixe — règle de classification dans la structure de données

**Créé le 14.08.2026**, à l'occasion de l'intégration de K-Sys (Genève).

Ce fichier fixe **où** placer un opérateur qui vend de la téléphonie fixe.
Il n'existe pas de réponse unique : la bonne case dépend de la **vraie
structure commerciale** de l'opérateur, qui doit être vérifiée **cas par
cas** avant tout ajout. Ne jamais recopier le classement d'un opérateur
voisin par analogie.

---

## 🚦 L'arbre de décision

Trois structures commerciales possibles, trois destinations différentes :

| # | Structure commerciale réelle | Destination | Champ clé |
|---|---|---|---|
| **1** | La téléphonie fixe est **souscriptible seule**, sans internet du même opérateur, avec son propre prix mensuel | **Nouvelle catégorie / entrée dédiée** (`fixedLineData`, onglet propre) | à créer le jour où le cas se présente |
| **2** | La téléphonie fixe est **inséparable** de l'internet : incluse d'office, sans prix propre, impossible à commander seule | `internetData` | `fixedLineIncluded: true` |
| **3** | Il existe un **forfait multi-services figé** (Internet + TV + Téléphonie) vendu à **un seul prix**, dont les composants ne sont pas détachables | `comboData` (dont le sens s'élargit de « Internet + TV » à « bundles multi-services ») | entrée `comboData` normale |

**Le cas 3 exige en plus** de passer le test de remise combo de
`CHECKLIST-OFFRE.md` § « Offres combo » : si le prix du pack est la simple
**addition** des composants standalone, on n'ajoute rien dans `comboData` —
le visiteur compose déjà lui-même depuis les onglets Internet et TV.

---

## 🔍 Comment trancher : le formulaire de commande fait foi

La page marketing (« Téléphonie ») décrit un **service**. Elle ne dit
presque jamais s'il est **vendable seul**. La seule source qui tranche
est **l'acte de vente réel** :

1. **Formulaire d'abonnement / tunnel de commande** — source la plus
   contraignante. Regarder si le champ « choix de l'offre internet » est
   **obligatoire** (`*`) et ce que contient sa liste déroulante. Si elle ne
   contient que des paliers internet → rien ne se vend sans internet → cas 2.
2. **Grille tarifaire** — la téléphonie a-t-elle une **ligne de prix propre** ?
   « inclus » / « option gratuite » ⇒ cas 2. « CHF X.–/mois » sur une ligne
   autonome ⇒ candidat cas 1, à confirmer au point 1.
3. **CGV / factsheet PDF** — mentionnent parfois explicitement un abonnement
   téléphonie autonome (raccordement, portabilité seule).

⚠️ **Piège** : « incluse dans tous nos abonnements » ne prouve PAS
l'impossibilité de la souscrire seule — ça prouve seulement qu'elle est
incluse. Il faut aller voir le formulaire.

⚠️ **Piège inverse** : un opérateur qui affiche un prix téléphonie ne vend
pas forcément un abonnement autonome — ce peut être le prix d'une **option
d'appels** (illimité vers les mobiles, vers l'international) qui suppose
déjà l'abonnement internet.

---

## 🧩 Le champ `fixedLineIncluded` (cas 2)

Booléen **3 états**, soumis à la règle générale de `CHECKLIST-OFFRE.md`
(« `null` par défaut, jamais de déduction marketing ») :

```js
{
  // …
  fixedLineIncluded: true,                                       // true | false | null
  fixedLineNote: "Incluse (illim. fixes CH + 50 destinations)",  // optionnel, affiné
}
```

- `true` → cellule « Téléphonie fixe » affichée sur la carte, avec le texte
  de `fixedLineNote` si fourni, sinon « Incluse dans l'abonnement ».
- `false` → « Non incluse ». À réserver aux cas où l'opérateur **dit
  explicitement** que sa fibre n'embarque pas de ligne fixe.
- `null` / champ absent → **rien affiché**. C'est l'état par défaut de
  toutes les offres pré-existantes : leur absence de cellule ne signifie
  pas « pas de téléphonie », mais « pas encore vérifié ».

Rendu : `renderInternetCard()` dans `index.html`.

**Ce que `fixedLineIncluded` ne doit PAS servir à décrire** : une option
téléphonie payante ajoutable à l'abo (appels illimités vers les mobiles,
forfait international). Ça reste du texte dans `details` — le champ est
réservé au service **inclus et inséparable**.

---

## ✅ Cas tranchés

### K-Sys (14.08.2026) → **cas 2**

Opérateur fibre de proximité, **canton de Genève uniquement**, sur le
réseau FTTH des Services Industriels Genevois (convention SIG citée sur
`eligibilite-k-sys.html`). 4 paliers : Allegro 50 Mbit/s, Vivace
100 Mbit/s, Presto 200 Mbit/s, Prestissimo 1 Gbit/s.

Vérifié le 14.08.2026 sur `les-offres-k-sys.html`, `telephonie.html`,
`television.html` et surtout `formulaire-abonnement.html` (browser MCP,
texte + capture) :

| Question posée | Réponse trouvée | Preuve |
|---|---|---|
| Téléphonie fixe souscriptible **seule** ? | **Non** | Le formulaire d'abonnement a un champ obligatoire « Choix de l'offre * » dont la liste ne contient que Allegro / Vivace / Presto / Prestissimo. Aucun parcours ne permet de commander sans palier internet. |
| Téléphonie **inséparable** de l'internet ? | **Oui** | Tableau d'offres : « Téléphonie vers les fixes : **inclus** » dans les 4 colonnes. Page téléphonie : « Réseaux fixes illimités vers + de 50 destinations — **Incluse dans tous nos abonnements** ». Formulaire : « Téléphonie illimitée 50 pays (**option gratuite**) * ». Aucun prix mensuel propre nulle part. |
| Vrai **triple-play figé** ? | **Non** | La TV est du matériel optionnel : « Box TV HD * » propose Location 5.-/mois **OU** caution 150.- **OU** « Non, je ne souhaite pas d'équipement TV ». Le prix final est toujours `palier internet (+ 5.- si box TV)` — addition pure, décomposable, et donc **aucune remise combo** → pas d'entrée `comboData`. |

**Conséquence appliquée** : 4 entrées dans `internetData` avec
`fixedLineIncluded: true`, `network:"regional"`, `connectionType:["fibre"]`,
et un `warning` partagé (`KSYS_GENEVA_TITLE` / `KSYS_GENEVA_WARNING`) qui
signale la limitation géographique — sans quoi un prix de 45.-/mois pour
1 Gbit/s symétrique paraîtrait accessible à toute la Suisse.

**Pas d'entrée TV** dans `tvData` non plus : K-Sys ne publie pas la grille
des « + de 60 chaînes » de façon extractible, et le bouquet n'a pas de prix
d'abonnement propre (seul le boîtier est facturé). Ajouter une offre TV
sans prix ni `channelsList` violerait deux règles de `CHECKLIST-OFFRE.md`.

**Incohérences relevées sur k-sys.ch** (à revérifier au prochain audit) :

- **Option appels vers les mobiles CH** : le tableau d'offres affiche
  **CHF 18.-/mois**, la page `telephonie.html` et le formulaire
  d'abonnement affichent **CHF 32.-/mois**. Le formulaire faisant foi
  (c'est lui qui engage), la valeur retenue en cas de besoin est 32.-.
  Aucune de nos entrées ne dépend de ce chiffre.
- **Symétrie de l'Allegro** : le tableau annonce « débit upload/download
  symétrique » pour les 4 paliers, mais `internet.html` précise « Même
  vitesse Upload & Download (**Sauf offre Allegro**) ». Contradiction
  documentée dans le `details` de l'entrée Allegro plutôt que tranchée
  arbitrairement.
- **Fraîcheur du site** : mentions « © 2020 » et une note de bas de page
  datée du 31/10/2020. La promo 12 mois, elle, ne porte aucune date de
  fin — seule la note ¹ « Au bout de 12 mois le tarif sera le tarif hors
  promotion » s'applique. Prix relevés tels qu'affichés le 14.08.2026.

### iWay → **ni 1 ni 3** (déjà tranché le 27.07.2026)

Documenté dans `CHECKLIST-OFFRE.md` : « does not offer fixed combo
packages, but you can combine all their telephony packages with their
internet packages as desired ». Téléphonie **à la carte** avec ses propres
tarifs, mais toujours adossée à l'internet iWay → ni entrée dédiée, ni
combo. Si une vérif ultérieure montre qu'un forfait téléphonie iWay est
commandable seul, ce serait le **premier cas 1** du catalogue et il
faudrait alors créer la catégorie.

### Salt Home → **cas 3 déjà en place**

`comboData` contient « Salt Home (Internet + TV + Fixe) » à 49.95 : un
prix unique pour les trois services, avec une vraie remise conditionnée à
un mobile Salt. C'est le précédent qui valide l'élargissement de
`comboData` aux bundles multi-services au-delà d'Internet + TV.

---

## 📝 Procédure pour le prochain opérateur « téléphonie fixe »

1. Ouvrir la page téléphonie **et** le formulaire/tunnel de commande
   (browser MCP, pas WebFetch seul — cf. règle absolue #1.5).
2. Répondre aux 3 questions de l'arbre ci-dessus, **avec la citation
   exacte** qui prouve chaque réponse.
3. Classer : cas 1 → nouvelle catégorie · cas 2 → `fixedLineIncluded` ·
   cas 3 → `comboData` **après** le test de remise combo.
4. Vérifier la couverture géographique (point 8 des 8 points) et ajouter
   un `warning` si l'offre est régionale.
5. Consigner le verdict dans la section « Cas tranchés » de ce fichier —
   un opérateur classé sans trace ici sera re-débattu à chaque audit.
