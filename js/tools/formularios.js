import { h, checkbox, alertBox } from '../core/dom.js';
import { outName, pdfBlob, readBytes } from '../core/files.js';
import { loadPdfLib, savePdf } from '../core/pdf.js';
import { UserError } from '../core/errors.js';
import { fileBar } from './_common.js';

/** Tipo de campo sin depender de nombres de clase (pdf-lib está minificado). */
function kindOf(f) {
    const { PDFTextField, PDFCheckBox, PDFRadioGroup, PDFDropdown, PDFOptionList, PDFButton, PDFSignature } = PDFLib;
    if (f instanceof PDFTextField) return 'text';
    if (f instanceof PDFCheckBox) return 'check';
    if (f instanceof PDFRadioGroup) return 'radio';
    if (f instanceof PDFDropdown) return 'dropdown';
    if (f instanceof PDFOptionList) return 'list';
    if (f instanceof PDFButton) return 'button';
    if (f instanceof PDFSignature) return 'signature';
    return 'other';
}

const KIND_LABEL = { text: 'Texto', check: 'Casilla', radio: 'Opción única', dropdown: 'Lista desplegable', list: 'Lista' };

export default {
    id: 'rellenar-formulario',
    title: 'Rellenar formulario PDF',
    description: 'Completa los campos de un formulario PDF y, si quieres, aplánalo.',
    keywords: 'formulario campos completar acroform llenar',
    category: 'editar',
    icon: 'fa-pen-to-square',
    input: 'pdf',
    actionLabel: 'Guardar formulario',
    actionIcon: 'fa-floppy-disk',
    progressTitle: 'Guardando formulario…',

    async setup(ctx) {
        const { file } = ctx.files[0];
        const bytes = await readBytes(file);
        const pdf = await loadPdfLib(bytes, file.name);
        const form = pdf.getForm();
        const hasXfa = !!pdf.catalog.lookup(PDFLib.PDFName.of('AcroForm'))?.lookup?.(PDFLib.PDFName.of('XFA'));
        const fields = form.getFields().map(f => ({ f, kind: kindOf(f), name: f.getName() })).filter(x => KIND_LABEL[x.kind]);
        if (!fields.length) {
            throw new UserError('Este PDF no tiene campos de formulario rellenables (AcroForm).', {
                hint: hasXfa ? 'Es un formulario XFA (dinámico), que solo se puede rellenar con Adobe Reader.' : 'Si solo quieres escribir sobre el documento, usa la herramienta "Editar PDF".',
            });
        }
        let flatten = false;
        const values = new Map();
        const controls = fields.map(({ f, kind, name }, idx) => {
            const id = `ff${idx}`;
            const readOnly = f.isReadOnly();
            let control;
            if (kind === 'text') {
                const multi = f.isMultiline();
                control = h(multi ? 'textarea' : 'input', { class: 'input', id, disabled: readOnly, maxlength: f.getMaxLength() ?? null });
                control.value = f.getText() || '';
                values.set(name, () => control.value);
            } else if (kind === 'check') {
                control = h('input', { type: 'checkbox', id, checked: f.isChecked(), disabled: readOnly, style: { width: '22px', height: '22px' } });
                values.set(name, () => control.checked);
            } else if (kind === 'radio') {
                const current = f.getSelected();
                control = h('div', { class: 'options', role: 'radiogroup', 'aria-labelledby': `${id}-l` },
                    f.getOptions().map(opt => h('label', { class: 'check' }, h('input', { type: 'radio', name: id, value: opt, checked: opt === current, disabled: readOnly }), h('span', { text: opt }))));
                values.set(name, () => control.querySelector('input:checked')?.value ?? null);
            } else {
                const selected = new Set(f.getSelected());
                control = h('select', { class: 'input', id, multiple: kind === 'list' && f.isMultiselect(), disabled: readOnly },
                    kind === 'dropdown' ? h('option', { value: '', text: '— Sin selección —' }) : null,
                    f.getOptions().map(opt => h('option', { value: opt, text: opt, selected: selected.has(opt) })));
                values.set(name, () => Array.from(control.selectedOptions).map(o => o.value).filter(Boolean));
            }
            const label = h(kind === 'radio' ? 'span' : 'label', { class: 'label', id: `${id}-l`, for: kind === 'radio' ? null : id },
                name, ' ', h('span', { class: 'ftype', text: `(${KIND_LABEL[kind]}${readOnly ? ', solo lectura' : ''}${kind === 'text' && f.isRequired() ? ', obligatorio' : ''})` }));
            return h('div', { class: 'field' }, label, control);
        });

        ctx.main.append(
            fileBar(file, pdf.getPageCount()),
            alertBox('info', `Se encontraron ${fields.length} campo(s). Completa los que necesites y pulsa "Guardar formulario".`),
            hasXfa ? alertBox('warning', 'El PDF también contiene un formulario XFA; se eliminará para que los valores se vean en todos los visores.') : '',
            h('div', { class: 'panel' }, h('div', { class: 'form-fields' }, controls)),
        );

        return {
            options: h('div', {},
                h('h2', { text: 'Opciones' }),
                checkbox('Aplanar el formulario (los campos dejarán de ser editables)', flatten, v => { flatten = v; }),
                h('div', { style: { height: '8px' } }),
            ),
            async run(progress) {
                const out = await loadPdfLib(bytes, file.name);
                const outForm = out.getForm();
                if (hasXfa) outForm.deleteXFA();
                const font = await out.embedFont(PDFLib.StandardFonts.Helvetica);
                let filled = 0;
                for (const { name, kind } of fields) {
                    const field = outForm.getField(name);
                    if (field.isReadOnly()) continue;
                    const v = values.get(name)();
                    if (kind === 'text') {
                        field.setText(v || undefined);
                        if (v) filled++;
                    } else if (kind === 'check') {
                        if (v) {
                            field.check();
                            filled++;
                        } else field.uncheck();
                    } else if (kind === 'radio') {
                        if (v) {
                            field.select(v);
                            filled++;
                        } else field.clear();
                    } else if (kind === 'dropdown' || kind === 'list') {
                        if (v.length) {
                            field.select(kind === 'dropdown' ? v[0] : v);
                            filled++;
                        } else field.clear();
                    }
                }
                await progress(0.5, 'Generando la apariencia de los campos…');
                try {
                    outForm.updateFieldAppearances(font);
                } catch {
                    throw new UserError('Algún valor contiene caracteres que no se pueden mostrar en el formulario (por ejemplo, emojis o alfabetos no latinos).');
                }
                if (flatten) outForm.flatten();
                await progress(0.8, 'Guardando PDF…');
                return { blob: pdfBlob(await savePdf(out)), name: outName(file.name, flatten ? 'relleno_aplanado' : 'relleno'), message: `Se completaron ${filled} campo(s)${flatten ? ' y el formulario se aplanó' : ''}.` };
            },
        };
    },
};
