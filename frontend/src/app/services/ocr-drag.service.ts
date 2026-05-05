import { Injectable, signal } from '@angular/core';
import { DetectedZone } from './ocr-layout.service';

/**
 * Service partagé entre l'overlay (source du drag) et le dialogue (cibles du drop).
 * Conserve la zone en cours de drag pour que les drop-targets puissent l'inspecter
 * (le DataTransfer ne peut pas porter d'objets riches de manière fiable cross-browser).
 */
@Injectable({ providedIn: 'root' })
export class OcrDragService {
  /** Zone en cours de glissement (ou null). */
  readonly dragging = signal<DetectedZone | null>(null);

  start(zone: DetectedZone) {
    this.dragging.set(zone);
  }
  end() {
    this.dragging.set(null);
  }
}