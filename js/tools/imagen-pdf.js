import { h, icon, segmented, toast, canvasToBlob } from '../core/dom.js';
import { openViewer } from '../core/viewer.js';
import { baseName, pdfBlob } from '../core/files.js';
import { savePdf } from '../core/pdf.js';
import { UserError, toUserError } from '../core/errors.js';

const SIZES = { a4: [595.28, 841.89], carta: [612, 792] };
const MARGINS = { sin: 0, pequeno: 20, grande: 40 };

/** Orientación EXIF de un JPEG (1 = normal). */
function exifOrientation(bytes) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (view.getUint16(0) !== 0xffd8) return 1;
    let off = 2;
    while (off + 4 < view.byteLength) {
        const marker = view.getUint16(off);
        const len = view.getUint16(off + 2);
        if (marker === 0xffe1 && view.getUint32(off + 4) === 0x45786966) {
            const tiff = off + 10;
            const little = view.getUint16(tiff) === 0x4949;
            const ifd = tiff + view.getUint32(tiff + 4, little);
            const count = view.getUint16(ifd, little);
            for (let i = 0; i < count; i++) {
                const e = ifd + 2 + i * 12;
                if (view.getUint16(e, little) === 0x0112) return view.getUint16(e + 8, little);
            }
            return 1;
        }
        if ((marker & 0xff00) !== 0xff00) break;
        off += 2 + len;
    }
    return 1;
}

/** Devuelve bytes embebibles (JPEG o PNG) aplicando la orientación EXIF si hace falta. */
async function prepareImage(file, type) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (type === 'png') return { kind: 'png', bytes };
    if (type === 'jpg' && exifOrientation(bytes) === 1) return { kind: 'jpg', bytes };
    // Rotada por EXIF, WEBP o GIF: se redibuja en un canvas (el navegador aplica la orientación).
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    canvas.getContext('2d').drawImage(bitmap, 0, 0);
    bitmap.close();
    const isPhoto = type === 'jpg' || type === 'webp';
    const blob = await canvasToBlob(canvas, isPhoto ? 'image/jpeg' : 'image/png', 0.92);
    return { kind: isPhoto ? 'jpg' : 'png', bytes: new Uint8Array(await blob.arrayBuffer()) };
}

