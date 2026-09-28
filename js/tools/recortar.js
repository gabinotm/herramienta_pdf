import { h, icon, segmented } from '../core/dom.js';
import { outName, pdfBlob } from '../core/files.js';
import { loadPdfLib, savePdf, renderPage, getPdfjs } from '../core/pdf.js';
import { UserError } from '../core/errors.js';
import { loadSinglePdf, fileBar } from './_common.js';

/** Selector de rectángulo arrastrable (ratón, táctil y teclado). Valores en fracciones 0..1. */
function cropSelector(onChange) {
    const rect = { x: 0.1, y: 0.1, w: 0.8, h: 0.8 };
    const canvas = h('canvas', {});
    const box = h('div', { class: 'crop-rect', tabindex: '0', role: 'slider', 'aria-label': 'Área de recorte. Usa las flechas para mover y Mayús + flechas para cambiar el tamaño.' });
    const handles = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'].map(d => {
        const el = h('span', { class: 'crop-handle', dataset: { d } });
        const pos = { n: ['50%', '0'], s: ['50%', '100%'], e: ['100%', '50%'], w: ['0', '50%'], nw: ['0', '0'], ne: ['100%', '0'], se: ['100%', '100%'], sw: ['0', '100%'] }[d];
        Object.assign(el.style, { left: pos[0], top: pos[1], transform: 'translate(-50%, -50%)', cursor: `${d}-resize` });
        box.append(el);
        return el;
    });
    const stage = h('div', { class: 'crop-stage' }, canvas, box);
    const clamp = () => {
        const min = 0.05;
        rect.w = Math.max(min, Math.min(1, rect.w));
        rect.h = Math.max(min, Math.min(1, rect.h));
        rect.x = Math.max(0, Math.min(1 - rect.w, rect.x));
        rect.y = Math.max(0, Math.min(1 - rect.h, rect.y));
    };
    const paint = () => {
        Object.assign(box.style, { left: `${rect.x * 100}%`, top: `${rect.y * 100}%`, width: `${rect.w * 100}%`, height: `${rect.h * 100}%` });
        box.setAttribute('aria-valuetext', `Izquierda ${Math.round(rect.x * 100)} %, arriba ${Math.round(rect.y * 100)} %, ancho ${Math.round(rect.w * 100)} %, alto ${Math.round(rect.h * 100)} %`);
        onChange({ ...rect });
    };
    let drag = null;
    stage.addEventListener('pointerdown', e => {
        const r = stage.getBoundingClientRect();
        const d = e.target.dataset?.d || (e.target === box ? 'move' : null);
        if (!d) return;
        e.preventDefault();
        stage.setPointerCapture(e.pointerId);
        drag = { d, sx: e.clientX, sy: e.clientY, start: { ...rect }, W: r.width, H: r.height };
    });
    stage.addEventListener('pointermove', e => {
        if (!drag) return;
        const dx = (e.clientX - drag.sx) / drag.W;
        const dy = (e.clientY - drag.sy) / drag.H;
        const s = drag.start;
        if (drag.d === 'move') {
            rect.x = s.x + dx;
            rect.y = s.y + dy;
        } else {
            if (drag.d.includes('w')) { rect.x = Math.min(s.x + dx, s.x + s.w - 0.05); rect.w = s.w - (rect.x - s.x); }
            if (drag.d.includes('e')) rect.w = Math.min(s.w + dx, 1 - s.x);
            if (drag.d.includes('n')) { rect.y = Math.min(s.y + dy, s.y + s.h - 0.05); rect.h = s.h - (rect.y - s.y); }
            if (drag.d.includes('s')) rect.h = Math.min(s.h + dy, 1 - s.y);
        }
        clamp();
        paint();
    });
    const end = () => { drag = null; };
    stage.addEventListener('pointerup', end);
    stage.addEventListener('pointercancel', end);
    box.addEventListener('keydown', e => {
        const step = e.altKey ? 0.002 : 0.01;
        const map = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
        if (!map[e.key]) return;
        e.preventDefault();
        const [dx, dy] = map[e.key];
        if (e.shiftKey) {
            rect.w += dx;
            rect.h += dy;
        } else {
            rect.x += dx;
            rect.y += dy;
        }
        clamp();
        paint();
    });
    paint();
    return {
        stage, canvas, rect,
        set(r) {
            Object.assign(rect, r);
            clamp();
            paint();
        },
    };
}

