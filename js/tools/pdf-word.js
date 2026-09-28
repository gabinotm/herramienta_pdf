import { h, alertBox, optionList, canvasToBlob } from '../core/dom.js';
import { outName } from '../core/files.js';
import { renderPage, pdfHasText } from '../core/pdf.js';
import { Errors } from '../core/errors.js';
import { DocxBuilder } from '../core/docx.js';
import { loadSinglePdf, fileBar } from './_common.js';

/** Nombre real de la fuente (para detectar negrita/cursiva). Requiere haber cargado el operator list. */
function fontStyle(page, fontName) {
    try {
        const f = page.commonObjs.get(fontName);
        const n = `${f?.name || ''} ${f?.loadedName || ''}`;
        return { bold: f?.bold || /bold|black|heavy|semibold|demi/i.test(n), italic: f?.italic || /italic|oblique/i.test(n) };
    } catch {
        return { bold: false, italic: false };
    }
}

/** Agrupa los fragmentos de texto de una página en párrafos con estilo. */
async function pageParagraphs(page) {
    await page.getOperatorList(); // carga las fuentes en commonObjs
    const vp = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();
    const items = content.items.filter(it => typeof it.str === 'string' && it.str.length);
    // Líneas: fragmentos con la misma línea base.
    const lines = [];
    for (const it of items) {
        const [x, y] = vp.convertToViewportPoint(it.transform[4], it.transform[5]);
        const size = Math.hypot(it.transform[2], it.transform[3]) || it.height || 10;
        let line = lines.find(l => Math.abs(l.y - y) < size * 0.45);
        if (!line) {
            line = { y, size, items: [] };
            lines.push(line);
        }
        line.size = Math.max(line.size, size);
        line.items.push({ x, w: it.width, str: it.str, size, ...fontStyle(page, it.fontName), eol: it.hasEOL });
    }
    lines.sort((a, b) => a.y - b.y);
    for (const l of lines) {
        l.items.sort((a, b) => a.x - b.x);
        l.x0 = l.items[0].x;
        const last = l.items[l.items.length - 1];
        l.x1 = last.x + last.w;
        l.text = l.items.map(i => i.str).join('');
    }
    const content2 = lines.filter(l => l.text.trim());

    // Párrafos: líneas consecutivas cercanas con tamaño similar.
    const paras = [];
    let cur = null;
    for (const l of content2) {
        const gap = cur ? l.y - cur.lastY : Infinity;
        const similar = cur && Math.abs(l.size - cur.size) < 1.5 && gap < l.size * 1.9 && Math.abs(l.x0 - cur.x0) < l.size * 3;
        if (!similar) {
            cur = { size: l.size, x0: l.x0, lastY: l.y, lines: [], gapBefore: Number.isFinite(gap) ? gap : 0 };
            paras.push(cur);
        }
        cur.lines.push(l);
        cur.lastY = l.y;
    }
    return paras.map(p => {
        const runs = [];
        p.lines.forEach((l, li) => {
            let lastEnd = null;
            l.items.forEach(it => {
                let text = it.str;
                if (lastEnd !== null && it.x - lastEnd > it.size * 0.25 && !text.startsWith(' ')) text = ` ${text}`;
                lastEnd = it.x + it.w;
                const prev = runs[runs.length - 1];
                if (prev && prev.bold === it.bold && prev.italic === it.italic && Math.abs(prev.size - it.size) < 0.6) prev.text += text;
                else runs.push({ text, size: Math.round(it.size * 2) / 2, bold: it.bold, italic: it.italic });
            });
            if (li < p.lines.length - 1) {
                const lastRun = runs[runs.length - 1];
                // Une palabras cortadas con guion al final de la línea.
                if (/[A-Za-zÁÉÍÓÚáéíóúñÑ]-$/.test(lastRun.text)) lastRun.text = lastRun.text.slice(0, -1);
                else if (!lastRun.text.endsWith(' ')) lastRun.text += ' ';
            }
        });
        const first = p.lines[0];
        const center = (first.x0 + first.x1) / 2;
        const centered = p.lines.length <= 3 && Math.abs(center - vp.width / 2) < vp.width * 0.05 && first.x1 - first.x0 < vp.width * 0.8;
        return { runs, align: centered ? 'center' : 'left', before: Math.min(24, Math.max(0, (p.gapBefore - p.size * 1.3) * 0.6)), indent: centered ? 0 : Math.max(0, p.x0 - 72) };
    });
}

