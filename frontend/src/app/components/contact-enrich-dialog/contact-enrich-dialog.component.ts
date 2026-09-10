import {
  Component, EventEmitter, Input, Output, inject, signal,
  ChangeDetectionStrategy, HostListener,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { OcrService } from '../../services/ocr.service';
import { RefsService } from '../../services/refs.service';
import { ContactRef, ServiceRef, SimpleRef } from '../../models/models';

@Component({
  selector: 'app-contact-enrich-dialog',
  standalone: true,
  imports: [CommonModule, FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './contact-enrich-dialog.component.html',
  styleUrl: './contact-enrich-dialog.component.css',
})
export class ContactEnrichDialogComponent {
  private ocrSrv = inject(OcrService);
  refs = inject(RefsService);

  @Input() contact!: ContactRef;
  @Output() closed = new EventEmitter<{ serviceId?: number }>();

  step = signal<'upload' | 'analyzing' | 'review' | 'error'>('upload');
  errorMsg = signal<string | null>(null);
  imagePreview = signal<string | null>(null);
  rawText = signal<string>('');
  showRaw = signal(false);

  /** Textes bruts détectés. */
  serviceText = signal<string | null>(null);
  entiteText = signal<string | null>(null);
  /** Rapprochements / sélections dans les référentiels. */
  serviceId = signal<number | null>(null);
  entiteId = signal<number | null>(null);
  entiteMatch = signal<SimpleRef | null>(null);

  /** Création à la volée de référentiels. */
  creating = signal(false);
  createError = signal<string | null>(null);

  ocrProgress = this.ocrSrv.progress;
  ocrStatus = this.ocrSrv.status;

  /**
   * Libellés qui précèdent la valeur du SERVICE, par ordre de priorité
   * (le plus spécifique d'abord). La valeur est soit sur la même ligne après
   * « : », soit sur la ligne suivante.
   */
  private static readonly SERVICE_LABELS = [
    'unite d affectation principale', 'unite d affectation', 'affectation',
    'service', 'departement', 'equipe', 'pole', 'division', 'cellule', 'bureau', 'unite',
  ];
  /** Libellés qui précèdent la valeur de l'ENTITÉ (métier). « métier » en premier. */
  private static readonly ENTITE_LABELS = [
    'metier', 'entite de rattachement', 'direction', 'entite', 'societe', 'etablissement', 'filiale',
  ];
  /** Libellés à ne jamais retenir pour l'entité (p. ex. « Entité juridique »). */
  private static readonly ENTITE_EXCLUDE = ['juridique'];

  /* ------------------------------------------------------------------ */
  /*  Réception de l'image                                               */
  /* ------------------------------------------------------------------ */

  async onFileSelected(ev: Event) {
    const file = (ev.target as HTMLInputElement).files?.[0];
    if (file) await this.process(file);
  }
  onImageDrop(ev: DragEvent) {
    ev.preventDefault();
    const file = ev.dataTransfer?.files?.[0];
    if (file && file.type.startsWith('image/')) this.process(file);
  }
  onDragOver(ev: DragEvent) { ev.preventDefault(); }

  @HostListener('document:paste', ['$event'])
  onPaste(ev: ClipboardEvent) {
    const items = ev.clipboardData?.items;
    if (!items) return;
    for (const item of Array.from(items)) {
      if (item.type.startsWith('image/')) {
        const file = item.getAsFile();
        if (file) { ev.preventDefault(); this.process(file); return; }
      }
    }
  }

  private async process(file: File) {
    this.errorMsg.set(null);
    this.step.set('analyzing');
    const reader = new FileReader();
    reader.onload = e => this.imagePreview.set(String(e.target?.result ?? ''));
    reader.readAsDataURL(file);

    try {
      const ocr = await this.ocrSrv.recognize(file);
      this.rawText.set(ocr.text ?? '');
      this.deduce(ocr.lines.map(l => l.text));
      this.step.set('review');
    } catch (err: any) {
      console.error('OCR échec', err);
      this.errorMsg.set('Échec de l\'analyse : ' + (err?.message ?? err));
      this.step.set('error');
    }
  }

  /* ------------------------------------------------------------------ */
  /*  Déduction service / entité                                         */
  /* ------------------------------------------------------------------ */

  private deduce(lines: string[]) {
    const svc = this.findValue(lines, ContactEnrichDialogComponent.SERVICE_LABELS, []);
    const ent = this.findValue(lines, ContactEnrichDialogComponent.ENTITE_LABELS,
      ContactEnrichDialogComponent.ENTITE_EXCLUDE);
    this.serviceText.set(svc);
    this.entiteText.set(ent);

    const entiteMatch = ent ? this.bestMatch(this.refs.entites(), ent) as SimpleRef | null : null;
    this.entiteMatch.set(entiteMatch);
    this.entiteId.set(entiteMatch?.id ?? null);

    let serviceMatch = svc ? this.bestMatch(this.refs.services(), svc) as ServiceRef | null : null;
    // Si l'entité est connue, on privilégie un service rattaché à cette entité.
    if (svc && entiteMatch) {
      const within = this.refs.services().filter(s => s.entite_id === entiteMatch.id);
      const refined = this.bestMatch(within, svc) as ServiceRef | null;
      if (refined) serviceMatch = refined;
    }
    this.serviceId.set(serviceMatch?.id ?? null);
  }

  /* ------------------------------------------------------------------ */
  /*  Création à la volée (entité / service)                             */
  /* ------------------------------------------------------------------ */

  /** Le texte détecté ne correspond à aucune entité existante ? */
  canCreateEntite(): boolean {
    const t = (this.entiteText() ?? '').trim();
    if (!t) return false;
    const n = this.normalize(t);
    return !this.refs.entites().some(e => this.normalize(e.libelle) === n);
  }
  /** Le texte détecté ne correspond à aucun service existant ? */
  canCreateService(): boolean {
    const t = (this.serviceText() ?? '').trim();
    if (!t) return false;
    const n = this.normalize(t);
    return !this.refs.services().some(s => this.normalize(s.libelle) === n);
  }

  createEntite() {
    const libelle = (this.entiteText() ?? '').trim();
    if (!libelle) return;
    this.creating.set(true);
    this.createError.set(null);
    this.refs.create('entites', { libelle } as any).subscribe({
      next: (row: any) => this.refs.loadAll().subscribe(() => {
        this.entiteId.set(row.id);
        this.creating.set(false);
      }),
      error: err => { this.createError.set(err?.error?.error ?? err.message ?? 'Erreur'); this.creating.set(false); },
    });
  }

  createService() {
    const libelle = (this.serviceText() ?? '').trim();
    if (!libelle) return;
    this.creating.set(true);
    this.createError.set(null);
    this.refs.create('services', { libelle, entite_id: this.entiteId() } as any).subscribe({
      next: (row: any) => this.refs.loadAll().subscribe(() => {
        this.serviceId.set(row.id);
        this.creating.set(false);
      }),
      error: err => { this.createError.set(err?.error?.error ?? err.message ?? 'Erreur'); this.creating.set(false); },
    });
  }

  /**
   * Cherche la valeur associée à l'un des libellés (par ordre de priorité).
   * La valeur est prise après « : » sur la même ligne, sinon sur la première
   * ligne suivante qui n'est pas elle-même un libellé.
   */
  private findValue(lines: string[], labels: string[], exclude: string[]): string | null {
    const norms = lines.map(l => this.normalize(l ?? ''));
    for (const label of labels) {
      for (let i = 0; i < lines.length; i++) {
        const norm = norms[i]!;
        if (!norm) continue;
        if (exclude.some(x => norm.includes(x))) continue;
        if (!norm.includes(label)) continue;

        // Valeur sur la même ligne, après « : »
        const raw = (lines[i] ?? '').trim();
        const inline = raw.match(/[:：]\s*(.+)$/);
        if (inline && inline[1]!.trim()) return inline[1]!.trim();

        // Sinon : première ligne suivante non vide qui n'est pas un libellé
        for (let j = i + 1; j < lines.length; j++) {
          const nxt = (lines[j] ?? '').trim();
          if (!nxt) continue;
          if (/[:：]\s*$/.test(nxt)) break;          // ligne = libellé sans valeur → on arrête
          if (this.looksLikeLabel(norms[j]!)) break;  // ligne = autre libellé connu → on arrête
          return nxt;
        }
      }
    }
    return null;
  }

  /**
   * La ligne est-elle *elle-même* un libellé connu (et non une valeur qui
   * contient un mot de libellé, ex. « Direction des Systèmes d'Information ») ?
   * On exige une égalité exacte après normalisation (le « : » final est déjà
   * traité à part).
   */
  private looksLikeLabel(norm: string): boolean {
    const all = [
      ...ContactEnrichDialogComponent.SERVICE_LABELS,
      ...ContactEnrichDialogComponent.ENTITE_LABELS,
    ];
    return all.some(l => norm === l);
  }

  private bestMatch<T extends { libelle: string }>(rows: T[], text: string): T | null {
    const t = this.normalize(text);
    if (!t) return null;
    let hit = rows.find(r => this.normalize(r.libelle) === t);
    if (hit) return hit;
    let best: T | null = null;
    for (const r of rows) {
      const f = this.normalize(r.libelle);
      if (!f) continue;
      if (t.includes(f) || f.includes(t)) {
        if (!best || f.length > this.normalize(best.libelle).length) best = r;
      }
    }
    return best;
  }

  private normalize(s: string): string {
    return String(s ?? '')
      .toLowerCase()
      .normalize('NFD').replace(/[̀-ͯ]/g, '')   // retire les accents
      .replace(/[^a-z0-9]+/g, ' ')               // ponctuation/apostrophes → espace
      .replace(/\s+/g, ' ')
      .trim();
  }

  /* ------------------------------------------------------------------ */
  /*  Actions                                                            */
  /* ------------------------------------------------------------------ */

  /** Entité affichée : celle du service choisi (dérivée), sinon l'entité détectée. */
  selectedServiceEntite(): string | null {
    const s = this.refs.services().find(x => x.id === this.serviceId());
    const ent = this.refs.entites().find(e => e.id === this.entiteId());
    return s?.entite_libelle ?? ent?.libelle ?? this.entiteMatch()?.libelle ?? null;
  }

  apply() {
    this.closed.emit({ serviceId: this.serviceId() ?? undefined });
  }
  reset() {
    this.step.set('upload');
    this.errorMsg.set(null);
    this.imagePreview.set(null);
    this.rawText.set('');
    this.serviceText.set(null);
    this.entiteText.set(null);
    this.serviceId.set(null);
    this.entiteId.set(null);
    this.entiteMatch.set(null);
    this.creating.set(false);
    this.createError.set(null);
  }
  cancel() { this.closed.emit({}); }

  v(ev: Event): string {
    return (ev.target as HTMLSelectElement).value;
  }
}
