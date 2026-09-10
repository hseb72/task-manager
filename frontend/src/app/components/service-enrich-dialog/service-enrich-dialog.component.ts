import {
  Component, EventEmitter, Input, Output, inject, signal,
  ChangeDetectionStrategy, HostListener,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { OcrService } from '../../services/ocr.service';
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
      const people = this.parseTiles(ocr.lines.map(l => l.text));
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
   * Chaque tuile : (photo/initiales) → Nom Prénom → « id - rôle » → « Interne/Externe ».
   * On repère les lignes « id - rôle » (id comportant un chiffre), le nom est la
   * ligne juste au-dessus ; la mention interne/externe et l'id sont ignorés.
   */
  private parseTiles(lines: string[]): Array<{ nom: string; fonction: string }> {
    const people: Array<{ nom: string; fonction: string }> = [];
    for (let i = 0; i < lines.length; i++) {
      const ir = this.idRole(lines[i] ?? '');
      if (!ir) continue;
      let nom = '';
      for (let j = i - 1; j >= 0 && j >= i - 3; j--) {
        if (this.looksLikeName(lines[j] ?? '')) { nom = (lines[j] ?? '').trim(); break; }
      }
      if (nom) people.push({ nom: this.cleanName(nom), fonction: ir.role });
    }
    return people;
  }

  /** « U012345 - Chef de projet » → { id, role }. L'id doit contenir un chiffre. */
  private idRole(text: string): { id: string; role: string } | null {
    const m = text.trim().match(/^(\S{2,20})\s*[-–—]\s*(.+)$/);
    if (m && /\d/.test(m[1]!)) return { id: m[1]!, role: m[2]!.trim() };
    return null;
  }
  private isIgnoreLine(text: string): boolean {
    return /^(interne|externe|intern|external)\b/i.test(text.trim());
  }
  private looksLikeName(text: string): boolean {
    const s = text.trim();
    if (!s || this.isIgnoreLine(s) || this.idRole(s)) return false;
    if (/^[A-ZÀ-Ý]{1,3}$/.test(s)) return false;           // initiales seules
    if (!/[A-Za-zÀ-ÿ]/.test(s)) return false;
    const words = s.split(/\s+/).filter(Boolean);
    return words.length >= 1 && words.length <= 6;
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
