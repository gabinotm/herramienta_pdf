// Editor de páginas PDF basado en Fabric.js (texto, imágenes, formas, resaltado, dibujo y comentarios).
// Un solo lienzo para todas las páginas: el estado de cada página se guarda como JSON.
import { h, icon, loadScript, toast } from './dom.js';
import { renderPage, displayMapper } from './pdf.js';
import { canEncode } from './text.js';

const EXTRA_PROPS = ['kind', 'pdfFont', 'commentText', 'selectable', 'evented'];
const FONT_CSS = { helvetica: 'Helvetica, Arial, sans-serif', times: '"Times New Roman", Times, serif', courier: '"Courier New", Courier, monospace' };
const STD_FONT = {
    helvetica: ['Helvetica', 'HelveticaBold', 'HelveticaOblique', 'HelveticaBoldOblique'],
    times: ['TimesRoman', 'TimesRomanBold', 'TimesRomanItalic', 'TimesRomanBoldItalic'],
    courier: ['Courier', 'CourierBold', 'CourierOblique', 'CourierBoldOblique'],
};

export async function loadFabric() {
    await loadScript(new URL('../../vendor/fabric.min.js', import.meta.url).href);
    return window.fabric;
}

const TOOLSETS = {
    edit: ['select', 'text', 'image', 'rect', 'ellipse', 'line', 'highlight', 'draw', 'comment'],
    sign: ['select', 'signature', 'initials', 'date', 'text'],
};
const TOOL_INFO = {
    select: ['fa-arrow-pointer', 'Seleccionar y mover'],
    text: ['fa-font', 'Texto'],
    image: ['fa-image', 'Imagen'],
    rect: ['fa-square', 'Rectángulo'],
    ellipse: ['fa-circle', 'Elipse'],
    line: ['fa-minus', 'Línea'],
    highlight: ['fa-highlighter', 'Resaltar'],
    draw: ['fa-pen', 'Dibujo a mano alzada'],
    comment: ['fa-comment', 'Comentario'],
    signature: ['fa-signature', 'Firma'],
    initials: ['fa-font', 'Iniciales'],
    date: ['fa-calendar-day', 'Fecha'],
};

/**
 * @param {object} o
 *  doc: documento pdf.js; mode: 'edit' | 'sign'; onSignature(kind): Promise<dataURL|null>
 */
