import { h, optionList, segmented, canvasToBlob } from '../core/dom.js';
import { baseName } from '../core/files.js';
import { renderPage, getPdfjs } from '../core/pdf.js';
import { parsePageSet } from '../core/ranges.js';
import { UserError } from '../core/errors.js';
import { loadSinglePdf, fileBar, zipBlob, rangeInput } from './_common.js';

/** Convierte un objeto de imagen de pdf.js en canvas. */
function imageToCanvas(img) {
    const w = img.width;
    const hgt = img.height;
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = hgt;
    const ctx = canvas.getContext('2d');
    if (img.bitmap) {
        ctx.drawImage(img.bitmap, 0, 0);
        return canvas;
    }
    if (!img.data) return null;
    const out = ctx.createImageData(w, hgt);
    const src = img.data;
    const dst = out.data;
    if (img.kind === 3) dst.set(src.subarray(0, dst.length)); // RGBA
    else if (img.kind === 2) {
        for (let i = 0, j = 0; j < dst.length; i += 3, j += 4) {
            dst[j] = src[i]; dst[j + 1] = src[i + 1]; dst[j + 2] = src[i + 2]; dst[j + 3] = 255;
        }
    } else if (img.kind === 1) { // 1 bit por píxel
        const rowBytes = (w + 7) >> 3;
        for (let y = 0; y < hgt; y++) {
            for (let x = 0; x < w; x++) {
                const bit = (src[y * rowBytes + (x >> 3)] >> (7 - (x & 7))) & 1;
                const k = (y * w + x) * 4;
                dst[k] = dst[k + 1] = dst[k + 2] = bit ? 255 : 0;
                dst[k + 3] = 255;
            }
        }
    } else return null;
    ctx.putImageData(out, 0, 0);
    return canvas;
}

async function embeddedImages(page) {
    const { OPS } = await getPdfjs();
    const ops = await page.getOperatorList();
    const found = [];
    const seen = new Set();
    for (let i = 0; i < ops.fnArray.length; i++) {
        const fn = ops.fnArray[i];
        if (fn !== OPS.paintImageXObject && fn !== OPS.paintImageXObjectRepeat && fn !== OPS.paintInlineImageXObject) continue;
        const arg = ops.argsArray[i][0];
        let img = arg;
        if (typeof arg === 'string') {
            if (seen.has(arg)) continue;
            seen.add(arg);
            const store = arg.startsWith('g_') ? page.commonObjs : page.objs;
            img = await new Promise(resolve => store.get(arg, resolve));
        }
        if (img && img.width >= 16 && img.height >= 16) found.push(img);
    }
    return found;
}

export default {
    id: 'pdf-a-imagen',
    title: 'PDF a JPG / PNG',
    description: 'Convierte cada página en una imagen o extrae las imágenes que contiene el PDF.',
    keywords: 'jpg jpeg png imagen foto convertir extraer imagenes',
    category: 'desde',
    icon: 'fa-file-image',
    input: 'pdf',
    actionLabel: 'Convertir a imagen',
    actionIcon: 'fa-file-image',
    progressTitle: 'Generando imágenes…',

    async setup(ctx) {
        const { file, doc } = await loadSinglePdf(ctx);
        const n = doc.numPages;
        const opts = { mode: 'paginas', format: 'jpg', dpi: 150, quality: 0.9, pages: null };
        const qualityInput = h('input', { type: 'range', min: '50', max: '100', value: '90' });
        const qualityLabel = h('span', { class: 'hint', text: 'Calidad JPG: 90 %' });
        qualityInput.addEventListener('input', () => {
            opts.quality = Number(qualityInput.value) / 100;
            qualityLabel.textContent = `Calidad JPG: ${qualityInput.value} %`;
        });
        const range = rangeInput({ label: 'Páginas (vacío = todas)', pageCount: n, placeholder: `1-${n}`, onValid: set => { opts.pages = set; } });
        const pageOpts = h('div', {},
            h('div', { class: 'field' }, h('span', { class: 'label', text: 'Resolución' }),
                segmented('img-dpi', [{ value: 72, label: '72 ppp' }, { value: 150, label: '150 ppp' }, { value: 300, label: '300 ppp' }], opts.dpi, v => { opts.dpi = v; })),
        );
        const qualityBox = h('div', { class: 'field' }, qualityInput, qualityLabel);
        const syncVisibility = () => {
            pageOpts.classList.toggle('hidden', opts.mode !== 'paginas');
            qualityBox.classList.toggle('hidden', opts.format !== 'jpg');
        };

        ctx.main.append(fileBar(file, n));
        const result = {
            options: h('div', {},
                h('h2', { text: 'Qué convertir' }),
                optionList('img-mode', [
                    { value: 'paginas', label: 'Cada página como imagen', desc: 'Una imagen por página.' },
                    { value: 'extraer', label: 'Extraer imágenes', desc: 'Solo las fotos e imágenes que contiene el PDF.' },
                ], opts.mode, v => { opts.mode = v; syncVisibility(); }),
                h('div', { class: 'field', style: { marginTop: '12px' } }, h('span', { class: 'label', text: 'Formato' }),
                    segmented('img-format', [{ value: 'jpg', label: 'JPG' }, { value: 'png', label: 'PNG' }], opts.format, v => { opts.format = v; syncVisibility(); })),
                qualityBox,
                pageOpts,
                range.node,
            ),
            validate() {
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
                const pages = opts.pages && range.input.value.trim() ? opts.pages : Array.from({ length: n }, (_, i) => i);
                const type = opts.format === 'png' ? 'image/png' : 'image/jpeg';
                const ext = opts.format;
                const outputs = [];
                const base = baseName(file.name);
                for (let k = 0; k < pages.length; k++) {
                    const i = pages[k];
                    await progress(k / pages.length * 0.9, `Página ${i + 1} (${k + 1} de ${pages.length})`);
                    const page = await doc.getPage(i + 1);
                    if (opts.mode === 'paginas') {
                        const { canvas } = await renderPage(page, { scale: opts.dpi / 72 });
                        outputs.push({ name: `${base}_pagina_${i + 1}.${ext}`, data: await canvasToBlob(canvas, type, opts.quality) });
                        canvas.width = canvas.height = 0;
                    } else {
                        const imgs = await embeddedImages(page);
                        for (const img of imgs) {
                            const canvas = imageToCanvas(img);
                            if (!canvas) continue;
                            outputs.push({ name: `${base}_imagen_${outputs.length + 1}.${ext}`, data: await canvasToBlob(canvas, type, opts.quality) });
                        }
                    }
                }
                if (!outputs.length) throw new UserError('No se encontraron imágenes en las páginas elegidas.', { hint: 'Prueba con "Cada página como imagen".' });
                if (outputs.length === 1) return { blob: outputs[0].data, name: outputs[0].name, message: 'Se generó 1 imagen.' };
                const blob = await zipBlob(outputs, f => progress(0.9 + f * 0.1, 'Generando ZIP…'));
                return { blob, name: `${base}_imagenes.zip`, message: `Se generaron ${outputs.length} imágenes (ZIP).` };
            },
        };
        syncVisibility();
        return result;
    },
};

