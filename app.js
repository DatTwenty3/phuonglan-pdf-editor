pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

const state = { pages: [], nextId: 1, nextFileColor: 0, compact: true, insertAt: null };
const filePalette = [
  ['#2563eb', '#eff6ff'], // Royal Blue
  ['#059669', '#ecfdf5'], // Emerald Green
  ['#7c3aed', '#f5f3ff'], // Purple
  ['#d97706', '#fffbeb'], // Amber
  ['#0284c7', '#f0f9ff'], // Sky Blue
  ['#db2777', '#fdf2f8'], // Rose
  ['#4f46e5', '#eef2ff'], // Indigo
  ['#0d9488', '#f0fdfa']  // Teal
];
const els = Object.fromEntries(['emptyState','workspace','workspaceEmpty','fileInput','pageGrid','compactFiles','fileModeBtn','pageModeBtn','summary','deleteBtn','selectAllBtn','deselectAllBtn','rotateLeftBtn','rotateRightBtn','dropzone','loading','loadingText','progressBar','progressValue','toast','confetti','marqueeBox','marqueeBadge','gridZoomOutBtn','gridZoomInBtn','previewZoomOutBtn','previewZoomLevelBtn','previewZoomInBtn','previewZoomFitBtn','previewCanvasWrapper','previewStage'].map(id => [id, document.getElementById(id)]));

const setProgress = value => {
  const percent = Math.max(0, Math.min(100, Math.round(value)));
  els.progressBar.style.width = `${percent}%`;
  els.progressValue.textContent = `${percent}%`;
  els.progressBar.parentElement.setAttribute('aria-valuenow', String(percent));
};
let loadingHideTimer;
const showLoading = (text) => { clearTimeout(loadingHideTimer); els.loadingText.textContent = text; setProgress(0); els.loading.classList.remove('hidden'); toast(text, 'processing'); };
const hideLoading = () => {
  clearTimeout(loadingHideTimer);
  const completed = els.progressBar.parentElement.getAttribute('aria-valuenow') === '100';
  if (completed) loadingHideTimer = setTimeout(() => els.loading.classList.add('hidden'), 320);
  else els.loading.classList.add('hidden');
};
let toastTimer;
const burstConfetti = () => {
  const colors = ['#2563eb', '#10b981', '#f59e0b', '#ec4899', '#8b5cf6', '#06b6d4'];
  els.confetti.innerHTML = Array.from({ length: 24 }, (_, index) => {
    const angle = (index / 24) * 360;
    const distance = 45 + Math.random() * 85;
    const x = Math.round(Math.cos(angle * Math.PI / 180) * distance);
    const y = Math.round(Math.sin(angle * Math.PI / 180) * distance - 50);
    const rot = Math.round(Math.random() * 360);
    const color = colors[index % colors.length];
    return `<i style="--x:${x}px;--y:${y}px;--rot:${rot}deg;--c:${color};--d:${index * 12}ms"></i>`;
  }).join('');
  els.confetti.classList.remove('burst');
  requestAnimationFrame(() => els.confetti.classList.add('burst'));
};
const toast = (text, requestedType) => {
  const type = requestedType || (/không|lỗi|cần OCR|vui lòng/i.test(text) ? 'warning' : /đang/i.test(text) ? 'processing' : 'success');
  els.toast.className = `toast ${type}`;
  els.toast.querySelector('.toast-message').textContent = text;
  els.toast.querySelector('.toast-icon').textContent = type === 'success' ? '✓' : type === 'warning' ? '!' : '▤';
  requestAnimationFrame(() => els.toast.classList.add('show'));
  if (type === 'success') {
    burstConfetti();
  }
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { els.toast.classList.remove('show'); }, 2600);
};
const selected = () => state.pages.filter(page => page.selected);

