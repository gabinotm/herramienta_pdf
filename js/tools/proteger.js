import { h, icon, checkbox, alertBox } from '../core/dom.js';
import { readBytes, outName, pdfBlob } from '../core/files.js';
import { runQpdf, isEncrypted } from '../core/qpdf.js';
import { openPdf } from '../core/pdf.js';
import { Errors, UserError } from '../core/errors.js';
import { fileBar } from './_common.js';

function passwordField(label, id) {
    const input = h('input', { class: 'input', type: 'password', id, autocomplete: 'new-password', spellcheck: 'false' });
    const toggle = h('button', {
        type: 'button', class: 'icon-btn', 'aria-label': 'Mostrar contraseña', 'aria-pressed': 'false',
        onclick: () => {
            const show = input.type === 'password';
            input.type = show ? 'text' : 'password';
            toggle.setAttribute('aria-pressed', String(show));
            toggle.setAttribute('aria-label', show ? 'Ocultar contraseña' : 'Mostrar contraseña');
        },
    }, icon('fa-eye'));
    return { input, node: h('div', { class: 'field' }, h('label', { for: id, text: label }), h('div', { class: 'row', style: { alignItems: 'center' } }, input, h('div', { style: { flex: '0 0 auto' } }, toggle))) };
}

function strength(pw) {
    let s = 0;
    if (pw.length >= 8) s++;
    if (pw.length >= 12) s++;
    if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) s++;
    if (/\d/.test(pw)) s++;
    if (/[^A-Za-z0-9]/.test(pw)) s++;
    return ['Muy débil', 'Débil', 'Aceptable', 'Buena', 'Fuerte', 'Muy fuerte'][s];
}

function randomPassword() {
    const bytes = crypto.getRandomValues(new Uint8Array(24));
    return Array.from(bytes, b => 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789'[b % 57]).join('');
}

export default {
    id: 'proteger-pdf',
    title: 'Proteger PDF',
    description: 'Añade una contraseña con cifrado AES-256 y limita la impresión, copia o edición.',
    keywords: 'contraseña cifrar encriptar seguridad password bloquear',
    category: 'seguridad',
    icon: 'fa-lock',
    input: 'pdf',
    actionLabel: 'Proteger PDF',
    actionIcon: 'fa-lock',
    progressTitle: 'Cifrando PDF…',

    async setup(ctx) {
        const { file } = ctx.files[0];
        const bytes = await readBytes(file);
        if (await isEncrypted(bytes)) throw Errors.encrypted(file.name);
        const check = await openPdf(bytes, { name: file.name });
        const pages = check.numPages;
        await check.destroy();

        const pw = passwordField('Contraseña para abrir el PDF', 'pw1');
        const pw2 = passwordField('Repite la contraseña', 'pw2');
        const owner = passwordField('Contraseña de propietario (opcional)', 'pw3');
        const meter = h('span', { class: 'hint', 'aria-live': 'polite' });
        pw.input.addEventListener('input', () => { meter.textContent = pw.input.value ? `Seguridad: ${strength(pw.input.value)}` : ''; });
        const perms = { print: true, copy: false, modify: false, annotate: true };

        ctx.main.append(
            fileBar(file, pages),
            alertBox('info', 'El PDF se cifra con AES-256. Guarda bien la contraseña: si la olvidas, no hay forma de recuperar el documento.'),
        );

        return {
            options: h('div', {},
                h('h2', { text: 'Contraseña' }),
                pw.node, meter, pw2.node,
                h('h2', { text: 'Permisos', style: { marginTop: '10px' } }),
                checkbox('Permitir imprimir', perms.print, v => { perms.print = v; }),
                checkbox('Permitir copiar texto e imágenes', perms.copy, v => { perms.copy = v; }),
                checkbox('Permitir modificar el documento', perms.modify, v => { perms.modify = v; }),
                checkbox('Permitir comentarios y rellenar formularios', perms.annotate, v => { perms.annotate = v; }),
                h('details', { style: { margin: '6px 0 14px' } },
                    h('summary', { class: 'small', text: 'Opciones avanzadas' }),
                    owner.node,
                    h('p', { class: 'hint', text: 'Permite cambiar los permisos más adelante. Si la dejas vacía se genera una aleatoria.' }),
                ),
            ),
            validate() {
                if (!pw.input.value) return new UserError('Escribe una contraseña.');
                if (pw.input.value.length < 4) return new UserError('La contraseña debe tener al menos 4 caracteres.');
                if (pw.input.value !== pw2.input.value) return new UserError('Las contraseñas no coinciden.');
                return null;
            },
            async run(progress) {
                await progress(0.3, 'Aplicando cifrado AES-256…');
                const modify = perms.modify ? 'all' : perms.annotate ? 'annotate' : 'none';
                const r = await runQpdf([
                    '--encrypt',
                    `--user-password=${pw.input.value}`,
                    `--owner-password=${owner.input.value || randomPassword()}`,
                    '--bits=256',
                    `--print=${perms.print ? 'full' : 'none'}`,
                    `--modify=${modify}`,
                    `--extract=${perms.copy ? 'y' : 'n'}`,
                    '--',
                    '/in.pdf', '/out.pdf',
                ], { '/in.pdf': bytes });
                if (!r.output || r.code === 2) throw new UserError('No se pudo cifrar el PDF.', { hint: 'El archivo podría estar dañado. Prueba primero con "Reparar PDF".' });
                pw.input.value = pw2.input.value = owner.input.value = '';
                return { blob: pdfBlob(r.output), name: outName(file.name, 'protegido'), message: 'Tu PDF ahora pide contraseña para abrirse (cifrado AES-256).' };
            },
        };
    },
};
