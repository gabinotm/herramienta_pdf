import { h, formatBytes, optionList, alertBox } from '../core/dom.js';
import { readBytes, outName, pdfBlob } from '../core/files.js';
import { loadPdfLib, savePdf, openPdf } from '../core/pdf.js';
import { runQpdf } from '../core/qpdf.js';
import { fileBar } from './_common.js';

const LEVELS = {
    basico: { label: 'Básico', desc: 'Calidad alta, reducción moderada. Imágenes a máx. 3000 px, JPEG 85 %.', quality: 0.85, maxDim: 3000 },
    recomendado: { label: 'Recomendado', desc: 'Buen equilibrio entre calidad y peso. Imágenes a máx. 2000 px, JPEG 72 %.', quality: 0.72, maxDim: 2000 },
    maximo: { label: 'Máximo', desc: 'El menor peso posible. Imágenes a máx. 1200 px, JPEG 50 %.', quality: 0.5, maxDim: 1200 },
};

/** Descomprime un flujo Flate (zlib) usando la API nativa del navegador. */
async function inflate(bytes) {
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
}

function nameOf(obj) {
    return obj instanceof PDFLib.PDFName ? obj.asString() : null;
}

/** Número de componentes de color soportados (1 gris, 3 RGB) o null si no es compatible. */
function colorComponents(doc, cs) {
    const { PDFArray, PDFName } = PDFLib;
    const resolved = doc.context.lookup(cs);
    const n = nameOf(resolved);
    if (n === '/DeviceRGB' || n === '/CalRGB') return 3;
    if (n === '/DeviceGray' || n === '/CalGray') return 1;
    if (resolved instanceof PDFArray && nameOf(resolved.get(0)) === '/ICCBased') {
        const icc = doc.context.lookup(resolved.get(1));
        const comps = icc?.dict?.get(PDFName.of('N'))?.asNumber?.();
        return comps === 1 || comps === 3 ? comps : null;
    }
    return null;
}

/**
 * Recomprime las imágenes del documento (JPEG y Flate de 8 bits en RGB o gris).
 * Solo se reemplaza una imagen si la nueva versión pesa menos.
 */
async function recompressImages(doc, level, progress) {
    const { PDFName, PDFRawStream, PDFNumber, PDFArray } = PDFLib;
    const candidates = [];
    for (const [ref, obj] of doc.context.enumerateIndirectObjects()) {
        if (!(obj instanceof PDFRawStream)) continue;
        const d = obj.dict;
        if (nameOf(d.get(PDFName.of('Subtype'))) !== '/Image') continue;
        candidates.push([ref, obj]);
    }
    let replaced = 0;
    for (let i = 0; i < candidates.length; i++) {
        const [ref, obj] = candidates[i];
        await progress(0.05 + (i / Math.max(1, candidates.length)) * 0.75, `Optimizando imagen ${i + 1} de ${candidates.length}`);
        try {
            const d = obj.dict;
            let filter = d.get(PDFName.of('Filter'));
            if (filter instanceof PDFArray) filter = filter.size() === 1 ? filter.get(0) : null;
            const filterName = nameOf(filter);
            const w = d.get(PDFName.of('Width'))?.asNumber?.();
            const hgt = d.get(PDFName.of('Height'))?.asNumber?.();
            const bpc = d.get(PDFName.of('BitsPerComponent'))?.asNumber?.();
            if (!w || !hgt || d.get(PDFName.of('ImageMask')) || d.get(PDFName.of('Decode')) || d.get(PDFName.of('Mask')) instanceof PDFArray) continue;
            if (obj.contents.length < 20_000 || Math.max(w, hgt) < 64) continue;
            const comps = colorComponents(doc, d.get(PDFName.of('ColorSpace')));
            if (!comps) continue;

            let bitmap;
            if (filterName === '/DCTDecode') {
                bitmap = await createImageBitmap(new Blob([obj.contents], { type: 'image/jpeg' }));
            } else if (filterName === '/FlateDecode' && bpc === 8 && !d.get(PDFName.of('DecodeParms'))) {
                const raw = await inflate(obj.contents);
                if (raw.length < w * hgt * comps) continue;
                const rgba = new Uint8ClampedArray(w * hgt * 4);
                for (let p = 0, s = 0; p < w * hgt; p++, s += comps) {
                    rgba[p * 4] = raw[s];
                    rgba[p * 4 + 1] = comps === 3 ? raw[s + 1] : raw[s];
                    rgba[p * 4 + 2] = comps === 3 ? raw[s + 2] : raw[s];
                    rgba[p * 4 + 3] = 255;
                }
                bitmap = await createImageBitmap(new ImageData(rgba, w, hgt));
            } else {
                continue;
            }
            const scale = Math.min(1, level.maxDim / Math.max(bitmap.width, bitmap.height));
            const nw = Math.max(1, Math.round(bitmap.width * scale));
            const nh = Math.max(1, Math.round(bitmap.height * scale));
            const canvas = new OffscreenCanvas(nw, nh);
            const ctx = canvas.getContext('2d');
            ctx.fillStyle = '#fff';
            ctx.fillRect(0, 0, nw, nh);
            ctx.drawImage(bitmap, 0, 0, nw, nh);
            bitmap.close();
            const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: level.quality });
            const jpeg = new Uint8Array(await blob.arrayBuffer());
            if (jpeg.length >= obj.contents.length * 0.92) continue;

            const nd = d.clone(doc.context);
            nd.set(PDFName.of('Filter'), PDFName.of('DCTDecode'));
            nd.set(PDFName.of('Width'), PDFNumber.of(nw));
            nd.set(PDFName.of('Height'), PDFNumber.of(nh));
            nd.set(PDFName.of('BitsPerComponent'), PDFNumber.of(8));
            nd.set(PDFName.of('ColorSpace'), PDFName.of('DeviceRGB'));
            nd.set(PDFName.of('Length'), PDFNumber.of(jpeg.length));
            nd.delete(PDFName.of('DecodeParms'));
            doc.context.assign(ref, PDFRawStream.of(nd, jpeg));
            replaced++;
        } catch {
            /* imagen no compatible: se deja igual */
        }
    }
    return { total: candidates.length, replaced };
}

