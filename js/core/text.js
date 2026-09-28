// Texto en PDF con las fuentes estándar (codificación WinAnsi) y capa de texto invisible.

const WINANSI_EXTRA = '€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ';

/** ¿La fuente estándar puede codificar este carácter? */
export function isWinAnsi(ch) {
    const c = ch.codePointAt(0);
    return (c >= 0x20 && c <= 0x7e) || (c >= 0xa0 && c <= 0xff) || WINANSI_EXTRA.includes(ch);
}

/** Reemplaza los caracteres no representables por equivalentes o "?". */
export function toWinAnsi(text) {
    let out = '';
    for (const ch of String(text).normalize('NFC')) {
        if (isWinAnsi(ch)) out += ch;
        else if (ch === '\t') out += '    ';
        else if (/\s/.test(ch)) out += ' ';
        else if (/[‐-―]/.test(ch)) out += '-';
        else out += '?';
    }
    return out;
}

export function canEncode(text) {
    return [...String(text).normalize('NFC')].every(isWinAnsi);
}

/**
 * Operadores para una capa de texto invisible (seleccionable y buscable) sobre una página.
 * words: [{ text, x0, y0, x1, y1, baseline? }] en píxeles del viewport; map: displayMapper(viewport).
 */
export function invisibleTextOps(font, fontKey, words, map) {
    const { beginText, endText, setFontAndSize, setTextRenderingMode, TextRenderingMode, rotateAndSkewTextDegreesAndTranslate, showText, PDFOperator, PDFNumber } = PDFLib;
    const ops = [];
    for (const w of words) {
        const text = toWinAnsi(w.text.trim());
        if (!text.replace(/\?/g, '')) continue;
        const height = w.y1 - w.y0;
        if (height <= 0 || w.x1 <= w.x0) continue;
        const baseY = w.baseline ?? w.y1 - height * 0.2;
        const [px, py] = map.toPdf(w.x0, baseY);
        const size = Math.max(1, height * map.unit * 0.85);
        const natural = font.widthOfTextAtSize(text, size);
        const wanted = (w.x1 - w.x0) * map.unit;
        const hscale = natural > 0 ? Math.min(400, Math.max(10, (wanted / natural) * 100)) : 100;
        ops.push(
            beginText(),
            setFontAndSize(fontKey, size),
            setTextRenderingMode(TextRenderingMode.Invisible),
            PDFOperator.of('Tz', [PDFNumber.of(hscale)]),
            rotateAndSkewTextDegreesAndTranslate(map.angle, 0, 0, px, py),
            showText(font.encodeText(text)),
            endText(),
        );
    }
    return ops;
}

/** Añade palabras invisibles a una página de pdf-lib. Devuelve cuántas se añadieron. */
export function addInvisibleText(pdfPage, font, words, map) {
    if (!words.length) return 0;
    const fontKey = pdfPage.node.newFontDictionary(font.name, font.ref);
    const ops = invisibleTextOps(font, fontKey, words, map);
    if (ops.length) pdfPage.pushOperators(PDFLib.pushGraphicsState(), ...ops, PDFLib.popGraphicsState());
    return ops.length / 7;
}

/** Mapeo simple para páginas nuevas sin rotación: 1 px = `unit` pt, origen arriba a la izquierda. */
export function simpleMapper(pageHeightPt, unit) {
    return { toPdf: (x, y) => [x * unit, pageHeightPt - y * unit], angle: 0, unit };
}
