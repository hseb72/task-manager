import { Router } from 'express';
import { db } from '../db/client.js';
import { fetchPage } from '../services/pageFetcher.js';

const router = Router();

/* -------------------------------------------------------------------------- */
/*  Enrichissement d'un contact depuis une source web interne                  */
/*                                                                             */
/*  POST /api/enrich                                                           */
/*    body : { nom: string, sourceId?: number }                                */
/*                                                                             */
/*  L'outil construit l'URL de la source (le marqueur {nom} y est remplacé     */
/*  par le nom du contact), récupère la page côté serveur, en extrait des      */
/*  paires « libellé : valeur », puis déduit le service et l'entité            */
/*  (« métier ») de rattachement en les rapprochant des référentiels.          */
/*  La route ne modifie rien : le frontend applique la proposition validée.    */
/* -------------------------------------------------------------------------- */

const SERVICE_KEYS = [
  'service', 'departement', 'dept', 'equipe', 'team', 'unite', 'pole',
  'division', 'cellule', 'bureau',
];
const ENTITE_KEYS = [
  'entite', 'entity', 'direction', 'societe', 'company', 'organisation',
  'organization', 'business unit', 'bu', 'etablissement', 'filiale', 'site',
];

/** Minuscule, sans accents, espaces normalisés. */
function norm(s) {
  return String(s ?? '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Décode quelques entités HTML courantes. */
function decodeEntities(s) {
  return String(s)
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#0*39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}

/** Retire les balises d'un fragment HTML → texte simple. */
function stripTags(html) {
  return decodeEntities(String(html).replace(/<[^>]*>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Applique un gabarit d'URL : remplace les marqueurs {clé} par les valeurs
 * fournies (URL-encodées). Renvoie l'URL et si un marqueur a été utilisé.
 */
function applyTemplate(template, params) {
  let url = String(template);
  let used = false;
  for (const [key, value] of Object.entries(params)) {
    const re = new RegExp('\\{\\s*' + key + '\\s*\\}', 'gi');
    if (re.test(url)) { url = url.replace(re, encodeURIComponent(value)); used = true; }
  }
  return { url, used };
}

/** URL de l'étape 1 (recherche par nom). */
function buildUrl(template, nom) {
  const { url, used } = applyTemplate(template, { nom, name: nom, q: nom });
  if (used) return url;
  const sep = template.includes('?') ? '&' : '?';
  return template + sep + 'q=' + encodeURIComponent(nom);
}

/** URL de l'étape 2 (détail par UID). */
function buildUidUrl(template, uid, nom) {
  const { url, used } = applyTemplate(template, { uid, id: uid, nom, name: nom });
  if (used) return url;
  const sep = template.includes('?') ? '&' : '?';
  return template + sep + 'uid=' + encodeURIComponent(uid);
}

/** Clés de libellé pouvant porter l'identifiant unique du contact. */
const UID_KEYS = ['uid', 'matricule', 'identifiant', 'user id', 'userid', 'login', 'ntid'];

/**
 * Extrait l'UID de la page de l'étape 1.
 *  1. via `uid_regex` (groupe 1 si présent, sinon correspondance entière) ;
 *  2. sinon via une paire libellé/valeur (UID, matricule, identifiant…) ;
 *  3. sinon via un lien href contenant uid=/id= ou /users/<id>.
 */
function extractUid(html, uidRegex) {
  if (uidRegex) {
    try {
      const m = new RegExp(uidRegex, 'i').exec(html);
      if (m) return String(m[1] ?? m[0]).trim();
    } catch { /* regex invalide : on ignore et on passe aux heuristiques */ }
  }

  const pairs = htmlToPairs(html);
  for (const p of pairs) {
    const k = norm(p.key);
    if (!p.value) continue;
    if (k === 'uid' || k === 'id' || UID_KEYS.some(kw => k.includes(kw))) {
      return p.value.trim();
    }
  }

  const hrefs = [...String(html).matchAll(/href\s*=\s*["']([^"']+)["']/gi)].map(m => m[1]);
  for (const h of hrefs) {
    const m = h.match(/(?:uid|matricule|id)=([A-Za-z0-9._~-]+)/i)
           || h.match(/\/(?:uid|matricule|users?)\/([A-Za-z0-9._~-]+)/i);
    if (m) return m[1];
  }
  return null;
}

/**
 * Extrait des paires { key, value } depuis le HTML :
 *  - lignes de tableau (<th>/<td> ou deux <td>),
 *  - listes de définitions (<dt>/<dd>),
 *  - lignes texte « Libellé : valeur ».
 */
function htmlToPairs(html) {
  const pairs = [];
  const src = String(html).replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, ' ');

  // <tr> ... </tr>
  for (const tr of src.match(/<tr[\s\S]*?<\/tr>/gi) ?? []) {
    const cells = (tr.match(/<t[hd][\s\S]*?<\/t[hd]>/gi) ?? []).map(stripTags).filter(Boolean);
    if (cells.length >= 2) pairs.push({ key: cells[0], value: cells[1] });
  }

  // <dt>/<dd>
  const dl = /<dt[^>]*>([\s\S]*?)<\/dt>\s*<dd[^>]*>([\s\S]*?)<\/dd>/gi;
  let m;
  while ((m = dl.exec(src))) {
    pairs.push({ key: stripTags(m[1]), value: stripTags(m[2]) });
  }

  // Lignes texte « Libellé : valeur »
  const text = stripTags(src);
  for (const line of text.split(/[\n\r]+|(?<=\.)\s{2,}/)) {
    const mm = line.match(/^\s*([A-Za-zÀ-ÿ0-9 '\/\-]{2,40})\s*[:：]\s*(.+?)\s*$/);
    if (mm) pairs.push({ key: mm[1], value: mm[2] });
  }
  return pairs;
}

/** Première valeur dont la clé contient l'un des mots-clés. */
function pickByKeys(pairs, keys) {
  for (const p of pairs) {
    const k = norm(p.key);
    if (keys.some(kw => k.includes(kw)) && p.value) return p.value.trim();
  }
  return null;
}

/** Meilleur rapprochement d'un texte avec une liste de référentiels. */
function bestMatch(rows, field, text) {
  const t = norm(text);
  if (!t) return null;
  // 1. Égalité stricte
  let hit = rows.find(r => norm(r[field]) === t);
  if (hit) return hit;
  // 2. Inclusion (dans un sens ou l'autre), on garde le libellé le plus long
  let best = null;
  for (const r of rows) {
    const f = norm(r[field]);
    if (!f) continue;
    if (t.includes(f) || f.includes(t)) {
      if (!best || f.length > norm(best[field]).length) best = r;
    }
  }
  return best;
}

router.post('/', async (req, res, next) => {
  try {
    const nom = (req.body?.nom ?? '').trim();
    const sourceId = req.body?.sourceId != null && req.body.sourceId !== ''
      ? Number(req.body.sourceId) : null;
    if (!nom) return res.status(400).json({ error: 'Nom du contact requis' });

    // Source web : celle demandée, sinon la première active
    let src;
    if (sourceId) {
      const { rows } = await db.execute({ sql: 'SELECT * FROM sources_web WHERE id = ?', args: [sourceId] });
      src = rows[0];
    } else {
      const { rows } = await db.execute('SELECT * FROM sources_web WHERE actif = 1 ORDER BY id LIMIT 1');
      src = rows[0];
    }
    if (!src) {
      return res.status(400).json({
        error: 'Aucune source web active. Ajoutez-en une dans Référentiels → Sources web.',
      });
    }

    const timeoutMs = src.rendu_js ? 20000 : 10000;
    const url1 = buildUrl(String(src.url), nom);
    const useUidStep = !!(src.url_uid && String(src.url_uid).trim());

    const fetchOr502 = async (u, etape) => {
      try {
        return await fetchPage(src, u, { timeoutMs });
      } catch (e) {
        const reason = e?.name === 'AbortError' || /Timeout/i.test(e?.message ?? '')
          ? 'délai dépassé'
          : (e?.message ?? String(e));
        const suffix = etape ? ` (étape ${etape})` : '';
        const err = new Error('Impossible de joindre la source' + suffix + ' : ' + reason);
        err.url = u;
        throw err;
      }
    };

    // Étape 1 : recherche par nom → page/tuile contenant l'UID.
    // Étape 2 (optionnelle) : détail par UID → service/entité.
    let html, url, uid = null;
    try {
      const html1 = await fetchOr502(url1, useUidStep ? 1 : null);
      if (useUidStep) {
        uid = extractUid(html1, src.uid_regex);
        if (!uid) {
          return res.status(422).json({
            error: 'UID introuvable sur la page de recherche (étape 1). '
                 + 'Précisez l\'« extraction UID » de la source.',
            url: url1,
          });
        }
        url = buildUidUrl(String(src.url_uid), uid, nom);
        html = await fetchOr502(url, 2);
      } else {
        html = html1;
        url = url1;
      }
    } catch (e) {
      return res.status(502).json({ error: e.message, url: e.url ?? url1 });
    }

    // Déduction service / entité
    const pairs = htmlToPairs(html);
    const serviceText = pickByKeys(pairs, SERVICE_KEYS);
    const entiteText  = pickByKeys(pairs, ENTITE_KEYS);

    const { rows: services } = await db.execute(`
      SELECT s.id, s.libelle, s.entite_id, e.libelle AS entite_libelle
      FROM services s LEFT JOIN entites e ON s.entite_id = e.id
    `);
    const { rows: entites } = await db.execute('SELECT id, libelle FROM entites');

    const entiteMatch = entiteText ? bestMatch(entites, 'libelle', entiteText) : null;
    let serviceMatch  = serviceText ? bestMatch(services, 'libelle', serviceText) : null;
    // Si l'entité est connue, on privilégie un service rattaché à cette entité.
    if (serviceText && entiteMatch) {
      const within = services.filter(s => s.entite_id === entiteMatch.id);
      const refined = bestMatch(within, 'libelle', serviceText);
      if (refined) serviceMatch = refined;
    }

    res.json({
      url,
      url1: useUidStep ? url1 : null,
      uid,
      source: { id: src.id, libelle: src.libelle },
      deduced: { service: serviceText || null, entite: entiteText || null },
      serviceMatch: serviceMatch
        ? { id: serviceMatch.id, libelle: serviceMatch.libelle,
            entite_id: serviceMatch.entite_id, entite_libelle: serviceMatch.entite_libelle }
        : null,
      entiteMatch: entiteMatch ? { id: entiteMatch.id, libelle: entiteMatch.libelle } : null,
      pairsFound: pairs.length,
    });
  } catch (err) { next(err); }
});

export default router;
