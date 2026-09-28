import { expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { PDFDocument } from 'pdf-lib';

export const fixture = name => fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url));

/** Abre una herramienta y sube archivos. */
export async function openTool(page, id, files) {
    await page.goto(`/#/${id}`);
    await expect(page.locator('.dropzone')).toBeVisible();
    await page.locator('input[type=file]').first().setInputFiles((Array.isArray(files) ? files : [files]).map(fixture));
}

/** Pulsa el botón de acción y espera la pantalla de resultado. */
export async function process(page, label) {
    const btn = page.locator('.config-layout button.btn-primary.btn-lg:visible', label ? { hasText: label } : {}).first();
    await expect(btn).toBeEnabled();
    await btn.click();
    await expect(page.locator('.result')).toBeVisible({ timeout: 90_000 });
}

/** Descarga el resultado y devuelve { name, bytes }. */
export async function download(page) {
    const [dl] = await Promise.all([
        page.waitForEvent('download'),
        page.locator('.result button', { hasText: 'Descargar' }).click(),
    ]);
    const path = await dl.path();
    return { name: dl.suggestedFilename(), bytes: await readFile(path) };
}

export async function loadPdf(bytes) {
    return PDFDocument.load(bytes);
}

/** Espera un mensaje de error visible con cierto texto. */
export async function expectError(page, text) {
    await expect(page.locator('.alert-error').first()).toContainText(text);
}
