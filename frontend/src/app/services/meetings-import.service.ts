import { Injectable } from '@angular/core';

/* ========================================================================== */
/*  Types                                                                      */
/* ========================================================================== */

/** Clés logiques des colonnes de l'export. */
export type ColKey =
  | 'subject' | 'organizer' | 'description'
  | 'required' | 'optional'
  | 'startDate' | 'startTime' | 'endDate' | 'endTime'
  | 'duration' | 'status';

export type ColumnMap = Partial<Record<ColKey, number>>;  // clé → index de colonne

export interface Meeting {
  /** Identifiant stable (indice de ligne) pour cibler une réunion dans l'UI. */
  id: number;
  subject: string;
  organizer: string;
  description: string;
  required: string[];
  optional: string[];
  start: Date | null;
  dayISO: string;
  time: string;
  durationMin: number;
  status: string;
  cancelled: boolean;
  /** Créneau de travail personnel : un organisateur, aucun participant. Exclu du comptage. */
  personal: boolean;
  /** Clé de regroupement (code ou mot-clé) et libellé affiché. */
  themeKey: string;
  themeLabel: string;
  themeFromFallback: boolean;
}

export interface ActorCount { actor: string; count: number; }

export interface ThemeSynthesis {
  key: string;
  label: string;
  fromFallback: boolean;
  count: number;              // réunions non annulées
  cancelledCount: number;
  totalDurationMin: number;
  topActors: ActorCount[];    // 5 max
  meetings: Meeting[];        // non annulées
}

export interface ImportOptions {
  /** Codes génériques exclus du regroupement (COSIT, COLEC, ITVC…). */
  excluded: string[];
  /** Alias : une désignation libre (mot/expression) rattachée à un code. */
  aliases?: { term: string; code: string }[];
  /** Termes génériques dépriorisés (projet, infra, cadrage, démo…) : jamais
   *  gagnants face à un vrai thème, mais utilisables en dernier recours. */
  generics?: string[];
}

export interface ParseResult {
  headers: string[];
  rows: string[][];
  delimiter: string;
}

@Injectable({ providedIn: 'root' })
export class MeetingsImportService {

  readonly DEFAULT_EXCLUDED = ['COSIT', 'COLEC', 'ITVC'];

  /** Termes génériques dépriorisés en cas de litige d'appartenance à un thème. */
  readonly DEFAULT_GENERICS = [
    'projet', 'projets', 'project', 'infra', 'infrastructure', 'cadrage',
    'demo', 'demonstration', 'atelier', 'reunion', 'point', 'suivi', 'revue',
    'comite', 'kickoff', 'cloture', 'jalon', 'chantier', 'dossier', 'divers',
    'coordination', 'production', 'support',
  ];

  /* ====================================================================== */
  /*  1. Lecture CSV                                                         */
  /* ====================================================================== */

