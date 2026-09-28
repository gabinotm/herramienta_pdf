// Renderizador propio de presentaciones .pptx a HTML (subconjunto de PresentationML).
// Soporta: fondos (color, degradado simple, imagen), formas con relleno/borde, texto con estilos,
// viñetas y alineación, marcadores de posición heredados del diseño/patrón, imágenes, tablas y grupos.
// No soporta: animaciones, vídeo, SmartArt, gráficos, WordArt y efectos (sombras, reflejos).

const NS = {
    p: 'http://schemas.openxmlformats.org/presentationml/2006/main',
    a: 'http://schemas.openxmlformats.org/drawingml/2006/main',
    r: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
};
const EMU_PT = 12700;

const kids = (el, ns, name) => (el ? Array.from(el.children).filter(c => c.namespaceURI === NS[ns] && c.localName === name) : []);
const kid = (el, ns, name) => kids(el, ns, name)[0] || null;
const path = (el, ...steps) => steps.reduce((cur, s) => (cur ? kid(cur, ...s.split(':')) : null), el);
const attr = (el, name, def = null) => (el && el.getAttribute(name) !== null ? el.getAttribute(name) : def);
const rAttr = (el, name) => (el ? el.getAttributeNS(NS.r, name) : null);

function resolvePath(base, target) {
    if (target.startsWith('/')) return target.slice(1);
    const parts = base.split('/');
    parts.pop();
    for (const seg of target.split('/')) {
        if (seg === '..') parts.pop();
        else if (seg !== '.') parts.push(seg);
    }
    return parts.join('/');
}

// ---------- Colores ----------

