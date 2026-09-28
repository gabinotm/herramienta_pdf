// Genera los archivos de prueba en tests/fixtures. Uso: npm run fixtures
import { writeFile, readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { PDFDocument, StandardFonts, rgb, degrees } from 'pdf-lib';
import { chromium } from '@playwright/test';
import * as XLSX from 'xlsx';
import PptxGenJS from 'pptxgenjs';
import { Document, Packer, Paragraph, HeadingLevel, TextRun, Table, TableRow, TableCell } from 'docx';

const dir = fileURLToPath(new URL('.', import.meta.url));
const out = name => `${dir}${name}`;

async function textPdf(pages, title = 'Documento de prueba') {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const bold = await doc.embedFont(StandardFonts.HelveticaBold);
    for (let i = 1; i <= pages; i++) {
        const p = doc.addPage([595, 842]);
        p.drawText(`${title} — página ${i}`, { x: 50, y: 780, size: 20, font: bold, color: rgb(0.1, 0.2, 0.5) });
        const lines = [
            'Este es un párrafo de prueba con acentos: canción, pingüino, niño, árbol.',
            `Número de página: ${i}. Texto buscable y seleccionable.`,
            'Lorem ipsum dolor sit amet, consectetur adipiscing elit.',
        ];
        lines.forEach((l, k) => p.drawText(l, { x: 50, y: 740 - k * 20, size: 12, font }));
        // Tabla simple (para PDF a Excel)
        const rows = [['Producto', 'Cantidad', 'Precio'], ['Manzanas', '10', '2.50'], ['Peras', '4', '3.10'], ['Uvas', '7', '5.00']];
        rows.forEach((r, ri) => r.forEach((c, ci) => p.drawText(c, { x: 50 + ci * 150, y: 640 - ri * 22, size: 12, font: ri === 0 ? bold : font })));
    }
    return doc.save({ useObjectStreams: false });
}

async function qpdf(args, input) {
    // qpdf.js es un script clásico (define la variable global Module).
    const code = await readFile(new URL('../../vendor/qpdf/qpdf.js', import.meta.url), 'utf8');
    const sandbox = { module: { exports: {} }, console, process, require: (await import('node:module')).createRequire(import.meta.url), __filename: fileURLToPath(new URL('../../vendor/qpdf/qpdf.js', import.meta.url)), __dirname: fileURLToPath(new URL('../../vendor/qpdf/', import.meta.url)), WebAssembly, URL, TextDecoder, TextEncoder, setTimeout, clearTimeout, performance, crypto: globalThis.crypto };
    sandbox.exports = sandbox.module.exports;
    vm.runInNewContext(code, sandbox);
    const createModule = sandbox.module.exports;
    const origErr = console.error;
    console.error = () => { };
    const q = await createModule({ noInitialRun: true });
    console.error = origErr;
    q.FS.writeFile('/in.pdf', input);
    try {
        q.callMain(args);
    } catch { /* código de salida */ }
    return q.FS.readFile('/out.pdf');
}

async function formPdf() {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const page = doc.addPage([595, 842]);
    const form = doc.getForm();
    page.drawText('Formulario de inscripción', { x: 50, y: 780, size: 20, font });
    page.drawText('Nombre:', { x: 50, y: 730, size: 12, font });
    form.createTextField('nombre').addToPage(page, { x: 150, y: 720, width: 300, height: 24 });
    page.drawText('Correo:', { x: 50, y: 690, size: 12, font });
    form.createTextField('correo').addToPage(page, { x: 150, y: 680, width: 300, height: 24 });
    page.drawText('Acepto los términos:', { x: 50, y: 650, size: 12, font });
    form.createCheckBox('acepto').addToPage(page, { x: 200, y: 645, width: 18, height: 18 });
    page.drawText('País:', { x: 50, y: 610, size: 12, font });
    const dd = form.createDropdown('pais');
    dd.addOptions(['Perú', 'Chile', 'México']);
    dd.addToPage(page, { x: 150, y: 600, width: 200, height: 24 });
    page.drawText('Turno:', { x: 50, y: 570, size: 12, font });
    const rg = form.createRadioGroup('turno');
    rg.addOptionToPage('Mañana', page, { x: 150, y: 565, width: 16, height: 16 });
    rg.addOptionToPage('Tarde', page, { x: 250, y: 565, width: 16, height: 16 });
    page.drawText('Mañana            Tarde', { x: 170, y: 568, size: 11, font });
    return doc.save();
}

async function main() {
    const normal = await textPdf(3);
    await writeFile(out('normal.pdf'), normal);
    await writeFile(out('segundo.pdf'), await textPdf(2, 'Segundo archivo'));
    await writeFile(out('muchas-paginas.pdf'), await textPdf(120, 'Documento largo'));
    await writeFile(out('formulario.pdf'), await formPdf());
    // Páginas con /Rotate 90 y 270 (para validar posiciones en páginas giradas)
    const rot = await PDFDocument.load(await textPdf(2, 'Página girada'));
    rot.getPage(0).setRotation(degrees(90));
    rot.getPage(1).setRotation(degrees(270));
    await writeFile(out('rotado.pdf'), await rot.save());
    await writeFile(out('protegido.pdf'), await qpdf(['--encrypt', '1234', 'propietario', '256', '--', '/in.pdf', '/out.pdf'], normal));

    // Dañado: se corrompe la tabla xref y el puntero startxref (qpdf puede reconstruirlo).
    let s = Buffer.from(normal).toString('latin1');
    s = s.replace(/startxref\s+\d+/, 'startxref\n999999').replace(/xref\n0 \d+/, 'xrXf\n0 0');
    await writeFile(out('danado.pdf'), Buffer.from(s, 'latin1'));
    await writeFile(out('vacio.pdf'), Buffer.alloc(0));
    await writeFile(out('falso.pdf'), Buffer.from('Esto no es un PDF, solo tiene la extensión cambiada.'));

    // Imágenes y PDF escaneado: se generan con Chromium (canvas).
    const browser = await chromium.launch();
    const page = await browser.newPage();
    const images = await page.evaluate(() => {
        const make = (w, h, draw, type, q) => {
            const c = document.createElement('canvas');
            c.width = w;
            c.height = h;
            const ctx = c.getContext('2d');
            draw(ctx, w, h);
            return c.toDataURL(type, q);
        };
        const scan = make(1240, 1754, (ctx, w, h) => {
            ctx.fillStyle = '#fdfdf8';
            ctx.fillRect(0, 0, w, h);
            ctx.fillStyle = '#111';
            ctx.font = 'bold 56px Arial';
            ctx.fillText('INFORME ESCANEADO', 120, 220);
            ctx.font = '40px Arial';
            ['Este documento fue escaneado.', 'El texto es una imagen y no se', 'puede seleccionar sin OCR.', 'Fecha: 15 de marzo de 2024'].forEach((t, i) => ctx.fillText(t, 120, 360 + i * 70));
        }, 'image/jpeg', 0.9);
        const photo = make(800, 600, (ctx, w, h) => {
            const g = ctx.createLinearGradient(0, 0, w, h);
            g.addColorStop(0, '#2563eb');
            g.addColorStop(1, '#f59e0b');
            ctx.fillStyle = g;
            ctx.fillRect(0, 0, w, h);
            ctx.fillStyle = '#fff';
            ctx.font = 'bold 60px Arial';
            ctx.fillText('Foto de prueba', 180, 320);
        }, 'image/jpeg', 0.9);
        const logo = make(400, 400, (ctx, w, h) => {
            ctx.clearRect(0, 0, w, h);
            ctx.fillStyle = '#db2777';
            ctx.beginPath();
            ctx.arc(200, 200, 150, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = '#fff';
            ctx.font = 'bold 90px Arial';
            ctx.fillText('PNG', 110, 230);
        }, 'image/png');
        return { scan, photo, logo };
    });
    await browser.close();
    const b64 = d => Buffer.from(d.split(',')[1], 'base64');
    await writeFile(out('foto.jpg'), b64(images.photo));
    await writeFile(out('logo.png'), b64(images.logo));
    const scanDoc = await PDFDocument.create();
    const img = await scanDoc.embedJpg(b64(images.scan));
    const sp = scanDoc.addPage([595, 842]);
    sp.drawImage(img, { x: 0, y: 0, width: 595, height: 842 });
    await writeFile(out('escaneado.pdf'), await scanDoc.save());

    // Office
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
        ['Producto', 'Cantidad', 'Precio unitario', 'Total'],
        ['Manzanas', 10, 2.5, 25], ['Peras', 4, 3.1, 12.4], ['Uvas', 7, 5, 35], ['Plátanos', 12, 1.2, 14.4],
    ]), 'Ventas');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Nombre', 'Ciudad'], ['Ana', 'Lima'], ['José', 'Cusco']]), 'Clientes');
    await writeFile(out('hoja.xlsx'), XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
    await writeFile(out('hoja.ods'), XLSX.write(wb, { type: 'buffer', bookType: 'ods' }));

    const pptx = new PptxGenJS();
    const s1 = pptx.addSlide();
    s1.background = { color: '1E3A8A' };
    s1.addText('Presentación de prueba', { x: 0.5, y: 2, w: 9, h: 1.2, fontSize: 36, color: 'FFFFFF', bold: true, align: 'center' });
    const s2 = pptx.addSlide();
    s2.addText('Segunda diapositiva', { x: 0.5, y: 0.4, w: 9, h: 0.8, fontSize: 28, color: '1E3A8A', bold: true });
    s2.addText([{ text: 'Punto uno', options: { bullet: true } }, { text: 'Punto dos', options: { bullet: true } }], { x: 0.7, y: 1.5, w: 8, h: 2, fontSize: 20 });
    s2.addShape(pptx.ShapeType.rect, { x: 6.5, y: 3.5, w: 2.5, h: 1.2, fill: { color: 'F59E0B' } });
    await writeFile(out('presentacion.pptx'), await pptx.write({ outputType: 'nodebuffer' }));

    const docx = new Document({
        sections: [{
            children: [
                new Paragraph({ text: 'Documento Word de prueba', heading: HeadingLevel.HEADING_1 }),
                new Paragraph({ children: [new TextRun('Texto normal con '), new TextRun({ text: 'negrita', bold: true }), new TextRun(' y '), new TextRun({ text: 'cursiva', italics: true }), new TextRun('. Acentos: canción, niño.')] }),
                ...Array.from({ length: 60 }, (_, i) => new Paragraph(`Párrafo número ${i + 1} para comprobar que el documento ocupa más de una página al convertirse.`)),
                new Table({ rows: [['Nombre', 'Edad'], ['Ana', '30'], ['Luis', '25']].map(r => new TableRow({ children: r.map(c => new TableCell({ children: [new Paragraph(c)] })) })) }),
            ],
        }],
    });
    await writeFile(out('documento.docx'), await Packer.toBuffer(docx));

    // Formatos antiguos no soportados en el navegador (solo cabecera OLE) para probar el mensaje de error.
    const ole = Buffer.concat([Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]), Buffer.alloc(504)]);
    await writeFile(out('antiguo.doc'), ole);

    const list = ['normal.pdf', 'segundo.pdf', 'muchas-paginas.pdf', 'formulario.pdf', 'protegido.pdf', 'danado.pdf', 'escaneado.pdf', 'foto.jpg', 'logo.png', 'hoja.xlsx', 'presentacion.pptx', 'documento.docx'];
    for (const f of list) console.log(f.padEnd(22), (await readFile(out(f))).length, 'bytes');
}

main().catch(e => {
    console.error(e);
    process.exit(1);
});
