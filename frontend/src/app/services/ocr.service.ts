import { Injectable, signal } from '@angular/core';
import { createWorker, Worker } from 'tesseract.js';

/** Résultat brut de l'OCR. */
export interface OcrResult {
  text: string;
  /** Confiance globale (0–100). */
  confidence: number;
}

/** Une personne détectée dans le texte. */
export interface DetectedContact {
  nom: string;
  email?: string;
  role?: string;
  /** D'où vient-elle ? expéditeur/destinataire/mentionnée dans le corps */
  source: 'sender' | 'recipient' | 'mentioned' | 'cc';
}

/** Données structurées extraites pour pré-remplir une nouvelle tâche. */
export interface ExtractedTaskData {
  libelle?: string;
  description?: string;
  dateDeclaration?: string;
  dateEcheance?: string;
  contacts: DetectedContact[];
  /** Texte brut OCRisé (toujours rendu pour debug/contrôle). */
  rawText: string;
  confidence: number;
}

@Injectable({ providedIn: 'root' })
export class OcrService {
  /** Worker Tesseract instancié à la demande, conservé pour les analyses suivantes. */
  private worker: Worker | null = null;
  /** État de progression (0..100) pour l'UI. */
  readonly progress = signal<number>(0);
  readonly status = signal<string>('');

  /* ====================================================================== */
  /*  OCR brut                                                               */
  /* ====================================================================== */

  /** Lance la reconnaissance sur une image (File, Blob ou base64 dataURL). */
  async recognize(image: File | Blob | string): Promise<OcrResult> {
    this.progress.set(0);
    this.status.set('Initialisation du moteur OCR…');

    if (!this.worker) {
      this.worker = await createWorker(['fra', 'eng'], 1, {
        logger: m => {
          if (m.status) this.status.set(this.translateStatus(m.status));
          if (typeof m.progress === 'number') this.progress.set(Math.round(m.progress * 100));
        },
      });
    }

    this.status.set('Analyse de l\'image…');
    const { data } = await this.worker.recognize(image);
    this.status.set('Analyse terminée.');
    return { text: data.text, confidence: data.confidence };
  }

  /** Libère le worker (à appeler quand on quitte la fonctionnalité OCR). */
  async terminate(): Promise<void> {
    if (this.worker) {
      await this.worker.terminate();
      this.worker = null;
    }
  }

  private translateStatus(s: string): string {
    const map: Record<string, string> = {
      'loading tesseract core':     'Chargement du moteur…',
      'initializing tesseract':     'Initialisation…',
      'loading language traineddata': 'Téléchargement des langues…',
      'initializing api':           'Préparation…',
      'recognizing text':           'Reconnaissance du texte…',
    };
    return map[s] ?? s;
  }

  /* ====================================================================== */
  /*  Extraction d'informations à partir du texte OCRisé                     */
  /* ====================================================================== */

  /** Pipeline complet : OCR puis extraction des champs candidats. */
  async analyze(image: File | Blob): Promise<ExtractedTaskData> {
    const ocr = await this.recognize(image);
    return this.extract(ocr);
  }

  /** Extrait les champs sans relancer l'OCR (utile pour debug). */
  extract(ocr: OcrResult): ExtractedTaskData {
    const text = ocr.text || '';
    return {
      libelle:         this.extractSubject(text),
      description:     this.extractDescription(text),
      dateDeclaration: this.extractFirstDate(text, ['envoyé', 'envoye', 'reçu', 'recu', 'date', 'sent']),
      dateEcheance:    this.extractFirstDate(text, ['échéance', 'echeance', 'pour le', 'avant le', 'deadline', 'due']),
      contacts:        this.extractContacts(text),
      rawText:         text,
      confidence:      ocr.confidence,
    };
  }

  /* -------- Sujet / libellé -------- */

  private extractSubject(text: string): string | undefined {
    // Outlook FR/EN : "Objet:", "Subject:", "Sujet :"
    const m = text.match(/^[ \t]*(?:objet|sujet|subject)\s*[:\-]\s*(.+?)\s*$/im);
    if (m) return this.clean(m[1]!);

    // Teams : souvent le titre du canal ou la première ligne en gras (impossible à détecter)
    // Fallback : première ligne non vide
    const firstLine = text.split('\n').map(l => l.trim()).find(l => l.length >= 4);
    return firstLine ? this.clean(firstLine).slice(0, 120) : undefined;
  }

