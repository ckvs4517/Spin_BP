const DATA_URL = './data/beyblades.json';
const STORAGE_KEY = 'spin-bp-state-v1';
const EDITOR_SESSION_KEY = 'spin-bp-editor-password';
const API_BASE = String(window.SPIN_BP_CONFIG?.apiBase || '').replace(/\/$/, '');

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
  editorToggle: document.querySelector('#editorToggle'),
  editorBar: document.querySelector('#editorBar'),
  editorSummary: document.querySelector('#editorSummary'),
  editorLoginDialog: document.querySelector('#editorLoginDialog'),
  editorPassword: document.querySelector('#editorPassword'),
  editorLoginError: document.querySelector('#editorLoginError'),
  editorLoginSubmit: document.querySelector('#editorLoginSubmit'),
  editorLoginCancel: document.querySelector('#editorLoginCancel'),
  itemEditorDialog: document.querySelector('#itemEditorDialog'),
  itemEditorForm: document.querySelector('#itemEditorForm'),
  editModel: document.querySelector('#editModel'),
  editSourceId: document.querySelector('#editSourceId'),
  editName: document.querySelector('#editName'),
  editNote: document.querySelector('#editNote'),
  editHidden: document.querySelector('#editHidden'),
  editImagePreview: document.querySelector('#editImagePreview'),
  editImageInput: document.querySelector('#editImageInput'),
  editRemoveImage: document.querySelector('#editRemoveImage'),
  editSave: document.querySelector('#editSave'),
  editRestore: document.querySelector('#editRestore'),
  editCancel: document.querySelector('#editCancel'),
  editStatus: document.querySelector('#editStatus'),
};

