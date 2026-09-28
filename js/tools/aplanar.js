import { h, alertBox, optionList } from '../core/dom.js';
import { readBytes, outName, pdfBlob } from '../core/files.js';
import { runQpdf } from '../core/qpdf.js';
import { openPdf, loadPdfLib } from '../core/pdf.js';
import { UserError } from '../core/errors.js';
import { fileBar } from './_common.js';

export default {
    id: 'aplanar-pdf',
    title: 'Aplanar PDF',
    description: 'Convierte formularios y anotaciones en contenido fijo que ya no se puede editar.',
    keywords: 'flatten fijar formularios anotaciones comentarios',
    category: 'editar',
    icon: 'fa-layer-group',
    input: 'pdf',
    actionLabel: 'Aplanar PDF',
    actionIcon: 'fa-layer-group',
    progressTitle: 'Aplanando PDF…',

    async setup(ctx) {
        const { file } = ctx.files[0];
        const bytes = await readBytes(file);
        const doc = await openPdf(bytes, { name: file.name });
        let annots = 0;
        for (let i = 1; i <= doc.numPages; i++) annots += (await (await doc.getPage(i)).getAnnotations()).filter(a => a.subtype !== 'Link').length;
        const pages = doc.numPages;
        await doc.destroy();
        const pdf = await loadPdfLib(bytes, file.name);
        const fields = pdf.getForm().getFields().length;
        let scope = 'all';

        ctx.main.append(
            fileBar(file, pages),
            annots || fields
                ? alertBox('info', `Se encontraron ${fields} campo(s) de formulario y ${annots} anotación(es) (comentarios, resaltados, firmas, etc.).`)
                : alertBox('warning', 'Este PDF no tiene formularios ni anotaciones: el resultado será igual al original.'),
        );
        return {
            options: h('div', {},
                h('h2', { text: 'Qué aplanar' }),
                optionList('flat', [
                    { value: 'all', label: 'Todo', desc: 'Formularios y todas las anotaciones.' },
                    { value: 'print', label: 'Solo lo imprimible', desc: 'Omite anotaciones marcadas como "no imprimir".' },
                ], scope, v => { scope = v; }),
                h('div', { style: { height: '14px' } }),
            ),
            validate: () => (annots || fields ? null : new UserError('Este PDF no tiene formularios ni anotaciones que aplanar.')),
            async run(progress) {
                await progress(0.4, 'Generando apariencias y fijando contenido…');
                const r = await runQpdf(['--generate-appearances', `--flatten-annotations=${scope}`, '/in.pdf', '/out.pdf'], { '/in.pdf': bytes });
                if (!r.output || r.code === 2) throw new UserError('No se pudo aplanar el PDF.', { hint: 'Prueba primero con "Reparar PDF".' });
                return { blob: pdfBlob(r.output), name: outName(file.name, 'aplanado'), message: 'Los formularios y anotaciones ahora forman parte fija de las páginas.' };
            },
        };
    },
};
