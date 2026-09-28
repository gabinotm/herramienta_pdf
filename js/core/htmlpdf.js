// Convierte contenido HTML renderizado (Word, PowerPoint) en páginas PDF:
// captura con html2canvas + capa de texto invisible para que el resultado sea buscable.
import { loadScript, canvasToBlob } from './dom.js';
import { addInvisibleText, simpleMapper } from './text.js';

export async function getHtml2canvas() {
    await loadScript(new URL('../../vendor/html2canvas.min.js', import.meta.url).href);
    return window.html2canvas;
}

/** Contenedor fuera de la pantalla pero renderizado (necesario para medir y capturar). */
export function offscreenHost() {
    const host = document.createElement('div');
    host.setAttribute('aria-hidden', 'true');
    Object.assign(host.style, { position: 'fixed', left: '-20000px', top: '0', zIndex: '-1', background: '#fff', colorScheme: 'light' });
    document.body.append(host);
    return host;
}

/** Palabras visibles del elemento con su posición (px relativos al elemento). */
export function collectWords(el) {
    const base = el.getBoundingClientRect();
    const words = [];
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    const range = document.createRange();
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const text = node.nodeValue;
        if (!text || !text.trim()) continue;
        const re = /\S+/g;
        let m;
        while ((m = re.exec(text))) {
            range.setStart(node, m.index);
            range.setEnd(node, m.index + m[0].length);
            const r = range.getClientRects()[0];
            if (!r || r.width < 0.5 || r.height < 0.5) continue;
            words.push({ text: m[0], x0: r.left - base.left, y0: r.top - base.top, x1: r.right - base.left, y1: r.bottom - base.top });
        }
    }
    return words;
}

/** Busca una fila en blanco cerca de `y` (hacia arriba) para no cortar líneas de texto. */
function findCut(ctx, width, y, minY) {
    const step = Math.max(1, Math.floor(width / 400));
    for (let row = Math.floor(y); row > minY; row--) {
        const data = ctx.getImageData(0, row, width, 1).data;
        let blank = true;
        for (let x = 0; x < width * 4; x += 4 * step) {
            if (data[x] < 245 || data[x + 1] < 245 || data[x + 2] < 245) {
                blank = false;
                break;
            }
        }
        if (blank) return row;
    }
    return Math.floor(y);
}

/**
 * Añade al documento pdf-lib las páginas de un elemento.
 * pageWidthPt/pageHeightPt: tamaño de página; el elemento se escala al ancho de página.
 * Si el elemento es más alto que una página, se divide en varias.
 */
export async function elementToPages(pdf, el, { pageWidthPt, pageHeightPt, font, scale = 2, split = true }) {
    const html2canvas = await getHtml2canvas();
    const rect = el.getBoundingClientRect();
    const words = font ? collectWords(el) : [];
    const canvas = await html2canvas(el, { scale, backgroundColor: '#ffffff', logging: false, useCORS: true, windowWidth: Math.ceil(rect.width) + 40 });
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const pxPerPt = rect.width / pageWidthPt; // píxeles CSS por punto
    const pagePx = split ? pageHeightPt * pxPerPt : rect.height;
    // Márgenes del documento: el contenido de las páginas siguientes se coloca dentro de ellos.
    const cs = getComputedStyle(el);
    const mt = split ? Math.min(pagePx * 0.3, parseFloat(cs.paddingTop) || 0) : 0;
    const mb = split ? Math.min(pagePx * 0.3, parseFloat(cs.paddingBottom) || 0) : 0;
    const cuts = [0];
    while (split) {
        const top = cuts[cuts.length - 1];
        const first = cuts.length === 1;
        const avail = first ? pagePx - mb : pagePx - mt - mb;
        if (rect.height - top <= (first ? pagePx : avail + mb) + 2) break;
        const cut = findCut(ctx, canvas.width, (top + avail) * scale, (top + avail * 0.8) * scale) / scale;
        cuts.push(Math.max(cut, top + 1));
    }
    cuts.push(rect.height);
    let pages = 0;
    for (let i = 0; i < cuts.length - 1; i++) {
        const top = cuts[i];
        const bottom = cuts[i + 1];
        const offset = i === 0 ? 0 : mt; // desplazamiento vertical dentro de la página (px)
        if (bottom - top < 2) continue;
        const slice = document.createElement('canvas');
        slice.width = canvas.width;
        slice.height = Math.ceil((bottom - top) * scale);
        const sctx = slice.getContext('2d');
        sctx.fillStyle = '#fff';
        sctx.fillRect(0, 0, slice.width, slice.height);
        sctx.drawImage(canvas, 0, Math.floor(top * scale), canvas.width, slice.height, 0, 0, slice.width, slice.height);
        const jpg = await pdf.embedJpg(await (await canvasToBlob(slice, 'image/jpeg', 0.92)).arrayBuffer());
        const hPt = split ? pageHeightPt : rect.height / pxPerPt;
        const page = pdf.addPage([pageWidthPt, hPt]);
        const drawnH = (bottom - top) / pxPerPt;
        page.drawImage(jpg, { x: 0, y: hPt - offset / pxPerPt - drawnH, width: pageWidthPt, height: drawnH });
        if (font) {
            const inPage = words.filter(w => (w.y0 + w.y1) / 2 >= top && (w.y0 + w.y1) / 2 < bottom)
                .map(w => ({ ...w, y0: w.y0 - top + offset, y1: w.y1 - top + offset }));
            addInvisibleText(page, font, inPage, simpleMapper(hPt, 1 / pxPerPt));
        }
        pages++;
    }
    canvas.width = canvas.height = 0;
    return pages;
}
