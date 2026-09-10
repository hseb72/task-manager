# Atelier des tâches — outil de gestion de tâches

Application web complète pour la gestion de tâches avec :
- **Frontend** : Angular 18 (composants standalone, signals)
- **Backend** : Node.js + Express
- **Base de données** : SQLite via le module `@libsql/client`

```
task-manager/
├── backend/      Serveur API REST + base SQLite
└── frontend/     Application Angular
```

---

## 1. Backend

### Prérequis
- Node.js ≥ 20

### Installation
```bash
cd backend
npm install
```

### Démarrage
```bash
npm start          # production
npm run dev        # avec rechargement à chaud (Node --watch)
```

Le serveur écoute sur `http://localhost:3000`. Au premier démarrage, il :
1. crée le fichier `backend/data/tasks.db` ;
2. crée toutes les tables ;
3. insère un jeu de valeurs par défaut dans les référentiels et une tâche d'exemple.

### Modèle de données

| Table       | Rôle                                                                |
|-------------|---------------------------------------------------------------------|
| `taches`    | Table centrale (ID, libellé, description, dates, durées, FK)        |
| `actions`   | 0..N actions menées sur une tâche (CASCADE à la suppression)        |
| `tache_contacts` | Liaison N:N entre tâches et contacts, **portant un rôle**     |
| `entites`, `services`, `contacts`, `roles`, `etats`, `domaines` | Référentiels (listes déroulantes) |

**Relations clés** :
- Une tâche référence un **intervenant** (`intervenant_id` → `contacts`), un **service** et une **entité** propres, un **état** et un **domaine**.
- Un **service** est rattaché à une **entité**.
- Un **contact** est rattaché à un **service**.
- Un **rôle** caractérise la liaison entre une tâche et un contact (un même contact peut tenir des rôles différents selon la tâche).

Les tâches référencent les référentiels via des clés étrangères `ON DELETE SET NULL` :
si une valeur de référentiel est supprimée, les tâches conservent leur existence mais le champ correspondant est vidé.

### Migration depuis l'ancien modèle

Les bases existantes sont migrées automatiquement au démarrage :
- `taches.demandeur_id` → renommée en `taches.intervenant_id`
- ajout de `taches.service_id` et `taches.entite_id`
- ajout de `tache_contacts.role_id`
- création du référentiel `roles` ; les anciens libellés de rôle texte sur `contacts` sont migrés en valeurs du référentiel, puis la colonne `contacts.role` est supprimée.

### API REST

