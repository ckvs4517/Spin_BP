const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8' };
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const IMAGE_TYPES = new Map([
  ['image/png', 'png'],
  ['image/jpeg', 'jpg'],
  ['image/webp', 'webp'],
]);

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const cors = corsHeaders(request, env);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors });
    }

    try {
      if (url.pathname === '/api/health' && request.method === 'GET') {
        return json({ ok: true }, 200, cors);
      }

      if (url.pathname === '/api/catalog' && request.method === 'GET') {
        const upstream = await fetch('https://beyblade.phstudy.org/data/main.json', { headers: { 'user-agent': 'Spin-BP catalog proxy' } });
        if (!upstream.ok) throw new HttpError(502, 'Catalog source unavailable.');
        return new Response(await upstream.text(), { status: 200, headers: { ...cors, ...JSON_HEADERS, 'cache-control': 'public, max-age=300' } });
      }

      if (url.pathname === '/api/auth/check' && request.method === 'POST') {
        requireEditor(request, env);
        return new Response(null, { status: 204, headers: cors });
      }

      if (url.pathname === '/api/overrides' && request.method === 'GET') {
        const result = await env.DB.prepare(
          `SELECT source_id, hidden, custom_name, note, custom_image_key, updated_at
           FROM overrides ORDER BY updated_at DESC`,
        ).all();
        const items = (result.results || []).map((row) => serializeOverride(row, request));
        return json({ items }, 200, cors);
      }

      if (url.pathname.startsWith('/media/') && request.method === 'GET') {
        const key = decodeURIComponent(url.pathname.slice('/media/'.length));
        if (!key || key.includes('..')) return json({ error: 'Invalid image key.' }, 400, cors);
        const object = await env.IMAGES.get(key);
        if (!object) return json({ error: 'Image not found.' }, 404, cors);
        const headers = new Headers(cors);
        object.writeHttpMetadata(headers);
        headers.set('etag', object.httpEtag);
        headers.set('cache-control', 'public, max-age=31536000, immutable');
        return new Response(object.body, { headers });
      }

      const match = url.pathname.match(/^\/api\/overrides\/([^/]+)(\/image)?$/);
      if (match) {
        const sourceId = decodeURIComponent(match[1]);
        const imageRoute = Boolean(match[2]);
        validateSourceId(sourceId);

        if (!imageRoute && request.method === 'PUT') {
          requireEditor(request, env);
          const body = await request.json();
          const hidden = Boolean(body.hidden);
          const customName = cleanNullableText(body.customName, 100);
          const note = cleanNullableText(body.note, 300);
          const now = new Date().toISOString();
          await env.DB.prepare(
            `INSERT INTO overrides (source_id, hidden, custom_name, note, updated_at)
             VALUES (?, ?, ?, ?, ?)
             ON CONFLICT(source_id) DO UPDATE SET
               hidden = excluded.hidden,
               custom_name = excluded.custom_name,
               note = excluded.note,
               updated_at = excluded.updated_at`,
          ).bind(sourceId, hidden ? 1 : 0, customName, note, now).run();
          return json({ ok: true }, 200, cors);
        }

        if (!imageRoute && request.method === 'DELETE') {
          requireEditor(request, env);
          const row = await env.DB.prepare(
            'SELECT custom_image_key FROM overrides WHERE source_id = ?',
          ).bind(sourceId).first();
          if (row?.custom_image_key) await env.IMAGES.delete(row.custom_image_key);
          await env.DB.prepare('DELETE FROM overrides WHERE source_id = ?').bind(sourceId).run();
          return json({ ok: true }, 200, cors);
        }

        if (imageRoute && request.method === 'POST') {
          requireEditor(request, env);
          const contentType = String(request.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
          const ext = IMAGE_TYPES.get(contentType);
          if (!ext) return json({ error: 'Only PNG, JPG and WEBP images are supported.' }, 415, cors);

          const declaredSize = Number(request.headers.get('content-length') || 0);
          if (declaredSize > MAX_IMAGE_BYTES) return json({ error: 'Image must be 5 MB or smaller.' }, 413, cors);
          const bytes = await request.arrayBuffer();
          if (!bytes.byteLength || bytes.byteLength > MAX_IMAGE_BYTES) {
            return json({ error: 'Image must be between 1 byte and 5 MB.' }, 413, cors);
          }

          const existing = await env.DB.prepare(
            'SELECT custom_image_key FROM overrides WHERE source_id = ?',
          ).bind(sourceId).first();
          const key = `manual/${safeKey(sourceId)}/${Date.now()}.${ext}`;
          await env.IMAGES.put(key, bytes, {
            httpMetadata: { contentType, cacheControl: 'public, max-age=31536000, immutable' },
          });

          const now = new Date().toISOString();
          await env.DB.prepare(
            `INSERT INTO overrides (source_id, hidden, custom_image_key, updated_at)
             VALUES (?, 0, ?, ?)
             ON CONFLICT(source_id) DO UPDATE SET
               custom_image_key = excluded.custom_image_key,
               updated_at = excluded.updated_at`,
          ).bind(sourceId, key, now).run();

          if (existing?.custom_image_key && existing.custom_image_key !== key) {
            await env.IMAGES.delete(existing.custom_image_key);
          }
          return json({ ok: true, customImageUrl: mediaUrl(request, key) }, 200, cors);
        }

        if (imageRoute && request.method === 'DELETE') {
          requireEditor(request, env);
          const existing = await env.DB.prepare(
            'SELECT custom_image_key FROM overrides WHERE source_id = ?',
          ).bind(sourceId).first();
          if (existing?.custom_image_key) await env.IMAGES.delete(existing.custom_image_key);
          await env.DB.prepare(
            `UPDATE overrides SET custom_image_key = NULL, updated_at = ? WHERE source_id = ?`,
          ).bind(new Date().toISOString(), sourceId).run();
          await removeEmptyOverride(env, sourceId);
          return json({ ok: true }, 200, cors);
        }
      }

      return json({ error: 'Not found.' }, 404, cors);
    } catch (error) {
      if (error instanceof HttpError) return json({ error: error.message }, error.status, cors);
      console.error(error);
      return json({ error: 'Internal server error.' }, 500, cors);
    }
  },
};

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function json(payload, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...JSON_HEADERS, ...extraHeaders },
  });
}

