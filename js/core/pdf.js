// Envoltorios de pdf.js (lectura/renderizado) y pdf-lib (escritura).
import { CONFIG } from '../config.js';
import { Errors, toUserError } from './errors.js';

const VENDOR = new URL('../../vendor/', import.meta.url);
let pdfjsPromise = null;

export function getPdfjs() {
    if (!pdfjsPromise) {
        pdfjsPromise = import(new URL('pdfjs/pdf.min.js', VENDOR).href).then(lib => {
            lib.GlobalWorkerOptions.workerSrc = new URL('pdfjs/pdf.worker.min.js', VENDOR).href;
            return lib;
        });
    }
    return pdfjsPromise;
}

/**
 * Abre un PDF con pdf.js. `bytes` se copia porque pdf.js transfiere el buffer al worker.
 * Lanza UserError si está protegido, dañado o excede el límite de páginas.
 */
export async function openPdf(bytes, { name = 'el archivo', password, checkLimit = true } = {}) {
    const pdfjs = await getPdfjs();
    const task = pdfjs.getDocument({
        data: bytes.slice(),
        password,
        isEvalSupported: false, // mitigación de seguridad (CVE-2024-4367)
        cMapUrl: new URL('pdfjs/cmaps/', VENDOR).href,
        cMapPacked: true,
        standardFontDataUrl: new URL('pdfjs/standard_fonts/', VENDOR).href,
    });
    try {
        const doc = await task.promise;
        if (checkLimit && doc.numPages > CONFIG.maxPages) {
            await doc.destroy();
            throw Errors.tooManyPages(name, CONFIG.maxPages);
        }
        return doc;
    } catch (err) {
        if (err?.name === 'PasswordException') {
            throw err.code === 2 ? Errors.wrongPassword() : Errors.encrypted(name);
        }
        throw toUserError(err, name);
    }
}

/** Dibuja una página en un canvas. `rotation` es adicional a la rotación propia de la página. */
export async function renderPage(page, { scale = 1, rotation = 0, canvas = document.createElement('canvas'), background = '#ffffff', annotations = true, intent = 'print' } = {}) {
    const viewport = page.getViewport({ scale, rotation: (page.rotate + rotation) % 360 });
    canvas.width = Math.max(1, Math.floor(viewport.width));
    canvas.height = Math.max(1, Math.floor(viewport.height));
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const pdfjs = await getPdfjs();
    // intent 'print': pdf.js no usa requestAnimationFrame, así que sigue trabajando aunque la pestaña esté oculta.
    await page.render({
        canvasContext: ctx,
        viewport,
        intent,
        annotationMode: annotations ? pdfjs.AnnotationMode.ENABLE_FORMS : pdfjs.AnnotationMode.DISABLE,
    }).promise;
    return { canvas, viewport };
}

/**
 * Convierte coordenadas de pantalla (viewport de pdf.js) al espacio de usuario del PDF.
 * Tiene en cuenta la rotación de la página y el CropBox.
 * angle: dirección (en grados, antihorario) que en pantalla apunta "a la derecha".
 * unit: puntos PDF por píxel del viewport.
 */
export function displayMapper(viewport) {
    const toPdf = (x, y) => viewport.convertToPdfPoint(x, y);
    const [ax, ay] = toPdf(0, 0);
    const [bx, by] = toPdf(100, 0);
    return {
        toPdf,
        angle: (Math.atan2(by - ay, bx - ax) * 180) / Math.PI,
        unit: Math.hypot(bx - ax, by - ay) / 100,
    };
}

/** Escala para que la página quepa en un ancho/alto en píxeles CSS. */
export function fitScale(page, maxW, maxH = Infinity) {
    const vp = page.getViewport({ scale: 1 });
    return Math.min(maxW / vp.width, maxH / vp.height);
}

/**
 * Carga un PDF con pdf-lib para modificarlo.
 * Rechaza PDFs cifrados (pdf-lib no puede escribirlos correctamente).
 */
export async function loadPdfLib(bytes, name = 'el archivo', opts = {}) {
    const { PDFDocument } = PDFLib;
    try {
        const doc = await PDFDocument.load(bytes, { updateMetadata: false, ...opts });
        if (doc.getPageCount() > CONFIG.maxPages) throw Errors.tooManyPages(name, CONFIG.maxPages);
        return doc;
    } catch (err) {
        if (/is encrypted/i.test(err?.message || '')) throw Errors.encrypted(name);
        throw toUserError(err, name);
    }
}

/** Guarda un documento pdf-lib como Uint8Array. */
export function savePdf(doc, opts = {}) {
    return doc.save({ useObjectStreams: true, ...opts });
}

/** Extrae el texto de una página agrupado en líneas (orden de lectura aproximado). */
export async function pageTextLines(page) {
    const content = await page.getTextContent();
    const items = content.items.filter(it => it.str !== undefined && it.str.trim() !== '');
    const rows = [];
    for (const it of items) {
        const y = it.transform[5];
        const x = it.transform[4];
        const size = Math.hypot(it.transform[2], it.transform[3]) || it.height || 10;
        let row = rows.find(r => Math.abs(r.y - y) < Math.max(2, size * 0.4));
        if (!row) {
            row = { y, size, items: [] };
            rows.push(row);
        }
        row.items.push({ x, w: it.width, str: it.str, size, font: it.fontName });
    }
    rows.sort((a, b) => b.y - a.y);
    for (const r of rows) r.items.sort((a, b) => a.x - b.x);
    return rows.map(r => {
        let text = '';
        let lastEnd = null;
        for (const it of r.items) {
            if (lastEnd !== null && it.x - lastEnd > it.size * 0.25 && !text.endsWith(' ') && !it.str.startsWith(' ')) text += ' ';
            text += it.str;
            lastEnd = it.x + it.w;
        }
        return { y: r.y, size: r.size, text: text.replace(/\s+/g, ' ').trim(), items: r.items };
    }).filter(l => l.text);
}

export async function pdfHasText(doc, maxPages = 5) {
    const n = Math.min(doc.numPages, maxPages);
    for (let i = 1; i <= n; i++) {
        const page = await doc.getPage(i);
        const c = await page.getTextContent();
        if (c.items.some(it => it.str && it.str.trim())) return true;
    }
    return false;
}
