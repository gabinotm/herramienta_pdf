// Ayudas compartidas por las herramientas.
import { h, icon, formatBytes, field } from '../core/dom.js';
import { readBytes, pdfBlob } from '../core/files.js';
import { openPdf } from '../core/pdf.js';
import { parsePageSet } from '../core/ranges.js';

/** Lee el primer PDF del contexto y lo abre con pdf.js (se destruye al salir). */
export async function loadSinglePdf(ctx) {
    const { file } = ctx.files[0];
    const bytes = await readBytes(file);
    const doc = await openPdf(bytes, { name: file.name });
    ctx.onDispose(() => doc.destroy());
    return { file, bytes, doc };
}

/** Barra con el nombre del archivo, páginas y peso. */
export function fileBar(file, pages, ...extra) {
    return h('div', { class: 'file-bar' },
        h('div', { class: 'file-info' },
            icon('fa-file-pdf'),
            h('div', {},
                h('div', { class: 'file-name', title: file.name, text: file.name }),
                h('div', { class: 'muted small', text: `${pages != null ? `${pages} página${pages === 1 ? '' : 's'} · ` : ''}${formatBytes(file.size)}` }),
            ),
        ),
        extra.length ? h('div', { class: 'page-toolbar', style: { margin: 0 } }, extra) : null,
    );
}

export function pdfResult(bytes, name, message, extra = {}) {
    return { blob: pdfBlob(bytes), name, message, ...extra };
}

export async function zipBlob(entries, progress) {
    const zip = new JSZip();
    for (const { name, data } of entries) zip.file(name, data);
    return zip.generateAsync({ type: 'blob', compression: 'STORE' }, meta => {
        if (progress) progress(meta.percent / 100, 'Generando ZIP…');
    });
}

/** Campo de texto para rangos de página con validación en vivo. */
export function rangeInput({ label = 'Páginas', placeholder = 'Ej.: 1-3,5,8-10', value = '', pageCount, onValid, hint }) {
    const input = h('input', { class: 'input', type: 'text', inputmode: 'numeric', placeholder, value, autocomplete: 'off' });
    const msg = h('span', { class: 'hint', 'aria-live': 'polite' });
    const node = h('div', { class: 'field' }, h('label', { text: label }), input, msg);
    node.querySelector('label').htmlFor = input.id = `r${Math.random().toString(36).slice(2, 8)}`;
    const check = () => {
        if (!input.value.trim()) {
            input.classList.remove('invalid');
            msg.textContent = hint || '';
            onValid?.(null);
            return;
        }
        try {
            const set = parsePageSet(input.value, pageCount);
            input.classList.remove('invalid');
            msg.textContent = `${set.length} página${set.length === 1 ? '' : 's'}`;
            onValid?.(set);
        } catch (e) {
            input.classList.add('invalid');
            msg.textContent = e.message;
            onValid?.(null);
        }
    };
    input.addEventListener('input', check);
    check();
    return { node, input, set(v) { input.value = v; check(); } };
}

export function numberInput(value, { min, max, step = 1 } = {}) {
    return h('input', { class: 'input', type: 'number', value: String(value), min, max, step, inputmode: 'numeric' });
}

export { field };
