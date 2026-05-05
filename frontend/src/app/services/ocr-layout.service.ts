import { Injectable } from '@angular/core';
import { OcrLine, OcrPageResult, BBox } from './ocr.service';

/* ========================================================================== */
/*  Types                                                                      */
/* ========================================================================== */

export type ZoneKind =
  | 'title'        // titre principal de la page/écran
  | 'field'        // paire libellé : valeur
  | 'description'  // bloc de texte multi-ligne (paragraphe)
  | 'contact'      // carte contact (nom + rôle)
  | 'unknown';     // texte non classifié

export interface DetectedZone {
  id: string;
  kind: ZoneKind;
  bbox: BBox;
  /** Pour 'field' : libellé canonique (ex: "title", "code", "domain"). */
  fieldKey?: string;
  /** Texte du libellé tel que reconnu. */
  label?: string;
  /** Valeur reconnue pour cette zone. */
  value?: string;
  /** Confiance moyenne sur la zone (0-100). */
  confidence: number;
  /** Lignes OCR sources (pour debug et édition manuelle). */
  sourceLines: OcrLine[];
}

/** Données structurées finales (consommées par le formulaire de création). */
export interface ExtractedTaskFromZones {
  libelle?: string;
  description?: string;
  dateDeclaration?: string;
  dateEcheance?: string;
  domaineHint?: string;
  contacts: Array<{
    nom: string;
    email?: string;
    role?: string;
    source: 'sender' | 'recipient' | 'cc' | 'mentioned';
  }>;
  zones: DetectedZone[];
  rawText: string;
  confidence: number;
}

/* ========================================================================== */
/*  Vocabulaire des libellés reconnus (FR + EN)                                */
/* ========================================================================== */

/**
 * Map : libellé en minuscules (sans accents) → clé canonique.
 * Cette table couvre les libellés CMDB / outils internes typiques.
 */
const FIELD_LABELS: Record<string, string> = {
  // Titre / libellé
  'change title': 'title',
  'title': 'title',
  'titre': 'title',
  'libelle': 'title',
  'object': 'title',
  'objet': 'title',
  'subject': 'title',
  'sujet': 'title',
  'name': 'title',
  'nom de la tache': 'title',

  // Identifiant
  'change code': 'code',
  'code': 'code',
  'id': 'code',
  'reference': 'code',
  'ref': 'code',
  'ticket': 'code',

  // Description
  'change description': 'description',
  'description': 'description',
  'detail': 'description',
  'details': 'description',
  'commentaire': 'description',
  'comments': 'description',

  // Dates
  'creation date': 'date_declaration',
  'date de creation': 'date_declaration',
  'created': 'date_declaration',
  'created on': 'date_declaration',
  'declared': 'date_declaration',
  'declaration': 'date_declaration',
  'date': 'date_declaration',
  'envoye': 'date_declaration',
  'sent': 'date_declaration',
  'recu': 'date_declaration',
  'received': 'date_declaration',

  'due date': 'date_echeance',
  'deadline': 'date_echeance',
  'echeance': 'date_echeance',
  'date d echeance': 'date_echeance',
  'target date': 'date_echeance',

  'end date': 'date_fin',
  'date de fin': 'date_fin',
  'closed': 'date_fin',

  // Domaine / catégorie
  'domain': 'domaine',
  'domaine': 'domaine',
  'tribe': 'domaine',
  'domain tribe': 'domaine',
  'domain/tribe': 'domaine',
  'category': 'domaine',
  'categorie': 'domaine',
  'type': 'domaine',
  'change type': 'domaine',

  // Statut
  'status': 'etat',
  'statut': 'etat',
  'etat': 'etat',
  'state': 'etat',
};

/** Rôles connus ou récurrents dans les outils internes. */
const KNOWN_ROLES = new Set([
  'sponsor', 'architect', 'architecte', 'owner', 'manager',
  'accountable', 'change accountable', 'responsable',
  'approver', 'reviewer', 'developer', 'developpeur',
  'product owner', 'business analyst', 'demandeur', 'requester',
  'suiveur', 'validateur', 'informateur',
]);

/* ========================================================================== */
/*  Service                                                                    */
/* ========================================================================== */

@Injectable({ providedIn: 'root' })
export class OcrLayoutService {

  /** Pipeline complet : transforme un OcrPageResult en zones + données extraites. */
  analyze(ocr: OcrPageResult): ExtractedTaskFromZones {
    const zones = this.detectZones(ocr);
    return this.zonesToTaskData(zones, ocr);
  }

