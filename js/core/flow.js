// Flujo común de 3 pasos para todas las herramientas: subir → configurar → descargar.
import { CONFIG } from '../config.js';
import { h, icon, clear, formatBytes, downloadBlob, alertBox, nextFrame, toast } from './dom.js';
import { validateFiles, KIND_LABEL, KIND_ACCEPT } from './files.js';
import { toUserError } from './errors.js';

let handoff = null; // archivo que pasa de una herramienta a otra ("Continuar con otra herramienta")

export function setHandoff(file) {
    handoff = file;
}

export function takeHandoff() {
    const f = handoff;
    handoff = null;
    return f;
}

/**
 * Monta una herramienta dentro de `root`.
 * Devuelve una función de limpieza que se llama al salir de la página.
 */
export function mountTool(root, tool, { allTools, categories }) {
    const cat = categories[tool.category];
    let disposers = [];
    let files = [];
    let controller = null;
    let resultTimer = null;
    let destroyed = false;
    let step = 0; // 0 subir, 1 configurar, 2 resultado

    const stepItems = ['Subir', 'Configurar', 'Descargar'].map((label, i) =>
        h('li', {}, h('span', { class: 'num', text: String(i + 1) }), h('span', { text: label })));
    const stepper = h('ol', { class: 'stepper', 'aria-label': 'Pasos' }, stepItems);
    const body = h('div', { class: 'tool-body' });

    clear(root).append(h('section', { class: 'tool-page', style: { '--cat': cat.color } },
        h('div', { class: 'tool-header' },
            h('div', { class: 'tool-icon', style: { background: cat.color } }, icon(tool.icon)),
            h('div', {}, h('h1', { text: tool.title }), h('p', { text: tool.description })),
        ),
        stepper,
        body,
    ));
    document.title = `${tool.title} — PDF PRO`;

    function setStep(n) {
        stepItems.forEach((li, i) => {
            li.classList.toggle('done', i < n);
            if (i === n) li.setAttribute('aria-current', 'step');
            else li.removeAttribute('aria-current');
        });
    }

    // ---------- Paso 1: subir ----------

    const acceptAttr = KIND_ACCEPT[tool.input];
    const pickerInput = h('input', { type: 'file', accept: acceptAttr, multiple: tool.multiple, class: 'sr-only', tabindex: '-1', 'aria-hidden': 'true' });
    root.append(pickerInput);
    let pickerResolve = null;
    pickerInput.addEventListener('change', () => {
        const list = Array.from(pickerInput.files || []);
        pickerInput.value = '';
        if (pickerResolve) {
            const r = pickerResolve;
            pickerResolve = null;
            r(list);
        } else if (list.length) {
            // Archivos asignados sin pasar por el botón (tecnologías de asistencia, automatización).
            if (step === 0) handleIncoming(list);
            else if (step === 1 && tool.multiple && controller?.addFiles) addMore(list);
        }
    });
    function openPicker() {
        return new Promise(resolve => {
            pickerResolve = resolve;
            pickerInput.click();
        });
    }

    function showUpload(errorMsg) {
        setStep(0);
        disposeController();
        step = 0;
        files = [];
        const dz = h('div', {
            class: 'dropzone', role: 'button', tabindex: '0',
            'aria-label': `Elegir ${tool.multiple ? 'archivos' : 'archivo'} ${KIND_LABEL[tool.input]}`,
        },
            h('div', { class: 'dz-icon' }, icon('fa-cloud-arrow-up')),
            h('h2', { text: tool.multiple ? 'Arrastra tus archivos aquí' : 'Arrastra tu archivo aquí' }),
            h('p', { class: 'dz-hint', text: `Archivo${tool.multiple ? 's' : ''} ${KIND_LABEL[tool.input]} · también puedes pegarlo con Ctrl+V` }),
            h('span', { class: 'btn btn-primary btn-lg' }, icon('fa-folder-open'), tool.multiple ? 'Elegir archivos' : 'Elegir archivo'),
            h('p', { class: 'dz-limits', text: `Máximo ${CONFIG.maxFileMB} MB por archivo${tool.multiple ? ` · hasta ${CONFIG.maxFiles} archivos` : ''}${tool.input === 'pdf' ? ` · hasta ${CONFIG.maxPages} páginas` : ''}` }),
        );
        const pick = async () => handleIncoming(await openPicker());
        dz.addEventListener('click', pick);
        dz.addEventListener('keydown', e => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                pick();
            }
        });
        bindDrop(dz, list => handleIncoming(list));
        clear(body).append(
            errorMsg ? errorBlock(errorMsg) : '',
            dz,
            h('p', { class: 'privacy-note' }, icon('fa-lock'),
                h('span', { text: 'Tus archivos se procesan en tu navegador. No se suben a ningún servidor y desaparecen al cerrar o salir de esta página.' })),
        );
    }

    function bindDrop(el, onFiles) {
        el.addEventListener('dragover', e => {
            e.preventDefault();
            el.classList.add('dragover');
        });
        el.addEventListener('dragleave', () => el.classList.remove('dragover'));
        el.addEventListener('drop', e => {
            e.preventDefault();
            el.classList.remove('dragover');
            const list = Array.from(e.dataTransfer?.files || []);
            if (list.length) onFiles(list);
        });
    }

    // Pegar con Ctrl+V
    const onPaste = e => {
        const list = Array.from(e.clipboardData?.files || []);
        if (!list.length) return;
        e.preventDefault();
        if (step === 0) handleIncoming(list);
        else if (step === 1 && tool.multiple && controller?.addFiles) addMore(list);
    };
    document.addEventListener('paste', onPaste);
    disposers.push(() => document.removeEventListener('paste', onPaste));


    async function handleIncoming(list) {
        if (!list.length) return;
        if (!tool.multiple && list.length > 1) list = list.slice(0, 1);
        showLoading('Leyendo archivo…');
        try {
            files = await validateFiles(list, tool.input, { max: tool.maxFiles || CONFIG.maxFiles });
            await showConfigure();
        } catch (err) {
            showUpload(toUserError(err, list[0]?.name));
        }
    }

    async function addMore(list) {
        try {
            const extra = await validateFiles(list, tool.input, { max: tool.maxFiles || CONFIG.maxFiles, existing: controller.fileCount ? controller.fileCount() : files.length });
            await controller.addFiles(extra);
        } catch (err) {
            const e = toUserError(err);
            toast(e.message, e.hint, 'error');
        }
    }

    function showLoading(text) {
        clear(body).append(h('div', { class: 'panel progress-panel', role: 'status' },
            h('div', { class: 'spinner' }), h('p', { class: 'muted', text })));
    }

    // ---------- Paso 2: configurar ----------

    let configNode = null;

    async function showConfigure() {
        disposeController();
        step = 1;
        setStep(1);
        const main = h('div', { class: 'config-main' });
        const side = h('div', { class: 'config-side' });
        const errorSlot = h('div', {});
        const actionBtn = h('button', { type: 'button', class: 'btn btn-primary btn-lg', style: { width: '100%' } },
            icon(tool.actionIcon || 'fa-arrow-right'), tool.actionLabel);
        const layout = tool.layout === 'single'
            ? h('div', { class: 'config-layout single' }, h('div', { class: 'config-main' }, errorSlot, main, h('div', { style: { marginTop: '16px', maxWidth: '360px', marginInline: 'auto' } }, actionBtn)))
            : h('div', { class: 'config-layout' }, h('div', { class: 'config-main' }, errorSlot, main), side);
        configNode = layout;
        clear(body).append(layout);

        const ctx = {
            files,
            main,
            side,
            tool,
            setActionEnabled: on => { actionBtn.disabled = !on; },
            setActionLabel: label => { actionBtn.lastChild.textContent = label; },
            pickFiles: async () => validateFiles(await openPicker(), tool.input, { max: tool.maxFiles || CONFIG.maxFiles, existing: controller?.fileCount ? controller.fileCount() : files.length }),
            bindDrop: (el, cb) => bindDrop(el, list => cb(list)),
            addMore: list => addMore(list),
            restart: () => showUpload(),
            onDispose: fn => disposers.push(fn),
        };
        try {
            controller = await tool.setup(ctx);
        } catch (err) {
            showUpload(toUserError(err, files[0]?.file?.name));
            return;
        }
        if (destroyed) return;
        if (tool.layout !== 'single') {
            side.append(h('div', { class: 'panel' },
                controller.options || null,
                actionBtn,
                h('button', { type: 'button', class: 'btn btn-outline', style: { width: '100%', marginTop: '10px' }, onclick: () => showUpload() },
                    icon('fa-rotate-left'), 'Elegir otro archivo'),
            ));
        }
        actionBtn.addEventListener('click', () => runProcess(errorSlot));
    }

    // ---------- Proceso ----------

    async function runProcess(errorSlot) {
        clear(errorSlot);
        if (controller.validate) {
            const problem = controller.validate();
            if (problem) {
                errorSlot.append(errorBlock(toUserError(problem)));
                errorSlot.scrollIntoView({ behavior: 'smooth', block: 'center' });
                return;
            }
        }
        const bar = h('div', { class: 'progress-bar indeterminate' });
        const pct = h('p', { class: 'small muted', text: '' });
        const label = h('p', { class: 'muted', text: 'Preparando…' });
        const progressNode = h('div', { class: 'panel progress-panel', role: 'status', 'aria-live': 'polite' },
            h('h2', { text: tool.progressTitle || 'Procesando…' }),
            label,
            h('div', { class: 'progress', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100' }, bar),
            pct,
        );
        configNode.classList.add('hidden');
        body.append(progressNode);
        const progressEl = progressNode.querySelector('.progress');
        let lastPaint = 0;
        const progress = async (fraction, text) => {
            if (text) label.textContent = text;
            if (fraction === null || fraction === undefined) {
                bar.classList.add('indeterminate');
                bar.style.width = '';
                pct.textContent = '';
                progressEl.removeAttribute('aria-valuenow');
            } else {
                const v = Math.max(0, Math.min(100, Math.round(fraction * 100)));
                bar.classList.remove('indeterminate');
                bar.style.width = `${v}%`;
                pct.textContent = `${v}%`;
                progressEl.setAttribute('aria-valuenow', String(v));
            }
            // Cede el hilo como máximo ~20 veces por segundo para no ralentizar el proceso.
            const now = performance.now();
            if (now - lastPaint > 50) {
                lastPaint = now;
                await nextFrame();
            }
        };
        try {
            await nextFrame();
            const result = await controller.run(progress);
            if (destroyed) return;
            progressNode.remove();
            if (!result) {
                // La herramienta decidió no generar archivo (p. ej. cancelado): vuelve a configurar.
                configNode.classList.remove('hidden');
                return;
            }
            showResult(result);
        } catch (err) {
            if (destroyed) return;
            progressNode.remove();
            configNode.classList.remove('hidden');
            errorSlot.append(errorBlock(toUserError(err, files[0]?.file?.name)));
            errorSlot.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
    }

    // ---------- Paso 3: resultado ----------

    function showResult(result) {
        step = 2;
        setStep(2);
        let blob = result.blob;
        const name = result.name;
        const download = () => {
            if (!blob) {
                toast('El archivo ya no está disponible', 'Se eliminó de la memoria. Vuelve a procesarlo.', 'warning');
                return;
            }
            downloadBlob(blob, name);
        };
        const isPdf = blob && blob.type === 'application/pdf';
        const continueTools = isPdf ? allTools.filter(t => t.input === 'pdf' && t.id !== tool.id && !t.hideInContinue) : [];

        const expiry = h('p', { class: 'auto-delete' }, icon('fa-clock'),
            ` El resultado solo existe en la memoria de tu navegador y se eliminará automáticamente en ${CONFIG.resultTTLMinutes} minutos o al salir de esta página.`);

        const node = h('div', { class: 'panel result' },
            h('div', { class: 'result-icon' }, icon('fa-check')),
            h('h2', { text: result.title || '¡Listo!' }),
            result.message ? h('p', { class: 'muted', text: result.message }) : null,
            result.warning ? h('div', { class: 'result-extra' }, alertBox('warning', result.warning)) : null,
            result.stats ? h('div', { class: 'stats-row' }, result.stats.map(s =>
                h('div', { class: `stat${s.good ? ' good' : ''}` }, h('strong', { text: s.value }), h('span', { text: s.label })))) : null,
            result.extra ? h('div', { class: 'result-extra' }, result.extra) : null,
            blob ? h('div', { class: 'result-file' }, icon(fileIcon(name)), h('span', { text: name }), h('span', { class: 'muted small', text: formatBytes(blob.size) })) : null,
            h('div', { class: 'result-actions' },
                blob ? h('button', { type: 'button', class: 'btn btn-primary btn-lg', onclick: download }, icon('fa-download'), 'Descargar') : null,
                h('button', { type: 'button', class: 'btn btn-outline btn-lg', onclick: () => showUpload() }, icon('fa-rotate-left'), 'Empezar de nuevo'),
            ),
            continueTools.length ? h('div', { class: 'continue-box' },
                h('h3', { text: 'Continuar con otra herramienta' }),
                h('p', { class: 'muted small', style: { textAlign: 'center' }, text: 'El archivo resultante pasa directamente, sin volver a subirlo.' }),
                h('div', { class: 'continue-grid' }, continueTools.map(t => h('button', {
                    type: 'button',
                    style: { '--cat': categories[t.category].color },
                    onclick: () => {
                        if (!blob) return download();
                        setHandoff(new File([blob], name, { type: blob.type }));
                        location.hash = `#/${t.id}`;
                    },
                }, icon(t.icon), t.title))),
            ) : null,
            blob ? expiry : null,
        );
        configNode.classList.add('hidden');
        body.append(node);
        node.querySelector('h2').setAttribute('tabindex', '-1');
        node.querySelector('h2').focus();

        clearTimeout(resultTimer);
        resultTimer = setTimeout(() => {
            blob = null;
            result.blob = null;
            expiry.textContent = 'El resultado se eliminó de la memoria por seguridad.';
        }, CONFIG.resultTTLMinutes * 60 * 1000);
    }

    function errorBlock(err) {
        return alertBox('error', err.message, err.hint ? h('p', { class: 'small', text: err.hint }) : null);
    }

    function disposeController() {
        if (controller?.dispose) {
            try {
                controller.dispose();
            } catch { /* ignorar */ }
        }
        controller = null;
    }

    // Arranque: archivo recibido de otra herramienta o zona de subida.
    const incoming = takeHandoff();
    if (incoming) handleIncoming([incoming]);
    else showUpload();

    return () => {
        destroyed = true;
        clearTimeout(resultTimer);
        disposeController();
        disposers.forEach(fn => {
            try {
                fn();
            } catch { /* ignorar */ }
        });
        disposers = [];
        pickerInput.remove();
    };
}

function fileIcon(name) {
    if (/\.zip$/i.test(name)) return 'fa-file-zipper';
    if (/\.docx$/i.test(name)) return 'fa-file-word';
    if (/\.xlsx$/i.test(name)) return 'fa-file-excel';
    if (/\.pptx$/i.test(name)) return 'fa-file-powerpoint';
    if (/\.(png|jpe?g)$/i.test(name)) return 'fa-file-image';
    if (/\.html?$/i.test(name)) return 'fa-file-code';
    return 'fa-file-pdf';
}
