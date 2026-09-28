// Diálogo para crear una firma: dibujarla, escribirla con fuentes manuscritas o subir una imagen.
// Devuelve un PNG (data URL) con fondo transparente, recortado a su contenido.
import { h, icon, trapFocus, toast } from './dom.js';

const FONTS = ['Dancing Script', 'Great Vibes', 'Caveat', 'Satisfy'];
let fontsLink = null;

function ensureFonts() {
    if (fontsLink) return;
    fontsLink = h('link', { rel: 'stylesheet', href: `https://fonts.googleapis.com/css2?${FONTS.map(f => `family=${f.replace(/ /g, '+')}`).join('&')}&display=swap` });
    document.head.append(fontsLink);
}

/** Recorta los píxeles transparentes alrededor del contenido. */
function trimCanvas(src, pad = 6) {
    const ctx = src.getContext('2d');
    const { width, height } = src;
    const data = ctx.getImageData(0, 0, width, height).data;
    let x0 = width;
    let y0 = height;
    let x1 = -1;
    let y1 = -1;
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            if (data[(y * width + x) * 4 + 3] > 10) {
                if (x < x0) x0 = x;
                if (x > x1) x1 = x;
                if (y < y0) y0 = y;
                if (y > y1) y1 = y;
            }
        }
    }
    if (x1 < 0) return null;
    x0 = Math.max(0, x0 - pad);
    y0 = Math.max(0, y0 - pad);
    x1 = Math.min(width - 1, x1 + pad);
    y1 = Math.min(height - 1, y1 + pad);
    const out = document.createElement('canvas');
    out.width = x1 - x0 + 1;
    out.height = y1 - y0 + 1;
    out.getContext('2d').drawImage(src, x0, y0, out.width, out.height, 0, 0, out.width, out.height);
    return out;
}

function drawPad(color) {
    const canvas = h('canvas', { class: 'sign-pad', 'aria-label': 'Área para dibujar la firma con el ratón, el dedo o un lápiz' });
    let ctx;
    let drawing = false;
    let last = null;
    let empty = true;
    const state = { color, width: 3 };
    const resize = () => {
        const r = canvas.getBoundingClientRect();
        const ratio = window.devicePixelRatio || 1;
        canvas.width = Math.max(1, r.width * ratio);
        canvas.height = Math.max(1, r.height * ratio);
        ctx = canvas.getContext('2d');
        ctx.scale(ratio, ratio);
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        empty = true;
    };
    const pos = e => {
        const r = canvas.getBoundingClientRect();
        return { x: e.clientX - r.left, y: e.clientY - r.top, p: e.pressure || 0.5 };
    };
    canvas.addEventListener('pointerdown', e => {
        e.preventDefault();
        canvas.setPointerCapture(e.pointerId);
        drawing = true;
        last = pos(e);
    });
    canvas.addEventListener('pointermove', e => {
        if (!drawing) return;
        const p = pos(e);
        ctx.strokeStyle = state.color;
        ctx.lineWidth = state.width * (e.pointerType === 'pen' ? 0.6 + p.p : 1);
        ctx.beginPath();
        ctx.moveTo(last.x, last.y);
        const mx = (last.x + p.x) / 2;
        const my = (last.y + p.y) / 2;
        ctx.quadraticCurveTo(last.x, last.y, mx, my);
        ctx.lineTo(p.x, p.y);
        ctx.stroke();
        last = p;
        empty = false;
    });
    const stop = () => { drawing = false; };
    canvas.addEventListener('pointerup', stop);
    canvas.addEventListener('pointercancel', stop);
    return { canvas, resize, state, clear: resize, isEmpty: () => empty };
}

/**
 * Abre el diálogo. kind: 'signature' | 'initials'. Devuelve Promise<dataURL | null>.
 */
