import {
  Component, EventEmitter, Input, Output, inject, signal,
  ChangeDetectionStrategy, HostListener,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { OcrService, OcrLine } from '../../services/ocr.service';
import { RefsService } from '../../services/refs.service';
import { ContactRef, ServiceRef } from '../../models/models';

/** Décision pour une personne détectée dans la capture. */
interface PersonDecision {
  nom: string;
  fonction: string;
  mode: 'create' | 'link' | 'skip';
  existingId: number | null;
}

@Component({
  selector: 'app-service-enrich-dialog',
  standalone: true,
  imports: [CommonModule, FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './service-enrich-dialog.component.html',
  styleUrl: './service-enrich-dialog.component.css',
})
export class ServiceEnrichDialogComponent {
  private ocrSrv = inject(OcrService);
  refs = inject(RefsService);

  @Input() service!: ServiceRef;
  @Output() closed = new EventEmitter<{ added: number }>();

  step = signal<'upload' | 'analyzing' | 'review' | 'saving' | 'done' | 'error'>('upload');
  errorMsg = signal<string | null>(null);
  imagePreview = signal<string | null>(null);
  rawText = signal<string>('');
  showRaw = signal(false);
  decisions = signal<PersonDecision[]>([]);
  addedCount = signal(0);

  ocrProgress = this.ocrSrv.progress;
  ocrStatus = this.ocrSrv.status;

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
      const people = this.parseTilesSpatial(ocr.lines as any, ocr.imageWidth || 1000);
      this.decisions.set(people.map(p => {
        const match = this.findExisting(p.nom);
        return {
          nom: p.nom,
          fonction: p.fonction,
          mode: match ? 'link' : 'create',
          existingId: match?.id ?? null,
        } as PersonDecision;
      }));
      this.step.set('review');
    } catch (err: any) {
      console.error('OCR échec', err);
      this.errorMsg.set('Échec de l\'analyse : ' + (err?.message ?? err));
      this.step.set('error');
    }
  }

  /* ------------------------------------------------------------------ */
  /*  Analyse des tuiles                                                 */
  /* ------------------------------------------------------------------ */

  /**
   * Reconstruction « en grille » des tuiles à partir des coordonnées OCR, afin
   * de ne plus dépendre de l'ordre de lecture (qui entrelace les colonnes) :
   *  1. regroupement des lignes en colonnes (par position X du bord gauche) ;
   *  2. découpage de chaque colonne en tuiles (par écart vertical) ;
   *  3. classification de chaque tuile (nom, fonction).
   */
  private parseTilesSpatial(raw: OcrLine[], imageWidth: number): Array<{ nom: string; fonction: string }> {
    const lines = (raw ?? []).filter(l => (l.text ?? '').trim());
    if (lines.length === 0) return [];

    // 1. Colonnes : regroupement par bord gauche (x0).
    const tol = Math.max(40, imageWidth * 0.08);
    const cols: { x: number; lines: OcrLine[] }[] = [];
    for (const l of [...lines].sort((a, b) => a.bbox.x0 - b.bbox.x0)) {
      let c = cols.find(c => Math.abs(c.x - l.bbox.x0) <= tol);
      if (!c) { c = { x: l.bbox.x0, lines: [] }; cols.push(c); }
      c.lines.push(l);
      c.x = Math.min(c.x, l.bbox.x0);
    }
    cols.sort((a, b) => a.x - b.x);

    // 2. Tuiles : découpage vertical de chaque colonne.
    const tiles: OcrLine[][] = [];
    for (const col of cols) {
      const sorted = col.lines.sort((a, b) => a.bbox.y0 - b.bbox.y0);
      let cur: OcrLine[] = [];
      let prev: OcrLine | null = null;
      for (const l of sorted) {
        if (prev) {
          const gap = l.bbox.y0 - prev.bbox.y1;
          const h = Math.max(8, prev.bbox.y1 - prev.bbox.y0);
          if (gap > h * 1.7) { if (cur.length) tiles.push(cur); cur = []; }
        }
        cur.push(l);
        prev = l;
      }
      if (cur.length) tiles.push(cur);
    }

    // 3. Classification.
    const people: Array<{ nom: string; fonction: string }> = [];
    for (const t of tiles) {
      const p = this.classifyTile(t.sort((a, b) => a.bbox.y0 - b.bbox.y0));
      if (p) people.push(p);
    }
    return people;
  }

  /**
   * Classe les lignes d'une tuile : le NOM est la ligne avec des lettres et
   * SANS chiffre (ce qui écarte l'UID et la ligne « id - rôle ») ; la FONCTION
   * est le texte après le tiret (« U12 - Chef de projet » → « Chef de projet »),
   * éventuellement complété par la ligne descriptive suivante (rôle sur 2 lignes).
   * Les initiales seules et la mention interne/externe sont ignorées.
   */
  private classifyTile(tile: OcrLine[]): { nom: string; fonction: string } | null {
    const kept = tile.map(l => (l.text ?? '').trim())
      .filter(t => t && !this.isIgnoreLine(t) && !/^[A-ZÀ-Ý]{1,3}$/.test(t));

    const nom = kept.find(t =>
      /[A-Za-zÀ-ÿ]/.test(t) && !/\d/.test(t) && t.split(/\s+/).filter(Boolean).length <= 5);
    if (!nom) return null;

    let fonction = '';
    for (let i = 0; i < kept.length; i++) {
      const t = kept[i]!;
      if (t === nom) continue;
      const m = t.match(/[-–—]\s*(.+)$/);
      if (m && /[A-Za-zÀ-ÿ]/.test(m[1]!)) {
        fonction = m[1]!.trim();
        const nxt = kept[i + 1];
        if (nxt && nxt !== nom && /[A-Za-zÀ-ÿ]/.test(nxt) && !/[-–—]/.test(nxt) && !/\d/.test(nxt)) {
          fonction += ' ' + nxt.trim();   // rôle sur deux lignes
        }
        break;
      }
    }
    if (!fonction) {
      const leftover = kept.find(t => t !== nom && /[A-Za-zÀ-ÿ]/.test(t) && /\s/.test(t) && !/\d/.test(t));
      if (leftover) fonction = leftover;
    }
    return { nom: this.cleanName(nom), fonction: fonction.trim() };
  }

  private isIgnoreLine(text: string): boolean {
    return /^(interne|externe|intern|external)\b/i.test(text.trim());
  }
  private cleanName(s: string): string {
    return s.replace(/\s+/g, ' ').trim();
  }

  private findExisting(nom: string): ContactRef | undefined {
    const n = this.normalize(nom);
    return this.refs.contacts().find(c => this.normalize(c.nom) === n);
  }
  private normalize(s: string): string {
    return String(s ?? '').toLowerCase()
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/\s+/g, ' ').trim();
  }

  /* ------------------------------------------------------------------ */
  /*  Édition des décisions                                              */
  /* ------------------------------------------------------------------ */

  setMode(i: number, mode: PersonDecision['mode']) {
    const arr = [...this.decisions()];
    arr[i] = { ...arr[i]!, mode };
    this.decisions.set(arr);
  }
  setField(i: number, field: 'nom' | 'fonction', value: string) {
    const arr = [...this.decisions()];
    arr[i] = { ...arr[i]!, [field]: value };
    this.decisions.set(arr);
  }
  setExisting(i: number, id: number | null) {
    const arr = [...this.decisions()];
    arr[i] = { ...arr[i]!, existingId: id };
    this.decisions.set(arr);
  }

  keptCount(): number {
    return this.decisions().filter(d => d.mode !== 'skip').length;
  }

  /* ------------------------------------------------------------------ */
  /*  Application                                                        */
  /* ------------------------------------------------------------------ */

  async apply() {
    this.step.set('saving');
    this.errorMsg.set(null);
    const serviceId = this.service.id;
    let added = 0;
    try {
      for (const d of this.decisions()) {
        if (d.mode === 'skip') continue;
        const nom = d.nom.trim();
        if (!nom) continue;
        const fonction = d.fonction.trim() || null;

        if (d.mode === 'link' && d.existingId != null) {
          await firstValueFrom(this.refs.update('contacts', d.existingId,
            { service_id: serviceId, fonction } as Partial<ContactRef>));
          added++;
          continue;
        }
        // Création ; en cas de doublon de nom (409), on rattache l'existant.
        try {
          await firstValueFrom(this.refs.create('contacts',
            { nom, fonction, service_id: serviceId } as Partial<ContactRef>));
          added++;
        } catch (e: any) {
          const existingId = e?.error?.existingId;
          if (e?.status === 409 && existingId) {
            await firstValueFrom(this.refs.update('contacts', Number(existingId),
              { service_id: serviceId, fonction } as Partial<ContactRef>));
            added++;
          } else {
            throw e;
          }
        }
      }
      await firstValueFrom(this.refs.loadAll());
      this.addedCount.set(added);
      this.step.set('done');
      setTimeout(() => this.closed.emit({ added }), 1200);
    } catch (err: any) {
      console.error(err);
      this.errorMsg.set('Échec de l\'enregistrement : ' + (err?.error?.error ?? err.message ?? err));
      this.step.set('review');
    }
  }

  reset() {
    this.step.set('upload');
    this.errorMsg.set(null);
    this.imagePreview.set(null);
    this.rawText.set('');
    this.decisions.set([]);
  }
  cancel() { this.closed.emit({ added: 0 }); }

  v(ev: Event): string {
    return (ev.target as HTMLInputElement | HTMLSelectElement).value;
  }
}
