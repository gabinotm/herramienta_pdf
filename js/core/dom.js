// Utilidades de DOM sin framework.

/**
 * Crea un elemento.  h('button', { class: 'btn', onclick: fn, 'aria-label': 'x' }, 'Texto', otroNodo)
 * Atributos especiales: class, text, html (solo para contenido propio, nunca datos del usuario),
 * style (objeto), dataset (objeto), on<evento> (función).
 */
export function h(tag, attrs = {}, ...children) {
    const el = document.createElement(tag);
    for (const [key, value] of Object.entries(attrs || {})) {
        if (value === undefined || value === null || value === false) continue;
        if (key === 'class') el.className = value;
        else if (key === 'text') el.textContent = value;
        else if (key === 'html') el.innerHTML = value;
        else if (key === 'style' && typeof value === 'object') Object.assign(el.style, value);
        else if (key === 'dataset') Object.assign(el.dataset, value);
        else if (key.startsWith('on') && typeof value === 'function') el.addEventListener(key.slice(2), value);
        else if (value === true) el.setAttribute(key, '');
        else el.setAttribute(key, value);
    }
    appendChildren(el, children);
    return el;
}

function appendChildren(el, children) {
    for (const child of children.flat(Infinity)) {
        if (child === null || child === undefined || child === false) continue;
        el.append(child instanceof Node ? child : document.createTextNode(String(child)));
    }
}

/** Ícono de Font Awesome decorativo. */
export function icon(name, extra = '') {
    const style = name.startsWith('fa-regular') ? '' : 'fa-solid ';
    return h('i', { class: `${style}${name} ${extra}`.trim(), 'aria-hidden': 'true' });
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

export function clear(el) {
    while (el.firstChild) el.firstChild.remove();
    return el;
}

export function formatBytes(bytes) {
    if (!Number.isFinite(bytes)) return '—';
    if (bytes < 1024) return `${bytes} B`;
    const units = ['KB', 'MB', 'GB'];
    let value = bytes / 1024;
    let i = 0;
    while (value >= 1024 && i < units.length - 1) {
        value /= 1024;
        i++;
    }
    return `${value.toFixed(value < 10 ? 2 : 1).replace('.', ',')} ${units[i]}`;
}

/**
 * Cede el hilo principal para que la interfaz se actualice (barra de progreso, etc.).
 * Si la pestaña está oculta, requestAnimationFrame se pausa: se usa setTimeout para no detener el proceso.
 */
export function nextFrame() {
    if (document.hidden) return new Promise(resolve => setTimeout(resolve, 0));
    return new Promise(resolve => {
        let done = false;
        const finish = () => {
            if (!done) {
                done = true;
                resolve();
            }
        };
        requestAnimationFrame(() => setTimeout(finish, 0));
        setTimeout(finish, 100); // por si la pestaña pasa a segundo plano durante la espera
    });
}

export function downloadBlob(blob, name) {
    const url = URL.createObjectURL(blob);
    const a = h('a', { href: url, download: name });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function toast(title, text = '', type = 'info', ms = 5000) {
    const box = document.getElementById('toasts');
    const icons = { info: 'fa-circle-info', error: 'fa-circle-exclamation', success: 'fa-circle-check', warning: 'fa-triangle-exclamation' };
    const el = h('div', { class: `toast ${type}`, role: type === 'error' ? 'alert' : 'status' },
        icon(icons[type] || icons.info),
        h('div', {}, h('strong', { text: title }), text ? h('p', { text }) : null),
    );
    box.append(el);
    setTimeout(() => el.remove(), ms);
}

/** Bloque de alerta en línea. */
export function alertBox(type, message, extra = null) {
    const icons = { info: 'fa-circle-info', error: 'fa-circle-exclamation', success: 'fa-circle-check', warning: 'fa-triangle-exclamation' };
    return h('div', { class: `alert alert-${type}`, role: type === 'error' ? 'alert' : 'status' },
        icon(icons[type]),
        h('div', { class: 'alert-body' }, h('p', { text: message }), extra),
    );
}

/** Grupo de opciones tipo radio con aspecto de botones segmentados. */
export function segmented(name, options, value, onChange) {
    return h('div', { class: 'segmented', role: 'radiogroup' },
        options.map(opt => h('label', {},
            h('input', {
                type: 'radio', name, value: opt.value, checked: opt.value === value,
                onchange: () => onChange(opt.value),
            }),
            h('span', {}, opt.icon ? icon(opt.icon) : null, opt.icon ? ' ' : null, opt.label),
        )),
    );
}

/** Lista de opciones grandes (radio con título y descripción). */
export function optionList(name, options, value, onChange) {
    return h('div', { class: 'options', role: 'radiogroup' },
        options.map(opt => h('label', { class: 'option' },
            h('input', { type: 'radio', name, value: opt.value, checked: opt.value === value, onchange: () => onChange(opt.value) }),
            h('div', {}, h('strong', { text: opt.label }), opt.desc ? h('span', { text: opt.desc }) : null),
        )),
    );
}

let fieldCounter = 0;
/** Campo con etiqueta asociada. */
export function field(label, control, hint = '') {
    const id = control.id || `f${++fieldCounter}`;
    control.id = id;
    const hintId = hint ? `${id}-hint` : null;
    if (hintId) control.setAttribute('aria-describedby', hintId);
    return h('div', { class: 'field' },
        h('label', { for: id, text: label }),
        control,
        hint ? h('span', { class: 'hint', id: hintId, text: hint }) : null,
    );
}

export function checkbox(label, checked, onChange) {
    return h('label', { class: 'check' },
        h('input', { type: 'checkbox', checked, onchange: e => onChange(e.target.checked) }),
        h('span', { text: label }),
    );
}

/** Retrasa la ejecución de fn hasta que dejen de llegar llamadas durante `ms`. */
export function debounce(fn, ms = 300) {
    let t;
    return (...args) => {
        clearTimeout(t);
        t = setTimeout(() => fn(...args), ms);
    };
}

/** Carga un script clásico una sola vez. */
const scriptCache = new Map();
export function loadScript(src) {
    if (!scriptCache.has(src)) {
        scriptCache.set(src, new Promise((resolve, reject) => {
            const s = h('script', { src, async: true });
            s.onload = resolve;
            s.onerror = () => {
                scriptCache.delete(src);
                reject(new Error(`No se pudo cargar ${src}`));
            };
            document.head.append(s);
        }));
    }
    return scriptCache.get(src);
}

/** Convierte un canvas en Blob. */
export function canvasToBlob(canvas, type = 'image/png', quality) {
    return new Promise((resolve, reject) => {
        canvas.toBlob(b => (b ? resolve(b) : reject(new Error('No se pudo generar la imagen'))), type, quality);
    });
}

/** Mantiene el foco dentro de un modal mientras está abierto. */
export function trapFocus(container, onClose) {
    const previous = document.activeElement;
    const handler = e => {
        if (e.key === 'Escape') {
            e.preventDefault();
            onClose();
            return;
        }
        if (e.key !== 'Tab') return;
        const focusables = $$('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])', container)
            .filter(el => !el.disabled && el.offsetParent !== null);
        if (!focusables.length) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (e.shiftKey && document.activeElement === first) {
            e.preventDefault();
            last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
            e.preventDefault();
            first.focus();
        }
    };
    container.addEventListener('keydown', handler);
    return () => {
        container.removeEventListener('keydown', handler);
        if (previous && previous.focus) previous.focus();
    };
}