export async function createEditor({ doc, mode = 'edit', mount, onSignature, onChange = () => { } }) {
    const fabric = await loadFabric();
    const n = doc.numPages;
    const states = new Array(n).fill(null); // JSON por página
    const scales = new Array(n).fill(null); // px CSS por punto usados en cada página
    const history = Array.from({ length: n }, () => ({ undo: [], redo: [] }));
    let current = 0;
    let tool = 'select';
    let loading = false;
    const style = { font: 'helvetica', size: 16, color: '#111827', bold: false, italic: false, stroke: '#dc2626', fill: 'transparent', width: 3, opacity: 1 };

    // ---------- Estructura ----------
    const canvasEl = h('canvas', {});
    const stage = h('div', { class: 'editor-stage' }, canvasEl);
    const toolbar = h('div', { class: 'editor-toolbar', role: 'toolbar', 'aria-label': 'Herramientas de edición' });
    const props = h('div', { class: 'editor-props' });
    const pageLabel = h('span', { 'aria-live': 'polite' });
    const prevBtn = h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Página anterior', onclick: () => goTo(current - 1) }, icon('fa-chevron-left'));
    const nextBtn = h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Página siguiente', onclick: () => goTo(current + 1) }, icon('fa-chevron-right'));
    const undoBtn = h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Deshacer (Ctrl+Z)', title: 'Deshacer (Ctrl+Z)', onclick: () => undo() }, icon('fa-rotate-left'));
    const redoBtn = h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Rehacer (Ctrl+Y)', title: 'Rehacer (Ctrl+Y)', onclick: () => redo() }, icon('fa-rotate-right'));
    const delBtn = h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Eliminar selección (Supr)', title: 'Eliminar selección (Supr)', onclick: () => removeSelected() }, icon('fa-trash'));
    const imageInput = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp', class: 'sr-only', tabindex: '-1', 'aria-hidden': 'true' });

    const toolButtons = {};
    for (const t of TOOLSETS[mode]) {
        const [ic, label] = TOOL_INFO[t];
        toolButtons[t] = h('button', { type: 'button', class: 'icon-btn', 'aria-label': label, title: label, 'aria-pressed': 'false', onclick: () => setTool(t) },
            t === 'initials' ? h('strong', { text: 'AB', style: { fontSize: '.8rem' } }) : icon(ic));
        toolbar.append(toolButtons[t]);
    }
    toolbar.append(h('span', { class: 'sep', 'aria-hidden': 'true' }), undoBtn, redoBtn, delBtn, h('span', { class: 'sep', 'aria-hidden': 'true' }), prevBtn, pageLabel, nextBtn, imageInput);

    const root = h('div', { class: 'editor' }, toolbar, props, stage);
    if (mount) mount.append(root); // debe estar en el DOM para medir el ancho disponible

    const canvas = new fabric.Canvas(canvasEl, { preserveObjectStacking: true, selection: true, enableRetinaScaling: true });
    fabric.Object.prototype.transparentCorners = false;
    fabric.Object.prototype.cornerColor = '#2563eb';
    fabric.Object.prototype.cornerStyle = 'circle';
    fabric.Object.prototype.borderColor = '#2563eb';
    fabric.Object.prototype.cornerSize = window.matchMedia('(pointer: coarse)').matches ? 20 : 12;

    // ---------- Páginas ----------
    function availableWidth() {
        return Math.max(280, Math.min(900, (stage.clientWidth || root.clientWidth || 900) - 30));
    }

    function snapshot() {
        return JSON.stringify(canvas.toJSON(EXTRA_PROPS).objects || []);
    }

    async function loadObjects(json) {
        loading = true;
        const objects = JSON.parse(json || '[]');
        await new Promise(resolve => fabric.util.enlivenObjects(objects, enlivened => {
            canvas.getObjects().slice().forEach(o => canvas.remove(o));
            enlivened.forEach(o => canvas.add(o));
            resolve();
        }));
        canvas.discardActiveObject();
        canvas.requestRenderAll();
        loading = false;
    }

    async function goTo(i) {
        if (i < 0 || i >= n) return;
        if (states[current] !== null || canvas.getObjects().length) states[current] = snapshot();
        current = i;
        const page = await doc.getPage(i + 1);
        const vp1 = page.getViewport({ scale: 1 });
        if (!scales[i]) scales[i] = availableWidth() / vp1.width;
        const scale = scales[i];
        const ratio = window.devicePixelRatio || 1;
        const { canvas: bg } = await renderPage(page, { scale: scale * ratio, annotations: true });
        const w = Math.round(vp1.width * scale);
        const hh = Math.round(vp1.height * scale);
        canvas.setDimensions({ width: w, height: hh });
        await new Promise(resolve => {
            fabric.Image.fromURL(bg.toDataURL('image/jpeg', 0.92), img => {
                img.set({ scaleX: w / img.width, scaleY: hh / img.height });
                canvas.setBackgroundImage(img, () => resolve());
            });
        });
        await loadObjects(states[i]);
        if (states[i] === null) states[i] = '[]';
        if (!history[i].undo.length) history[i].undo.push(states[i]);
        pageLabel.textContent = `Página ${i + 1} de ${n}`;
        prevBtn.disabled = i === 0;
        nextBtn.disabled = i === n - 1;
        updateUndoButtons();
    }

    // ---------- Historial ----------
    function record() {
        if (loading) return;
        const snap = snapshot();
        const hst = history[current];
        if (hst.undo[hst.undo.length - 1] === snap) return;
        hst.undo.push(snap);
        if (hst.undo.length > 60) hst.undo.shift();
        hst.redo = [];
        states[current] = snap;
        updateUndoButtons();
        onChange();
    }
    async function undo() {
        const hst = history[current];
        if (hst.undo.length < 2) return;
        hst.redo.push(hst.undo.pop());
        states[current] = hst.undo[hst.undo.length - 1];
        await loadObjects(states[current]);
        updateUndoButtons();
        onChange();
    }
    async function redo() {
        const hst = history[current];
        if (!hst.redo.length) return;
        const snap = hst.redo.pop();
        hst.undo.push(snap);
        states[current] = snap;
        await loadObjects(snap);
        updateUndoButtons();
        onChange();
    }
    function updateUndoButtons() {
        undoBtn.disabled = history[current].undo.length < 2;
        redoBtn.disabled = !history[current].redo.length;
        delBtn.disabled = !canvas.getActiveObjects().length;
    }
    canvas.on('object:added', record);
    canvas.on('object:modified', record);
    canvas.on('object:removed', record);
    canvas.on('text:editing:exited', record);
    canvas.on('selection:created', () => { updateUndoButtons(); renderProps(); });
    canvas.on('selection:updated', () => { updateUndoButtons(); renderProps(); });
    canvas.on('selection:cleared', () => { updateUndoButtons(); renderProps(); });

    function removeSelected() {
        const objs = canvas.getActiveObjects();
        if (!objs.length) return;
        if (objs.some(o => o.isEditing)) return;
        canvas.discardActiveObject();
        loading = true;
        objs.forEach(o => canvas.remove(o));
        loading = false;
        record();
    }

    const onKey = e => {
        if (!root.isConnected) return;
        const active = canvas.getActiveObject();
        if (active?.isEditing) return;
        const tag = document.activeElement?.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
            e.preventDefault();
            e.shiftKey ? redo() : undo();
        } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
            e.preventDefault();
            redo();
        } else if ((e.key === 'Delete' || e.key === 'Backspace') && canvas.getActiveObjects().length) {
            e.preventDefault();
            removeSelected();
        }
    };
    document.addEventListener('keydown', onKey);

    // ---------- Herramientas ----------
    function setTool(t) {
        if (t === 'image') {
            imageInput.click();
            return;
        }
        if (t === 'signature' || t === 'initials') {
            insertSignature(t);
            return;
        }
        if (t === 'date') {
            const d = new Date();
            addText(`${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`, canvas.width / 2, canvas.height / 2, false);
            return;
        }
        tool = t;
        Object.entries(toolButtons).forEach(([k, b]) => {
            b.classList.toggle('active', k === t);
            b.setAttribute('aria-pressed', String(k === t));
        });
        canvas.isDrawingMode = t === 'draw';
        if (t === 'draw') {
            canvas.freeDrawingBrush = new fabric.PencilBrush(canvas);
            canvas.freeDrawingBrush.color = style.stroke;
            canvas.freeDrawingBrush.width = style.width;
        }
        canvas.selection = t === 'select';
        canvas.defaultCursor = t === 'select' ? 'default' : 'crosshair';
        canvas.forEachObject(o => { o.selectable = t === 'select' || t === 'text'; });
        renderProps();
    }

    function addText(text, x, y, edit = true) {
        const obj = new fabric.IText(text, {
            left: x, top: y, originX: edit ? 'left' : 'center', originY: edit ? 'top' : 'center',
            fontFamily: FONT_CSS[style.font], fontSize: style.size, fill: style.color,
            fontWeight: style.bold ? 'bold' : 'normal', fontStyle: style.italic ? 'italic' : 'normal',
            pdfFont: style.font, kind: 'text',
        });
        canvas.add(obj);
        canvas.setActiveObject(obj);
        if (edit) {
            obj.enterEditing();
            obj.selectAll();
        }
        setTool('select');
        return obj;
    }

    function addImage(url, { widthFrac = 0.35, kind = 'image' } = {}) {
        return new Promise(resolve => {
            fabric.Image.fromURL(url, img => {
                const target = Math.min(canvas.width * widthFrac, img.width);
                const s = target / img.width;
                img.set({ left: canvas.width / 2, top: canvas.height / 2, originX: 'center', originY: 'center', scaleX: s, scaleY: s, kind });
                canvas.add(img);
                canvas.setActiveObject(img);
                setTool('select');
                resolve(img);
            });
        });
    }

    imageInput.addEventListener('change', () => {
        const f = imageInput.files?.[0];
        imageInput.value = '';
        if (!f) return;
        if (!/^image\/(png|jpeg|webp)$/.test(f.type)) {
            toast('Formato no válido', 'Elige una imagen PNG, JPG o WEBP.', 'error');
            return;
        }
        const reader = new FileReader();
        reader.onload = () => addImage(reader.result);
        reader.readAsDataURL(f);
    });

    async function insertSignature(kind) {
        if (!onSignature) return;
        const url = await onSignature(kind);
        if (url) await addImage(url, { widthFrac: kind === 'initials' ? 0.12 : 0.3, kind: 'signature' });
    }

    // Creación de formas arrastrando
    let drawing = null;
    canvas.on('mouse:down', opt => {
        if (tool === 'select' || tool === 'draw') return;
        const p = canvas.getPointer(opt.e);
        if (tool === 'text') {
            if (opt.target && opt.target.type === 'i-text') return;
            addText('Escribe aquí', p.x, p.y);
            return;
        }
        if (tool === 'comment') {
            addComment(p.x, p.y);
            return;
        }
        const common = { left: p.x, top: p.y, originX: 'left', originY: 'top', strokeUniform: true, selectable: false };
        let obj;
        if (tool === 'rect') obj = new fabric.Rect({ ...common, width: 1, height: 1, fill: style.fill, stroke: style.stroke, strokeWidth: style.width, opacity: style.opacity, kind: 'shape' });
        else if (tool === 'ellipse') obj = new fabric.Ellipse({ ...common, rx: 1, ry: 1, fill: style.fill, stroke: style.stroke, strokeWidth: style.width, opacity: style.opacity, kind: 'shape' });
        else if (tool === 'highlight') obj = new fabric.Rect({ ...common, width: 1, height: 1, fill: '#facc15', opacity: 0.4, strokeWidth: 0, kind: 'highlight' });
        else if (tool === 'line') obj = new fabric.Line([p.x, p.y, p.x, p.y], { stroke: style.stroke, strokeWidth: style.width, opacity: style.opacity, selectable: false, kind: 'shape' });
        if (!obj) return;
        loading = true; // no registrar hasta terminar
        canvas.add(obj);
        loading = false;
        drawing = { obj, x: p.x, y: p.y };
    });
    canvas.on('mouse:move', opt => {
        if (!drawing) return;
        const p = canvas.getPointer(opt.e);
        const { obj, x, y } = drawing;
        if (obj.type === 'line') obj.set({ x2: p.x, y2: p.y });
        else if (obj.type === 'ellipse') obj.set({ left: Math.min(x, p.x), top: Math.min(y, p.y), rx: Math.abs(p.x - x) / 2, ry: Math.abs(p.y - y) / 2 });
        else obj.set({ left: Math.min(x, p.x), top: Math.min(y, p.y), width: Math.abs(p.x - x), height: Math.abs(p.y - y) });
        canvas.requestRenderAll();
    });
    canvas.on('mouse:up', () => {
        if (!drawing) return;
        const { obj } = drawing;
        drawing = null;
        const tiny = obj.type === 'line' ? Math.hypot(obj.x2 - obj.x1, obj.y2 - obj.y1) < 4 : obj.width * (obj.scaleX || 1) < 4 && obj.height < 4;
        if (tiny) {
            // Un clic sin arrastrar crea una forma de tamaño predeterminado
            if (obj.type === 'line') obj.set({ x2: obj.x1 + 120 });
            else if (obj.type === 'ellipse') obj.set({ rx: 50, ry: 30 });
            else obj.set({ width: obj.kind === 'highlight' ? 160 : 120, height: obj.kind === 'highlight' ? 22 : 70 });
        }
        obj.set({ selectable: true });
        obj.setCoords();
        canvas.setActiveObject(obj);
        setTool('select');
        record();
    });
    canvas.on('path:created', e => {
        e.path.set({ kind: 'draw' });
        record();
    });

    function addComment(x, y) {
        const note = new fabric.Rect({ left: x, top: y, width: 26, height: 26, rx: 4, ry: 4, fill: '#fde047', stroke: '#a16207', strokeWidth: 1.5, kind: 'comment', commentText: '', hasControls: false });
        canvas.add(note);
        canvas.setActiveObject(note);
        setTool('select');
        setTimeout(() => props.querySelector('textarea')?.focus(), 50);
    }

    // ---------- Propiedades ----------
    function control(label, el) {
        const id = `ep-${Math.random().toString(36).slice(2, 8)}`;
        el.id = id;
        return h('div', { class: 'field' }, h('label', { for: id, text: label }), el);
    }
    function applyToSelection(fn) {
        canvas.getActiveObjects().forEach(fn);
        canvas.requestRenderAll();
        record();
    }
    function renderProps() {
        props.replaceChildren();
        const active = canvas.getActiveObject();
        const isText = active ? active.type === 'i-text' : tool === 'text' || (mode === 'sign' && !active);
        if (active?.kind === 'comment') {
            const ta = h('textarea', { class: 'input', rows: '2', placeholder: 'Escribe tu comentario…', style: { minWidth: '260px' } });
            ta.value = active.commentText || '';
            ta.addEventListener('input', () => { active.commentText = ta.value; });
            ta.addEventListener('change', record);
            props.append(h('div', { class: 'field wide' }, h('label', { text: 'Comentario (se verá como nota en el PDF)' }), ta));
            return;
        }
        if (isText) {
            const fontSel = h('select', { class: 'input' }, Object.entries({ helvetica: 'Helvetica', times: 'Times', courier: 'Courier' }).map(([v, l]) => h('option', { value: v, text: l, selected: (active?.pdfFont || style.font) === v })));
            fontSel.addEventListener('change', () => {
                style.font = fontSel.value;
                applyToSelection(o => o.set({ pdfFont: style.font, fontFamily: FONT_CSS[style.font] }));
            });
            const size = h('input', { class: 'input', type: 'number', min: '6', max: '144', value: String(Math.round(active?.fontSize || style.size)) });
            size.addEventListener('input', () => {
                style.size = Number(size.value) || 16;
                applyToSelection(o => o.set({ fontSize: style.size }));
            });
            const color = h('input', { class: 'input', type: 'color', value: active?.fill && active.fill.startsWith('#') ? active.fill : style.color });
            color.addEventListener('input', () => {
                style.color = color.value;
                applyToSelection(o => o.set({ fill: style.color }));
            });
            const toggle = (label, key, ic) => {
                const on = active ? (key === 'bold' ? active.fontWeight === 'bold' : active.fontStyle === 'italic') : style[key];
                const b = h('button', { type: 'button', class: `icon-btn${on ? ' active' : ''}`, 'aria-label': label, 'aria-pressed': String(!!on), title: label }, icon(ic));
                b.addEventListener('click', () => {
                    style[key] = !b.classList.contains('active');
                    b.classList.toggle('active', style[key]);
                    b.setAttribute('aria-pressed', String(style[key]));
                    applyToSelection(o => o.set(key === 'bold' ? { fontWeight: style[key] ? 'bold' : 'normal' } : { fontStyle: style[key] ? 'italic' : 'normal' }));
                });
                return b;
            };
            props.append(control('Fuente', fontSel), control('Tamaño', size), control('Color', color),
                h('div', { class: 'field' }, h('span', { class: 'label', text: 'Estilo' }), h('div', { class: 'row' }, toggle('Negrita', 'bold', 'fa-bold'), toggle('Cursiva', 'italic', 'fa-italic'))));
            return;
        }
        const shapeLike = active ? ['rect', 'ellipse', 'line', 'path'].includes(active.type) && active.kind !== 'highlight' : ['rect', 'ellipse', 'line', 'draw'].includes(tool);
        if (shapeLike) {
            const stroke = h('input', { class: 'input', type: 'color', value: (active?.stroke && String(active.stroke).startsWith('#')) ? active.stroke : style.stroke });
            stroke.addEventListener('input', () => {
                style.stroke = stroke.value;
                if (canvas.freeDrawingBrush) canvas.freeDrawingBrush.color = style.stroke;
                applyToSelection(o => o.set({ stroke: style.stroke }));
            });
            const width = h('input', { class: 'input', type: 'number', min: '1', max: '40', value: String(active?.strokeWidth || style.width) });
            width.addEventListener('input', () => {
                style.width = Number(width.value) || 1;
                if (canvas.freeDrawingBrush) canvas.freeDrawingBrush.width = style.width;
                applyToSelection(o => o.set({ strokeWidth: style.width }));
            });
            const fillOn = h('input', { type: 'checkbox', checked: active ? active.fill && active.fill !== 'transparent' && active.type !== 'path' : style.fill !== 'transparent' });
            const fill = h('input', { class: 'input', type: 'color', value: '#bfdbfe' });
            const setFill = () => {
                style.fill = fillOn.checked ? fill.value : 'transparent';
                applyToSelection(o => { if (o.type !== 'line' && o.type !== 'path') o.set({ fill: style.fill }); });
            };
            fillOn.addEventListener('change', setFill);
            fill.addEventListener('input', setFill);
            const opacity = h('input', { type: 'range', min: '10', max: '100', value: String(Math.round((active?.opacity ?? style.opacity) * 100)) });
            opacity.addEventListener('input', () => {
                style.opacity = Number(opacity.value) / 100;
                applyToSelection(o => o.set({ opacity: style.opacity }));
            });
            props.append(control('Borde', stroke), control('Grosor', width),
                h('div', { class: 'field' }, h('span', { class: 'label', text: 'Relleno' }), h('div', { class: 'row', style: { alignItems: 'center' } }, h('label', { class: 'check', style: { margin: 0 } }, fillOn, h('span', { class: 'sr-only', text: 'Con relleno' })), fill)),
                control('Opacidad', opacity));
            return;
        }
        props.append(h('p', { class: 'muted small', style: { margin: 0 }, text: mode === 'sign'
            ? 'Crea tu firma y colócala en la página. Arrástrala para moverla y usa las esquinas para cambiar su tamaño.'
            : 'Elige una herramienta. Haz clic en la página para añadir texto o comentarios; arrastra para dibujar formas y resaltados.' }));
    }

    // ---------- Exportar ----------
    function hasChanges() {
        if (canvas.getObjects().length) states[current] = snapshot();
        return states.some(s => s && s !== '[]');
    }

    /** Aplica las ediciones al documento pdf-lib `out`. */
    async function exportTo(out, progress) {
        states[current] = snapshot();
        const { PDFHexString, degrees } = PDFLib;
        const fontCache = new Map();
        const getFont = async name => {
            if (!fontCache.has(name)) fontCache.set(name, await out.embedFont(PDFLib.StandardFonts[name]));
            return fontCache.get(name);
        };
        const tmp = new fabric.StaticCanvas(null, { enableRetinaScaling: false });
        let count = 0;
        for (let i = 0; i < n; i++) {
            const json = states[i];
            if (!json || json === '[]') continue;
            await progress?.(i / n * 0.9, `Aplicando cambios en la página ${i + 1}`);
            const page = await doc.getPage(i + 1);
            const scale = scales[i];
            const vp = page.getViewport({ scale });
            tmp.setDimensions({ width: vp.width, height: vp.height });
            await new Promise(resolve => fabric.util.enlivenObjects(JSON.parse(json), objs => {
                tmp.clear();
                objs.forEach(o => tmp.add(o));
                resolve();
            }));
            const map = displayMapper(vp);
            const target = out.getPage(i);
            const toPdf = (x, y) => map.toPdf(x, y);
            const localToPdf = (obj, lx, ly) => {
                const pt = fabric.util.transformPoint(new fabric.Point(lx, ly), obj.calcTransformMatrix());
                return toPdf(pt.x, pt.y);
            };
            for (const obj of tmp.getObjects()) {
                count++;
                if (obj.kind === 'comment') {
                    const [x, y] = toPdf(obj.left, obj.top + obj.height);
                    const annot = out.context.obj({
                        Type: 'Annot', Subtype: 'Text', Rect: [x, y, x + 20, y + 20], Name: 'Comment', F: 4, Open: false, C: [0.99, 0.88, 0.28],
                        Contents: PDFHexString.fromText(obj.commentText || ''), T: PDFHexString.fromText('PDF PRO'),
                    });
                    target.node.addAnnot(out.context.register(annot));
                    continue;
                }
                const uniform = Math.abs((obj.scaleX || 1) - (obj.scaleY || 1)) < 0.01;
                // Texto vectorial real
                if (obj.type === 'i-text' && obj.pdfFont && uniform && !obj.flipX && !obj.flipY && canEncode(obj.text)) {
                    const variant = (obj.fontWeight === 'bold' ? 1 : 0) + (obj.fontStyle === 'italic' ? 2 : 0);
                    const font = await getFont(STD_FONT[obj.pdfFont][variant]);
                    const size = obj.fontSize * obj.scaleY * map.unit;
                    const color = hexColor(obj.fill);
                    let top = -obj.height / 2;
                    obj.textLines.forEach((line, k) => {
                        const lh = obj.getHeightOfLine(k);
                        const baseline = top + (lh / obj.lineHeight) * (1 - obj._fontSizeFraction);
                        const left = -obj.width / 2 + obj._getLineLeftOffset(k);
                        top += lh;
                        if (!line.trim()) return;
                        const [x, y] = localToPdf(obj, left, baseline);
                        target.drawText(line, { x, y, size, font, color, opacity: obj.opacity ?? 1, rotate: degrees(map.angle - (obj.angle || 0)) });
                    });
                    continue;
                }
                // Imágenes (firmas, fotos): se incrusta el original
                if (obj.type === 'image' && !obj.flipX && !obj.flipY) {
                    const src = obj.getSrc();
                    const bytes = await (await fetch(src)).arrayBuffer();
                    const img = /^data:image\/jpe?g/.test(src) ? await out.embedJpg(bytes) : await out.embedPng(await toPngBytes(src, bytes));
                    const [x, y] = localToPdf(obj, -obj.width / 2, obj.height / 2);
                    target.drawImage(img, { x, y, width: obj.getScaledWidth() * map.unit, height: obj.getScaledHeight() * map.unit, rotate: degrees(map.angle - (obj.angle || 0)), opacity: obj.opacity ?? 1 });
                    continue;
                }
                // Resto (formas, resaltados, dibujo): imagen PNG de alta resolución
                const mult = Math.max(1, (200 / 72) / scale);
                const url = obj.toDataURL({ format: 'png', multiplier: mult });
                const png = await out.embedPng(await (await fetch(url)).arrayBuffer());
                const b = obj.getBoundingRect(true, true);
                const pad = 0;
                const [x, y] = toPdf(b.left - pad, b.top + b.height + pad);
                target.drawImage(png, { x, y, width: (b.width + pad * 2) * map.unit, height: (b.height + pad * 2) * map.unit, rotate: degrees(map.angle) });
            }
        }
        tmp.dispose();
        return count;
    }

    await goTo(0);
    setTool('select');

    return {
        el: root,
        hasChanges,
        exportTo,
        addImage,
        dispose() {
            document.removeEventListener('keydown', onKey);
            canvas.dispose();
        },
    };
}

function hexColor(value) {
    const m = /^#?([0-9a-f]{6})$/i.exec(String(value || '#000000'));
    const n = parseInt(m ? m[1] : '000000', 16);
    return PDFLib.rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

/** PNG listo para pdf-lib (convierte WEBP u otros formatos pasando por un canvas). */
async function toPngBytes(src, bytes) {
    if (/^data:image\/png/.test(src)) return bytes;
    const img = await createImageBitmap(new Blob([bytes]));
    const c = document.createElement('canvas');
    c.width = img.width;
    c.height = img.height;
    c.getContext('2d').drawImage(img, 0, 0);
    return (await (await fetch(c.toDataURL('image/png'))).arrayBuffer());
}
