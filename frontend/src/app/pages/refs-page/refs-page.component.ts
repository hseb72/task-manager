import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink, RouterLinkActive } from '@angular/router';
import { RefsService } from '../../services/refs.service';
import {
  RefRow, ReferenceTableMeta,
  SimpleRef, ServiceRef, ContactRef, RefKind,
} from '../../models/models';
import { ContactEnrichDialogComponent } from '../../components/contact-enrich-dialog/contact-enrich-dialog.component';
import { ServiceEnrichDialogComponent } from '../../components/service-enrich-dialog/service-enrich-dialog.component';

@Component({
  selector: 'app-refs-page',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, RouterLinkActive,
            ContactEnrichDialogComponent, ServiceEnrichDialogComponent],
  templateUrl: './refs-page.component.html',
  styleUrl: './refs-page.component.css',
})
export class RefsPageComponent implements OnInit {
  refs = inject(RefsService);
  private route = inject(ActivatedRoute);

  current  = signal<string>('entites');
  /** Lignes de la PAGE courante (tri / pagination / recherche côté serveur). */
  rows     = signal<RefRow[]>([]);
  /** Nombre total de lignes (toutes pages) pour le filtre courant. */
  total    = signal<number>(0);
  errorMsg = signal<string | null>(null);

  // Modèle d'ajout (utilisé selon le kind courant)
  newSimpleLibelle = signal('');
  newServiceLibelle = signal('');
  newServiceEntiteId = signal<number | null>(null);
  newContactNom = signal('');
  newContactEmail = signal('');
  newContactTelephone = signal('');
  newContactServiceId = signal<number | null>(null);
  newContactFonction = signal('');

  /** Contact en cours d'enrichissement par capture d'écran (ou null). */
  enrichContact = signal<ContactRef | null>(null);
  /** Service en cours d'enrichissement (ajout de contacts par capture) ou null. */
  enrichService = signal<ServiceRef | null>(null);

  meta = computed<ReferenceTableMeta | undefined>(() =>
    this.refs.tables().find(t => t.name === this.current())
  );
  kind = computed<RefKind>(() => this.meta()?.kind ?? 'simple');
  currentLabel = computed(() => this.meta()?.label ?? this.current());

  /* ----- Tri & pagination & recherche (côté serveur) ----- */
  sortKey  = signal<string | null>(null);
  sortDir  = signal<'asc' | 'desc'>('asc');
  pageSize = signal<number>(25);
  pageIndex = signal<number>(0);
  search   = signal<string>('');
  readonly pageSizes = [10, 25, 50, 100];
  private searchTimer: any = null;

  pageCount = computed(() => Math.max(1, Math.ceil(this.total() / this.pageSize())));
  rangeStart = computed(() => this.total() === 0 ? 0 : this.pageIndex() * this.pageSize() + 1);
  rangeEnd   = computed(() => Math.min(this.total(), (this.pageIndex() + 1) * this.pageSize()));

  // Vues typées de la PAGE courante (selon le kind)
  asSimple   = computed<SimpleRef[]>(()  => this.rows() as SimpleRef[]);
  asServices = computed<ServiceRef[]>(() => this.rows() as ServiceRef[]);
  asContacts = computed<ContactRef[]>(() => this.rows() as ContactRef[]);

  ngOnInit() {
    this.route.paramMap.subscribe(p => {
      const tbl = p.get('table') ?? 'entites';
      this.current.set(tbl);
      this.resetForm();
      this.sortKey.set(null);          // colonnes différentes selon le référentiel
      this.sortDir.set('asc');
      this.pageIndex.set(0);
      this.search.set('');
      this.fetch();
    });
  }

