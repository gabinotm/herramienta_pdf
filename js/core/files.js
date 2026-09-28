// Validación de archivos por su contenido real (magic bytes), límites y nombres de salida.
import { CONFIG } from '../config.js';
import { Errors, UserError } from './errors.js';

export const KIND_LABEL = {
    pdf: 'PDF',
    image: 'de imagen (JPG, PNG, WEBP o GIF)',
    docx: 'de Word (.docx)',
    sheet: 'de Excel (.xlsx, .xls, .ods o .csv)',
    pptx: 'de PowerPoint (.pptx)',
};

export const KIND_ACCEPT = {
    pdf: '.pdf,application/pdf',
    image: '.jpg,.jpeg,.png,.webp,.gif,image/jpeg,image/png,image/webp,image/gif',
    docx: '.docx,.doc,.odt',
    sheet: '.xlsx,.xls,.ods,.csv',
    pptx: '.pptx,.ppt,.odp',
};

const startsWith = (bytes, sig, offset = 0) => sig.every((b, i) => bytes[offset + i] === b);

/**
 * Detecta el tipo real del archivo leyendo sus primeros bytes.
 * Devuelve: pdf | png | jpg | gif | webp | docx | xlsx | pptx | odt | ods | odp | zip | ole | csv | unknown
 */
export async function sniff(file) {
    const head = new Uint8Array(await file.slice(0, 1024).arrayBuffer());
    // %PDF- puede aparecer tras algunos bytes basura: la especificación permite buscarlo en el primer KB.
    const text = new TextDecoder('latin1').decode(head);
    if (text.includes('%PDF-')) return 'pdf';
    if (startsWith(head, [0x89, 0x50, 0x4e, 0x47])) return 'png';
    if (startsWith(head, [0xff, 0xd8, 0xff])) return 'jpg';
    if (startsWith(head, [0x47, 0x49, 0x46, 0x38])) return 'gif';
    if (startsWith(head, [0x52, 0x49, 0x46, 0x46]) && startsWith(head, [0x57, 0x45, 0x42, 0x50], 8)) return 'webp';
    if (startsWith(head, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) return 'ole'; // .doc/.xls/.ppt antiguos
    if (startsWith(head, [0x50, 0x4b, 0x03, 0x04])) return sniffZip(file);
    if (/\.csv$/i.test(file.name) && !head.includes(0)) return 'csv';
    return 'unknown';
}

async function sniffZip(file) {
    try {
        const zip = await JSZip.loadAsync(file);
        if (zip.file('word/document.xml')) return 'docx';
        if (zip.file('xl/workbook.xml')) return 'xlsx';
        if (zip.file('ppt/presentation.xml')) return 'pptx';
        const mime = zip.file('mimetype');
        if (mime) {
            const m = await mime.async('string');
            if (m.includes('opendocument.text')) return 'odt';
            if (m.includes('opendocument.spreadsheet')) return 'ods';
            if (m.includes('opendocument.presentation')) return 'odp';
        }
    } catch {
        /* ZIP dañado */
    }
    return 'zip';
}

/** Qué tipos detectados son aceptables para cada categoría. */
const KIND_MATCH = {
    pdf: ['pdf'],
    image: ['png', 'jpg', 'gif', 'webp'],
    docx: ['docx'],
    sheet: ['xlsx', 'ods', 'ole', 'csv'],
    pptx: ['pptx'],
};

/** Mensajes específicos para formatos parecidos pero no compatibles. */
function unsupportedMessage(file, kind, detected) {
    if (kind === 'docx' && (detected === 'ole' || detected === 'odt')) {
        return new UserError(`"${file.name}" está en formato ${detected === 'ole' ? '.doc (Word 97-2003)' : '.odt'}, que no se puede convertir en el navegador.`, {
            code: 'invalid_format',
            hint: 'Ábrelo en Word o LibreOffice y guárdalo como .docx, luego vuelve a intentarlo.',
        });
    }
    if (kind === 'pptx' && (detected === 'ole' || detected === 'odp')) {
        return new UserError(`"${file.name}" está en formato ${detected === 'ole' ? '.ppt (PowerPoint 97-2003)' : '.odp'}, que no se puede convertir en el navegador.`, {
            code: 'invalid_format',
            hint: 'Ábrelo en PowerPoint o LibreOffice y guárdalo como .pptx, luego vuelve a intentarlo.',
        });
    }
    return Errors.invalidFormat(file.name, KIND_LABEL[kind] || kind);
}

/**
 * Valida una lista de archivos contra el tipo esperado y los límites.
 * Devuelve [{ file, type }] o lanza UserError.
 */
export async function validateFiles(files, kind, { max = CONFIG.maxFiles, existing = 0 } = {}) {
    if (files.length + existing > max) throw Errors.tooMany(max);
    const out = [];
    for (const file of files) {
        if (file.size === 0) throw Errors.empty(file.name);
        if (file.size > CONFIG.maxFileMB * 1024 * 1024) throw Errors.tooBig(file.name, CONFIG.maxFileMB);
        const type = await sniff(file);
        if (!KIND_MATCH[kind].includes(type)) {
            // .ole solo es válido como hoja de cálculo si la extensión lo indica
            throw unsupportedMessage(file, kind, type);
        }
        if (kind === 'sheet' && type === 'ole' && !/\.xls$/i.test(file.name)) throw Errors.invalidFormat(file.name, KIND_LABEL.sheet);
        out.push({ file, type });
    }
    return out;
}

export function baseName(name) {
    return (name || 'documento').replace(/\.[^.]+$/, '').replace(/[\\/:*?"<>|]+/g, '_').trim() || 'documento';
}

/** documento.pdf + "comprimido" → documento_comprimido.pdf */
export function outName(name, suffix, ext = 'pdf') {
    return `${baseName(name)}${suffix ? `_${suffix}` : ''}.${ext}`;
}

export async function readBytes(file) {
    return new Uint8Array(await file.arrayBuffer());
}

export function pdfBlob(bytes) {
    return new Blob([bytes], { type: 'application/pdf' });
}
