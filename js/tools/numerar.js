import { h, field } from '../core/dom.js';
import { outName, pdfBlob } from '../core/files.js';
import { loadPdfLib, savePdf } from '../core/pdf.js';
import { UserError } from '../core/errors.js';
import { pageGeometry, drawCenteredText, hexToRgb } from '../core/stamp.js';
import { loadSinglePdf, fileBar, numberInput } from './_common.js';
import { livePreview } from './_preview.js';

const FORMATS = {
    n: { label: '1', fmt: (n) => `${n}` },
    pagina: { label: 'Página 1', fmt: (n) => `Página ${n}` },
    de: { label: 'Página 1 de N', fmt: (n, t) => `Página ${n} de ${t}` },
    barra: { label: '1 / N', fmt: (n, t) => `${n} / ${t}` },
    guiones: { label: '- 1 -', fmt: (n) => `- ${n} -` },
};

function applyNumbers(doc, font, o, pageIndices, numberFor, total) {
    for (const i of pageIndices) {
        const page = doc.getPage(i);
        const { W, H } = pageGeometry(page);
        const text = FORMATS[o.format].fmt(numberFor(i), total);
        const w = font.widthOfTextAtSize(text, o.size);
        const [row, col] = o.position.split('-');
        const cx = col === 'izq' ? o.margin + w / 2 : col === 'der' ? W - o.margin - w / 2 : W / 2;
        const cy = row === 'arriba' ? H - o.margin : o.margin;
        drawCenteredText(page, text, { font, size: o.size, color: hexToRgb(o.color), cx, cy });
    }
}

export default {
    id: 'numerar-paginas',
    title: 'Numerar páginas',
    description: 'Añade números de página con la posición, formato y estilo que prefieras.',
    keywords: 'paginacion numeros pie de pagina foliar',
    category: 'editar',
    icon: 'fa-list-ol',
    input: 'pdf',
    actionLabel: 'Numerar páginas',
    actionIcon: 'fa-list-ol',
    progressTitle: 'Numerando páginas…',

    async setup(ctx) {
        const { file, bytes, doc } = await loadSinglePdf(ctx);
        await loadPdfLib(bytes, file.name);
        const n = doc.numPages;
        const o = { position: 'abajo-centro', format: 'de', start: 1, from: 1, to: n, size: 11, margin: 28, color: '#111827' };

        const indices = () => Array.from({ length: o.to - o.from + 1 }, (_, k) => o.from - 1 + k);
        const totalShown = () => o.start + (o.to - o.from);

        const preview = livePreview(bytes, async (single, pageIndex) => {
            const font = await single.embedFont(PDFLib.StandardFonts.Helvetica);
            applyNumbers(single, font, o, [0], () => o.start + (pageIndex - (o.from - 1)), totalShown());
        });
        const refresh = () => preview.refresh(Math.min(Math.max(o.from - 1, 0), n - 1));

        const bind = (el, key) => {
            el.addEventListener('input', () => { o[key] = el.type === 'color' ? el.value : Number(el.value); refresh(); });
            return el;
        };
        const fromInput = bind(numberInput(1, { min: 1, max: n }), 'from');
        const toInput = bind(numberInput(n, { min: 1, max: n }), 'to');

        ctx.main.append(fileBar(file, n), preview.node);
        preview.draw(0);

        const posOptions = [
            ['arriba-izq', 'Arriba izquierda'], ['arriba-centro', 'Arriba centro'], ['arriba-der', 'Arriba derecha'],
            ['abajo-izq', 'Abajo izquierda'], ['abajo-centro', 'Abajo centro'], ['abajo-der', 'Abajo derecha'],
        ];
        return {
            options: h('div', {},
                h('h2', { text: 'Números de página' }),
                h('div', { class: 'field' }, h('span', { class: 'label', text: 'Posición' }),
                    h('div', { class: 'pos-grid', role: 'radiogroup', 'aria-label': 'Posición', style: { gridTemplateRows: '1fr 1fr 1fr' } },
                        posOptions.slice(0, 3).map(([v, l]) => h('label', { title: l }, h('input', { type: 'radio', name: 'nu-pos', value: v, 'aria-label': l, checked: v === o.position, onchange: () => { o.position = v; refresh(); } }), h('span', {}))),
                        [0, 1, 2].map(() => h('span', { 'aria-hidden': 'true' })),
                        posOptions.slice(3).map(([v, l]) => h('label', { title: l }, h('input', { type: 'radio', name: 'nu-pos', value: v, 'aria-label': l, checked: v === o.position, onchange: () => { o.position = v; refresh(); } }), h('span', {}))),
                    )),
                h('div', { class: 'field' }, h('label', { for: 'nu-fmt', text: 'Formato' }),
                    (() => {
                        const s = h('select', { class: 'input', id: 'nu-fmt' }, Object.entries(FORMATS).map(([v, f]) => h('option', { value: v, text: f.label, selected: v === o.format })));
                        s.addEventListener('change', () => { o.format = s.value; refresh(); });
                        return s;
                    })()),
                field('Primer número', bind(numberInput(1, { min: 0, max: 99999 }), 'start')),
                h('div', { class: 'row' }, field('Desde la página', fromInput), field('Hasta la página', toInput)),
                h('div', { class: 'row' },
                    field('Tamaño', bind(numberInput(o.size, { min: 6, max: 48 }), 'size')),
                    field('Margen', bind(numberInput(o.margin, { min: 8, max: 100 }), 'margin')),
                    field('Color', bind(h('input', { class: 'input', type: 'color', value: o.color }), 'color')),
                ),
            ),
            validate() {
                if (!Number.isInteger(o.from) || !Number.isInteger(o.to) || o.from < 1 || o.to > n || o.from > o.to) return new UserError(`Revisa el rango de páginas: debe estar entre 1 y ${n}, y "desde" no puede ser mayor que "hasta".`);
                if (!Number.isInteger(o.start) || o.start < 0) return new UserError('El primer número debe ser un entero positivo.');
                if (!(o.size >= 6 && o.size <= 48)) return new UserError('El tamaño debe estar entre 6 y 48.');
                return null;
            },
            async run(progress) {
                const out = await loadPdfLib(bytes, file.name);
                const font = await out.embedFont(PDFLib.StandardFonts.Helvetica);
                await progress(0.4, 'Añadiendo números…');
                applyNumbers(out, font, o, indices(), i => o.start + (i - (o.from - 1)), totalShown());
                await progress(0.8, 'Guardando PDF…');
                return { blob: pdfBlob(await savePdf(out)), name: outName(file.name, 'numerado'), message: `Se numeraron ${indices().length} página(s).` };
            },
        };
    },
};
