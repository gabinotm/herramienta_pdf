// Visor de vista previa con zoom para cualquier archivo admitido:
// PDF (páginas), imágenes, Word (.docx), Excel (.xlsx/.xls/.ods/.csv) y PowerPoint (.pptx).
import { h, icon, trapFocus, loadScript } from './dom.js';
import { sniff } from './files.js';
import { openPdf, renderPage } from './pdf.js';
import { UserError } from './errors.js';

const ZOOM_STEPS = [0.25, 0.33, 0.5, 0.67, 0.75, 0.9, 1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4];

/**
 * Abre el visor.
 * @param {object} o
 *  file: File/Blob (se detecta el tipo por su contenido) — o bien —
 *  pdfDoc: documento pdf.js ya abierto (no se destruye al cerrar)
 *  bytes: Uint8Array de un PDF
 *  name: nombre a mostrar; page: página inicial (base 0); rotation: rotación extra por página (función i → grados)
 */
export async function openViewer({ file, pdfDoc, bytes, name, page = 0, rotation = () => 0 }) {
    const title = name || file?.name || 'Vista previa';
    const stage = h('div', { class: 'viewer-stage', tabindex: '0', 'aria-label': 'Contenido de la vista previa. Usa Control + rueda del ratón para acercar o alejar.' });
    const content = h('div', { class: 'viewer-content' });
    stage.append(content);
    const pageInput = h('input', { class: 'input viewer-page-input', type: 'number', min: '1', value: '1', 'aria-label': 'Número de página' });
    const pageTotal = h('span', { class: 'muted' });
    const prevBtn = h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Página anterior (flecha izquierda)', title: 'Página anterior' }, icon('fa-chevron-left'));
    const nextBtn = h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Página siguiente (flecha derecha)', title: 'Página siguiente' }, icon('fa-chevron-right'));
    const pager = h('div', { class: 'viewer-pager' }, prevBtn, pageInput, pageTotal, nextBtn);
    const zoomLabel = h('button', { type: 'button', class: 'btn btn-sm btn-outline viewer-zoom-label', title: 'Volver al 100 %', 'aria-label': 'Zoom actual. Pulsa para ver al 100 %' });
    const zoomOut = h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Alejar (tecla −)', title: 'Alejar' }, icon('fa-magnifying-glass-minus'));
    const zoomIn = h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Acercar (tecla +)', title: 'Acercar' }, icon('fa-magnifying-glass-plus'));
    const fitBtn = h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Ajustar al ancho', title: 'Ajustar al ancho' }, icon('fa-arrows-left-right-to-line'));
    const closeBtn = h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Cerrar vista previa (Esc)', title: 'Cerrar (Esc)' }, icon('fa-xmark'));
    const status = h('p', { class: 'sr-only', 'aria-live': 'polite' });

    const dialog = h('div', { class: 'viewer', role: 'dialog', 'aria-modal': 'true', 'aria-label': `Vista previa de ${title}` },
        h('div', { class: 'viewer-bar' },
            h('div', { class: 'viewer-title', title }, icon('fa-eye'), h('span', { text: title })),
            pager,
            h('div', { class: 'viewer-tools' }, zoomOut, zoomLabel, zoomIn, fitBtn, closeBtn),
        ),
        stage, status,
    );
    const backdrop = h('div', { class: 'modal-backdrop viewer-backdrop' }, dialog);
    document.body.append(backdrop);
    document.body.style.overflow = 'hidden';

    let zoom = 1;
    let fit = true;
    let current = 0;
    let count = 1;
    let renderer = null; // { count, render(i, zoom) , naturalWidth(i), dispose() }
    let seq = 0;

    let ro = null;
    const close = () => {
        ro?.disconnect();
        release();
        document.removeEventListener('keydown', onKey);
        backdrop.remove();
        document.body.style.overflow = '';
        renderer?.dispose?.();
    };
    const release = trapFocus(dialog, close);
    closeBtn.addEventListener('click', close);
    backdrop.addEventListener('click', e => { if (e.target === backdrop) close(); });

    function fitZoom() {
        const avail = stage.clientWidth - 32;
        const nat = renderer?.naturalWidth?.(current) || avail;
        return Math.max(0.1, Math.min(4, avail / nat));
    }

    async function draw() {
        if (!renderer) return;
        const my = ++seq;
        if (fit) zoom = fitZoom();
        zoomLabel.textContent = `${Math.round(zoom * 100)} %`;
        pageInput.value = String(current + 1);
        pageInput.max = String(count);
        prevBtn.disabled = current <= 0;
        nextBtn.disabled = current >= count - 1;
        pager.classList.toggle('hidden', count <= 1);
        try {
            await renderer.render(current, zoom, () => my !== seq);
            status.textContent = `${count > 1 ? `Página ${current + 1} de ${count}. ` : ''}Zoom ${Math.round(zoom * 100)} %`;
        } catch (e) {
            if (my === seq) content.replaceChildren(errorView(e));
        }
    }

    function setZoom(z, keepFit = false) {
        fit = keepFit;
        zoom = Math.max(0.1, Math.min(4, z));
        draw();
    }
    const stepZoom = dir => {
        const cur = zoom;
        const next = dir > 0 ? ZOOM_STEPS.find(s => s > cur + 0.001) : [...ZOOM_STEPS].reverse().find(s => s < cur - 0.001);
        setZoom(next ?? cur);
    };
    const go = i => {
        const n = Math.max(0, Math.min(count - 1, i));
        if (n === current) return;
        current = n;
        stage.scrollTop = 0;
        draw();
    };
    zoomIn.addEventListener('click', () => stepZoom(1));
    zoomOut.addEventListener('click', () => stepZoom(-1));
    zoomLabel.addEventListener('click', () => setZoom(1));
    fitBtn.addEventListener('click', () => setZoom(fitZoom(), true));
    prevBtn.addEventListener('click', () => go(current - 1));
    nextBtn.addEventListener('click', () => go(current + 1));
    pageInput.addEventListener('change', () => go(Number(pageInput.value) - 1));
    stage.addEventListener('wheel', e => {
        if (!e.ctrlKey) return;
        e.preventDefault();
        stepZoom(e.deltaY < 0 ? 1 : -1);
    }, { passive: false });
    const onKey = e => {
        if (e.target === pageInput) return;
        if (e.key === '+' || e.key === '=') { e.preventDefault(); stepZoom(1); }
        else if (e.key === '-') { e.preventDefault(); stepZoom(-1); }
        else if (e.key === '0') { e.preventDefault(); setZoom(fitZoom(), true); }
        else if (e.key === 'ArrowRight' || e.key === 'PageDown') { e.preventDefault(); go(current + 1); }
        else if (e.key === 'ArrowLeft' || e.key === 'PageUp') { e.preventDefault(); go(current - 1); }
    };
    document.addEventListener('keydown', onKey);
    ro = new ResizeObserver(() => { if (fit) draw(); });
    ro.observe(stage);

    content.replaceChildren(h('div', { class: 'viewer-loading' }, h('span', { class: 'spinner' }), h('p', { class: 'muted', text: 'Preparando vista previa…' })));
    closeBtn.focus();
    async function start(password) {
        try {
            renderer = await createRenderer({ file, pdfDoc, bytes, name: title, content, rotation, password });
            count = renderer.count;
            current = Math.max(0, Math.min(count - 1, page));
            pageTotal.textContent = `/ ${count}`;
            await draw();
            stage.focus({ preventScroll: true });
        } catch (e) {
            pager.classList.add('hidden');
            if (e?.code === 'encrypted' || e?.code === 'wrong_password') content.replaceChildren(passwordView(e, start));
            else content.replaceChildren(errorView(e));
        }
    }
    await start();
    return { close };
}