  /* -------- Description -------- */

  private extractDescription(text: string): string | undefined {
    // Si on a détecté des en-têtes de mail, on prend tout après une ligne vide
    const lines = text.split('\n');
    const headerEnd = lines.findIndex((l, i) =>
      i > 0 && l.trim() === '' && lines.slice(0, i).some(prev => /^(de|to|from|cc|objet|sujet|subject|envoyé|sent)\s*[:\-]/i.test(prev))
    );
    if (headerEnd > 0) {
      const body = lines.slice(headerEnd + 1).join('\n').trim();
      if (body.length > 0) return body;
    }

    // Sinon : tout après la première ligne (qui sert de libellé)
    const rest = lines.slice(1).join('\n').trim();
    return rest.length > 0 ? rest : undefined;
  }

  /* -------- Dates -------- */

  /**
   * Cherche une date proche d'un mot-clé. Si aucun mot-clé ne matche,
   * renvoie la première date trouvée.
   */
  private extractFirstDate(text: string, keywords: string[]): string | undefined {
    const lines = text.split('\n');

    // Recherche prioritaire : ligne contenant un mot-clé
    for (const line of lines) {
      const lower = line.toLowerCase();
      if (keywords.some(k => lower.includes(k))) {
        const d = this.parseDateAnywhere(line);
        if (d) return d;
      }
    }

    // Fallback : première date du texte
    for (const line of lines) {
      const d = this.parseDateAnywhere(line);
      if (d) return d;
    }
    return undefined;
  }

  /** Tente plusieurs formats : 'JJ/MM/AAAA', 'JJ-MM-AAAA', 'AAAA-MM-JJ', 'JJ mois AAAA'. */
  private parseDateAnywhere(text: string): string | undefined {
    const months: Record<string, number> = {
      'janvier': 1, 'jan': 1,
      'février': 2, 'fevrier': 2, 'fév': 2, 'fev': 2,
      'mars': 3, 'mar': 3,
      'avril': 4, 'avr': 4,
      'mai': 5,
      'juin': 6,
      'juillet': 7, 'juil': 7, 'jul': 7,
      'août': 8, 'aout': 8,
      'septembre': 9, 'sept': 9, 'sep': 9,
      'octobre': 10, 'oct': 10,
      'novembre': 11, 'nov': 11,
      'décembre': 12, 'decembre': 12, 'déc': 12, 'dec': 12,
    };

    // Format ISO YYYY-MM-DD
    let m = text.match(/(\b\d{4})-(\d{1,2})-(\d{1,2})\b/);
    if (m) return this.toIso(+m[3]!, +m[2]!, +m[1]!);

    // Format JJ/MM/AAAA ou JJ-MM-AAAA
    m = text.match(/\b(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{2,4})\b/);
    if (m) {
      let year = +m[3]!;
      if (year < 100) year += year < 50 ? 2000 : 1900;
      return this.toIso(+m[1]!, +m[2]!, year);
    }

    // Format JJ mois AAAA (français)
    m = text.match(/\b(\d{1,2})\s+([a-zéèêûçâî]+)\.?\s+(\d{4})\b/i);
    if (m) {
      const month = months[m[2]!.toLowerCase()];
      if (month) return this.toIso(+m[1]!, month, +m[3]!);
    }

    return undefined;
  }

  private toIso(d: number, m: number, y: number): string | undefined {
    if (d < 1 || d > 31 || m < 1 || m > 12 || y < 1900 || y > 2200) return undefined;
    return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  }

  /* -------- Contacts -------- */

