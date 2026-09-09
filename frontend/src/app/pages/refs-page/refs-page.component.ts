import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink, RouterLinkActive } from '@angular/router';
import { RefsService } from '../../services/refs.service';
import {
  RefRow, ReferenceTableMeta,
  SimpleRef, ServiceRef, ContactRef, SourceRef, SourceAuthType, RefKind, EnrichResult,
} from '../../models/models';

/** Copie de travail pour le panneau de configuration d'une source web. */
interface SourceEdit {
  id: number;
  libelle: string;
  rendu_js: boolean;
  auth_type: SourceAuthType;
  auth_user: string;
  auth_header: string;
  secret: string;
  secretSet: boolean;
  url_uid: string;
  uid_regex: string;
}

/** État du panneau d'enrichissement d'un contact. */
interface EnrichState {
  contact: ContactRef;
  loading: boolean;
  result: EnrichResult | null;
  error: string | null;
}

@Component({
  selector: 'app-refs-page',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, RouterLinkActive],
  templateUrl: './refs-page.component.html',
  styleUrl: './refs-page.component.css',
})
export class RefsPageComponent implements OnInit {
  refs = inject(RefsService);
  private route = inject(ActivatedRoute);

  current  = signal<string>('entites');
  values   = signal<RefRow[]>([]);
  errorMsg = signal<string | null>(null);

  // Modèle d'ajout (utilisé selon le kind courant)
  newSimpleLibelle = signal('');
  newServiceLibelle = signal('');
  newServiceEntiteId = signal<number | null>(null);
  newContactNom = signal('');
  newContactEmail = signal('');
  newContactTelephone = signal('');
  newContactServiceId = signal<number | null>(null);
  newSourceLibelle = signal('');
  newSourceUrl = signal('');

  // Enrichissement des contacts
  enrichSourceId = signal<number | null>(null);
  enrich = signal<EnrichState | null>(null);

  // Configuration (rendu JS + authentification) d'une source web
  sourceEdit = signal<SourceEdit | null>(null);

  meta = computed<ReferenceTableMeta | undefined>(() =>
    this.refs.tables().find(t => t.name === this.current())
  );
  kind = computed<RefKind>(() => this.meta()?.kind ?? 'simple');
  currentLabel = computed(() => this.meta()?.label ?? this.current());

  // Vues typées du tableau (selon le kind)
  asSimple   = computed<SimpleRef[]>(()  => this.values() as SimpleRef[]);
  asServices = computed<ServiceRef[]>(() => this.values() as ServiceRef[]);
  asContacts = computed<ContactRef[]>(() => this.values() as ContactRef[]);
  asSources  = computed<SourceRef[]>(()  => this.values() as SourceRef[]);

  /** Sources web actives, proposées pour l'enrichissement. */
  activeSources = computed<SourceRef[]>(() => this.refs.sourcesWeb().filter(s => s.actif));

  ngOnInit() {
    this.route.paramMap.subscribe(p => {
      const tbl = p.get('table') ?? 'entites';
      this.current.set(tbl);
      this.resetForm();
      this.load();
    });
  }

  load() {
    this.errorMsg.set(null);
    this.refs.list(this.current()).subscribe({
      next: vs => {
        this.values.set(vs);
        this.refs.refreshSignal(this.current(), vs);
      },
      error: err => this.errorMsg.set(err?.error?.error ?? err.message ?? 'Erreur'),
    });
  }

  /* ====================================================================== */
  /*  Helpers                                                                */
  /* ====================================================================== */

  private val(ev: Event): string {
    return (ev.target as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement).value;
  }
  /** Version publique (utilisée par les liaisons de template). */
  v(ev: Event): string { return this.val(ev); }
  private valOrNull(ev: Event): string | null {
    const v = this.val(ev);
    return v === '' ? null : v;
  }
  private numOrNull(ev: Event): number | null {
    const v = this.val(ev);
    return v === '' ? null : Number(v);
  }

