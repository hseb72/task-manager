import {
  Component, Input, Output, EventEmitter, ViewChild, ElementRef,
  AfterViewInit, OnChanges, SimpleChanges, ChangeDetectionStrategy,
} from '@angular/core';
import { CommonModule } from '@angular/common';

/**
 * Mini éditeur WYSIWYG basé sur contenteditable.
 * Émet un HTML nettoyé via (valueChange) au blur (et après chaque commande).
 */
@Component({
  selector: 'app-rich-editor',
  standalone: true,
  imports: [CommonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="rich-editor" [class.compact]="compact">
      <div class="rich-toolbar" role="toolbar" aria-label="Mise en forme">
        <button type="button" class="rich-btn" title="Gras (Ctrl+B)"
                (mousedown)="prevent($event)" (click)="exec('bold')"><b>B</b></button>
        <button type="button" class="rich-btn" title="Italique (Ctrl+I)"
                (mousedown)="prevent($event)" (click)="exec('italic')"><i>I</i></button>
        <button type="button" class="rich-btn" title="Souligné (Ctrl+U)"
                (mousedown)="prevent($event)" (click)="exec('underline')"><u>U</u></button>
        <button type="button" class="rich-btn" title="Barré"
                (mousedown)="prevent($event)" (click)="exec('strikeThrough')"><s>S</s></button>
        <span class="rich-sep"></span>
        <button type="button" class="rich-btn" title="Liste à puces"
                (mousedown)="prevent($event)" (click)="exec('insertUnorderedList')">• ☰</button>
        <button type="button" class="rich-btn" title="Liste numérotée"
                (mousedown)="prevent($event)" (click)="exec('insertOrderedList')">1. ☰</button>
        <span class="rich-sep"></span>
        <button type="button" class="rich-btn" title="Lien"
                (mousedown)="prevent($event)" (click)="addLink()">🔗</button>
        <button type="button" class="rich-btn" title="Supprimer la mise en forme"
                (mousedown)="prevent($event)" (click)="exec('removeFormat')">⌫</button>
      </div>
      <div #editor
           class="rich-content"
           contenteditable="true"
           [attr.data-placeholder]="placeholder"
           (input)="onInput()"
           (blur)="onBlur()"
           (keydown)="onKeydown($event)"></div>
    </div>
  `,
  styleUrl: './rich-editor.component.css',
})
export class RichEditorComponent implements AfterViewInit, OnChanges {
  @ViewChild('editor', { static: true }) editorRef!: ElementRef<HTMLDivElement>;

  @Input() value: string | null = '';
  @Input() placeholder = 'Saisir du texte…';
  @Input() compact = false;
  /** Émis quand l'utilisateur quitte le champ (blur) ou immédiatement après une commande de mise en forme. */
  @Output() valueChange = new EventEmitter<string>();

  private lastEmitted = '';

  ngAfterViewInit() {
    this.writeToDom(this.value ?? '');
  }

  ngOnChanges(c: SimpleChanges) {
    // Si la valeur source change pendant que l'éditeur n'a pas le focus, on resynchronise
    if (c['value'] && this.editorRef && document.activeElement !== this.editorRef.nativeElement) {
      this.writeToDom(this.value ?? '');
    }
  }

  private writeToDom(html: string) {
    if (!this.editorRef) return;
    if (this.editorRef.nativeElement.innerHTML !== html) {
      this.editorRef.nativeElement.innerHTML = html;
    }
  }

  exec(command: string, arg?: string) {
    this.editorRef.nativeElement.focus();
    document.execCommand(command, false, arg);
    this.emit();
  }

  addLink() {
    const url = prompt('URL du lien :', 'https://');
    if (!url) return;
    this.exec('createLink', url);
  }

  /** Empêche la perte de focus quand on clique sur un bouton de la barre. */
  prevent(ev: Event) { ev.preventDefault(); }

  onInput() {
    // On ne pousse pas à chaque frappe pour éviter trop d'appels HTTP
    // (la valeur sera émise au blur). Si vous voulez un debounce, à ajouter ici.
  }

  onBlur() { this.emit(); }

  onKeydown(ev: KeyboardEvent) {
    // Raccourcis : Ctrl+B / Ctrl+I / Ctrl+U sont gérés nativement par contenteditable.
    // Ctrl+S → blur pour forcer émission.
    if ((ev.ctrlKey || ev.metaKey) && ev.key === 's') {
      ev.preventDefault();
      this.editorRef.nativeElement.blur();
    }
  }

  private emit() {
    const html = this.normalize(this.editorRef.nativeElement.innerHTML);
    if (html !== this.lastEmitted) {
      this.lastEmitted = html;
      this.valueChange.emit(html);
    }
  }

  /** Si le contenu est vide visuellement, on émet une chaîne vide. */
  private normalize(html: string): string {
    // contenteditable ajoute parfois <br> ou des espaces quand on vide. On nettoie ces cas.
    const stripped = html
      .replace(/<br\s*\/?>/gi, '')
      .replace(/&nbsp;/gi, ' ')
      .replace(/<div><\/div>/gi, '')
      .replace(/<p><\/p>/gi, '')
      .trim();
    if (stripped === '') return '';
    return this.sanitize(html);
  }

  /**
   * Nettoyage léger côté client : retire les balises et attributs susceptibles
   * d'exécuter du code (script, iframe, on*, javascript:, etc.).
   * Ce n'est pas un sanitizer industriel mais c'est suffisant pour un outil interne.
   */
  private sanitize(html: string): string {
    const tpl = document.createElement('template');
    tpl.innerHTML = html;
    const dangerousTags = ['script', 'style', 'iframe', 'object', 'embed', 'link', 'meta'];
    for (const tag of dangerousTags) {
      tpl.content.querySelectorAll(tag).forEach(n => n.remove());
    }
    tpl.content.querySelectorAll('*').forEach(el => {
      // Supprime tous les attributs on* et les href/src en javascript:
      for (const attr of Array.from(el.attributes)) {
        const name = attr.name.toLowerCase();
        const value = (attr.value ?? '').trim().toLowerCase();
        if (name.startsWith('on'))                          el.removeAttribute(attr.name);
        else if ((name === 'href' || name === 'src') && value.startsWith('javascript:'))
                                                            el.removeAttribute(attr.name);
      }
    });
    return tpl.innerHTML;
  }
}
