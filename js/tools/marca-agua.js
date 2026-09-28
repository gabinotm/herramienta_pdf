import { h, icon, segmented, field, toast } from '../core/dom.js';
import { outName, pdfBlob, validateFiles } from '../core/files.js';
import { loadPdfLib, savePdf } from '../core/pdf.js';
import { parsePageSet } from '../core/ranges.js';
import { UserError, toUserError } from '../core/errors.js';
import { toWinAnsi } from '../core/text.js';
import { pageGeometry, drawCenteredText, drawCenteredImage, rotatedBox, sendLastContentToBack, hexToRgb } from '../core/stamp.js';
import { loadSinglePdf, fileBar, rangeInput } from './_common.js';
import { livePreview } from './_preview.js';

const FONTS = { helvetica: 'HelveticaBold', times: 'TimesRomanBold', courier: 'CourierBold' };
const POSITIONS = ['tl', 'tc', 'tr', 'ml', 'mc', 'mr', 'bl', 'bc', 'br'];
const POS_LABEL = { tl: 'Arriba a la izquierda', tc: 'Arriba al centro', tr: 'Arriba a la derecha', ml: 'Centro izquierda', mc: 'Centro', mr: 'Centro derecha', bl: 'Abajo a la izquierda', bc: 'Abajo al centro', br: 'Abajo a la derecha' };

/** Aplica la marca de agua a las páginas indicadas del documento pdf-lib. */
async function applyWatermark(doc, indices, o, imageBytes) {
    const font = o.type === 'texto' ? await doc.embedFont(PDFLib.StandardFonts[FONTS[o.font]]) : null;
    let image = null;
    if (o.type === 'imagen') image = imageBytes.kind === 'png' ? await doc.embedPng(imageBytes.bytes) : await doc.embedJpg(imageBytes.bytes);
    const text = toWinAnsi(o.text);
    for (const i of indices) {
        const page = doc.getPage(i);
        const { W, H } = pageGeometry(page);
        let w;
        let hgt;
        if (font) {
            w = font.widthOfTextAtSize(text, o.size);
            hgt = font.heightAtSize(o.size, { descender: false }) * 0.72;
        } else {
            w = W * (o.scale / 100);
            hgt = w * (image.height / image.width);
        }
        const bb = rotatedBox(w, hgt, o.rotate);
        const m = 30;
        const draw = (cx, cy) => {
            if (font) drawCenteredText(page, text, { font, size: o.size, color: hexToRgb(o.color), opacity: o.opacity / 100, rotate: o.rotate, cx, cy });
            else drawCenteredImage(page, image, { width: w, height: hgt, opacity: o.opacity / 100, rotate: o.rotate, cx, cy });
        };
        if (o.position === 'mosaico') {
            const stepX = bb.w + 60;
            const stepY = bb.h + 60;
            for (let y = stepY / 2; y < H + stepY; y += stepY) {
                for (let x = stepX / 2 + ((Math.round(y / stepY) % 2) * stepX) / 2; x < W + stepX; x += stepX) draw(x, y);
            }
        } else {
            const col = o.position[1];
            const row = o.position[0];
            const cx = col === 'l' ? m + bb.w / 2 : col === 'r' ? W - m - bb.w / 2 : W / 2;
            const cy = row === 't' ? H - m - bb.h / 2 : row === 'b' ? m + bb.h / 2 : H / 2;
            draw(cx, cy);
        }
        if (o.layer === 'debajo') sendLastContentToBack(page);
    }
}