export default {
    id: 'comprimir-pdf',
    title: 'Comprimir PDF',
    description: 'Reduce el peso de tu PDF manteniendo la mejor calidad posible.',
    keywords: 'reducir peso tamaño optimizar comprimir',
    category: 'optimizar',
    icon: 'fa-compress',
    input: 'pdf',
    actionLabel: 'Comprimir PDF',
    actionIcon: 'fa-compress',
    progressTitle: 'Comprimiendo PDF…',

    async setup(ctx) {
        const { file } = ctx.files[0];
        const bytes = await readBytes(file);
        // Valida que el PDF se pueda abrir (dañado / protegido) antes de configurar.
        const check = await openPdf(bytes, { name: file.name });
        const pages = check.numPages;
        await check.destroy();
        await loadPdfLib(bytes, file.name);
        let level = 'recomendado';

        ctx.main.append(
            fileBar(file, pages),
            alertBox('info', 'La compresión optimiza las imágenes y la estructura interna del PDF. El texto sigue siendo seleccionable. Los PDF que solo contienen texto suelen reducirse poco.'),
        );
        return {
            options: h('div', {},
                h('h2', { text: 'Nivel de compresión' }),
                optionList('nivel', Object.entries(LEVELS).map(([value, l]) => ({ value, label: l.label, desc: l.desc })), level, v => { level = v; }),
                h('div', { style: { height: '14px' } }),
            ),
            async run(progress) {
                const doc = await loadPdfLib(bytes, file.name);
                const stats = await recompressImages(doc, LEVELS[level], progress);
                await progress(0.82, 'Reorganizando la estructura del PDF…');
                const intermediate = await savePdf(doc);
                const q = await runQpdf([
                    '--object-streams=generate', '--compress-streams=y', '--recompress-flate', '--compression-level=9',
                    '--remove-unreferenced-resources=yes', '/in.pdf', '/out.pdf',
                ], { '/in.pdf': intermediate });
                const best = q.output && (q.code === 0 || q.code === 3) && q.output.length < intermediate.length ? q.output : intermediate;
                await progress(1, 'Listo');

                const original = bytes.length;
                if (best.length >= original) {
                    return {
                        blob: pdfBlob(bytes),
                        name: outName(file.name, 'comprimido'),
                        title: 'Este PDF ya está optimizado',
                        warning: 'No fue posible reducir más el tamaño sin perder calidad, así que te devolvemos el archivo original sin cambios.',
                        stats: [{ label: 'Peso original', value: formatBytes(original) }, { label: 'Resultado', value: formatBytes(original) }],
                    };
                }
                const pct = Math.round((1 - best.length / original) * 100);
                return {
                    blob: pdfBlob(best),
                    name: outName(file.name, 'comprimido'),
                    title: `¡Reducido un ${pct} %!`,
                    message: stats.replaced ? `Se optimizaron ${stats.replaced} de ${stats.total} imágenes.` : 'Se optimizó la estructura interna del documento.',
                    stats: [
                        { label: 'Peso original', value: formatBytes(original) },
                        { label: 'Peso final', value: formatBytes(best.length), good: true },
                        { label: 'Reducción', value: `${pct} %`, good: true },
                    ],
                };
            },
        };
    },
};
