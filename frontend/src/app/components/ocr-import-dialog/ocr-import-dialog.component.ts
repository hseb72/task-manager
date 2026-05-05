import {
  Component, EventEmitter, Output, inject, signal, computed,
  ChangeDetectionStrategy, HostListener,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { OcrService, OcrPageResult } from '../../services/ocr.service';
import { OcrLayoutService, ExtractedTaskFromZones, DetectedZone } from '../../services/ocr-layout.service';
import { OcrDragService } from '../../services/ocr-drag.service';
import { RefsService } from '../../services/refs.service';
import { TacheService } from '../../services/tache.service';
import { ContactRef, Tache, SimpleRef } from '../../models/models';
import { OcrZoneOverlayComponent } from '../ocr-zone-overlay/ocr-zone-overlay.component';
import { firstValueFrom } from 'rxjs';

interface ContactDecision {
  detected: { nom: string; email?: string; role?: string };
  /** existing : on lie un contact existant ; create : on crée le contact ; skip : ignorer */
  mode: 'existing' | 'create' | 'skip';
  existingId: number | null;
  /** Rôle pour la LIAISON (id si rôle existant, sinon null + roleLibelle si à créer). */
  roleId: number | null;
  roleLibelle: string;
  draft: { nom: string; email: string; service_id: number | null };
  /** ID de la zone source (pour la mise en évidence dans l'overlay). */
  zoneId?: string;
}

@Component({
  selector: 'app-ocr-import-dialog',
  standalone: true,
  imports: [CommonModule, FormsModule, OcrZoneOverlayComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './ocr-import-dialog.component.html',
  styleUrl: './ocr-import-dialog.component.css',
})
export class OcrImportDialogComponent {
  private ocrSrv = inject(OcrService);
  private layoutSrv = inject(OcrLayoutService);
  private tacheSrv = inject(TacheService);
  dragSrv = inject(OcrDragService);
  refs = inject(RefsService);

  @Output() closed = new EventEmitter<{ created: boolean; tacheId?: number }>();

  /* ----- État ----- */
  step = signal<'upload' | 'analyzing' | 'review' | 'creating' | 'done' | 'error'>('upload');
  errorMsg = signal<string | null>(null);

  /* ----- Données analysées ----- */
  extracted = signal<ExtractedTaskFromZones | null>(null);
  pageResult = signal<OcrPageResult | null>(null);
  imagePreview = signal<string | null>(null);

  /** Zone actuellement mise en évidence dans l'overlay. */
  selectedZoneId = signal<string | null>(null);

  /* ----- Champs éditables ----- */
  libelle = signal('');
  description = signal('');
  dateDeclaration = signal('');
  dateEcheance = signal('');
  etatId = signal<number | null>(null);
  domaineId = signal<number | null>(null);
  serviceId = signal<number | null>(null);

  /* ----- Décisions sur les contacts ----- */
  contactDecisions = signal<ContactDecision[]>([]);
  intervenantIdx = signal<number | null>(null);

  /* ----- Affichage debug ----- */
  showRawText = signal(false);
  showOverlay = signal(true);

  ocrProgress = this.ocrSrv.progress;
  ocrStatus = this.ocrSrv.status;

  /* ====================================================================== */
  /*  Étape 1 : sélection de l'image                                         */
  /* ====================================================================== */

  async onFileSelected(ev: Event) {
    const input = ev.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    await this.processFile(file);
  }

  async onImageDrop(ev: DragEvent) {
    ev.preventDefault();
    const file = ev.dataTransfer?.files?.[0];
    if (!file || !file.type.startsWith('image/')) return;
    await this.processFile(file);
  }

  onDragOver(ev: DragEvent) { ev.preventDefault(); }

  /**
   * Écoute le collage au niveau du document : ainsi, peu importe quel élément
   * (ou aucun) a le focus, un Ctrl+V est toujours capté tant que le dialogue
   * est instancié. Si l'utilisateur est en train de saisir du texte dans un
   * input, on laisse le collage suivre son cours normal.
   */
  @HostListener('document:paste', ['$event'])
  async onPaste(ev: ClipboardEvent) {
    // Ne pas intercepter le collage si l'utilisateur est en train d'éditer
    // un champ texte (input, textarea, contenteditable).
    const target = ev.target as HTMLElement | null;
    if (target) {
      const tag = target.tagName?.toLowerCase();
      if (tag === 'input' || tag === 'textarea' || target.isContentEditable) {
        return;
      }
    }

    const items = ev.clipboardData?.items;
    if (!items) return;
    for (const item of Array.from(items)) {
      if (item.type.startsWith('image/')) {
        const file = item.getAsFile();
        if (file) {
          ev.preventDefault();
          await this.processFile(file);
          return;
        }
      }
    }
  }

  private async processFile(file: File) {
    this.errorMsg.set(null);
    this.step.set('analyzing');

    const reader = new FileReader();
    reader.onload = e => this.imagePreview.set(String(e.target?.result ?? ''));
    reader.readAsDataURL(file);

    try {
      const ocr = await this.ocrSrv.recognize(file);
      const data = this.layoutSrv.analyze(ocr);
      this.pageResult.set(ocr);
      this.extracted.set(data);
      this.fillFromExtracted(data);
      this.step.set('review');
    } catch (err: any) {
      console.error('OCR échec', err);
      this.errorMsg.set('Échec de l\'analyse : ' + (err?.message ?? err));
      this.step.set('error');
    }
  }

  private fillFromExtracted(d: ExtractedTaskFromZones) {
    this.libelle.set(d.libelle ?? '');
    this.description.set(d.description ?? '');
    this.dateDeclaration.set(d.dateDeclaration ?? new Date().toISOString().slice(0, 10));
    this.dateEcheance.set(d.dateEcheance ?? '');

    // Pré-remplissage du domaine si on en a trouvé un libellé
    if (d.domaineHint) {
      const match = this.refs.domaines().find(x =>
        x.libelle.toLowerCase().includes(d.domaineHint!.toLowerCase()) ||
        d.domaineHint!.toLowerCase().includes(x.libelle.toLowerCase())
      );
      if (match) this.domaineId.set(match.id);
    }

    // Décisions de contacts
    const decisions: ContactDecision[] = d.contacts.map(c => {
      const match = this.findExistingContact(c);
      const detectedRoleId = c.role ? this.findRoleByLabel(c.role) : null;
      // Repérer la zone associée à ce contact dans les zones détectées
      const zone = d.zones.find(z =>
        z.kind === 'contact' && (z.value ?? '').trim().toLowerCase() === c.nom.trim().toLowerCase()
      );
      return {
        detected: c,
        mode: match ? 'existing' : 'create',
        existingId: match?.id ?? null,
        roleId: detectedRoleId,
        roleLibelle: detectedRoleId ? '' : (c.role ?? ''),
        draft: {
          nom: c.nom,
          email: c.email ?? '',
          service_id: null,
        },
        zoneId: zone?.id,
      };
    });
    this.contactDecisions.set(decisions);

    const senderIdx = decisions.findIndex(x => x.detected.role?.toLowerCase().includes('sponsor') || x.detected.role?.toLowerCase().includes('owner'));
    this.intervenantIdx.set(senderIdx >= 0 ? senderIdx : (decisions.length > 0 ? 0 : null));
  }

  private findExistingContact(c: { nom: string; email?: string }): ContactRef | undefined {
    const all = this.refs.contacts();
    if (c.email) {
      const byEmail = all.find(x => x.email?.toLowerCase() === c.email!.toLowerCase());
      if (byEmail) return byEmail;
    }
    return all.find(x => x.nom.toLowerCase() === c.nom.toLowerCase());
  }
  private findRoleByLabel(label: string): number | null {
    const norm = label.trim().toLowerCase();
    const r = this.refs.roles().find(x => x.libelle.toLowerCase() === norm);
    return r?.id ?? null;
  }

  /* ====================================================================== */
  /*  Interaction avec l'overlay                                             */
  /* ====================================================================== */

  /** Quand l'utilisateur clique sur une zone de l'overlay, on met à jour la sélection. */
  onZoneClicked(zoneId: string) {
    this.selectedZoneId.set(this.selectedZoneId() === zoneId ? null : zoneId);
  }

  /** Compte des zones par type (pour la barre récap). */
  zoneCounts = computed(() => {
    const data = this.extracted();
    if (!data) return null;
    const counts = { title: 0, field: 0, description: 0, contact: 0, unknown: 0 };
    for (const z of data.zones) counts[z.kind as keyof typeof counts]++;
    return counts;
  });

  /** Met en évidence le contact correspondant à une zone cliquée (et vice-versa). */
  highlightFromContact(idx: number) {
    const zoneId = this.contactDecisions()[idx]?.zoneId ?? null;
    this.selectedZoneId.set(zoneId);
  }

  /* ====================================================================== */
  /*  Édition des décisions                                                  */
  /* ====================================================================== */

  setDecisionMode(idx: number, mode: ContactDecision['mode']) {
    const arr = [...this.contactDecisions()];
    arr[idx] = { ...arr[idx]!, mode };
    this.contactDecisions.set(arr);
  }
  setDecisionExistingId(idx: number, id: number | null) {
    const arr = [...this.contactDecisions()];
    arr[idx] = { ...arr[idx]!, existingId: id };
    this.contactDecisions.set(arr);
  }
  setDecisionRoleId(idx: number, id: number | null) {
    const arr = [...this.contactDecisions()];
    arr[idx] = { ...arr[idx]!, roleId: id, roleLibelle: id ? '' : arr[idx]!.roleLibelle };
    this.contactDecisions.set(arr);
  }
  setDecisionRoleLibelle(idx: number, lib: string) {
    const arr = [...this.contactDecisions()];
    const existingId = lib.trim() ? this.findRoleByLabel(lib) : null;
    arr[idx] = { ...arr[idx]!, roleLibelle: lib, roleId: existingId };
    this.contactDecisions.set(arr);
  }
  setDecisionDraft(idx: number, field: keyof ContactDecision['draft'], value: any) {
    const arr = [...this.contactDecisions()];
    const d = { ...arr[idx]! };
    d.draft = { ...d.draft, [field]: value };
    arr[idx] = d;
    this.contactDecisions.set(arr);
  }

  /* ====================================================================== */
  /*  Création                                                                */
  /* ====================================================================== */

  async confirm() {
    this.step.set('creating');
    this.errorMsg.set(null);

    try {
      const contactIds: (number | null)[] = [];
      const newRolesByLabel = new Map<string, number>();

      for (const d of this.contactDecisions()) {
        if (d.mode === 'skip')     { contactIds.push(null); continue; }
        if (d.mode === 'existing') { contactIds.push(d.existingId); continue; }
        const created = await firstValueFrom(this.refs.create('contacts', {
          nom: d.draft.nom,
          email: d.draft.email || null,
          service_id: d.draft.service_id,
        } as Partial<ContactRef>));
        contactIds.push((created as ContactRef).id);
      }

      const roleIds: (number | null)[] = [];
      for (const d of this.contactDecisions()) {
        if (d.mode === 'skip')     { roleIds.push(null); continue; }
        if (d.roleId)              { roleIds.push(d.roleId); continue; }
        const lib = d.roleLibelle.trim();
        if (!lib)                  { roleIds.push(null); continue; }
        const memoKey = lib.toLowerCase();
        if (newRolesByLabel.has(memoKey)) {
          roleIds.push(newRolesByLabel.get(memoKey)!);
          continue;
        }
        try {
          const newRole = await firstValueFrom(this.refs.create('roles', { libelle: lib } as Partial<SimpleRef>));
          newRolesByLabel.set(memoKey, (newRole as SimpleRef).id);
          roleIds.push((newRole as SimpleRef).id);
        } catch {
          await firstValueFrom(this.refs.loadAll());
          roleIds.push(this.findRoleByLabel(lib));
        }
      }

      await firstValueFrom(this.refs.loadAll());

      const idx = this.intervenantIdx();
      const intervenantId = idx != null ? contactIds[idx] : null;

      const newTache: Partial<Tache> = {
        libelle: this.libelle().trim() || 'Nouvelle tâche (OCR)',
        description: this.description().trim() || null,
        dateDeclaration: this.dateDeclaration() || null,
        dateEcheance: this.dateEcheance() || null,
        etatId: this.etatId(),
        domaineId: this.domaineId(),
        serviceId: this.serviceId(),
        intervenantId,
      };
      const tache = await firstValueFrom(this.tacheSrv.create(newTache));

      for (let i = 0; i < contactIds.length; i++) {
        const cid = contactIds[i];
        if (cid == null) continue;
        await firstValueFrom(this.tacheSrv.linkContact(tache.id, cid, roleIds[i] ?? null));
      }

      this.step.set('done');
      setTimeout(() => this.close(true, tache.id), 1500);
    } catch (err: any) {
      console.error(err);
      this.errorMsg.set('Échec de la création : ' + (err?.error?.error ?? err.message ?? err));
      this.step.set('review');
    }
  }

  reset() {
    this.step.set('upload');
    this.errorMsg.set(null);
    this.extracted.set(null);
    this.pageResult.set(null);
    this.imagePreview.set(null);
    this.contactDecisions.set([]);
    this.intervenantIdx.set(null);
    this.selectedZoneId.set(null);
  }

  cancel() { this.close(false); }

  private close(created: boolean, tacheId?: number) {
    this.closed.emit({ created, tacheId });
  }

  /* ====================================================================== */
  /*  Helpers                                                                */
  /* ====================================================================== */

  v(ev: Event): string {
    return (ev.target as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement).value;
  }

  decisionSourceLabel(d: ContactDecision): string {
    return d.detected.role ?? '—';
  }
}