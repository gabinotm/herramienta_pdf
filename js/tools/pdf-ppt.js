import { h, alertBox, segmented, loadScript, canvasToBlob } from '../core/dom.js';
import { outName } from '../core/files.js';
import { renderPage, pageTextLines } from '../core/pdf.js';
import { loadSinglePdf, fileBar } from './_common.js';

function blobToDataURL(blob) {
    return new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(r.result);
        r.onerror = reject;
        r.readAsDataURL(blob);
    });
}

export default {
    id: 'pdf-a-powerpoint',
    title: 'PDF a PowerPoint',
    description: 'Convierte cada página del PDF en una diapositiva de PowerPoint (.pptx).',
    keywords: 'pptx presentacion diapositivas convertir powerpoint',
    category: 'desde',
    icon: 'fa-file-powerpoint',
    input: 'pdf',
    actionLabel: 'Convertir a PowerPoint',
    actionIcon: 'fa-file-powerpoint',
    progressTitle: 'Convirtiendo a PowerPoint…',

    async setup(ctx) {
        const { file, doc } = await loadSinglePdf(ctx);
        let dpi = 150;
        ctx.main.append(
            fileBar(file, doc.numPages),
            alertBox('info', 'Cada página se coloca como imagen de alta calidad en su propia diapositiva, con el texto de la página en las notas del orador. El aspecto es idéntico, pero el contenido de la diapositiva no es editable como texto.'),
        );
        return {
            options: h('div', {},
                h('h2', { text: 'Calidad de imagen' }),
                segmented('ppt-dpi', [{ value: 110, label: 'Liviana' }, { value: 150, label: 'Normal' }, { value: 220, label: 'Alta' }], dpi, v => { dpi = v; }),
                h('div', { style: { height: '14px' } }),
            ),
            async run(progress) {
                await loadScript(new URL('../../vendor/pptxgen.min.js', import.meta.url).href);
                const pptx = new window.PptxGenJS();
                const first = (await doc.getPage(1)).getViewport({ scale: 1 });
                const W = first.width / 72;
                const H = first.height / 72;
                pptx.defineLayout({ name: 'PDF', width: W, height: H });
                pptx.layout = 'PDF';
                pptx.title = file.name;
                const n = doc.numPages;
                for (let i = 1; i <= n; i++) {
                    await progress((i - 1) / n * 0.9, `Diapositiva ${i} de ${n}`);
                    const page = await doc.getPage(i);
                    const vp = page.getViewport({ scale: 1 });
                    const { canvas } = await renderPage(page, { scale: dpi / 72 });
                    const data = await blobToDataURL(await canvasToBlob(canvas, 'image/jpeg', 0.88));
                    canvas.width = canvas.height = 0;
                    const s = Math.min(W / (vp.width / 72), H / (vp.height / 72));
                    const w = (vp.width / 72) * s;
                    const hh = (vp.height / 72) * s;
                    const slide = pptx.addSlide();
                    slide.background = { color: 'FFFFFF' };
                    slide.addImage({ data, x: (W - w) / 2, y: (H - hh) / 2, w, h: hh });
                    const notes = (await pageTextLines(page)).map(l => l.text).join('\n');
                    if (notes) slide.addNotes(notes);
                }
                await progress(0.95, 'Generando el archivo .pptx…');
                const blob = await pptx.write({ outputType: 'blob' });
                return {
                    blob: new Blob([blob], { type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' }),
                    name: outName(file.name, '', 'pptx'),
                    message: `Se crearon ${n} diapositiva(s).`,
                };
            },
        };
    },
};
