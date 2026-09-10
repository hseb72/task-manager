import {
  Component, EventEmitter, Input, Output, inject, signal,
  ChangeDetectionStrategy, HostListener,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { OcrService } from '../../services/ocr.service';
import { RefsService } from '../../services/refs.service';
import { ContactRef, ServiceRef, SimpleRef } from '../../models/models';

/** Paire « libellé : valeur » extraite du texte OCR. */
interface Pair { key: string; value: string; }

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
  /** Rapprochements avec les référentiels. */
  serviceId = signal<number | null>(null);
  entiteMatch = signal<SimpleRef | null>(null);

  ocrProgress = this.ocrSrv.progress;
  ocrStatus = this.ocrSrv.status;

  private static readonly SERVICE_KEYS = [
    'service', 'departement', 'dept', 'equipe', 'team', 'unite', 'pole',
    'division', 'cellule', 'bureau', 'affectation',
  ];
  private static readonly ENTITE_KEYS = [
    'entite', 'entity', 'direction', 'societe', 'company', 'organisation',
    'organization', 'etablissement', 'filiale', 'site', 'bu', 'business unit',
  ];

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
    const pairs = this.buildPairs(lines);
    const svc = this.pickByKeys(pairs, ContactEnrichDialogComponent.SERVICE_KEYS);
    const ent = this.pickByKeys(pairs, ContactEnrichDialogComponent.ENTITE_KEYS);
    this.serviceText.set(svc);
    this.entiteText.set(ent);

    const entiteMatch = ent ? this.bestMatch(this.refs.entites(), ent) as SimpleRef | null : null;
    this.entiteMatch.set(entiteMatch);

    let serviceMatch = svc ? this.bestMatch(this.refs.services(), svc) as ServiceRef | null : null;
    // Si l'entité est connue, on privilégie un service rattaché à cette entité.
    if (svc && entiteMatch) {
      const within = this.refs.services().filter(s => s.entite_id === entiteMatch.id);
      const refined = this.bestMatch(within, svc) as ServiceRef | null;
      if (refined) serviceMatch = refined;
    }
    this.serviceId.set(serviceMatch?.id ?? null);
  }

  /** Construit des paires libellé/valeur à partir des lignes OCR. */
  private buildPairs(lines: string[]): Pair[] {
    const pairs: Pair[] = [];
    const allKeys = [
      ...ContactEnrichDialogComponent.SERVICE_KEYS,
      ...ContactEnrichDialogComponent.ENTITE_KEYS,
    ];
    for (let i = 0; i < lines.length; i++) {
      const line = (lines[i] ?? '').trim();
      if (!line) continue;
      // Cas 1 : « Libellé : valeur » sur la même ligne.
      const m = line.match(/^\s*([\p{L}0-9 '/\-]{2,40})\s*[:：]\s*(.+?)\s*$/u);
      if (m) { pairs.push({ key: m[1]!.trim(), value: m[2]!.trim() }); continue; }
      // Cas 2 : un libellé connu seul sur la ligne, valeur sur la ligne suivante.
      const k = this.normalize(line);
      if (allKeys.some(kw => k === kw || k.startsWith(kw + ' ') || k.endsWith(' ' + kw))) {
        const next = (lines[i + 1] ?? '').trim();
        if (next && !next.includes(':')) pairs.push({ key: line, value: next });
      }
    }
    return pairs;
  }

  private pickByKeys(pairs: Pair[], keys: string[]): string | null {
    for (const p of pairs) {
      const k = this.normalize(p.key);
      if (keys.some(kw => k.includes(kw)) && p.value) return p.value.trim();
    }
    return null;
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
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /* ------------------------------------------------------------------ */
  /*  Actions                                                            */
  /* ------------------------------------------------------------------ */

  /** Entité affichée : celle du service choisi (dérivée), sinon l'entité détectée. */
  selectedServiceEntite(): string | null {
    const id = this.serviceId();
    const s = this.refs.services().find(x => x.id === id);
    return s?.entite_libelle ?? this.entiteMatch()?.libelle ?? null;
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
    this.entiteMatch.set(null);
  }
  cancel() { this.closed.emit({}); }

  v(ev: Event): string {
    return (ev.target as HTMLSelectElement).value;
  }
}
