// Cuadrícula de miniaturas de páginas: selección, reordenar (arrastrar), rotar y eliminar.
// El orden real siempre se lee del DOM mediante claves únicas (evita índices desfasados).
import { h, icon } from './dom.js';
import { renderPage } from './pdf.js';
import { openViewer } from './viewer.js';

let keySeq = 0;

/**
 * @param {object} opts
 *  docs: [{ doc (pdf.js), name }]
 *  selectable: 'none' | 'select' | 'delete'
 *  sortable, rotatable, removable: boolean
 *  onChange: () => void
 */
export function createPageGrid({ docs = [], selectable = 'none', sortable = false, rotatable = false, removable = false, onChange = () => { }, showFileBadge = false }) {
    const grid = h('div', { class: 'page-grid', role: selectable !== 'none' ? 'group' : 'list' });
    const items = new Map(); // key -> item
    let lastClicked = null;
    let destroyed = false;

    // Cola de renderizado con concurrencia limitada.
    const queue = [];
    let active = 0;
    const pump = () => {
        while (active < 2 && queue.length && !destroyed) {
            const job = queue.shift();
            active++;
            job().finally(() => {
                active--;
                pump();
            });
        }
    };
    const observer = new IntersectionObserver(entries => {
        for (const entry of entries) {
            if (!entry.isIntersecting) continue;
            observer.unobserve(entry.target);
            const item = items.get(entry.target.dataset.key);
            if (item) enqueueRender(item);
        }
    }, { rootMargin: '300px' });

    function enqueueRender(item) {
        queue.push(async () => {
            if (destroyed || !items.has(item.key)) return;
            try {
                const page = await item.doc.getPage(item.pageIndex + 1);
                const base = page.getViewport({ scale: 1, rotation: (page.rotate + item.rotation) % 360 });
                const scale = (170 * (window.devicePixelRatio || 1)) / Math.max(base.width, base.height);
                const { canvas } = await renderPage(page, { scale, rotation: item.rotation });
                canvas.setAttribute('aria-hidden', 'true');
                item.thumb.replaceChildren(canvas);
            } catch {
                item.thumb.replaceChildren(h('span', { class: 'muted small', text: 'Sin vista previa' }));
            }
        });
        pump();
    }

    function makeItem(docIndex, pageIndex) {
        const d = docs[docIndex];
        const key = `p${++keySeq}`;
        const thumb = h('div', { class: 'thumb-wrap' }, h('span', { class: 'spinner' }));
        const label = h('div', { class: 'page-label' });
        const card = h('div', {
            class: `page-card${selectable !== 'none' ? ' selectable' : ''}${sortable ? ' sortable' : ''}`,
            dataset: { key },
            role: selectable !== 'none' ? 'checkbox' : 'listitem',
            tabindex: selectable !== 'none' ? '0' : null,
            'aria-checked': selectable !== 'none' ? 'false' : null,
        });
        const item = { key, docIndex, pageIndex, doc: d.doc, rotation: 0, selected: false, card, thumb, label };
        const actions = h('div', { class: 'page-actions' });
        const preview = () => openViewer({
            pdfDoc: d.doc, name: d.name, page: pageIndex,
            // Muestra cada página con la rotación que tiene en la cuadrícula
            rotation: i => getItems().find(it => it.docIndex === docIndex && it.pageIndex === i)?.rotation || 0,
        });
        actions.append(h('button', {
            type: 'button', class: 'zoom-btn', 'aria-label': `Ver página ${pageIndex + 1} con zoom`, title: 'Vista previa con zoom',
            onclick: e => { e.stopPropagation(); preview(); },
        }, icon('fa-magnifying-glass-plus')));
        card.addEventListener('dblclick', e => {
            e.preventDefault();
            preview();
        });
        if (rotatable) {
            actions.append(
                h('button', { type: 'button', 'aria-label': `Rotar a la izquierda página ${pageIndex + 1}`, title: 'Rotar a la izquierda', onclick: e => { e.stopPropagation(); rotate(item, -90); } }, icon('fa-rotate-left')),
                h('button', { type: 'button', 'aria-label': `Rotar a la derecha página ${pageIndex + 1}`, title: 'Rotar a la derecha', onclick: e => { e.stopPropagation(); rotate(item, 90); } }, icon('fa-rotate-right')),
            );
        }
        if (removable) {
            actions.append(h('button', {
                type: 'button', class: 'del', 'aria-label': `Eliminar página ${pageIndex + 1}`, title: 'Eliminar página',
                onclick: e => { e.stopPropagation(); remove(item); },
            }, icon('fa-trash')));
        }
        card.append(...[
            selectable !== 'none' ? h('span', { class: 'page-check', 'aria-hidden': 'true' }, icon(selectable === 'delete' ? 'fa-xmark' : 'fa-check')) : null,
            showFileBadge && docs.length > 1 ? h('span', { class: 'file-badge', title: d.name, text: String.fromCharCode(65 + (docIndex % 26)) }) : null,
            thumb, label,
            actions.childElementCount ? actions : null,
        ].filter(Boolean));
        if (selectable !== 'none') {
            card.addEventListener('click', e => toggle(item, e.shiftKey));
            card.addEventListener('keydown', e => {
                if (e.key === ' ' || e.key === 'Enter') {
                    e.preventDefault();
                    toggle(item, e.shiftKey);
                }
            });
        }
        items.set(key, item);
        observer.observe(card);
        return item;
    }

    function toggle(item, range) {
        const ordered = getItems();
        if (range && lastClicked && items.has(lastClicked.key)) {
            const a = ordered.indexOf(lastClicked);
            const b = ordered.indexOf(item);
            const [from, to] = a < b ? [a, b] : [b, a];
            const value = !item.selected;
            for (let i = from; i <= to; i++) setSelected(ordered[i], value);
        } else {
            setSelected(item, !item.selected);
        }
        lastClicked = item;
        refreshLabels();
        onChange();
    }

    function setSelected(item, value) {
        item.selected = value;
        item.card.classList.toggle(selectable === 'delete' ? 'marked-delete' : 'selected', value);
        item.card.setAttribute('aria-checked', String(value));
    }

    function rotate(item, delta) {
        item.rotation = (item.rotation + delta + 360) % 360;
        item.thumb.replaceChildren(h('span', { class: 'spinner' }));
        enqueueRender(item);
        refreshLabels();
        onChange();
    }

    function remove(item) {
        observer.unobserve(item.card);
        item.card.remove();
        items.delete(item.key);
        refreshLabels();
        onChange();
    }

    function refreshLabels() {
        getItems().forEach((item, i) => {
            const rot = item.rotation ? ` · ${item.rotation}°` : '';
            const origin = docs.length > 1 ? `${String.fromCharCode(65 + (item.docIndex % 26))}${item.pageIndex + 1}` : `${item.pageIndex + 1}`;
            item.label.textContent = sortable ? `${i + 1} (pág. ${origin})${rot}` : `Página ${origin}${rot}`;
            item.card.setAttribute('aria-label', `Página ${origin}${rot}${item.selected ? (selectable === 'delete' ? ', marcada para eliminar' : ', seleccionada') : ''}`);
        });
    }

    function addDoc(entry) {
        docs.push(entry);
        const docIndex = docs.length - 1;
        for (let p = 0; p < entry.doc.numPages; p++) grid.append(makeItem(docIndex, p).card);
        refreshLabels();
        onChange();
    }

    /** Ítems en el orden actual del DOM. */
    function getItems() {
        return Array.from(grid.children).map(el => items.get(el.dataset.key)).filter(Boolean);
    }

    docs.forEach((d, docIndex) => {
        for (let p = 0; p < d.doc.numPages; p++) grid.append(makeItem(docIndex, p).card);
    });
    refreshLabels();

    let sortableInstance = null;
    if (sortable) {
        sortableInstance = Sortable.create(grid, {
            animation: 180,
            ghostClass: 'ghost',
            filter: 'button, .page-actions',
            preventOnFilter: false,
            delay: 150,
            delayOnTouchOnly: true,
            onEnd: () => {
                refreshLabels();
                onChange();
            },
        });
    }

    return {
        el: grid,
        getItems,
        addDoc,
        docs,
        selectAll(value = true) {
            getItems().forEach(it => setSelected(it, value));
            refreshLabels();
            onChange();
        },
        invert() {
            getItems().forEach(it => setSelected(it, !it.selected));
            refreshLabels();
            onChange();
        },
        /** Selecciona por índices de página (base 0) del primer documento. */
        selectIndices(indices) {
            const set = new Set(indices);
            getItems().forEach(it => setSelected(it, set.has(it.pageIndex)));
            refreshLabels();
            onChange();
        },
        rotateAll(delta, onlySelected = false) {
            getItems().forEach(it => {
                if (!onlySelected || it.selected) rotate(it, delta);
            });
        },
        resetRotation() {
            getItems().forEach(it => {
                if (it.rotation) rotate(it, -it.rotation);
            });
        },
        destroy() {
            destroyed = true;
            observer.disconnect();
            sortableInstance?.destroy();
            queue.length = 0;
        },
    };
}
