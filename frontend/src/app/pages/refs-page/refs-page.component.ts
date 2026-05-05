import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink, RouterLinkActive } from '@angular/router';
import { RefsService } from '../../services/refs.service';
import {
  RefRow, ReferenceTableMeta,
  SimpleRef, ServiceRef, ContactRef, RefKind,
} from '../../models/models';

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

  meta = computed<ReferenceTableMeta | undefined>(() =>
    this.refs.tables().find(t => t.name === this.current())
  );
  kind = computed<RefKind>(() => this.meta()?.kind ?? 'simple');
  currentLabel = computed(() => this.meta()?.label ?? this.current());

  // Vues typées du tableau (selon le kind)
  asSimple   = computed<SimpleRef[]>(()  => this.values() as SimpleRef[]);
  asServices = computed<ServiceRef[]>(() => this.values() as ServiceRef[]);
  asContacts = computed<ContactRef[]>(() => this.values() as ContactRef[]);

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
    }
  }

  trackById = (_: number, v: RefRow) => v.id;
}
