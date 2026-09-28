// Vista previa real: aplica la modificación a una copia de una página y la dibuja con pdf.js.
import { h, icon, debounce } from '../core/dom.js';
import { openViewer } from '../core/viewer.js';
import { getPdfjs, renderPage } from '../core/pdf.js';

/**
 * bytes: PDF original. apply(doc, pageIndex) modifica el documento pdf-lib (de 1 página, índice 0)
 * getPage(): índice de la página a previsualizar en el original.
 */
export function livePreview(bytes, apply, { width = 520 } = {}) {
    const canvas = h('canvas', { 'aria-label': 'Vista previa del resultado', role: 'img' });
    const status = h('p', { class: 'hint', 'aria-live': 'polite' });
    let lastBytes = null;
    const zoomBtn = h('button', {
        type: 'button', class: 'btn btn-sm btn-outline', disabled: true,
        onclick: () => lastBytes && openViewer({ bytes: lastBytes, name: 'Vista previa del resultado' }),
    }, icon('fa-magnifying-glass-plus'), 'Ampliar vista previa');
    canvas.style.cursor = 'zoom-in';
    canvas.addEventListener('click', () => zoomBtn.click());
    const node = h('div', {}, h('div', { class: 'preview-zoom' }, zoomBtn), h('div', { class: 'preview-box' }, canvas), status);
    let seq = 0;
    let srcDoc = null;

    async function draw(pageIndex = 0) {
        const my = ++seq;
        try {
            const { PDFDocument } = PDFLib;
            if (!srcDoc) srcDoc = await PDFDocument.load(bytes, { updateMetadata: false });
            const single = await PDFDocument.create();
            const [p] = await single.copyPages(srcDoc, [pageIndex]);
            single.addPage(p);
            await apply(single, pageIndex);
            const out = await single.save();
            if (my !== seq) return;
            lastBytes = out;
            zoomBtn.disabled = false;
            const pdfjs = await getPdfjs();
            const doc = await pdfjs.getDocument({ data: out, isEvalSupported: false }).promise;
            const page = await doc.getPage(1);
            const vp = page.getViewport({ scale: 1 });
            const cssW = Math.min(width, vp.width * 1.5);
            const ratio = window.devicePixelRatio || 1;
            const tmp = document.createElement('canvas');
            await renderPage(page, { scale: (cssW / vp.width) * ratio, canvas: tmp });
            if (my !== seq) return doc.destroy();
            canvas.width = tmp.width;
            canvas.height = tmp.height;
            canvas.getContext('2d').drawImage(tmp, 0, 0);
            canvas.style.width = `${cssW}px`;
            status.textContent = `Vista previa de la página ${pageIndex + 1}`;
            await doc.destroy();
        } catch (e) {
            status.textContent = e?.message ? `No se puede previsualizar: ${e.message}` : 'No se puede previsualizar con estas opciones.';
        }
    }
    const refresh = debounce(draw, 200);
    return { node, refresh, draw };
}
