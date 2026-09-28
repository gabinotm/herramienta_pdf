import { h, icon, alertBox } from '../core/dom.js';
import { readBytes, outName, pdfBlob } from '../core/files.js';
import { runQpdf, isEncrypted, requiresPassword } from '../core/qpdf.js';
import { Errors, UserError } from '../core/errors.js';
import { fileBar } from './_common.js';

export default {
    id: 'desbloquear-pdf',
    title: 'Desbloquear PDF',
    description: 'Quita la contraseña y las restricciones de un PDF del que conoces la clave.',
    keywords: 'quitar contraseña desproteger descifrar password eliminar',
    category: 'seguridad',
    icon: 'fa-unlock',
    input: 'pdf',
    actionLabel: 'Desbloquear PDF',
    actionIcon: 'fa-unlock',
    progressTitle: 'Quitando la protección…',

    async setup(ctx) {
        const { file } = ctx.files[0];
        const bytes = await readBytes(file);
        if (!(await isEncrypted(bytes))) {
            throw new UserError(`"${file.name}" no está protegido con contraseña.`, { code: 'not_encrypted', hint: 'No hace falta desbloquearlo: ya puedes usarlo en cualquier herramienta.' });
        }
        const needsPw = await requiresPassword(bytes);
        const input = h('input', { class: 'input', type: 'password', id: 'unlock-pw', autocomplete: 'current-password', spellcheck: 'false' });
        ctx.main.append(
            fileBar(file, null),
            needsPw
                ? alertBox('info', 'Este PDF pide contraseña para abrirse. Escríbela para quitar la protección. Solo desbloquea documentos que te pertenecen o que tienes permiso para modificar.')
                : alertBox('info', 'Este PDF se abre sin contraseña, pero tiene restricciones (impresión, copia o edición). Se pueden quitar directamente.'),
        );
        return {
            options: h('div', {},
                h('h2', { text: 'Desbloquear' }),
                needsPw ? h('div', { class: 'field' }, h('label', { for: 'unlock-pw', text: 'Contraseña del PDF' }), input) : h('p', { class: 'muted small' }, icon('fa-circle-check'), ' No se necesita contraseña.'),
            ),
            validate: () => (needsPw && !input.value ? new UserError('Escribe la contraseña del PDF.') : null),
            async run(progress) {
                await progress(0.4, 'Descifrando…');
                const args = needsPw ? [`--password=${input.value}`, '--decrypt', '/in.pdf', '/out.pdf'] : ['--decrypt', '/in.pdf', '/out.pdf'];
                const r = await runQpdf(args, { '/in.pdf': bytes });
                if (!r.output || r.code === 2) {
                    if (/invalid password/i.test(r.stderr)) {
                        input.value = '';
                        throw Errors.wrongPassword();
                    }
                    throw Errors.corrupt(file.name);
                }
                input.value = '';
                return { blob: pdfBlob(r.output), name: outName(file.name, 'desbloqueado'), message: 'Se quitaron la contraseña y las restricciones.' };
            },
        };
    },
};
