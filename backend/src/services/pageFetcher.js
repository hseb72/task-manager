/* -------------------------------------------------------------------------- */
/*  Récupération d'une page web pour l'enrichissement                          */
/*                                                                             */
/*  Deux modes, choisis par la source (`rendu_js`) :                           */
/*   - HTTP simple (fetch) : rapide, pour les pages renvoyées telles quelles ; */
/*   - Navigateur headless (Playwright) : rend le JavaScript avant lecture.    */
/*                                                                             */
/*  Authentification optionnelle portée par la source (`auth_type`) :          */
/*   - basic  : identifiant + secret (mot de passe)                            */
/*   - bearer : secret = jeton (en-tête Authorization: Bearer …)               */
/*   - header : en-tête personnalisé (auth_header) = secret                    */
/*   - cookie : secret = chaîne d'en-tête Cookie « k=v; k2=v2 »                */
/* -------------------------------------------------------------------------- */

/** En-têtes HTTP dérivés de la configuration d'authentification de la source. */
function authHeaders(src) {
  const type = (src.auth_type || 'none').toLowerCase();
  const secret = src.auth_secret || '';
  const user = src.auth_user || '';
  switch (type) {
    case 'basic':
      return { Authorization: 'Basic ' + Buffer.from(`${user}:${secret}`).toString('base64') };
    case 'bearer':
      return { Authorization: 'Bearer ' + secret };
    case 'header':
      return secret ? { [src.auth_header || 'Authorization']: secret } : {};
    case 'cookie':
      return secret ? { Cookie: secret } : {};
    default:
      return {};
  }
}

/** Récupération via fetch (pas de rendu JavaScript). */
async function fetchViaHttp(src, url, timeoutMs) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const resp = await fetch(url, {
      signal: ctrl.signal,
      redirect: 'follow',
      headers: {
        'User-Agent': 'task-manager-enrich/1.0',
        'Accept': 'text/html,*/*',
        ...authHeaders(src),
      },
    });
    if (!resp.ok) {
      const err = new Error(`La source a répondu ${resp.status} ${resp.statusText}`);
      err.httpStatus = resp.status;
      throw err;
    }
    return await resp.text();
  } finally {
    clearTimeout(timer);
  }
}

/** Récupération via un navigateur headless (rend le JavaScript). */
async function fetchViaBrowser(src, url, timeoutMs) {
  let chromium;
  try {
    ({ chromium } = await import('playwright'));
  } catch {
    const err = new Error(
      'Le rendu JavaScript nécessite Playwright. Installez-le côté serveur : ' +
      '`npm i playwright` puis `npx playwright install chromium`.',
    );
    err.playwrightMissing = true;
    throw err;
  }

  const launchOpts = { headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] };
  // Permet de pointer explicitement l'exécutable (environnements où le
  // navigateur est pré-installé à un emplacement non standard).
  if (process.env.PLAYWRIGHT_CHROMIUM_PATH) {
    launchOpts.executablePath = process.env.PLAYWRIGHT_CHROMIUM_PATH;
  }

  const browser = await chromium.launch(launchOpts);
  try {
    const type = (src.auth_type || 'none').toLowerCase();
    const secret = src.auth_secret || '';
    const ctxOpts = { ignoreHTTPSErrors: true, userAgent: 'task-manager-enrich/1.0' };

    const extra = {};
    if (type === 'basic') {
      // httpCredentials répond à un challenge 401 ; on ajoute aussi l'en-tête
      // en préventif pour les serveurs qui attendent l'auth dès la 1re requête.
      ctxOpts.httpCredentials = { username: src.auth_user || '', password: secret };
      extra.Authorization = 'Basic ' + Buffer.from(`${src.auth_user || ''}:${secret}`).toString('base64');
    }
    if (type === 'bearer' && secret) extra.Authorization = 'Bearer ' + secret;
    if (type === 'header' && secret) extra[src.auth_header || 'Authorization'] = secret;
    if (Object.keys(extra).length) ctxOpts.extraHTTPHeaders = extra;

    const context = await browser.newContext(ctxOpts);

    if (type === 'cookie' && secret) {
      const u = new URL(url);
      const cookies = secret.split(';').map(s => s.trim()).filter(Boolean).map(pair => {
        const i = pair.indexOf('=');
        const name = i >= 0 ? pair.slice(0, i).trim() : pair;
        const value = i >= 0 ? pair.slice(i + 1).trim() : '';
        return { name, value, domain: u.hostname, path: '/' };
      }).filter(c => c.name);
      if (cookies.length) await context.addCookies(cookies);
    }

    const page = await context.newPage();
    await page.goto(url, { waitUntil: 'networkidle', timeout: timeoutMs });
    return await page.content();
  } finally {
    await browser.close();
  }
}

/**
 * Récupère le HTML d'une page selon la configuration de la source.
 * @param {object} src  Ligne sources_web (url, rendu_js, auth_*).
 * @param {string} url  URL finale (nom déjà substitué).
 */
export async function fetchPage(src, url, { timeoutMs = 15000 } = {}) {
  if (src.rendu_js) return fetchViaBrowser(src, url, timeoutMs);
  return fetchViaHttp(src, url, timeoutMs);
}
