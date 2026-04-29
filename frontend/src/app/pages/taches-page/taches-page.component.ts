import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TacheService } from '../../services/tache.service';
import { RefsService } from '../../services/refs.service';
import { Tache, Action, ContactRef } from '../../models/models';

@Component({
  selector: 'app-taches-page',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './taches-page.component.html',
  styleUrl: './taches-page.component.css',
})
export class TachesPageComponent implements OnInit {
  private tacheSrv = inject(TacheService);
  refs = inject(RefsService);

  taches = signal<Tache[]>([]);
  loading = signal(true);
  error = signal<string | null>(null);

  selected = signal<Tache | null>(null);
  filterText = signal('');

  /** Sélecteur du contact à ajouter dans le panneau de détails. */
  contactToAdd = signal<number | null>(null);

  filtered = computed(() => {
    const q = this.filterText().toLowerCase().trim();
    if (!q) return this.taches();
    return this.taches().filter(t =>
      (t.libelle ?? '').toLowerCase().includes(q) ||
      (t.description ?? '').toLowerCase().includes(q) ||
      (t.demandeurNom ?? '').toLowerCase().includes(q) ||
      (t.demandeurService ?? '').toLowerCase().includes(q) ||
      (t.demandeurEntite ?? '').toLowerCase().includes(q) ||
      (t.etatLibelle ?? '').toLowerCase().includes(q) ||
      String(t.id).includes(q)
    );
  });

  /** Contacts encore disponibles pour être ajoutés à la tâche en cours. */
  availableContacts = computed<ContactRef[]>(() => {
    const t = this.selected();
    const linkedIds = new Set((t?.contacts ?? []).map(c => c.id));
    return this.refs.contacts().filter(c => !linkedIds.has(c.id) && c.actif);
  });

  ngOnInit() {
    this.reload();
  }

  reload() {
    this.loading.set(true);
    this.error.set(null);
    this.tacheSrv.list().subscribe({
      next: list => { this.taches.set(list); this.loading.set(false); },
      error: err => { this.error.set(err.message ?? 'Erreur'); this.loading.set(false); },
    });
  }

  /* ====================================================================== */
  /*  Helpers d'extraction des valeurs depuis les events                     */
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

  /* ====================================================================== */
  /*  Mises à jour TACHE                                                     */
  /* ====================================================================== */

  onTacheText(tache: Tache, field: keyof Tache, ev: Event) {
    this.applyTachePatch(tache, field, this.valOrNull(ev));
  }
  onTacheNumber(tache: Tache, field: keyof Tache, ev: Event) {
    this.applyTachePatch(tache, field, this.numOrNull(ev));
  }
  onTacheRef(tache: Tache, field: keyof Tache, ev: Event) {
    this.applyTachePatch(tache, field, this.numOrNull(ev));
  }
  onTacheDescription(tache: Tache, ev: Event) {
    const v = this.valOrNull(ev);
    this.applyTachePatch(tache, 'description', v);
    if (this.selected()?.id === tache.id) {
      this.selected.set({ ...this.selected()!, description: v });
    }
  }

  private applyTachePatch(tache: Tache, field: keyof Tache, value: unknown) {
    (tache as any)[field] = value;
    const patch: Partial<Tache> = { [field]: value } as Partial<Tache>;
    this.tacheSrv.update(tache.id, patch).subscribe({
      next: updated => {
        const idx = this.taches().findIndex(x => x.id === tache.id);
        if (idx >= 0) {
          const arr = [...this.taches()];
          arr[idx] = { ...arr[idx], ...updated };
          this.taches.set(arr);
        }
      },
      error: err => console.error('Mise à jour échouée', err),
    });
  }

  /* ====================================================================== */
  /*  Création / suppression / détails de tâche                              */
  /* ====================================================================== */

  createNew() {
    this.tacheSrv.create({
      libelle: 'Nouvelle tâche',
      dateDeclaration: new Date().toISOString().slice(0, 10),
    }).subscribe(t => {
      this.taches.set([t, ...this.taches()]);
    });
  }

  delete(t: Tache, ev: Event) {
    ev.stopPropagation();
    if (!confirm(`Supprimer la tâche "${t.libelle}" ?`)) return;
    this.tacheSrv.delete(t.id).subscribe(() => {
      this.taches.set(this.taches().filter(x => x.id !== t.id));
    });
  }

  openDetails(t: Tache) {
    this.tacheSrv.get(t.id).subscribe(full => {
      this.selected.set(full);
      this.contactToAdd.set(null);
    });
  }
  closeDetails() {
    this.selected.set(null);
    this.contactToAdd.set(null);
  }

  /* ====================================================================== */
  /*  Actions menées                                                         */
  /* ====================================================================== */

  addAction() {
    const t = this.selected();
    if (!t) return;
    this.tacheSrv.addAction(t.id, {
      libelle: 'Nouvelle action',
      date_action: new Date().toISOString().slice(0, 10),
    }).subscribe(a => {
      this.selected.set({ ...t, actions: [a, ...(t.actions ?? [])] });
    });
  }

  onActionField(a: Action, field: keyof Action, ev: Event) {
    const v = this.valOrNull(ev);
    (a as any)[field] = v;
    const t = this.selected();
    if (!t) return;
    this.tacheSrv.updateAction(t.id, a.id, {
      date_action: a.date_action,
      libelle: a.libelle ?? '',
      description: a.description,
    }).subscribe();
  }

  deleteAction(a: Action) {
    const t = this.selected();
    if (!t || !confirm('Supprimer cette action ?')) return;
    this.tacheSrv.deleteAction(t.id, a.id).subscribe(() => {
      this.selected.set({ ...t, actions: (t.actions ?? []).filter(x => x.id !== a.id) });
    });
  }

  /* ====================================================================== */
  /*  Contacts associés (référentiel)                                        */
  /* ====================================================================== */

  onContactToAddChange(ev: Event) {
    this.contactToAdd.set(this.numOrNull(ev));
  }

  linkContact() {
    const t = this.selected();
    const cid = this.contactToAdd();
    if (!t || !cid) return;
    this.tacheSrv.linkContact(t.id, cid).subscribe(list => {
      this.selected.set({ ...t, contacts: list });
      this.contactToAdd.set(null);
    });
  }

  unlinkContact(c: ContactRef) {
    const t = this.selected();
    if (!t) return;
    this.tacheSrv.unlinkContact(t.id, c.id).subscribe(() => {
      this.selected.set({ ...t, contacts: (t.contacts ?? []).filter(x => x.id !== c.id) });
    });
  }

  trackById = (_: number, x: { id: number }) => x.id;
}