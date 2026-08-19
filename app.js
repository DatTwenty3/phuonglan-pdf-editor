pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

const state = { pages: [], nextId: 1, nextFileColor: 0, compact: true, insertAt: null };
const filePalette = [
  ['#6b352b', '#d7ad9d'], ['#285f70', '#9fc5cf'], ['#6b5a20', '#d8c985'],
  ['#694273', '#c8a8cf'], ['#387044', '#a8cfaf'], ['#9a4d22', '#e2b18f'],
  ['#3e4f83', '#aeb9df'], ['#8a3b58', '#dfadc0']
];
const els = Object.fromEntries(['emptyState','workspace','fileInput','pageGrid','compactFiles','fileModeBtn','pageModeBtn','summary','deleteBtn','selectAllBtn','rotateLeftBtn','rotateRightBtn','dropzone','loading','loadingText','toast'].map(id => [id, document.getElementById(id)]));

const showLoading = (text) => { els.loadingText.textContent = text; els.loading.classList.remove('hidden'); };
const hideLoading = () => els.loading.classList.add('hidden');
const toast = (text) => { els.toast.textContent = text; els.toast.classList.add('show'); setTimeout(() => els.toast.classList.remove('show'), 2600); };
const selected = () => state.pages.filter(page => page.selected);

async function addFiles(fileList) {
  const files = [...fileList].filter(file => file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf'));
  if (!files.length) return toast('Vui lòng chọn tệp PDF hợp lệ.');
  const insertionRequested = state.insertAt !== null;
  showLoading(`Đang đọc ${files.length} tệp PDF...`);
  try {
    const addedPages = [];
    for (const file of files) {
      const fileColor = state.nextFileColor++ % filePalette.length;
      const bytes = new Uint8Array(await file.arrayBuffer());
      const pdf = await pdfjsLib.getDocument({ data: bytes.slice() }).promise;
      for (let pageIndex = 0; pageIndex < pdf.numPages; pageIndex++) {
        addedPages.push({ id: state.nextId++, fileName: file.name, sourceBytes: bytes, sourcePage: pageIndex, fileColor, rotation: 0, selected: false, thumb: null });
      }
    }
    const insertionIndex = state.insertAt === null ? state.pages.length : Math.max(0, Math.min(state.insertAt, state.pages.length));
    state.pages.splice(insertionIndex, 0, ...addedPages);
    els.emptyState.classList.add('hidden');
    els.workspace.classList.remove('hidden');
    if (!insertionRequested) state.compact = true;
    render();
    await renderMissingThumbnails();
    render();
    toast(`Đã thêm ${files.length} tệp PDF.`);
  } catch (error) {
    console.error(error);
    toast('Không thể đọc PDF. Tệp có thể bị khóa hoặc bị lỗi.');
  } finally { state.insertAt = null; hideLoading(); }
}

async function renderMissingThumbnails() {
  const grouped = new Map();
  state.pages.filter(p => !p.thumb).forEach(p => { if (!grouped.has(p.sourceBytes)) grouped.set(p.sourceBytes, []); grouped.get(p.sourceBytes).push(p); });
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
      if (target) target.innerHTML = `<img src="${item.thumb}" alt="Xem trước trang" style="max-width:100%;max-height:100%;transform:rotate(${item.rotation}deg)">`;
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
  const insertButton = index => `<button class="insert-point" type="button" data-insert-at="${index}" aria-label="Thêm PDF vào vị trí này" title="Thêm PDF vào đây">＋</button>`;
  els.compactFiles.innerHTML = fileGroups.map(group => `
    <article class="compact-file-card" data-segment-pages="${group.pages.map(page => page.id).join(',')}">
      <div class="compact-cover">${group.pages[0].thumb ? `<img src="${group.pages[0].thumb}" alt="Trang đầu của ${escapeHtml(group.fileName)}">` : 'PDF'}</div>
      <div class="compact-file-info">
        <b title="${escapeHtml(group.fileName)}">${escapeHtml(group.fileName)}</b>
        <span>${group.pages.length} trang PDF${group.segmentTotal > 1 ? ` • Phần ${group.segmentPosition}/${group.segmentTotal}` : ''}</span>
        <div class="compact-actions">
          <button class="file-delete" type="button" data-delete-segment="${group.pages.map(page => page.id).join(',')}" aria-label="Xóa ${group.segmentTotal > 1 ? `phần ${group.segmentPosition} của` : 'tệp'} ${escapeHtml(group.fileName)}" title="Xóa nhóm trang này">× ${group.segmentTotal > 1 ? 'Xóa phần' : 'Xóa file'}</button>
        </div>
      </div>
    </article>${insertButton(state.pages.indexOf(group.pages[group.pages.length - 1]) + 1)}`).join('');
  els.pageGrid.innerHTML = state.pages.map((page, index) => `
    <article class="page-card file-colored ${page.selected ? 'selected' : ''}" data-id="${page.id}" style="--file-color:${filePalette[page.fileColor ?? 0][0]};--file-soft:${filePalette[page.fileColor ?? 0][1]}">
      <input class="page-check" type="checkbox" ${page.selected ? 'checked' : ''} aria-label="Chọn trang ${index + 1}">
      <button class="remove-one" aria-label="Xóa trang ${index + 1}" title="Xóa riêng trang ${index + 1}">×</button>
      <div class="page-preview">${page.thumb ? `<img src="${page.thumb}" alt="Xem trước trang ${index + 1}" style="max-width:100%;max-height:100%;transform:rotate(${page.rotation}deg)">` : 'Đang tải...'}</div>
      <div class="page-meta"><div class="page-number">Trang ${index + 1}</div><div class="file-name" title="${escapeHtml(page.fileName)}">${escapeHtml(page.fileName)}</div></div>
    </article>${insertButton(index + 1)}`).join('');
  const count = selected().length;
  els.compactFiles.classList.toggle('hidden', !state.compact);
  els.pageGrid.classList.toggle('hidden', state.compact);
  els.fileModeBtn.classList.toggle('active', state.compact);
  els.pageModeBtn.classList.toggle('active', !state.compact);
  els.fileModeBtn.setAttribute('aria-pressed', String(state.compact));
  els.pageModeBtn.setAttribute('aria-pressed', String(!state.compact));
  const uniqueFileCount = new Set(state.pages.map(page => page.sourceBytes)).size;
  const multiMoveHint = count > 1 ? ` • Đã chọn ${count} trang — kéo một trang đã chọn để di chuyển cả nhóm` : '';
  els.summary.textContent = state.compact ? `${state.pages.length} trang trong ${fileGroups.length} nhóm từ ${uniqueFileCount} tệp PDF` : `${state.pages.length} trang từ ${uniqueFileCount} tệp • Kéo thả để thay đổi thứ tự${multiMoveHint}`;
  els.deleteBtn.disabled = els.rotateLeftBtn.disabled = els.rotateRightBtn.disabled = count === 0;
  els.selectAllBtn.textContent = count === state.pages.length && count ? '☐ Bỏ chọn tất cả' : '☑ Chọn tất cả';
}

function escapeHtml(text) { const div = document.createElement('div'); div.textContent = text; return div.innerHTML; }
function removePages(ids) { state.pages = state.pages.filter(page => !ids.includes(page.id)); if (!state.pages.length) { els.workspace.classList.add('hidden'); els.emptyState.classList.remove('hidden'); } render(); }
function rotateSelected(amount) { selected().forEach(page => page.rotation = (page.rotation + amount + 360) % 360); render(); }

els.pageGrid.addEventListener('change', event => { if (!event.target.matches('.page-check')) return; const page = state.pages.find(p => p.id === +event.target.closest('.page-card').dataset.id); page.selected = event.target.checked; render(); });
els.pageGrid.addEventListener('click', event => { if (!event.target.matches('.remove-one')) return; removePages([+event.target.closest('.page-card').dataset.id]); });
els.pageGrid.addEventListener('click', event => {
  if (event.target.closest('.page-check, .remove-one')) return;
  const card = event.target.closest('.page-card');
  if (card) openPreview(+card.dataset.id);
});
document.getElementById('deleteBtn').onclick = () => { const ids = selected().map(p => p.id); if (ids.length) removePages(ids); };
document.getElementById('selectAllBtn').onclick = () => { const value = selected().length !== state.pages.length; state.pages.forEach(p => p.selected = value); render(); };
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

let multiPageDrag = null;
new Sortable(els.pageGrid, {
  draggable: '.page-card',
  animation: 180,
  delay: 80,
  delayOnTouchOnly: true,
  onStart: event => {
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

const previewModal = document.getElementById('previewModal');
const previewCanvas = document.getElementById('previewCanvas');
const previewSpinner = document.getElementById('previewSpinner');

async function openPreview(id) {
  const item = state.pages.find(page => page.id === id);
  if (!item) return;
  document.getElementById('previewTitle').textContent = `Xem trước trang ${state.pages.indexOf(item) + 1}`;
  document.getElementById('previewFileName').textContent = item.fileName;
  previewCanvas.classList.remove('ready');
  previewSpinner.classList.remove('hidden');
  previewModal.classList.remove('hidden');
  document.body.style.overflow = 'hidden';
  requestAnimationFrame(() => previewModal.classList.add('open'));
  try {
    const pdf = await pdfjsLib.getDocument({ data: item.sourceBytes.slice() }).promise;
    const pdfPage = await pdf.getPage(item.sourcePage + 1);
    const baseRotation = pdfPage.rotate || 0;
    const viewport = pdfPage.getViewport({ scale: 1.7, rotation: (baseRotation + item.rotation) % 360 });
    const context = previewCanvas.getContext('2d');
    previewCanvas.width = viewport.width;
    previewCanvas.height = viewport.height;
    await pdfPage.render({ canvasContext: context, viewport }).promise;
    previewSpinner.classList.add('hidden');
    requestAnimationFrame(() => previewCanvas.classList.add('ready'));
  } catch (error) {
    console.error(error);
    closePreview();
    toast('Không thể mở bản xem trước của trang này.');
  }
}

function closePreview() {
  previewModal.classList.remove('open');
  document.body.style.overflow = '';
  setTimeout(() => previewModal.classList.add('hidden'), 240);
}

document.getElementById('closePreviewBtn').onclick = closePreview;
previewModal.addEventListener('click', event => { if (event.target === previewModal) closePreview(); });
document.addEventListener('keydown', event => { if (event.key === 'Escape' && previewModal.classList.contains('open')) closePreview(); });

document.getElementById('downloadBtn').onclick = async () => {
  if (!state.pages.length) return;
  showLoading('Đang tạo PDF đã gộp...');
  try {
    const output = await PDFLib.PDFDocument.create();
    const cache = new Map();
    for (let i = 0; i < state.pages.length; i++) {
      const item = state.pages[i];
      els.loadingText.textContent = `Đang ghép trang ${i + 1}/${state.pages.length}...`;
      if (!cache.has(item.sourceBytes)) cache.set(item.sourceBytes, await PDFLib.PDFDocument.load(item.sourceBytes));
      const [page] = await output.copyPages(cache.get(item.sourceBytes), [item.sourcePage]);
      if (item.rotation) page.setRotation(PDFLib.degrees((page.getRotation().angle + item.rotation) % 360));
      output.addPage(page);
    }
    const blob = new Blob([await output.save()], { type: 'application/pdf' });
    const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = 'BE-LAN-PDF-EDITOR.pdf'; link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 2000);
    toast('PDF đã được tạo thành công.');
  } catch (error) { console.error(error); toast('Có lỗi khi tạo PDF. Vui lòng thử lại.'); } finally { hideLoading(); }
};