export default {
    id: 'imagen-a-pdf',
    title: 'JPG / PNG a PDF',
    description: 'Convierte tus imágenes en un PDF, en el orden y tamaño de página que elijas.',
    keywords: 'jpg jpeg png imagen foto webp gif convertir',
    category: 'hacia',
    icon: 'fa-images',
    input: 'image',
    multiple: true,
    actionLabel: 'Convertir a PDF',
    actionIcon: 'fa-file-pdf',
    progressTitle: 'Creando PDF…',

    async setup(ctx) {
        const entries = new Map();
        const urls = [];
        let seq = 0;
        const opts = { size: 'a4', orientation: 'auto', margin: 'pequeno' };
        const list = h('div', { class: 'file-list', role: 'list', 'aria-label': 'Imágenes (arrastra para ordenar)' });
        const addCard = h('button', { type: 'button', class: 'add-card' }, icon('fa-plus', 'fa-2x'), 'Añadir imágenes');
        const summary = h('p', { class: 'muted small', 'aria-live': 'polite' });

        function add(validated) {
            for (const { file, type } of validated) {
                const key = `i${++seq}`;
                const url = URL.createObjectURL(file);
                urls.push(url);
                entries.set(key, { file, type });
                const card = h('div', { class: 'file-card', dataset: { key }, role: 'listitem' },
                    h('span', { class: 'order' }),
                    h('button', { type: 'button', class: 'remove', 'aria-label': `Quitar ${file.name}`, onclick: () => { card.remove(); entries.delete(key); refresh(); } }, icon('fa-xmark')),
                    h('button', { type: 'button', class: 'zoom-btn', 'aria-label': `Vista previa de ${file.name}`, title: 'Vista previa con zoom', onclick: () => openViewer({ file }) }, icon('fa-magnifying-glass-plus')),
                    h('div', { class: 'thumb-wrap' }, h('img', { src: url, alt: '', loading: 'lazy', style: { imageOrientation: 'from-image' } })),
                    h('div', { class: 'file-title', title: file.name, text: file.name }),
                );
                list.insertBefore(card, addCard);
            }
            refresh();
        }
        const ordered = () => Array.from(list.querySelectorAll('.file-card')).map(c => entries.get(c.dataset.key));
        function refresh() {
            list.querySelectorAll('.file-card .order').forEach((el, i) => { el.textContent = String(i + 1); });
            const n = entries.size;
            summary.textContent = `${n} imagen${n === 1 ? '' : 'es'}: una por página. Arrastra para cambiar el orden.`;
            ctx.setActionEnabled(n > 0);
        }
        addCard.addEventListener('click', async () => {
            try {
                add(await ctx.pickFiles());
            } catch (e) {
                const err = toUserError(e);
                toast(err.message, err.hint, 'error');
            }
        });
        list.append(addCard);
        ctx.bindDrop(list, f => ctx.addMore(f));
        add(ctx.files);
        const sortable = Sortable.create(list, { animation: 180, draggable: '.file-card', filter: '.remove, .zoom-btn', preventOnFilter: false, delay: 150, delayOnTouchOnly: true, onEnd: refresh });
        ctx.main.append(summary, list);

        return {
            options: h('div', {},
                h('h2', { text: 'Página' }),
                h('div', { class: 'field' }, h('span', { class: 'label', text: 'Tamaño' }),
                    segmented('img-size', [{ value: 'a4', label: 'A4' }, { value: 'carta', label: 'Carta' }, { value: 'ajustar', label: 'Ajustar a la imagen' }], opts.size, v => { opts.size = v; })),
                h('div', { class: 'field' }, h('span', { class: 'label', text: 'Orientación' }),
                    segmented('img-orient', [{ value: 'auto', label: 'Automática' }, { value: 'vertical', label: 'Vertical' }, { value: 'horizontal', label: 'Horizontal' }], opts.orientation, v => { opts.orientation = v; })),
                h('div', { class: 'field' }, h('span', { class: 'label', text: 'Márgenes' }),
                    segmented('img-margin', [{ value: 'sin', label: 'Sin margen' }, { value: 'pequeno', label: 'Pequeño' }, { value: 'grande', label: 'Grande' }], opts.margin, v => { opts.margin = v; })),
            ),
            fileCount: () => entries.size,
            addFiles: async v => add(v),
            validate: () => (entries.size ? null : new UserError('Añade al menos una imagen.')),
            async run(progress) {
                const { PDFDocument } = PDFLib;
                const doc = await PDFDocument.create();
                const items = ordered();
                const margin = MARGINS[opts.margin];
                for (let i = 0; i < items.length; i++) {
                    await progress(i / items.length * 0.9, `Imagen ${i + 1} de ${items.length}`);
                    let img;
                    try {
                        const prepared = await prepareImage(items[i].file, items[i].type);
                        img = prepared.kind === 'png' ? await doc.embedPng(prepared.bytes) : await doc.embedJpg(prepared.bytes);
                    } catch {
                        throw new UserError(`No se pudo leer la imagen "${items[i].file.name}": parece estar dañada.`);
                    }
                    let pw;
                    let ph;
                    if (opts.size === 'ajustar') {
                        // 1 píxel = 0,75 pt (96 ppp)
                        pw = img.width * 0.75 + margin * 2;
                        ph = img.height * 0.75 + margin * 2;
                    } else {
                        [pw, ph] = SIZES[opts.size];
                        const landscape = opts.orientation === 'horizontal' || (opts.orientation === 'auto' && img.width > img.height);
                        if (landscape) [pw, ph] = [ph, pw];
                    }
                    const page = doc.addPage([pw, ph]);
                    const s = Math.min((pw - margin * 2) / img.width, (ph - margin * 2) / img.height);
                    const w = img.width * s;
                    const hh = img.height * s;
                    page.drawImage(img, { x: (pw - w) / 2, y: (ph - hh) / 2, width: w, height: hh });
                }
                await progress(0.95, 'Guardando PDF…');
                const bytes = await savePdf(doc);
                const name = items.length === 1 ? `${baseName(items[0].file.name)}.pdf` : `${baseName(items[0].file.name)}_imagenes.pdf`;
                return { blob: pdfBlob(bytes), name, message: `PDF con ${items.length} página(s).` };
            },
            dispose() {
                sortable.destroy();
                urls.forEach(u => URL.revokeObjectURL(u));
            },
        };
    },
};