  /* ====================================================================== */
  /*  Détection de zones                                                     */
  /* ====================================================================== */

  detectZones(ocr: OcrPageResult): DetectedZone[] {
    const lines = ocr.lines;
    if (lines.length === 0) return [];

    const used = new Set<number>();
    const zones: DetectedZone[] = [];

    // 1. Titre : la ligne avec la plus grande taille de police, en haut de l'image
    const titleZone = this.detectTitle(lines, used);
    if (titleZone) zones.push(titleZone);

    // 2. Cartes contacts : groupes de lignes avec un rôle reconnu
    const contactZones = this.detectContacts(lines, used);
    zones.push(...contactZones);

    // 3. Champs clé:valeur (par mot-clé reconnu en début de ligne)
    const fieldZones = this.detectFields(lines, used);
    zones.push(...fieldZones);

    // 4. Description : les lignes restantes situées sous un libellé "description"
    //    sont fusionnées en une zone description, ou laissées en unknown sinon.
    this.extendDescriptionZone(zones, lines, used);

    // 5. Le reste devient des zones unknown (utile pour annotation manuelle)
    for (let i = 0; i < lines.length; i++) {
      if (!used.has(i)) {
        zones.push({
          id: 'z_' + zones.length,
          kind: 'unknown',
          bbox: lines[i]!.bbox,
          confidence: lines[i]!.confidence,
          value: lines[i]!.text,
          sourceLines: [lines[i]!],
        });
      }
    }

    return zones;
  }

  /* ----- Titre ----- */

