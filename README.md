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
| `contacts`  | 0..N contacts liés à une tâche (CASCADE à la suppression)           |
| `demandeurs`, `entites`, `services`, `etats`, `domaines` | Référentiels (listes déroulantes) |

Les tâches référencent les référentiels via des clés étrangères `ON DELETE SET NULL` :
si une valeur de référentiel est supprimée, la tâche conserve son existence mais le champ correspondant est vidé.

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
- `GET    /api/refs/:table` — toutes les valeurs (`demandeurs`, `entites`, `services`, `etats`, `domaines`)
- `POST   /api/refs/:table` — `{ libelle, actif? }`
- `PUT    /api/refs/:table/:id`
- `DELETE /api/refs/:table/:id`

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
- Listes déroulantes (état, demandeur, domaine) ;
- Champs date (déclaration, échéance, fin) ;
- Champs numériques (durée prévue, durée accomplie) ;
- Service et Entité du demandeur affichés automatiquement.

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

Bouton **⋯** par ligne pour ouvrir un panneau détaillé avec :
  - description longue éditable en **WYSIWYG** (gras, italique, souligné, listes, lien, etc.),
  - liste des actions menées (date, libellé, et description WYSIWYG également) — ajout/édition/suppression,
  - liste des contacts liés (ajout via le sélecteur du référentiel, retrait sans suppression du contact lui-même).

### b) Page `Référentiels`
- Menu latéral pour basculer entre les référentiels.
- Ajout, renommage, désactivation (actif/inactif) et suppression des valeurs.
- Les valeurs renommées se propagent immédiatement aux listes déroulantes de la page principale.

---

## 4. Démarrer rapidement (résumé)

```bash
# Terminal 1 — backend
cd backend && npm install && npm start

# Terminal 2 — frontend
cd frontend && npm install && npm start
```

Puis ouvrir <http://localhost:4200>.
