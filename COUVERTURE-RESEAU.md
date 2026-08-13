# Couverture réseau — reconnaissance de la source officielle

État au 13.08.2026. Document de travail du chantier « Couverture réseau » :
le visiteur entre une adresse et voit ce qui est techniquement disponible chez
lui, en fixe et en mobile.

Tous les faits ci-dessous ont été établis **en interrogeant les API**, pas en
lisant leur documentation. La distinction n'est pas rhétorique : la doc laisse
croire que l'atlas n'est disponible qu'en téléchargement statique, et c'est
faux — mais il a fallu essayer trois endpoints pour s'en apercevoir.

---

## 1. La source

L'**Atlas de la large bande** de l'OFCOM, publié sur `opendata.swiss` et servi
par l'infrastructure fédérale de géodonnées (IFDG) sur `geo.admin.ch`.

| Ce qu'il couvre | Grille | Ce que vaut une valeur |
|---|---|---|
| Type de raccordement (fibre, coax, cuivre) | 250 m | % de bâtiments desservis dans la cellule |
| Débits descendants (10 → 1000 Mbit/s) | 250 m | % de bâtiments desservis dans la cellule |
| Débits montants (1 → 1000 Mbit/s) | 250 m | % de bâtiments desservis dans la cellule |
| Générations mobiles (3G, 4G, 5G) | 100 m | nombre d'opérateurs couvrant la cellule |
| Fournisseurs fixes actifs | 250 m | liste nominative des entreprises |

Données au **30.04.2026**, mise à jour annuelle. Comme on interroge en direct,
le rafraîchissement est automatique : rien à réimporter.

## 2. Licence — le point le plus favorable du chantier

Les jeux OFCOM portent `terms_open` sur opendata.swiss, la plus permissive des
quatre catégories. Texte exact du portail :

> Vous **pouvez** utiliser ce jeu de données à des fins commerciales. Nous vous
> **recommandons** d'indiquer la source (auteur, titre et lien vers le jeu de
> données).

Usage commercial explicitement autorisé, attribution recommandée et non
obligatoire. On l'indique quand même — c'est la moindre des choses, et ça dit
au visiteur d'où sort le chiffre. Les géoservices sont « free-of-charge » et ne
demandent ni inscription ni clé d'API.

## 3. Trois endpoints, et un seul qui marche pour l'atlas

C'est le cœur de la reconnaissance. Les trois ont été essayés sur des adresses
réelles ; deux échouent sur les couches de l'atlas, un passe.

**`identify` (REST) — échoue sur l'atlas.** L'endpoint recommandé par la
documentation, `api3.geo.admin.ch/rest/services/all/MapServer/identify`, répond
sur les couches vectorielles mais pas sur celles de l'atlas :

```
{"detail":"No GeoTable was found for ch.bakom.anschlussart-glasfaser",
 "status":"error","code":400}
```

Les couches de l'atlas sont des rasters : pas de table vectorielle, donc rien à
identifier. C'est ce message qui fait conclure — à tort — qu'il faut
télécharger les données brutes et les héberger.

**`GetFeatureInfo` (WMS) — passe sur toutes.** `wms.geo.admin.ch` répond sur
chacune des seize couches. Et surtout, en `INFO_FORMAT=text/plain`, il accepte
**plusieurs couches dans une seule requête** :

```
GetFeatureInfo results:
Layer 'ch.bakom.anschlussart-glasfaser'
  ch.bakom.anschlussart-glasfaser.value_0.name = '4'
Layer 'ch.bakom.mobilnetz-5g'
  ch.bakom.mobilnetz-5g.value_0.name = '3'
```

⚠️ **En `application/json` la même requête multi-couches échoue** avec
`msOGRWriteFromQuery(): OGR_DS_CreateLayer failed`. Le JSON ne marche qu'en
mono-couche. C'est contre-intuitif — on essaie le JSON en premier — et c'est ce
détail qui décide de toute l'architecture : seize requêtes ou une seule.

**`identify` pour les fournisseurs — passe.** `ch.bakom.anbieter-eigenes_festnetz`
est la seule couche vectorielle de l'atlas, et elle rend la liste nominative
avec les URL de vérification de chaque opérateur.

