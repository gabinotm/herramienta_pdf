// Interpretación de rangos de páginas como "1-3,5,8-10".
import { UserError } from './errors.js';

/**
 * Devuelve una lista de grupos [[0,1,2],[4],[7,8,9]] con índices base 0.
 * Acepta "5-" (hasta el final) y "-3" (desde el inicio). Lanza UserError si el texto no es válido.
 */
export function parseRangeGroups(text, pageCount) {
    const clean = String(text || '').replace(/\s+/g, '');
    if (!clean) throw new UserError('Escribe al menos una página o un rango, por ejemplo: 1-3,5,8-10');
    const groups = [];
    for (const part of clean.split(/[,;]/)) {
        if (!part) continue;
        const m = part.match(/^(\d*)(?:-(\d*))?$/);
        if (!m || (m[1] === '' && (m[2] === undefined || m[2] === ''))) {
            throw new UserError(`"${part}" no es un rango válido. Usa números y guiones, por ejemplo: 1-3,5`);
        }
        const isRange = m[2] !== undefined;
        const start = m[1] === '' ? 1 : Number(m[1]);
        const end = isRange ? (m[2] === '' ? pageCount : Number(m[2])) : start;
        if (start < 1 || end < 1 || start > pageCount || end > pageCount) {
            throw new UserError(`El rango "${part}" está fuera del documento, que tiene ${pageCount} página${pageCount === 1 ? '' : 's'}.`);
        }
        if (start > end) throw new UserError(`En "${part}" el inicio es mayor que el final.`);
        const group = [];
        for (let p = start; p <= end; p++) group.push(p - 1);
        groups.push(group);
    }
    if (!groups.length) throw new UserError('No se indicó ninguna página.');
    return groups;
}

/** Igual que parseRangeGroups pero devuelve un conjunto de páginas únicas ordenadas. */
export function parsePageSet(text, pageCount) {
    const set = new Set(parseRangeGroups(text, pageCount).flat());
    return [...set].sort((a, b) => a - b);
}

/** [0,1,2,4,7,8,9] → "1-3,5,8-10" */
export function formatPageSet(indices) {
    const sorted = [...new Set(indices)].sort((a, b) => a - b);
    const parts = [];
    let i = 0;
    while (i < sorted.length) {
        let j = i;
        while (j + 1 < sorted.length && sorted[j + 1] === sorted[j] + 1) j++;
        parts.push(i === j ? `${sorted[i] + 1}` : `${sorted[i] + 1}-${sorted[j] + 1}`);
        i = j + 1;
    }
    return parts.join(',');
}
