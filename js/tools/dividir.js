import { h } from '../core/dom.js';
import { outName, baseName, pdfBlob } from '../core/files.js';
import { loadPdfLib, savePdf } from '../core/pdf.js';
import { parseRangeGroups, formatPageSet } from '../core/ranges.js';
import { UserError } from '../core/errors.js';
import { optionList } from '../core/dom.js';
import { loadSinglePdf, fileBar, zipBlob, numberInput, field } from './_common.js';
import { createPageGrid } from '../core/pagegrid.js';

export default {
    id: 'dividir-pdf',
    title: 'Dividir PDF',
    description: 'Separa un PDF por rangos, cada cierto número de páginas o página por página.',
    keywords: 'separar split cortar partir',
    category: 'organizar',
    icon: 'fa-scissors',
    input: 'pdf',
    actionLabel: 'Dividir PDF',
    actionIcon: 'fa-scissors',
    progressTitle: 'Dividiendo PDF…',

    async setup(ctx) {
        const { file, bytes, doc } = await loadSinglePdf(ctx);
        const n = doc.numPages;
        let mode = 'rangos';
        const rangesInput = h('input', { class: 'input', type: 'text', value: n > 1 ? `1-${Math.ceil(n / 2)},${Math.ceil(n / 2) + 1}-${n}` : '1', placeholder: 'Ej.: 1-3,5,8-10' });
        const everyInput = numberInput(Math.min(2, n), { min: 1, max: n });
        const mergeCheck = h('input', { type: 'checkbox' });
        const preview = h('p', { class: 'hint', 'aria-live': 'polite' });

        const rangeBox = h('div', {},
            field('Rangos de páginas', rangesInput, 'Cada rango separado por coma genera un PDF. Ej.: 1-3,5,8-10'),
            h('label', { class: 'check' }, mergeCheck, h('span', { text: 'Unir todos los rangos en un solo PDF' })),
        );
        const everyBox = field('Separar cada N páginas', everyInput);

        function groups() {
            if (mode === 'rangos') {
                const g = parseRangeGroups(rangesInput.value, n);
                return mergeCheck.checked ? [g.flat()] : g;
            }
            if (mode === 'cada') {
                const k = Number(everyInput.value);
                if (!Number.isInteger(k) || k < 1) throw new UserError('Indica un número de páginas válido (1 o más).');
                const g = [];
                for (let i = 0; i < n; i += k) g.push(Array.from({ length: Math.min(k, n - i) }, (_, j) => i + j));
                return g;
            }
            return Array.from({ length: n }, (_, i) => [i]);
        }

        function update() {
            rangeBox.classList.toggle('hidden', mode !== 'rangos');
            everyBox.classList.toggle('hidden', mode !== 'cada');
            try {
                const g = groups();
                preview.textContent = g.length === 1 ? 'Se generará 1 PDF.' : `Se generarán ${g.length} PDF dentro de un archivo ZIP.`;
                rangesInput.classList.remove('invalid');
                ctx.setActionEnabled(true);
            } catch (e) {
                preview.textContent = e.message;
                if (mode === 'rangos') rangesInput.classList.add('invalid');
                ctx.setActionEnabled(false);
            }
        }
        rangesInput.addEventListener('input', update);
        everyInput.addEventListener('input', update);
        mergeCheck.addEventListener('change', update);

        const grid = createPageGrid({ docs: [{ doc, name: file.name }] });
        ctx.main.append(fileBar(file, n), grid.el);

        const options = h('div', {},
            h('h2', { text: 'Modo de división' }),
            optionList('split-mode', [
                { value: 'rangos', label: 'Por rangos', desc: 'Tú eliges qué páginas van en cada PDF.' },
                { value: 'cada', label: 'Cada N páginas', desc: 'Bloques del mismo tamaño.' },
                { value: 'todas', label: 'Una página por archivo', desc: `${n} PDF de una página.` },
            ], mode, v => { mode = v; update(); }),
            h('div', { style: { marginTop: '14px' } }, rangeBox, everyBox),
            preview,
        );
        update();

        return {
            options,
            validate() {
                try {
                    groups();
                    return null;
                } catch (e) {
                    return e;
                }
            },
            async run(progress) {
                const g = groups();
                const src = await loadPdfLib(bytes, file.name);
                const outputs = [];
                for (let i = 0; i < g.length; i++) {
                    await progress(i / g.length * 0.9, `Creando PDF ${i + 1} de ${g.length}`);
                    const out = await PDFLib.PDFDocument.create();
                    const pages = await out.copyPages(src, g[i]);
                    pages.forEach(p => out.addPage(p));
                    outputs.push({ name: outName(file.name, `paginas_${formatPageSet(g[i])}`), data: await savePdf(out) });
                }
                if (outputs.length === 1) {
                    return { blob: pdfBlob(outputs[0].data), name: outputs[0].name, message: 'Se generó 1 PDF.' };
                }
                const blob = await zipBlob(outputs, f => progress(0.9 + f * 0.1, 'Generando ZIP…'));
                return { blob, name: `${baseName(file.name)}_dividido.zip`, message: `Se generaron ${outputs.length} PDF, comprimidos en un ZIP.` };
            },
            dispose: () => grid.destroy(),
        };
    },
};