## 4. La contrainte qui commande l'architecture : le fair use

Table publiée par swisstopo, rendue côté client sur la page des conditions
générales de l'IFDG — invisible à une simple lecture du HTML :

| Service | Par minute | Par an |
|---|---|---|
| API REST `*.geo.admin.ch` | **40 requêtes** | 21 millions |
| WMS `wms.geo.admin.ch` | **20 requêtes** | 10,5 millions |

Vingt requêtes WMS par minute, c'est peu. Trois conséquences, toutes appliquées
dans l'implémentation :

1. **Les appels partent du navigateur du visiteur, jamais d'un backend.** Un
   proxy centralisé plafonnerait tout le site à ~20 consultations par minute.
   En client, chaque visiteur consomme son propre quota. C'est aussi ce qui
   convient à un site statique sur Netlify : il n'y a pas de backend.
2. **Le multi-couches n'est pas une optimisation, c'est la condition.** Seize
   requêtes par adresse épuiseraient le quota d'un visiteur en une consultation.
   Une requête, 1,5 ko, 380 à 860 ms.
3. **Cache et temporisation.** Le géocodage se déclenche après une pause de
   frappe ; la requête de couverture ne part qu'à la sélection d'une adresse,
   jamais à chaque touche.

Les conditions invitent à écrire à `info@geo.admin.ch` avant de dépasser. À
faire si le trafic monte.

## 5. Décodage des valeurs

Les couches renvoient des entiers nus. Les légendes officielles les traduisent.

**Fixe (250 m)** — part des bâtiments desservis dans la cellule :

| Valeur | Signification |
|---|---|
| 1 | > 0 – 10 % |
| 2 | > 10 – 50 % |
| 3 | > 50 – 90 % |
| 4 | > 90 – 100 % |

**Mobile (100 m)** — nombre d'opérateurs couvrant la cellule en extérieur :

| Valeur | Signification |
|---|---|
| 2 | couvert par moins de 3 fournisseurs |
| 3 | couvert par les 3 fournisseurs |

Une valeur absente signifie **pas de donnée pour cette cellule**, ce qui n'est
pas la même chose qu'une couverture nulle : en zone alpine, toutes les couches
fixes sont muettes faute de bâtiments.

## 6. La TV n'est pas couverte — et le nom qui trompe

Il existe une couche `ch.bakom.versorgungsgebiet-tv`, et son nom laisse espérer
la réponse. Interrogée au Bundesplatz à Berne, elle renvoie :

```
{"prog":"TeleBärn","label":"TeleBärn"}
```

Ce sont les **zones de concession des diffuseurs régionaux au sens de la LRTV** —
quelle chaîne locale est diffusée où. Rien à voir avec « puis-je souscrire
blue TV, Sunrise TV ou Quickline ici ». Aucune couche de l'atlas ne donne la
disponibilité TV par opérateur.

**Décision : la TV reste hors de cet outil, et l'onglet le dit.** On aurait pu
l'inférer de la liste des fournisseurs fixes — un opérateur présent en fixe
vend en général la TV — mais ce serait une déduction non vérifiée, exactement ce
que ce comparateur s'interdit partout ailleurs. Le silence serait pire encore :
un visiteur qui ne voit pas la TV conclurait qu'elle est indisponible. L'onglet
affiche donc « Disponibilité TV : non couverte par cet outil ».

## 7. Les antennes : disponibles, écartées

`ch.bakom.standorte-mobilfunkanlagen` fonctionne — 201 antennes dans un rayon de
200 m au Bundesplatz, avec exploitant, classe de puissance et type. Écartée
malgré tout : un nombre d'antennes ne renseigne pas sur la qualité de réception,
et le sujet attire des controverses sanitaires dont un comparateur d'abonnements
n'a rien à gagner. La couche reste notée ici si l'on change d'avis.

## 8. Limites à afficher, pas à cacher

- **Prédictif, pas garanti.** L'OFCOM l'écrit : « Les informations sur la
  desserte sont calculées à l'aide de modèles prédictifs. Il se peut qu'elles ne
  correspondent pas exactement à la desserte réelle. » Chaque résultat renvoie
  vers le vérificateur officiel de chaque opérateur trouvé.