export default {
    id: 'recortar-pdf',
    title: 'Recortar PDF',
    description: 'Define visualmente el área visible de las páginas y recorta los márgenes.',
    keywords: 'cortar margenes crop area bordes',
    category: 'editar',
    icon: 'fa-crop-simple',
    input: 'pdf',
    actionLabel: 'Recortar PDF',
    actionIcon: 'fa-crop-simple',
    progressTitle: 'Recortando…',

    async setup(ctx) {
        const { file, bytes, doc } = await loadSinglePdf(ctx);
        await loadPdfLib(bytes, file.name);
        const n = doc.numPages;
        let current = 0;
        let scope = 'todas';
        const info = h('p', { class: 'hint', 'aria-live': 'polite' });
        const sel = cropSelector(r => {
            info.textContent = `Se conservará el ${Math.round(r.w * 100)} % del ancho y el ${Math.round(r.h * 100)} % del alto.`;
        });
        const label = h('span', {});
        const prev = h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Página anterior', onclick: () => go(current - 1) }, icon('fa-chevron-left'));
        const next = h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Página siguiente', onclick: () => go(current + 1) }, icon('fa-chevron-right'));

        async function go(i) {
            current = Math.max(0, Math.min(n - 1, i));
            label.textContent = `Página ${current + 1} de ${n}`;
            prev.disabled = current === 0;
            next.disabled = current === n - 1;
            const page = await doc.getPage(current + 1);
            const vp = page.getViewport({ scale: 1 });
            const cssW = Math.min(620, ctx.main.clientWidth - 40 || 620, vp.width * 1.4);
            const ratio = window.devicePixelRatio || 1;
            await renderPage(page, { scale: (cssW / vp.width) * ratio, canvas: sel.canvas });
            sel.canvas.style.width = `${cssW}px`;
        }

        ctx.main.append(
            fileBar(file, n),
            h('div', { class: 'pager' }, prev, label, next),
            h('div', { class: 'preview-box' }, sel.stage),
            info,
        );
        await go(0);

        return {
            options: h('div', {},
                h('h2', { text: 'Recortar' }),
                h('p', { class: 'muted small', text: 'Arrastra el recuadro o sus esquinas para definir el área que se conservará.' }),
                h('div', { class: 'field' }, h('span', { class: 'label', text: 'Aplicar a' }),
                    segmented('crop-scope', [{ value: 'todas', label: 'Todas las páginas' }, { value: 'actual', label: 'Solo esta página' }], scope, v => { scope = v; })),
                h('button', { type: 'button', class: 'btn btn-sm btn-outline', style: { width: '100%', marginBottom: '14px' }, onclick: () => sel.set({ x: 0.1, y: 0.1, w: 0.8, h: 0.8 }) }, icon('fa-arrows-rotate'), 'Restablecer recuadro'),
            ),
            validate: () => (sel.rect.w > 0.99 && sel.rect.h > 0.99 ? new UserError('El recuadro cubre toda la página: no hay nada que recortar.') : null),
            async run(progress) {
                const out = await loadPdfLib(bytes, file.name);
                const targets = scope === 'todas' ? out.getPageIndices() : [current];
                await getPdfjs();
                for (let k = 0; k < targets.length; k++) {
                    const i = targets[k];
                    await progress(k / targets.length * 0.8, `Página ${i + 1}`);
                    const vp = (await doc.getPage(i + 1)).getViewport({ scale: 1 });
                    const r = sel.rect;
                    const [x1, y1] = vp.convertToPdfPoint(r.x * vp.width, r.y * vp.height);
                    const [x2, y2] = vp.convertToPdfPoint((r.x + r.w) * vp.width, (r.y + r.h) * vp.height);
                    const x = Math.min(x1, x2);
                    const y = Math.min(y1, y2);
                    const w = Math.abs(x2 - x1);
                    const hh = Math.abs(y2 - y1);
                    const page = out.getPage(i);
                    page.setCropBox(x, y, w, hh);
                    page.setTrimBox(x, y, w, hh);
                }
                await progress(0.9, 'Guardando PDF…');
                return { blob: pdfBlob(await savePdf(out)), name: outName(file.name, 'recortado'), message: `Se recortaron ${targets.length} página(s).` };
            },
        };
    },
};
