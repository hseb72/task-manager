import { Component, inject, signal, computed, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  MeetingsImportService, ColKey, ColumnMap, Meeting, ThemeSynthesis,
} from '../../services/meetings-import.service';

@Component({
  selector: 'app-meetings-page',
  standalone: true,
  imports: [CommonModule, FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './meetings-page.component.html',
  styleUrl: './meetings-page.component.css',
})
export class MeetingsPageComponent {
  private svc = inject(MeetingsImportService);

  step = signal<'upload' | 'map' | 'result'>('upload');
  error = signal<string | null>(null);
  fileName = signal<string>('');
  pasteText = signal<string>('');

  headers = signal<string[]>([]);
  rows = signal<string[][]>([]);
  map = signal<ColumnMap>({});
  excludedText = signal<string>('COSIT, COLEC, ITVC');
  /** Alias « désignation = CODE », séparés par des virgules ou retours ligne. */
  aliasesText = signal<string>('');
  /** Termes génériques dépriorisés (séparés par virgules/espaces). */
  genericsText = signal<string>('projet, infra, infrastructure, cadrage, démo, démonstration, atelier, point, suivi, revue, comité, chantier, dossier');

  meetings = signal<Meeting[]>([]);
  synthesis = signal<ThemeSynthesis[]>([]);
  expanded = signal<Set<string>>(new Set());

  /* Reclassement d'une réunion depuis le détail d'un thème. */
  reclassOpen = signal<number | null>(null);   // id de la réunion dont le panneau est ouvert
  reclassExclude = signal<boolean>(false);      // exclure le code courant
  reclassWord = signal<string>('');             // mot à prioriser (alias)
  reclassCode = signal<string>('');             // code cible optionnel pour l'alias

  readonly cols: { key: ColKey; label: string; hint?: string }[] = [
    { key: 'subject',     label: 'Sujet (titre)' },
    { key: 'organizer',   label: 'Organisateur' },
    { key: 'description', label: 'Description (corps)' },
    { key: 'required',    label: 'Destinataires obligatoires' },
    { key: 'optional',    label: 'Destinataires facultatifs' },
    { key: 'startDate',   label: 'Date de début' },
    { key: 'startTime',   label: 'Heure de début', hint: 'si séparée de la date' },
    { key: 'endDate',     label: 'Date de fin', hint: 'si pas de durée' },
    { key: 'endTime',     label: 'Heure de fin', hint: 'si pas de durée' },
    { key: 'duration',    label: 'Durée planifiée', hint: 'minutes ou h:mm' },
    { key: 'status',      label: 'Statut' },
  ];

  summary = computed(() => {
    const ms = this.meetings();
    const cancelled = ms.filter(m => m.cancelled).length;
    const personal = ms.filter(m => m.personal).length;
    const totalMin = ms.filter(m => !m.cancelled && !m.personal).reduce((a, m) => a + m.durationMin, 0);
    return {
      total: ms.length, active: ms.length - cancelled - personal,
      cancelled, personal, totalMin, themes: this.synthesis().length,
    };
  });

  /* ------------------------------------------------------------------ */
  /*  Chargement du fichier                                              */
  /* ------------------------------------------------------------------ */

  onFileSelected(ev: Event) {
    const file = (ev.target as HTMLInputElement).files?.[0];
    if (file) this.readFile(file);
  }
  onDrop(ev: DragEvent) {
    ev.preventDefault();
    const file = ev.dataTransfer?.files?.[0];
    if (file) this.readFile(file);
  }
  onDragOver(ev: DragEvent) { ev.preventDefault(); }

  private readFile(file: File) {
    this.fileName.set(file.name);
    const reader = new FileReader();
    reader.onload = () => this.ingest(String(reader.result ?? ''));
    reader.onerror = () => this.error.set('Lecture du fichier impossible.');
    reader.readAsText(file);
  }

  usePasted() {
    const t = this.pasteText().trim();
    if (!t) return;
    this.fileName.set('(collé)');
    this.ingest(t);
  }

  private ingest(text: string) {
    this.error.set(null);
    try {
      const parsed = this.svc.parseCsv(text);
      if (parsed.headers.length === 0 || parsed.rows.length === 0) {
        this.error.set('Fichier vide ou illisible.');
        return;
      }
      this.headers.set(parsed.headers);
      this.rows.set(parsed.rows);
      this.map.set(this.svc.detectColumns(parsed.headers));
      this.step.set('map');
    } catch (e: any) {
      this.error.set('Échec de lecture : ' + (e?.message ?? e));
    }
  }

  /* ------------------------------------------------------------------ */
  /*  Correspondance des colonnes                                        */
  /* ------------------------------------------------------------------ */

  mapValue(key: ColKey): number { return this.map()[key] ?? -1; }
  setMap(key: ColKey, idx: number) {
    const m = { ...this.map() };
    if (idx < 0) delete m[key]; else m[key] = idx;
    this.map.set(m);
  }
  get subjectMapped(): boolean { return this.map().subject !== undefined; }

  analyze() {
    const excluded = this.excludedText().split(/[,\s]+/).map(s => s.trim()).filter(Boolean);
    const aliases = this.aliasesText().split(/[,\n;]+/).map(line => {
      const [term, code] = line.split('=');
      return { term: (term ?? '').trim(), code: (code ?? '').trim() };
    }).filter(a => a.term && a.code);
    const generics = this.genericsText().split(/[,\s]+/).map(s => s.trim()).filter(Boolean);
    const ms = this.svc.buildMeetings(this.rows(), this.map(), { excluded, aliases, generics });
    this.meetings.set(ms);
    this.synthesis.set(this.svc.synthesize(ms));
    // On conserve les thèmes dépliés (utile lors d'un reclassement/relance).
    this.step.set('result');
  }

  /* ------------------------------------------------------------------ */
  /*  Résultat                                                           */
  /* ------------------------------------------------------------------ */

  /** Revient à l'étape de paramétrage en conservant l'upload et les réglages. */
  backToSettings() { this.error.set(null); this.step.set('map'); }

  /* ------------------------------------------------------------------ */
  /*  Reclassement d'une réunion mal classée                             */
  /* ------------------------------------------------------------------ */

  /** Code du thème courant d'une réunion (null si c'est un mot-clé de repli). */
  codeOf(m: Meeting): string | null { return m.themeFromFallback ? null : m.themeKey; }

  /** Mots cliquables (objet + description) proposés pour prioriser un thème. */
  words(m: Meeting): string[] { return this.svc.candidateWords(m); }

  openReclass(m: Meeting) {
    if (this.reclassOpen() === m.id) { this.reclassOpen.set(null); return; }
    this.reclassOpen.set(m.id);
    this.reclassExclude.set(false);
    this.reclassWord.set('');
    this.reclassCode.set('');
  }
  isReclassOpen(m: Meeting): boolean { return this.reclassOpen() === m.id; }
  pickWord(w: string) { this.reclassWord.set(this.reclassWord() === w ? '' : w); }

  /** Applique l'exclusion et/ou la priorisation choisies, puis relance l'analyse. */
  applyReclass(m: Meeting) {
    const code = this.codeOf(m);
    if (this.reclassExclude() && code) {
      const cur = this.excludedText().split(/[,\s]+/).map(s => s.trim()).filter(Boolean);
      if (!cur.some(c => c.toUpperCase() === code.toUpperCase())) cur.push(code);
      this.excludedText.set(cur.join(', '));
    }
    const word = this.reclassWord().trim();
    if (word) {
      const target = (this.reclassCode().trim() || word).toUpperCase().replace(/\s+/g, '');
      const line = `${word} = ${target}`;
      const existing = this.aliasesText().split(/\n+/).map(s => s.trim()).filter(Boolean);
      if (!existing.some(l => l.toLowerCase() === line.toLowerCase())) existing.push(line);
      this.aliasesText.set(existing.join('\n'));
    }
    this.reclassOpen.set(null);
    this.analyze();   // recalcule avec les paramètres mis à jour, reste sur la synthèse
  }

  toggleExpand(key: string) {
    const s = new Set(this.expanded());
    s.has(key) ? s.delete(key) : s.add(key);
    this.expanded.set(s);
  }
  isExpanded(key: string): boolean { return this.expanded().has(key); }

  fmt(min: number): string { return this.svc.formatDuration(min); }
  fmtDate(d: Date | null): string { return this.svc.formatDate(d); }
  topActorsLabel(t: ThemeSynthesis): string {
    return t.topActors.map(a => `${a.actor} (${a.count})`).join(' · ');
  }

  reset() {
    this.step.set('upload');
    this.error.set(null);
    this.fileName.set('');
    this.pasteText.set('');
    this.headers.set([]);
    this.rows.set([]);
    this.map.set({});
    this.meetings.set([]);
    this.synthesis.set([]);
    this.expanded.set(new Set());
  }

  /** Exporte la synthèse en CSV (séparateur ';', BOM UTF-8 pour Excel FR). */
  exportSynthesis() {
    const esc = (v: string) => '"' + String(v ?? '').replace(/"/g, '""') + '"';
    const lines = [
      ['Thème', 'Type', 'Réunions', 'Durée (min)', 'Durée', 'Annulées',
       'Première réunion', 'Dernière réunion', 'Top 5 acteurs'].map(esc).join(';'),   // dates
    ];
    for (const t of this.synthesis()) {
      lines.push([
        t.label,
        t.fromFallback ? 'mot-clé' : 'code',
        String(t.count),
        String(t.totalDurationMin),
        this.fmt(t.totalDurationMin),
        String(t.cancelledCount),
        this.fmtDate(t.firstStart),
        this.fmtDate(t.lastStart),
        this.topActorsLabel(t),
      ].map(esc).join(';'));
    }
    const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'synthese-reunions.csv';
    a.click();
    URL.revokeObjectURL(url);
  }

  v(ev: Event): string { return (ev.target as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement).value; }
}
