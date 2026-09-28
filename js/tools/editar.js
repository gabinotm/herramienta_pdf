import { h, alertBox } from '../core/dom.js';
import { outName, pdfBlob } from '../core/files.js';
import { loadPdfLib, savePdf } from '../core/pdf.js';
import { UserError } from '../core/errors.js';
import { createEditor } from '../core/editor.js';
import { openSignatureDialog } from '../core/signature.js';
import { loadSinglePdf, fileBar } from './_common.js';

function editorTool({ mode }) {
    return async function setup(ctx) {
        const { file, bytes, doc } = await loadSinglePdf(ctx);
        await loadPdfLib(bytes, file.name); // valida que se pueda escribir
        const mountPoint = h('div', {});
        ctx.main.append(
            fileBar(file, doc.numPages),
            mode === 'sign'
                ? alertBox('info', 'Crea tu firma (dibujada, escrita o desde una imagen), colócala donde quieras y ajusta su tamaño. Puedes añadir también la fecha e iniciales en cualquier página.')
                : '',
            mountPoint,
        );
        let editor = null;
        editor = await createEditor({
            doc, mode, mount: mountPoint,
            onSignature: kind => openSignatureDialog(kind),
            onChange: () => ctx.setActionEnabled(editor?.hasChanges() ?? true),
        });
        ctx.setActionEnabled(false);
        return {
            validate: () => (editor.hasChanges() ? null : new UserError(mode === 'sign' ? 'Todavía no colocaste ninguna firma.' : 'Todavía no hiciste ningún cambio en el documento.')),
            async run(progress) {
                const out = await loadPdfLib(bytes, file.name);
                const count = await editor.exportTo(out, progress);
                await progress(0.95, 'Guardando PDF…');
                return {
                    blob: pdfBlob(await savePdf(out)),
                    name: outName(file.name, mode === 'sign' ? 'firmado' : 'editado'),
                    message: mode === 'sign' ? 'Tu documento está firmado.' : `Se aplicaron ${count} elemento(s) al PDF.`,
                };
            },
            dispose: () => editor.dispose(),
        };
    };
}

export const editar = {
    id: 'editar-pdf',
    title: 'Editar PDF',
    description: 'Añade texto, imágenes, formas, resaltados, dibujos y comentarios a tu PDF.',
    keywords: 'escribir anotar texto dibujar resaltar comentar editor',
    category: 'editar',
    icon: 'fa-pen',
    input: 'pdf',
    layout: 'single',
    actionLabel: 'Guardar PDF',
    actionIcon: 'fa-floppy-disk',
    progressTitle: 'Guardando cambios…',
    setup: editorTool({ mode: 'edit' }),
};

export const firmar = {
    id: 'firmar-pdf',
    title: 'Firmar PDF',
    description: 'Firma documentos dibujando, escribiendo o subiendo tu firma. Añade fecha e iniciales.',
    keywords: 'firma electronica rubrica firmar signature',
    category: 'editar',
    icon: 'fa-signature',
    input: 'pdf',
    layout: 'single',
    actionLabel: 'Guardar PDF firmado',
    actionIcon: 'fa-signature',
    progressTitle: 'Firmando documento…',
    setup: editorTool({ mode: 'sign' }),
};
