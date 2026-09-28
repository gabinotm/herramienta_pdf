// qpdf compilado a WebAssembly: cifrado AES-256, descifrado, reparación y aplanado.
// Cada ejecución crea una instancia nueva (sistema de archivos virtual limpio, memoria liberada al terminar).
import { loadScript } from './dom.js';

const VENDOR = new URL('../../vendor/qpdf/', import.meta.url);
let factoryPromise = null;

function getFactory() {
    if (!factoryPromise) {
        factoryPromise = loadScript(new URL('qpdf.js', VENDOR).href).then(() => {
            // qpdf.js define la variable global `Module` (fábrica de Emscripten).
            const factory = window.Module;
            if (typeof factory !== 'function') throw new Error('qpdf no se cargó correctamente');
            return factory;
        }).catch(err => {
            factoryPromise = null;
            throw err;
        });
    }
    return factoryPromise;
}

/**
 * Ejecuta qpdf con argumentos (sin shell: se pasan como arreglo).
 * inputs: { '/in.pdf': Uint8Array }
 * Devuelve { code, stderr, output } — code 0 = ok, 3 = ok con advertencias, 2 = error.
 */
export async function runQpdf(args, inputs, outputPath = '/out.pdf') {
    const factory = await getFactory();
    const lines = [];
    // qpdf escribe sus mensajes con console.error/console.log capturados al crear el módulo.
    const origErr = console.error;
    const origLog = console.log;
    console.error = (...a) => lines.push(a.join(' '));
    console.log = (...a) => lines.push(a.join(' '));
    let mod;
    try {
        mod = await factory({
            locateFile: () => new URL('qpdf.wasm', VENDOR).href,
            noInitialRun: true,
        });
    } finally {
        console.error = origErr;
        console.log = origLog;
    }
    for (const [path, data] of Object.entries(inputs)) mod.FS.writeFile(path, data);
    let code;
    try {
        code = mod.callMain(args);
    } catch (e) {
        code = typeof e?.status === 'number' ? e.status : 2;
    }
    let output = null;
    try {
        if (outputPath) output = mod.FS.readFile(outputPath);
    } catch {
        output = null;
    }
    // Los mensajes pueden contener nombres de archivo virtuales; nunca contraseñas ni contenido.
    return { code, stderr: lines.join('\n'), output };
}

/** ¿El PDF está cifrado? */
export async function isEncrypted(bytes) {
    const r = await runQpdf(['--is-encrypted', '/in.pdf'], { '/in.pdf': bytes }, null);
    return r.code === 0;
}

/** ¿Se necesita contraseña para abrirlo? (false si solo tiene contraseña de permisos) */
export async function requiresPassword(bytes) {
    const r = await runQpdf(['--requires-password', '/in.pdf'], { '/in.pdf': bytes }, null);
    return r.code === 0;
}