function errorView(e) {
    const msg = e instanceof UserError ? e.message : 'No se puede mostrar la vista previa de este archivo.';
    return h('div', { class: 'viewer-loading' }, icon('fa-eye-slash', 'fa-2x'), h('p', { text: msg }), e?.hint ? h('p', { class: 'muted small', text: e.hint }) : null);
}

/** PDF protegido: pide la contraseña solo para mostrarlo (no se guarda). */
function passwordView(e, retry) {
    const input = h('input', { class: 'input', type: 'password', autocomplete: 'off', 'aria-label': 'Contraseña del PDF', style: { maxWidth: '260px' } });
    const form = h('form', { class: 'viewer-loading' },
        icon('fa-lock', 'fa-2x'),
        h('p', { text: e.code === 'wrong_password' ? 'La contraseña es incorrecta. Inténtalo de nuevo.' : 'Este PDF está protegido. Escribe la contraseña para verlo.' }),
        input,
        h('button', { type: 'submit', class: 'btn btn-primary' }, icon('fa-eye'), 'Ver documento'),
    );
    form.addEventListener('submit', ev => {
        ev.preventDefault();
        if (input.value) retry(input.value);
    });
    setTimeout(() => input.focus(), 0);
    return form;
}

// ---------- Renderizadores por tipo ----------

