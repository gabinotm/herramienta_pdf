import { h, alertBox, loadScript, segmented, checkbox } from '../core/dom.js';
import { CONFIG } from '../config.js';
import { outName, pdfBlob } from '../core/files.js';
import { loadPdfLib, savePdf, renderPage, displayMapper } from '../core/pdf.js';
import { Errors, UserError } from '../core/errors.js';
import { loadSinglePdf, fileBar } from './_common.js';
import { addInvisibleText } from '../core/text.js';

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
                        const list = (data.words || []).filter(w => w.confidence >= 30).map(w => ({
                            text: w.text, ...w.bbox,
                            baseline: w.baseline && w.baseline.y0 > w.bbox.y0 ? Math.max(w.baseline.y0, w.baseline.y1) : undefined,
                        }));
                        const added = addInvisibleText(out.getPage(i - 1), font, list, displayMapper(viewport));
                        if (added) {
                            recognized++;
                            words += added;
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

