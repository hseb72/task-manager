import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TacheService } from '../../services/tache.service';
import { RefsService } from '../../services/refs.service';
import { TransferService } from '../../services/transfer.service';
import { SplitButtonComponent, SplitButtonAction } from '../../components/split-button/split-button.component';
import { RichEditorComponent } from '../../components/rich-editor/rich-editor.component';
import { OcrImportDialogComponent } from '../../components/ocr-import-dialog/ocr-import-dialog.component';
import { Tache, Action, ContactRef, TacheContact } from '../../models/models';

@Component({
  selector: 'app-taches-page',
  standalone: true,
  imports: [CommonModule, FormsModule, SplitButtonComponent, RichEditorComponent, OcrImportDialogComponent],
  templateUrl: './taches-page.component.html',
  styleUrl: './taches-page.component.css',
})
export class TachesPageComponent implements OnInit {
  private tacheSrv = inject(TacheService);
  private transferSrv = inject(TransferService);
  refs = inject(RefsService);

  /* ====================================================================== */
  /*  Import / Export                                                        */
  /* ====================================================================== */

  importing = signal(false);
  importMessage = signal<string | null>(null);

  /** Pour communiquer entre le split-button et l'input file. */
  private pendingImportMode: 'replace' | 'merge' | null = null;

  readonly transferActions: SplitButtonAction[] = [
    { id: 'export',  label: '↓ Exporter',  title: 'Exporter toute la base au format .json.gz' },
    { id: 'replace', label: '↑ Remplacer', title: 'Importer un fichier en remplaçant toute la base', danger: true },
    { id: 'merge',   label: '↑ Fusionner', title: 'Importer un fichier en fusionnant (mise à jour des existants)' },
  ];

  /** Routeur des actions du split-button. */
  onTransferAction(actionId: string, fileInput: HTMLInputElement) {
    if (this.importing()) return;
    if (actionId === 'export') {
      this.transferSrv.downloadExport();
      return;
    }
    if (actionId === 'replace' || actionId === 'merge') {
      this.pendingImportMode = actionId;
      fileInput.value = '';   // permet de re-sélectionner le même fichier
      fileInput.click();
    }
  }

  onFileSelected(ev: Event) {
    const input = ev.target as HTMLInputElement;
    const file = input.files?.[0];
    const mode = this.pendingImportMode;
    this.pendingImportMode = null;

    if (!file || !mode) {
      input.value = '';
      return;
    }

    if (mode === 'replace') {
      if (!confirm(`Remplacer toute la base par le contenu de "${file.name}" ?\nCette action est irréversible.`)) {
        input.value = '';
        return;
      }
    }

    this.runImport(file, mode);
    input.value = '';
  }

  private runImport(file: File, mode: 'replace' | 'merge') {
    this.importing.set(true);
    this.importMessage.set(null);
    this.transferSrv.importFile(file, mode).subscribe({
      next: r => {
        const total = Object.values(r.counts).reduce((a, b) => a + b, 0);
        this.importMessage.set(
          `Import ${mode === 'replace' ? '(remplacement)' : '(fusion)'} réussi : ${total} ligne(s) importée(s).`
        );
        this.importing.set(false);
        this.reload();
        this.refs.loadAll().subscribe();
      },
      error: err => {
        this.importMessage.set('Échec de l\'import : ' + (err?.error?.error ?? err.message));
        this.importing.set(false);
      },
    });
  }

  taches = signal<Tache[]>([]);
  loading = signal(true);
  error = signal<string | null>(null);

  selected = signal<Tache | null>(null);
  filterText = signal('');

  /** Affichage du dialogue d'import OCR. */
  showOcrDialog = signal(false);

  openOcrDialog() { this.showOcrDialog.set(true); }
  onOcrDialogClosed(ev: { created: boolean; tacheId?: number }) {
    this.showOcrDialog.set(false);
    if (ev.created) {
      // Recharge la liste pour faire apparaître la nouvelle tâche
      this.reload();
      this.refs.loadAll().subscribe();
    }
  }