export function openSignatureDialog(kind = 'signature') {
    ensureFonts();
    return new Promise(resolve => {
        const isInitials = kind === 'initials';
        let color = '#0f172a';
        let tab = 'dibujar';
        const pad = drawPad(color);
        const typed = h('input', { class: 'input', type: 'text', placeholder: isInitials ? 'Tus iniciales' : 'Tu nombre', maxlength: '60', 'aria-label': isInitials ? 'Iniciales' : 'Nombre' });
        let fontIndex = 0;
        const fontChoices = h('div', { class: 'font-choices', role: 'radiogroup', 'aria-label': 'Estilo de letra' },
            FONTS.map((f, i) => h('label', {},
                h('input', { type: 'radio', name: 'sig-font', checked: i === 0, onchange: () => { fontIndex = i; } }),
                h('span', { style: { fontFamily: `"${f}", cursive` }, 'data-font': f, text: 'Firma' }))));
        typed.addEventListener('input', () => fontChoices.querySelectorAll('span').forEach(s => { s.textContent = typed.value || (isInitials ? 'AB' : 'Firma'); }));

        let uploaded = null;
        const removeBg = h('input', { type: 'checkbox', checked: true });
        const uploadPreview = h('div', { class: 'preview-box', style: { minHeight: '120px', alignItems: 'center', background: '#fff' } }, h('span', { class: 'muted', text: 'Ninguna imagen' }));
        const upInput = h('input', { type: 'file', accept: 'image/png,image/jpeg', class: 'sr-only', id: 'sig-up' });
        upInput.addEventListener('change', () => {
            const f = upInput.files?.[0];
            upInput.value = '';
            if (!f) return;
            if (!/^image\/(png|jpeg)$/.test(f.type)) {
                toast('Formato no válido', 'Usa una imagen PNG o JPG.', 'error');
                return;
            }
            const img = new Image();
            img.onload = () => {
                uploaded = img;
                uploadPreview.replaceChildren(h('img', { src: img.src, alt: 'Firma subida', style: { maxHeight: '140px' } }));
            };
            img.src = URL.createObjectURL(f);
        });

        const colors = h('div', { class: 'row', role: 'radiogroup', 'aria-label': 'Color', style: { flex: '0 0 auto', gap: '6px' } },
            [['#0f172a', 'Negro'], ['#1d4ed8', 'Azul'], ['#b91c1c', 'Rojo']].map(([c, l], i) => h('label', { title: l, style: { flex: '0 0 auto' } },
                h('input', { type: 'radio', name: 'sig-color', checked: i === 0, class: 'sr-only', onchange: () => { color = c; pad.state.color = c; } }),
                h('span', { 'aria-label': l, style: { display: 'block', width: '30px', height: '30px', borderRadius: '50%', background: c, border: '3px solid var(--surface)', outline: '2px solid var(--border-strong)', cursor: 'pointer' } }))));

        const panels = {
            dibujar: h('div', {}, pad.canvas, h('div', { class: 'row', style: { marginTop: '8px', alignItems: 'center' } }, colors, h('button', { type: 'button', class: 'btn btn-sm btn-outline', style: { flex: '0 0 auto' }, onclick: () => pad.clear() }, icon('fa-eraser'), 'Borrar'))),
            escribir: h('div', {}, typed, h('div', { style: { height: '10px' } }), fontChoices, h('div', { style: { height: '8px' } }), colors.cloneNode(true)),
            subir: h('div', {}, h('label', { for: 'sig-up', class: 'btn btn-outline' }, icon('fa-upload'), 'Elegir imagen'), upInput, h('div', { style: { height: '10px' } }), uploadPreview,
                h('label', { class: 'check', style: { marginTop: '10px' } }, removeBg, h('span', { text: 'Quitar el fondo blanco' }))),
        };
        // Los colores clonados también deben funcionar
        panels.escribir.querySelectorAll('input[name="sig-color"]').forEach((inp, i) => {
            inp.name = 'sig-color2';
            inp.addEventListener('change', () => { color = ['#0f172a', '#1d4ed8', '#b91c1c'][i]; });
        });

        const tabs = ['dibujar', 'escribir', 'subir'];
        const tabLabels = { dibujar: 'Dibujar', escribir: 'Escribir', subir: 'Subir imagen' };
        const tabBtns = tabs.map(t => h('button', { type: 'button', role: 'tab', id: `sig-tab-${t}`, 'aria-selected': String(t === tab), 'aria-controls': `sig-panel-${t}`, onclick: () => select(t) }, tabLabels[t]));
        const body = h('div', { role: 'tabpanel' });
        function select(t) {
            tab = t;
            tabBtns.forEach((b, i) => b.setAttribute('aria-selected', String(tabs[i] === t)));
            body.id = `sig-panel-${t}`;
            body.setAttribute('aria-labelledby', `sig-tab-${t}`);
            body.replaceChildren(panels[t]);
            if (t === 'dibujar') requestAnimationFrame(() => pad.resize());
            if (t === 'escribir') typed.focus();
        }

        const finish = value => {
            release();
            backdrop.remove();
            resolve(value);
        };
        const create = async () => {
            let out = null;
            if (tab === 'dibujar') {
                if (pad.isEmpty()) return toast('La firma está vacía', 'Dibuja tu firma en el recuadro.', 'warning');
                out = trimCanvas(pad.canvas);
            } else if (tab === 'escribir') {
                const text = typed.value.trim();
                if (!text) return toast('Escribe tu nombre', '', 'warning');
                const font = FONTS[fontIndex];
                await document.fonts.load(`96px "${font}"`).catch(() => null);
                const c = document.createElement('canvas');
                const ctx = c.getContext('2d');
                ctx.font = `96px "${font}", cursive`;
                c.width = Math.ceil(ctx.measureText(text).width + 60);
                c.height = 170;
                ctx.font = `96px "${font}", cursive`;
                ctx.fillStyle = color;
                ctx.textBaseline = 'middle';
                ctx.fillText(text, 30, 85);
                out = trimCanvas(c);
            } else {
                if (!uploaded) return toast('Elige una imagen', '', 'warning');
                const c = document.createElement('canvas');
                const s = Math.min(1, 1200 / uploaded.naturalWidth);
                c.width = Math.round(uploaded.naturalWidth * s);
                c.height = Math.round(uploaded.naturalHeight * s);
                const ctx = c.getContext('2d');
                ctx.drawImage(uploaded, 0, 0, c.width, c.height);
                if (removeBg.checked) {
                    const d = ctx.getImageData(0, 0, c.width, c.height);
                    for (let i = 0; i < d.data.length; i += 4) {
                        const lum = (d.data[i] + d.data[i + 1] + d.data[i + 2]) / 3;
                        if (lum > 225) d.data[i + 3] = 0;
                        else if (lum > 190) d.data[i + 3] = Math.round(255 * (225 - lum) / 35);
                    }
                    ctx.putImageData(d, 0, 0);
                }
                out = trimCanvas(c) || c;
            }
            if (!out) return toast('La firma está vacía', '', 'warning');
            finish(out.toDataURL('image/png'));
        };

        const dialog = h('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'sig-title' },
            h('div', { class: 'modal-head' },
                h('h2', { id: 'sig-title', text: isInitials ? 'Crear iniciales' : 'Crear firma' }),
                h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Cerrar', onclick: () => finish(null) }, icon('fa-xmark'))),
            h('div', { class: 'tabs', role: 'tablist' }, tabBtns),
            body,
            h('div', { class: 'result-actions', style: { marginTop: '16px', justifyContent: 'flex-end' } },
                h('button', { type: 'button', class: 'btn btn-outline', onclick: () => finish(null) }, 'Cancelar'),
                h('button', { type: 'button', class: 'btn btn-primary', onclick: create }, icon('fa-check'), isInitials ? 'Usar iniciales' : 'Usar firma')),
        );
        const backdrop = h('div', { class: 'modal-backdrop', onclick: e => { if (e.target === backdrop) finish(null); } }, dialog);
        document.body.append(backdrop);
        const release = trapFocus(dialog, () => finish(null));
        select('dibujar');
        tabBtns[0].focus();
    });
}
