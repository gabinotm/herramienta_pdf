import { test, expect } from '@playwright/test';
import { openTool, process, download, loadPdf, expectError } from './helpers.js';

const pdfText = async (page, bytes) => page.evaluate(async b64 => {
    const lib = await import('/vendor/pdfjs/pdf.min.js');
    lib.GlobalWorkerOptions.workerSrc = '/vendor/pdfjs/pdf.worker.min.js';
    const data = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
    const doc = await lib.getDocument({ data }).promise;
    let text = '';
    for (let i = 1; i <= doc.numPages; i++) text += (await (await doc.getPage(i)).getTextContent()).items.map(i => i.str).join(' ') + '\n';
    return text;
}, Buffer.from(bytes).toString('base64'));

test.describe('Optimizar y seguridad', () => {
    test('comprimir: PDF con imagen se reduce y muestra estadísticas', async ({ page }) => {
        await openTool(page, 'comprimir-pdf', 'escaneado.pdf');
        await page.locator('label.option', { hasText: 'Máximo' }).click();
        await process(page, 'Comprimir PDF');
        await expect(page.locator('.stats-row')).toContainText('Peso original');
        const { name, bytes } = await download(page);
        expect(name).toBe('escaneado_comprimido.pdf');
        expect(bytes.length).toBeLessThan(62741);
        expect((await loadPdf(bytes)).getPageCount()).toBe(1);
    });

    test('comprimir: si no se puede reducir devuelve el original y avisa', async ({ page }) => {
        await openTool(page, 'comprimir-pdf', 'formulario.pdf');
        await process(page);
        const { bytes } = await download(page);
        expect((await loadPdf(bytes)).getPageCount()).toBe(1);
        // O bien se redujo, o bien se avisa de que se devolvió el original.
        const text = await page.locator('.result').innerText();
        expect(/Reducido|ya está optimizado/.test(text)).toBeTruthy();
    });

    test('reparar: recupera un PDF con tabla xref dañada', async ({ page }) => {
        await openTool(page, 'reparar-pdf', 'danado.pdf');
        await process(page, 'Reparar PDF');
        const { name, bytes } = await download(page);
        expect(name).toBe('danado_reparado.pdf');
        expect((await loadPdf(bytes)).getPageCount()).toBe(3);
    });

    test('proteger: cifra con AES-256 y pide contraseña @movil', async ({ page }) => {
        await openTool(page, 'proteger-pdf', 'normal.pdf');
        await page.getByLabel('Contraseña para abrir el PDF').fill('clave-segura');
        await page.getByLabel('Repite la contraseña').fill('clave-segura');
        await process(page, 'Proteger PDF');
        const { name, bytes } = await download(page);
        expect(name).toBe('normal_protegido.pdf');
        expect(Buffer.from(bytes).toString('latin1')).toContain('/AESV3');
        await expect(loadPdf(bytes)).rejects.toThrow(/encrypted/);
    });

    test('proteger: contraseñas distintas muestran error', async ({ page }) => {
        await openTool(page, 'proteger-pdf', 'normal.pdf');
        await page.getByLabel('Contraseña para abrir el PDF').fill('uno1');
        await page.getByLabel('Repite la contraseña').fill('dos2');
        await page.locator('.config-layout button.btn-primary.btn-lg').click();
        await expectError(page, 'no coinciden');
    });

    test('desbloquear: contraseña incorrecta y luego correcta', async ({ page }) => {
        await openTool(page, 'desbloquear-pdf', 'protegido.pdf');
        await page.getByLabel('Contraseña del PDF').fill('mala');
        await page.locator('.config-layout button.btn-primary.btn-lg').click();
        await expectError(page, 'contraseña es incorrecta');
        await page.getByLabel('Contraseña del PDF').fill('1234');
        await process(page);
        const { bytes } = await download(page);
        expect((await loadPdf(bytes)).getPageCount()).toBe(3);
    });

    test('desbloquear: avisa si el PDF no está protegido', async ({ page }) => {
        await openTool(page, 'desbloquear-pdf', 'normal.pdf');
        await expectError(page, 'no está protegido');
    });

    test('aplanar: elimina los campos de formulario', async ({ page }) => {
        await openTool(page, 'aplanar-pdf', 'formulario.pdf');
        await process(page, 'Aplanar PDF');
        const doc = await loadPdf((await download(page)).bytes);
        expect(doc.getForm().getFields()).toHaveLength(0);
    });

    test('ocr: el texto del escaneo se vuelve extraíble', async ({ page }) => {
        test.setTimeout(240_000);
        await openTool(page, 'ocr-pdf', 'escaneado.pdf');
        await page.locator('.segmented label', { hasText: 'Español' }).click();
        await process(page, 'Aplicar OCR');
        const { name, bytes } = await download(page);
        expect(name).toBe('escaneado_ocr.pdf');
        const text = await pdfText(page, bytes);
        expect(text.toUpperCase()).toContain('ESCANEADO');
        expect(text).toMatch(/marzo/i);
    });
});