  /** Sélecteur du contact à ajouter dans le panneau de détails. */
  contactToAdd = signal<number | null>(null);

  /* ====================================================================== */
  /*  Tri                                                                    */
  /* ====================================================================== */

  /** Clé de tri courante (champ de Tache utilisé). null = pas de tri. */
  sortKey = signal<string | null>('id');
  sortDir = signal<'asc' | 'desc'>('desc');

  /** Liste des colonnes triables et fonction d'extraction de la valeur. */
  private readonly SORTERS: Record<string, (t: Tache) => unknown> = {
    id:               t => t.id,
    libelle:          t => (t.libelle ?? '').toLowerCase(),
    etatLibelle:      t => (t.etatLibelle ?? '').toLowerCase(),
    intervenantNom:   t => (t.intervenantNom ?? '').toLowerCase(),
    serviceLibelle:   t => (t.serviceLibelle ?? '').toLowerCase(),
    entiteLibelle:    t => (t.entiteLibelle ?? '').toLowerCase(),
    domaineLibelle:   t => (t.domaineLibelle ?? '').toLowerCase(),
    dateDeclaration:  t => t.dateDeclaration ?? '',
    dateEcheance:     t => t.dateEcheance ?? '',
    dateFin:          t => t.dateFin ?? '',
    dureePrevue:      t => t.dureePrevue ?? -Infinity,
    dureeAccomplie:   t => t.dureeAccomplie ?? -Infinity,
  };

  toggleSort(key: string) {
    if (this.sortKey() === key) {
      this.sortDir.set(this.sortDir() === 'asc' ? 'desc' : 'asc');
    } else {
      this.sortKey.set(key);
      this.sortDir.set('asc');
    }
    this.currentPage.set(1);
  }

  sortIcon(key: string): string {
    if (this.sortKey() !== key) return '';
    return this.sortDir() === 'asc' ? ' ↑' : ' ↓';
  }

  /* ====================================================================== */
  /*  Pagination                                                             */
  /* ====================================================================== */

  /** -1 signifie "tout afficher". */
  pageSize     = signal<number>(10);
  currentPage  = signal<number>(1);
  pageOptions  = [5, 10, 20, 50, -1];

  setPageSize(size: number) {
    this.pageSize.set(size);
    this.currentPage.set(1);
  }

  goToPage(p: number) {
    const max = this.pageCount();
    this.currentPage.set(Math.max(1, Math.min(p, max)));
  }
  prevPage() { this.goToPage(this.currentPage() - 1); }
  nextPage() { this.goToPage(this.currentPage() + 1); }
  firstPage() { this.goToPage(1); }
  lastPage() { this.goToPage(this.pageCount()); }

  /* ====================================================================== */
  /*  Pipeline filtre → tri → pagination                                     */
  /* ====================================================================== */

  filtered = computed(() => {
    const q = this.filterText().toLowerCase().trim();
    if (!q) return this.taches();
    return this.taches().filter(t =>
      (t.libelle ?? '').toLowerCase().includes(q) ||
      (t.description ?? '').toLowerCase().includes(q) ||
      (t.intervenantNom ?? '').toLowerCase().includes(q) ||
      (t.serviceLibelle ?? '').toLowerCase().includes(q) ||
      (t.entiteLibelle ?? '').toLowerCase().includes(q) ||
      (t.etatLibelle ?? '').toLowerCase().includes(q) ||
      String(t.id).includes(q)
    );
  });

  /* ====================================================================== */
  /*  Filtres par colonne                                                    */
  /* ====================================================================== */

  /** Une entrée par colonne filtrable. Toutes optionnelles. */
  columnFilters = signal<{
    id?: string;
    libelle?: string;
    etatId?: number | null;
    intervenantId?: number | null;
    serviceId?: number | null;
    entiteId?: number | null;
    domaineId?: number | null;
    dateDeclaration?: string;
    dateEcheance?:    string;
    dateFin?:         string;
    dureePrevue?:    number | null;
    dureeAccomplie?: number | null;
  }>({});

