pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

const state = { pages: [], nextId: 1 };
const els = Object.fromEntries(['emptyState','workspace','fileInput','pageGrid','summary','deleteBtn','selectAllBtn','rotateLeftBtn','rotateRightBtn','dropzone','loading','loadingText','toast'].map(id => [id, document.getElementById(id)]));

const showLoading = (text) => { els.loadingText.textContent = text; els.loading.classList.remove('hidden'); };
const hideLoading = () => els.loading.classList.add('hidden');
const toast = (text) => { els.toast.textContent = text; els.toast.classList.add('show'); setTimeout(() => els.toast.classList.remove('show'), 2600); };
const selected = () => state.pages.filter(page => page.selected);

async function addFiles(fileList) {
  const files = [...fileList].filter(file => file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf'));
  if (!files.length) return toast('Vui lòng chọn tệp PDF hợp lệ.');
  showLoading(`Đang đọc ${files.length} tệp PDF...`);
  try {
    for (const file of files) {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const pdf = await pdfjsLib.getDocument({ data: bytes.slice() }).promise;
      for (let pageIndex = 0; pageIndex < pdf.numPages; pageIndex++) {
        state.pages.push({ id: state.nextId++, fileName: file.name, sourceBytes: bytes, sourcePage: pageIndex, rotation: 0, selected: false, thumb: null });
      }
    }
    els.emptyState.classList.add('hidden');
    els.workspace.classList.remove('hidden');
    render();
    await renderMissingThumbnails();
    toast(`Đã thêm ${files.length} tệp PDF.`);
  } catch (error) {
    console.error(error);
    toast('Không thể đọc PDF. Tệp có thể bị khóa hoặc bị lỗi.');
  } finally { hideLoading(); }
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
  els.pageGrid.innerHTML = state.pages.map((page, index) => `
    <article class="page-card ${page.selected ? 'selected' : ''}" data-id="${page.id}">
      <input class="page-check" type="checkbox" ${page.selected ? 'checked' : ''} aria-label="Chọn trang ${index + 1}">
      <button class="remove-one" aria-label="Xóa trang ${index + 1}" title="Xóa riêng trang ${index + 1}">×</button>
      <div class="page-preview">${page.thumb ? `<img src="${page.thumb}" alt="Xem trước trang ${index + 1}" style="max-width:100%;max-height:100%;transform:rotate(${page.rotation}deg)">` : 'Đang tải...'}</div>
      <div class="page-meta"><div class="page-number">Trang ${index + 1}</div><div class="file-name" title="${escapeHtml(page.fileName)}">${escapeHtml(page.fileName)}</div></div>
    </article>`).join('');
  const count = selected().length;
  els.summary.textContent = `${state.pages.length} trang từ ${new Set(state.pages.map(p => p.sourceBytes)).size} tệp • Kéo thả để thay đổi thứ tự`;
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
['heroAddBtn','addBtn'].forEach(id => document.getElementById(id).onclick = () => els.fileInput.click());
document.querySelector('.inline-drop').onclick = () => els.fileInput.click();
els.fileInput.onchange = event => { addFiles(event.target.files); event.target.value = ''; };

new Sortable(els.pageGrid, { animation: 180, delay: 80, delayOnTouchOnly: true, onEnd: event => { const [moved] = state.pages.splice(event.oldIndex, 1); state.pages.splice(event.newIndex, 0, moved); render(); } });

['dragenter','dragover'].forEach(name => document.addEventListener(name, event => { event.preventDefault(); els.dropzone.classList.add('dragover'); }));
['dragleave','drop'].forEach(name => document.addEventListener(name, event => { event.preventDefault(); if (name === 'drop') addFiles(event.dataTransfer.files); els.dropzone.classList.remove('dragover'); }));

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
    const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = 'PHUONGLAN-PDF-EDITOR.pdf'; link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 2000);
    toast('PDF đã được tạo thành công.');
  } catch (error) { console.error(error); toast('Có lỗi khi tạo PDF. Vui lòng thử lại.'); } finally { hideLoading(); }
};
