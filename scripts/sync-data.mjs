import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { extname } from 'node:path';

const ROOT = new URL('../', import.meta.url);
const DATA_DIR = new URL('./data/', ROOT);
const IMAGE_DIR = new URL('./images/', ROOT);
const MAIN_URL = 'https://beyblade.phstudy.org/data/main.json';
const HARDCODED_URL = 'https://beyblade.phstudy.org/data/hardcoded.json';
const SITE = 'https://beyblade.phstudy.org';
const ALLOWED = new Set(['BX', 'UX', 'CX']);
const IMAGE_CONCURRENCY = 8;
const FETCH_TIMEOUT_MS = 12000;
const MIN_IMAGE_BYTES = 1500;
const GOOD_IMAGE_AREA = 800 * 800;

async function fetchWithTimeout(url) {
  return fetch(url, {
    headers: { 'user-agent': 'Spin-BP data sync/1.1' },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
}

async function fetchJson(url, optional = false) {
  try {
    const res = await fetchWithTimeout(url);
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

function deepStrings(value, out = [], depth = 0) {
  if (depth > 6 || value == null) return out;
  if (typeof value === 'string') out.push(value);
  else if (Array.isArray(value)) value.forEach((v) => deepStrings(v, out, depth + 1));
  else if (typeof value === 'object') Object.values(value).forEach((v) => deepStrings(v, out, depth + 1));
  return out;
}

function modelFrom(text) {
  return String(text || '').match(/\b(BX|UX|CX)-\d+(?:-\d+)?\b/i)?.[0]?.toUpperCase() || '';
}

function modelFromItem(item, title) {
  return modelFrom(`${title} ${deepStrings(item).join(' ')}`);
}

function cleanName(title, model) {
  let name = String(title || '')
    .replace(/\\n/g, ' ')
    .replace(/[\r\n]+/g, ' ')
    .replace(/<size=\d+>/gi, ' ')
    .replace(/<\/size>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (model) name = name.replace(new RegExp(`^${model.replace('-', '\\-')}\\s*`, 'i'), '');
  return name.replace(/^[-–—:：\s]+/, '').trim() || model;
}

function canonicalName(value) {
  return String(value || '')
    .normalize('NFKC')
    .toLocaleLowerCase('zh-Hant-TW')
    .replace(/\s+/g, '');
}

function canonicalKey(row) {
  return `${row.series}|${canonicalName(row.name)}`;
}

function rowScore(row) {
  let score = 0;
  if (!/R+$/i.test(row.sourceId)) score += 100;
  if (/^(BX|UX|CX)-\d+-\d+$/i.test(row.model)) score += 40;
  if (/-00$/i.test(row.sourceId)) score += 15;
  return score;
}

function chooseRepresentative(rows) {
  return [...rows].sort((a, b) => {
    const score = rowScore(b) - rowScore(a);
    if (score) return score;
    return a.model.localeCompare(b.model, undefined, { numeric: true }) || a.sourceId.localeCompare(b.sourceId);
  })[0];
}

function extractPartIds(item) {
  const ids = new Set();
  for (const text of deepStrings(item)) {
    for (const match of String(text).matchAll(/\b[A-Z]{2,3}-PRD-[A-Z0-9]+(?:-[A-Z0-9]+)*\b/gi)) {
      ids.add(match[0].toUpperCase());
    }
  }
  return [...ids];
}

function folderForId(id) {
  const prefix = String(id).split('-')[0].toUpperCase();
  return {
    SR: 'Series',
    BL: 'Blade',
    MB: 'MainBlade',
    LC: 'LockChip',
    AB: 'AssistBlade',
    OB: 'OverBlade',
    MLB: 'MetalBlade',
    MT: 'MetalBlade',
    RT: 'Ratchet',
    BT: 'Bit',
  }[prefix] || '';
}

function imageCandidates(item, sourceId) {
  const strings = deepStrings(item);
  const directImages = strings
    .filter((s) => /\.(png|jpe?g|webp)(\?.*)?$/i.test(s))
    .map((s) => s.startsWith('//') ? `https:${s}` : s.startsWith('/') ? `${SITE}${s}` : s)
    .filter((s) => s.startsWith('http'));

  const ids = new Set([sourceId, ...extractPartIds(item)]);
  const inferredSuffix = sourceId.replace(/^SR-/, '');
  for (const prefix of ['BL', 'MB', 'LC', 'AB', 'OB', 'MLB']) ids.add(`${prefix}-${inferredSuffix}`);

  const generated = [];
  for (const id of ids) {
    const folder = folderForId(id);
    if (folder) generated.push(`${SITE}/images/app/${folder}/${id}.png`);
    if (id.startsWith('SR-')) {
      generated.push(`${SITE}/images/app/BeybladeSeries/${id}.png`);
      generated.push(`${SITE}/images/app/Beyblade/${id}.png`);
    }
  }

  return [...new Set([...directImages, ...generated])];
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

function pngDimensions(bytes) {
  if (bytes.length < 24) return null;
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  if (!signature.every((byte, index) => bytes[index] === byte)) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

function imageMetrics(bytes) {
  const dims = pngDimensions(bytes);
  return {
    bytes: bytes.length,
    area: dims ? dims.width * dims.height : 0,
    width: dims?.width || 0,
    height: dims?.height || 0,
  };
}

function isBetterImage(next, current) {
  if (!current) return true;
  if (next.area && current.area && next.area !== current.area) return next.area > current.area;
  if (next.area && !current.area) return true;
  if (!next.area && current.area) return false;
  return next.bytes > current.bytes;
}

async function readLocalImage(relativePath) {
  if (!relativePath || !relativePath.startsWith('./images/')) return null;
  try {
    const fileName = relativePath.replace('./images/', '');
    const bytes = new Uint8Array(await readFile(new URL(fileName, IMAGE_DIR)));
    return { path: relativePath, bytes, metrics: imageMetrics(bytes) };
  } catch {
    return null;
  }
}

async function downloadBestImage(candidates, fileBase, existingPaths = []) {
  let best = null;
  for (const path of [...new Set(existingPaths.filter(Boolean))]) {
    const local = await readLocalImage(path);
    if (local && (!best || isBetterImage(local.metrics, best.metrics))) best = { ...local, remote: false };
  }

  if (best?.metrics.area >= GOOD_IMAGE_AREA) return { path: best.path, changed: false, metrics: best.metrics };

  for (const url of candidates) {
    try {
      const res = await fetchWithTimeout(url);
      const type = res.headers.get('content-type') || '';
      if (!res.ok || !type.startsWith('image/')) continue;
      const bytes = new Uint8Array(await res.arrayBuffer());
      if (bytes.length < MIN_IMAGE_BYTES) continue;
      const metrics = imageMetrics(bytes);
      if (!best || isBetterImage(metrics, best.metrics)) {
        best = { url, bytes, metrics, remote: true, contentType: type };
      }
      if (metrics.area >= GOOD_IMAGE_AREA) break;
    } catch { }
  }

  if (!best) return { path: '', changed: false, metrics: null };
  if (!best.remote) return { path: best.path, changed: false, metrics: best.metrics };

  const ext = extensionFromResponse(best.url, best.contentType);
  const fileName = `${safeFileBase(fileBase)}${ext}`;
  await writeFile(new URL(fileName, IMAGE_DIR), best.bytes);
  return { path: `./images/${fileName}`, changed: true, metrics: best.metrics };
}

async function existingData() {
  try {
    return JSON.parse(await readFile(new URL('beyblades.json', DATA_DIR), 'utf8'));
  } catch {
    return [];
  }
}

async function existingDataText() {
  try {
    return await readFile(new URL('beyblades.json', DATA_DIR), 'utf8');
  } catch {
    return '';
  }
}

async function mapPool(list, concurrency, worker) {
  let cursor = 0;
  const output = new Array(list.length);
  async function run() {
    while (true) {
      const index = cursor++;
      if (index >= list.length) return;
      output[index] = await worker(list[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, Math.max(1, list.length)) }, run));
  return output;
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
  const previousText = await existingDataText();

  const bySourceId = new Map();
  for (const source of sources) {
    for (const [fallbackId, item] of asEntries(source?.BeybladeSeries)) {
      if (!item) continue;
      const sourceId = item.id || fallbackId;
      const title = titleOf(item);
      const model = modelFromItem(item, title);
      const series = model.split('-')[0] || '';
      if (!ALLOWED.has(series)) continue;
      const row = { sourceId, model, series, name: cleanName(title, model), item };
      if (!bySourceId.has(sourceId) || rowScore(row) > rowScore(bySourceId.get(sourceId))) bySourceId.set(sourceId, row);
    }
  }

  const groups = new Map();
  for (const row of bySourceId.values()) {
    const key = canonicalKey(row);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }

  const previousByKey = new Map();
  for (const item of previous) {
    const key = `${item.series}|${canonicalName(item.name)}`;
    if (!previousByKey.has(key)) previousByKey.set(key, []);
    previousByKey.get(key).push(item);
  }

  let imageDownloads = 0;
  let imageMisses = 0;
  let improvedImages = 0;
  const groupEntries = [...groups.entries()];
  const items = await mapPool(groupEntries, IMAGE_CONCURRENCY, async ([key, rows]) => {
    const representative = chooseRepresentative(rows);
    const candidates = [...new Set(rows.flatMap((row) => imageCandidates(row.item, row.sourceId)))];
    const existingPaths = (previousByKey.get(key) || []).map((item) => item.image).filter(Boolean);
    const imageResult = await downloadBestImage(candidates, representative.sourceId, existingPaths);
    if (imageResult.path) {
      if (imageResult.changed) {
        imageDownloads++;
        if (existingPaths.length) improvedImages++;
      }
    } else imageMisses++;

    return {
      id: representative.sourceId,
      sourceId: representative.sourceId,
      model: representative.model,
      series: representative.series,
      name: representative.name,
      image: imageResult.path,
    };
  });

  items.sort((a, b) => {
    const s = a.series.localeCompare(b.series);
    if (s) return s;
    return a.model.localeCompare(b.model, undefined, { numeric: true }) || a.name.localeCompare(b.name, 'zh-Hant');
  });

  const nextText = `${JSON.stringify(items, null, 2)}\n`;
  const dataChanged = nextText !== previousText;
  if (dataChanged) await writeFile(new URL('beyblades.json', DATA_DIR), nextText);

  const imagesChanged = imageDownloads > 0;
  if (dataChanged || imagesChanged) {
    await writeFile(new URL('meta.json', DATA_DIR), `${JSON.stringify({
      generatedAt: new Date().toISOString(),
      source: MAIN_URL,
      sourceCount: bySourceId.size,
      count: items.length,
      duplicatesRemoved: bySourceId.size - items.length,
      imageDownloads,
      improvedImages,
      imageMisses,
    }, null, 2)}\n`);
  }

  console.log(`synced ${items.length} unique BX/UX/CX entries from ${bySourceId.size} source rows; duplicates removed=${bySourceId.size - items.length}; images updated=${imageDownloads}, improved=${improvedImages}, missing=${imageMisses}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
