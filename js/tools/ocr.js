import { h, alertBox, loadScript, segmented, checkbox } from '../core/dom.js';
import { CONFIG } from '../config.js';
import { outName, pdfBlob } from '../core/files.js';
import { loadPdfLib, savePdf, renderPage, displayMapper } from '../core/pdf.js';
import { Errors, UserError } from '../core/errors.js';
import { loadSinglePdf, fileBar } from './_common.js';

/** Caracteres que la fuente estándar Helvetica (WinAnsi) puede codificar. */
const WINANSI_EXTRA = '€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ';
export function toWinAnsi(text) {
    let out = '';
    for (const ch of text.normalize('NFC')) {
        const c = ch.codePointAt(0);
        out += (c >= 0x20 && c <= 0x7e) || (c >= 0xa0 && c <= 0xff) || WINANSI_EXTRA.includes(ch) ? ch : '?';
    }
    return out;
}

async function getTesseract() {
    try {
        await loadScript(CONFIG.tesseract.script);
    } catch {
        throw Errors.network('el motor de OCR');
    }
    return window.Tesseract;
}

export default {
    id: 'ocr-pdf',
    title: 'OCR: PDF escaneado a texto',
    description: 'Reconoce el texto de un PDF escaneado para que se pueda seleccionar y buscar.',
    keywords: 'reconocer texto escaneo buscable seleccionable ocr',
    category: 'optimizar',
    icon: 'fa-magnifying-glass-plus',
    input: 'pdf',
    actionLabel: 'Aplicar OCR',
    actionIcon: 'fa-magnifying-glass-plus',
    progressTitle: 'Reconociendo texto…',

    async setup(ctx) {
        const { file, bytes, doc } = await loadSinglePdf(ctx);
        await loadPdfLib(bytes, file.name); // valida que se pueda escribir (no cifrado)
        let lang = 'spa+eng';
        let dpi = 300;
        let skipText = true;

        ctx.main.append(
            fileBar(file, doc.numPages),
            alertBox('info', 'El OCR se ejecuta en tu navegador. La primera vez se descargan el motor y los diccionarios de idioma (unos 15 MB); después quedan en la caché. Cada página puede tardar varios segundos.'),
            alertBox('warning', 'El resultado conserva el aspecto original y añade una capa de texto invisible que permite seleccionar, copiar y buscar.'),
        );

        return {
            options: h('div', {},
                h('h2', { text: 'Opciones de OCR' }),
                h('div', { class: 'field' }, h('span', { class: 'label', text: 'Idioma del documento' }),
                    segmented('ocr-lang', [{ value: 'spa', label: 'Español' }, { value: 'eng', label: 'Inglés' }, { value: 'spa+eng', label: 'Ambos' }], lang, v => { lang = v; })),
                h('div', { class: 'field' }, h('span', { class: 'label', text: 'Calidad de análisis' }),
                    segmented('ocr-dpi', [{ value: 200, label: 'Rápida' }, { value: 300, label: 'Precisa' }], dpi, v => { dpi = v; })),
                checkbox('Omitir páginas que ya tienen texto', skipText, v => { skipText = v; }),
            ),
            async run(progress) {
                await progress(null, 'Cargando el motor de OCR…');
                const Tesseract = await getTesseract();
                let pageBase = 0;
                let pageSpan = 1;
                const worker = await Tesseract.createWorker(lang, 1, {
                    workerPath: CONFIG.tesseract.workerPath,
                    corePath: CONFIG.tesseract.corePath,
                    langPath: CONFIG.tesseract.langPath,
                    logger: m => {
                        if (m.status === 'recognizing text') progress(pageBase + m.progress * pageSpan);
                        else if (/loading|initializ/i.test(m.status)) progress(null, 'Descargando diccionarios de idioma…');
                    },
                }).catch(() => {
                    throw Errors.network('los diccionarios de idioma del OCR');
                });

                try {
                    const out = await loadPdfLib(bytes, file.name);
                    const font = await out.embedFont(PDFLib.StandardFonts.Helvetica);
                    const { pushGraphicsState, popGraphicsState, beginText, endText, setFontAndSize, setTextRenderingMode, TextRenderingMode, rotateAndSkewTextDegreesAndTranslate, showText, PDFOperator, PDFNumber } = PDFLib;
                    let recognized = 0;
                    let words = 0;
                    const n = doc.numPages;
                    for (let i = 1; i <= n; i++) {
                        pageBase = (i - 1) / n;
                        pageSpan = 1 / n;
                        await progress(pageBase, `Página ${i} de ${n}`);
                        const page = await doc.getPage(i);
                        if (skipText) {
                            const tc = await page.getTextContent();
                            if (tc.items.some(it => it.str && it.str.trim())) continue;
                        }
                        const { canvas, viewport } = await renderPage(page, { scale: dpi / 72, annotations: false });
                        const { data } = await worker.recognize(canvas);
                        canvas.width = canvas.height = 0; // libera memoria
                        const map = displayMapper(viewport);
                        const target = out.getPage(i - 1);
                        const fontKey = target.node.newFontDictionary(font.name, font.ref);
                        const ops = [];
                        for (const w of data.words || []) {
                            const text = toWinAnsi(w.text.trim());
                            if (!text || w.confidence < 30) continue;
                            const { x0, y0, x1, y1 } = w.bbox;
                            const baseY = w.baseline && w.baseline.y0 > y0 ? Math.max(w.baseline.y0, w.baseline.y1) : y1 - (y1 - y0) * 0.2;
                            const [px, py] = map.toPdf(x0, baseY);
                            const size = Math.max(1, (y1 - y0) * map.unit * 0.85);
                            const natural = font.widthOfTextAtSize(text, size);
                            const wanted = (x1 - x0) * map.unit;
                            const hscale = natural > 0 ? Math.min(400, Math.max(10, (wanted / natural) * 100)) : 100;
                            ops.push(
                                beginText(),
                                setFontAndSize(fontKey, size),
                                setTextRenderingMode(TextRenderingMode.Invisible),
                                PDFOperator.of('Tz', [PDFNumber.of(hscale)]),
                                rotateAndSkewTextDegreesAndTranslate(map.angle, 0, 0, px, py),
                                showText(font.encodeText(text)),
                                endText(),
                            );
                            words++;
                        }
                        if (ops.length) {
                            target.pushOperators(pushGraphicsState(), ...ops, popGraphicsState());
                            recognized++;
                        }
                    }
                    if (!recognized) {
                        if (skipText) throw new UserError('Todas las páginas ya tienen texto seleccionable: no hace falta aplicar OCR.', { hint: 'Si aun así quieres hacerlo, desmarca "Omitir páginas que ya tienen texto".' });
                        throw new UserError('No se reconoció texto en el documento.', { hint: 'Comprueba que el idioma sea correcto y que el escaneo sea legible.' });
                    }
                    await progress(1, 'Guardando PDF…');
                    const result = await savePdf(out);
                    return {
                        blob: pdfBlob(result), name: outName(file.name, 'ocr'),
                        message: `Se reconoció texto en ${recognized} página(s) (${words} palabras). Ahora puedes seleccionar y buscar el texto.`,
                    };
                } finally {
                    await worker.terminate();
                }
            },
        };
    },
};