  setColumnFilter<K extends keyof ReturnType<typeof this.columnFilters>>(
    key: K, value: ReturnType<typeof this.columnFilters>[K]
  ) {
    this.columnFilters.set({ ...this.columnFilters(), [key]: value });
    this.currentPage.set(1);
  }

  resetColumnFilters() {
    this.columnFilters.set({});
    this.currentPage.set(1);
  }

  /** Réinitialise filtres de colonnes ET recherche globale. */
  resetAllFilters() {
    this.columnFilters.set({});
    this.filterText.set('');
    this.currentPage.set(1);
  }

  hasColumnFilters = computed(() => {
    const f = this.columnFilters();
    return Object.values(f).some(v => v !== undefined && v !== null && v !== '');
  });

  /** Application des filtres de colonnes après le filtre global. */
  columnFiltered = computed(() => {
    const f = this.columnFilters();
    const lc = (s: string | null | undefined) => (s ?? '').toString().toLowerCase();

    return this.filtered().filter(t => {
      // Texte
      if (f.id        && !String(t.id).includes(f.id))                      return false;
      if (f.libelle   && !lc(t.libelle).includes(f.libelle.toLowerCase()))  return false;

      // Listes (égalité d'ID)
      // Listes (égalité d'ID)
      if (f.etatId        != null && t.etatId        !== f.etatId)        return false;
      if (f.intervenantId != null && t.intervenantId !== f.intervenantId) return false;
      if (f.serviceId     != null && t.serviceId     !== f.serviceId)     return false;
      if (f.entiteId      != null && t.entiteId      !== f.entiteId)      return false;
      if (f.domaineId     != null && t.domaineId     !== f.domaineId)     return false;

      // Plages de dates : on compare en string ISO 'YYYY-MM-DD' (10 premiers caractères)
      const dDecl = (t.dateDeclaration ?? '').slice(0, 10);
      if (f.dateDeclaration && dDecl !== f.dateDeclaration) return false;
      const dEch = (t.dateEcheance ?? '').slice(0, 10);
      if (f.dateEcheance && dEch !== f.dateEcheance) return false;
      const dFin = (t.dateFin ?? '').slice(0, 10);
      if (f.dateFin && dFin !== f.dateFin) return false;

      // Durées : égalité exacte
      if (f.dureePrevue    != null && t.dureePrevue    !== f.dureePrevue)    return false;
      if (f.dureeAccomplie != null && t.dureeAccomplie !== f.dureeAccomplie) return false;

      return true;
    });
  });

  sorted = computed(() => {
    const key = this.sortKey();
    const dir = this.sortDir();
    const arr = [...this.columnFiltered()];
    if (!key || !this.SORTERS[key]) return arr;
    const get = this.SORTERS[key];
    arr.sort((a, b) => {
      const va = get(a), vb = get(b);
      if (va == null && vb == null) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;
      if (va < vb) return dir === 'asc' ? -1 : 1;
      if (va > vb) return dir === 'asc' ?  1 : -1;
      return 0;
    });
    return arr;
  });

  pageCount = computed(() => {
    const size = this.pageSize();
    if (size === -1) return 1;
    return Math.max(1, Math.ceil(this.sorted().length / size));
  });

  paginated = computed(() => {
    const size = this.pageSize();
    if (size === -1) return this.sorted();
    const total = this.pageCount();
    const page = Math.min(this.currentPage(), total); // clamp défensif
    const start = (page - 1) * size;
    return this.sorted().slice(start, start + size);
  });