  private resetForm() {
    this.newSimpleLibelle.set('');
    this.newServiceLibelle.set('');
    this.newServiceEntiteId.set(null);
    this.newContactNom.set('');
    this.newContactEmail.set('');
    this.newContactTelephone.set('');
    this.newContactServiceId.set(null);
    this.newSourceLibelle.set('');
    this.newSourceUrl.set('');
    this.errorMsg.set(null);
  }

  /* ====================================================================== */
  /*  Création                                                               */
  /* ====================================================================== */

  add() {
    this.errorMsg.set(null);
    const k = this.kind();
    let body: Partial<RefRow>;

    if (k === 'simple') {
      const lib = this.newSimpleLibelle().trim();
      if (!lib) return;
      body = { libelle: lib };
    } else if (k === 'service') {
      const lib = this.newServiceLibelle().trim();
      if (!lib) return;
      body = { libelle: lib, entite_id: this.newServiceEntiteId() };
    } else if (k === 'source') {
      const lib = this.newSourceLibelle().trim();
      const url = this.newSourceUrl().trim();
      if (!lib || !url) return;
      body = { libelle: lib, url } as Partial<SourceRef>;
    } else { // contact
      const nom = this.newContactNom().trim();
      if (!nom) return;
      body = {
        nom,
        email: this.newContactEmail().trim() || null,
        telephone: this.newContactTelephone().trim() || null,
        service_id: this.newContactServiceId(),
      } as Partial<ContactRef>;
    }

    this.refs.create(this.current(), body).subscribe({
      next: () => { this.resetForm(); this.load(); },
      error: err => this.errorMsg.set(err?.error?.error ?? err.message ?? 'Erreur'),
    });
  }

  /* ====================================================================== */
  /*  Mise à jour d'une ligne                                                */
  /* ====================================================================== */

  /** Patch générique : remonte au backend puis recharge pour récupérer les libellés joints. */
  private patch(id: number, body: Partial<RefRow>) {
    this.refs.update(this.current(), id, body).subscribe({
      next: () => this.load(),
      error: err => this.errorMsg.set(err?.error?.error ?? err.message ?? 'Erreur'),
    });
  }

  // Simple
  renameSimple(v: SimpleRef, ev: Event) {
    const newLib = this.val(ev).trim();
    if (!newLib || newLib === v.libelle) return;
    this.patch(v.id, { libelle: newLib });
  }

  // Service
  renameService(v: ServiceRef, ev: Event) {
    const newLib = this.val(ev).trim();
    if (!newLib || newLib === v.libelle) return;
    this.patch(v.id, { libelle: newLib });
  }
  changeServiceEntite(v: ServiceRef, ev: Event) {
    this.patch(v.id, { entite_id: this.numOrNull(ev) });
  }
  changeServiceEntiteModel(v: ServiceRef, entiteId: number | null) {
    this.patch(v.id, { entite_id: entiteId });
  }

  // Contact
  renameContact(v: ContactRef, ev: Event) {
    const newNom = this.val(ev).trim();
    if (!newNom || newNom === v.nom) return;
    this.patch(v.id, { nom: newNom });
  }
  changeContactField(v: ContactRef, field: 'email' | 'telephone', ev: Event) {
    this.patch(v.id, { [field]: this.valOrNull(ev) } as Partial<ContactRef>);
  }
  changeContactService(v: ContactRef, ev: Event) {
    this.patch(v.id, { service_id: this.numOrNull(ev) });
  }
  changeContactServiceModel(v: ContactRef, serviceId: number | null) {
    this.patch(v.id, { service_id: serviceId });
  }

  // Source web
  renameSource(v: SourceRef, ev: Event) {
    const newLib = this.val(ev).trim();
    if (!newLib || newLib === v.libelle) return;
    this.patch(v.id, { libelle: newLib } as Partial<SourceRef>);
  }
  changeSourceUrl(v: SourceRef, ev: Event) {
    const url = this.val(ev).trim();
    if (!url || url === v.url) return;
    this.patch(v.id, { url } as Partial<SourceRef>);
  }
  toggleRenduJs(v: SourceRef) {
    this.patch(v.id, { rendu_js: v.rendu_js ? 0 : 1 } as Partial<SourceRef>);
  }

