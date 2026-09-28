import { h, icon } from '../core/dom.js';
import { outName } from '../core/files.js';
import { UserError } from '../core/errors.js';
import { createPageGrid } from '../core/pagegrid.js';
import { loadSinglePdf, fileBar, pdfResult } from './_common.js';
import { buildFromItems } from './organizar.js';

export default {
    id: 'rotar-pdf',
    title: 'Rotar PDF',
    description: 'Gira todas las páginas o solo algunas 90°, 180° o 270°.',
    keywords: 'girar voltear orientacion',
    category: 'organizar',
    icon: 'fa-rotate-right',
    input: 'pdf',
    actionLabel: 'Aplicar rotación',
    actionIcon: 'fa-rotate-right',
    progressTitle: 'Rotando páginas…',

    async setup(ctx) {
        const { file, bytes, doc } = await loadSinglePdf(ctx);
        const status = h('p', { class: 'muted small', 'aria-live': 'polite' });
        const grid = createPageGrid({
            docs: [{ doc, name: file.name }],
            selectable: 'select',
            rotatable: true,
            onChange: () => {
                const items = grid.getItems();
                const rotated = items.filter(i => i.rotation).length;
                const sel = items.filter(i => i.selected).length;
                status.textContent = `${rotated} página${rotated === 1 ? '' : 's'} con rotación${sel ? ` · ${sel} seleccionada${sel === 1 ? '' : 's'}` : ''}.`;
                ctx.setActionEnabled(rotated > 0);
            },
        });
        const rotateTarget = delta => {
            const anySelected = grid.getItems().some(i => i.selected);
            grid.rotateAll(delta, anySelected);
        };
        const btn = (label, iconName, delta) => h('button', { type: 'button', class: 'btn btn-outline', style: { width: '100%', marginBottom: '8px' }, onclick: () => rotateTarget(delta) }, icon(iconName), label);

        ctx.main.append(fileBar(file, doc.numPages), status, grid.el);
        grid.selectAll(false);

        return {
            options: h('div', {},
                h('h2', { text: 'Rotar' }),
                h('p', { class: 'muted small', text: 'Si seleccionas páginas (clic en la miniatura), los botones solo rotan esas. Si no, rotan todas.' }),
                btn('Girar 90° a la derecha', 'fa-rotate-right', 90),
                btn('Girar 90° a la izquierda', 'fa-rotate-left', -90),
                btn('Girar 180°', 'fa-arrows-rotate', 180),
                h('button', { type: 'button', class: 'btn btn-sm', style: { width: '100%' }, onclick: () => grid.resetRotation() }, icon('fa-arrow-rotate-left'), 'Deshacer rotaciones'),
            ),
            validate: () => (grid.getItems().some(i => i.rotation) ? null : new UserError('Todavía no rotaste ninguna página.')),
            async run(progress) {
                const items = grid.getItems();
                const out = await buildFromItems(items, [{ bytes, name: file.name }], progress);
                return pdfResult(out, outName(file.name, 'rotado'), `Se rotaron ${items.filter(i => i.rotation).length} página(s).`);
            },
            dispose: () => grid.destroy(),
        };
    },
};
