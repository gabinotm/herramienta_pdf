import { h, alertBox, canvasToBlob } from '../core/dom.js';
import { readBytes, outName, pdfBlob } from '../core/files.js';
import { runQpdf } from '../core/qpdf.js';
import { getPdfjs, renderPage } from '../core/pdf.js';
import { UserError } from '../core/errors.js';
import { fileBar } from './_common.js';

/** ¿pdf-lib puede abrir el resultado? Devuelve el número de páginas o 0. */
async function pageCount(bytes) {
    try {
        const d = await PDFLib.PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
        return d.getPageCount();
    } catch {
        return 0;
    }
}

/** Último recurso: reconstruye el documento página a página como imágenes con pdf.js (muy tolerante). */
async function rebuildWithPdfjs(bytes, progress) {
    const pdfjs = await getPdfjs();
    const doc = await pdfjs.getDocument({ data: bytes.slice(), isEvalSupported: false, stopAtErrors: false }).promise;
    const out = await PDFLib.PDFDocument.create();
    const total = doc.numPages;
    let ok = 0;
    try {
        for (let i = 1; i <= doc.numPages; i++) {
            await progress(0.5 + (i / doc.numPages) * 0.45, `Recuperando página ${i} de ${doc.numPages}`);
            try {
                const page = await doc.getPage(i);
                const vp = page.getViewport({ scale: 1 });
                const { canvas } = await renderPage(page, { scale: 150 / 72 });
                const img = await out.embedJpg(await (await canvasToBlob(canvas, 'image/jpeg', 0.85)).arrayBuffer());
                out.addPage([vp.width, vp.height]).drawImage(img, { x: 0, y: 0, width: vp.width, height: vp.height });
                ok++;
            } catch {
                /* página irrecuperable */
            }
        }
    } finally {
        await doc.destroy();
    }
    if (!ok) throw new Error('sin páginas');
    return { bytes: await out.save(), pages: ok, total };
}

export default {
    id: 'reparar-pdf',
    title: 'Reparar PDF',
    description: 'Intenta recuperar PDF dañados o que no se abren correctamente.',
    keywords: 'arreglar recuperar corrupto dañado roto',
    category: 'optimizar',
    icon: 'fa-screwdriver-wrench',
    input: 'pdf',
    actionLabel: 'Reparar PDF',
    actionIcon: 'fa-screwdriver-wrench',
    progressTitle: 'Reparando PDF…',
    layout: 'single',

    async setup(ctx) {
        const { file } = ctx.files[0];
        const bytes = await readBytes(file);
        ctx.main.append(
            fileBar(file, null),
            alertBox('info', 'Se intentará reconstruir la estructura interna del PDF (tabla de referencias, objetos y flujos). Si el daño es grave, se recuperarán las páginas legibles como imágenes.'),
        );
        return {
            async run(progress) {
                // 1) qpdf: reconstruye la tabla xref y reescribe el archivo.
                await progress(0.1, 'Analizando la estructura con qpdf…');
                const q = await runQpdf(['--object-streams=preserve', '/in.pdf', '/out.pdf'], { '/in.pdf': bytes });
                if (q.output && (q.code === 0 || q.code === 3)) {
                    const n = await pageCount(q.output);
                    if (n) {
                        return {
                            blob: pdfBlob(q.output), name: outName(file.name, 'reparado'),
                            message: q.code === 3 ? `Se corrigieron errores de estructura. El documento tiene ${n} página(s).` : `El archivo no tenía errores graves; se reescribió limpio (${n} página(s)).`,
                        };
                    }
                }
                // 2) pdf-lib: lectura secuencial de objetos, ignora la tabla xref dañada.
                await progress(0.3, 'Recuperando objetos del documento…');
                try {
                    const d = await PDFLib.PDFDocument.load(bytes, { throwOnInvalidObject: false, updateMetadata: false });
                    if (d.getPageCount() > 0) {
                        const saved = await d.save({ useObjectStreams: false });
                        const q2 = await runQpdf(['/in.pdf', '/out.pdf'], { '/in.pdf': saved });
                        const final = q2.output && q2.code !== 2 ? q2.output : saved;
                        const n = await pageCount(final);
                        if (n) {
                            return { blob: pdfBlob(final), name: outName(file.name, 'reparado'), message: `Se reconstruyó la estructura del PDF. El documento tiene ${n} página(s).` };
                        }
                    }
                } catch {
                    /* siguiente método */
                }
                // 3) pdf.js: reconstrucción visual.
                await progress(0.5, 'Recuperando páginas legibles…');
                try {
                    const r = await rebuildWithPdfjs(bytes, progress);
                    return {
                        blob: pdfBlob(r.bytes), name: outName(file.name, 'reparado'),
                        message: `Se recuperaron ${r.pages} de ${r.total} página(s).`,
                        warning: 'El archivo estaba muy dañado: las páginas se recuperaron como imágenes, por lo que el texto ya no es seleccionable. Puedes usar la herramienta OCR para volver a hacerlo buscable.',
                    };
                } catch {
                    throw new UserError('No se pudo recuperar ninguna página de este archivo: el daño es demasiado grave.', { hint: 'Si tienes otra copia del documento (por ejemplo, en tu correo), intenta con ella.' });
                }
            },
        };
    },
};
