import { test, expect } from '@playwright/test';
import JSZip from 'jszip';
import * as XLSX from 'xlsx';
import { openTool, process, download, loadPdf, expectError } from './helpers.js';

/** Extrae el texto de un PDF usando el pdf.js de la propia aplicación. */
export const pdfText = async (page, bytes) => page.evaluate(async b64 => {
    const lib = await import('/vendor/pdfjs/pdf.min.js');
    lib.GlobalWorkerOptions.workerSrc = '/vendor/pdfjs/pdf.worker.min.js';
    const data = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
    const doc = await lib.getDocument({ data }).promise;
    let text = '';
    for (let i = 1; i <= doc.numPages; i++) text += (await (await doc.getPage(i)).getTextContent()).items.map(i => i.str).join(' ') + '\n';
    return text;
}, Buffer.from(bytes).toString('base64'));

test.describe('Convertir desde PDF', () => {
    test('PDF a Word: texto editable con acentos', async ({ page }) => {
        await openTool(page, 'pdf-a-word', 'normal.pdf');
        await process(page, 'Convertir a Word');
        const { name, bytes } = await download(page);
        expect(name).toBe('normal.docx');
        const zip = await JSZip.loadAsync(bytes);
        const xml = await zip.file('word/document.xml').async('string');
        expect(xml).toContain('canción, pingüino, niño');
        expect(xml).toContain('<w:b/>'); // título en negrita
        expect((xml.match(/w:type="page"/g) || []).length).toBe(2);
    });

    test('PDF a Word: escaneado exige OCR en modo editable, permite modo imagen', async ({ page }) => {
        await openTool(page, 'pdf-a-word', 'escaneado.pdf');
        await expect(page.locator('.config-main')).toContainText('parece escaneado');
        await process(page);
        const zip = await JSZip.loadAsync((await download(page)).bytes);
        expect(Object.keys(zip.files).some(f => f.startsWith('word/media/'))).toBeTruthy();
    });

    test('PDF a Excel: detecta la tabla y convierte números', async ({ page }) => {
        await openTool(page, 'pdf-a-excel', 'normal.pdf');
        await process(page, 'Convertir a Excel');
        const { name, bytes } = await download(page);
        expect(name).toBe('normal.xlsx');
        const wb = XLSX.read(bytes);
        expect(wb.SheetNames).toHaveLength(3);
        const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1 });
        const header = rows.findIndex(r => r.includes('Producto'));
        expect(rows[header]).toEqual(['Producto', 'Cantidad', 'Precio']);
        expect(rows[header + 1]).toEqual(['Manzanas', 10, 2.5]);
    });

    test('PDF a PowerPoint: una diapositiva por página', async ({ page }) => {
        await openTool(page, 'pdf-a-powerpoint', 'normal.pdf');
        await process(page, 'Convertir a PowerPoint');
        const { name, bytes } = await download(page);
        expect(name).toBe('normal.pptx');
        const zip = await JSZip.loadAsync(bytes);
        expect(Object.keys(zip.files).filter(f => /^ppt\/slides\/slide\d+\.xml$/.test(f))).toHaveLength(3);
    });

    test('PDF a JPG: ZIP con una imagen por página', async ({ page }) => {
        await openTool(page, 'pdf-a-imagen', 'normal.pdf');
        await process(page, 'Convertir a imagen');
        const { name, bytes } = await download(page);
        expect(name).toBe('normal_imagenes.zip');
        const zip = await JSZip.loadAsync(bytes);
        const files = Object.keys(zip.files).sort();
        expect(files).toEqual(['normal_pagina_1.jpg', 'normal_pagina_2.jpg', 'normal_pagina_3.jpg']);
        const jpg = await zip.file(files[0]).async('uint8array');
        expect([jpg[0], jpg[1]]).toEqual([0xff, 0xd8]);
    });

    test('PDF a PNG: extraer imágenes incrustadas', async ({ page }) => {
        await openTool(page, 'pdf-a-imagen', 'escaneado.pdf');
        await page.locator('label.option', { hasText: 'Extraer imágenes' }).click();
        await page.locator('.segmented label', { hasText: 'PNG' }).click();
        await process(page);
        const { name, bytes } = await download(page);
        expect(name).toBe('escaneado_imagen_1.png');
        expect([...bytes.subarray(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
    });
});

test.describe('Convertir a PDF', () => {
    test('JPG y PNG a PDF en A4 @movil', async ({ page }) => {
        await openTool(page, 'imagen-a-pdf', ['foto.jpg', 'logo.png']);
        await expect(page.locator('.file-card')).toHaveCount(2);
        await process(page, 'Convertir a PDF');
        const { name, bytes } = await download(page);
        expect(name).toBe('foto_imagenes.pdf');
        const doc = await loadPdf(bytes);
        expect(doc.getPageCount()).toBe(2);
        const { width, height } = doc.getPage(0).getSize();
        expect(Math.round(width)).toBe(842); // foto horizontal → A4 apaisado
        expect(Math.round(height)).toBe(595);
    });

    test('imagen a PDF: ajustar a la imagen', async ({ page }) => {
        await openTool(page, 'imagen-a-pdf', 'logo.png');
        await page.locator('.segmented label', { hasText: 'Ajustar a la imagen' }).click();
        await page.locator('.segmented label', { hasText: 'Sin margen' }).click();
        await process(page);
        const doc = await loadPdf((await download(page)).bytes);
        expect(doc.getPage(0).getSize()).toEqual({ width: 300, height: 300 });
    });

    test('Word a PDF: varias páginas y texto buscable', async ({ page }) => {
        await openTool(page, 'word-a-pdf', 'documento.docx');
        await process(page, 'Convertir a PDF');
        const { name, bytes } = await download(page);
        expect(name).toBe('documento.pdf');
        const doc = await loadPdf(bytes);
        expect(doc.getPageCount()).toBeGreaterThanOrEqual(2);
        const text = await pdfText(page, bytes);
        expect(text).toContain('Documento Word de prueba');
        expect(text).toContain('canción');
    });

    test('Word a PDF: formato .doc antiguo muestra un error claro', async ({ page }) => {
        await openTool(page, 'word-a-pdf', 'antiguo.doc');
        await expectError(page, 'Word 97-2003');
    });

    test('Excel a PDF: todas las hojas con texto seleccionable', async ({ page }) => {
        await openTool(page, 'excel-a-pdf', 'hoja.xlsx');
        await expect(page.locator('.config-main')).toContainText('Ventas (5 filas)');
        await process(page, 'Convertir a PDF');
        const { name, bytes } = await download(page);
        expect(name).toBe('hoja.pdf');
        const text = await pdfText(page, bytes);
        expect(text).toContain('Manzanas');
        expect(text).toContain('Plátanos');
        expect(text).toContain('José');
    });

    test('Excel a PDF: acepta .ods', async ({ page }) => {
        await openTool(page, 'excel-a-pdf', 'hoja.ods');
        await process(page);
        expect((await loadPdf((await download(page)).bytes)).getPageCount()).toBe(2);
    });

    test('PowerPoint a PDF: una página por diapositiva con texto', async ({ page }) => {
        await openTool(page, 'powerpoint-a-pdf', 'presentacion.pptx');
        await process(page, 'Convertir a PDF');
        const { name, bytes } = await download(page);
        expect(name).toBe('presentacion.pdf');
        const doc = await loadPdf(bytes);
        expect(doc.getPageCount()).toBe(2);
        const { width, height } = doc.getPage(0).getSize();
        expect(Math.round(width)).toBe(720);
        expect(Math.round(height)).toBe(405);
        const text = await pdfText(page, bytes);
        expect(text).toContain('Presentación de prueba');
        expect(text).toContain('Punto uno');
    });
});
