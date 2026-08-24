const DATA_URL = './data/beyblades.json';
const STORAGE_KEY = 'spin-bp-state-v1';

const els = {
  modeTabs: document.querySelector('#modeTabs'),
  seriesTabs: document.querySelector('#seriesTabs'),
  eventName: document.querySelector('#eventName'),
  note: document.querySelector('#note'),
  search: document.querySelector('#search'),
  selectedCount: document.querySelector('#selectedCount'),
  visibleCount: document.querySelector('#visibleCount'),
  selectVisible: document.querySelector('#selectVisible'),
  clearSelection: document.querySelector('#clearSelection'),
  status: document.querySelector('#status'),
  grid: document.querySelector('#beyGrid'),
  canvas: document.querySelector('#ruleCanvas'),
  downloadBtn: document.querySelector('#downloadBtn'),
};

const state = {
  mode: 'ban',
  series: 'ALL',
  query: '',
  eventName: '',
  note: '',
  selected: new Set(),
  beys: [],
};

function loadSavedState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    if (!saved) return;
    if (saved.mode === 'ban' || saved.mode === 'allow') state.mode = saved.mode;
    state.eventName = saved.eventName || '';
    state.note = saved.note || '';
    if (Array.isArray(saved.selected)) state.selected = new Set(saved.selected);
  } catch {}
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({
    mode: state.mode,
    eventName: state.eventName,
    note: state.note,
    selected: [...state.selected],
  }));
}

function normalizeText(value) {
  return String(value || '').trim().toLocaleLowerCase('zh-Hant-TW');
}

function canonicalName(value) {
  return String(value || '')
    .normalize('NFKC')
    .toLocaleLowerCase('zh-Hant-TW')
    .replace(/\s+/g, '');
}

function beyKey(bey) {
  return `${bey.series || ''}|${canonicalName(bey.name)}`;
}

function beyPreferenceScore(bey) {
  let score = 0;
  if (bey.image) score += 1000;
  if (!/R+$/i.test(bey.sourceId || bey.id || '')) score += 100;
  if (/^(BX|UX|CX)-\d+-\d+$/i.test(bey.model || '')) score += 40;
  if (/-00$/i.test(bey.sourceId || bey.id || '')) score += 15;
  return score;
}

function dedupeBeys(items) {
  const groups = new Map();
  for (const bey of items) {
    const key = beyKey(bey);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(bey);
  }

  const aliases = new Map();
  const deduped = [];
  for (const group of groups.values()) {
    const representative = [...group].sort((a, b) => {
      const score = beyPreferenceScore(b) - beyPreferenceScore(a);
      if (score) return score;
      return String(a.model || '').localeCompare(String(b.model || ''), undefined, { numeric: true });
    })[0];
    deduped.push(representative);
    for (const bey of group) aliases.set(bey.id, representative.id);
  }

  deduped.sort((a, b) => {
    const s = String(a.series || '').localeCompare(String(b.series || ''));
    if (s) return s;
    return String(a.model || '').localeCompare(String(b.model || ''), undefined, { numeric: true }) || String(a.name || '').localeCompare(String(b.name || ''), 'zh-Hant');
  });
  return { beys: deduped, aliases };
}

function filteredBeys() {
  const q = normalizeText(state.query);
  return state.beys.filter((bey) => {
    if (state.series !== 'ALL' && bey.series !== state.series) return false;
    if (!q) return true;
    return normalizeText(`${bey.model} ${bey.name} ${bey.series}`).includes(q);
  });
}

function setStatus(message, isError = false) {
  els.status.textContent = message;
  els.status.classList.toggle('error', isError);
}

function renderTabs() {
  els.modeTabs.querySelectorAll('[data-mode]').forEach((button) => {
    button.classList.toggle('active', button.dataset.mode === state.mode);
  });
  els.seriesTabs.querySelectorAll('[data-series]').forEach((button) => {
    button.classList.toggle('active', button.dataset.series === state.series);
  });
}

function makeImageFallback(series) {
  const div = document.createElement('div');
  div.className = 'image-fallback';
  div.textContent = series || 'X';
  return div;
}

