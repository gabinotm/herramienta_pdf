// Ayudas compartidas por las herramientas.
import { h, formatBytes, field } from '../core/dom.js';
import { readBytes, pdfBlob } from '../core/files.js';
import { openPdf } from '../core/pdf.js';
import { parsePageSet } from '../core/ranges.js';
import { previewButton } from '../core/viewer.js';

/** Lee el primer PDF del contexto y lo abre con pdf.js (se destruye al salir). */
export async function loadSinglePdf(ctx) {
    const { file } = ctx.files[0];
    const bytes = await readBytes(file);
    const doc = await openPdf(bytes, { name: file.name });
    ctx.onDispose(() => doc.destroy());
    return { file, bytes, doc };
}

const FILE_ICONS = [
    [/\.(docx?|odt)$/i, 'fa-file-word', '#2b579a'],
    [/\.(xlsx?|ods|csv)$/i, 'fa-file-excel', '#217346'],
    [/\.(pptx?|odp)$/i, 'fa-file-powerpoint', '#c43e1c'],
    [/\.(png|jpe?g|gif|webp)$/i, 'fa-file-image', '#7c3aed'],
];

/** Barra con el nombre del archivo, páginas, peso y botón de vista previa con zoom. */
export function fileBar(file, pages, ...extra) {
    const [, ic, color] = FILE_ICONS.find(([re]) => re.test(file.name)) || [null, 'fa-file-pdf', null];
    return h('div', { class: 'file-bar' },
        h('div', { class: 'file-info' },
            h('i', { class: `fa-solid ${ic}`, 'aria-hidden': 'true', style: color ? { color } : null }),
            h('div', {},
                h('div', { class: 'file-name', title: file.name, text: file.name }),
                // pages: número de páginas, o un texto propio (p. ej. "3 hoja(s)")
                h('div', { class: 'muted small', text: `${typeof pages === 'string' ? `${pages} · ` : pages != null ? `${pages} página${pages === 1 ? '' : 's'} · ` : ''}${formatBytes(file.size)}` }),
            ),
        ),
        h('div', { class: 'page-toolbar', style: { margin: 0 } }, previewButton({ file }), extra),
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
