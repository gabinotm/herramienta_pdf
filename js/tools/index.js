// Registro de herramientas y categorías.
import unir from './unir.js';
import dividir from './dividir.js';
import extraer from './extraer.js';
import eliminar from './eliminar.js';
import organizar from './organizar.js';
import rotar from './rotar.js';
import comprimir from './comprimir.js';
import reparar from './reparar.js';
import ocr from './ocr.js';
import proteger from './proteger.js';
import desbloquear from './desbloquear.js';
import aplanar from './aplanar.js';
import pdfWord from './pdf-word.js';
import pdfExcel from './pdf-excel.js';
import pdfPpt from './pdf-ppt.js';
import pdfImagen from './pdf-imagen.js';
import imagenPdf from './imagen-pdf.js';
import wordPdf from './word-pdf.js';
import excelPdf from './excel-pdf.js';
import pptPdf from './ppt-pdf.js';
import marcaAgua from './marca-agua.js';
import numerar from './numerar.js';
import formularios from './formularios.js';
import recortar from './recortar.js';
import comparar from './comparar.js';
import { editar, firmar } from './editar.js';

export const CATEGORIES = {
    organizar: { title: 'Organizar PDF', short: 'Organizar', color: 'var(--cat-organizar)' },
    optimizar: { title: 'Optimizar PDF', short: 'Optimizar', color: 'var(--cat-optimizar)' },
    desde: { title: 'Convertir desde PDF', short: 'Desde PDF', color: 'var(--cat-desde)' },
    hacia: { title: 'Convertir a PDF', short: 'A PDF', color: 'var(--cat-hacia)' },
    editar: { title: 'Editar y firmar', short: 'Editar', color: 'var(--cat-editar)' },
    seguridad: { title: 'Seguridad', short: 'Seguridad', color: 'var(--cat-seguridad)' },
};

export const TOOLS = [
    unir, dividir, extraer, eliminar, organizar, rotar,
    comprimir, reparar, ocr,
    pdfWord, pdfExcel, pdfPpt, pdfImagen,
    wordPdf, excelPdf, pptPdf, imagenPdf,
    editar, firmar, formularios, marcaAgua, numerar, recortar, aplanar, comparar,
    proteger, desbloquear,
];
