// Appended to app.js by scripts/build-site.mjs so it shares the same module scope.
let spinBpPreviewPageIndex = 0;
const spinBpBaseRenderPreview = renderPreview;
const spinBpPreviewPager = document.querySelector('#previewPager');
const spinBpPreviewPageLabel = document.querySelector('#previewPageLabel');
const spinBpPreviewPrev = document.querySelector('#previewPrev');
const spinBpPreviewNext = document.querySelector('#previewNext');
const spinBpPreviewThumbnails = document.querySelector('#previewThumbnails');

function spinBpPaintPreviewPage(index) {
  const totalPages = renderedExportPages.length;
  if (!totalPages) return;
  spinBpPreviewPageIndex = Math.max(0, Math.min(index, totalPages - 1));
  const page = renderedExportPages[spinBpPreviewPageIndex];
  if (!page) return;

  els.canvas.width = EXPORT_WIDTH;
  els.canvas.height = EXPORT_HEIGHT;
  const ctx = els.canvas.getContext('2d');
  ctx.clearRect(0, 0, EXPORT_WIDTH, EXPORT_HEIGHT);
  ctx.drawImage(page, 0, 0);

  const humanPage = spinBpPreviewPageIndex + 1;
  els.canvas.setAttribute('aria-label', `規則圖預覽，第 ${humanPage} 頁，共 ${totalPages} 頁`);
  els.canvas.title = totalPages > 1
    ? `目前預覽第 ${humanPage} 頁，共 ${totalPages} 頁；下載時會輸出全部頁面。`
    : '4:5 規則圖預覽';

  spinBpPreviewPageLabel.textContent = `第 ${humanPage} / ${totalPages} 張`;
  spinBpPreviewPrev.disabled = spinBpPreviewPageIndex === 0;
  spinBpPreviewNext.disabled = spinBpPreviewPageIndex === totalPages - 1;

  spinBpPreviewThumbnails.querySelectorAll('[data-preview-page]').forEach((button) => {
    const active = Number(button.dataset.previewPage) === spinBpPreviewPageIndex;
    button.classList.toggle('active', active);
    button.setAttribute('aria-current', active ? 'page' : 'false');
    if (active) button.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
  });
}

function spinBpRenderPreviewNavigation() {
  const totalPages = renderedExportPages.length;
  const showNavigation = totalPages > 1;
  spinBpPreviewPager.hidden = !showNavigation;
  spinBpPreviewThumbnails.hidden = !showNavigation;
  spinBpPreviewThumbnails.textContent = '';

  if (!showNavigation) {
    spinBpPreviewPageIndex = 0;
    if (totalPages === 1) spinBpPaintPreviewPage(0);
    return;
  }

  const fragment = document.createDocumentFragment();
  renderedExportPages.forEach((page, index) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'preview-thumb';
    button.dataset.previewPage = String(index);
    button.setAttribute('aria-label', `預覽第 ${index + 1} 張，共 ${totalPages} 張`);

    const thumbnail = document.createElement('canvas');
    thumbnail.width = 144;
    thumbnail.height = 180;
    thumbnail.setAttribute('aria-hidden', 'true');
    const thumbContext = thumbnail.getContext('2d');
    thumbContext.drawImage(page, 0, 0, thumbnail.width, thumbnail.height);

    const label = document.createElement('span');
    label.className = 'preview-thumb-label';
    label.textContent = `${index + 1}`;
    button.append(thumbnail, label);
    fragment.append(button);
  });
  spinBpPreviewThumbnails.append(fragment);

  spinBpPreviewPageIndex = Math.min(spinBpPreviewPageIndex, totalPages - 1);
  spinBpPaintPreviewPage(spinBpPreviewPageIndex);
}

renderPreview = async function renderPreviewWithPagination() {
  await spinBpBaseRenderPreview();
  spinBpRenderPreviewNavigation();
};

spinBpPreviewPrev.addEventListener('click', () => spinBpPaintPreviewPage(spinBpPreviewPageIndex - 1));
spinBpPreviewNext.addEventListener('click', () => spinBpPaintPreviewPage(spinBpPreviewPageIndex + 1));
spinBpPreviewThumbnails.addEventListener('click', (event) => {
  const button = event.target.closest('[data-preview-page]');
  if (!button) return;
  spinBpPaintPreviewPage(Number(button.dataset.previewPage));
});

document.addEventListener('keydown', (event) => {
  if (renderedExportPages.length <= 1) return;
  const target = event.target;
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target?.isContentEditable) return;
  if (event.key === 'ArrowLeft') spinBpPaintPreviewPage(spinBpPreviewPageIndex - 1);
  if (event.key === 'ArrowRight') spinBpPaintPreviewPage(spinBpPreviewPageIndex + 1);
});

// The original init() starts before this extension is appended. Render once more so
// the first completed page set immediately receives navigation controls.
renderPreview();
