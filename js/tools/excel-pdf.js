import { h, alertBox, segmented, checkbox } from '../core/dom.js';
import { fileBar } from './_common.js';
import { outName, pdfBlob } from '../core/files.js';
import { savePdf } from '../core/pdf.js';
import { UserError } from '../core/errors.js';
import { toWinAnsi } from '../core/text.js';
import { getXLSX } from './pdf-excel.js';

const A4 = [595.28, 841.89];

/** Recorta un texto para que quepa en un ancho, añadiendo "…". */
function fit(font, text, size, width) {
    if (font.widthOfTextAtSize(text, size) <= width) return text;
    let lo = 0;
    let hi = text.length;
    while (lo < hi) {
        const mid = Math.ceil((lo + hi) / 2);
        if (font.widthOfTextAtSize(`${text.slice(0, mid)}…`, size) <= width) lo = mid;
        else hi = mid - 1;
    }
    return lo ? `${text.slice(0, lo)}…` : '';
}

/** Dibuja una hoja como tabla paginada. */
function drawSheet(pdf, fonts, name, rows, opts) {
    const { rgb } = PDFLib;
    const margin = 36;
    const cols = Math.max(...rows.map(r => r.length));
    const baseSize = 9;
    const pad = 4;
    // Ancho natural de cada columna
    const natural = Array.from({ length: cols }, (_, c) => Math.min(220, Math.max(24, ...rows.map(r => fonts.regular.widthOfTextAtSize(r[c] || '', baseSize) + pad * 2))));
    const totalW = natural.reduce((a, b) => a + b, 0);
    let [pw, ph] = A4;
    const landscape = opts.orientation === 'horizontal' || (opts.orientation === 'auto' && totalW > pw - margin * 2);
    if (landscape) [pw, ph] = [ph, pw];
    const avail = pw - margin * 2;
    const scale = opts.fitWidth && totalW > avail ? Math.max(0.35, avail / totalW) : 1;
    const size = baseSize * scale;
    const widths = natural.map(w => w * scale);
    const rowH = size * 1.9;

    // Columnas que caben por página (si no se ajusta al ancho, se reparten en varias páginas)
    const colGroups = [];
    let start = 0;
    while (start < cols) {
        let w = 0;
        let end = start;
        while (end < cols && (w + widths[end] <= avail || end === start)) w += widths[end++];
        colGroups.push([start, end]);
        start = end;
    }
    let pages = 0;
    for (const [c0, c1] of colGroups) {
        let r = 0;
        while (r < rows.length) {
            const page = pdf.addPage([pw, ph]);
            pages++;
            page.drawText(fit(fonts.bold, toWinAnsi(name), 11, avail), { x: margin, y: ph - margin + 8, size: 11, font: fonts.bold, color: rgb(0.15, 0.2, 0.35) });
            let y = ph - margin - 8;
            while (r < rows.length && y - rowH >= margin) {
                let x = margin;
                for (let c = c0; c < c1; c++) {
                    const w = widths[c];
                    if (opts.grid) page.drawRectangle({ x, y: y - rowH, width: w, height: rowH, borderColor: rgb(0.8, 0.82, 0.86), borderWidth: 0.5 });
                    const raw = rows[r][c] ?? '';
                    const text = fit(fonts.regular, toWinAnsi(String(raw)), size, w - pad * 2 * scale);
                    if (text) {
                        const isNum = /^[-+]?[\d.,\s]+%?$/.test(String(raw).trim());
                        const tw = fonts.regular.widthOfTextAtSize(text, size);
                        page.drawText(text, { x: isNum ? x + w - pad * scale - tw : x + pad * scale, y: y - rowH + (rowH - size) / 2 + size * 0.22, size, font: fonts.regular, color: rgb(0.07, 0.09, 0.15) });
                    }
                    x += w;
                }
                y -= rowH;
                r++;
            }
        }
    }
    return pages;
}