const state = {
  mode: 'ban',
  series: 'ALL',
  query: '',
  eventName: '',
  note: '',
  selected: new Set(),
  rawBeys: [],
  beys: [],
  overrides: new Map(),
  editorMode: false,
  editorPassword: sessionStorage.getItem(EDITOR_SESSION_KEY) || '',
  editingId: '',
  removeCustomImage: false,
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

function mirrorKey(bey) {
  return String(bey.sourceId || bey.id || '').replace(/R+$/i, '');
}

function beyPreferenceScore(bey) {
  let score = 0;
  if (bey.image) score += 1000;
  if (!/R+$/i.test(bey.sourceId || bey.id || '')) score += 100;
  if (/^(BX|UX|CX)-\d+-\d+$/i.test(bey.model || '')) score += 40;
  if (/-00$/i.test(bey.sourceId || bey.id || '')) score += 15;
  return score;
}

function dedupeMirrors(items) {
  const groups = new Map();
  for (const bey of items) {
    const key = mirrorKey(bey);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(bey);
  }

  const aliases = new Map();
  const deduped = [];
  for (const group of groups.values()) {
    const representative = [...group].sort((a, b) => {
      const score = beyPreferenceScore(b) - beyPreferenceScore(a);
      if (score) return score;
      return String(a.sourceId || a.id || '').localeCompare(String(b.sourceId || b.id || ''));
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

function resolveApiUrl(path) {
  if (!API_BASE) return '';
  return `${API_BASE}${path.startsWith('/') ? path : `/${path}`}`;
}

async function apiFetch(path, options = {}, auth = false) {
  if (!API_BASE) throw new Error('尚未設定編輯者後端 API。');
  const headers = new Headers(options.headers || {});
  if (auth) {
    if (!state.editorPassword) throw new Error('尚未登入編輯者模式。');
    headers.set('X-Editor-Password', state.editorPassword);
  }
  const response = await fetch(resolveApiUrl(path), { ...options, headers });
  if (response.status === 401) {
    state.editorPassword = '';
    sessionStorage.removeItem(EDITOR_SESSION_KEY);
    throw new Error('編輯者密碼錯誤或已失效。');
  }
  if (!response.ok) {
    let message = `HTTP ${response.status}`;
    try {
      const body = await response.json();
      if (body?.error) message = body.error;
    } catch {}
    throw new Error(message);
  }
  return response;
}

async function loadOverrides() {
  if (!API_BASE) {
    state.overrides = new Map();
    rebuildCatalog();
    return;
  }
  try {
    const response = await apiFetch('/api/overrides');
    const payload = await response.json();
    state.overrides = new Map((payload.items || []).map((item) => [item.sourceId, item]));
    rebuildCatalog();
  } catch (error) {
    console.error(error);
    state.overrides = new Map();
    rebuildCatalog();
    setStatus('圖鑑已載入，但人工修正後端目前無法連線。', true);
  }
}

function applyOverride(bey) {
  const override = state.overrides.get(bey.sourceId) || state.overrides.get(bey.id) || null;
  return {
    ...bey,
    originalName: bey.name,
    originalImage: bey.image,
    name: override?.customName || bey.name,
    image: override?.customImageUrl || bey.image,
    hidden: Boolean(override?.hidden),
    editorNote: override?.note || '',
    hasCustomImage: Boolean(override?.customImageUrl),
    modified: Boolean(override),
  };
}

function rebuildCatalog(aliases = null) {
  const { beys, aliases: mirrorAliases } = dedupeMirrors(state.rawBeys);
  const activeAliases = aliases || mirrorAliases;
  state.beys = beys.map(applyOverride);

  const visibleIds = new Set(state.beys.filter((bey) => !bey.hidden).map((bey) => bey.id));
  state.selected = new Set(
    [...state.selected]
      .map((id) => activeAliases.get(id) || id)
      .filter((id) => visibleIds.has(id)),
  );
  saveState();
  renderGrid();
  renderPreview();
}

function filteredBeys() {
  const q = normalizeText(state.query);
  return state.beys.filter((bey) => {
    if (!state.editorMode && bey.hidden) return false;
    if (state.series !== 'ALL' && (state.series === 'LOCK_CHIP' ? bey.category !== '紋章鎖' : bey.series !== state.series)) return false;
    if (!q) return true;
    return normalizeText(`${bey.model} ${bey.name} ${bey.originalName || ''} ${bey.series}`).includes(q);
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

function renderEditorState() {
  els.editorToggle.classList.toggle('active', state.editorMode);
  els.editorToggle.textContent = state.editorMode ? '離開編輯者模式' : '編輯者模式';
  els.editorBar.hidden = !state.editorMode;
  if (state.editorMode) {
    const modified = state.beys.filter((bey) => bey.modified).length;
    const hidden = state.beys.filter((bey) => bey.hidden).length;
    els.editorSummary.textContent = `已人工修改 ${modified} 項，其中隱藏 ${hidden} 項。隱藏項目會在編輯者模式中保留顯示，方便恢復。`;
  }
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
  button.className = `bey-card${state.selected.has(bey.id) ? ' selected' : ''}${bey.hidden ? ' hidden-item' : ''}${bey.modified ? ' modified-item' : ''}`;
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

  if (state.editorMode) {
    const flags = document.createElement('div');
    flags.className = 'editor-flags';
    if (bey.hidden) {
      const badge = document.createElement('span');
      badge.className = 'editor-badge danger';
      badge.textContent = '已隱藏';
      flags.append(badge);
    }
    if (bey.hasCustomImage) {
      const badge = document.createElement('span');
      badge.className = 'editor-badge';
      badge.textContent = '自訂圖片';
      flags.append(badge);
    }
    if (bey.modified && !bey.hidden && !bey.hasCustomImage) {
      const badge = document.createElement('span');
      badge.className = 'editor-badge';
      badge.textContent = '已修改';
      flags.append(badge);
    }
    meta.append(flags);

    const edit = document.createElement('span');
    edit.className = 'edit-card-btn';
    edit.textContent = '編輯';
    edit.setAttribute('role', 'button');
    edit.setAttribute('tabindex', '0');
    edit.addEventListener('click', (event) => {
      event.stopPropagation();
      openItemEditor(bey.id);
    });
    edit.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        event.stopPropagation();
        openItemEditor(bey.id);
      }
    });
    button.append(imageBox, check, meta, edit);
  } else {
    button.append(imageBox, check, meta);
  }

  button.addEventListener('click', () => {
    if (state.editorMode && bey.hidden) return;
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
  els.visibleCount.textContent = `／目前顯示 ${visible.length} 項`;
  els.downloadBtn.disabled = state.selected.size === 0;
  renderEditorState();
  if (state.beys.length) {
    const normalCount = state.beys.filter((bey) => !bey.hidden).length;
    const suffix = API_BASE ? '人工修正會跨裝置永久保存。' : '編輯者後端尚未設定。';
    setStatus(`圖鑑目前顯示 ${normalCount} 項；不同配色會分開保留。${suffix}`, !API_BASE && state.editorMode);
  }
}

const imageCache = new Map();
function loadImage(src) {
  if (!src) return Promise.resolve(null);
  if (imageCache.has(src)) return imageCache.get(src);
  const promise = new Promise((resolve) => {
    const img = new Image();
    if (src.startsWith('http')) img.crossOrigin = 'anonymous';
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
  const selected = state.beys.filter((bey) => !bey.hidden && state.selected.has(bey.id));
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

  // Keep exported images consistent with the application's dark theme.
  ctx.fillStyle = '#080b10';
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = '#f3f4f6';
  ctx.font = '800 28px system-ui, sans-serif';
  ctx.fillText('SPIN BP', side, 64);
  ctx.font = '900 54px system-ui, sans-serif';
  const title = state.eventName.trim() || 'BEYBLADE X 比賽規則';
  drawWrappedText(ctx, title, side, 132, width - side * 2, 60, 2);

  const isBan = state.mode === 'ban';
  const badgeText = isBan ? '以下陀螺禁止使用' : '只有以下陀螺可使用';
  ctx.font = '900 27px system-ui, sans-serif';
  const badgeW = ctx.measureText(badgeText).width + 50;
  ctx.fillStyle = isBan ? '#351b22' : '#123126';
  roundRect(ctx, side, 185, badgeW, 52, 26);
  ctx.fill();
  ctx.fillStyle = isBan ? '#ff9b9b' : '#72e3a4';
  ctx.fillText(badgeText, side + 25, 220);

  const images = await Promise.all(selected.map((bey) => loadImage(bey.image)));
  selected.forEach((bey, index) => {
    const row = Math.floor(index / cols);
    const col = index % cols;
    const x = side + col * (cardW + gap);
    const y = headerH + row * (cardH + gap);
    ctx.fillStyle = '#111821';
    roundRect(ctx, x, y, cardW, cardH, 24);
    ctx.fill();
    ctx.strokeStyle = '#354254';
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
      ctx.fillStyle = '#293342';
      ctx.beginPath();
      ctx.arc(x + cardW / 2, y + imgAreaH / 2, cardW * .27, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#c0c7d1';
      ctx.font = '900 34px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(bey.series || 'X', x + cardW / 2, y + imgAreaH / 2 + 12);
      ctx.textAlign = 'left';
    }

    ctx.fillStyle = '#9aa4b2';
    ctx.font = '800 20px system-ui, sans-serif';
    ctx.fillText(bey.model || bey.series, x + 18, y + cardW + 18);
    ctx.fillStyle = '#f3f4f6';
    ctx.font = '900 23px system-ui, sans-serif';
    drawWrappedText(ctx, bey.name, x + 18, y + cardW + 49, cardW - 36, 27, 2);
  });

  const footerY = headerH + rows * (cardH + gap) + 18;
  if (state.note) {
    ctx.fillStyle = '#f3f4f6';
    ctx.font = '900 24px system-ui, sans-serif';
    ctx.fillText('補充規則', side, footerY + 22);
    ctx.fillStyle = '#c0c7d1';
    ctx.font = '600 22px system-ui, sans-serif';
    drawWrappedText(ctx, state.note, side, footerY + 58, width - side * 2, 31, 2);
  }
  ctx.fillStyle = '#7f8b9d';
  ctx.font = '500 17px system-ui, sans-serif';
  ctx.fillText('資料來源：beyblade.phstudy.org　｜　由 Spin BP 產生', side, height - 34);
}

function setDialogStatus(message, isError = false) {
  els.editStatus.textContent = message;
  els.editStatus.classList.toggle('error', isError);
}

function findBey(id) {
  return state.beys.find((bey) => bey.id === id || bey.sourceId === id) || null;
}

function openItemEditor(id) {
  const bey = findBey(id);
  if (!bey) return;
  state.editingId = bey.id;
  state.removeCustomImage = false;
  els.editModel.textContent = bey.model || bey.series;
  els.editSourceId.textContent = bey.sourceId || bey.id;
  els.editName.value = bey.name || '';
  els.editName.placeholder = bey.originalName || bey.name || '';
  els.editNote.value = bey.editorNote || '';
  els.editHidden.checked = bey.hidden;
  els.editImageInput.value = '';
  els.editRemoveImage.disabled = !bey.hasCustomImage;
  els.editRemoveImage.textContent = '移除自訂圖片';
  setDialogStatus('');
  renderEditPreview(bey.image, bey.series);
  els.itemEditorDialog.showModal();
}

function renderEditPreview(src, series) {
  els.editImagePreview.textContent = '';
  if (!src) {
    els.editImagePreview.append(makeImageFallback(series));
    return;
  }
  const img = document.createElement('img');
  img.src = src;
  img.alt = '目前圖片預覽';
  img.addEventListener('error', () => {
    els.editImagePreview.textContent = '';
    els.editImagePreview.append(makeImageFallback(series));
  }, { once: true });
  els.editImagePreview.append(img);
}

async function refreshOverridesAndCatalog() {
  imageCache.clear();
  await loadOverrides();
}

async function saveItemEditor(event) {
  event.preventDefault();
  const bey = findBey(state.editingId);
  if (!bey) return;

  const file = els.editImageInput.files?.[0] || null;
  if (file && !['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
    setDialogStatus('圖片只支援 PNG、JPG 或 WEBP。', true);
    return;
  }
  if (file && file.size > 5 * 1024 * 1024) {
    setDialogStatus('圖片檔案請控制在 5 MB 以內。', true);
    return;
  }

  els.editSave.disabled = true;
  setDialogStatus('正在儲存…');
  try {
    const customName = els.editName.value.trim();
    const useName = customName && customName !== bey.originalName ? customName : '';
    await apiFetch(`/api/overrides/${encodeURIComponent(bey.sourceId)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        hidden: els.editHidden.checked,
        customName: useName,
        note: els.editNote.value.trim(),
      }),
    }, true);

    if (state.removeCustomImage) {
      await apiFetch(`/api/overrides/${encodeURIComponent(bey.sourceId)}/image`, { method: 'DELETE' }, true);
    }
    if (file) {
      await apiFetch(`/api/overrides/${encodeURIComponent(bey.sourceId)}/image`, {
        method: 'POST',
        headers: { 'Content-Type': file.type },
        body: file,
      }, true);
    }

    await refreshOverridesAndCatalog();
    els.itemEditorDialog.close();
  } catch (error) {
    console.error(error);
    setDialogStatus(error.message || '儲存失敗。', true);
  } finally {
    els.editSave.disabled = false;
  }
}

async function restoreOriginalItem() {
  const bey = findBey(state.editingId);
  if (!bey) return;
  if (!confirm(`確定要清除 ${bey.model} 的所有人工修改，恢復成同步圖鑑資料嗎？`)) return;
  els.editRestore.disabled = true;
  setDialogStatus('正在恢復原始資料…');
  try {
    await apiFetch(`/api/overrides/${encodeURIComponent(bey.sourceId)}`, { method: 'DELETE' }, true);
    await refreshOverridesAndCatalog();
    els.itemEditorDialog.close();
  } catch (error) {
    console.error(error);
    setDialogStatus(error.message || '恢復失敗。', true);
  } finally {
    els.editRestore.disabled = false;
  }
}

async function verifyEditorPassword(password) {
  state.editorPassword = password;
  const response = await apiFetch('/api/auth/check', { method: 'POST' }, true);
  if (!response.ok) throw new Error('驗證失敗。');
  sessionStorage.setItem(EDITOR_SESSION_KEY, password);
}

async function enterEditorMode() {
  if (!API_BASE) {
    setStatus('編輯者後端尚未部署完成；一般規則產生功能仍可正常使用。', true);
    return;
  }
  if (state.editorPassword) {
    try {
      await verifyEditorPassword(state.editorPassword);
      state.editorMode = true;
      renderGrid();
      return;
    } catch {
      state.editorPassword = '';
      sessionStorage.removeItem(EDITOR_SESSION_KEY);
    }
  }
  els.editorPassword.value = '';
  els.editorLoginError.textContent = '';
  els.editorLoginDialog.showModal();
  setTimeout(() => els.editorPassword.focus(), 0);
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
    filteredBeys().filter((bey) => !bey.hidden).forEach((bey) => state.selected.add(bey.id));
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

  els.editorToggle.addEventListener('click', async () => {
    if (state.editorMode) {
      state.editorMode = false;
      renderGrid();
      return;
    }
    await enterEditorMode();
  });
  els.editorLoginCancel.addEventListener('click', () => els.editorLoginDialog.close());
  els.editorLoginSubmit.addEventListener('click', async (event) => {
    event.preventDefault();
    const password = els.editorPassword.value;
    if (!password) return;
    els.editorLoginSubmit.disabled = true;
    els.editorLoginError.textContent = '驗證中…';
    try {
      await verifyEditorPassword(password);
      state.editorMode = true;
      els.editorLoginDialog.close();
      renderGrid();
    } catch (error) {
      els.editorLoginError.textContent = error.message || '密碼驗證失敗。';
    } finally {
      els.editorLoginSubmit.disabled = false;
    }
  });

  els.itemEditorForm.addEventListener('submit', saveItemEditor);
  els.editCancel.addEventListener('click', () => els.itemEditorDialog.close());
  els.editRestore.addEventListener('click', restoreOriginalItem);
  els.editRemoveImage.addEventListener('click', () => {
    state.removeCustomImage = !state.removeCustomImage;
    els.editRemoveImage.textContent = state.removeCustomImage ? '保留自訂圖片' : '移除自訂圖片';
    const bey = findBey(state.editingId);
    if (bey) renderEditPreview(state.removeCustomImage ? bey.originalImage : bey.image, bey.series);
  });
  els.editImageInput.addEventListener('change', () => {
    const file = els.editImageInput.files?.[0];
    if (!file) return;
    state.removeCustomImage = false;
    const url = URL.createObjectURL(file);
    renderEditPreview(url, findBey(state.editingId)?.series);
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  });
}

async function init() {
  loadSavedState();
  bindEvents();
  els.eventName.value = state.eventName;
  els.note.value = state.note;
  renderTabs();
  renderEditorState();
  await renderPreview();

  try {
    const response = await fetch(`${DATA_URL}?v=${Date.now()}`, { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = await response.json();
    state.rawBeys = Array.isArray(payload) ? payload : payload.items || [];
    const { aliases } = dedupeMirrors(state.rawBeys);
    await loadOverrides();
    rebuildCatalog(aliases);
  } catch (error) {
    console.error(error);
    setStatus('讀取 data/beyblades.json 失敗。請先執行資料同步工作流程。', true);
  }
}

init();
