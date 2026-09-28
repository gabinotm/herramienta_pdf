// Punto de entrada: enrutador por hash (#/herramienta), página de inicio y tema.
import { h, icon, clear, $ } from './core/dom.js';
import { mountTool } from './core/flow.js';
import { TOOLS, CATEGORIES } from './tools/index.js';

const app = document.getElementById('app');
let cleanup = null;
const homeState = { query: '', category: 'todas' };

function route() {
    if (cleanup) {
        cleanup();
        cleanup = null;
    }
    const id = decodeURIComponent(location.hash.replace(/^#\/?/, '')).split('?')[0];
    const tool = TOOLS.find(t => t.id === id);
    if (tool) {
        cleanup = mountTool(app, tool, { allTools: TOOLS, categories: CATEGORIES });
    } else {
        renderHome();
    }
    window.scrollTo(0, 0);
    $('#main').focus({ preventScroll: true });
}

function normalize(s) {
    return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

function renderHome() {
    document.title = 'PDF PRO — Herramientas PDF';
    const results = h('div', { id: 'toolResults' });
    const search = h('input', {
        type: 'search', placeholder: 'Buscar herramienta… (ej. unir, comprimir, firmar)',
        'aria-label': 'Buscar herramienta', value: homeState.query,
        oninput: e => {
            homeState.query = e.target.value;
            draw();
        },
    });
    const chipDefs = [{ id: 'todas', label: 'Todas' }, ...Object.entries(CATEGORIES).map(([id, c]) => ({ id, label: c.short }))];
    const chips = h('div', { class: 'chips', role: 'group', 'aria-label': 'Filtrar por categoría' },
        chipDefs.map(c => h('button', {
            type: 'button', class: 'chip', 'aria-pressed': String(homeState.category === c.id),
            onclick: e => {
                homeState.category = c.id;
                chips.querySelectorAll('.chip').forEach(b => b.setAttribute('aria-pressed', 'false'));
                e.currentTarget.setAttribute('aria-pressed', 'true');
                draw();
            },
        }, c.label)));

    function draw() {
        const q = normalize(homeState.query.trim());
        clear(results);
        let shown = 0;
        for (const [catId, cat] of Object.entries(CATEGORIES)) {
            if (homeState.category !== 'todas' && homeState.category !== catId) continue;
            const tools = TOOLS.filter(t => t.category === catId && (!q || normalize(`${t.title} ${t.description} ${t.keywords || ''}`).includes(q)));
            if (!tools.length) continue;
            shown += tools.length;
            results.append(h('section', { class: 'category-block', style: { '--cat': cat.color }, 'aria-labelledby': `cat-${catId}` },
                h('h2', { class: 'category-title', id: `cat-${catId}` }, h('span', { class: 'dot', 'aria-hidden': 'true' }), cat.title),
                h('div', { class: 'tool-grid' }, tools.map(t => h('a', { class: 'tool-card', href: `#/${t.id}` },
                    h('span', { class: 'tool-icon' }, icon(t.icon)),
                    h('span', {}, h('h3', { text: t.title }), h('p', { text: t.description })),
                ))),
            ));
        }
        if (!shown) results.append(h('p', { class: 'empty-search', role: 'status', text: `No hay herramientas que coincidan con "${homeState.query}".` }));
    }

    clear(app).append(
        h('section', { class: 'hero' },
            h('h1', { text: 'Todas las herramientas PDF que necesitas' }),
            h('p', { text: 'Une, divide, comprime, convierte, edita, firma y protege tus PDF gratis. Todo se procesa en tu navegador: tus archivos nunca salen de tu equipo.' }),
            h('div', { class: 'search-box' }, icon('fa-magnifying-glass'), search),
            chips,
        ),
        results,
    );
    draw();
}

// ---------- Tema claro / oscuro ----------

function currentTheme() {
    const forced = document.documentElement.dataset.theme;
    if (forced) return forced;
    return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

$('#themeToggle').addEventListener('click', () => {
    const next = currentTheme() === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try {
        localStorage.setItem('pdfpro-theme', next);
    } catch { /* almacenamiento no disponible */ }
    updateThemeLabel();
});

function updateThemeLabel() {
    const dark = currentTheme() === 'dark';
    $('#themeToggle').setAttribute('aria-label', dark ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro');
    $('#themeToggle').title = dark ? 'Modo claro' : 'Modo oscuro';
}

updateThemeLabel();
window.addEventListener('hashchange', route);
route();