export default {
    id: 'excel-a-pdf',
    title: 'Excel a PDF',
    description: 'Convierte hojas de cálculo (.xlsx, .xls, .ods, .csv) en PDF.',
    keywords: 'xlsx xls ods csv hoja calculo excel convertir tabla',
    category: 'hacia',
    icon: 'fa-file-excel',
    input: 'sheet',
    actionLabel: 'Convertir a PDF',
    actionIcon: 'fa-file-pdf',
    progressTitle: 'Convirtiendo hoja de cálculo…',

    async setup(ctx) {
        const { file } = ctx.files[0];
        const XLSX = await getXLSX();
        let wb;
        try {
            wb = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: true });
        } catch {
            throw new UserError(`No se pudo leer "${file.name}": el archivo parece estar dañado o protegido con contraseña.`);
        }
        const sheets = wb.SheetNames.map(name => {
            const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: false, defval: '', blankrows: false });
            // Quita columnas vacías al final
            let maxCol = 0;
            rows.forEach(r => r.forEach((v, i) => { if (String(v).trim()) maxCol = Math.max(maxCol, i + 1); }));
            return { name, rows: rows.map(r => r.slice(0, maxCol).map(v => String(v))), selected: true };
        });
        const opts = { orientation: 'auto', fitWidth: true, grid: true };
        ctx.main.append(
            fileBar(file, `${sheets.length} hoja(s)`),
            alertBox('info', 'Se convierten los valores de las celdas con su formato numérico. Colores, bordes personalizados, gráficos y celdas combinadas no se reproducen.'),
            h('div', { class: 'panel' },
                h('h2', { text: 'Hojas a incluir', style: { fontSize: '1.05rem' } }),
                sheets.map(s => checkbox(`${s.name} (${s.rows.length} filas)`, s.selected, v => { s.selected = v; })),
            ),
        );
        return {
            options: h('div', {},
                h('h2', { text: 'Opciones' }),
                h('div', { class: 'field' }, h('span', { class: 'label', text: 'Orientación' }),
                    segmented('xl-orient', [{ value: 'auto', label: 'Automática' }, { value: 'vertical', label: 'Vertical' }, { value: 'horizontal', label: 'Horizontal' }], opts.orientation, v => { opts.orientation = v; })),
                checkbox('Ajustar todas las columnas al ancho de la página', opts.fitWidth, v => { opts.fitWidth = v; }),
                checkbox('Mostrar líneas de cuadrícula', opts.grid, v => { opts.grid = v; }),
            ),
            validate() {
                const chosen = sheets.filter(s => s.selected);
                if (!chosen.length) return new UserError('Elige al menos una hoja.');
                if (!chosen.some(s => s.rows.length)) return new UserError('Las hojas elegidas están vacías.');
                return null;
            },
            async run(progress) {
                const { PDFDocument, StandardFonts } = PDFLib;
                const pdf = await PDFDocument.create();
                const fonts = { regular: await pdf.embedFont(StandardFonts.Helvetica), bold: await pdf.embedFont(StandardFonts.HelveticaBold) };
                const chosen = sheets.filter(s => s.selected && s.rows.length);
                for (let i = 0; i < chosen.length; i++) {
                    await progress(i / chosen.length * 0.9, `Hoja "${chosen[i].name}"`);
                    drawSheet(pdf, fonts, chosen[i].name, chosen[i].rows, opts);
                }
                // Números de página
                const total = pdf.getPageCount();
                pdf.getPages().forEach((p, i) => {
                    const t = `${i + 1} / ${total}`;
                    p.drawText(t, { x: p.getWidth() - 36 - fonts.regular.widthOfTextAtSize(t, 8), y: 18, size: 8, font: fonts.regular });
                });
                return { blob: pdfBlob(await savePdf(pdf)), name: outName(file.name, '', 'pdf'), message: `PDF de ${total} página(s) creado a partir de ${chosen.length} hoja(s).` };
            },
        };
    },
};
