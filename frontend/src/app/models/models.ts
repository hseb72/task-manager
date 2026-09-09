export type RefKind = 'simple' | 'service' | 'contact' | 'source';

export interface ReferenceTableMeta {
  name: string;
  label: string;
  kind: RefKind;
}

/** Référentiel simple : entites, etats, domaines, roles */
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

/** Référentiel "contact" : nom + coordonnées + service (sans rôle) */
export interface ContactRef {
  id: number;
  nom: string;
  email: string | null;
  telephone: string | null;
  actif: number;
  service_id: number | null;
  service_libelle?: string | null;
  entite_id?: number | null;
  entite_libelle?: string | null;
}

/** Référentiel "source web" : libellé + gabarit d'URL d'enrichissement */
export interface SourceRef {
  id: number;
  libelle: string;
  url: string;
  actif: number;
}

export type RefRow = SimpleRef | ServiceRef | ContactRef | SourceRef;

/** Résultat d'un enrichissement de contact depuis une source web. */
export interface EnrichResult {
  url: string;
  source: { id: number; libelle: string };
  deduced: { service: string | null; entite: string | null };
  serviceMatch: { id: number; libelle: string; entite_id: number | null; entite_libelle?: string | null } | null;
  entiteMatch: { id: number; libelle: string } | null;
  pairsFound: number;
}

export interface Action {
  id: number;
  tache_id: number;
  date_action: string | null;
  libelle: string;
  description: string | null;
  created_at?: string;
}

/** Contact lié à une tâche, enrichi du rôle pour cette tâche. */
export interface TacheContact extends ContactRef {
  role_id: number | null;
  role_libelle?: string | null;
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

  intervenantId: number | null;
  serviceId:     number | null;
  etatId:        number | null;
  domaineId:     number | null;

  // Champs joints (lecture seule). entiteId est dérivé du service.
  intervenantNom?: string | null;
  serviceLibelle?: string | null;
  entiteId?:       number | null;
  entiteLibelle?:  string | null;
  etatLibelle?:    string | null;
  domaineLibelle?: string | null;

  createdAt?: string;
  updatedAt?: string;

  actions?:  Action[];
  contacts?: TacheContact[];
}