- **Granularité.** 250 m en fixe, 100 m en mobile. Un immeuble fibré dans une
  cellule à 10 % ne se distingue pas de son voisin non raccordé. C'est pourquoi
  aucune couleur n'est affichée sans son pourcentage et sans la taille de la
  cellule à côté : une pastille verte seule laisserait croire à une réponse par
  bâtiment.
- **Mobile en extérieur uniquement.** Rien sur la réception à l'intérieur.
- **Absence ≠ zéro** (cf. § 5).

## 9. Deux pièges rencontrés

**Ne jamais deviner une coordonnée.** Une première sonde avec des coordonnées
genevoises posées à la main concluait que Genève n'avait pas la fibre. Géocodée
correctement, la Rue du Rhône 1 donne `anschlussart-glasfaser = 4`, soit plus de
90 % des bâtiments. Le point tombait dans une cellule sans donnée — lac ou parc.

**Filtrer le géocodage sur les adresses.** `SearchServer` mélange adresses et
lieux-dits : « Bahnhofstrasse 1 Zurich » remonte d'abord *Stadtkreis 1 Altstadt*,
un quartier entier. Sans filtre sur `attrs.origin === "address"`, on interroge
le centre du quartier au lieu de l'adresse demandée.

## 10. Le pipeline retenu

Trois requêtes par adresse, toutes depuis le navigateur, toutes en CORS ouvert
(`access-control-allow-origin: *`) :

```
1. SearchServer   ?searchText=…&type=locations&sr=2056   → E, N   (~230 ms)
2. WMS GetFeatureInfo, 16 couches, text/plain            → valeurs (~400 ms)
3. identify, ch.bakom.anbieter-eigenes_festnetz          → liste   (~100 ms)
```

Testé de bout en bout sur Berne, Genève et Zurich. Environ une seconde.

## 11. L'onglet — ce qui a été construit

En ligne. Tout tient dans `index.html`, sans donnée hébergée : le préfixe `cov`
identifie l'ensemble (`covGeocode`, `covInterroge`, `covAffiche`, `covCache`).

**Ce qui protège le quota**, dans l'ordre d'efficacité :

1. **Une requête WMS par adresse**, les seize couches ensemble.
2. **La couverture n'est interrogée qu'à la sélection d'une adresse**, jamais à
   la frappe. Seul le géocodage suit la saisie, temporisé à 450 ms, et il tape
   l'API REST (40 req/min) et non le WMS (20 req/min).
3. **Cache par cellule de 100 m.** Le cahier des charges disait 250 m ; on a
   pris 100 m, la maille du mobile. À 250 m, deux adresses distantes de 200 m
   partageraient une valeur mobile relevée deux cellules plus loin — le gain de
   cache ne valait pas cette approximation. Vérifié : deux points à 40 m ne
   déclenchent qu'un appel, deux points à 300 m en déclenchent deux.
4. **Un garde-fou de cadence** (`covPeutInterroger`) plafonne à 15 appels par
   minute glissante et affiche un message clair plutôt que de laisser
   l'infrastructure fédérale répondre par un refus.

**Ce que l'affichage garantit** :

- **Aucune couleur seule.** Chaque pastille est suivie de ce qu'elle compte et
  sur quelle maille — « > 90 – 100 % » puis « des bâtiments dans ce secteur de
  250 m », qui se lisent comme une phrase. Un premier jet répétait le
  pourcentage deux fois, dans la pastille puis dans le contexte ; corrigé.
- **Les noms d'opérateurs ont leur propre couleur.** Ils portaient d'abord le
  vert des « > 90 – 100 % », ce qui se lisait trois panneaux plus bas comme un
  jugement sur le fournisseur.
- **L'avertissement est permanent**, au-dessus des résultats, pas replié.
- **La TV a son panneau**, qui dit qu'elle n'est pas couverte et pourquoi on ne
  la déduit pas des fournisseurs fixes.
- **Absence de donnée ≠ absence de couverture** : hors zone bâtie, le panneau
  dit « l'atlas ne recense aucun bâtiment desservi dans ce secteur — ce n'est
  pas la preuve qu'aucun raccordement n'est possible ».

