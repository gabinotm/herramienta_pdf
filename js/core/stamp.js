// Colocar texto o imágenes sobre páginas de pdf-lib en coordenadas de "pantalla"
// (lo que ve el usuario), respetando la rotación de la página y el CropBox.

/** Geometría visible de una página pdf-lib: tamaño mostrado y conversión a coordenadas del PDF. */
export function pageGeometry(page) {
    const rot = ((page.getRotation().angle % 360) + 360) % 360;
    const box = page.getCropBox();
    const swap = rot === 90 || rot === 270;
    const W = swap ? box.height : box.width; // ancho visible
    const H = swap ? box.width : box.height; // alto visible
    /** (x, y) visibles, origen abajo-izquierda → coordenadas de usuario del PDF (misma convención que pdf.js) */
    const toUser = (x, y) => {
        switch (rot) {
            case 90: return [box.x + box.width - y, box.y + x];
            case 180: return [box.x + box.width - x, box.y + box.height - y];
            case 270: return [box.x + y, box.y + box.height - x];
            default: return [box.x + x, box.y + y];
        }
    };
    // Ángulo que hay que sumar para que algo dibujado se vea horizontal en pantalla.
    const angle = rot;
    return { W, H, toUser, angle };
}

const rad = d => (d * Math.PI) / 180;

/** Punto de anclaje (esquina inferior izquierda) para centrar un rectángulo w×h girado `deg` en (cx, cy). */
function anchorFor(cx, cy, w, hgt, deg) {
    const a = rad(deg);
    const dx = -w / 2;
    const dy = -hgt / 2;
    return [cx + dx * Math.cos(a) - dy * Math.sin(a), cy + dx * Math.sin(a) + dy * Math.cos(a)];
}

/** Caja envolvente de un rectángulo w×h girado. */
export function rotatedBox(w, hgt, deg) {
    const a = rad(deg);
    return { w: Math.abs(w * Math.cos(a)) + Math.abs(hgt * Math.sin(a)), h: Math.abs(w * Math.sin(a)) + Math.abs(hgt * Math.cos(a)) };
}

/** Dibuja texto centrado en (cx, cy) visibles. */
export function drawCenteredText(page, text, { font, size, color, opacity = 1, rotate = 0, cx, cy }) {
    const g = pageGeometry(page);
    const w = font.widthOfTextAtSize(text, size);
    const capH = font.heightAtSize(size, { descender: false }) * 0.72;
    const [ax, ay] = anchorFor(cx, cy, w, capH, rotate);
    const [ux, uy] = g.toUser(ax, ay);
    page.drawText(text, { x: ux, y: uy, size, font, color, opacity, rotate: PDFLib.degrees(g.angle + rotate) });
}

export function drawCenteredImage(page, image, { width, height, opacity = 1, rotate = 0, cx, cy }) {
    const g = pageGeometry(page);
    const [ax, ay] = anchorFor(cx, cy, width, height, rotate);
    const [ux, uy] = g.toUser(ax, ay);
    page.drawImage(image, { x: ux, y: uy, width, height, opacity, rotate: PDFLib.degrees(g.angle + rotate) });
}

/** Mueve el último flujo de contenido al principio (lo dibujado queda debajo del contenido original). */
export function sendLastContentToBack(page) {
    const { PDFArray, PDFName } = PDFLib;
    const contents = page.node.normalizedEntries().Contents;
    if (!(contents instanceof PDFArray) || contents.size() < 2) return;
    const last = contents.get(contents.size() - 1);
    contents.remove(contents.size() - 1);
    contents.insert(0, last);
    page.node.set(PDFName.of('Contents'), contents);
}

export function hexToRgb(hex) {
    const n = parseInt(hex.replace('#', ''), 16);
    return PDFLib.rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}
