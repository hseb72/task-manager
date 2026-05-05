import {
  Component, EventEmitter, Output, inject, signal, computed,
  ChangeDetectionStrategy,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { OcrService, ExtractedTaskData, DetectedContact } from '../../services/ocr.service';
import { RefsService } from '../../services/refs.service';
import { TacheService } from '../../services/tache.service';
import { ContactRef, Tache, SimpleRef } from '../../models/models';
import { firstValueFrom } from 'rxjs';

interface ContactDecision {
  detected: DetectedContact;
  /** existing : on lie un contact existant ; create : on crée le contact ; skip : ignorer */
  mode: 'existing' | 'create' | 'skip';
  existingId: number | null;
  /** Rôle pour la LIAISON (id si rôle existant, sinon null + roleLibelle si à créer). */
  roleId: number | null;
  /** Si l'utilisateur a tapé un nouveau libellé de rôle (sera créé dans le ref). */
  roleLibelle: string;
  /** Champs éditables si mode 'create' */
  draft: { nom: string; email: string; service_id: number | null };
}

@Component({
  selector: 'app-ocr-import-dialog',
  standalone: true,
  imports: [CommonModule, FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './ocr-import-dialog.component.html',
  styleUrl: './ocr-import-dialog.component.css',
})
export class OcrImportDialogComponent {
  private ocr = inject(OcrService);
  private tacheSrv = inject(TacheService);
  refs = inject(RefsService);

  @Output() closed = new EventEmitter<{ created: boolean; tacheId?: number }>();

  /* ----- État du dialogue ----- */
  step = signal<'upload' | 'analyzing' | 'review' | 'creating' | 'done' | 'error'>('upload');
  errorMsg = signal<string | null>(null);

  /* ----- Données extraites ----- */
  extracted = signal<ExtractedTaskData | null>(null);
  imagePreview = signal<string | null>(null);

  /* ----- Champs éditables (pré-remplis depuis extracted) ----- */
  libelle = signal('');
  description = signal('');
  dateDeclaration = signal('');
  dateEcheance = signal('');
  etatId = signal<number | null>(null);
  domaineId = signal<number | null>(null);
  serviceId = signal<number | null>(null);

  /* ----- Décisions sur les contacts ----- */
  contactDecisions = signal<ContactDecision[]>([]);
  /** Contact retenu comme INTERVENANT de la tâche (parmi les décisions). */
  intervenantIdx = signal<number | null>(null);

  ocrProgress  = this.ocr.progress;
  ocrStatus    = this.ocr.status;

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

  async onPaste(ev: ClipboardEvent) {
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
      const data = await this.ocr.analyze(file);
      this.extracted.set(data);
      this.fillFromExtracted(data);
      this.step.set('review');
    } catch (err: any) {
      console.error('OCR échec', err);
      this.errorMsg.set('Échec de l\'analyse : ' + (err?.message ?? err));
      this.step.set('error');
    }
  }

  /** Pré-remplit les signaux éditables et prépare les décisions de contacts. */
  private fillFromExtracted(d: ExtractedTaskData) {
    this.libelle.set(d.libelle ?? '');
    this.description.set(d.description ?? '');
    this.dateDeclaration.set(d.dateDeclaration ?? new Date().toISOString().slice(0, 10));
    this.dateEcheance.set(d.dateEcheance ?? '');

    const decisions: ContactDecision[] = d.contacts.map(c => {
      const match = this.findExistingContact(c);
      // Tente de trouver un rôle existant correspondant à ce qui a été détecté
      const detectedRoleId = c.role ? this.findRoleByLabel(c.role) : null;
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
      };
    });
    this.contactDecisions.set(decisions);

    const senderIdx = decisions.findIndex(x => x.detected.source === 'sender');
    this.intervenantIdx.set(senderIdx >= 0 ? senderIdx : (decisions.length > 0 ? 0 : null));
  }

  private findExistingContact(c: DetectedContact): ContactRef | undefined {
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
  /*  Étape 2 : édition des décisions                                        */
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
    // Quand on choisit un rôle existant, on vide le libellé "à créer"
    arr[idx] = { ...arr[idx]!, roleId: id, roleLibelle: id ? '' : arr[idx]!.roleLibelle };
    this.contactDecisions.set(arr);
  }

  setDecisionRoleLibelle(idx: number, lib: string) {
    const arr = [...this.contactDecisions()];
    // Tape un libellé : on tente le match avec un rôle existant
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

  decisionSourceLabel(d: ContactDecision): string {
    switch (d.detected.source) {
      case 'sender':    return 'Expéditeur';
      case 'recipient': return 'Destinataire';
      case 'cc':        return 'Copie';
      case 'mentioned': return 'Mentionné';
    }
  }

  retainedDecisions = computed(() =>
    this.contactDecisions().filter(d => d.mode !== 'skip')
  );

  /* ====================================================================== */
  /*  Étape 3 : création de la tâche, des contacts et des rôles              */
  /* ====================================================================== */

  async confirm() {
    this.step.set('creating');
    this.errorMsg.set(null);

    try {
      // 1) Pour chaque décision, déterminer / créer le contact
      const contactIds: (number | null)[] = [];
      // Mémo pour ne pas créer deux fois le même rôle dans la même session
      const newRolesByLabel = new Map<string, number>();

      for (const d of this.contactDecisions()) {
        if (d.mode === 'skip') {
          contactIds.push(null);
          continue;
        }
        if (d.mode === 'existing') {
          contactIds.push(d.existingId);
          continue;
        }
        // mode 'create'
        const created = await firstValueFrom(this.refs.create('contacts', {
          nom: d.draft.nom,
          email: d.draft.email || null,
          service_id: d.draft.service_id,
        } as Partial<ContactRef>));
        contactIds.push((created as ContactRef).id);
      }

      // 2) Pour chaque décision conservée : déterminer le role_id, créer le rôle si besoin
      const roleIds: (number | null)[] = [];
      for (const d of this.contactDecisions()) {
        if (d.mode === 'skip') { roleIds.push(null); continue; }
        if (d.roleId) { roleIds.push(d.roleId); continue; }
        const lib = d.roleLibelle.trim();
        if (!lib) { roleIds.push(null); continue; }
        // Crée le rôle (ou récupère l'id du rôle déjà créé dans cette session)
        const memoKey = lib.toLowerCase();
        if (newRolesByLabel.has(memoKey)) {
          roleIds.push(newRolesByLabel.get(memoKey)!);
          continue;
        }
        try {
          const newRole = await firstValueFrom(this.refs.create('roles', { libelle: lib } as Partial<SimpleRef>));
          newRolesByLabel.set(memoKey, (newRole as SimpleRef).id);
          roleIds.push((newRole as SimpleRef).id);
        } catch (e: any) {
          // Conflit (UNIQUE) : le rôle a peut-être été créé entre temps, on retente le match
          await firstValueFrom(this.refs.loadAll());
          const id = this.findRoleByLabel(lib);
          roleIds.push(id);
        }
      }

      // Rafraîchit le cache global (contacts + rôles)
      await firstValueFrom(this.refs.loadAll());

      // 3) Création de la tâche
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

      // 4) Liaisons : tous les contacts conservés, avec leur rôle pour la liaison.
      //    L'intervenant est aussi lié (utile pour suivre son rôle sur la tâche).
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
    this.imagePreview.set(null);
    this.contactDecisions.set([]);
    this.intervenantIdx.set(null);
  }

  cancel() { this.close(false); }

  private close(created: boolean, tacheId?: number) {
    this.closed.emit({ created, tacheId });
  }

  /* ====================================================================== */
  /*  Helpers Event -> string pour les bindings                              */
  /* ====================================================================== */

  v(ev: Event): string {
    return (ev.target as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement).value;
  }
}
