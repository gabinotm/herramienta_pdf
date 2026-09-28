// Errores con mensaje pensado para el usuario final (en español).

export class UserError extends Error {
    constructor(message, { code = 'error', hint = '' } = {}) {
        super(message);
        this.name = 'UserError';
        this.code = code;
        this.hint = hint;
    }
}

export const Errors = {
    empty: name => new UserError(`El archivo "${name}" está vacío.`, { code: 'empty' }),
    tooBig: (name, maxMB) => new UserError(`El archivo "${name}" es demasiado pesado. El máximo permitido es ${maxMB} MB.`, { code: 'too_big' }),
    tooMany: max => new UserError(`Puedes procesar como máximo ${max} archivos a la vez.`, { code: 'too_many' }),
    tooManyPages: (name, max) => new UserError(`"${name}" tiene más de ${max} páginas, el máximo permitido.`, { code: 'too_many_pages' }),
    invalidFormat: (name, expected) => new UserError(`"${name}" no es un archivo ${expected} válido.`, {
        code: 'invalid_format',
        hint: 'Revisa que el archivo no tenga solo la extensión cambiada.',
    }),
    corrupt: name => new UserError(`No se pudo leer "${name}": el archivo parece estar dañado.`, {
        code: 'corrupt',
        hint: 'Prueba primero con la herramienta "Reparar PDF".',
    }),
    encrypted: name => new UserError(`"${name}" está protegido con contraseña.`, {
        code: 'encrypted',
        hint: 'Quítale la contraseña con la herramienta "Desbloquear PDF" y vuelve a intentarlo.',
    }),
    wrongPassword: () => new UserError('La contraseña es incorrecta.', { code: 'wrong_password' }),
    noText: () => new UserError('Este PDF no contiene texto seleccionable (parece escaneado).', {
        code: 'no_text',
        hint: 'Pásalo primero por la herramienta "OCR" para reconocer el texto.',
    }),
    timeout: () => new UserError('La operación tardó demasiado y se canceló.', { code: 'timeout' }),
    network: what => new UserError(`No se pudo descargar ${what}. Revisa tu conexión a internet.`, { code: 'network' }),
    memory: () => new UserError('Tu dispositivo se quedó sin memoria procesando este archivo. Prueba con un archivo más pequeño o con menos páginas.', { code: 'memory' }),
};

/** Convierte cualquier error en un UserError con un mensaje comprensible. */
export function toUserError(err, fileName = 'el archivo') {
    if (err instanceof UserError) return err;
    const msg = String(err?.message || err || '');
    const name = err?.name || '';
    if (name === 'PasswordException' || /encrypted|password/i.test(msg)) return Errors.encrypted(fileName);
    if (name === 'InvalidPDFException' || /Invalid PDF|Failed to parse|No PDF header|startxref|xref/i.test(msg)) return Errors.corrupt(fileName);
    if (name === 'RangeError' || /out of memory|Array buffer allocation/i.test(msg)) return Errors.memory();
    if (/Failed to fetch|NetworkError|No se pudo cargar/i.test(msg)) return Errors.network('un componente necesario');
    console.error(err);
    return new UserError('Ocurrió un error inesperado al procesar el archivo.', { code: 'unknown', hint: msg.slice(0, 160) });
}

/** Ejecuta una promesa con tiempo máximo. */
export function withTimeout(promise, ms) {
    let t;
    return Promise.race([
        promise,
        new Promise((_, reject) => {
            t = setTimeout(() => reject(Errors.timeout()), ms);
        }),
    ]).finally(() => clearTimeout(t));
}
