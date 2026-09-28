import { h, alertBox, optionList, checkbox, loadScript } from '../core/dom.js';
import { outName } from '../core/files.js';
import { pdfHasText } from '../core/pdf.js';
import { Errors } from '../core/errors.js';
import { loadSinglePdf, fileBar } from './_common.js';

export async function getXLSX() {
    await loadScript(new URL('../../vendor/xlsx.full.min.js', import.meta.url).href);
    return window.XLSX;
}

/** Convierte "1.234,56", "1,234.56", "2.50" o "-7" a número; si no es número devuelve el texto. */
export function toNumber(text) {
    const t = text.trim();
    if (!/^-?[\d.,]+$/.test(t) || !/\d/.test(t)) return text;
    let s = t;
    const hasDot = s.includes('.');
    const hasComma = s.includes(',');
    if (hasDot && hasComma) {
        const dec = s.lastIndexOf('.') > s.lastIndexOf(',') ? '.' : ',';
        s = s.split(dec === '.' ? ',' : '.').join('').replace(',', '.');
    } else if (hasComma) {
        s = /^-?\d{1,3}(,\d{3})+$/.test(s) ? s.replace(/,/g, '') : s.replace(',', '.');
    } else if (hasDot && /^-?\d{1,3}(\.\d{3}){2,}$/.test(s)) {
        s = s.replace(/\./g, '');
    }
    const n = Number(s);
    return Number.isFinite(n) && (s.match(/\./g) || []).length <= 1 ? n : text;
}

/** Detecta filas y columnas a partir de la posición de los fragmentos de texto. */
export async function pageTable(page) {
    const vp = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();
    const frags = content.items.filter(it => it.str && it.str.trim()).map(it => {
        const [x, y] = vp.convertToViewportPoint(it.transform[4], it.transform[5]);
        const size = Math.hypot(it.transform[2], it.transform[3]) || 10;
        return { x, y, w: it.width, size, str: it.str };
    });
    // Filas por línea base
    const rows = [];
    for (const f of frags.sort((a, b) => a.y - b.y)) {
        let row = rows.find(r => Math.abs(r.y - f.y) < f.size * 0.5);
        if (!row) {
            row = { y: f.y, frags: [] };
            rows.push(row);
        }
        row.frags.push(f);
    }
    // Celdas: fragmentos cercanos en la misma fila forman una celda
    for (const r of rows) {
        r.frags.sort((a, b) => a.x - b.x);
        r.cells = [];
        for (const f of r.frags) {
            const last = r.cells[r.cells.length - 1];
            if (last && f.x - last.x1 < f.size * 0.9) {
                last.text += (f.x - last.x1 > f.size * 0.15 ? ' ' : '') + f.str;
                last.x1 = f.x + f.w;
            } else {
                r.cells.push({ x0: f.x, x1: f.x + f.w, text: f.str });
            }
        }
    }
    // Columnas: agrupa los inicios de celda de todas las filas
    const starts = rows.flatMap(r => r.cells.map(c => c.x0)).sort((a, b) => a - b);
    const anchors = [];
    for (const x of starts) {
        if (!anchors.length || x - anchors[anchors.length - 1].max > 8) anchors.push({ min: x, max: x });
        else anchors[anchors.length - 1].max = x;
    }
    const colOf = x => {
        let best = 0;
        anchors.forEach((a, i) => { if (x >= a.min - 8) best = i; });
        return best;
    };
    return rows.map(r => {
        const out = [];
        for (const c of r.cells) {
            let col = colOf(c.x0);
            while (out[col] !== undefined) col++;
            out[col] = c.text.trim();
        }
        for (let i = 0; i < out.length; i++) if (out[i] === undefined) out[i] = '';
        return out;
    });
}

export default {
    id: 'pdf-a-excel',
    title: 'PDF a Excel',
    description: 'Extrae las tablas de tu PDF a una hoja de cálculo de Excel (.xlsx).',
    keywords: 'xlsx hoja calculo tablas convertir excel',
    category: 'desde',
    icon: 'fa-file-excel',
    input: 'pdf',
    actionLabel: 'Convertir a Excel',
    actionIcon: 'fa-file-excel',
    progressTitle: 'Convirtiendo a Excel…',

    async setup(ctx) {
        const { file, doc } = await loadSinglePdf(ctx);
        if (!(await pdfHasText(doc, doc.numPages))) throw Errors.noText();
        let layout = 'paginas';
        let numbers = true;
        ctx.main.append(
            fileBar(file, doc.numPages),
            alertBox('info', 'Las columnas se detectan por la posición del texto en la página. Funciona muy bien con tablas generadas por computadora; con diseños complejos puede requerir ajustes manuales.'),
        );
        return {
            options: h('div', {},
                h('h2', { text: 'Opciones' }),
                optionList('xls-layout', [
                    { value: 'paginas', label: 'Una hoja por página', desc: 'Cada página del PDF en su propia pestaña.' },
                    { value: 'una', label: 'Todo en una hoja', desc: 'Todas las filas seguidas en una sola pestaña.' },
                ], layout, v => { layout = v; }),
                h('div', { style: { height: '10px' } }),
                checkbox('Convertir textos numéricos en números', numbers, v => { numbers = v; }),
            ),
            async run(progress) {
                const XLSX = await getXLSX();
                const wb = XLSX.utils.book_new();
                const all = [];
                const n = doc.numPages;
                for (let i = 1; i <= n; i++) {
                    await progress((i - 1) / n, `Analizando página ${i} de ${n}`);
                    let rows = await pageTable(await doc.getPage(i));
                    if (numbers) rows = rows.map(r => r.map(toNumber));
                    if (layout === 'paginas') {
                        if (!rows.length) rows = [['(página sin texto)']];
                        const ws = XLSX.utils.aoa_to_sheet(rows);
                        ws['!cols'] = widths(rows);
                        XLSX.utils.book_append_sheet(wb, ws, `Página ${i}`.slice(0, 31));
                    } else {
                        all.push(...rows, []);
                    }
                }
                if (layout === 'una') {
                    const ws = XLSX.utils.aoa_to_sheet(all);
                    ws['!cols'] = widths(all);
                    XLSX.utils.book_append_sheet(wb, ws, 'Datos');
                }
                await progress(1, 'Generando el archivo .xlsx…');
                const data = XLSX.write(wb, { type: 'array', bookType: 'xlsx', compression: true });
                return {
                    blob: new Blob([data], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
                    name: outName(file.name, '', 'xlsx'),
                    message: `Se convirtieron ${n} página(s) a Excel.`,
                };
            },
        };
    },
};

function widths(rows) {
    const w = [];
    rows.forEach(r => r.forEach((c, i) => { w[i] = Math.min(60, Math.max(w[i] || 8, String(c ?? '').length + 2)); }));
    return w.map(wch => ({ wch }));
}
