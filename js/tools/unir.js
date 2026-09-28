import { h, icon, formatBytes } from '../core/dom.js';
import { readBytes, outName } from '../core/files.js';
import { openPdf, renderPage, loadPdfLib, savePdf } from '../core/pdf.js';
import { UserError, toUserError } from '../core/errors.js';
import { pdfResult } from './_common.js';

export default {
    id: 'unir-pdf',
    title: 'Unir PDF',
    description: 'Combina varios PDF en uno solo y ordénalos como quieras.',
    keywords: 'juntar combinar merge fusionar',
    category: 'organizar',
    icon: 'fa-object-group',
    input: 'pdf',
    multiple: true,
    actionLabel: 'Unir PDF',
    actionIcon: 'fa-object-group',
    progressTitle: 'Uniendo PDF…',

    async setup(ctx) {
        const entries = new Map(); // key -> { file, bytes, doc, pages }
        let seq = 0;
        const list = h('div', { class: 'file-list', 'aria-label': 'Archivos a unir (arrastra para ordenar)' });
        const addCard = h('button', { type: 'button', class: 'add-card' }, icon('fa-plus', 'fa-2x'), 'Añadir PDF');
        const summary = h('p', { class: 'muted small' });
        const disposed = [];

        async function add(validated) {
            for (const { file } of validated) {
                const bytes = await readBytes(file);
                const doc = await openPdf(bytes, { name: file.name });
                disposed.push(doc);
                const key = `f${++seq}`;
                const thumb = h('div', { class: 'thumb-wrap' }, h('span', { class: 'spinner' }));
                const card = h('div', { class: 'file-card', dataset: { key }, role: 'listitem' },
                    h('span', { class: 'order' }),
                    h('button', { type: 'button', class: 'remove', 'aria-label': `Quitar ${file.name}`, title: 'Quitar', onclick: () => { card.remove(); entries.delete(key); refresh(); } }, icon('fa-xmark')),
                    thumb,
                    h('div', { class: 'file-title', title: file.name, text: file.name }),
                    h('div', { class: 'file-meta', text: `${doc.numPages} pág. · ${formatBytes(file.size)}` }),
                );
                entries.set(key, { file, bytes, doc, pages: doc.numPages });
                list.insertBefore(card, addCard);
                doc.getPage(1).then(p => renderPage(p, { scale: 170 / p.getViewport({ scale: 1 }).width }))
                    .then(({ canvas }) => thumb.replaceChildren(canvas))
                    .catch(() => thumb.replaceChildren(icon('fa-file-pdf', 'fa-2x')));
            }
            refresh();
        }

        function ordered() {
            return Array.from(list.querySelectorAll('.file-card')).map(c => entries.get(c.dataset.key));
        }

        function refresh() {
            const items = ordered();
            list.querySelectorAll('.file-card .order').forEach((el, i) => { el.textContent = String(i + 1); });
            const pages = items.reduce((s, e) => s + e.pages, 0);
            summary.textContent = `${items.length} archivo${items.length === 1 ? '' : 's'} · ${pages} páginas en total. Arrastra las tarjetas para cambiar el orden.`;
            ctx.setActionEnabled(items.length >= 2);
        }

        addCard.addEventListener('click', async () => {
            try {
                await add(await ctx.pickFiles());
            } catch (e) {
                const err = toUserError(e);
                import('../core/dom.js').then(m => m.toast(err.message, err.hint, 'error'));
            }
        });
        list.append(addCard);
        ctx.bindDrop(list, files => ctx.addMore(files));
        await add(ctx.files);

        const sortable = Sortable.create(list, {
            animation: 180, draggable: '.file-card', filter: '.remove', preventOnFilter: false,
            delay: 150, delayOnTouchOnly: true, onEnd: refresh,
        });

        ctx.main.append(summary, list);
        return {
            options: h('div', {},
                h('h2', { text: 'Unir PDF' }),
                h('p', { class: 'muted small', text: 'El documento final tendrá las páginas en el orden de las tarjetas. Necesitas al menos 2 archivos.' }),
            ),
            fileCount: () => entries.size,
            addFiles: add,
            validate: () => (entries.size < 2 ? new UserError('Añade al menos 2 archivos PDF para unirlos.') : null),
            async run(progress) {
                const { PDFDocument } = PDFLib;
                const items = ordered();
                const out = await PDFDocument.create();
                const total = items.reduce((s, e) => s + e.pages, 0);
                let done = 0;
                for (const item of items) {
                    const src = await loadPdfLib(item.bytes, item.file.name);
                    const pages = await out.copyPages(src, src.getPageIndices());
                    for (const p of pages) {
                        out.addPage(p);
                        done++;
                        await progress(done / total * 0.9, `Uniendo página ${done} de ${total}`);
                    }
                }
                await progress(0.95, 'Guardando PDF…');
                const bytes = await savePdf(out);
                return pdfResult(bytes, outName(items[0].file.name, 'unido'), `Se unieron ${items.length} archivos (${total} páginas).`);
            },
            dispose() {
                sortable.destroy();
                disposed.forEach(d => d.destroy());
            },
        };
    },
};
