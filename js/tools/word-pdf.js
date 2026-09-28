import { h, alertBox, loadScript } from '../core/dom.js';
import { outName, pdfBlob } from '../core/files.js';
import { savePdf } from '../core/pdf.js';
import { UserError } from '../core/errors.js';
import { offscreenHost, elementToPages } from '../core/htmlpdf.js';

const PT = 72 / 96; // puntos por píxel CSS

function parsePt(value) {
    if (!value) return null;
    const n = parseFloat(value);
    if (!Number.isFinite(n)) return null;
    if (value.endsWith('pt')) return n;
    if (value.endsWith('px')) return n * PT;
    if (value.endsWith('cm')) return (n / 2.54) * 72;
    if (value.endsWith('mm')) return (n / 25.4) * 72;
    if (value.endsWith('in')) return n * 72;
    return null;
}

export default {
    id: 'word-a-pdf',
    title: 'Word a PDF',
    description: 'Convierte documentos de Word (.docx) en PDF.',
    keywords: 'docx doc word documento convertir',
    category: 'hacia',
    icon: 'fa-file-word',
    input: 'docx',
    actionLabel: 'Convertir a PDF',
    actionIcon: 'fa-file-pdf',
    progressTitle: 'Convirtiendo Word a PDF…',
    layout: 'single',

    async setup(ctx) {
        const { file } = ctx.files[0];
        ctx.main.append(
            h('div', { class: 'file-bar' }, h('div', { class: 'file-info' }, h('i', { class: 'fa-solid fa-file-word', style: { color: '#2b579a' }, 'aria-hidden': 'true' }), h('div', { class: 'file-name', text: file.name }))),
            alertBox('info', 'La conversión se hace en tu navegador: se respetan textos, estilos, tablas e imágenes. Las fuentes que no estén instaladas en tu equipo se reemplazan por otras parecidas, y los encabezados y pies solo se incluyen una vez por sección.'),
        );
        return {
            async run(progress) {
                await progress(null, 'Leyendo el documento…');
                await loadScript(new URL('../../vendor/docx-preview.min.js', import.meta.url).href);
                const host = offscreenHost();
                try {
                    const style = document.createElement('div');
                    host.append(style);
                    const container = document.createElement('div');
                    host.append(container);
                    try {
                        await window.docx.renderAsync(file, container, style, {
                            inWrapper: true, ignoreWidth: false, ignoreHeight: false, breakPages: true,
                            renderHeaders: true, renderFooters: true, renderFootnotes: true, renderEndnotes: true,
                            experimental: true, useBase64URL: true,
                        });
                    } catch {
                        throw new UserError(`No se pudo leer "${file.name}": el documento parece estar dañado o no es un .docx válido.`);
                    }
                    await document.fonts.ready;
                    // Espera a que carguen las imágenes incrustadas
                    await Promise.all(Array.from(container.querySelectorAll('img')).map(img => (img.complete ? null : new Promise(r => { img.onload = img.onerror = r; }))));
                    const sections = Array.from(container.querySelectorAll('section.docx'));
                    if (!sections.length) throw new UserError('El documento está vacío.');
                    const { PDFDocument, StandardFonts } = PDFLib;
                    const pdf = await PDFDocument.create();
                    const font = await pdf.embedFont(StandardFonts.Helvetica);
                    for (let i = 0; i < sections.length; i++) {
                        await progress(i / sections.length * 0.9, `Procesando sección ${i + 1} de ${sections.length}`);
                        const s = sections[i];
                        const wPt = parsePt(s.style.width) || s.getBoundingClientRect().width * PT;
                        const hPt = parsePt(s.style.minHeight) || parsePt(s.style.height) || wPt * 1.414;
                        // docx-preview fija min-height; se libera para medir la altura real del contenido.
                        await elementToPages(pdf, s, { pageWidthPt: wPt, pageHeightPt: hPt, font });
                    }
                    await progress(0.95, 'Guardando PDF…');
                    const bytes = await savePdf(pdf);
                    return { blob: pdfBlob(bytes), name: outName(file.name, '', 'pdf'), message: `PDF de ${pdf.getPageCount()} página(s) creado.` };
                } finally {
                    host.remove();
                }
            },
        };
    },
};
