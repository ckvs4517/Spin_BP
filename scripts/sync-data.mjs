import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { extname } from 'node:path';

const ROOT = new URL('../', import.meta.url);
const DATA_DIR = new URL('./data/', ROOT);
const IMAGE_DIR = new URL('./images/', ROOT);
const MAIN_URL = 'https://beyblade.phstudy.org/data/main.json';
const HARDCODED_URL = 'https://beyblade.phstudy.org/data/hardcoded.json';
const SITE = 'https://beyblade.phstudy.org';
const ALLOWED = new Set(['BX', 'UX', 'CX']);

async function fetchJson(url, optional = false) {
  try {
    const res = await fetch(url, { headers: { 'user-agent': 'Spin-BP data sync/1.0' } });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    return await res.json();
  } catch (error) {
    if (optional) {
      console.warn(`optional source failed: ${url}: ${error.message}`);
      return null;
    }
    throw error;
  }
}

function asEntries(value) {
  if (Array.isArray(value)) return value.map((item, i) => [item?.id || String(i), item]);
  return Object.entries(value || {});
}

function titleOf(item) {
  return item?.catalog_title?.['zh-TW'] || item?.catalog_title?.['zh-HK'] || item?.catalog_title?.['ja-JP'] || item?.title || '';
}

function modelFrom(text) {
  return String(text || '').match(/\b(BX|UX|CX)-\d+(?:-\d+)?\b/i)?.[0]?.toUpperCase() || '';
}

function cleanName(title, model) {
  let name = String(title || '').trim();
  if (model) name = name.replace(new RegExp(`^${model.replace('-', '\\-')}\\s*`, 'i'), '');
  return name.replace(/^[-–—:：\s]+/, '').trim() || model;
}

function deepStrings(value, out = [], depth = 0) {
  if (depth > 4 || value == null) return out;
  if (typeof value === 'string') out.push(value);
  else if (Array.isArray(value)) value.forEach((v) => deepStrings(v, out, depth + 1));
  else if (typeof value === 'object') Object.values(value).forEach((v) => deepStrings(v, out, depth + 1));
  return out;
}

function imageCandidates(item, sourceId) {
  const fromRecord = deepStrings(item)
    .filter((s) => /\.(png|jpe?g|webp)(\?.*)?$/i.test(s))
    .map((s) => s.startsWith('//') ? `https:${s}` : s.startsWith('/') ? `${SITE}${s}` : s)
    .filter((s) => s.startsWith('http'));
  return [...new Set([
    ...fromRecord,
    `${SITE}/images/app/Series/${sourceId}.png`,
    `${SITE}/images/app/BeybladeSeries/${sourceId}.png`,
  ])];
}

function safeFileBase(value) {
  return String(value).replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 100);
}

function extensionFromResponse(url, contentType) {
  const ext = extname(new URL(url).pathname).toLowerCase();
  if (['.png', '.jpg', '.jpeg', '.webp'].includes(ext)) return ext === '.jpeg' ? '.jpg' : ext;
  if (contentType.includes('webp')) return '.webp';
  if (contentType.includes('jpeg')) return '.jpg';
  return '.png';
}

async function downloadFirstImage(candidates, fileBase) {
  for (const url of candidates) {
    try {
      const res = await fetch(url, { headers: { 'user-agent': 'Spin-BP data sync/1.0' } });
      const type = res.headers.get('content-type') || '';
      if (!res.ok || !type.startsWith('image/')) continue;
      const bytes = new Uint8Array(await res.arrayBuffer());
      if (bytes.length < 500) continue;
      const ext = extensionFromResponse(url, type);
      const fileName = `${safeFileBase(fileBase)}${ext}`;
      await writeFile(new URL(fileName, IMAGE_DIR), bytes);
      return `./images/${fileName}`;
    } catch { }
  }
  return '';
}

async function existingData() {
  try {
    return JSON.parse(await readFile(new URL('beyblades.json', DATA_DIR), 'utf8'));
  } catch {
    return [];
  }
}

async function main() {
  await mkdir(DATA_DIR, { recursive: true });
  await mkdir(IMAGE_DIR, { recursive: true });

  const [mainRaw, hardcodedRaw] = await Promise.all([
    fetchJson(MAIN_URL),
    fetchJson(HARDCODED_URL, true),
  ]);
  const sources = [mainRaw?.data || mainRaw, hardcodedRaw?.data || hardcodedRaw].filter(Boolean);
  const previous = await existingData();
  const previousBySourceId = new Map(previous.map((item) => [item.sourceId, item]));

  const rows = [];
  for (const source of sources) {
    for (const [fallbackId, item] of asEntries(source?.BeybladeSeries)) {
      if (!item) continue;
      const sourceId = item.id || fallbackId;
      const title = titleOf(item);
      const model = modelFrom(title);
      const series = model.split('-')[0] || '';
      if (!ALLOWED.has(series)) continue;
      rows.push({ sourceId, model, series, name: cleanName(title, model), item });
    }
  }

  const unique = new Map();
  for (const row of rows) {
    const key = `${row.sourceId}|${row.model}|${row.name}`;
    if (!unique.has(key)) unique.set(key, row);
  }

  const items = [];
  let imageDownloads = 0;
  let imageMisses = 0;
  for (const row of unique.values()) {
    const old = previousBySourceId.get(row.sourceId);
    let image = old?.image || '';
    if (!image) {
      image = await downloadFirstImage(imageCandidates(row.item, row.sourceId), row.sourceId);
      if (image) imageDownloads++;
      else imageMisses++;
    }
    items.push({
      id: `${row.sourceId}:${row.model}:${row.name}`,
      sourceId: row.sourceId,
      model: row.model,
      series: row.series,
      name: row.name,
      image,
    });
  }

  items.sort((a, b) => {
    const s = a.series.localeCompare(b.series);
    if (s) return s;
    return a.model.localeCompare(b.model, undefined, { numeric: true }) || a.name.localeCompare(b.name, 'zh-Hant');
  });

  await writeFile(new URL('beyblades.json', DATA_DIR), `${JSON.stringify(items, null, 2)}\n`);
  await writeFile(new URL('meta.json', DATA_DIR), `${JSON.stringify({
    generatedAt: new Date().toISOString(),
    source: MAIN_URL,
    count: items.length,
    imageDownloads,
    imageMisses,
  }, null, 2)}\n`);

  console.log(`synced ${items.length} BX/UX/CX entries; images new=${imageDownloads}, missing=${imageMisses}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
