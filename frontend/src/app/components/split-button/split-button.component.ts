import {
  Component, Input, Output, EventEmitter, signal,
  HostListener, ElementRef, inject, ChangeDetectionStrategy,
} from '@angular/core';
import { CommonModule } from '@angular/common';

export interface SplitButtonAction {
  /** Identifiant unique passé en sortie quand l'action est choisie. */
  id: string;
  /** Libellé affiché. */
  label: string;
  /** Tooltip optionnelle. */
  title?: string;
  /** Désactivation conditionnelle. */
  disabled?: boolean;
  /** Marquer une action « destructive ». */
  danger?: boolean;
}

/**
 * Bouton split : la partie gauche déclenche l'action courante (par défaut la première),
 * la partie droite (flèche) ouvre un menu pour choisir une autre action.
 * L'action choisie devient l'action courante.
 */
@Component({
  selector: 'app-split-button',
  standalone: true,
  imports: [CommonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="split-btn" [class.open]="open()">
      <button class="split-main"
              [title]="currentAction().title ?? currentAction().label"
              [disabled]="currentAction().disabled"
              (click)="trigger(currentAction())">
        {{ currentAction().label }}
      </button>
      <button class="split-arrow" title="Plus d'options" (click)="toggle()">▾</button>

      @if (open()) {
        <ul class="split-menu" role="menu">
          @for (a of actions; track a.id) {
            <li role="none">
              <button role="menuitem"
                      [class.danger]="a.danger"
                      [class.current]="a.id === currentAction().id"
                      [disabled]="a.disabled"
                      [title]="a.title ?? ''"
                      (click)="select(a)">
                {{ a.label }}
              </button>
            </li>
          }
        </ul>
      }
    </div>
  `,
  styleUrl: './split-button.component.css',
})
export class SplitButtonComponent {
  private host = inject(ElementRef);

  @Input({ required: true }) actions!: SplitButtonAction[];
  /** Identifiant de l'action affichée par défaut sur le bouton principal. */
  @Input() defaultId?: string;
  @Output() actionTriggered = new EventEmitter<string>();

  open = signal(false);
  private currentId = signal<string | null>(null);

  currentAction = (): SplitButtonAction => {
    const id = this.currentId() ?? this.defaultId ?? this.actions[0]?.id;
    return this.actions.find(a => a.id === id) ?? this.actions[0];
  };

  toggle() { this.open.update(v => !v); }

  select(a: SplitButtonAction) {
    if (a.disabled) return;
    this.currentId.set(a.id);
    this.open.set(false);
    this.trigger(a);
  }

  trigger(a: SplitButtonAction) {
    if (a.disabled) return;
    this.actionTriggered.emit(a.id);
  }

  /** Ferme le menu si on clique à l'extérieur. */
  @HostListener('document:click', ['$event'])
  onDocClick(ev: MouseEvent) {
    if (!this.host.nativeElement.contains(ev.target as Node)) {
      this.open.set(false);
    }
  }

  /** Ferme le menu sur Escape. */
  @HostListener('document:keydown.escape')
  onEsc() { this.open.set(false); }
}