**Cas limites vérifiés en navigateur** : saisie sans correspondance, localité
sans numéro (« Zermatt » est écarté par le filtre `origin === "address"`, avec
un message qui demande une rue et un numéro), point alpin sans cellule fixe,
et rejeu de la même adresse depuis le cache.

**Ce que l'onglet ne fait pas** : pas d'antennes (§ 7) et aucun compteur
d'offres dans la barre d'onglets, puisqu'il n'y a pas de catalogue à compter.

## 12. La carte — WMTS, et pourquoi ça change tout

Ajoutée après coup, et elle n'aurait pas été possible sur l'architecture du
§ 10. La fiche par adresse tape le **WMS**, plafonné à 20 requêtes par minute :
une carte librement déplaçable l'aurait épuisé en quelques glissements.

Les mêmes couches sont aussi servies en **WMTS** — des tuiles pré-calculées,
distribuées par CDN — et le plafond n'a rien à voir :

| Service | Par minute | Par an |
|---|---|---|
| WMS `wms.geo.admin.ch` | 20 | 10,5 M |
| **WMTS `wmts.geo.admin.ch`** | **1 200** | **631 M** |

Soixante fois plus. Une vue consomme une quarantaine de tuiles, fond compris :
un visiteur peut enchaîner une trentaine de déplacements par minute sans
approcher la limite. C'est ce que fait le géoportail officiel lui-même.

Patron d'URL, en **EPSG:3857 nativement** — donc Leaflet sans reprojection :

```
https://wmts.geo.admin.ch/1.0.0/{couche}/default/current/3857/{z}/{x}/{y}.{png|jpeg}
```

Tuiles en CORS ouvert, `cache-control: public, max-age=3600,
s-maxage=31556952`. Fond de carte : `ch.swisstopo.pixelkarte-farbe` en jpeg,
surimpression en png à l'opacité 0.75 — celle qu'emploie le géoportail.

### Les plafonds de zoom, relevés couche par couche

Vérifiés sur Berne **et** Lausanne, niveaux 10 à 20, pour ne rien supposer :

| Couches | Zoom max servi | Au-delà |
|---|---|---|
| Fond `pixelkarte-farbe` | 19 | HTTP 400 |
| Les 15 couches de l'atlas… | **18** | HTTP 400 |
| …sauf `mobilnetz-5g` | **14** | HTTP 400 |

La 5G est la seule exception, et l'écart est large : au zoom 14 on voit une
ville, pas une rue. `maxNativeZoom` règle le cas — Leaflet cesse de demander
des tuiles inexistantes et agrandit la dernière disponible. **Le flou est le
comportement souhaité** : la donnée mobile est maillée à 100 m, il n'y a rien
de plus fin à montrer. Un message sous la carte le dit en toutes lettres dès
qu'on dépasse le natif de la couche affichée.

### Choix d'implémentation

- **Leaflet 1.9.4 depuis CDN**, avec empreintes SRI vérifiées, en `defer`.
  Seule dépendance externe du site. Aucune CSP à débloquer : le projet n'a ni
  `netlify.toml` ni `_headers`.
- **Initialisation différée** à la première ouverture de l'onglet. Leaflet
  dimensionne ses tuiles à la construction : dans un conteneur masqué, il
  calcule sur une hauteur nulle et n'affiche rien. `invalidateSize()` aux
  ouvertures suivantes.
- **La légende est l'image officielle** de `api3.geo.admin.ch/static/images/
  legends/`, pas une recopie de couleurs. Si l'OFCOM change sa palette, on ne
  se retrouve pas à mentir sur la sienne.
- **Le marqueur** vient des champs `lat`/`lon` que `SearchServer` rend en même
  temps que le LV95 : aucune reprojection à écrire. La carte se recentre avant
  la fiche textuelle, puisqu'elle ne dépend pas du WMS.

### Un piège de test, pas de code

Une première campagne enchaînait les `setView` animés en boucle ; la carte
finissait bloquée, ignorant les changements de zoom, et l'avertissement
paraissait défaillant. Reproduit proprement avec `{animate:false}` et des
attentes suffisantes, tout se comporte correctement. **Le symptôme venait du
harnais de test, pas du produit** — vérifier avant de « corriger » un bug qui
n'existe pas.