export default {
    id: 'pdf-a-word',
    title: 'PDF a Word',
    description: 'Convierte tu PDF en un documento de Word (.docx) editable.',
    keywords: 'docx doc convertir editable word',
    category: 'desde',
    icon: 'fa-file-word',
    input: 'pdf',
    actionLabel: 'Convertir a Word',
    actionIcon: 'fa-file-word',
    progressTitle: 'Convirtiendo a Word…',

    async setup(ctx) {
        const { file, doc } = await loadSinglePdf(ctx);
        const hasText = await pdfHasText(doc);
        let mode = hasText ? 'editable' : 'imagen';
        ctx.main.append(
            fileBar(file, doc.numPages),
            hasText
                ? alertBox('info', 'Modo editable: se reconstruyen los párrafos con su tamaño, negrita y cursiva. Las tablas, columnas e imágenes no se conservan con exactitud.')
                : alertBox('warning', 'Este PDF no tiene texto seleccionable (parece escaneado). Para obtener texto editable, pásalo primero por "OCR". Mientras tanto, puedes convertirlo con el modo "Diseño exacto".'),
        );
        return {
            options: h('div', {},
                h('h2', { text: 'Tipo de conversión' }),
                optionList('word-mode', [
                    { value: 'editable', label: 'Texto editable', desc: 'Párrafos con formato básico. Ideal para modificar el contenido.' },
                    { value: 'imagen', label: 'Diseño exacto', desc: 'Cada página como imagen dentro de Word. Se ve igual, pero no se puede editar.' },
                    { value: 'ambos', label: 'Ambos', desc: 'La imagen de cada página seguida de su texto editable.' },
                ], mode, v => { mode = v; }),
                h('div', { style: { height: '14px' } }),
            ),
            validate: () => (!hasText && mode !== 'imagen' ? Errors.noText() : null),
            async run(progress) {
                const b = new DocxBuilder();
                const first = (await doc.getPage(1)).getViewport({ scale: 1 });
                b.setPage(first.width, first.height, mode === 'imagen' ? 0 : 56);
                const n = doc.numPages;
                for (let i = 1; i <= n; i++) {
                    await progress((i - 1) / n, `Página ${i} de ${n}`);
                    const page = await doc.getPage(i);
                    if (i > 1) b.pageBreak();
                    if (mode !== 'editable') {
                        const vp = page.getViewport({ scale: 1 });
                        const { canvas } = await renderPage(page, { scale: 150 / 72 });
                        const jpg = new Uint8Array(await (await canvasToBlob(canvas, 'image/jpeg', 0.88)).arrayBuffer());
                        const maxW = first.width - (mode === 'imagen' ? 0 : 112);
                        const maxH = first.height - (mode === 'imagen' ? 0 : 112);
                        const s = Math.min(maxW / vp.width, maxH / vp.height);
                        b.image(jpg, 'jpeg', vp.width * s, vp.height * s);
                        if (mode === 'ambos') b.pageBreak();
                    }
                    if (mode !== 'imagen') {
                        for (const p of await pageParagraphs(page)) b.paragraph(p.runs, { align: p.align, before: p.before, after: 4, indentPt: Math.min(p.indent, 200) });
                    }
                }
                await progress(1, 'Generando el archivo .docx…');
                return { blob: await b.toBlob(), name: outName(file.name, '', 'docx'), message: `Se convirtieron ${n} página(s) a Word.` };
            },
        };
    },
};
