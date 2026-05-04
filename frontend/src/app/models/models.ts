export type RefKind = 'simple' | 'service' | 'contact';

export interface ReferenceTableMeta {
  name: string;
  label: string;
  kind: RefKind;
}

/** Référentiel simple : entites, etats, domaines */
export interface SimpleRef {
  id: number;
  libelle: string;
  actif: number;
}

/** Référentiel "service" : libellé + entité */
export interface ServiceRef {
  id: number;
  libelle: string;
  actif: number;
  entite_id: number | null;
  entite_libelle?: string | null;
}

/** Référentiel "contact" : nom + coordonnées + service */
export interface ContactRef {
  id: number;
  nom: string;
  role: string | null;
  email: string | null;
  telephone: string | null;
  actif: number;
  service_id: number | null;
  service_libelle?: string | null;
  entite_id?: number | null;
  entite_libelle?: string | null;
}

/** Une ligne quelconque d'un référentiel : union des trois. */
export type RefRow = SimpleRef | ServiceRef | ContactRef;

export interface Action {
  id: number;
  tache_id: number;
  date_action: string | null;
  libelle: string;
  description: string | null;
  created_at?: string;
}

export interface Tache {
  id: number;
  libelle: string;
  description: string | null;

  dateDeclaration: string | null;
  dateEcheance:    string | null;
  dateFin:         string | null;

  dureePrevue:     number | null;
  dureeAccomplie:  number | null;

  demandeurId: number | null;
  etatId:      number | null;
  domaineId:   number | null;

  // Champs calculés (lecture seule)
  demandeurNom?:        string | null;
  demandeurServiceId?:  number | null;
  demandeurService?:    string | null;
  demandeurEntiteId?:   number | null;
  demandeurEntite?:     string | null;
  etatLibelle?:         string | null;
  domaineLibelle?:      string | null;

  createdAt?: string;
  updatedAt?: string;

  actions?:  Action[];
  contacts?: ContactRef[];
}
