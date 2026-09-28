import { test, expect } from '@playwright/test';
import { openTool, process, download, loadPdf, expectError } from './helpers.js';

/** Texto de cada página con su posición en pantalla (viewport) y dirección. */
const pdfTextItems = async (page, bytes) => page.evaluate(async b64 => {
    const lib = await import('/vendor/pdfjs/pdf.min.js');
    lib.GlobalWorkerOptions.workerSrc = '/vendor/pdfjs/pdf.worker.min.js';
    const data = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
    const doc = await lib.getDocument({ data }).promise;
    const pages = [];
    for (let i = 1; i <= doc.numPages; i++) {
        const p = await doc.getPage(i);
        const vp = p.getViewport({ scale: 1 });
        const items = (await p.getTextContent()).items.map(it => {
            const m = lib.Util.transform(vp.transform, it.transform);
            return { str: it.str, x: m[4] / vp.width, y: m[5] / vp.height, dx: m[0], dy: m[1] };
        });
        const annots = (await p.getAnnotations()).map(a => ({ subtype: a.subtype, contents: a.contentsObj?.str }));
        pages.push({ items, annots, w: vp.width, h: vp.height });
    }
    return pages;
}, Buffer.from(bytes).toString('base64'));

test.describe('Editar y firmar', () => {
    test('marca de agua de texto en todas las páginas', async ({ page }) => {
        await openTool(page, 'marca-de-agua', 'normal.pdf');
        await expect(page.locator('.preview-box canvas')).toBeVisible();
        await page.getByRole('textbox', { name: 'Texto' }).fill('BORRADOR');
        await process(page, 'Añadir marca de agua');
        const { name, bytes } = await download(page);
        expect(name).toBe('normal_marca_agua.pdf');
        const pages = await pdfTextItems(page, bytes);
        expect(pages.every(p => p.items.some(i => i.str.includes('BORRADOR')))).toBeTruthy();
    });

    test('marca de agua: en páginas giradas queda arriba y horizontal', async ({ page }) => {
        await openTool(page, 'marca-de-agua', 'rotado.pdf');
        await page.getByRole('textbox', { name: 'Texto' }).fill('ARRIBA');
        await page.locator('.segmented label', { hasText: '0°' }).first().click();
        await page.getByLabel('Arriba al centro').check({ force: true });
        await process(page);
        const pages = await pdfTextItems(page, (await download(page)).bytes);
        for (const p of pages) {
            const it = p.items.find(i => i.str === 'ARRIBA');
            expect(it).toBeTruthy();
            expect(it.y).toBeLessThan(0.15); // cerca del borde superior visible
            expect(it.x).toBeGreaterThan(0.3);
            expect(it.x).toBeLessThan(0.6);
            expect(it.dx).toBeGreaterThan(0); // escrito de izquierda a derecha
            expect(Math.abs(it.dy)).toBeLessThan(0.01);
        }
    });

    test('numerar páginas "Página 1 de N" desde la página 2 @movil', async ({ page }) => {
        await openTool(page, 'numerar-paginas', 'normal.pdf');
        await page.getByLabel('Desde la página').fill('2');
        await process(page, 'Numerar páginas');
        const pages = await pdfTextItems(page, (await download(page)).bytes);
        expect(pages[0].items.some(i => /Página \d de/.test(i.str))).toBeFalsy();
        const label = pages[1].items.find(i => i.str.startsWith('Página 1 de 2'));
        expect(label).toBeTruthy();
        expect(label.y).toBeGreaterThan(0.9); // abajo
        expect(pages[2].items.some(i => i.str === 'Página 2 de 2')).toBeTruthy();
    });

    test('rellenar formulario y aplanar', async ({ page }) => {
        await openTool(page, 'rellenar-formulario', 'formulario.pdf');
        await page.getByLabel(/^nombre/).fill('María Pérez');
        await page.getByLabel(/^acepto/).check();
        await page.getByLabel(/^pais/).selectOption('Chile');
        await page.getByText('Tarde', { exact: true }).click();
        await process(page, 'Guardar formulario');
        const doc = await loadPdf((await download(page)).bytes);
        const form = doc.getForm();
        expect(form.getTextField('nombre').getText()).toBe('María Pérez');
        expect(form.getCheckBox('acepto').isChecked()).toBeTruthy();
        expect(form.getDropdown('pais').getSelected()).toEqual(['Chile']);
        expect(form.getRadioGroup('turno').getSelected()).toBe('Tarde');
    });

    test('rellenar formulario: aplanado deja el texto fijo', async ({ page }) => {
        await openTool(page, 'rellenar-formulario', 'formulario.pdf');
        await page.getByLabel(/^nombre/).fill('Ana');
        await page.getByText(/Aplanar el formulario/).click();
        await process(page);
        const bytes = (await download(page)).bytes;
        expect((await loadPdf(bytes)).getForm().getFields()).toHaveLength(0);
        const pages = await pdfTextItems(page, bytes);
        expect(pages[0].items.some(i => i.str.includes('Ana'))).toBeTruthy();
    });

    test('rellenar formulario: PDF sin campos muestra aviso', async ({ page }) => {
        await openTool(page, 'rellenar-formulario', 'normal.pdf');
        await expectError(page, 'no tiene campos de formulario');
    });

    test('recortar: aplica CropBox a todas las páginas', async ({ page }) => {
        await openTool(page, 'recortar-pdf', 'normal.pdf');
        await expect(page.locator('.crop-rect')).toBeVisible();
        await process(page, 'Recortar PDF');
        const doc = await loadPdf((await download(page)).bytes);
        for (const p of doc.getPages()) {
            const box = p.getCropBox();
            expect(Math.round(box.width)).toBe(Math.round(595 * 0.8));
            expect(Math.round(box.height)).toBe(Math.round(842 * 0.8));
        }
    });

    test('comparar: detecta palabras añadidas y eliminadas', async ({ page }) => {
        await openTool(page, 'comparar-pdf', ['normal.pdf', 'segundo.pdf']);
        await process(page, 'Comparar');
        await expect(page.locator('.diff-view ins').first()).toBeVisible();
        await expect(page.locator('.diff-view del').first()).toBeVisible();
        const { name, bytes } = await download(page);
        expect(name).toBe('comparacion_normal_segundo.html');
        expect(bytes.toString()).toContain('<ins>');
    });

    test('comparar: con un solo archivo pide el segundo', async ({ page }) => {
        await openTool(page, 'comparar-pdf', 'normal.pdf');
        await expect(page.getByRole('button', { name: 'Añadir la nueva versión' })).toBeVisible();
        await expect(page.locator('.config-layout button.btn-primary.btn-lg:visible')).toBeDisabled();
    });

    test('editar: texto vectorial, rectángulo, comentario y deshacer', async ({ page }) => {
        await openTool(page, 'editar-pdf', 'normal.pdf');
        const canvas = page.locator('.editor-stage .upper-canvas');
        await expect(canvas).toBeVisible();
        const box = await canvas.boundingBox();
        // Texto
        await page.getByRole('button', { name: 'Texto', exact: true }).click();
        await canvas.click({ position: { x: box.width * 0.1, y: box.height * 0.5 } });
        await page.keyboard.type('Hola editado');
        await canvas.click({ position: { x: box.width * 0.9, y: box.height * 0.95 } });
        // Rectángulo arrastrando (en la zona visible de la página)
        await page.getByRole('button', { name: 'Rectángulo' }).click();
        await canvas.evaluate(el => el.scrollIntoView({ block: 'center' }));
        const vis = await canvas.boundingBox();
        const cy = Math.max(vis.y, 0) + 300;
        await page.mouse.move(vis.x + vis.width * 0.5, cy);
        await page.mouse.down();
        await page.mouse.move(vis.x + vis.width * 0.7, cy + 80, { steps: 5 });
        await page.mouse.up();
        await expect(page.getByRole('button', { name: /Deshacer/ })).toBeEnabled();
        // Elipse que luego se deshace
        await page.getByRole('button', { name: 'Elipse' }).click();
        await canvas.click({ position: { x: box.width * 0.3, y: box.height * 0.8 } });
        await page.getByRole('button', { name: /Deshacer/ }).click();
        // Comentario
        await page.getByRole('button', { name: 'Comentario' }).click();
        await canvas.click({ position: { x: box.width * 0.8, y: box.height * 0.2 } });
        await page.getByPlaceholder('Escribe tu comentario…').fill('Revisar esta parte');
        await process(page, 'Guardar PDF');
        const { name, bytes } = await download(page);
        expect(name).toBe('normal_editado.pdf');
        const [p1] = await pdfTextItems(page, bytes);
        const t = p1.items.find(i => i.str.includes('Hola editado'));
        expect(t).toBeTruthy();
        expect(t.y).toBeGreaterThan(0.45);
        expect(t.y).toBeLessThan(0.6);
        expect(p1.annots).toContainEqual({ subtype: 'Text', contents: 'Revisar esta parte' });
        // El rectángulo se incrusta como imagen; la elipse deshecha no.
        const doc = await loadPdf(bytes);
        const xobjs = doc.getPage(0).node.Resources().lookup(doc.getPage(0).node.Resources().keys().find(k => k.asString() === '/XObject'));
        expect(xobjs.keys()).toHaveLength(1);
    });

    test('editar: sin cambios no permite guardar', async ({ page }) => {
        await openTool(page, 'editar-pdf', 'normal.pdf');
        await expect(page.locator('.editor-stage .upper-canvas')).toBeVisible();
        await expect(page.locator('.config-main > div > button.btn-primary')).toBeDisabled();
    });

    test('firmar: firma escrita + fecha en página girada @movil', async ({ page }) => {
        await openTool(page, 'firmar-pdf', 'rotado.pdf');
        await expect(page.locator('.editor-stage .upper-canvas')).toBeVisible();
        await page.getByRole('button', { name: 'Firma', exact: true }).click();
        await page.getByRole('tab', { name: 'Escribir' }).click();
        await page.getByLabel('Nombre').fill('Juan Pérez');
        await page.getByRole('button', { name: 'Usar firma' }).click();
        await expect(page.locator('.modal')).toHaveCount(0);
        await page.getByRole('button', { name: 'Fecha' }).click();
        await process(page, 'Guardar PDF firmado');
        const { name, bytes } = await download(page);
        expect(name).toBe('rotado_firmado.pdf');
        const [p1] = await pdfTextItems(page, bytes);
        const date = p1.items.find(i => /^\d{2}\/\d{2}\/\d{4}$/.test(i.str));
        expect(date).toBeTruthy();
        expect(date.dx).toBeGreaterThan(0); // horizontal aunque la página esté girada
        expect(Math.abs(date.dy)).toBeLessThan(0.01);
        const doc = await loadPdf(bytes);
        expect(Buffer.from(bytes).toString('latin1')).toMatch(/\/Subtype\s*\/Image/);
        expect(doc.getPageCount()).toBe(2);
    });

    test('firmar: firma dibujada', async ({ page }) => {
        await openTool(page, 'firmar-pdf', 'normal.pdf');
        await expect(page.locator('.editor-stage .upper-canvas')).toBeVisible();
        await page.getByRole('button', { name: 'Firma', exact: true }).click();
        const pad = page.locator('.sign-pad');
        const b = await pad.boundingBox();
        await page.mouse.move(b.x + 30, b.y + 100);
        await page.mouse.down();
        for (let i = 0; i < 20; i++) await page.mouse.move(b.x + 30 + i * 15, b.y + 100 + Math.sin(i) * 30);
        await page.mouse.up();
        await page.getByRole('button', { name: 'Usar firma' }).click();
        await process(page);
        const bytes = (await download(page)).bytes;
        expect(Buffer.from(bytes).toString('latin1')).toMatch(/\/Subtype\s*\/Image/);
    });
});