async function addFiles(fileList) {
  const files = [...fileList].filter(file => file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf'));
  if (!files.length) return toast('Vui lòng chọn tệp PDF hợp lệ.');
  const insertionRequested = state.insertAt !== null;
  showLoading(`Đang đọc ${files.length} tệp PDF...`);
  try {
    const addedPages = [];
    setProgress(3);
    for (let fileIndex = 0; fileIndex < files.length; fileIndex++) {
      const file = files[fileIndex];
      els.loadingText.textContent = `Đang đọc tệp ${fileIndex + 1}/${files.length}: ${file.name}`;
      const fileColor = state.nextFileColor++ % filePalette.length;
      const bytes = new Uint8Array(await file.arrayBuffer());
      const pdf = await pdfjsLib.getDocument({ data: bytes.slice() }).promise;
      for (let pageIndex = 0; pageIndex < pdf.numPages; pageIndex++) {
        addedPages.push({ id: state.nextId++, fileName: file.name, sourceBytes: bytes, sourcePage: pageIndex, fileColor, rotation: 0, selected: false, thumb: null });
      }
      setProgress(5 + ((fileIndex + 1) / files.length) * 20);
    }
    const insertionIndex = state.insertAt === null ? state.pages.length : Math.max(0, Math.min(state.insertAt, state.pages.length));
    state.pages.splice(insertionIndex, 0, ...addedPages);
    els.emptyState.classList.add('hidden');
    els.workspace.classList.remove('hidden');
    if (!insertionRequested) state.compact = true;
    render();
    await renderMissingThumbnails((completed, total) => {
      els.loadingText.textContent = `Đang tạo ảnh xem trước ${completed}/${total} trang...`;
      setProgress(25 + (completed / Math.max(1, total)) * 73);
    });
    render();
    setProgress(100);
    toast(`Đã thêm ${files.length} tệp PDF.`);
  } catch (error) {
    console.error(error);
    toast('Không thể đọc PDF. Tệp có thể bị khóa hoặc bị lỗi.');
  } finally { state.insertAt = null; hideLoading(); }
}

async function renderMissingThumbnails(onProgress) {
  const grouped = new Map();
  state.pages.filter(p => !p.thumb).forEach(p => { if (!grouped.has(p.sourceBytes)) grouped.set(p.sourceBytes, []); grouped.get(p.sourceBytes).push(p); });
  const total = [...grouped.values()].reduce((sum, pages) => sum + pages.length, 0);
  let completed = 0;
  if (onProgress) onProgress(completed, total);
  for (const [bytes, pages] of grouped) {
    const pdf = await pdfjsLib.getDocument({ data: bytes.slice() }).promise;
    for (const item of pages) {
      const pdfPage = await pdf.getPage(item.sourcePage + 1);
      const base = pdfPage.getViewport({ scale: 1 });
      const viewport = pdfPage.getViewport({ scale: Math.min(1.15, 210 / base.width) });
      const canvas = document.createElement('canvas');
      canvas.width = viewport.width; canvas.height = viewport.height;
      await pdfPage.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
      item.thumb = canvas.toDataURL('image/jpeg', .82);
      const target = document.querySelector(`[data-id="${item.id}"] .page-preview`);
      if (target) {
        const isRotated = item.rotation !== 0;
        const transformStyle = isRotated
          ? `transform:rotate(${item.rotation}deg)${item.rotation % 180 !== 0 ? ' scale(0.72)' : ''};`
          : '';
        target.innerHTML = `<img src="${item.thumb}" alt="Xem trước trang" draggable="false" style="max-width:100%;max-height:100%;${transformStyle}">`;
      }
      completed++;
      if (onProgress) onProgress(completed, total);
    }
  }
}

function render() {
  const fileGroups = [];
  state.pages.forEach(page => {
    const previousGroup = fileGroups[fileGroups.length - 1];
    if (!previousGroup || previousGroup.sourceBytes !== page.sourceBytes) {
      const group = { sourceBytes: page.sourceBytes, fileName: page.fileName, pages: [] };
      fileGroups.push(group);
    }
    fileGroups[fileGroups.length - 1].pages.push(page);
  });
  const segmentTotals = new Map();
  const segmentPositions = new Map();
  fileGroups.forEach(group => segmentTotals.set(group.sourceBytes, (segmentTotals.get(group.sourceBytes) || 0) + 1));
  fileGroups.forEach(group => {
    const position = (segmentPositions.get(group.sourceBytes) || 0) + 1;
    segmentPositions.set(group.sourceBytes, position);
    group.segmentPosition = position;
    group.segmentTotal = segmentTotals.get(group.sourceBytes);
  });

  els.compactFiles.innerHTML = fileGroups.map(group => `
    <article class="compact-file-card" data-segment-pages="${group.pages.map(page => page.id).join(',')}">
      <div class="compact-cover">${group.pages[0].thumb ? `<img src="${group.pages[0].thumb}" alt="Trang đầu của ${escapeHtml(group.fileName)}" draggable="false">` : '<span class="pdf-tag">PDF</span>'}</div>
      <div class="compact-file-info">
        <b title="${escapeHtml(group.fileName)}">${escapeHtml(group.fileName)}</b>
        <span>${group.pages.length} trang PDF${group.segmentTotal > 1 ? ` • Phần ${group.segmentPosition}/${group.segmentTotal}` : ''}</span>
        <div class="compact-actions">
          <button class="file-delete" type="button" data-delete-segment="${group.pages.map(page => page.id).join(',')}" aria-label="Xóa ${group.segmentTotal > 1 ? `phần ${group.segmentPosition} của` : 'tệp'} ${escapeHtml(group.fileName)}" title="Xóa tệp này">✕ Xóa file</button>
        </div>
      </div>
    </article>`).join('');

  els.pageGrid.innerHTML = state.pages.map((page, index) => {
    const isRotated = page.rotation !== 0;
    const transformStyle = isRotated
      ? `transform:rotate(${page.rotation}deg)${page.rotation % 180 !== 0 ? ' scale(0.72)' : ''};`
      : '';
    const rotationHint = isRotated ? ` (Đã xoay ${page.rotation}°)` : '';
    const colorPair = filePalette[page.fileColor ?? 0] || filePalette[0];
    return `
    <article class="page-card file-colored ${page.selected ? 'selected' : ''}" data-id="${page.id}" style="--file-color:${colorPair[0]};--file-soft:${colorPair[1]}">
      <input class="page-check" type="checkbox" ${page.selected ? 'checked' : ''} aria-label="Chọn trang ${index + 1}">
      <button class="remove-one" type="button" aria-label="Xóa trang ${index + 1}" title="Xóa riêng trang ${index + 1}">✕</button>
      <div class="page-preview">${page.thumb ? `<img src="${page.thumb}" alt="Xem trước trang ${index + 1}" draggable="false" style="max-width:100%;max-height:100%;${transformStyle}">` : '<div class="preview-loading"></div>'}</div>
      <div class="page-meta">
        <div class="page-meta-row">
          <span class="page-number" title="Trang ${index + 1}${rotationHint}">Trang ${index + 1}</span>
          <div class="page-rotate-group" role="group" aria-label="Xoay trang ${index + 1}">
            <button class="page-rotate-btn rotate-left" type="button" data-rotate="-90" title="Xoay trái 90° (Hiện tại: ${page.rotation}°)" aria-label="Xoay trái trang ${index + 1}">↶</button>
            <button class="page-rotate-btn rotate-right" type="button" data-rotate="90" title="Xoay phải 90° (Hiện tại: ${page.rotation}°)" aria-label="Xoay phải trang ${index + 1}">↷</button>
          </div>
        </div>
        <div class="file-name" title="${escapeHtml(page.fileName)}">${escapeHtml(page.fileName)}</div>
      </div>
    </article>`;
  }).join('');

  const count = selected().length;
  els.workspaceEmpty.classList.toggle('hidden', state.pages.length > 0);
  els.compactFiles.classList.toggle('hidden', !state.compact);
  els.pageGrid.classList.toggle('hidden', state.compact);
  els.workspace.classList.toggle('file-view', state.compact);
  els.fileModeBtn.classList.toggle('active', state.compact);
  els.pageModeBtn.classList.toggle('active', !state.compact);
  els.fileModeBtn.setAttribute('aria-pressed', String(state.compact));
  els.pageModeBtn.setAttribute('aria-pressed', String(!state.compact));

  const uniqueFileCount = new Set(state.pages.map(page => page.sourceBytes)).size;
  const multiMoveHint = count > 1 ? ` • Đã chọn ${count} trang` : '';
  els.summary.textContent = state.compact
    ? `${state.pages.length} trang trong ${fileGroups.length} nhóm từ ${uniqueFileCount} tệp PDF`
    : `${state.pages.length} trang từ ${uniqueFileCount} tệp PDF${multiMoveHint}`;
  els.deleteBtn.disabled = els.rotateLeftBtn.disabled = els.rotateRightBtn.disabled = count === 0;
  els.deleteBtn.innerHTML = count > 0 ? `🗑 <span>Xóa đã chọn (${count})</span>` : `🗑 <span>Xóa đã chọn</span>`;
  if (els.deselectAllBtn) {
    els.deselectAllBtn.classList.toggle('hidden', count === 0);
    els.deselectAllBtn.innerHTML = count > 0 ? `☐ <span>Bỏ chọn (${count})</span>` : `☐ <span>Bỏ chọn tất cả</span>`;
  }
  if (els.selectAllBtn) {
    els.selectAllBtn.disabled = state.pages.length === 0 || count === state.pages.length;
    els.selectAllBtn.innerHTML = '☑ <span>Chọn tất cả</span>';
  }
}

function escapeHtml(text) { const div = document.createElement('div'); div.textContent = text; return div.innerHTML; }
function exportFileName(extension) {
  const firstName = state.pages[0]?.fileName || 'tai-lieu.pdf';
  const baseName = firstName.replace(/\.pdf$/i, '').replace(/[<>:"/\\|?*\u0000-\u001F]/g, '-').replace(/[. ]+$/g, '').trim() || 'tai-lieu';
  const sourceCount = new Set(state.pages.map(page => page.sourceBytes)).size;
  return `${baseName}${sourceCount > 1 ? '-da-gop' : ''}.${extension}`;
}
function removePages(ids) { state.pages = state.pages.filter(page => !ids.includes(page.id)); render(); }
function rotateSelected(amount) { selected().forEach(page => page.rotation = (page.rotation + amount + 360) % 360); render(); }

function rotatePage(id, amount) {
  const page = state.pages.find(p => p.id === id);
  if (!page) return;
  page.rotation = (page.rotation + amount + 360) % 360;

  const card = els.pageGrid.querySelector(`.page-card[data-id="${id}"]`);
  if (!card) {
    render();
    return;
  }

  const img = card.querySelector('.page-preview img');
  if (img) {
    const isRotated = page.rotation !== 0;
    img.style.transform = isRotated
      ? `rotate(${page.rotation}deg)${page.rotation % 180 !== 0 ? ' scale(0.72)' : ''}`
      : '';
  }

  const pageNum = card.querySelector('.page-number');
  if (pageNum) {
    const pageIndex = state.pages.indexOf(page) + 1;
    const rotationHint = page.rotation ? ` (Đã xoay ${page.rotation}°)` : '';
    pageNum.title = `Trang ${pageIndex}${rotationHint}`;
  }

  const leftBtn = card.querySelector('.rotate-left');
  const rightBtn = card.querySelector('.rotate-right');
  if (leftBtn) leftBtn.title = `Xoay trái 90° (Hiện tại: ${page.rotation}°)`;
  if (rightBtn) rightBtn.title = `Xoay phải 90° (Hiện tại: ${page.rotation}°)`;
}

els.pageGrid.addEventListener('change', event => {
  if (!event.target.matches('.page-check')) return;
  const page = state.pages.find(p => p.id === +event.target.closest('.page-card').dataset.id);
  if (page) {
    page.selected = event.target.checked;
    render();
  }
});

els.pageGrid.addEventListener('click', event => {
  const rotateBtn = event.target.closest('.page-rotate-btn');
  if (rotateBtn) {
    event.stopPropagation();
    const card = rotateBtn.closest('.page-card');
    if (!card) return;
    const pageId = +card.dataset.id;
    const amount = parseInt(rotateBtn.dataset.rotate, 10) || 90;
    rotatePage(pageId, amount);
    return;
  }

  const removeBtn = event.target.closest('.remove-one');
  if (removeBtn) {
    event.stopPropagation();
    const card = removeBtn.closest('.page-card');
    if (card) removePages([+card.dataset.id]);
    return;
  }

  if (event.target.closest('.page-check, .insert-point')) return;
  const card = event.target.closest('.page-card');
  if (card) {
    if (justFinishedMarquee) return;
    openPreview(+card.dataset.id);
  }
});
document.getElementById('deleteBtn').onclick = () => { const ids = selected().map(p => p.id); if (ids.length) removePages(ids); };
document.getElementById('selectAllBtn').onclick = () => {
  state.pages.forEach(p => p.selected = true);
  render();
  toast('Đã chọn tất cả các trang.');
};
if (els.deselectAllBtn) {
  els.deselectAllBtn.onclick = () => {
    state.pages.forEach(p => p.selected = false);
    render();
    toast('Đã bỏ chọn tất cả.');
  };
}
document.getElementById('rotateLeftBtn').onclick = () => rotateSelected(-90);
document.getElementById('rotateRightBtn').onclick = () => rotateSelected(90);
els.fileModeBtn.onclick = () => { state.compact = true; render(); };
els.pageModeBtn.onclick = () => { state.compact = false; render(); };
els.compactFiles.addEventListener('click', event => {
  const insertButton = event.target.closest('[data-insert-at]');
  if (insertButton) { chooseInsertPosition(+insertButton.dataset.insertAt); return; }
  const deleteButton = event.target.closest('[data-delete-segment]');
  if (deleteButton) {
    removePages(deleteButton.dataset.deleteSegment.split(',').map(Number));
    return;
  }
});
els.pageGrid.addEventListener('click', event => { const button = event.target.closest('[data-insert-at]'); if (button) chooseInsertPosition(+button.dataset.insertAt); });
function chooseInsertPosition(index) { state.insertAt = index; els.fileInput.click(); }
['heroAddBtn','addBtn'].forEach(id => document.getElementById(id).onclick = () => { state.insertAt = null; els.fileInput.click(); });
document.querySelector('.inline-drop').onclick = () => { state.insertAt = null; els.fileInput.click(); };
els.fileInput.onchange = event => { addFiles(event.target.files); event.target.value = ''; };

/* ==========================================================
   BỘ SẮP XẾP KÉO THẢ (SORTABLEJS)
   ========================================================== */
let multiPageDrag = null;
const pageGridSortable = new Sortable(els.pageGrid, {
  draggable: '.page-card',
  filter: 'button, input, .insert-point, .page-rotate-btn',
  preventOnFilter: false,
  animation: 180,
  delay: 80,
  delayOnTouchOnly: true,
  onStart: event => {
    if (isMarqueeDragging) return false;
    event.item.classList.add('is-lifted');
    const draggedId = +event.item.dataset.id;
    const draggedPage = state.pages.find(page => page.id === draggedId);
    const selectedPages = state.pages.filter(page => page.selected);
    if (draggedPage?.selected && selectedPages.length > 1) {
      multiPageDrag = { draggedId, ids: selectedPages.map(page => page.id) };
      event.item.dataset.dragCount = selectedPages.length;
      els.pageGrid.querySelectorAll('.page-card.selected').forEach(card => card.classList.add('multi-dragging'));
    } else {
      multiPageDrag = null;
    }
  },
  onEnd: event => {
    event.item.classList.remove('is-lifted');
    if (!multiPageDrag) {
      const [moved] = state.pages.splice(event.oldDraggableIndex, 1);
      state.pages.splice(event.newDraggableIndex, 0, moved);
      render();
      return;
    }
    const selectedIds = new Set(multiPageDrag.ids);
    const selectedPages = state.pages.filter(page => selectedIds.has(page.id));
    const remainingPages = state.pages.filter(page => !selectedIds.has(page.id));
    const domIds = [...els.pageGrid.querySelectorAll('.page-card')].map(card => +card.dataset.id);
    const draggedPosition = domIds.indexOf(multiPageDrag.draggedId);
    const precedingId = domIds.slice(0, draggedPosition).reverse().find(id => !selectedIds.has(id));
    const insertionIndex = precedingId === undefined ? 0 : remainingPages.findIndex(page => page.id === precedingId) + 1;
    remainingPages.splice(insertionIndex, 0, ...selectedPages);
    state.pages = remainingPages;
    multiPageDrag = null;
    render();
  }
});

new Sortable(els.compactFiles, {
  draggable: '.compact-file-card',
  animation: 180,
  delay: 80,
  delayOnTouchOnly: true,
  filter: 'button',
  preventOnFilter: false,
  onEnd: () => {
    const pagesById = new Map(state.pages.map(page => [page.id, page]));
    const reordered = [...els.compactFiles.querySelectorAll('.compact-file-card')]
      .flatMap(card => card.dataset.segmentPages.split(',').map(Number))
      .map(id => pagesById.get(id))
      .filter(Boolean);
    state.pages = reordered;
    render();
  }
});

['dragenter','dragover'].forEach(name => document.addEventListener(name, event => { event.preventDefault(); els.dropzone.classList.add('dragover'); }));
['dragleave','drop'].forEach(name => document.addEventListener(name, event => { event.preventDefault(); if (name === 'drop') { state.insertAt = null; addFiles(event.dataTransfer.files); } els.dropzone.classList.remove('dragover'); }));

/* ==========================================================
   BỘ ĐIỀU CHỈNH KÍCH THƯỚC TRANG TRÊN LƯỚI (GRID ZOOM)
   ========================================================== */
let currentGridCardSize = 155;
const MIN_GRID_SIZE = 120;
const MAX_GRID_SIZE = 260;
const GRID_STEP = 30;

function setGridCardSize(size) {
  currentGridCardSize = Math.max(MIN_GRID_SIZE, Math.min(MAX_GRID_SIZE, size));
  document.documentElement.style.setProperty('--grid-card-size', `${currentGridCardSize}px`);
  if (els.gridZoomOutBtn) els.gridZoomOutBtn.disabled = currentGridCardSize <= MIN_GRID_SIZE;
  if (els.gridZoomInBtn) els.gridZoomInBtn.disabled = currentGridCardSize >= MAX_GRID_SIZE;
}

if (els.gridZoomOutBtn) {
  els.gridZoomOutBtn.onclick = () => {
    setGridCardSize(currentGridCardSize - GRID_STEP);
    toast(`Kích thước xem trước: ${currentGridCardSize}px`);
  };
}
if (els.gridZoomInBtn) {
  els.gridZoomInBtn.onclick = () => {
    setGridCardSize(currentGridCardSize + GRID_STEP);
    toast(`Kích thước xem trước: ${currentGridCardSize}px`);
  };
}

/* ==========================================================
   BỘ MÁY QUÉT CHUỘT CHỌN NHIỀU TRANG 1 LƯỢT (MARQUEE SELECTION)
   ========================================================== */
let isMarqueeTracking = false;
let isMarqueeDragging = false;
let marqueeStartX = 0;
let marqueeStartY = 0;
let startEventShift = false;
let startEventCtrl = false;
let justFinishedMarquee = false;
const candidateIds = new Set();

els.dropzone.addEventListener('pointerdown', event => {
  if (state.compact) return;
  if (event.button !== 0) return;
  if (event.target.closest('button, input, .insert-point, .compact-files')) return;

  const card = event.target.closest('.page-card');
  const isShift = event.shiftKey;
  const isCtrl = event.ctrlKey || event.metaKey;

  // Nếu nhấp trực tiếp vào thẻ trang mà không giữ Shift/Ctrl, nhường cho Sortable kéo thả sắp xếp / click mở xem trước
  if (card && !isShift && !isCtrl) {
    return;
  }

  // Xóa sạch vùng bôi đen chữ của trình duyệt nếu có
  if (window.getSelection) {
    window.getSelection().removeAllRanges();
  }

  isMarqueeTracking = true;
  isMarqueeDragging = false;
  marqueeStartX = event.clientX;
  marqueeStartY = event.clientY;
  startEventShift = isShift;
  startEventCtrl = isCtrl;
  candidateIds.clear();

  // Ngăn chặn hoàn toàn hành vi bôi đen văn bản/hình ảnh mặc định của trình duyệt
  event.preventDefault();
});

document.addEventListener('pointermove', event => {
  if (!isMarqueeTracking) return;

  // Luôn ngăn chặn hành vi bôi đen mặc định của trình duyệt khi đang quét
  event.preventDefault();
  if (window.getSelection) {
    window.getSelection().removeAllRanges();
  }

  const currentX = event.clientX;
  const currentY = event.clientY;
  const dist = Math.hypot(currentX - marqueeStartX, currentY - marqueeStartY);

  if (!isMarqueeDragging && dist > 5) {
    isMarqueeDragging = true;
    els.dropzone.classList.add('is-marquee-selecting');
    if (els.marqueeBox) els.marqueeBox.classList.remove('hidden');
    pageGridSortable.option('disabled', true);
  }

  if (isMarqueeDragging && els.marqueeBox) {
    const dropzoneRect = els.dropzone.getBoundingClientRect();
    const left = Math.min(marqueeStartX, currentX) - dropzoneRect.left + els.dropzone.scrollLeft;
    const top = Math.min(marqueeStartY, currentY) - dropzoneRect.top + els.dropzone.scrollTop;
    const width = Math.abs(currentX - marqueeStartX);
    const height = Math.abs(currentY - marqueeStartY);

    els.marqueeBox.style.left = `${left}px`;
    els.marqueeBox.style.top = `${top}px`;
    els.marqueeBox.style.width = `${width}px`;
    els.marqueeBox.style.height = `${height}px`;

    // Thuật toán va chạm AABB tính theo khung nhìn viewport
    const boxRect = els.marqueeBox.getBoundingClientRect();
    const cards = els.pageGrid.querySelectorAll('.page-card');
    candidateIds.clear();

    cards.forEach(card => {
      const cardRect = card.getBoundingClientRect();
      const isIntersecting = !(
        boxRect.right < cardRect.left ||
        boxRect.left > cardRect.right ||
        boxRect.bottom < cardRect.top ||
        boxRect.top > cardRect.bottom
      );

      if (isIntersecting) {
        card.classList.add('marquee-candidate');
        candidateIds.add(+card.dataset.id);
      } else {
        card.classList.remove('marquee-candidate');
      }
    });

    if (els.marqueeBadge) {
      els.marqueeBadge.textContent = `${candidateIds.size} trang`;
    }
  }
});

const finishMarqueeDrag = () => {
  if (!isMarqueeTracking) return;
  isMarqueeTracking = false;

  if (window.getSelection) {
    window.getSelection().removeAllRanges();
  }

  if (isMarqueeDragging) {
    isMarqueeDragging = false;
    justFinishedMarquee = true;
    setTimeout(() => { justFinishedMarquee = false; }, 220);

    // Cập nhật trạng thái lựa chọn
    if (startEventCtrl) {
      state.pages.forEach(p => {
        if (candidateIds.has(p.id)) p.selected = !p.selected;
      });
    } else if (startEventShift) {
      state.pages.forEach(p => {
        if (candidateIds.has(p.id)) p.selected = true;
      });
    } else {
      state.pages.forEach(p => {
        p.selected = candidateIds.has(p.id);
      });
    }

    els.pageGrid.querySelectorAll('.page-card.marquee-candidate').forEach(c => c.classList.remove('marquee-candidate'));
    if (els.marqueeBox) els.marqueeBox.classList.add('hidden');
    els.dropzone.classList.remove('is-marquee-selecting');

    render();
    const count = selected().length;
    if (count > 0) {
      toast(`Đã chọn ${count} trang.`);
    }
  } else {
    if (els.marqueeBox) els.marqueeBox.classList.add('hidden');
    els.dropzone.classList.remove('is-marquee-selecting');
  }
  pageGridSortable.option('disabled', false);
};

document.addEventListener('pointerup', finishMarqueeDrag);
document.addEventListener('pointercancel', finishMarqueeDrag);

// Vô hiệu hóa hành vi bôi đen văn bản và kéo ảnh của trình duyệt trên khu vực dropzone
document.addEventListener('selectstart', event => {
  if (isMarqueeTracking || isMarqueeDragging || event.target.closest('#dropzone')) {
    event.preventDefault();
  }
});

document.addEventListener('dragstart', event => {
  if (event.target.closest('.page-preview, .page-preview img, .page-card, #dropzone')) {
    event.preventDefault();
  }
});

/* ==========================================================
   CỬA SỔ XEM TRƯỚC (PREVIEW MODAL) VỚI THU PHÓNG & KÉO DI CHUYỂN
   ========================================================== */
const previewModal = document.getElementById('previewModal');
const previewCanvas = document.getElementById('previewCanvas');
const previewSpinner = document.getElementById('previewSpinner');
const previewCanvasWrapper = document.getElementById('previewCanvasWrapper');
const previewStage = document.getElementById('previewStage');
const previewZoomOutBtn = document.getElementById('previewZoomOutBtn');
const previewZoomLevelBtn = document.getElementById('previewZoomLevelBtn');
const previewZoomInBtn = document.getElementById('previewZoomInBtn');
const previewZoomFitBtn = document.getElementById('previewZoomFitBtn');

let currentPreviewId = null;
let previewZoom = 1.0;
let previewPanX = 0;
let previewPanY = 0;
let isPreviewPanning = false;
let panStartX = 0;
let panStartY = 0;

const MIN_PREVIEW_ZOOM = 0.5;
const MAX_PREVIEW_ZOOM = 3.5;
const PREVIEW_ZOOM_STEP = 0.25;

function applyPreviewTransform(withTransition = true) {
  if (!previewCanvasWrapper) return;
  if (withTransition) {
    previewCanvasWrapper.classList.remove('no-transition');
  } else {
    previewCanvasWrapper.classList.add('no-transition');
  }
  previewCanvasWrapper.style.transform = `translate(${previewPanX}px, ${previewPanY}px) scale(${previewZoom})`;
  if (previewZoomLevelBtn) {
    previewZoomLevelBtn.textContent = `${Math.round(previewZoom * 100)}%`;
  }
  if (previewCanvasWrapper) {
    previewCanvasWrapper.style.cursor = previewZoom > 1.05 ? 'grab' : 'zoom-in';
  }
}

function setPreviewZoom(newZoom, mouseX = 0, mouseY = 0, relativeToMouse = false) {
  const oldZoom = previewZoom;
  const clampedZoom = Math.max(MIN_PREVIEW_ZOOM, Math.min(MAX_PREVIEW_ZOOM, Math.round(newZoom * 100) / 100));
  if (clampedZoom === oldZoom) return;

  if (relativeToMouse && oldZoom > 0) {
    const ratio = clampedZoom / oldZoom;
    previewPanX = mouseX - (mouseX - previewPanX) * ratio;
    previewPanY = mouseY - (mouseY - previewPanY) * ratio;
  } else if (clampedZoom <= 1.0) {
    previewPanX = 0;
    previewPanY = 0;
  }

  previewZoom = clampedZoom;
  applyPreviewTransform(true);
}

function zoomInPreview() {
  setPreviewZoom(previewZoom + PREVIEW_ZOOM_STEP);
}

function zoomOutPreview() {
  setPreviewZoom(previewZoom - PREVIEW_ZOOM_STEP);
}

function resetPreviewZoom() {
  previewZoom = 1.0;
  previewPanX = 0;
  previewPanY = 0;
  applyPreviewTransform(true);
}

function fitPreview() {
  if (!previewStage || !previewCanvas) {
    resetPreviewZoom();
    return;
  }
  const stageRect = previewStage.getBoundingClientRect();
  const padding = 36;
  const availW = Math.max(100, stageRect.width - padding);
  const availH = Math.max(100, stageRect.height - padding);
  const curW = previewCanvas.offsetWidth || parseInt(previewCanvas.style.width, 10) || 500;
  const curH = previewCanvas.offsetHeight || parseInt(previewCanvas.style.height, 10) || 700;
  const scaleW = availW / curW;
  const scaleH = availH / curH;
  const fitScale = Math.min(scaleW, scaleH);
  previewZoom = Math.max(MIN_PREVIEW_ZOOM, Math.min(MAX_PREVIEW_ZOOM, Math.round(fitScale * 100) / 100));
  previewPanX = 0;
  previewPanY = 0;
  applyPreviewTransform(true);
}

if (previewZoomInBtn) previewZoomInBtn.onclick = zoomInPreview;
if (previewZoomOutBtn) previewZoomOutBtn.onclick = zoomOutPreview;
if (previewZoomLevelBtn) previewZoomLevelBtn.onclick = resetPreviewZoom;
if (previewZoomFitBtn) previewZoomFitBtn.onclick = fitPreview;

// Kéo di chuyển khi phóng to (Pan Dragging)
if (previewStage) {
  previewStage.addEventListener('pointerdown', event => {
    if (event.button !== 0) return;
    if (event.target.closest('button')) return;

    isPreviewPanning = true;
    panStartX = event.clientX - previewPanX;
    panStartY = event.clientY - previewPanY;
    if (previewCanvasWrapper) {
      previewCanvasWrapper.classList.add('is-panning');
    }
    previewStage.setPointerCapture?.(event.pointerId);
  });

  previewStage.addEventListener('pointermove', event => {
    if (!isPreviewPanning) return;
    const newX = event.clientX - panStartX;
    const newY = event.clientY - panStartY;
    const maxPan = Math.max(200, Math.max(window.innerWidth, window.innerHeight) * 0.9);
    previewPanX = Math.max(-maxPan, Math.min(maxPan, newX));
    previewPanY = Math.max(-maxPan, Math.min(maxPan, newY));
    applyPreviewTransform(false);
  });

  const stopPreviewPan = event => {
    if (!isPreviewPanning) return;
    isPreviewPanning = false;
    if (previewCanvasWrapper) {
      previewCanvasWrapper.classList.remove('is-panning');
    }
    if (event.pointerId && previewStage.hasPointerCapture?.(event.pointerId)) {
      previewStage.releasePointerCapture(event.pointerId);
    }
  };
  previewStage.addEventListener('pointerup', stopPreviewPan);
  previewStage.addEventListener('pointercancel', stopPreviewPan);

  // Cuộn chuột để phóng to thu nhỏ tại vị trí con trỏ
  previewStage.addEventListener('wheel', event => {
    event.preventDefault();
    const rect = previewStage.getBoundingClientRect();
    const mouseX = event.clientX - (rect.left + rect.width / 2);
    const mouseY = event.clientY - (rect.top + rect.height / 2);
    const delta = event.deltaY < 0 ? PREVIEW_ZOOM_STEP : -PREVIEW_ZOOM_STEP;
    setPreviewZoom(previewZoom + delta, mouseX, mouseY, true);
  }, { passive: false });

  // Nhấp đúp để phóng to nhanh hoặc đặt lại
  previewStage.addEventListener('dblclick', event => {
    if (event.target.closest('button')) return;
    if (previewZoom > 1.1) {
      resetPreviewZoom();
    } else {
      const rect = previewStage.getBoundingClientRect();
      const mouseX = event.clientX - (rect.left + rect.width / 2);
      const mouseY = event.clientY - (rect.top + rect.height / 2);
      setPreviewZoom(1.75, mouseX, mouseY, true);
    }
  });
}

async function renderPreviewCanvas(item) {
  previewCanvas.classList.remove('ready');
  previewSpinner.classList.remove('hidden');
  try {
    const pdf = await pdfjsLib.getDocument({ data: item.sourceBytes.slice() }).promise;
    const pdfPage = await pdf.getPage(item.sourcePage + 1);
    const baseRotation = pdfPage.rotate || 0;
    // Render độ nét cao để khi zoom không bị vỡ hạt
    const renderScale = Math.max(2.0, Math.min(2.8, (window.devicePixelRatio || 1) * 1.5));
    const viewport = pdfPage.getViewport({ scale: renderScale, rotation: (baseRotation + item.rotation) % 360 });
    const context = previewCanvas.getContext('2d');
    previewCanvas.width = viewport.width;
    previewCanvas.height = viewport.height;

    // Kích thước hiển thị vừa vặn trong stage tại zoom = 1.0
    const stageWidth = (previewStage && previewStage.clientWidth > 100) ? previewStage.clientWidth - 48 : 800;
    const stageHeight = (previewStage && previewStage.clientHeight > 100) ? previewStage.clientHeight - 48 : 600;
    const fitScale = Math.max(0.1, Math.min(stageWidth / viewport.width, stageHeight / viewport.height, 1));
    const displayWidth = Math.round(viewport.width * fitScale);
    const displayHeight = Math.round(viewport.height * fitScale);
    previewCanvas.style.width = `${displayWidth}px`;
    previewCanvas.style.height = `${displayHeight}px`;

    await pdfPage.render({ canvasContext: context, viewport }).promise;
    previewSpinner.classList.add('hidden');
    requestAnimationFrame(() => previewCanvas.classList.add('ready'));
  } catch (error) {
    console.error(error);
    closePreview();
    toast('Không thể mở bản xem trước của trang này.');
  }
}

async function openPreview(id) {
  const item = state.pages.find(page => page.id === id);
  if (!item) return;
  currentPreviewId = id;
  previewZoom = 1.0;
  previewPanX = 0;
  previewPanY = 0;
  applyPreviewTransform(false);

  const rotationText = item.rotation ? ` (đã xoay ${item.rotation}°)` : '';
  document.getElementById('previewTitle').textContent = `Xem trước trang ${state.pages.indexOf(item) + 1}${rotationText}`;
  document.getElementById('previewFileName').textContent = item.fileName;
  previewModal.classList.remove('hidden');
  document.body.style.overflow = 'hidden';
  requestAnimationFrame(() => previewModal.classList.add('open'));
  await renderPreviewCanvas(item);
}

function closePreview() {
  currentPreviewId = null;
  isPreviewPanning = false;
  previewModal.classList.remove('open');
  document.body.style.overflow = '';
  setTimeout(() => {
    previewModal.classList.add('hidden');
    resetPreviewZoom();
  }, 240);
}

const previewRotateLeftBtn = document.getElementById('previewRotateLeftBtn');
const previewRotateRightBtn = document.getElementById('previewRotateRightBtn');

if (previewRotateLeftBtn) {
  previewRotateLeftBtn.onclick = async () => {
    if (currentPreviewId === null) return;
    rotatePage(currentPreviewId, -90);
    const item = state.pages.find(p => p.id === currentPreviewId);
    if (item) {
      const rotationText = item.rotation ? ` (đã xoay ${item.rotation}°)` : '';
      document.getElementById('previewTitle').textContent = `Xem trước trang ${state.pages.indexOf(item) + 1}${rotationText}`;
      await renderPreviewCanvas(item);
      applyPreviewTransform(false);
    }
  };
}

if (previewRotateRightBtn) {
  previewRotateRightBtn.onclick = async () => {
    if (currentPreviewId === null) return;
    rotatePage(currentPreviewId, 90);
    const item = state.pages.find(p => p.id === currentPreviewId);
    if (item) {
      const rotationText = item.rotation ? ` (đã xoay ${item.rotation}°)` : '';
      document.getElementById('previewTitle').textContent = `Xem trước trang ${state.pages.indexOf(item) + 1}${rotationText}`;
      await renderPreviewCanvas(item);
      applyPreviewTransform(false);
    }
  };
}

document.getElementById('closePreviewBtn').onclick = closePreview;
previewModal.addEventListener('click', event => { if (event.target === previewModal) closePreview(); });
document.addEventListener('keydown', event => {
  if (event.key === 'Escape') {
    if (previewModal.classList.contains('open')) {
      closePreview();
      return;
    }
    if (selected().length > 0) {
      state.pages.forEach(p => p.selected = false);
      render();
      toast('Đã bỏ chọn tất cả.');
    }
  }
});

document.getElementById('downloadBtn').onclick = async () => {
  if (!state.pages.length) return;
  showLoading('Đang tạo PDF đã gộp...');
  try {
    const output = await PDFLib.PDFDocument.create();
    const cache = new Map();
    for (let i = 0; i < state.pages.length; i++) {
      const item = state.pages[i];
      els.loadingText.textContent = `Đang ghép trang ${i + 1}/${state.pages.length}...`;
      setProgress(((i + 1) / state.pages.length) * 90);
      if (!cache.has(item.sourceBytes)) cache.set(item.sourceBytes, await PDFLib.PDFDocument.load(item.sourceBytes));
      const [page] = await output.copyPages(cache.get(item.sourceBytes), [item.sourcePage]);
      if (item.rotation) page.setRotation(PDFLib.degrees((page.getRotation().angle + item.rotation) % 360));
      output.addPage(page);
    }
    els.loadingText.textContent = 'Đang đóng gói tệp PDF...';
    setProgress(94);
    const blob = new Blob([await output.save()], { type: 'application/pdf' });
    const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = exportFileName('pdf'); link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 2000);
    setProgress(100);
    toast('PDF đã được tạo thành công.');
  } catch (error) { console.error(error); toast('Có lỗi khi tạo PDF. Vui lòng thử lại.'); } finally { hideLoading(); }
};

function downloadBlob(blob, fileName) {
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = fileName;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 2000);
}

function normalizePdfFontName(rawName) {
  if (!rawName) return '';
  let name = String(rawName).split(',')[0].replace(/["']/g, '').trim();
  name = name.replace(/^[A-Z]{6}\+/, '');
  const aliases = [
    [/^Arial(?:-|_)?(?:Bold|Italic|BoldItalic)?MT$/i, 'Arial'],
    [/^ArialMT$/i, 'Arial'],
    [/^TimesNewRomanPS(?:-|_)?(?:Bold|Italic|BoldItalic)?MT$/i, 'Times New Roman'],
    [/^TimesNewRomanPSMT$/i, 'Times New Roman'],
    [/^CourierNewPS(?:-|_)?(?:Bold|Italic|BoldItalic)?MT$/i, 'Courier New'],
    [/^Calibri(?:-|_)?(?:Bold|Italic|BoldItalic)?$/i, 'Calibri'],
    [/^Helvetica(?:-|_)?(?:Bold|Oblique|BoldOblique)?$/i, 'Arial'],
    [/^Times(?:-|_)?(?:Bold|Italic|BoldItalic|Roman)?$/i, 'Times New Roman'],
    [/^Courier(?:-|_)?(?:Bold|Oblique|BoldOblique)?$/i, 'Courier New']
  ];
  for (const [pattern, replacement] of aliases) if (pattern.test(name)) return replacement;
  return name.replace(/(?:PS)?(?:-|_)?(?:BoldItalic|BoldOblique|Bold|Italic|Oblique|Regular|Roman|MT)$/i, '').replace(/[-_]+/g, ' ').trim() || name;
}

function pdfFontMetadata(pdfPage, textContent) {
  const metadata = new Map();
  const fontIds = new Set(textContent.items.map(item => item.fontName).filter(Boolean));
  fontIds.forEach(fontId => {
    const style = textContent.styles[fontId] || {};
    let fontObject;
    try { fontObject = pdfPage.commonObjs.get(fontId); } catch (_) { fontObject = null; }
    const candidates = [
      fontObject?.name,
      fontObject?.systemFontInfo?.css,
      fontObject?.systemFontInfo?.loadedName,
      fontObject?.fallbackName,
      style.fontFamily
    ];
    const specificName = candidates.map(normalizePdfFontName).find(name => name && !/^(sans-serif|serif|monospace)$/i.test(name));
    const genericName = normalizePdfFontName(style.fontFamily);
    metadata.set(fontId, {
      family: specificName || (/^serif$/i.test(genericName) ? 'Times New Roman' : /^monospace$/i.test(genericName) ? 'Courier New' : 'Arial'),
      descriptor: `${fontId} ${candidates.filter(Boolean).join(' ')}`
    });
  });
  return metadata;
}

function textLinesFromPdf(textContent, viewport, fontMetadata) {
  const textItems = textContent.items.filter(item => item.str?.trim()).map(item => {
    const matrix = pdfjsLib.Util.transform(viewport.transform, item.transform);
    const fontSize = Math.max(1, Math.hypot(matrix[2], matrix[3]));
    const font = fontMetadata.get(item.fontName) || { family: 'Arial', descriptor: item.fontName };
    return {
      text: item.str,
      x: matrix[4],
      y: matrix[5] - fontSize,
      width: Math.max(0, item.width || 0),
      fontSize,
      fontFamily: font.family,
      bold: /bold|black|heavy|demi|semibold/i.test(font.descriptor),
      italics: /italic|oblique/i.test(font.descriptor)
    };
  }).sort((a, b) => a.y - b.y || a.x - b.x);

  const lines = [];
  textItems.forEach(textItem => {
    const line = lines.find(candidate => Math.abs(candidate.y - textItem.y) <= Math.max(2, textItem.fontSize * .35));
    if (line) {
      line.items.push(textItem);
      line.y = Math.min(line.y, textItem.y);
    } else {
      lines.push({ y: textItem.y, items: [textItem] });
    }
  });
  return lines.sort((a, b) => a.y - b.y).map(line => ({ ...line, items: line.items.sort((a, b) => a.x - b.x) }));
}

document.getElementById('downloadWordBtn').onclick = async () => {
  if (!state.pages.length) return;
  if (!window.docx) return toast('Không thể tải bộ tạo Word. Hãy kiểm tra kết nối mạng và thử lại.');
  showLoading('Đang chuẩn bị tài liệu Word...');
  try {
    const { Document, Packer, Paragraph, TextRun, PageOrientation } = window.docx;
    const pdfCache = new Map();
    const sections = [];
    let extractedCharacters = 0;
    let pagesWithoutText = 0;
    for (let i = 0; i < state.pages.length; i++) {
      const item = state.pages[i];
      els.loadingText.textContent = `Đang chuyển trang ${i + 1}/${state.pages.length} sang Word...`;
      setProgress(((i + 1) / state.pages.length) * 90);
      if (!pdfCache.has(item.sourceBytes)) {
        pdfCache.set(item.sourceBytes, await pdfjsLib.getDocument({ data: item.sourceBytes.slice() }).promise);
      }
      const pdfPage = await pdfCache.get(item.sourceBytes).getPage(item.sourcePage + 1);
      const rotation = ((pdfPage.rotate || 0) + item.rotation) % 360;
      const pageViewport = pdfPage.getViewport({ scale: 1, rotation });
      const textContent = await pdfPage.getTextContent({ includeMarkedContent: false, disableNormalization: false });
      const fontMetadata = pdfFontMetadata(pdfPage, textContent);
      const lines = textLinesFromPdf(textContent, pageViewport, fontMetadata);
      const pageCharacters = lines.reduce((sum, line) => sum + line.items.reduce((lineSum, textItem) => lineSum + textItem.text.length, 0), 0);
      extractedCharacters += pageCharacters;
      if (!pageCharacters) pagesWithoutText++;
      const landscape = pageViewport.width > pageViewport.height;
      let previousBottom = 0;
      const children = lines.map(line => {
        const fontHeight = Math.max(...line.items.map(textItem => textItem.fontSize));
        const left = Math.max(0, Math.min(...line.items.map(textItem => textItem.x)));
        const before = Math.max(0, line.y - previousBottom);
        previousBottom = Math.max(previousBottom, line.y + fontHeight);
        let previousRight = left;
        const runs = [];
        line.items.forEach(textItem => {
          const gap = Math.max(0, textItem.x - previousRight);
          const spaces = Math.min(80, Math.max(0, Math.round(gap / Math.max(2, textItem.fontSize * .28))));
          if (spaces) runs.push(new TextRun({ text: ' '.repeat(spaces), size: Math.round(textItem.fontSize * 2) }));
          runs.push(new TextRun({
            text: textItem.text,
            font: textItem.fontFamily,
            size: Math.round(textItem.fontSize * 2),
            bold: textItem.bold,
            italics: textItem.italics
          }));
          previousRight = textItem.x + textItem.width;
        });
        return new Paragraph({
          indent: { left: Math.round(left * 20) },
          spacing: { before: Math.round(before * 20), after: 0, line: Math.round(fontHeight * 20), lineRule: 'exact' },
          children: runs
        });
      });
      if (!children.length) children.push(new Paragraph({ children: [new TextRun({ text: `[Trang ${i + 1} không có lớp văn bản để chuyển đổi]`, color: '777777', italics: true })] }));
      sections.push({
        properties: {
          page: {
            size: {
              // docx tự hoán đổi hai cạnh khi đặt LANDSCAPE, nên truyền khổ dọc vào API.
              width: Math.round((landscape ? pageViewport.height : pageViewport.width) * 20),
              height: Math.round((landscape ? pageViewport.width : pageViewport.height) * 20),
              orientation: landscape ? PageOrientation.LANDSCAPE : PageOrientation.PORTRAIT
            },
            margin: { top: 0, right: 0, bottom: 0, left: 0, header: 0, footer: 0, gutter: 0 }
          }
        },
        children
      });
    }
    if (!extractedCharacters) throw new Error('PDF_SCAN_ONLY');
    els.loadingText.textContent = 'Đang đóng gói tài liệu Word...';
    setProgress(94);
    const blob = await Packer.toBlob(new Document({ sections }));
    downloadBlob(blob, exportFileName('docx'));
    setProgress(100);
    toast(pagesWithoutText ? `Đã xuất Word; ${pagesWithoutText} trang không có văn bản để chỉnh sửa.` : 'Đã xuất Word dạng văn bản có thể chỉnh sửa.');
  } catch (error) {
    console.error(error);
    toast(error.message === 'PDF_SCAN_ONLY' ? 'PDF này là bản scan/ảnh, cần OCR trước khi xuất Word chỉnh sửa.' : 'Có lỗi khi xuất Word. Vui lòng thử lại.');
  } finally { hideLoading(); }
};
