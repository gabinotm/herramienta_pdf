import { h, icon, toast } from '../core/dom.js';
import { outName, readBytes } from '../core/files.js';
import { openPdf, loadPdfLib, savePdf } from '../core/pdf.js';
import { UserError, toUserError } from '../core/errors.js';
import { createPageGrid } from '../core/pagegrid.js';
import { fileBar, pdfResult } from './_common.js';

/** Aplica las páginas (en orden, con rotación extra) de varios documentos a un PDF nuevo. */
export async function buildFromItems(items, sources, progress) {
    const { PDFDocument, degrees } = PDFLib;
    const out = await PDFDocument.create();
    const loaded = new Map();
    for (let i = 0; i < items.length; i++) {
        const it = items[i];
        if (!loaded.has(it.docIndex)) loaded.set(it.docIndex, await loadPdfLib(sources[it.docIndex].bytes, sources[it.docIndex].name));
        const [page] = await out.copyPages(loaded.get(it.docIndex), [it.pageIndex]);
        if (it.rotation) page.setRotation(degrees((page.getRotation().angle + it.rotation) % 360));
        out.addPage(page);
        await progress(i / items.length * 0.9, `Procesando página ${i + 1} de ${items.length}`);
    }
    await progress(0.95, 'Guardando PDF…');
    return savePdf(out);
}

export default {
    id: 'organizar-pdf',
    title: 'Organizar PDF',
    description: 'Reordena, rota y elimina páginas arrastrándolas en una cuadrícula.',
    keywords: 'ordenar reordenar mover paginas arrastrar',
    category: 'organizar',
    icon: 'fa-table-cells-large',
    input: 'pdf',
    multiple: true,
    actionLabel: 'Guardar cambios',
    actionIcon: 'fa-floppy-disk',
    progressTitle: 'Organizando páginas…',

    async setup(ctx) {
        const sources = [];
        const docs = [];
        const count = h('p', { class: 'muted small', 'aria-live': 'polite' });
        let grid = null;

        async function load(validated) {
            const entries = [];
            for (const { file } of validated) {
                const bytes = await readBytes(file);
                const doc = await openPdf(bytes, { name: file.name });
                sources.push({ bytes, name: file.name });
                entries.push({ doc, name: file.name });
            }
            return entries;
        }

        const first = await load(ctx.files);
        docs.push(...first);
        grid = createPageGrid({
            docs,
            sortable: true, rotatable: true, removable: true, showFileBadge: true,
            onChange: () => {
                const n = grid.getItems().length;
                count.textContent = `${n} página${n === 1 ? '' : 's'} en el documento final. Arrastra para reordenar.`;
                ctx.setActionEnabled(n > 0);
            },
        });

        const addBtn = h('button', {
            type: 'button', class: 'btn btn-sm btn-outline', onclick: async () => {
                try {
                    const more = await load(await ctx.pickFiles());
                    more.forEach(e => grid.addDoc(e));
                } catch (e) {
                    const err = toUserError(e);
                    toast(err.message, err.hint, 'error');
                }
            },
        }, icon('fa-plus'), 'Añadir PDF');

        ctx.main.append(
            fileBar(ctx.files[0].file, null,
                h('button', { type: 'button', class: 'btn btn-sm btn-outline', onclick: () => grid.rotateAll(-90) }, icon('fa-rotate-left'), 'Todas'),
                h('button', { type: 'button', class: 'btn btn-sm btn-outline', onclick: () => grid.rotateAll(90) }, icon('fa-rotate-right'), 'Todas'),
                addBtn,
            ),
            count,
            grid.el,
        );
        grid.selectAll(false); // dispara onChange para el contador

        return {
            options: h('div', {},
                h('h2', { text: 'Organizar páginas' }),
                h('ul', { class: 'muted small', style: { paddingLeft: '18px' } },
                    h('li', { text: 'Arrastra las miniaturas para cambiar el orden.' }),
                    h('li', { text: 'Usa los botones de cada página para rotarla o eliminarla.' }),
                    h('li', { text: 'Puedes añadir más PDF: sus páginas se agregan al final.' }),
                ),
            ),
            fileCount: () => sources.length,
            addFiles: async validated => (await load(validated)).forEach(e => grid.addDoc(e)),
            validate: () => (grid.getItems().length ? null : new UserError('El documento no tiene páginas. Añade al menos una.')),
            async run(progress) {
                const items = grid.getItems();
                const bytes = await buildFromItems(items, sources, progress);
                return pdfResult(bytes, outName(ctx.files[0].file.name, 'organizado'), `Documento con ${items.length} páginas.`);
            },
            dispose() {
                grid.destroy();
                docs.forEach(d => d.doc.destroy());
            },
        };
    },
};
