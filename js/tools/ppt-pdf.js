import { alertBox } from '../core/dom.js';
import { fileBar } from './_common.js';
import { outName, pdfBlob } from '../core/files.js';
import { savePdf } from '../core/pdf.js';
import { UserError } from '../core/errors.js';
import { offscreenHost, elementToPages } from '../core/htmlpdf.js';
import { PptxDocument } from '../core/pptx-render.js';

export default {
    id: 'powerpoint-a-pdf',
    title: 'PowerPoint a PDF',
    description: 'Convierte presentaciones de PowerPoint (.pptx) en PDF, una diapositiva por página.',
    keywords: 'pptx ppt presentacion diapositivas powerpoint convertir',
    category: 'hacia',
    icon: 'fa-file-powerpoint',
    input: 'pptx',
    actionLabel: 'Convertir a PDF',
    actionIcon: 'fa-file-pdf',
    progressTitle: 'Convirtiendo presentación…',
    layout: 'single',

    async setup(ctx) {
        const { file } = ctx.files[0];
        let pres;
        try {
            pres = await PptxDocument.load(await file.arrayBuffer());
        } catch {
            throw new UserError(`No se pudo leer "${file.name}": la presentación parece estar dañada.`);
        }
        if (!pres.slides.length) throw new UserError('La presentación no tiene diapositivas.');
        ctx.onDispose(() => pres.dispose());
        ctx.main.append(
            fileBar(file, `${pres.slides.length} diapositiva(s)`),
            alertBox('info', 'Se convierten fondos, textos (con viñetas y estilos del tema), formas, imágenes, tablas y grupos. No se reproducen animaciones, vídeos, gráficos, SmartArt, WordArt ni efectos como sombras. Las fuentes que no estén en tu equipo se sustituyen por otras parecidas.'),
        );
        return {
            async run(progress) {
                const host = offscreenHost();
                try {
                    const { PDFDocument, StandardFonts } = PDFLib;
                    const pdf = await PDFDocument.create();
                    const font = await pdf.embedFont(StandardFonts.Helvetica);
                    const n = pres.slides.length;
                    for (let i = 0; i < n; i++) {
                        await progress(i / n * 0.95, `Diapositiva ${i + 1} de ${n}`);
                        const el = await pres.renderSlide(i);
                        host.replaceChildren(el);
                        await document.fonts.ready;
                        await Promise.all(Array.from(el.querySelectorAll('img')).map(img => (img.complete ? null : new Promise(r => { img.onload = img.onerror = r; }))));
                        await elementToPages(pdf, el, { pageWidthPt: pres.width, pageHeightPt: pres.height, font, split: false });
                    }
                    return { blob: pdfBlob(await savePdf(pdf)), name: outName(file.name, '', 'pdf'), message: `PDF de ${n} página(s) creado.` };
                } finally {
                    host.remove();
                }
            },
        };
    },
};