  /** Parse un CSV en détectant le séparateur (',' ';' ou tab) et les guillemets. */
  parseCsv(text: string): ParseResult {
    // Retire un éventuel BOM
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    const delimiter = this.detectDelimiter(text);
    const rows: string[][] = [];
    let field = '';
    let row: string[] = [];
    let inQuotes = false;

    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (inQuotes) {
        if (c === '"') {
          if (text[i + 1] === '"') { field += '"'; i++; }
          else inQuotes = false;
        } else field += c;
      } else {
        if (c === '"') inQuotes = true;
        else if (c === delimiter) { row.push(field); field = ''; }
        else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
        else if (c === '\r') { /* ignore, géré par \n */ }
        else field += c;
      }
    }
    // dernier champ / dernière ligne
    if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }

    // Retire les lignes entièrement vides
    const clean = rows.filter(r => r.some(cell => (cell ?? '').trim() !== ''));
    const headers = (clean.shift() ?? []).map(h => h.trim());
    return { headers, rows: clean, delimiter };
  }

  private detectDelimiter(text: string): string {
    const firstLine = text.split(/\r?\n/, 1)[0] ?? '';
    const counts: Record<string, number> = {
      ';': (firstLine.match(/;/g) ?? []).length,
      ',': (firstLine.match(/,/g) ?? []).length,
      '\t': (firstLine.match(/\t/g) ?? []).length,
    };
    let best = ';', bestN = -1;
    for (const [d, n] of Object.entries(counts)) if (n > bestN) { best = d; bestN = n; }
    return bestN > 0 ? best : ';';
  }

  /* ====================================================================== */
  /*  2. Détection des colonnes                                              */
  /* ====================================================================== */

  private static readonly SYNONYMS: Record<ColKey, string[]> = {
    subject:     ['objet', 'sujet', 'subject', 'titre', 'title', 'nom de la reunion'],
    organizer:   ['organisateur', 'organizer', 'organiser', 'de', 'from', 'expediteur', 'meeting organizer'],
    description: ['description', 'corps', 'body', 'contenu', 'notes', 'ordre du jour'],
    required:    ['participants obligatoires', 'obligatoire', 'obligatoires', 'required attendees', 'required', 'participants requis', 'requis', 'destinataires principaux', 'a', 'to'],
    optional:    ['participants facultatifs', 'facultatif', 'facultatifs', 'optional attendees', 'optional', 'destinataires secondaires', 'cc', 'copie'],
    startDate:   ['date de debut', 'date debut', 'start date', 'jour', 'date', 'debut'],
    startTime:   ['heure de debut', 'heure debut', 'start time', 'heure', 'debut'],
    endDate:     ['date de fin', 'date fin', 'end date', 'fin'],
    endTime:     ['heure de fin', 'heure fin', 'end time', 'fin', 'fn'],
    duration:    ['duree planifiee', 'duree', 'duration', 'planned duration', 'duree min', 'duree minutes'],
    status:      ['etat', 'statut', 'status', 'reponse', 'meeting status', 'show time as', 'afficher l heure comme'],
  };

  /** Auto-mappe les colonnes à partir des en-têtes (FR + EN, sans accent/casse). */
  detectColumns(headers: string[]): ColumnMap {
    const norm = headers.map(h => this.normalize(h));
    const map: ColumnMap = {};
    const taken = new Set<number>();

    const find = (syns: string[], exact: boolean) => {
      for (const syn of syns) {
        // Les synonymes courts (« a », « to », « cc », « de ») ne matchent qu'en
        // correspondance exacte, jamais en « contient » (sinon ils capturent des
        // en-têtes comme « Rappel activé »).
        if (!exact && syn.length < 3) continue;
        for (let i = 0; i < norm.length; i++) {
          if (taken.has(i)) continue;
          if (exact ? norm[i] === syn : norm[i]!.includes(syn)) return i;
        }
      }
      return -1;
    };

    // Deux passes : correspondance exacte d'abord (plus fiable), puis « contient ».
    for (const pass of [true, false]) {
      for (const key of Object.keys(MeetingsImportService.SYNONYMS) as ColKey[]) {
        if (map[key] !== undefined) continue;
        const idx = find(MeetingsImportService.SYNONYMS[key], pass);
        if (idx >= 0) { map[key] = idx; taken.add(idx); }
      }
    }
    return map;
  }

  /* ====================================================================== */
  /*  3. Construction des réunions                                           */
  /* ====================================================================== */

  buildMeetings(rows: string[][], map: ColumnMap, opts: ImportOptions): Meeting[] {
    const excluded = new Set((opts.excluded ?? this.DEFAULT_EXCLUDED).map(s => s.toUpperCase().trim()).filter(Boolean));
    const get = (r: string[], k: ColKey) => (map[k] !== undefined ? (r[map[k]!] ?? '').trim() : '');
    // Peut-on statuer sur l'absence de participants ? Seulement si au moins une
    // colonne de participants est mappée (sinon l'info n'existe pas dans l'export).
    const attendeesKnown = map.required !== undefined || map.optional !== undefined;

    const meetings = rows.map((r, i) => {
      const subject = get(r, 'subject');
      const description = get(r, 'description');
      const organizer = get(r, 'organizer');
      const required = this.splitActors(get(r, 'required'));
      const optional = this.splitActors(get(r, 'optional'));

      const { date, dayISO, time } = this.parseDateTime(get(r, 'startDate'), get(r, 'startTime'));
      const durationMin = this.resolveDuration(r, map, date);
      const status = get(r, 'status');
      const cancelled = this.isCancelled(status, subject);
      // Créneau personnel réservé : un organisateur, aucun participant (ni
      // obligatoire ni facultatif). Non pertinent si l'annulation prime.
      const personal = !cancelled && attendeesKnown && !!organizer
        && required.length === 0 && optional.length === 0;

      return {
        id: i,
        subject, organizer, description, required, optional,
        start: date, dayISO, time, durationMin, status, cancelled, personal,
        themeKey: '', themeLabel: '', themeFromFallback: true,
      } as Meeting;
    });

    this.assignThemes(meetings, excluded, opts.aliases ?? [],
      (opts.generics ?? this.DEFAULT_GENERICS));
    return meetings;
  }

  /**
   * Affecte à CHAQUE réunion un thème unique (donc jamais compté dans deux
   * thèmes). Quand plusieurs thèmes sont possibles, on retient le plus pertinent
   * par un score, et les **termes génériques** (projet, infra, cadrage, démo…)
   * sont dépriorisés : ils ne l'emportent jamais sur un vrai thème, mais restent
   * utilisables en dernier recours.
   *
   * Pertinence (score décroissant) :
   *   alias explicite ≫ code applicatif prioritaire (AP+5 chiffres ou 1+6 chiffres,
   *   éventuellement [entre crochets]) ≫ code majuscule dans le sujet (4 lettres
   *   privilégié) > code dans la description > code connu en minuscules > mot-clé.
   * Quand l'objet est générique (aucun code ni mot-clé propre), la description
   * devient la meilleure source et ses codes/mots-clés jouent au niveau du sujet.
   * Départage : fréquence du code dans tout le jeu, puis proximité de 4 lettres,
   * puis ordre alphabétique (déterministe).
   */
  private assignThemes(
    meetings: Meeting[], excluded: Set<string>,
    aliases: { term: string; code: string }[], generics: string[],
  ): void {
    const gi = new Set(generics.map(g => this.normalize(g)).filter(Boolean));
    const codesOf = (s: string) => (s.match(/\b[A-Z]{3,6}\b/g) ?? []).filter(t => !excluded.has(t));
    // Codes « applicatifs » prioritaires : AP + 5 chiffres, ou 1 + 6 chiffres,
    // éventuellement entre crochets (ex. [AP01234]). Les crochets sont retirés.
    const priorityOf = (s: string) => {
      const out: string[] = [];
      for (const m of (s ?? '').matchAll(/\[?\b(AP\d{5}|1\d{6})\b\]?/g)) {
        const code = m[1]!;
        if (!excluded.has(code)) out.push(code);
      }
      return out;
    };

    // Fréquence des codes sur tout le jeu (établissement du thème).
    const freq = new Map<string, number>();
    for (const m of meetings) {
      const all = [
        ...codesOf(m.subject + ' ' + m.description),
        ...priorityOf(m.subject + ' ' + m.description),
      ];
      for (const c of new Set(all))
        freq.set(c, (freq.get(c) ?? 0) + 1);
    }
    const known = [...freq.keys()];

    const normAliases = aliases
      .filter(a => a.term?.trim() && a.code?.trim())
      .map(a => ({ term: this.normalize(a.term), code: a.code.toUpperCase().trim() }));

    for (const m of meetings) {
      const subj = m.subject || '', desc = m.description || '';
      const hay = this.normalize(subj + ' ' + desc);
      const subjPrio = priorityOf(subj), descPrio = priorityOf(desc);
      const subjCodes = codesOf(subj), descCodes = codesOf(desc);
      const kwS = this.keywordFrom(subj, excluded, gi);
      const kwD = this.keywordFrom(desc, excluded, gi);

      // L'objet est « générique » quand il n'apporte aucun thème propre : ni code
      // applicatif, ni code à lettres, et au mieux un mot-clé générique. Dans ce
      // cas la description devient la meilleure source et joue au niveau du sujet.
      const subjHasTheme = subjPrio.length > 0 || subjCodes.length > 0
        || (!!kwS && !gi.has(this.normalize(kwS)));
      const descBoost = !subjHasTheme;

      const cands: { key: string; label: string; score: number; fallback: boolean }[] = [];
      const push = (key: string, label: string, score: number, fallback: boolean) =>
        cands.push({ key, label, score, fallback });

      for (const a of normAliases) if (!excluded.has(a.code) && a.term && hay.includes(a.term)) push(a.code, a.code, 1000, false);
      // Codes applicatifs prioritaires (avant les codes à 4 lettres).
      for (const c of subjPrio) push(c, c, 200, false);
      for (const c of descPrio) push(c, c, descBoost ? 200 : 150, false);
      for (const c of subjCodes) push(c, c, c.length === 4 ? 100 : 80, false);
      // Codes de la description : au niveau du sujet si l'objet est générique.
      for (const c of descCodes) push(c, c, descBoost ? (c.length === 4 ? 100 : 80) : (c.length === 4 ? 60 : 50), false);
      for (const c of known) {                                   // occurrence en minuscules
        if (subjCodes.includes(c) || descCodes.includes(c)) continue;
        if (new RegExp('\\b' + c.toLowerCase() + '\\b').test(hay)) push(c, c, c.length === 4 ? 55 : 45, false);
      }
      if (kwS) push('kw:' + this.normalize(kwS), kwS, gi.has(this.normalize(kwS)) ? 6 : 30, true);
      // Mot-clé de la description : au niveau du sujet si l'objet est générique.
      if (kwD) push('kw:' + this.normalize(kwD), kwD, gi.has(this.normalize(kwD)) ? 5 : (descBoost ? 30 : 20), true);

      // Dépriorisation des candidats génériques (y compris un code générique).
      for (const c of cands) if (gi.has(this.normalize(c.label))) c.score = Math.min(c.score, 8);

      let best: typeof cands[number] | null = null;
      for (const c of cands) {
        if (!best) { best = c; continue; }
        if (c.score !== best.score) { if (c.score > best.score) best = c; continue; }
        const fc = freq.get(c.key) ?? 0, fb = freq.get(best.key) ?? 0;
        if (fc !== fb) { if (fc > fb) best = c; continue; }
        const dc = Math.abs(c.label.length - 4), db = Math.abs(best.label.length - 4);
        if (dc !== db) { if (dc < db) best = c; continue; }
        if (c.key < best.key) best = c;
      }

      if (best) { m.themeKey = best.key; m.themeLabel = best.label; m.themeFromFallback = best.fallback; }
      else { m.themeKey = '__nc__'; m.themeLabel = 'Non classé'; m.themeFromFallback = true; }
    }
  }

  /** Découpe une cellule de participants en acteurs (noms ou e-mails). */
  private splitActors(cell: string): string[] {
    if (!cell) return [];
    const parts = cell.includes(';') ? cell.split(';') : cell.split(/[,\n]/);
    const seen = new Set<string>();
    const out: string[] = [];
    for (let p of parts) {
      p = p.trim().replace(/^["'<]+|["'>]+$/g, '').trim();
      if (!p) continue;
      const key = this.actorKey(p);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(p);
    }
    return out;
  }

  /** Clé d'identité d'un acteur (e-mail si présent, sinon nom normalisé). */
  actorKey(actor: string): string {
    const email = actor.match(/[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}/);
    return email ? email[0].toLowerCase() : this.normalize(actor);
  }

  private resolveDuration(r: string[], map: ColumnMap, start: Date | null): number {
    const raw = map.duration !== undefined ? (r[map.duration]! ?? '').trim() : '';
    if (raw) {
      const m = raw.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);     // h:mm[:ss]
      if (m) return (+m[1]!) * 60 + (+m[2]!);
      const n = Number(raw.replace(',', '.'));
      if (Number.isFinite(n)) return Math.round(n);             // minutes
    }
    // Sinon : fin - début
    const end = this.parseDateTime(
      map.endDate !== undefined ? (r[map.endDate]! ?? '') : '',
      map.endTime !== undefined ? (r[map.endTime]! ?? '') : '',
    ).date;
    if (start && end && end > start) return Math.round((end.getTime() - start.getTime()) / 60000);
    return 0;
  }

  private isCancelled(status: string, subject: string): boolean {
    const s = this.normalize(status);
    if (/\b(annul|cancel)/.test(s)) return true;
    return /^(annul[eé]+|cancel+ed|canceled)\s*:/.test(this.normalize(subject));
  }

  /* ====================================================================== */
  /*  4. Extraction du thème                                                 */
  /* ====================================================================== */

  /* ====================================================================== */
  /*  4. Mot-clé de repli                                                    */
  /* ====================================================================== */

  private static readonly STOPWORDS = new Set([
    'reunion', 'meeting', 'call', 'point', 'comite', 'comit', 'hebdo', 'weekly', 'mensuel',
    'suivi', 'revue', 'review', 'daily', 'sync', 'atelier', 'workshop', 'session',
    'avec', 'pour', 'sur', 'les', 'des', 'une', 'the', 'and', 'and',
    // Qualificatifs de récurrence / fréquence : jamais des thèmes.
    'hebdomadaire', 'mensuelle', 'bimensuel', 'bimensuelle', 'bimestriel',
    'trimestriel', 'trimestrielle', 'trimestre', 'semestriel', 'semestrielle',
    'annuel', 'annuelle', 'quotidien', 'quotidienne', 'biweekly', 'monthly',
    'quarterly', 'periodique', 'recurrent', 'recurrente', 'reguliere', 'regulier',
  ]);

  /** Mots « cliquables » d'une réunion (objet puis description) pour proposer
   *  d'en prioriser un comme thème. On retient les mots d'au moins 3 caractères,
   *  on écarte les mots vides, et on dédoublonne (sans accent/casse). */
  candidateWords(m: Meeting): string[] {
    const out: string[] = [];
    const seen = new Set<string>();
    for (const src of [m.subject, m.description]) {
      for (const w0 of (src || '').split(/[^A-Za-zÀ-ÿ0-9]+/)) {
        const w = w0.trim();
        if (w.length < 3) continue;
        const n = this.normalize(w);
        if (!n || MeetingsImportService.STOPWORDS.has(n) || seen.has(n)) continue;
        seen.add(n);
        out.push(w);
      }
    }
    return out;
  }

  /** Mot-clé de repli : le plus long mot significatif, en privilégiant un mot
   *  NON générique ; à défaut (que des mots génériques), le plus long générique. */
  private keywordFrom(text: string, excluded: Set<string>, generics: Set<string>): string | null {
    const words = (text || '').split(/[^A-Za-zÀ-ÿ0-9]+/).filter(Boolean);
    let bestNon: string | null = null, bestGen: string | null = null;
    for (const w of words) {
      if (w.length < 4) continue;
      if (excluded.has(w.toUpperCase())) continue;
      const n = this.normalize(w);
      if (MeetingsImportService.STOPWORDS.has(n)) continue;
      if (generics.has(n)) { if (!bestGen || w.length > bestGen.length) bestGen = w; }
      else { if (!bestNon || w.length > bestNon.length) bestNon = w; }
    }
    const best = bestNon ?? bestGen;
    return best ? best.charAt(0).toUpperCase() + best.slice(1).toLowerCase() : null;
  }

  /* ====================================================================== */
  /*  5. Synthèse par thème                                                  */
  /* ====================================================================== */

  synthesize(meetings: Meeting[]): ThemeSynthesis[] {
    const groups = new Map<string, ThemeSynthesis>();
    for (const m of meetings) {
      if (m.personal) continue;   // créneaux de travail personnel : hors comptage
      let g = groups.get(m.themeKey);
      if (!g) {
        g = { key: m.themeKey, label: m.themeLabel, fromFallback: m.themeFromFallback,
              count: 0, cancelledCount: 0, totalDurationMin: 0, topActors: [], meetings: [] };
        groups.set(m.themeKey, g);
      }
      if (m.cancelled) { g.cancelledCount++; continue; }
      g.count++;
      g.totalDurationMin += m.durationMin;
      g.meetings.push(m);
    }

    // Top acteurs (par nombre de réunions non annulées du thème où l'acteur apparaît)
    for (const g of groups.values()) {
      const counts = new Map<string, { actor: string; count: number }>();
      for (const m of g.meetings) {
        const actors = [m.organizer, ...m.required, ...m.optional].filter(Boolean);
        const seen = new Set<string>();
        for (const a of actors) {
          const k = this.actorKey(a);
          if (seen.has(k)) continue;
          seen.add(k);
          const e = counts.get(k) ?? { actor: a, count: 0 };
          e.count++;
          counts.set(k, e);
        }
      }
      g.topActors = [...counts.values()].sort((a, b) => b.count - a.count).slice(0, 5);
    }

    return [...groups.values()].sort((a, b) => b.totalDurationMin - a.totalDurationMin);
  }

  /* ====================================================================== */
  /*  Outils                                                                 */
  /* ====================================================================== */

  /** Parse date (+ heure optionnelle) tolérante → Date locale + jour ISO + heure. */
  private parseDateTime(dateStr: string, timeStr: string):
    { date: Date | null; dayISO: string; time: string } {
    const empty = { date: null, dayISO: '', time: '' };
    const src = (dateStr || '').trim();
    if (!src && !timeStr) return empty;

    let y = 0, mo = 0, d = 0, h = 0, mi = 0;
    let mm = src.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);        // ISO
    if (mm) { y = +mm[1]!; mo = +mm[2]!; d = +mm[3]!; }
    else {
      mm = src.match(/(\d{1,2})[\/.](\d{1,2})[\/.](\d{2,4})/); // dd/mm/yyyy
      if (mm) { d = +mm[1]!; mo = +mm[2]!; y = +mm[3]!; if (y < 100) y += 2000; }
      else return empty;
    }
    // Heure : dans la cellule date, sinon dans la cellule heure dédiée
    const timeSrc = (src.match(/(\d{1,2}):(\d{2})/) ? src : (timeStr || ''));
    const tm = timeSrc.match(/(\d{1,2}):(\d{2})/);
    if (tm) { h = +tm[1]!; mi = +tm[2]!; }

    const date = new Date(y, mo - 1, d, h, mi);
    if (isNaN(date.getTime())) return empty;
    const dayISO = `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const time = `${String(h).padStart(2, '0')}:${String(mi).padStart(2, '0')}`;
    return { date, dayISO, time };
  }

  normalize(s: string): string {
    return String(s ?? '').toLowerCase()
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/\s+/g, ' ').trim();
  }

  /** Minutes → « 1 h 30 » / « 45 min ». */
  formatDuration(min: number): string {
    const h = Math.floor(min / 60), m = min % 60;
    if (h && m) return `${h} h ${String(m).padStart(2, '0')}`;
    if (h) return `${h} h`;
    return `${m} min`;
  }
}