function allowedOrigins(env) {
  return String(env.ALLOWED_ORIGINS || 'https://ckvs4517.github.io')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
}

function corsHeaders(request, env) {
  const requestOrigin = request.headers.get('origin') || '';
  const origins = allowedOrigins(env);
  const allowOrigin = origins.includes('*') || origins.includes(requestOrigin) ? requestOrigin || '*' : origins[0] || '*';
  return {
    'access-control-allow-origin': allowOrigin,
    'access-control-allow-methods': 'GET,POST,PUT,DELETE,OPTIONS',
    'access-control-allow-headers': 'Content-Type,X-Editor-Password',
    'access-control-max-age': '86400',
    'vary': 'Origin',
  };
}

function requireEditor(request, env) {
  if (!env.EDITOR_PASSWORD) throw new HttpError(503, 'EDITOR_PASSWORD is not configured.');
  const password = request.headers.get('X-Editor-Password') || '';
  if (password !== env.EDITOR_PASSWORD) throw new HttpError(401, 'Invalid editor password.');
}

function validateSourceId(sourceId) {
  if (!/^[A-Za-z0-9._-]{1,128}$/.test(sourceId)) throw new HttpError(400, 'Invalid sourceId.');
}

function cleanNullableText(value, maxLength) {
  const text = String(value || '').trim();
  if (!text) return null;
  if (text.length > maxLength) throw new HttpError(400, `Text is too long (max ${maxLength}).`);
  return text;
}

function safeKey(value) {
  return String(value).replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 128);
}

function mediaUrl(request, key) {
  const url = new URL(request.url);
  url.pathname = `/media/${encodeURIComponent(key)}`;
  url.search = '';
  return url.toString();
}

function serializeOverride(row, request) {
  return {
    sourceId: row.source_id,
    hidden: Boolean(row.hidden),
    customName: row.custom_name || '',
    note: row.note || '',
    customImageUrl: row.custom_image_key ? mediaUrl(request, row.custom_image_key) : '',
    updatedAt: row.updated_at,
  };
}

async function removeEmptyOverride(env, sourceId) {
  const row = await env.DB.prepare(
    `SELECT hidden, custom_name, note, custom_image_key FROM overrides WHERE source_id = ?`,
  ).bind(sourceId).first();
  if (!row) return;
  if (!row.hidden && !row.custom_name && !row.note && !row.custom_image_key) {
    await env.DB.prepare('DELETE FROM overrides WHERE source_id = ?').bind(sourceId).run();
  }
}
