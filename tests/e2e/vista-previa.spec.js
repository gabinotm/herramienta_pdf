import { test, expect } from '@playwright/test';
import { openTool, process } from './helpers.js';

// Archivo de prueba adecuado para cada herramienta
const CASES = {
    'unir-pdf': ['normal.pdf', 'segundo.pdf'],
    'dividir-pdf': 'normal.pdf',
    'extraer-paginas': 'normal.pdf',
    'eliminar-paginas': 'normal.pdf',
    'organizar-pdf': 'normal.pdf',
    'rotar-pdf': 'normal.pdf',
    'comprimir-pdf': 'escaneado.pdf',
    'reparar-pdf': 'danado.pdf',
    'ocr-pdf': 'escaneado.pdf',
    'pdf-a-word': 'normal.pdf',
    'pdf-a-excel': 'normal.pdf',
    'pdf-a-powerpoint': 'normal.pdf',
    'pdf-a-imagen': 'normal.pdf',
    'word-a-pdf': 'documento.docx',
    'excel-a-pdf': 'hoja.xlsx',
    'powerpoint-a-pdf': 'presentacion.pptx',
    'imagen-a-pdf': ['foto.jpg', 'logo.png'],
    'editar-pdf': 'normal.pdf',
    'firmar-pdf': 'normal.pdf',
    'rellenar-formulario': 'formulario.pdf',
    'marca-de-agua': 'normal.pdf',
    'numerar-paginas': 'normal.pdf',
    'recortar-pdf': 'normal.pdf',
    'aplanar-pdf': 'formulario.pdf',
    'comparar-pdf': ['normal.pdf', 'segundo.pdf'],
    'proteger-pdf': 'normal.pdf',
    'desbloquear-pdf': 'protegido.pdf',
};

const RENDERED = '.viewer-content canvas, .viewer-content img, .viewer-content .viewer-html section, .viewer-content .viewer-sheet, .viewer-content .viewer-page > div';

test.describe('Vista previa con zoom en todas las herramientas', () => {
    test('todas las herramientas registradas están cubiertas', async ({ page }) => {
        await page.goto('/');
        const ids = await page.locator('.tool-card').evaluateAll(els => els.map(a => a.getAttribute('href').slice(2)));
        expect(ids.sort()).toEqual(Object.keys(CASES).sort());
    });

    for (const [id, files] of Object.entries(CASES)) {
        test(`${id}: vista previa del archivo agregado`, async ({ page }) => {
            await openTool(page, id, files);
            const trigger = page.locator('.tool-main button:has-text("Vista previa"), .tool-main .zoom-btn').first();
            await expect(trigger).toBeVisible();
            await trigger.click();
            const viewer = page.locator('.viewer');
            await expect(viewer).toBeVisible();
            if (id === 'desbloquear-pdf') {
                // PDF protegido: pide la contraseña para mostrarlo
                await viewer.getByLabel('Contraseña del PDF').fill('1234');
                await viewer.getByRole('button', { name: 'Ver documento' }).click();
            }
            await expect(viewer.locator(RENDERED).first()).toBeVisible();
            const label = viewer.locator('.viewer-zoom-label');
            const before = await label.innerText();
            await viewer.getByRole('button', { name: /Acercar/ }).click();
            await expect(label).not.toHaveText(before);
            await page.keyboard.press('Escape');
            await expect(viewer).toHaveCount(0);
        });
    }

    test('navegar páginas y zoom desde una miniatura @movil', async ({ page }) => {
        await openTool(page, 'extraer-paginas', 'normal.pdf');
        await page.getByLabel('Ver página 2 con zoom').click();
        const viewer = page.locator('.viewer');
        await expect(viewer.getByLabel('Número de página')).toHaveValue('2');
        await viewer.getByRole('button', { name: /Página siguiente/ }).click();
        await expect(viewer.getByLabel('Número de página')).toHaveValue('3');
        await expect(viewer.getByRole('img', { name: 'Página 3' })).toBeVisible();
        await viewer.getByRole('button', { name: /Cerrar/ }).click();
        await expect(viewer).toHaveCount(0);
    });

    test('vista previa del resultado', async ({ page }) => {
        await openTool(page, 'rotar-pdf', 'normal.pdf');
        await page.getByRole('button', { name: 'Girar 180°' }).click();
        await process(page);
        await page.locator('.result').getByRole('button', { name: 'Vista previa' }).click();
        await expect(page.locator('.viewer canvas')).toBeVisible();
    });

    test('ampliar la vista previa de la marca de agua', async ({ page }) => {
        await openTool(page, 'marca-de-agua', 'normal.pdf');
        await page.getByRole('button', { name: 'Ampliar vista previa' }).click();
        await expect(page.locator('.viewer canvas')).toBeVisible();
    });
});