export default {
    id: 'marca-de-agua',
    title: 'Marca de agua',
    description: 'Añade un texto o una imagen como marca de agua en tu PDF.',
    keywords: 'sello watermark logo confidencial borrador',
    category: 'editar',
    icon: 'fa-stamp',
    input: 'pdf',
    actionLabel: 'Añadir marca de agua',
    actionIcon: 'fa-stamp',
    progressTitle: 'Aplicando marca de agua…',

    async setup(ctx) {
        const { file, bytes, doc } = await loadSinglePdf(ctx);
        await loadPdfLib(bytes, file.name);
        const n = doc.numPages;
        const o = { type: 'texto', text: 'CONFIDENCIAL', font: 'helvetica', size: 60, color: '#dc2626', opacity: 30, rotate: 45, position: 'mc', layer: 'encima', scale: 40, pages: 'todas' };
        let imageBytes = null;
        let rangeSet = null;

        const preview = livePreview(bytes, async single => {
            if (o.type === 'imagen' && !imageBytes) return;
            await applyWatermark(single, [0], o, imageBytes);
        });
        const refresh = () => preview.refresh(0);

        const input = (props, key, cast = v => v) => {
            const el = h('input', { class: 'input', ...props, value: String(o[key]) });
            el.addEventListener('input', () => { o[key] = cast(el.value); refresh(); });
            return el;
        };
        const textBox = h('div', {},
            field('Texto', input({ type: 'text', maxlength: '80' }, 'text')),
            h('div', {},
                h('div', { class: 'field' }, h('label', { text: 'Fuente', for: 'wm-font' }),
                    (() => {
                        const s = h('select', { class: 'input', id: 'wm-font' }, h('option', { value: 'helvetica', text: 'Helvetica' }), h('option', { value: 'times', text: 'Times' }), h('option', { value: 'courier', text: 'Courier' }));
                        s.addEventListener('change', () => { o.font = s.value; refresh(); });
                        return s;
                    })()),
                h('div', { class: 'row' },
                    field('Tamaño', input({ type: 'number', min: '6', max: '300' }, 'size', Number)),
                    field('Color', input({ type: 'color' }, 'color'))),
            ),
        );
        const imgName = h('span', { class: 'hint', text: 'Ningún archivo elegido (PNG o JPG)' });
        const imgInput = h('input', { type: 'file', accept: '.png,.jpg,.jpeg,image/png,image/jpeg', class: 'sr-only', id: 'wm-img' });
        imgInput.addEventListener('change', async () => {
            const f = imgInput.files?.[0];
            imgInput.value = '';
            if (!f) return;
            try {
                const [{ type }] = await validateFiles([f], 'image', { max: 1 });
                if (type !== 'png' && type !== 'jpg') throw new UserError('Para la marca de agua usa una imagen PNG o JPG.');
                imageBytes = { kind: type, bytes: new Uint8Array(await f.arrayBuffer()) };
                imgName.textContent = f.name;
                refresh();
            } catch (e) {
                const err = toUserError(e);
                toast(err.message, err.hint, 'error');
            }
        });
        const imageBox = h('div', { class: 'hidden' },
            h('div', { class: 'field' }, h('span', { class: 'label', text: 'Imagen' }),
                h('label', { for: 'wm-img', class: 'btn btn-outline' }, icon('fa-image'), 'Elegir imagen'), imgInput, imgName),
            field('Tamaño (% del ancho de página)', input({ type: 'range', min: '5', max: '100' }, 'scale', Number)),
        );
        const opacityLabel = h('span', { class: 'hint', text: `${o.opacity} %` });
        const opacity = input({ type: 'range', min: '5', max: '100' }, 'opacity', Number);
        opacity.addEventListener('input', () => { opacityLabel.textContent = `${opacity.value} %`; });

        const range = rangeInput({ label: 'Páginas (vacío = todas)', pageCount: n, placeholder: `1-${n}`, onValid: s => { rangeSet = s; } });

        ctx.main.append(fileBar(file, n), preview.node);
        preview.draw(0);

        return {
            options: h('div', {},
                h('h2', { text: 'Marca de agua' }),
                segmented('wm-type', [{ value: 'texto', label: 'Texto', icon: 'fa-font' }, { value: 'imagen', label: 'Imagen', icon: 'fa-image' }], o.type, v => {
                    o.type = v;
                    textBox.classList.toggle('hidden', v !== 'texto');
                    imageBox.classList.toggle('hidden', v !== 'imagen');
                    refresh();
                }),
                h('div', { style: { height: '10px' } }),
                textBox, imageBox,
                h('div', { class: 'field' }, h('label', { text: 'Opacidad' }), opacity, opacityLabel),
                h('div', { class: 'field' }, h('span', { class: 'label', text: 'Rotación' }),
                    segmented('wm-rot', [{ value: 0, label: '0°' }, { value: 45, label: '45°' }, { value: -45, label: '-45°' }, { value: 90, label: '90°' }], o.rotate, v => { o.rotate = v; refresh(); })),
                h('div', { class: 'field' }, h('span', { class: 'label', text: 'Posición' }),
                    h('div', { class: 'row', style: { alignItems: 'center' } },
                        h('div', { class: 'pos-grid', role: 'radiogroup', 'aria-label': 'Posición' }, POSITIONS.map(p => h('label', { title: POS_LABEL[p] },
                            h('input', { type: 'radio', name: 'wm-pos', value: p, checked: p === o.position, 'aria-label': POS_LABEL[p], onchange: () => { o.position = p; refresh(); } }), h('span', {})))),
                        h('label', { class: 'check', style: { margin: 0 } }, h('input', { type: 'radio', name: 'wm-pos', value: 'mosaico', onchange: () => { o.position = 'mosaico'; refresh(); } }), h('span', { text: 'Mosaico (repetir)' })),
                    )),
                h('div', { class: 'field' }, h('span', { class: 'label', text: 'Capa' }),
                    segmented('wm-layer', [{ value: 'encima', label: 'Encima' }, { value: 'debajo', label: 'Debajo del contenido' }], o.layer, v => { o.layer = v; refresh(); })),
                range.node,
            ),
            validate() {
                if (o.type === 'texto' && !o.text.trim()) return new UserError('Escribe el texto de la marca de agua.');
                if (o.type === 'imagen' && !imageBytes) return new UserError('Elige una imagen para la marca de agua.');
                if (!(o.size >= 6 && o.size <= 300)) return new UserError('El tamaño del texto debe estar entre 6 y 300.');
                if (range.input.value.trim()) {
                    try {
                        parsePageSet(range.input.value, n);
                    } catch (e) {
                        return e;
                    }
                }
                return null;
            },
            async run(progress) {
                const out = await loadPdfLib(bytes, file.name);
                const indices = range.input.value.trim() && rangeSet ? rangeSet : out.getPageIndices();
                await progress(0.3, `Aplicando a ${indices.length} página(s)…`);
                await applyWatermark(out, indices, o, imageBytes);
                await progress(0.8, 'Guardando PDF…');
                return { blob: pdfBlob(await savePdf(out)), name: outName(file.name, 'marca_agua'), message: `Marca de agua añadida en ${indices.length} página(s).` };
            },
        };
    },
};
