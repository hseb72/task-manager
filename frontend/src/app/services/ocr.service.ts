import { Injectable, inject, signal } from '@angular/core';
import { createWorker, Worker, PSM } from 'tesseract.js';
import { ImagePreprocessService } from './image-preprocess.service';

/** Boîte englobante d'un mot/ligne/bloc dans l'image pré-traitée. */
export interface BBox {
  x0: number; y0: number; x1: number; y1: number;
}
export interface OcrWord {
  text: string;
  confidence: number;
  bbox: BBox;
}
export interface OcrLine {
  text: string;
  confidence: number;
  bbox: BBox;
  words: OcrWord[];
  /** Hauteur estimée des caractères (utilisée pour repérer les titres). */
  fontHeight: number;
}
export interface OcrPageResult {
  text: string;
  confidence: number;
  /** Lignes triées par y croissant, x croissant. */
  lines: OcrLine[];
  /** Dimensions de l'image pré-traitée (pour mapper les bbox sur l'aperçu). */
  imageWidth: number;
  imageHeight: number;
}

@Injectable({ providedIn: 'root' })
export class OcrService {
  private worker: Worker | null = null;
  private preprocess = inject(ImagePreprocessService);

  readonly progress = signal<number>(0);
  readonly status = signal<string>('');

  /**
   * Lance la reconnaissance complète : pré-traitement + Tesseract.
   * Retourne lignes structurées avec bbox dans le repère de l'image pré-traitée.
   */
  async recognize(image: File | Blob): Promise<OcrPageResult> {
    this.progress.set(0);
    this.status.set('Pré-traitement de l\'image…');

    const pp = await this.preprocess.preprocess(image);

    this.status.set('Initialisation du moteur OCR…');
    if (!this.worker) {
      this.worker = await createWorker(['fra', 'eng'], 1, {
        logger: m => {
          if (m.status) this.status.set(this.translateStatus(m.status));
          if (typeof m.progress === 'number') this.progress.set(Math.round(m.progress * 100));
        },
      });
    }

    // PSM_AUTO laisse Tesseract analyser la structure ; pour des UIs très éclatées,
    // PSM.SPARSE_TEXT (11) marche parfois mieux. On garde AUTO pour rester général.
    await this.worker.setParameters({ tessedit_pageseg_mode: PSM.AUTO });

    this.status.set('Analyse de l\'image…');
    const { data } = await this.worker.recognize(pp.blob);

    // Tesseract.js renvoie data.lines avec text/confidence/bbox/words
    const rawLines = (data as any).lines ?? [];
    const lines: OcrLine[] = rawLines
      .map((l: any) => {
        const bbox: BBox = l.bbox ?? { x0: 0, y0: 0, x1: 0, y1: 0 };
        const fontHeight = Math.max(1, bbox.y1 - bbox.y0);
        const words: OcrWord[] = (l.words ?? []).map((w: any) => ({
          text: String(w.text ?? '').trim(),
          confidence: Number(w.confidence ?? 0),
          bbox: w.bbox ?? bbox,
        }));
        return {
          text: String(l.text ?? '').replace(/\s+/g, ' ').trim(),
          confidence: Number(l.confidence ?? 0),
          bbox,
          words,
          fontHeight,
        };
      })
      // Filtrer les lignes vides ou très faiblement reconnues
      .filter((l: OcrLine) => l.text && l.confidence >= 30);

    // Tri spatial : du haut vers le bas, puis gauche vers droite
    lines.sort((a: OcrLine, b: OcrLine) => {
      if (Math.abs(a.bbox.y0 - b.bbox.y0) > 8) return a.bbox.y0 - b.bbox.y0;
      return a.bbox.x0 - b.bbox.x0;
    });

    this.status.set('Analyse terminée.');
    return {
      text: data.text,
      confidence: data.confidence,
      lines,
      imageWidth:  pp.width,
      imageHeight: pp.height,
    };
  }

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
}
