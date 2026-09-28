import { h, alertBox, loadScript } from '../core/dom.js';
import { previewButton } from '../core/viewer.js';
import { baseName, readBytes } from '../core/files.js';
import { openPdf, pageTextLines } from '../core/pdf.js';
import { Errors, UserError } from '../core/errors.js';

async function docText(doc) {
    const pages = [];
    for (let i = 1; i <= doc.numPages; i++) pages.push((await pageTextLines(await doc.getPage(i))).map(l => l.text).join('\n'));
    return pages;
}

function escapeHtml(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export default {
    id: 'comparar-pdf',
    title: 'Comparar PDF',
    description: 'Muestra las diferencias de texto entre dos versiones de un documento.',
    keywords: 'diferencias versiones cambios diff comparar',
    category: 'editar',
    icon: 'fa-code-compare',
    input: 'pdf',
    multiple: true,
    maxFiles: 2,
    actionLabel: 'Comparar',
    actionIcon: 'fa-code-compare',
    progressTitle: 'Comparando documentos…',
    hideInContinue: true,

    async setup(ctx) {
        const files = [];
        const docs = [];
        const list = h('div', { class: 'panel' });
        const addBtn = h('button', { type: 'button', class: 'btn btn-primary' }, h('i', { class: 'fa-solid fa-plus', 'aria-hidden': 'true' }), 'Añadir la nueva versión');

        async function add(validated) {
            for (const { file } of validated) {
                if (files.length >= 2) throw new UserError('Solo se pueden comparar 2 archivos.');
                const d = await openPdf(await readBytes(file), { name: file.name });
                ctx.onDispose(() => d.destroy());
                files.push(file);
                docs.push(d);
            }
            list.replaceChildren(
                ...files.map((f, i) => h('div', { class: 'file-bar', style: { marginBottom: '8px' } },
                    h('p', { style: { margin: 0 } }, h('strong', { text: i === 0 ? 'Original: ' : 'Nueva versión: ' }), f.name, h('span', { class: 'muted', text: ` (${docs[i].numPages} pág.)` })),
                    previewButton({ pdfDoc: docs[i], name: f.name }))),
                files.length < 2 ? addBtn : '',
            );
            ctx.setActionEnabled(files.length === 2);
        }
        addBtn.addEventListener('click', async () => {
            try {
                await add(await ctx.pickFiles());
            } catch (e) {
                const { toast } = await import('../core/dom.js');
                toast(e.message, e.hint, 'error');
            }
        });
        await add(ctx.files);
        ctx.main.append(
            list,
            h('div', { style: { height: '12px' } }),
            alertBox('info', 'Se compara el texto de ambos documentos palabra por palabra. Los cambios de formato, imágenes o posición no se detectan. Si un PDF es escaneado, pásalo antes por "OCR".'),
        );
        const [a, b] = [{ get name() { return files[0].name; } }, { get name() { return files[1].name; } }];
        return {
            fileCount: () => files.length,
            addFiles: add,
            validate: () => (files.length === 2 ? null : new UserError('Añade la nueva versión del documento para compararlas.')),
            options: h('div', {}, h('h2', { text: 'Comparar' }), h('p', { class: 'muted small', text: 'Lo añadido se marca en verde y lo eliminado en rojo.' })),
            async run(progress) {
                await progress(0.1, 'Extrayendo texto del original…');
                const ta = await docText(docs[0]);
                await progress(0.4, 'Extrayendo texto de la nueva versión…');
                const tb = await docText(docs[1]);
                if (!ta.join('').trim() || !tb.join('').trim()) throw Errors.noText();
                await progress(0.6, 'Buscando diferencias…');
                await loadScript(new URL('../../vendor/diff.min.js', import.meta.url).href);
                const joinPages = pages => pages.map((t, i) => `\n[[Página ${i + 1}]]\n${t}`).join('\n');
                const parts = window.Diff.diffWordsWithSpace(joinPages(ta), joinPages(tb));
                let added = 0;
                let removed = 0;
                const html = parts.map(p => {
                    const words = (p.value.match(/\S+/g) || []).filter(w => !/^\[\[Página$/.test(w)).length;
                    const text = escapeHtml(p.value).replace(/\[\[(Página \d+)\]\]/g, '<span class="diff-page">$1</span>');
                    if (p.added) {
                        added += words;
                        return `<ins>${text}</ins>`;
                    }
                    if (p.removed) {
                        removed += words;
                        return `<del>${text}</del>`;
                    }
                    return text;
                }).join('');
                const view = h('div', { class: 'diff-view', tabindex: '0', 'aria-label': 'Diferencias entre documentos', html });
                const report = `<!DOCTYPE html><html lang="es"><head><meta charset="utf-8"><title>Comparación de PDF</title><style>body{font-family:system-ui,Arial,sans-serif;max-width:900px;margin:30px auto;padding:0 16px;line-height:1.7;color:#0f172a}.diff{white-space:pre-wrap;word-break:break-word}ins{background:#dcfce7;color:#166534;text-decoration:none}del{background:#fee2e2;color:#991b1b}.diff-page{display:block;margin:14px 0 6px;font-weight:700;color:#64748b;border-bottom:1px solid #e2e8f0}</style></head><body><h1>Comparación de PDF</h1><p><strong>Original:</strong> ${escapeHtml(a.name)}<br><strong>Nueva versión:</strong> ${escapeHtml(b.name)}</p><p>${added} palabra(s) añadida(s) · ${removed} palabra(s) eliminada(s)</p><div class="diff">${html}</div></body></html>`;
                return {
                    title: added || removed ? 'Diferencias encontradas' : 'Los textos son idénticos',
                    blob: new Blob([report], { type: 'text/html' }),
                    name: `comparacion_${baseName(a.name)}_${baseName(b.name)}.html`,
                    stats: [{ label: 'Palabras añadidas', value: String(added) }, { label: 'Palabras eliminadas', value: String(removed) }],
                    extra: view,
                };
            },
        };
    },
};
