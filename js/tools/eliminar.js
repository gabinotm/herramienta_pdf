import { pageSelectTool } from './extraer.js';

export default {
    id: 'eliminar-paginas',
    title: 'Eliminar páginas',
    description: 'Quita del PDF las páginas que no necesitas.',
    keywords: 'borrar quitar suprimir paginas',
    category: 'organizar',
    icon: 'fa-file-circle-minus',
    input: 'pdf',
    actionLabel: 'Eliminar páginas',
    actionIcon: 'fa-trash',
    progressTitle: 'Eliminando páginas…',
    setup: pageSelectTool({ mode: 'delete' }),
};
