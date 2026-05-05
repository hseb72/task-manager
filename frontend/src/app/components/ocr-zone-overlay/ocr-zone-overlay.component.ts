import {
  Component, Input, Output, EventEmitter, ChangeDetectionStrategy,
  ElementRef, ViewChild, AfterViewInit, OnChanges, SimpleChanges, inject,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { DetectedZone, ZoneKind } from '../../services/ocr-layout.service';
import { OcrDragService } from '../../services/ocr-drag.service';

interface DisplayedZone extends DetectedZone {
  /** Coordonnées en pourcentage de l'image (positionnement responsive). */
  pctLeft: number;
  pctTop: number;
  pctWidth: number;
  pctHeight: number;
}

const ZONE_COLORS: Record<ZoneKind, { stroke: string; fill: string; label: string }> = {
  title:       { stroke: '#2d3f7c', fill: 'rgba(45, 63, 124, 0.10)',  label: 'Titre' },
  field:       { stroke: '#2f6b3a', fill: 'rgba(47, 107, 58, 0.10)',  label: 'Champ' },
  description: { stroke: '#b8541b', fill: 'rgba(184, 84, 27, 0.10)',  label: 'Description' },
  contact:     { stroke: '#7a4cb0', fill: 'rgba(122, 76, 176, 0.10)', label: 'Contact' },
  unknown:     { stroke: '#8a8478', fill: 'rgba(138, 132, 120, 0.06)',label: 'Non classifié' },
};

@Component({
  selector: 'app-ocr-zone-overlay',
  standalone: true,
  imports: [CommonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="overlay-wrap">
      <div class="overlay-image-wrap" #wrap>
        <img [src]="imageSrc" alt="aperçu" class="overlay-image" #img
             (load)="onImageLoad()">
        @for (z of displayed; track z.id) {
          <div class="overlay-zone"
               [class.selected]="z.id === selectedId"
               [class.dragging]="z.id === dragSrv.dragging()?.id"
               draggable="true"
               (dragstart)="onDragStart($event, z)"
               (dragend)="onDragEnd()"
               [style.left.%]="z.pctLeft"
               [style.top.%]="z.pctTop"
               [style.width.%]="z.pctWidth"
               [style.height.%]="z.pctHeight"
               [style.borderColor]="colors[z.kind].stroke"
               [style.backgroundColor]="colors[z.kind].fill"
               (click)="zoneClicked.emit(z.id)"
               [title]="zoneTooltip(z)">
            <span class="overlay-tag" [style.backgroundColor]="colors[z.kind].stroke">
              {{ colors[z.kind].label }}
              @if (z.kind === 'field' && z.fieldKey) { · {{ z.fieldKey }} }
            </span>
          </div>
        }
      </div>

      <!-- Légende des couleurs -->
      <div class="overlay-legend">
        @for (k of legendKinds; track k) {
          <span class="legend-item">
            <span class="legend-swatch" [style.backgroundColor]="colors[k].stroke"></span>
            {{ colors[k].label }}
          </span>
        }
        <span class="legend-hint">
          Astuce : glissez une zone vers un champ du formulaire pour corriger la détection.
        </span>
      </div>
    </div>
  `,
  styleUrl: './ocr-zone-overlay.component.css',
})
export class OcrZoneOverlayComponent implements AfterViewInit, OnChanges {
  @ViewChild('img') imgRef?: ElementRef<HTMLImageElement>;
  dragSrv = inject(OcrDragService);

  @Input() imageSrc = '';
  @Input() imageWidth = 0;
  @Input() imageHeight = 0;
  @Input() zones: DetectedZone[] = [];
  @Input() selectedId: string | null = null;

  @Output() zoneClicked = new EventEmitter<string>();

  displayed: DisplayedZone[] = [];
  readonly colors = ZONE_COLORS;
  readonly legendKinds: ZoneKind[] = ['title', 'field', 'description', 'contact', 'unknown'];

  ngAfterViewInit() { this.updateDisplay(); }
  ngOnChanges(_: SimpleChanges) { this.updateDisplay(); }

  onImageLoad() { this.updateDisplay(); }

  /* ----- Drag & drop ----- */

  onDragStart(ev: DragEvent, zone: DetectedZone) {
    if (!ev.dataTransfer) return;
    // Met le texte de la zone dans le DataTransfer (compatible avec autres apps)
    ev.dataTransfer.effectAllowed = 'copy';
    ev.dataTransfer.setData('text/plain', zone.value ?? '');
    ev.dataTransfer.setData('application/x-ocr-zone-id', zone.id);
    this.dragSrv.start(zone);
  }

  onDragEnd() {
    this.dragSrv.end();
  }

  private updateDisplay() {
    if (!this.imageWidth || !this.imageHeight || this.zones.length === 0) {
      this.displayed = [];
      return;
    }
    this.displayed = this.zones.map(z => ({
      ...z,
      pctLeft:   (z.bbox.x0 / this.imageWidth)  * 100,
      pctTop:    (z.bbox.y0 / this.imageHeight) * 100,
      pctWidth:  ((z.bbox.x1 - z.bbox.x0) / this.imageWidth)  * 100,
      pctHeight: ((z.bbox.y1 - z.bbox.y0) / this.imageHeight) * 100,
    }));
  }

  zoneTooltip(z: DetectedZone): string {
    const parts = [`${this.colors[z.kind].label}`];
    if (z.label && z.label !== z.value) parts.push(`Libellé: ${z.label}`);
    if (z.value) parts.push(`Valeur: ${z.value.slice(0, 80)}${z.value.length > 80 ? '…' : ''}`);
    parts.push(`Confiance: ${z.confidence.toFixed(0)}%`);
    return parts.join('\n');
  }
}