  // Panneau de configuration (rendu JS + auth)
  openSourceConfig(v: SourceRef) {
    this.sourceEdit.set({
      id: v.id,
      libelle: v.libelle,
      rendu_js: !!v.rendu_js,
      auth_type: (v.auth_type ?? 'none'),
      auth_user: v.auth_user ?? '',
      auth_header: v.auth_header ?? '',
      secret: '',
      secretSet: !!v.auth_secret_set,
      url_uid: v.url_uid ?? '',
      uid_regex: v.uid_regex ?? '',
    });
  }
  updateSourceEdit(patch: Partial<SourceEdit>) {
    const e = this.sourceEdit();
    if (e) this.sourceEdit.set({ ...e, ...patch });
  }
  saveSourceConfig() {
    const e = this.sourceEdit();
    if (!e) return;
    const body: Partial<SourceRef> = {
      rendu_js: e.rendu_js ? 1 : 0,
      auth_type: e.auth_type,
      auth_user: e.auth_type === 'basic' ? (e.auth_user.trim() || null) : null,
      auth_header: e.auth_type === 'header' ? (e.auth_header.trim() || null) : null,
      url_uid: e.url_uid.trim() || null,
      uid_regex: e.uid_regex.trim() || null,
    };
    // Le secret n'est envoyé que s'il a été saisi (sinon inchangé côté serveur).
    if (e.secret) body.auth_secret = e.secret;
    this.patch(e.id, body);
    this.sourceEdit.set(null);
  }
  closeSourceConfig() { this.sourceEdit.set(null); }

  /* ====================================================================== */
  /*  Enrichissement d'un contact depuis une source web                      */
  /* ====================================================================== */

  openEnrich(v: ContactRef) {
    // Source par défaut : celle sélectionnée, sinon la première active
    if (this.enrichSourceId() == null && this.activeSources().length > 0) {
      this.enrichSourceId.set(this.activeSources()[0]!.id);
    }
    this.enrich.set({ contact: v, loading: true, result: null, error: null });
    this.refs.enrich(v.nom, this.enrichSourceId()).subscribe({
      next: r => this.enrich.set({ contact: v, loading: false, result: r, error: null }),
      error: err => this.enrich.set({
        contact: v, loading: false, result: null,
        error: err?.error?.error ?? err.message ?? 'Erreur',
      }),
    });
  }

  applyEnrich() {
    const st = this.enrich();
    if (!st?.result?.serviceMatch) return;
    this.patch(st.contact.id, { service_id: st.result.serviceMatch.id });
    this.enrich.set(null);
  }

  closeEnrich() { this.enrich.set(null); }

  // Commun
  toggleActif(v: RefRow) {
    this.patch(v.id, { actif: v.actif ? 0 : 1 });
  }

  delete(v: RefRow) {
    const label = (v as ContactRef).nom ?? (v as SimpleRef).libelle;
    if (!confirm(`Supprimer "${label}" ? Les enregistrements qui y font référence verront cette caractéristique vidée.`)) return;
    this.refs.delete(this.current(), v.id).subscribe({
      next: () => this.load(),
      error: err => this.errorMsg.set(err?.error?.error ?? err.message ?? 'Erreur'),
    });
  }

  // Champs de saisie de la zone "ajout"
  setAddField(field: string, ev: Event) {
    const v = this.val(ev);
    switch (field) {
      case 'simpleLibelle':       this.newSimpleLibelle.set(v); break;
      case 'serviceLibelle':      this.newServiceLibelle.set(v); break;
      case 'serviceEntite':       this.newServiceEntiteId.set(v === '' ? null : Number(v)); break;
      case 'contactNom':          this.newContactNom.set(v); break;
      case 'contactEmail':        this.newContactEmail.set(v); break;
      case 'contactTelephone':    this.newContactTelephone.set(v); break;
      case 'contactService':      this.newContactServiceId.set(v === '' ? null : Number(v)); break;
      case 'sourceLibelle':       this.newSourceLibelle.set(v); break;
      case 'sourceUrl':           this.newSourceUrl.set(v); break;
    }
  }

  trackById = (_: number, v: RefRow) => v.id;
}