  private detectTitle(lines: OcrLine[], used: Set<number>): DetectedZone | null {
    // Cherche la ligne avec la plus grande hauteur de police dans le tiers supérieur
    const top = lines[lines.length - 1]!.bbox.y1 / 3; // tiers supérieur
    let best = -1;
    let bestHeight = 0;
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i]!;
      if (l.bbox.y0 > top) break; // tri par y, donc on peut s'arrêter
      if (l.fontHeight > bestHeight && l.text.length > 4) {
        bestHeight = l.fontHeight;
        best = i;
      }
    }
    if (best < 0) return null;

    const line = lines[best]!;
    used.add(best);
    return {
      id: 'z_title',
      kind: 'title',
      bbox: line.bbox,
      label: 'title',
      fieldKey: 'title',
      value: line.text,
      confidence: line.confidence,
      sourceLines: [line],
    };
  }

  /* ----- Contacts ----- */

  /**
   * Détecte les "cartes contacts" : recherche les lignes contenant un rôle connu
   * (Sponsor, Architect, Accountable…), puis associe la ligne juste au-dessus
   * comme nom du contact.
   */
  private detectContacts(lines: OcrLine[], used: Set<number>): DetectedZone[] {
    const zones: DetectedZone[] = [];
    for (let i = 0; i < lines.length; i++) {
      if (used.has(i)) continue;
      const l = lines[i]!;
      const norm = this.normalize(l.text);
      // Heuristique : un rôle est une ligne courte, faite uniquement de mots de rôles connus
      if (!this.looksLikeRole(norm)) continue;

      // Cherche la ligne nom : juste au-dessus, alignée horizontalement, en majuscules ou capitalisée
      const nameIdx = this.findNameLineAbove(lines, i, used);
      if (nameIdx < 0) continue;

      const nameLine = lines[nameIdx]!;
      const roleLine = l;

      // Email éventuel sur une ligne adjacente
      const emailIdx = this.findEmailNear(lines, [nameIdx, i], used);

      const sourceLines = [nameLine, roleLine];
      if (emailIdx >= 0) sourceLines.push(lines[emailIdx]!);

      const bbox = this.unionBBox(sourceLines.map(s => s.bbox));
      const conf = sourceLines.reduce((a, s) => a + s.confidence, 0) / sourceLines.length;

      zones.push({
        id: 'z_contact_' + zones.length,
        kind: 'contact',
        bbox,
        confidence: conf,
        value: nameLine.text,
        label: roleLine.text, // role
        sourceLines,
      });

      used.add(nameIdx);
      used.add(i);
      if (emailIdx >= 0) used.add(emailIdx);
    }
    return zones;
  }

  private looksLikeRole(textNorm: string): boolean {
    const words = textNorm.split(/\s+/).filter(Boolean);
    if (words.length === 0 || words.length > 4) return false;
    // Match exact d'un rôle complet
    if (KNOWN_ROLES.has(textNorm)) return true;
    // Match si tous les mots sont des fragments de rôles
    const roleWords = new Set<string>();
    for (const r of KNOWN_ROLES) r.split(' ').forEach(w => roleWords.add(w));
    return words.every(w => roleWords.has(w));
  }

  private findNameLineAbove(lines: OcrLine[], roleIdx: number, used: Set<number>): number {
    const role = lines[roleIdx]!;
    // On regarde les 3 lignes au-dessus, et on garde la plus proche qui ressemble à un nom
    for (let j = roleIdx - 1; j >= Math.max(0, roleIdx - 3); j--) {
      if (used.has(j)) continue;
      const l = lines[j]!;
      // Distance verticale raisonnable (max 3× la hauteur du rôle)
      if (role.bbox.y0 - l.bbox.y1 > role.fontHeight * 3) break;
      // Alignement horizontal (chevauchement des bbox en x)
      if (!this.overlapX(l.bbox, role.bbox, 0.3)) continue;
      // Filtre : doit avoir au moins une majuscule et 2-5 mots
      const words = l.text.split(/\s+/).filter(Boolean);
      if (words.length < 1 || words.length > 5) continue;
      if (!/[A-ZÀ-Ý]/.test(l.text)) continue;
      // Ne doit pas être un libellé connu (sinon on confond avec un champ)
      if (FIELD_LABELS[this.normalize(l.text)]) continue;
      return j;
    }
    return -1;
  }

  private findEmailNear(lines: OcrLine[], indices: number[], used: Set<number>): number {
    const minIdx = Math.max(0, Math.min(...indices) - 2);
    const maxIdx = Math.min(lines.length - 1, Math.max(...indices) + 2);
    for (let j = minIdx; j <= maxIdx; j++) {
      if (used.has(j) || indices.includes(j)) continue;
      if (/\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b/.test(lines[j]!.text)) return j;
    }
    return -1;
  }

  /* ----- Champs (libellé : valeur) ----- */

  private detectFields(lines: OcrLine[], used: Set<number>): DetectedZone[] {
    const zones: DetectedZone[] = [];

    for (let i = 0; i < lines.length; i++) {
      if (used.has(i)) continue;
      const line = lines[i]!;

      // Cas 1 : libellé et valeur sur la même ligne, séparés par ":"
      const sameLine = line.text.match(/^\s*([\wÀ-ÿ\s\/-]+?)\s*[:\-—]\s*(.+?)\s*$/);
      if (sameLine) {
        const label = sameLine[1]!.trim();
        const value = sameLine[2]!.trim();
        const key = FIELD_LABELS[this.normalize(label)];
        if (key) {
          zones.push({
            id: 'z_field_' + zones.length,
            kind: 'field',
            bbox: line.bbox,
            fieldKey: key,
            label,
            value,
            confidence: line.confidence,
            sourceLines: [line],
          });
          used.add(i);
          continue;
        }
      }

      // Cas 2 : libellé seul ; la valeur est à droite (même hauteur, x plus grand)
      //         ou en dessous (x à peu près identique).
      const labelKey = FIELD_LABELS[this.normalize(line.text)];
      if (!labelKey) continue;

      // Recherche d'une ligne candidate à droite, à la même hauteur
      const right = this.findValueRight(lines, i, used);
      if (right >= 0) {
        const valLine = lines[right]!;
        const bbox = this.unionBBox([line.bbox, valLine.bbox]);
        zones.push({
          id: 'z_field_' + zones.length,
          kind: 'field',
          bbox,
          fieldKey: labelKey,
          label: line.text,
          value: valLine.text,
          confidence: (line.confidence + valLine.confidence) / 2,
          sourceLines: [line, valLine],
        });
        used.add(i);
        used.add(right);
        continue;
      }

      // Recherche d'une ligne candidate juste en dessous, alignée à gauche
      const below = this.findValueBelow(lines, i, used);
      if (below >= 0) {
        const valLine = lines[below]!;
        const bbox = this.unionBBox([line.bbox, valLine.bbox]);
        zones.push({
          id: 'z_field_' + zones.length,
          kind: 'field',
          bbox,
          fieldKey: labelKey,
          label: line.text,
          value: valLine.text,
          confidence: (line.confidence + valLine.confidence) / 2,
          sourceLines: [line, valLine],
        });
        used.add(i);
        used.add(below);
        continue;
      }
    }

    return zones;
  }

  private findValueRight(lines: OcrLine[], labelIdx: number, used: Set<number>): number {
    const label = lines[labelIdx]!;
    for (let j = 0; j < lines.length; j++) {
      if (j === labelIdx || used.has(j)) continue;
      const l = lines[j]!;
      // Même hauteur (chevauchement vertical)
      if (!this.overlapY(label.bbox, l.bbox, 0.5)) continue;
      // À droite (x_start > label.x_end)
      if (l.bbox.x0 < label.bbox.x1) continue;
      // Distance raisonnable (< 60% de la largeur de l'image)
      return j;
    }
    return -1;
  }

  private findValueBelow(lines: OcrLine[], labelIdx: number, used: Set<number>): number {
    const label = lines[labelIdx]!;
    let best = -1;
    let bestDist = Infinity;
    for (let j = labelIdx + 1; j < lines.length; j++) {
      if (used.has(j)) continue;
      const l = lines[j]!;
      // Doit être en dessous
      if (l.bbox.y0 < label.bbox.y1) continue;
      // Alignement horizontal sur le début (x0 proche)
      const dx = Math.abs(l.bbox.x0 - label.bbox.x0);
      if (dx > label.fontHeight * 2) continue;
      // Distance verticale raisonnable
      const dy = l.bbox.y0 - label.bbox.y1;
      if (dy > label.fontHeight * 3) break;
      if (dy < bestDist) {
        bestDist = dy;
        best = j;
      }
    }
    return best;
  }

  /* ----- Description ----- */

  /**
   * Si une zone "field" avec key=description a été détectée, on essaie d'étendre
   * la valeur en agrégeant les lignes suivantes du paragraphe.
   *
   * Heuristique : on garde toutes les lignes situées dans la "colonne valeur"
   * (alignement avec la première ligne valeur), tant que :
   *  - elles ne sont pas trop loin verticalement,
   *  - elles ne portent pas un libellé connu,
   *  - elles ne ressemblent pas à un rôle ou à une carte contact,
   *  - leur x0 reste dans une marge raisonnable de la colonne.
   */
  private extendDescriptionZone(zones: DetectedZone[], lines: OcrLine[], used: Set<number>): void {
    const descZone = zones.find(z => z.kind === 'field' && z.fieldKey === 'description');
    if (!descZone) return;

    const last = descZone.sourceLines[descZone.sourceLines.length - 1]!;
    const lastIdx = lines.indexOf(last);
    if (lastIdx < 0) return;

    // La "colonne valeur" est définie par la bbox de la première ligne de valeur.
    // Sa borne gauche `colX0` sert de référence pour l'alignement.
    const valueLine = descZone.sourceLines.find(l => l !== descZone.sourceLines[0])
                   ?? descZone.sourceLines[0]!;
    const colX0 = valueLine.bbox.x0;
    // Marge tolérée : 8% de la largeur typique de la valeur (avec un minimum
    // raisonnable pour que les premiers caractères puissent dériver un peu).
    const valueWidth = valueLine.bbox.x1 - valueLine.bbox.x0;
    const tolX = Math.max(40, valueWidth * 0.15);

    const merged: OcrLine[] = [...descZone.sourceLines];
    let aggregated = descZone.value ?? '';
    let prev = last;

    for (let j = lastIdx + 1; j < lines.length; j++) {
      if (used.has(j)) break;
      const l = lines[j]!;

      // Garde-fous : libellé connu ou rôle reconnu → fin du paragraphe
      const norm = this.normalize(l.text);
      if (FIELD_LABELS[norm]) break;
      if (this.looksLikeRole(norm)) break;
      // Ligne en majuscules courte qui ressemble à un nom de contact (heuristique souple)
      if (/^[A-ZÀ-Ý][A-ZÀ-Ý\s\-]{2,40}$/.test(l.text.trim()) && l.text.trim().split(/\s+/).length <= 4) {
        // Vérifie la ligne suivante : si c'est un rôle, c'est probablement le début d'une carte contact
        const next = lines[j + 1];
        if (next && this.looksLikeRole(this.normalize(next.text))) break;
      }

      // Alignement horizontal : doit rester dans la colonne valeur
      if (l.bbox.x0 < colX0 - tolX) break;       // dérive trop à gauche → autre colonne (label)
      if (l.bbox.x0 > colX0 + tolX * 3) break;   // texte d'une autre colonne plus à droite

      // Espacement vertical : on tolère jusqu'à 2.5× la hauteur
      const dy = l.bbox.y0 - prev.bbox.y1;
      if (dy > l.fontHeight * 2.5) break;
      if (dy < -l.fontHeight) break;             // mauvais ordre (ne devrait pas arriver, sécurité)

      aggregated += '\n' + l.text;
      merged.push(l);
      used.add(j);
      prev = l;
    }

    descZone.value = aggregated.trim();
    descZone.sourceLines = merged;
    descZone.bbox = this.unionBBox(merged.map(m => m.bbox));
  }

  /* ====================================================================== */
  /*  Conversion zones → données structurées                                 */
  /* ====================================================================== */

  private zonesToTaskData(zones: DetectedZone[], ocr: OcrPageResult): ExtractedTaskFromZones {
    const out: ExtractedTaskFromZones = {
      contacts: [],
      zones,
      rawText: ocr.text,
      confidence: ocr.confidence,
    };

    for (const z of zones) {
      if (z.kind === 'title') {
        out.libelle = (z.value ?? '').replace(/\s+/g, ' ').trim();
      } else if (z.kind === 'field') {
        switch (z.fieldKey) {
          case 'title':
            if (!out.libelle) out.libelle = z.value;
            break;
          case 'description':
            out.description = (z.value ?? '').trim();
            break;
          case 'date_declaration':
            out.dateDeclaration = this.parseDate(z.value ?? '');
            break;
          case 'date_echeance':
            out.dateEcheance = this.parseDate(z.value ?? '');
            break;
          case 'domaine':
            out.domaineHint = (z.value ?? '').trim();
            break;
        }
      } else if (z.kind === 'contact') {
        const role = (z.label ?? '').trim();
        const nom = (z.value ?? '').trim();
        // Email éventuel dans les sourceLines
        const emailLine = z.sourceLines.find(l =>
          /\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b/.test(l.text)
        );
        const email = emailLine?.text.match(/\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b/)?.[0];
        out.contacts.push({
          nom,
          role: role || undefined,
          email: email || undefined,
          source: 'mentioned',
        });
      }
    }

    return out;
  }

  /* ====================================================================== */
  /*  Outils                                                                 */
  /* ====================================================================== */

  /** Normalise un libellé pour matcher avec FIELD_LABELS (sans accent, minuscule). */
  private normalize(s: string): string {
    return s
      .toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // retire les accents
      .replace(/[^a-z0-9\s/]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private overlapX(a: BBox, b: BBox, ratio: number): boolean {
    const intersect = Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0));
    const minWidth = Math.min(a.x1 - a.x0, b.x1 - b.x0);
    return intersect >= minWidth * ratio;
  }
  private overlapY(a: BBox, b: BBox, ratio: number): boolean {
    const intersect = Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0));
    const minHeight = Math.min(a.y1 - a.y0, b.y1 - b.y0);
    return intersect >= minHeight * ratio;
  }
  private unionBBox(boxes: BBox[]): BBox {
    return {
      x0: Math.min(...boxes.map(b => b.x0)),
      y0: Math.min(...boxes.map(b => b.y0)),
      x1: Math.max(...boxes.map(b => b.x1)),
      y1: Math.max(...boxes.map(b => b.y1)),
    };
  }

  /** Parse une date dans plusieurs formats (FR + ISO) → 'YYYY-MM-DD'. */
  private parseDate(text: string): string | undefined {
    const months: Record<string, number> = {
      'janvier': 1, 'jan': 1, 'fevrier': 2, 'fev': 2, 'mars': 3, 'mar': 3,
      'avril': 4, 'avr': 4, 'mai': 5, 'juin': 6, 'juillet': 7, 'juil': 7, 'jul': 7,
      'aout': 8, 'septembre': 9, 'sept': 9, 'sep': 9, 'octobre': 10, 'oct': 10,
      'novembre': 11, 'nov': 11, 'decembre': 12, 'dec': 12,
    };
    const norm = this.normalize(text);

    let m = text.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (m) return this.toIso(+m[3]!, +m[2]!, +m[1]!);

    m = text.match(/(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{2,4})/);
    if (m) {
      let y = +m[3]!; if (y < 100) y += y < 50 ? 2000 : 1900;
      return this.toIso(+m[1]!, +m[2]!, y);
    }

    m = norm.match(/(\d{1,2})\s+([a-z]+)\s+(\d{4})/);
    if (m) {
      const month = months[m[2]!];
      if (month) return this.toIso(+m[1]!, month, +m[3]!);
    }

    return undefined;
  }
  private toIso(d: number, m: number, y: number): string | undefined {
    if (d < 1 || d > 31 || m < 1 || m > 12 || y < 1900 || y > 2200) return undefined;
    return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  }
}