  /* ----- Tri & pagination : commandes ----- */
  toggleSort(key: string) {
    if (this.sortKey() === key) {
      this.sortDir.set(this.sortDir() === 'asc' ? 'desc' : 'asc');
    } else {
      this.sortKey.set(key);
      this.sortDir.set('asc');
    }
    this.pageIndex.set(0);
    this.fetch();
  }
  sortArrow(key: string): string {
    if (this.sortKey() !== key) return '';
    return this.sortDir() === 'asc' ? ' ↑' : ' ↓';
  }
  setPageSize(n: number) { this.pageSize.set(n); this.pageIndex.set(0); this.fetch(); }
  prevPage() { if (this.pageIndex() > 0) { this.pageIndex.update(i => i - 1); this.fetch(); } }
  nextPage() { if (this.pageIndex() < this.pageCount() - 1) { this.pageIndex.update(i => i + 1); this.fetch(); } }
  onSearch(ev: Event) {
    this.search.set(this.val(ev));
    this.pageIndex.set(0);
    clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => this.fetch(), 250);   // anti-rebond
  }

  /** Récupère la page courante depuis le serveur. */
  fetch() {
    this.errorMsg.set(null);
    this.refs.listPaged(this.current(), {
      page: this.pageIndex() + 1,
      pageSize: this.pageSize(),
      sort: this.sortKey(),
      dir: this.sortDir(),
      q: this.search(),
    }).subscribe({
      next: res => {
        this.rows.set(res.rows);
        this.total.set(res.total);
        if (res.page - 1 !== this.pageIndex()) this.pageIndex.set(res.page - 1);
      },
      error: err => this.errorMsg.set(err?.error?.error ?? err.message ?? 'Erreur'),
    });
  }

  /**
   * Après une mutation : recharge la page affichée et, pour les petits
   * référentiels servant de listes déroulantes (hors contacts), rafraîchit leur
   * liste complète afin que les sélecteurs restent à jour.
   */
  private afterMutation() {
    this.fetch();
    const t = this.current();
    if (t !== 'contacts') this.refs.reload(t).subscribe();
  }

  /* ====================================================================== */
  /*  Helpers                                                                */
  /* ====================================================================== */

  private val(ev: Event): string {
    return (ev.target as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement).value;
  }
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
    this.newContactFonction.set('');
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
    } else { // contact
      const nom = this.newContactNom().trim();
      if (!nom) return;
      body = {
        nom,
        email: this.newContactEmail().trim() || null,
        telephone: this.newContactTelephone().trim() || null,
        service_id: this.newContactServiceId(),
        fonction: this.newContactFonction().trim() || null,
      } as Partial<ContactRef>;
    }

    this.refs.create(this.current(), body).subscribe({
      next: () => { this.resetForm(); this.afterMutation(); },
      error: err => this.errorMsg.set(err?.error?.error ?? err.message ?? 'Erreur'),
    });
  }

  /* ====================================================================== */
  /*  Mise à jour d'une ligne                                                */
  /* ====================================================================== */

  /** Patch générique : remonte au backend puis recharge pour récupérer les libellés joints. */
  private patch(id: number, body: Partial<RefRow>) {
    this.refs.update(this.current(), id, body).subscribe({
      next: () => this.afterMutation(),
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
  changeContactField(v: ContactRef, field: 'email' | 'telephone' | 'fonction', ev: Event) {
    this.patch(v.id, { [field]: this.valOrNull(ev) } as Partial<ContactRef>);
  }
  changeContactService(v: ContactRef, ev: Event) {
    this.patch(v.id, { service_id: this.numOrNull(ev) });
  }
  changeContactServiceModel(v: ContactRef, serviceId: number | null) {
    this.patch(v.id, { service_id: serviceId });
  }

  /* ====================================================================== */
  /*  Enrichissement d'un contact par capture d'écran (OCR)                  */
  /* ====================================================================== */

  openEnrich(v: ContactRef) {
    this.enrichContact.set(v);
  }
  onEnrichClosed(res: { serviceId?: number }) {
    const contact = this.enrichContact();
    this.enrichContact.set(null);
    if (contact && res.serviceId != null) {
      this.patch(contact.id, { service_id: res.serviceId } as Partial<ContactRef>);
    }
  }

  /* Ajout de contacts à un service par capture d'écran (tuiles). */
  openServiceEnrich(v: ServiceRef) {
    this.enrichService.set(v);
  }
  onServiceEnrichClosed(res: { added: number }) {
    this.enrichService.set(null);
    if (res.added > 0) this.fetch();   // le dialogue a déjà rafraîchi les listes complètes
  }

  // Commun
  toggleActif(v: RefRow) {
    this.patch(v.id, { actif: v.actif ? 0 : 1 });
  }

  delete(v: RefRow) {
    const label = (v as ContactRef).nom ?? (v as SimpleRef).libelle;
    if (!confirm(`Supprimer "${label}" ? Les enregistrements qui y font référence verront cette caractéristique vidée.`)) return;
    this.refs.delete(this.current(), v.id).subscribe({
      next: () => this.afterMutation(),
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
      case 'contactFonction':     this.newContactFonction.set(v); break;
    }
  }

  trackById = (_: number, v: RefRow) => v.id;
}