function createCard(bey) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `bey-card${state.selected.has(bey.id) ? ' selected' : ''}`;
  button.dataset.id = bey.id;
  button.setAttribute('aria-pressed', state.selected.has(bey.id) ? 'true' : 'false');
  button.setAttribute('aria-label', `${bey.model} ${bey.name}`);

  const imageBox = document.createElement('div');
  imageBox.className = 'image-box';
  if (bey.image) {
    const img = document.createElement('img');
    img.loading = 'lazy';
    img.decoding = 'async';
    img.alt = `${bey.name} 圖片`;
    img.src = bey.image;
    img.addEventListener('error', () => {
      imageBox.textContent = '';
      imageBox.append(makeImageFallback(bey.series));
    }, { once: true });
    imageBox.append(img);
  } else {
    imageBox.append(makeImageFallback(bey.series));
  }

  const check = document.createElement('span');
  check.className = 'check';
  check.textContent = '✓';
  check.setAttribute('aria-hidden', 'true');

  const meta = document.createElement('div');
  meta.className = 'card-meta';
  const code = document.createElement('div');
  code.className = 'card-code';
  code.textContent = bey.model || bey.series;
  const name = document.createElement('div');
  name.className = 'card-name';
  name.textContent = bey.name || bey.model;
  meta.append(code, name);
  button.append(imageBox, check, meta);

  button.addEventListener('click', () => {
    if (state.selected.has(bey.id)) state.selected.delete(bey.id);
    else state.selected.add(bey.id);
    saveState();
    renderGrid();
    renderPreview();
  });
  return button;
}

function renderGrid() {
  const visible = filteredBeys();
  els.grid.textContent = '';
  const fragment = document.createDocumentFragment();
  visible.forEach((bey) => fragment.append(createCard(bey)));
  els.grid.append(fragment);
  els.selectedCount.textContent = String(state.selected.size);
  els.visibleCount.textContent = `／目前顯示 ${visible.length} 顆`;
  els.downloadBtn.disabled = state.selected.size === 0;
  if (state.beys.length) setStatus(`圖鑑共 ${state.beys.length} 顆，已自動合併同名同組合的重複資料。`);
}

const imageCache = new Map();
function loadImage(src) {
  if (!src) return Promise.resolve(null);
  if (imageCache.has(src)) return imageCache.get(src);
  const promise = new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
  imageCache.set(src, promise);
  return promise;
}

function roundRect(ctx, x, y, w, h, r) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, radius);
}

function drawWrappedText(ctx, text, x, y, maxWidth, lineHeight, maxLines = 2) {
  const chars = [...String(text || '')];
  const lines = [];
  let current = '';
  for (const ch of chars) {
    const next = current + ch;
    if (ctx.measureText(next).width > maxWidth && current) {
      lines.push(current);
      current = ch;
      if (lines.length >= maxLines) break;
    } else current = next;
  }
  if (current && lines.length < maxLines) lines.push(current);
  lines.forEach((line, index) => ctx.fillText(line, x, y + index * lineHeight));
}

