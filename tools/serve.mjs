// Servidor estático mínimo SOLO para desarrollo y pruebas locales.
// En producción basta con subir los archivos a cualquier hosting (Apache, Nginx, cPanel...).
// Uso: node tools/serve.mjs [puerto]
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const port = Number(process.argv[2] || process.env.PORT || 5173);

const types = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.wasm': 'application/wasm',
    '.woff2': 'font/woff2',
    '.ttf': 'font/ttf',
    '.bcmap': 'application/octet-stream',
    '.pfb': 'application/octet-stream',
    '.pdf': 'application/pdf',
};

createServer(async (req, res) => {
    try {
        const url = new URL(req.url, 'http://localhost');
        let path = normalize(join(root, decodeURIComponent(url.pathname)));
        if (!path.startsWith(root)) {
            res.writeHead(403).end();
            return;
        }
        if ((await stat(path)).isDirectory()) path = join(path, 'index.html');
        const body = await readFile(path);
        res.writeHead(200, {
            'Content-Type': types[extname(path).toLowerCase()] || 'application/octet-stream',
            'Cache-Control': 'no-store',
        });
        res.end(body);
    } catch {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('No encontrado');
    }
}).listen(port, () => console.log(`Herramienta PDF en http://localhost:${port}`));