  private extractContacts(text: string): DetectedContact[] {
    const contacts = new Map<string, DetectedContact>();
    const addOrMerge = (c: DetectedContact) => {
      const key = (c.email ?? c.nom).toLowerCase();
      const existing = contacts.get(key);
      if (existing) {
        // Garde la priorité de la source la plus forte (sender > recipient > cc > mentioned)
        if (this.sourcePriority(c.source) > this.sourcePriority(existing.source)) {
          existing.source = c.source;
        }
        existing.email = existing.email ?? c.email;
        existing.role = existing.role ?? c.role;
      } else {
        contacts.set(key, { ...c });
      }
    };

    const lines = text.split('\n');

    // Détection des en-têtes Outlook : "De:", "À:", "Cc:", "From:", "To:"
    for (const line of lines) {
      const headerMatch = line.match(/^\s*(de|from|à|a|to|cc)\s*[:\-]\s*(.+?)\s*$/i);
      if (!headerMatch) continue;
      const role = headerMatch[1]!.toLowerCase();
      const value = headerMatch[2]!;

      let source: DetectedContact['source'];
      if (role === 'de' || role === 'from')          source = 'sender';
      else if (role === 'à' || role === 'a' || role === 'to') source = 'recipient';
      else                                            source = 'cc';

      // Une ligne peut contenir plusieurs personnes séparées par ; ou ,
      for (const part of value.split(/[;]+/)) {
        const c = this.parseNameEmail(part);
        if (c) addOrMerge({ ...c, source });
      }
    }

    // Détection libre dans le corps du texte : adresses email, formules "Bonjour Untel,"
    const emails = text.match(/\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b/g) ?? [];
    for (const email of emails) {
      if ([...contacts.values()].some(c => c.email === email)) continue;
      addOrMerge({
        nom: this.nameFromEmail(email),
        email,
        source: 'mentioned',
      });
    }

    // Formules de salutation : "Bonjour Pierre Martin," / "Cher Jean,"
    const greetings = text.matchAll(/\b(?:bonjour|cher(?:e|es|s)?|salut|hello|hi)\s+([A-ZÀ-Ý][a-zà-ÿ\-]+(?:\s+[A-ZÀ-Ý][a-zà-ÿ\-]+){0,2})/gi);
    for (const g of greetings) {
      const nom = this.clean(g[1]!);
      if (nom.length >= 3 && ![...contacts.values()].some(c => c.nom.toLowerCase() === nom.toLowerCase())) {
        addOrMerge({ nom, source: 'mentioned' });
      }
    }

    // Signature : dernières lignes non vides souvent "Cordialement,\nNom Prénom\nFonction"
    const tail = lines.filter(l => l.trim().length > 0).slice(-5);
    for (let i = 0; i < tail.length - 1; i++) {
      if (/^(cordialement|sincèrement|bien à vous|bien cordialement|salutations|merci|regards|best)/i.test(tail[i]!)) {
        const sigName = this.clean(tail[i + 1] ?? '');
        const sigRole = this.clean(tail[i + 2] ?? '');
        if (sigName && /^[A-ZÀ-Ý]/.test(sigName) && sigName.length < 60) {
          const existing = [...contacts.values()].find(c => c.nom.toLowerCase() === sigName.toLowerCase());
          if (existing && !existing.role && sigRole && sigRole.length < 80) {
            existing.role = sigRole;
          } else if (!existing) {
            addOrMerge({ nom: sigName, role: sigRole || undefined, source: 'sender' });
          }
        }
        break;
      }
    }

    // Tri : sender > recipient > cc > mentioned
    return [...contacts.values()].sort(
      (a, b) => this.sourcePriority(b.source) - this.sourcePriority(a.source)
    );
  }

  private sourcePriority(s: DetectedContact['source']): number {
    return { sender: 4, recipient: 3, cc: 2, mentioned: 1 }[s];
  }

  /** Parse "Nom Prénom <email@x.com>" ou "email@x.com" ou "Nom Prénom" */
  private parseNameEmail(s: string): { nom: string; email?: string } | null {
    const cleaned = this.clean(s);
    if (!cleaned) return null;

    const m = cleaned.match(/^(.+?)\s*<([^>]+)>\s*$/);
    if (m) {
      const nom = this.clean(m[1]!.replace(/^["']|["']$/g, ''));
      return { nom: nom || this.nameFromEmail(m[2]!), email: m[2]!.trim() };
    }

    if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(cleaned)) {
      return { nom: this.nameFromEmail(cleaned), email: cleaned };
    }

    // Juste un nom
    if (cleaned.length >= 3 && /^[A-ZÀ-Ý]/.test(cleaned)) {
      return { nom: cleaned };
    }
    return null;
  }

  /** Génère un nom propre depuis un email (jean.dupont@x.com → "Jean Dupont"). */
  private nameFromEmail(email: string): string {
    const local = email.split('@')[0] ?? email;
    return local
      .split(/[._\-]+/)
      .filter(Boolean)
      .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
      .join(' ');
  }

  private clean(s: string): string {
    return s.replace(/\s+/g, ' ').trim();
  }
}