async function renderPreview() {
  const selected = state.beys.filter((bey) => state.selected.has(bey.id));
  const canvas = els.canvas;
  const ctx = canvas.getContext('2d');
  const width = 1080;
  const cols = selected.length <= 6 ? 3 : 4;
  const gap = 24;
  const side = 64;
  const cardW = (width - side * 2 - gap * (cols - 1)) / cols;
  const cardH = cardW + 88;
  const rows = Math.max(1, Math.ceil(selected.length / cols));
  const headerH = 250;
  const noteH = state.note ? 112 : 52;
  const height = Math.max(1080, headerH + rows * (cardH + gap) + noteH + 70);
  canvas.width = width;
  canvas.height = height;

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = '#111827';
  ctx.font = '800 28px system-ui, sans-serif';
  ctx.fillText('SPIN BP', side, 64);
  ctx.font = '900 54px system-ui, sans-serif';
  const title = state.eventName.trim() || 'BEYBLADE X 比賽規則';
  drawWrappedText(ctx, title, side, 132, width - side * 2, 60, 2);

  const isBan = state.mode === 'ban';
  const badgeText = isBan ? '以下陀螺禁止使用' : '只有以下陀螺可使用';
  ctx.font = '900 27px system-ui, sans-serif';
  const badgeW = ctx.measureText(badgeText).width + 50;
  ctx.fillStyle = isBan ? '#fef2f2' : '#f0fdf4';
  roundRect(ctx, side, 185, badgeW, 52, 26);
  ctx.fill();
  ctx.fillStyle = isBan ? '#b91c1c' : '#166534';
  ctx.fillText(badgeText, side + 25, 220);

  const images = await Promise.all(selected.map((bey) => loadImage(bey.image)));
  selected.forEach((bey, index) => {
    const row = Math.floor(index / cols);
    const col = index % cols;
    const x = side + col * (cardW + gap);
    const y = headerH + row * (cardH + gap);
    ctx.fillStyle = '#f9fafb';
    roundRect(ctx, x, y, cardW, cardH, 24);
    ctx.fill();
    ctx.strokeStyle = '#e5e7eb';
    ctx.lineWidth = 2;
    ctx.stroke();

    const image = images[index];
    const imgPad = 20;
    const imgAreaH = cardW - 8;
    if (image) {
      const maxW = cardW - imgPad * 2;
      const maxH = imgAreaH - imgPad * 2;
      const scale = Math.min(1, maxW / image.width, maxH / image.height);
      const w = image.width * scale;
      const h = image.height * scale;
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(image, x + (cardW - w) / 2, y + (imgAreaH - h) / 2, w, h);
    } else {
      ctx.fillStyle = '#e5e7eb';
      ctx.beginPath();
      ctx.arc(x + cardW / 2, y + imgAreaH / 2, cardW * .27, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#6b7280';
      ctx.font = '900 34px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(bey.series || 'X', x + cardW / 2, y + imgAreaH / 2 + 12);
      ctx.textAlign = 'left';
    }

    ctx.fillStyle = '#6b7280';
    ctx.font = '800 20px system-ui, sans-serif';
    ctx.fillText(bey.model || bey.series, x + 18, y + cardW + 18);
    ctx.fillStyle = '#111827';
    ctx.font = '900 23px system-ui, sans-serif';
    drawWrappedText(ctx, bey.name, x + 18, y + cardW + 49, cardW - 36, 27, 2);
  });

  const footerY = headerH + rows * (cardH + gap) + 18;
  if (state.note) {
    ctx.fillStyle = '#111827';
    ctx.font = '900 24px system-ui, sans-serif';
    ctx.fillText('補充規則', side, footerY + 22);
    ctx.fillStyle = '#374151';
    ctx.font = '600 22px system-ui, sans-serif';
    drawWrappedText(ctx, state.note, side, footerY + 58, width - side * 2, 31, 2);
  }
  ctx.fillStyle = '#9ca3af';
  ctx.font = '500 17px system-ui, sans-serif';
  ctx.fillText('資料來源：beyblade.phstudy.org　｜　由 Spin BP 產生', side, height - 34);
}

function bindEvents() {
  els.modeTabs.addEventListener('click', (event) => {
    const button = event.target.closest('[data-mode]');
    if (!button) return;
    state.mode = button.dataset.mode;
    saveState();
    renderTabs();
    renderPreview();
  });
  els.seriesTabs.addEventListener('click', (event) => {
    const button = event.target.closest('[data-series]');
    if (!button) return;
    state.series = button.dataset.series;
    renderTabs();
    renderGrid();
  });
  els.search.addEventListener('input', () => {
    state.query = els.search.value;
    renderGrid();
  });
  els.eventName.addEventListener('input', () => {
    state.eventName = els.eventName.value;
    saveState();
    renderPreview();
  });
  els.note.addEventListener('input', () => {
    state.note = els.note.value;
    saveState();
    renderPreview();
  });
  els.selectVisible.addEventListener('click', () => {
    filteredBeys().forEach((bey) => state.selected.add(bey.id));
    saveState();
    renderGrid();
    renderPreview();
  });
  els.clearSelection.addEventListener('click', () => {
    state.selected.clear();
    saveState();
    renderGrid();
    renderPreview();
  });
  els.downloadBtn.addEventListener('click', async () => {
    await renderPreview();
    const safeName = (state.eventName || 'spin-bp-rule').replace(/[\\/:*?"<>|]+/g, '-').trim() || 'spin-bp-rule';
    els.canvas.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${safeName}.png`;
      document.body.append(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    }, 'image/png');
  });
}

async function init() {
  loadSavedState();
  bindEvents();
  els.eventName.value = state.eventName;
  els.note.value = state.note;
  renderTabs();
  await renderPreview();

  try {
    const response = await fetch(`${DATA_URL}?v=${Date.now()}`, { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = await response.json();
    const rawBeys = Array.isArray(payload) ? payload : payload.items || [];
    const { beys, aliases } = dedupeBeys(rawBeys);
    state.beys = beys;

    const knownIds = new Set(state.beys.map((bey) => bey.id));
    state.selected = new Set(
      [...state.selected]
        .map((id) => aliases.get(id) || id)
        .filter((id) => knownIds.has(id)),
    );
    saveState();
    renderGrid();
    await renderPreview();
  } catch (error) {
    console.error(error);
    setStatus('讀取 data/beyblades.json 失敗。請先執行資料同步工作流程。', true);
  }
}

init();