#### Tâches
- `GET    /api/taches` — liste enrichie (libellés joints)
- `GET    /api/taches/:id` — détail + actions + contacts
- `POST   /api/taches` — création
- `PUT    /api/taches/:id` — mise à jour partielle (n'envoyer que les champs modifiés)
- `DELETE /api/taches/:id`

#### Actions / Contacts (rattachés à une tâche)
- `GET|POST    /api/taches/:id/actions`
- `PUT|DELETE  /api/taches/:id/actions/:actionId`
- `GET|POST    /api/taches/:id/contacts`
- `PUT|DELETE  /api/taches/:id/contacts/:contactId`

#### Référentiels
- `GET    /api/refs` — liste les référentiels disponibles
- `GET    /api/refs/:table` — sans paramètre : **toutes** les valeurs (`entites`, `services`, `contacts`, `roles`, `etats`, `domaines`), utilisé par les listes déroulantes et l'export. Avec `?page=&pageSize=&sort=&dir=&q=` : **liste paginée / triée / recherchée côté serveur** → `{ rows, total, page, pageSize, pageCount }`. `sort` est une clé en liste blanche (id, libellé/nom, entité, service, fonction, email, téléphone, état) ; `q` recherche (LIKE) sur les colonnes texte, y compris les libellés joints (service, entité) ; `pageSize` est borné (≤ 500).
- `POST   /api/refs/:table` — `{ libelle, actif? }` (contacts : `{ nom, email?, telephone?, service_id?, fonction? }`)
  - **Contacts** : la création est refusée (409) si un contact du **même nom** existe déjà (à la casse et aux espaces près). Le champ **`fonction`** (intitulé de poste / fonction organisationnelle) est optionnel et nullable.
- `PUT    /api/refs/:table/:id`
- `DELETE /api/refs/:table/:id`

#### Enrichissement par capture d'écran (côté navigateur)
Deux enrichissements par **capture d'écran**, entièrement côté frontend (OCR local via Tesseract.js, aucun appel réseau vers l'annuaire — donc pas de contrainte CORS, d'authentification serveur ni de certificat) :

- **Contact** (page Référentiels → Contacts, bouton 🔎) : on dépose la **fiche annuaire** du contact ; le **service** (libellé « Unité d'affectation principale / Service / Département… ») et l'**entité** (« Métier / Entité / Direction… », en ignorant « Entité juridique ») sont lus — y compris quand la valeur est sur la ligne **sous** le libellé — puis rapprochés des référentiels (insensible casse/accents). Si le service ou l'entité n'existent pas, ils sont **créables à la volée**. Le rattachement validé met à jour `contacts.service_id` (l'entité en découle).
- **Service** (page Référentiels → Services, bouton 🔎) : on dépose une capture des **tuiles de contacts** du service. Pour chaque tuile, le **nom** et le **rôle** (texte après le tiret, stocké en **`fonction`**) sont extraits ; la photo/les initiales, l'id et la mention *interne/externe* sont ignorés. L'utilisateur valide la liste (créer / lier à un existant / ignorer) ; chaque contact gardé est **rattaché au service** (`service_id`) et sa fonction renseignée. Les doublons de nom sont réutilisés.

#### Divers
- `GET /api/health` — sonde de vie
- `GET /api/export` — télécharge l'intégralité de la base au format `.json.gz`
- `POST /api/import?mode=replace|merge` — restaure depuis un export. Body : binaire (`.json.gz` ou `.json`).
  - `mode=replace` (défaut) : vide tout puis insère
  - `mode=merge` : `INSERT OR REPLACE` (les conflits d'ID écrasent)

---

## 2. Frontend

### Prérequis
- Node.js ≥ 20
- Angular CLI : `npm i -g @angular/cli` (optionnel, sinon `npx ng …`)

### Installation
```bash
cd frontend
npm install
```

### Démarrage en développement
Le proxy `proxy.conf.json` redirige automatiquement `/api/*` vers `http://localhost:3000`,
**il faut donc démarrer le backend en parallèle**.

```bash
npm start          # http://localhost:4200
```

### Build de production
```bash
npm run build
```
Les fichiers sont produits dans `dist/task-manager-frontend`.

---

## 3. Pages de l'application

### a) Page principale — `Tâches`
Tableau dense de toutes les tâches en cours, avec édition directe des cellules :
- Champs texte (libellé) éditables en place ;
- Listes déroulantes (état, intervenant, service, entité, domaine) ;
- Champs date (déclaration, échéance, fin) ;
- Champs numériques (durée prévue, durée accomplie).

Chaque modification est envoyée au backend dès la perte de focus / changement.

**Tri** : clic sur n'importe quel en-tête de colonne (sauf actions) — premier clic ascendant, deuxième descendant, indicateur ↑/↓.

**Filtrage par colonne** : sous chaque en-tête, un filtre adapté au type :
- texte (libellé) → contient
- listes (état, demandeur, service, entité, domaine) → liste déroulante
- dates → intervalle « du / au »
- nombres (durées) → intervalle « min / max »
- bouton ⟲ pour réinitialiser tous les filtres en une fois

Un champ de **recherche globale** complète les filtres par colonne.

**Pagination** : sélecteur 5 / 10 / 20 / 50 / Tout, boutons « ‹‹ ‹ 1 2 … 9 10 … N › ›› », libellé « X–Y sur Z ».

**Import / Export** : un seul bouton avec menu déroulant (flèche ▾) regroupe trois actions :
- **↓ Exporter** (action par défaut) : télécharge un `.json.gz` contenant toutes les tables
- **↑ Remplacer** : importe un `.json.gz` (ou `.json`) en vidant la base d'abord. Confirmation requise. L'action choisie devient la nouvelle action par défaut du bouton
- **↑ Fusionner** : importe en mode `INSERT OR REPLACE` (les enregistrements existants avec le même ID sont écrasés, les autres préservés)

**🖼 Import depuis image (OCR)** : bouton dédié qui ouvre un dialogue où on dépose ou colle (Ctrl+V) une capture d'écran (Outlook, Teams, CMDB, etc.). [Tesseract.js](https://tesseract.projectnaptha.com/) reconnaît le texte localement (modèles français + anglais), des heuristiques détectent le sujet, les dates de déclaration/échéance et les contacts (avec leurs rôles éventuels via la signature).

Pour une **capture du détail d'une réunion Teams / Outlook**, la détection reconnaît les sections *Organisateur* / *Participants* (FR + EN, avec ou sans e-mails) : l'**organisateur** est proposé comme **intervenant principal** et les autres **participants** comme contacts secondaires, **sans rôle**. Les contacts inexistants sont **créés** automatiquement. Le plus gros bloc de texte restant (corps du message, ordre du jour…) alimente la **description** de la tâche.

L'utilisateur **valide manuellement** les champs, choisit pour chaque contact détecté de le **lier à un contact existant**, de le **créer** dans le référentiel, ou de l'**ignorer**, désigne l'intervenant, puis crée la tâche en un clic. Un contact manquant peut être ajouté en **glissant-déposant** une zone de l'image (ou un texte surligné) vers la carte *Contacts détectés*. Les modèles Tesseract (~10 Mo) sont téléchargés au premier usage et mis en cache par le navigateur.

Bouton **⋯** par ligne pour ouvrir un panneau détaillé avec :
  - description longue éditable en **WYSIWYG** (gras, italique, souligné, listes, lien, etc.),
  - liste des actions menées (date, libellé, et description WYSIWYG également) — ajout/édition/suppression,
  - liste des contacts liés (ajout via le sélecteur du référentiel **avec un rôle optionnel pour la tâche**, modification du rôle directement dans le tableau, retrait sans suppression du contact lui-même).

### b) Page `Référentiels`
- Menu latéral pour basculer entre les référentiels.
- Ajout, renommage, désactivation (actif/inactif) et suppression des valeurs.
- Tableaux **triables**, **paginés**, **recherchables** et **filtrables par colonne** — **côté serveur** (conçu pour de gros volumes) : clic sur un en-tête (indicateur ↑/↓), taille de page 10 / 25 / 50 / 100, navigation ‹ Précédent / Suivant › avec « X–Y sur Z », champ de recherche global, et une **ligne de filtres** sous les en-têtes (texte « contient » pour libellé/nom/fonction/email/téléphone, listes déroulantes pour service / entité / état). Bouton **⟲ Réinitialiser**. Filtres serveur envoyés en `f_<colonne>` (combinés en ET, avec la recherche globale).
- Les valeurs renommées se propagent immédiatement aux listes déroulantes de la page principale.
- **Contacts** : impossible de créer deux contacts du **même nom** (garde-fou anti-doublon). Colonne **Fonction** (éditable, nullable). Bouton **🔎 Enrichir** par contact : on dépose la **capture de la fiche annuaire** ; le **service** et l'**entité (métier)** sont déduits, rapprochés des référentiels, et **créables à la volée** si absents, puis appliqués (`service_id`, l'entité en découlant).
- **Services** : bouton **🔎 Enrichir** par service : on dépose une **capture des tuiles de contacts** ; nom et rôle (→ **fonction**) sont extraits par tuile (id et interne/externe ignorés) et, après validation (créer / lier / ignorer), les contacts sont **rattachés au service**. Tout se passe dans le navigateur — aucun accès réseau à l'annuaire.

---

## 4. Démarrer rapidement (résumé)

```bash
# Terminal 1 — backend
cd backend && npm install && npm start

# Terminal 2 — frontend
cd frontend && npm install && npm start
```

Puis ouvrir <http://localhost:4200>.