async function createRenderer({ file, pdfDoc, bytes, name, content, rotation, password }) {
    if (pdfDoc) return pdfRenderer(pdfDoc, content, false, rotation);
    if (bytes) return pdfRenderer(await openPdf(bytes, { name, password, checkLimit: false }), content, true, rotation);
    const type = await sniff(file);
    if (type === 'pdf') {
        const b = new Uint8Array(await file.arrayBuffer());
        return pdfRenderer(await openPdf(b, { name, password, checkLimit: false }), content, true, rotation);
    }
    if (['png', 'jpg', 'gif', 'webp'].includes(type)) return imageRenderer(file, content);
    if (type === 'docx') return htmlRenderer(content, async host => {
        await loadScript(new URL('../../vendor/docx-preview.min.js', import.meta.url).href);
        const style = h('div', {});
        host.append(style);
        const box = h('div', {});
        host.append(box);
        await window.docx.renderAsync(file, box, style, { inWrapper: true, breakPages: true, useBase64URL: true, ignoreLastRenderedPageBreak: true });
        return Array.from(box.querySelectorAll('section.docx')).map(s => ({ el: s }));
    }, { allInOne: true });
    if (['xlsx', 'ods', 'ole', 'csv'].includes(type)) return htmlRenderer(content, async host => {
        await loadScript(new URL('../../vendor/xlsx.full.min.js', import.meta.url).href);
        const wb = window.XLSX.read(await file.arrayBuffer(), { type: 'array' });
        return wb.SheetNames.map(n => {
            const wrap = h('div', { class: 'viewer-sheet' }, h('h3', { text: n }));
            const tableHost = h('div', {});
            tableHost.innerHTML = window.XLSX.utils.sheet_to_html(wb.Sheets[n], { header: '', footer: '' });
            // Nunca se ejecuta contenido del archivo: se quitan scripts y atributos de eventos por seguridad.
            tableHost.querySelectorAll('script').forEach(s => s.remove());
            tableHost.querySelectorAll('*').forEach(el => [...el.attributes].forEach(a => { if (/^on/i.test(a.name)) el.removeAttribute(a.name); }));
            wrap.append(tableHost);
            host.append(wrap);
            return { el: wrap };
        });
    });
    if (type === 'pptx') {
        const { PptxDocument } = await import('./pptx-render.js');
        const pres = await PptxDocument.load(await file.arrayBuffer());
        return {
            count: pres.slides.length,
            naturalWidth: () => (pres.width * 96) / 72,
            async render(i, zoom, stale) {
                const el = await pres.renderSlide(i);
                if (stale()) return;
                const frame = h('div', { class: 'viewer-page', style: { width: `${(pres.width * 96 / 72) * zoom}px`, height: `${(pres.height * 96 / 72) * zoom}px` } });
                el.style.transformOrigin = '0 0';
                el.style.transform = `scale(${zoom})`;
                frame.append(el);
                content.replaceChildren(frame);
            },
            dispose: () => pres.dispose(),
        };
    }
    throw new UserError('Este tipo de archivo no tiene vista previa.');
}

