// Registro de herramientas y categorías.
import unir from './unir.js';
import dividir from './dividir.js';
import extraer from './extraer.js';
import eliminar from './eliminar.js';
import organizar from './organizar.js';
import rotar from './rotar.js';

export const CATEGORIES = {
    organizar: { title: 'Organizar PDF', short: 'Organizar', color: 'var(--cat-organizar)' },
    optimizar: { title: 'Optimizar PDF', short: 'Optimizar', color: 'var(--cat-optimizar)' },
    desde: { title: 'Convertir desde PDF', short: 'Desde PDF', color: 'var(--cat-desde)' },
    hacia: { title: 'Convertir a PDF', short: 'A PDF', color: 'var(--cat-hacia)' },
    editar: { title: 'Editar y firmar', short: 'Editar', color: 'var(--cat-editar)' },
    seguridad: { title: 'Seguridad', short: 'Seguridad', color: 'var(--cat-seguridad)' },
};

export const TOOLS = [
    unir, dividir, extraer, eliminar, organizar, rotar,
];
