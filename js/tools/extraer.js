import { h, icon, checkbox } from '../core/dom.js';
import { outName, baseName, pdfBlob } from '../core/files.js';
import { loadPdfLib, savePdf } from '../core/pdf.js';
import { formatPageSet } from '../core/ranges.js';
import { UserError } from '../core/errors.js';
import { createPageGrid } from '../core/pagegrid.js';
import { loadSinglePdf, fileBar, rangeInput, zipBlob } from './_common.js';

/** Herramienta genérica de selección de páginas (extraer / eliminar). */
export function pageSelectTool({ mode }) {
    const del = mode === 'delete';
    return async function setup(ctx) {
        const { file, bytes, doc } = await loadSinglePdf(ctx);
        const n = doc.numPages;
        let syncing = false;
        let separate = false;
        const count = h('p', { class: 'muted small', 'aria-live': 'polite' });
        const grid = createPageGrid({
            docs: [{ doc, name: file.name }],
            selectable: del ? 'delete' : 'select',
            onChange: () => {
                const sel = selected();
                if (!syncing) range.set(sel.length ? formatPageSet(sel) : '');
                count.textContent = del
                    ? `${sel.length} página${sel.length === 1 ? '' : 's'} marcada${sel.length === 1 ? '' : 's'} para eliminar · quedarán ${n - sel.length}`
                    : `${sel.length} página${sel.length === 1 ? '' : 's'} seleccionada${sel.length === 1 ? '' : 's'}`;
                ctx.setActionEnabled(sel.length > 0 && (!del || sel.length < n));
            },
        });
        const selected = () => grid.getItems().filter(i => i.selected).map(i => i.pageIndex);
        const range = rangeInput({
            label: del ? 'Páginas a eliminar' : 'Páginas a extraer',
            pageCount: n,
            hint: 'También puedes hacer clic en las miniaturas.',
            onValid: set => {
                if (!set) return;
                syncing = true;
                grid.selectIndices(set);
                syncing = false;
            },
        });

        ctx.main.append(
            fileBar(file, n,
                h('button', { type: 'button', class: 'btn btn-sm btn-outline', onclick: () => grid.selectAll(true) }, icon('fa-check-double'), 'Todas'),
                h('button', { type: 'button', class: 'btn btn-sm btn-outline', onclick: () => grid.selectAll(false) }, icon('fa-eraser'), 'Ninguna'),
                h('button', { type: 'button', class: 'btn btn-sm btn-outline', onclick: () => grid.invert() }, icon('fa-arrows-rotate'), 'Invertir'),
            ),
            h('p', { class: 'muted small', text: 'Consejo: mantén Mayús (Shift) al hacer clic para seleccionar un rango.' }),
            grid.el,
        );
        grid.selectAll(false);

        return {
            options: h('div', {},
                h('h2', { text: del ? 'Eliminar páginas' : 'Extraer páginas' }),
                range.node,
                count,
                del ? null : checkbox('Guardar cada página en un PDF separado (ZIP)', false, v => { separate = v; }),
            ),
            validate() {
                const sel = selected();
                if (!sel.length) return new UserError(del ? 'Marca al menos una página para eliminar.' : 'Selecciona al menos una página.');
                if (del && sel.length >= n) return new UserError('No puedes eliminar todas las páginas del documento.');
                return null;
            },
            async run(progress) {
                const sel = selected();
                const src = await loadPdfLib(bytes, file.name);
                await progress(0.3, 'Copiando páginas…');
                if (del) {
                    // Se eliminan de mayor a menor para no desplazar índices.
                    [...sel].sort((a, b) => b - a).forEach(i => src.removePage(i));
                    await progress(0.8, 'Guardando PDF…');
                    const out = await savePdf(src);
                    return { blob: pdfBlob(out), name: outName(file.name, 'sin_paginas'), message: `Se eliminaron ${sel.length} página(s). El documento ahora tiene ${n - sel.length}.` };
                }
                if (separate && sel.length > 1) {
                    const outputs = [];
                    for (let i = 0; i < sel.length; i++) {
                        const out = await PDFLib.PDFDocument.create();
                        const [p] = await out.copyPages(src, [sel[i]]);
                        out.addPage(p);
                        outputs.push({ name: outName(file.name, `pagina_${sel[i] + 1}`), data: await savePdf(out) });
                        await progress(0.3 + (i + 1) / sel.length * 0.6, `Página ${i + 1} de ${sel.length}`);
                    }
                    const blob = await zipBlob(outputs);
                    return { blob, name: `${baseName(file.name)}_paginas.zip`, message: `Se extrajeron ${sel.length} páginas en archivos separados.` };
                }
                const out = await PDFLib.PDFDocument.create();
                const pages = await out.copyPages(src, sel);
                pages.forEach(p => out.addPage(p));
                await progress(0.8, 'Guardando PDF…');
                return { blob: pdfBlob(await savePdf(out)), name: outName(file.name, `paginas_${formatPageSet(sel)}`), message: `Se extrajeron ${sel.length} página(s).` };
            },
            dispose: () => grid.destroy(),
        };
    };
}

export default {
    id: 'extraer-paginas',
    title: 'Extraer páginas',
    description: 'Crea un PDF nuevo solo con las páginas que elijas.',
    keywords: 'sacar seleccionar copiar paginas',
    category: 'organizar',
    icon: 'fa-file-export',
    input: 'pdf',
    actionLabel: 'Extraer páginas',
    actionIcon: 'fa-file-export',
    progressTitle: 'Extrayendo páginas…',
    setup: pageSelectTool({ mode: 'extract' }),
};