function pdfRenderer(doc, content, owns, rotation) {
    const widths = new Map();
    return {
        count: doc.numPages,
        naturalWidth(i) {
            return widths.get(i) || 612;
        },
        async render(i, zoom, stale) {
            const page = await doc.getPage(i + 1);
            const rot = rotation(i) || 0;
            const vp = page.getViewport({ scale: 1, rotation: (page.rotate + rot) % 360 });
            const cssScale = 96 / 72;
            widths.set(i, vp.width * cssScale);
            const ratio = window.devicePixelRatio || 1;
            // Límite de unos 24 megapíxeles para no agotar la memoria con zoom alto.
            const scale = Math.min(zoom * cssScale * ratio, Math.sqrt(24_000_000 / (vp.width * vp.height)));
            const canvas = h('canvas', { class: 'viewer-page', 'aria-label': `Página ${i + 1}`, role: 'img' });
            await renderPage(page, { scale, rotation: rot, canvas });
            if (stale()) return;
            canvas.style.width = `${vp.width * cssScale * zoom}px`;
            canvas.style.height = `${vp.height * cssScale * zoom}px`;
            content.replaceChildren(canvas);
        },
        dispose() {
            if (owns) doc.destroy();
        },
    };
}

function imageRenderer(file, content) {
    const url = URL.createObjectURL(file);
    let natural = null;
    const img = h('img', { src: url, alt: file.name || 'Imagen', class: 'viewer-page', style: { imageOrientation: 'from-image' } });
    const loaded = new Promise((resolve, reject) => {
        img.onload = () => { natural = img.naturalWidth; resolve(); };
        img.onerror = () => reject(new UserError('No se pudo leer la imagen: parece estar dañada.'));
    });
    return loaded.then(() => ({
        count: 1,
        naturalWidth: () => natural,
        async render(i, zoom) {
            img.style.width = `${img.naturalWidth * zoom}px`;
            img.style.height = 'auto';
            if (img.parentNode !== content) content.replaceChildren(img);
        },
        dispose: () => URL.revokeObjectURL(url),
    }));
}

/** Contenido HTML (Word, Excel): se renderiza una vez y se escala con CSS. */
async function htmlRenderer(content, build) {
    const host = h('div', { class: 'viewer-html' });
    const holder = h('div', { class: 'viewer-page viewer-html-page' }, host);
    content.replaceChildren(holder);
    const parts = await build(host);
    if (!parts.length) throw new UserError('El archivo está vacío.');
    const pageWidth = Math.max(...parts.map(p => p.el.getBoundingClientRect().width), 400);
    return {
        count: parts.length,
        naturalWidth: () => pageWidth,
        async render(i, zoom) {
            parts.forEach((p, k) => { p.el.style.display = k === i ? '' : 'none'; });
            host.style.zoom = String(zoom);
            if (holder.parentNode !== content) content.replaceChildren(holder);
        },
    };
}

/** Botón estándar "Vista previa". */
export function previewButton(opts, { label = 'Vista previa', small = true } = {}) {
    return h('button', {
        type: 'button', class: `btn ${small ? 'btn-sm ' : ''}btn-outline`,
        onclick: e => { e.stopPropagation(); openViewer(typeof opts === 'function' ? opts() : opts); },
    }, icon('fa-magnifying-glass-plus'), label);
}