  /** Numéros de pages à afficher (avec ellipses sous forme de 0). */
  pageNumbers = computed<number[]>(() => {
    const total = this.pageCount();
    const cur   = this.currentPage();
    if (total <= 7) {
      return Array.from({ length: total }, (_, i) => i + 1);
    }
    // Affiche : 1 … cur-1 cur cur+1 … total
    const pages = new Set<number>([1, total, cur, cur - 1, cur + 1, 2, total - 1]);
    const sorted = [...pages].filter(p => p >= 1 && p <= total).sort((a, b) => a - b);
    const result: number[] = [];
    for (let i = 0; i < sorted.length; i++) {
      result.push(sorted[i]!);
      const next = sorted[i + 1];
      if (next !== undefined && next - sorted[i]! > 1) result.push(0); // 0 = ellipse
    }
    return result;
  });

  rangeLabel = computed(() => {
    const total = this.sorted().length;
    if (total === 0) return '0';
    const size = this.pageSize();
    if (size === -1) return `1–${total} sur ${total}`;
    const start = (this.currentPage() - 1) * size + 1;
    const end = Math.min(start + size - 1, total);
    return `${start}–${end} sur ${total}`;
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

  /**
   * Normalise une valeur de date en chaîne ISO 'YYYY-MM-DD' acceptée
   * par <input type="date">. Renvoie '' si la valeur est null ou invalide.
   * Gère les formats 'YYYY-MM-DD', 'YYYY-MM-DD HH:MM:SS', 'YYYY-MM-DDTHH:MM:SS', etc.
   */
  toIsoDate(v: string | Date | null | undefined): string {
    if (!v) return '';
    if (v instanceof Date) {
      if (isNaN(v.getTime())) return '';
      return v.toISOString().slice(0, 10);
    }
    const s = String(v).trim();
    if (!s) return '';
    // Cas le plus courant : déjà 'YYYY-MM-DD' (10 caractères) ou commence par cette forme
    const m = s.match(/^(\d{4}-\d{2}-\d{2})/);
    if (m) return m[1]!;
    // Tentative parse
    const d = new Date(s);
    if (isNaN(d.getTime())) return '';
    return d.toISOString().slice(0, 10);
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
  /** Variante appelée par (ngModelChange) — la valeur est déjà typée, pas besoin d'extraire. */
  onTacheRefModel(tache: Tache, field: keyof Tache, value: number | null) {
    this.applyTachePatch(tache, field, value);
  }
  onTacheDescription(tache: Tache, ev: Event) {
    this.applyTachePatch(tache, 'description', this.valOrNull(ev));
  }
  /** Variante appelée par le RichEditor — la valeur est déjà un HTML. */
  onTacheDescriptionRich(tache: Tache, html: string) {
    this.applyTachePatch(tache, 'description', html === '' ? null : html);
  }

  private applyTachePatch(tache: Tache, field: keyof Tache, value: unknown) {
    // Sauvegarde de l'ancienne valeur pour rollback éventuel
    const previous = (tache as any)[field];

    // Mise à jour optimiste : on remplace l'objet dans le signal pour
    // forcer la détection de changement et la re-synchro des selects.
    const updateLocally = (patch: Partial<Tache>) => {
      const arr = this.taches().map(x =>
        x.id === tache.id ? { ...x, ...patch } : x
      );
      this.taches.set(arr);
      // Si la tâche est ouverte dans le panneau de détails, le rafraîchir aussi
      if (this.selected()?.id === tache.id) {
        this.selected.set({ ...this.selected()!, ...patch });
      }
    };

    updateLocally({ [field]: value } as Partial<Tache>);

    const patch: Partial<Tache> = { [field]: value } as Partial<Tache>;
    this.tacheSrv.update(tache.id, patch).subscribe({
      next: updated => {
        // On remplace par la version serveur (libellés joints à jour, etc.)
        const arr = this.taches().map(x => (x.id === tache.id ? { ...x, ...updated } : x));
        this.taches.set(arr);
        if (this.selected()?.id === tache.id) {
          this.selected.set({ ...this.selected()!, ...updated });
        }
      },
      error: err => {
        console.error('Mise à jour échouée', err);
        // Rollback de la valeur affichée
        updateLocally({ [field]: previous } as Partial<Tache>);
      },
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
    this.applyActionPatch(a, field, this.valOrNull(ev));
  }
  /** Variante ngModel pour les champs typés (date, etc.). */
  onActionFieldModel(a: Action, field: keyof Action, value: unknown) {
    this.applyActionPatch(a, field, value === '' ? null : value);
  }
  /** Variante pour le RichEditor : reçoit directement le HTML. */
  onActionFieldRich(a: Action, field: keyof Action, html: string) {
    this.applyActionPatch(a, field, html === '' ? null : html);
  }

  private applyActionPatch(a: Action, field: keyof Action, value: unknown) {
    const t = this.selected();
    if (!t) return;
    const previous = (a as any)[field];

    // Mise à jour optimiste dans le signal
    const updateLocally = (patch: Partial<Action>) => {
      const list = (t.actions ?? []).map(x =>
        x.id === a.id ? { ...x, ...patch } : x
      );
      this.selected.set({ ...t, actions: list });
    };
    updateLocally({ [field]: value } as Partial<Action>);

    // Construire le payload envoyé au backend (toujours les 3 champs nécessaires)
    const updated = { ...a, [field]: value } as Action;
    this.tacheSrv.updateAction(t.id, a.id, {
      date_action: updated.date_action,
      libelle: updated.libelle ?? '',
      description: updated.description,
    }).subscribe({
      next: server => {
        const list = (this.selected()?.actions ?? []).map(x =>
          x.id === a.id ? { ...x, ...server } : x
        );
        this.selected.set({ ...this.selected()!, actions: list });
      },
      error: err => {
        console.error('Mise à jour de l\'action échouée', err);
        updateLocally({ [field]: previous } as Partial<Action>);
      },
    });
  }

  deleteAction(a: Action) {
    const t = this.selected();
    if (!t || !confirm('Supprimer cette action ?')) return;
    this.tacheSrv.deleteAction(t.id, a.id).subscribe(() => {
      this.selected.set({ ...t, actions: (t.actions ?? []).filter(x => x.id !== a.id) });
    });
  }

  /* ====================================================================== */
  /*  Contacts associés (référentiel) + rôle porté par la liaison            */
  /* ====================================================================== */

  /** Rôle à attribuer à la prochaine liaison (signal pour le sélecteur). */
  contactToAddRoleId = signal<number | null>(null);

  linkContact() {
    const t = this.selected();
    const cid = this.contactToAdd();
    if (!t || !cid) return;
    const rid = this.contactToAddRoleId();
    this.tacheSrv.linkContact(t.id, cid, rid).subscribe(list => {
      this.selected.set({ ...t, contacts: list });
      this.contactToAdd.set(null);
      this.contactToAddRoleId.set(null);
    });
  }

  /** Modifie le rôle d'un contact déjà lié. */
  setLinkRole(c: TacheContact, roleId: number | null) {
    const t = this.selected();
    if (!t) return;
    // Mise à jour optimiste
    const arr = (t.contacts ?? []).map(x =>
      x.id === c.id ? { ...x, role_id: roleId } : x
    );
    this.selected.set({ ...t, contacts: arr });
    this.tacheSrv.updateContactRole(t.id, c.id, roleId).subscribe({
      next: list => this.selected.set({ ...t, contacts: list }),
      error: err => console.error('Mise à jour du rôle échouée', err),
    });
  }

  unlinkContact(c: TacheContact) {
    const t = this.selected();
    if (!t) return;
    this.tacheSrv.unlinkContact(t.id, c.id).subscribe(() => {
      this.selected.set({ ...t, contacts: (t.contacts ?? []).filter(x => x.id !== c.id) });
    });
  }

  trackById = (_: number, x: { id: number }) => x.id;
}