function hexToRgb(hex) {
    const n = parseInt(hex, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgbToHsl([r, g, b]) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    let hh = 0;
    let s = 0;
    const l = (max + min) / 2;
    if (max !== min) {
        const d = max - min;
        s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
        hh = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
        hh /= 6;
    }
    return [hh, s, l];
}

function hslToRgb([hh, s, l]) {
    if (!s) return [l * 255, l * 255, l * 255];
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    const f = t => {
        if (t < 0) t += 1;
        if (t > 1) t -= 1;
        if (t < 1 / 6) return p + (q - p) * 6 * t;
        if (t < 1 / 2) return q;
        if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
        return p;
    };
    return [f(hh + 1 / 3) * 255, f(hh) * 255, f(hh - 1 / 3) * 255];
}

class Theme {
    constructor(doc) {
        this.colors = {};
        this.fonts = { major: 'Calibri', minor: 'Calibri' };
        if (!doc) return;
        const scheme = doc.getElementsByTagNameNS(NS.a, 'clrScheme')[0];
        if (scheme) {
            for (const c of Array.from(scheme.children)) {
                const v = c.firstElementChild;
                if (!v) continue;
                this.colors[c.localName] = v.localName === 'sysClr' ? attr(v, 'lastClr', attr(v, 'val') === 'window' ? 'FFFFFF' : '000000') : attr(v, 'val');
            }
        }
        const major = doc.getElementsByTagNameNS(NS.a, 'majorFont')[0];
        const minor = doc.getElementsByTagNameNS(NS.a, 'minorFont')[0];
        if (major) this.fonts.major = attr(kid(major, 'a', 'latin'), 'typeface', 'Calibri');
        if (minor) this.fonts.minor = attr(kid(minor, 'a', 'latin'), 'typeface', 'Calibri');
    }
}

/** Convierte un nodo de color de DrawingML (srgbClr, schemeClr, …) en CSS. */
function colorOf(node, ctx) {
    if (!node) return null;
    let hex = null;
    switch (node.localName) {
        case 'srgbClr': hex = attr(node, 'val'); break;
        case 'sysClr': hex = attr(node, 'lastClr', '000000'); break;
        case 'prstClr': return attr(node, 'val');
        case 'schemeClr': {
            let key = attr(node, 'val');
            if (key === 'phClr' && ctx.phColor) return ctx.phColor;
            key = ctx.clrMap[key] || key;
            hex = ctx.theme.colors[key] || '000000';
            break;
        }
        default: return null;
    }
    let rgb = hexToRgb(hex || '000000');
    let alpha = 1;
    for (const mod of Array.from(node.children)) {
        const v = Number(attr(mod, 'val', '100000')) / 100000;
        if (mod.localName === 'lumMod' || mod.localName === 'lumOff') {
            const hsl = rgbToHsl(rgb);
            hsl[2] = mod.localName === 'lumMod' ? hsl[2] * v : Math.min(1, hsl[2] + v);
            rgb = hslToRgb(hsl);
        } else if (mod.localName === 'tint') {
            rgb = rgb.map(c => c + (255 - c) * (1 - v));
        } else if (mod.localName === 'shade') {
            rgb = rgb.map(c => c * v);
        } else if (mod.localName === 'alpha') {
            alpha = v;
        }
    }
    const [r, g, b] = rgb.map(c => Math.round(Math.max(0, Math.min(255, c))));
    return alpha < 1 ? `rgba(${r},${g},${b},${alpha.toFixed(3)})` : `rgb(${r},${g},${b})`;
}

const firstColorChild = el => (el ? Array.from(el.children).find(c => /Clr$/.test(c.localName)) : null);

/** Relleno CSS a partir de solidFill / gradFill / blipFill / noFill. */
async function fillOf(parent, ctx, part) {
    if (!parent) return undefined;
    if (kid(parent, 'a', 'noFill')) return 'none';
    const solid = kid(parent, 'a', 'solidFill');
    if (solid) return colorOf(firstColorChild(solid), ctx);
    const grad = kid(parent, 'a', 'gradFill');
    if (grad) {
        const stops = kids(path(grad, 'a:gsLst'), 'a', 'gs').map(gs => `${colorOf(firstColorChild(gs), ctx)} ${Number(attr(gs, 'pos', 0)) / 1000}%`);
        const ang = Number(attr(kid(grad, 'a', 'lin'), 'ang', 0)) / 60000;
        return stops.length ? `linear-gradient(${ang + 90}deg, ${stops.join(', ')})` : undefined;
    }
    const blip = kid(parent, 'a', 'blipFill');
    if (blip) {
        const url = await ctx.media(part, rAttr(kid(blip, 'a', 'blip'), 'embed'));
        return url ? `url("${url}") center / cover no-repeat` : undefined;
    }
    return undefined;
}

// ---------- Presentación ----------

export class PptxDocument {
    static async load(buffer) {
        const d = new PptxDocument();
        d.zip = await JSZip.loadAsync(buffer);
        d.cache = new Map();
        d.mediaUrls = new Map();
        const pres = await d.xml('ppt/presentation.xml');
        const sz = pres.getElementsByTagNameNS(NS.p, 'sldSz')[0];
        d.width = Number(attr(sz, 'cx', 9144000)) / EMU_PT;
        d.height = Number(attr(sz, 'cy', 5143500)) / EMU_PT;
        const rels = await d.rels('ppt/presentation.xml');
        d.slides = Array.from(pres.getElementsByTagNameNS(NS.p, 'sldId')).map(s => rels[rAttr(s, 'id')]).filter(Boolean);
        return d;
    }

    async xml(name) {
        if (!this.cache.has(name)) {
            const f = this.zip.file(name);
            this.cache.set(name, f ? new DOMParser().parseFromString(await f.async('string'), 'application/xml') : null);
        }
        return this.cache.get(name);
    }

    async rels(part) {
        const i = part.lastIndexOf('/');
        const doc = await this.xml(`${part.slice(0, i)}/_rels/${part.slice(i + 1)}.rels`);
        const map = {};
        if (doc) {
            for (const r of Array.from(doc.getElementsByTagName('Relationship'))) {
                map[attr(r, 'Id')] = attr(r, 'TargetMode') === 'External' ? null : resolvePath(part, attr(r, 'Target'));
            }
        }
        return map;
    }

    async relOfType(part, type) {
        const i = part.lastIndexOf('/');
        const doc = await this.xml(`${part.slice(0, i)}/_rels/${part.slice(i + 1)}.rels`);
        const r = doc && Array.from(doc.getElementsByTagName('Relationship')).find(x => attr(x, 'Type', '').endsWith(`/${type}`));
        return r ? resolvePath(part, attr(r, 'Target')) : null;
    }

    async mediaUrl(part, rid) {
        if (!rid) return null;
        const target = (await this.rels(part))[rid];
        if (!target) return null;
        if (!this.mediaUrls.has(target)) {
            const f = this.zip.file(target);
            if (!f) return null;
            const ext = target.split('.').pop().toLowerCase();
            const mime = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', svg: 'image/svg+xml', bmp: 'image/bmp', webp: 'image/webp' }[ext];
            if (!mime) return null; // EMF/WMF/TIFF no se pueden mostrar en el navegador
            this.mediaUrls.set(target, URL.createObjectURL(new Blob([await f.async('uint8array')], { type: mime })));
        }
        return this.mediaUrls.get(target);
    }

    dispose() {
        for (const u of this.mediaUrls.values()) URL.revokeObjectURL(u);
        this.mediaUrls.clear();
    }

    /** Renderiza la diapositiva i como elemento HTML de tamaño (width × height) en pt. */
    async renderSlide(i) {
        const slidePart = this.slides[i];
        const layoutPart = await this.relOfType(slidePart, 'slideLayout');
        const masterPart = layoutPart ? await this.relOfType(layoutPart, 'slideMaster') : null;
        const themePart = masterPart ? await this.relOfType(masterPart, 'theme') : null;
        const [slide, layout, master, themeDoc] = await Promise.all([slidePart, layoutPart, masterPart, themePart].map(p => (p ? this.xml(p) : null)));
        const theme = new Theme(themeDoc);
        const clrMapEl = master && master.getElementsByTagNameNS(NS.p, 'clrMap')[0];
        const clrMap = {};
        if (clrMapEl) for (const a of Array.from(clrMapEl.attributes)) clrMap[a.name] = a.value;
        const ctx = { theme, clrMap, media: (part, rid) => this.mediaUrl(part, rid), master, layout, masterPart, layoutPart };

        const root = document.createElement('div');
        Object.assign(root.style, { position: 'relative', width: `${this.width}pt`, height: `${this.height}pt`, overflow: 'hidden', background: '#fff', fontFamily: `"${theme.fonts.minor}", Calibri, Arial, sans-serif`, color: '#000' });

        // Fondo: diapositiva → diseño → patrón
        for (const [doc, part] of [[slide, slidePart], [layout, layoutPart], [master, masterPart]]) {
            const bg = doc && path(doc.documentElement, 'p:cSld', 'p:bg');
            if (!bg) continue;
            const bgPr = kid(bg, 'p', 'bgPr');
            const bgRef = kid(bg, 'p', 'bgRef');
            let fill;
            if (bgPr) fill = await fillOf(bgPr, ctx, part);
            else if (bgRef) fill = colorOf(firstColorChild(bgRef), ctx);
            if (fill && fill !== 'none') {
                root.style.background = fill;
                break;
            }
        }

        const showMaster = attr(slide.documentElement, 'showMasterSp', '1') !== '0' && attr(layout?.documentElement, 'showMasterSp', '1') !== '0';
        if (master && showMaster) await this.renderTree(path(master.documentElement, 'p:cSld', 'p:spTree'), root, ctx, masterPart, true);
        if (layout) await this.renderTree(path(layout.documentElement, 'p:cSld', 'p:spTree'), root, ctx, layoutPart, true);
        await this.renderTree(path(slide.documentElement, 'p:cSld', 'p:spTree'), root, ctx, slidePart, false);
        return root;
    }

    /** Marcador de posición equivalente en diseño/patrón (para heredar posición y estilo). */
    findPlaceholder(ctx, ph) {
        const type = attr(ph, 'type', 'body');
        const idx = attr(ph, 'idx');
        const out = [];
        for (const doc of [ctx.layout, ctx.master]) {
            if (!doc) continue;
            const all = Array.from(doc.getElementsByTagNameNS(NS.p, 'ph'));
            const match = all.find(p => idx !== null && attr(p, 'idx') === idx && attr(p, 'type', 'body') === type)
                || all.find(p => attr(p, 'type', 'body') === type)
                || (idx !== null ? all.find(p => attr(p, 'idx') === idx) : null);
            let sp = match;
            while (sp && sp.localName !== 'sp') sp = sp.parentElement;
            if (sp) out.push(sp);
        }
        return out;
    }

    async renderTree(tree, parent, ctx, part, skipPlaceholders, group = null) {
        if (!tree) return;
        for (const node of Array.from(tree.children)) {
            try {
                if (node.localName === 'sp' || node.localName === 'cxnSp') await this.renderShape(node, parent, ctx, part, skipPlaceholders, group);
                else if (node.localName === 'pic') await this.renderPicture(node, parent, ctx, part, group);
                else if (node.localName === 'graphicFrame') await this.renderTable(node, parent, ctx, part, group);
                else if (node.localName === 'grpSp') await this.renderGroup(node, parent, ctx, part, skipPlaceholders, group);
            } catch {
                /* elemento no compatible: se omite */
            }
        }
    }

    xfrmBox(xfrm, group) {
        if (!xfrm) return null;
        const off = kid(xfrm, 'a', 'off');
        const ext = kid(xfrm, 'a', 'ext');
        if (!off || !ext) return null;
        let x = Number(attr(off, 'x', 0));
        let y = Number(attr(off, 'y', 0));
        let w = Number(attr(ext, 'cx', 0));
        let hgt = Number(attr(ext, 'cy', 0));
        if (group) {
            x = group.x + (x - group.chX) * group.sx;
            y = group.y + (y - group.chY) * group.sy;
            w *= group.sx;
            hgt *= group.sy;
        }
        return { x, y, w, h: hgt, rot: Number(attr(xfrm, 'rot', 0)) / 60000, flipH: attr(xfrm, 'flipH') === '1', flipV: attr(xfrm, 'flipV') === '1' };
    }

    place(el, box) {
        Object.assign(el.style, {
            position: 'absolute', left: `${box.x / EMU_PT}pt`, top: `${box.y / EMU_PT}pt`,
            width: `${box.w / EMU_PT}pt`, height: `${box.h / EMU_PT}pt`, boxSizing: 'border-box',
        });
        const t = [];
        if (box.rot) t.push(`rotate(${box.rot}deg)`);
        if (box.flipH) t.push('scaleX(-1)');
        if (box.flipV) t.push('scaleY(-1)');
        if (t.length) el.style.transform = t.join(' ');
    }

    async renderGroup(node, parent, ctx, part, skip, group) {
        const xfrm = path(node, 'p:grpSpPr', 'a:xfrm');
        const box = this.xfrmBox(xfrm, group);
        if (!box) return this.renderTree(node, parent, ctx, part, skip, group);
        const chOff = kid(xfrm, 'a', 'chOff');
        const chExt = kid(xfrm, 'a', 'chExt');
        const cw = Number(attr(chExt, 'cx', box.w)) || 1;
        const ch = Number(attr(chExt, 'cy', box.h)) || 1;
        const g = { x: box.x, y: box.y, chX: Number(attr(chOff, 'x', 0)), chY: Number(attr(chOff, 'y', 0)), sx: box.w / cw, sy: box.h / ch };
        await this.renderTree(node, parent, ctx, part, skip, g);
    }

    async renderShape(node, parent, ctx, part, skipPlaceholders, group) {
        const nv = kid(node, 'p', 'nvSpPr') || kid(node, 'p', 'nvCxnSpPr');
        const ph = nv && path(nv, 'p:nvPr', 'p:ph');
        if (ph && skipPlaceholders) return; // los marcadores del diseño/patrón no se dibujan por sí mismos
        const inherited = ph ? this.findPlaceholder(ctx, ph) : [];
        const spPr = kid(node, 'p', 'spPr');
        let box = this.xfrmBox(kid(spPr, 'a', 'xfrm'), group);
        for (const src of inherited) {
            if (box) break;
            box = this.xfrmBox(path(src, 'p:spPr', 'a:xfrm'), null);
        }
        if (!box) return;
        const el = document.createElement('div');
        this.place(el, box);

        // Relleno y borde (con estilo de tema p:style como alternativa)
        const style = kid(node, 'p', 'style');
        let fill = await fillOf(spPr, ctx, part);
        if (fill === undefined && style) fill = colorOf(firstColorChild(kid(style, 'a', 'fillRef')), ctx);
        if (fill && fill !== 'none') el.style.background = fill;
        const ln = kid(spPr, 'a', 'ln');
        let lineColor = ln ? await fillOf(ln, ctx, part) : undefined;
        if (lineColor === undefined && style && !(ln && kid(ln, 'a', 'noFill'))) lineColor = colorOf(firstColorChild(kid(style, 'a', 'lnRef')), ctx);
        const lineW = ln ? Number(attr(ln, 'w', 12700)) / EMU_PT : 1;
        const geom = attr(kid(spPr, 'a', 'prstGeom'), 'prst', 'rect');
        if (node.localName === 'cxnSp' || geom === 'line' || geom.startsWith('straightConnector')) {
            // Línea: se dibuja como borde superior (o diagonal aproximada con SVG)
            el.style.background = 'none';
            const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="100%" preserveAspectRatio="none" viewBox="0 0 100 100"><line x1="0" y1="0" x2="100" y2="${box.h ? 100 : 0}" stroke="${lineColor && lineColor !== 'none' ? lineColor : '#000'}" stroke-width="${Math.max(1, lineW)}" vector-effect="non-scaling-stroke"/></svg>`;
            el.innerHTML = svg;
            if (!box.h) el.style.height = `${Math.max(1, lineW)}pt`;
            parent.append(el);
            return;
        }
        if (lineColor && lineColor !== 'none') el.style.border = `${Math.max(0.5, lineW)}pt solid ${lineColor}`;
        if (geom === 'ellipse') el.style.borderRadius = '50%';
        else if (geom === 'roundRect') el.style.borderRadius = `${Math.min(box.w, box.h) / EMU_PT * 0.16}pt`;
        else if (geom === 'triangle') el.style.clipPath = 'polygon(50% 0, 100% 100%, 0 100%)';
        else if (geom === 'rightArrow') el.style.clipPath = 'polygon(0 25%, 60% 25%, 60% 0, 100% 50%, 60% 100%, 60% 75%, 0 75%)';

        const txBody = kid(node, 'p', 'txBody');
        if (txBody) {
            const phType = ph ? attr(ph, 'type', 'body') : null;
            el.append(await this.renderText(txBody, ctx, part, { phType, inherited, fontRefColor: style ? colorOf(firstColorChild(kid(style, 'a', 'fontRef')), ctx) : null }));
            el.style.display = 'flex';
            el.style.flexDirection = 'column';
            const anchor = attr(kid(txBody, 'a', 'bodyPr'), 'anchor') || (phType === 'title' || phType === 'ctrTitle' ? 'ctr' : 't');
            el.style.justifyContent = anchor === 'ctr' ? 'center' : anchor === 'b' ? 'flex-end' : 'flex-start';
        }
        parent.append(el);
    }

    /** Estilo por defecto (tamaño, negrita, color, viñeta) según el tipo de marcador y el nivel. */
    defaultLevelStyle(ctx, phType, lvl, inherited) {
        const lvlName = `lvl${lvl + 1}pPr`;
        const candidates = [];
        for (const src of inherited) {
            const lst = path(src, 'p:txBody', 'a:lstStyle');
            if (lst) candidates.push(kid(lst, 'a', lvlName));
        }
        const txStyles = ctx.master && ctx.master.getElementsByTagNameNS(NS.p, 'txStyles')[0];
        if (txStyles) {
            const which = phType === 'title' || phType === 'ctrTitle' ? 'titleStyle' : phType && phType !== 'dt' && phType !== 'ftr' && phType !== 'sldNum' ? 'bodyStyle' : 'otherStyle';
            candidates.push(kid(kid(txStyles, 'p', which), 'a', lvlName));
        }
        return candidates.filter(Boolean);
    }

    async renderText(txBody, ctx, part, { phType, inherited, fontRefColor }) {
        const bodyPr = kid(txBody, 'a', 'bodyPr');
        const box = document.createElement('div');
        const ins = n => `${Number(attr(bodyPr, n, n === 'tIns' || n === 'bIns' ? 45720 : 91440)) / EMU_PT}pt`;
        Object.assign(box.style, { padding: `${ins('tIns')} ${ins('rIns')} ${ins('bIns')} ${ins('lIns')}`, overflowWrap: 'break-word', lineHeight: '1.15' });
        const scale = Number(attr(kid(bodyPr, 'a', 'normAutofit'), 'fontScale', 100000)) / 100000;
        const isTitle = phType === 'title' || phType === 'ctrTitle';
        let autoNum = 0;
        for (const p of kids(txBody, 'a', 'p')) {
            const pPr = kid(p, 'a', 'pPr');
            const lvl = Number(attr(pPr, 'lvl', 0));
            const defaults = this.defaultLevelStyle(ctx, phType, lvl, inherited);
            const pick = (getter, def) => {
                for (const src of [pPr, ...defaults]) {
                    const v = src ? getter(src) : null;
                    if (v !== null && v !== undefined) return v;
                }
                return def;
            };
            const algn = pick(s => attr(s, 'algn'), isTitle && phType === 'ctrTitle' ? 'ctr' : 'l');
            const para = document.createElement('div');
            para.style.textAlign = { l: 'left', ctr: 'center', r: 'right', just: 'justify', dist: 'justify' }[algn] || 'left';
            const marL = pick(s => attr(s, 'marL'), null);
            const indent = pick(s => attr(s, 'indent'), null);
            if (marL !== null) para.style.paddingLeft = `${Number(marL) / EMU_PT}pt`;
            if (indent !== null) para.style.textIndent = `${Number(indent) / EMU_PT}pt`;
            const spcBef = pick(s => attr(path(s, 'a:spcBef', 'a:spcPts'), 'val'), null);
            if (spcBef !== null) para.style.marginTop = `${Number(spcBef) / 100}pt`;

            const defRPr = src => kid(src, 'a', 'defRPr');
            const baseSize = pick(s => attr(defRPr(s), 'sz'), isTitle ? '4400' : phType ? '2400' : '1800');
            const baseBold = pick(s => attr(defRPr(s), 'b'), '0') === '1';
            const baseColor = pick(s => colorOf(firstColorChild(kid(defRPr(s), 'a', 'solidFill')), ctx), fontRefColor);
            const runs = Array.from(p.children).filter(c => ['r', 'br', 'fld'].includes(c.localName));

            // Viñetas
            const noBullet = pick(s => (kid(s, 'a', 'buNone') ? true : null), false);
            const buChar = pick(s => attr(kid(s, 'a', 'buChar'), 'char'), null);
            const buAuto = pick(s => (kid(s, 'a', 'buAutoNum') ? attr(kid(s, 'a', 'buAutoNum'), 'type', 'arabicPeriod') : null), null);
            const hasText = runs.some(r => r.textContent.trim());
            if (hasText && !noBullet && (buChar || buAuto)) {
                const b = document.createElement('span');
                b.textContent = buAuto ? `${++autoNum}${buAuto.includes('Paren') ? ')' : '.'} ` : `${buChar === '' ? '•' : buChar} `;
                b.style.fontSize = `${(Number(baseSize) / 100) * scale}pt`;
                if (baseColor) b.style.color = baseColor;
                para.append(b);
            } else if (!buAuto) {
                autoNum = 0;
            }

            if (!runs.length) {
                para.innerHTML = '&nbsp;';
                para.style.fontSize = `${(Number(baseSize) / 100) * scale}pt`;
            }
            for (const r of runs) {
                if (r.localName === 'br') {
                    para.append(document.createElement('br'));
                    continue;
                }
                const rPr = kid(r, 'a', 'rPr');
                const span = document.createElement('span');
                span.textContent = path(r, 'a:t')?.textContent ?? '';
                span.style.whiteSpace = 'pre-wrap';
                span.style.fontSize = `${(Number(attr(rPr, 'sz', baseSize)) / 100) * scale}pt`;
                if (attr(rPr, 'b', baseBold ? '1' : '0') === '1') span.style.fontWeight = '700';
                if (attr(rPr, 'i') === '1') span.style.fontStyle = 'italic';
                if (attr(rPr, 'u') && attr(rPr, 'u') !== 'none') span.style.textDecoration = 'underline';
                if (attr(rPr, 'strike') && attr(rPr, 'strike') !== 'noStrike') span.style.textDecoration = 'line-through';
                const color = colorOf(firstColorChild(kid(rPr, 'a', 'solidFill')), ctx) || baseColor;
                if (color) span.style.color = color;
                let face = attr(kid(rPr, 'a', 'latin'), 'typeface');
                if (face === '+mj-lt') face = ctx.theme.fonts.major;
                if (face === '+mn-lt') face = ctx.theme.fonts.minor;
                if (!face && isTitle) face = ctx.theme.fonts.major;
                if (face) span.style.fontFamily = `"${face}", Calibri, Arial, sans-serif`;
                para.append(span);
            }
            box.append(para);
        }
        return box;
    }

    async renderPicture(node, parent, ctx, part, group) {
        const box = this.xfrmBox(path(node, 'p:spPr', 'a:xfrm'), group);
        if (!box) return;
        const url = await this.mediaUrl(part, rAttr(path(node, 'p:blipFill', 'a:blip'), 'embed'));
        if (!url) return;
        const img = document.createElement('img');
        img.src = url;
        img.alt = '';
        this.place(img, box);
        img.style.objectFit = 'fill';
        const geom = attr(path(node, 'p:spPr', 'a:prstGeom'), 'prst');
        if (geom === 'ellipse') img.style.borderRadius = '50%';
        parent.append(img);
    }

    async renderTable(node, parent, ctx, part, group) {
        const tbl = node.getElementsByTagNameNS(NS.a, 'tbl')[0];
        const box = this.xfrmBox(kid(node, 'p', 'xfrm'), group);
        if (!tbl || !box) return;
        const wrap = document.createElement('div');
        this.place(wrap, box);
        wrap.style.height = 'auto';
        const table = document.createElement('table');
        Object.assign(table.style, { borderCollapse: 'collapse', width: '100%', tableLayout: 'fixed' });
        const cols = kids(path(tbl, 'a:tblGrid'), 'a', 'gridCol').map(c => Number(attr(c, 'w', 0)) / EMU_PT);
        const colgroup = document.createElement('colgroup');
        cols.forEach(w => {
            const col = document.createElement('col');
            col.style.width = `${w}pt`;
            colgroup.append(col);
        });
        table.append(colgroup);
        for (const tr of kids(tbl, 'a', 'tr')) {
            const row = document.createElement('tr');
            row.style.height = `${Number(attr(tr, 'h', 0)) / EMU_PT}pt`;
            for (const tc of kids(tr, 'a', 'tc')) {
                if (attr(tc, 'hMerge') === '1' || attr(tc, 'vMerge') === '1') continue;
                const td = document.createElement('td');
                if (attr(tc, 'gridSpan')) td.colSpan = Number(attr(tc, 'gridSpan'));
                if (attr(tc, 'rowSpan')) td.rowSpan = Number(attr(tc, 'rowSpan'));
                Object.assign(td.style, { border: '0.75pt solid #9ca3af', verticalAlign: 'top', padding: '0' });
                const tcPr = kid(tc, 'a', 'tcPr');
                const fill = await fillOf(tcPr, ctx, part);
                if (fill && fill !== 'none') td.style.background = fill;
                const txBody = kid(tc, 'a', 'txBody');
                if (txBody) td.append(await this.renderText(txBody, ctx, part, { phType: null, inherited: [], fontRefColor: null }));
                row.append(td);
            }
            table.append(row);
        }
        wrap.append(table);
        parent.append(wrap);
    }
}
