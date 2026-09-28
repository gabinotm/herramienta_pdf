import { test, expect } from '@playwright/test';
import JSZip from 'jszip';
import { openTool, process, download, loadPdf, expectError } from './helpers.js';

test.describe('Organizar', () => {
    test('inicio: muestra herramientas y el buscador filtra @movil', async ({ page }) => {
        await page.goto('/');
        await expect(page.locator('.tool-card').first()).toBeVisible();
        await page.getByLabel('Buscar herramienta').fill('unir');
        await expect(page.locator('.tool-card')).toHaveCount(1);
        await expect(page.locator('.tool-card')).toContainText('Unir PDF');
    });

    test('unir: combina 2 PDF en orden @movil', async ({ page }) => {
        await openTool(page, 'unir-pdf', ['normal.pdf', 'segundo.pdf']);
        await expect(page.locator('.file-card')).toHaveCount(2);
        await process(page, 'Unir PDF');
        const { name, bytes } = await download(page);
        expect(name).toBe('normal_unido.pdf');
        const doc = await loadPdf(bytes);
        expect(doc.getPageCount()).toBe(5);
    });

    test('unir: con un solo archivo el botón queda deshabilitado', async ({ page }) => {
        await openTool(page, 'unir-pdf', ['normal.pdf']);
        await expect(page.locator('.config-layout button.btn-primary.btn-lg:visible')).toBeDisabled();
    });

    test('dividir: por rangos genera ZIP con nombres descriptivos', async ({ page }) => {
        await openTool(page, 'dividir-pdf', 'normal.pdf');
        await page.getByLabel('Rangos de páginas').fill('1,2-3');
        await process(page, 'Dividir PDF');
        const { name, bytes } = await download(page);
        expect(name).toBe('normal_dividido.zip');
        const zip = await JSZip.loadAsync(bytes);
        const names = Object.keys(zip.files).sort();
        expect(names).toEqual(['normal_paginas_1.pdf', 'normal_paginas_2-3.pdf']);
        const second = await loadPdf(await zip.file('normal_paginas_2-3.pdf').async('uint8array'));
        expect(second.getPageCount()).toBe(2);
    });

    test('dividir: rango inválido muestra error y deshabilita', async ({ page }) => {
        await openTool(page, 'dividir-pdf', 'normal.pdf');
        await page.getByLabel('Rangos de páginas').fill('2-9');
        await expect(page.locator('.config-side')).toContainText('fuera del documento');
        await expect(page.locator('.config-layout button.btn-primary.btn-lg:visible')).toBeDisabled();
    });

    test('dividir: cada N páginas', async ({ page }) => {
        await openTool(page, 'dividir-pdf', 'muchas-paginas.pdf');
        await page.locator('label.option', { hasText: 'Cada N páginas' }).click();
        await page.getByLabel('Separar cada N páginas').fill('50');
        await process(page);
        const { bytes } = await download(page);
        const zip = await JSZip.loadAsync(bytes);
        expect(Object.keys(zip.files)).toHaveLength(3);
    });

    test('extraer: selección por rango', async ({ page }) => {
        await openTool(page, 'extraer-paginas', 'normal.pdf');
        await page.getByLabel('Páginas a extraer').fill('1,3');
        await expect(page.locator('.page-card.selected')).toHaveCount(2);
        await process(page);
        const { name, bytes } = await download(page);
        expect(name).toBe('normal_paginas_1,3.pdf');
        expect((await loadPdf(bytes)).getPageCount()).toBe(2);
    });

    test('eliminar: clic en miniaturas @movil', async ({ page }) => {
        await openTool(page, 'eliminar-paginas', 'normal.pdf');
        await page.locator('.page-card').nth(1).click();
        await expect(page.getByLabel('Páginas a eliminar')).toHaveValue('2');
        await process(page);
        const { bytes } = await download(page);
        expect((await loadPdf(bytes)).getPageCount()).toBe(2);
    });

    test('organizar: eliminar y rotar una página', async ({ page }) => {
        await openTool(page, 'organizar-pdf', 'normal.pdf');
        await expect(page.locator('.page-card')).toHaveCount(3);
        await page.getByLabel('Eliminar página 1').click();
        await page.getByLabel('Rotar a la derecha página 3').click();
        await process(page);
        const doc = await loadPdf((await download(page)).bytes);
        expect(doc.getPageCount()).toBe(2);
        expect(doc.getPage(1).getRotation().angle).toBe(90);
    });

    test('rotar: todas 180°', async ({ page }) => {
        await openTool(page, 'rotar-pdf', 'normal.pdf');
        await page.getByRole('button', { name: 'Girar 180°' }).click();
        await process(page);
        const doc = await loadPdf((await download(page)).bytes);
        expect(doc.getPages().map(p => p.getRotation().angle)).toEqual([180, 180, 180]);
    });

    test('errores: archivo vacío, falso y protegido', async ({ page }) => {
        await openTool(page, 'rotar-pdf', 'vacio.pdf');
        await expectError(page, 'está vacío');
        await page.locator('input[type=file]').first().setInputFiles('tests/fixtures/falso.pdf');
        await expectError(page, 'no es un archivo PDF válido');
        await page.locator('input[type=file]').first().setInputFiles('tests/fixtures/protegido.pdf');
        await expectError(page, 'protegido con contraseña');
    });

    test('continuar con otra herramienta pasa el archivo', async ({ page }) => {
        await openTool(page, 'rotar-pdf', 'normal.pdf');
        await page.getByRole('button', { name: 'Girar 180°' }).click();
        await process(page);
        await expect(page.locator('.continue-grid button:visible')).toHaveCount(8); // 7 sugeridas + Ver todas
        await page.getByRole('button', { name: /Ver todas/ }).click();
        await page.locator('.continue-grid button', { hasText: 'Extraer páginas' }).click();
        await expect(page).toHaveURL(/extraer-paginas/);
        await expect(page.locator('.file-name')).toHaveText('normal_rotado.pdf');
    });
});
