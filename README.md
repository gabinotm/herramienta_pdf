# PDF PRO — Herramientas PDF en el navegador

Sistema web de herramientas PDF en español, al estilo de Smallpdf: unir, dividir, comprimir, convertir, editar, firmar, proteger y más.

**Todo se procesa en el navegador del usuario.** No hay servidor de procesamiento, base de datos, cuentas ni historial:

- Los archivos nunca salen del equipo del usuario.
- El resultado solo existe en la memoria del navegador. Se libera al salir de la página o, como máximo, **30 minutos** después de procesarlo.

Está hecho con **HTML, CSS y JavaScript sin framework ni compilación**, así que funciona en cualquier hosting estático (cPanel/Apache, Nginx, GitHub Pages, etc.).

---

## 1. Requisitos

**Para publicar**
- Cualquier hosting que sirva archivos estáticos por HTTP o HTTPS.
- No se puede abrir con doble clic (`file://`), porque los navegadores bloquean los módulos JS y WebAssembly en ese modo.

**Para usar**
- Un navegador moderno: Chrome/Edge 100+, Firefox 110+ o Safari 16.4+, en escritorio o móvil.

**Para el OCR**
- Conexión a internet la primera vez. El motor (tesseract.js) y los diccionarios de español e inglés (unos 15 MB) se descargan de jsDelivr y quedan en la caché del navegador.

## 2. Instalación en el hosting

Para probarla en tu PC, haz doble clic en `iniciar-local.bat` (abre `http://localhost:5173`). Abrir `index.html` con doble clic no funciona: el navegador bloquea módulos, workers y WebAssembly en `file://`.

Sube estas carpetas y archivos a la raíz del sitio (o a una subcarpeta):

```
index.html
.htaccess        (opcional, recomendado en Apache/cPanel)
css/
js/
img/
vendor/
```

Son unos **9 MB**. **No hace falta subir** `node_modules/`, `tests/`, `tools/`, `package.json` ni el resto de archivos de desarrollo (el `.htaccess` bloquea el acceso a ellos por si se suben).

El `.htaccess` hace tres cosas:
- declara el tipo MIME `application/wasm`, que usa qpdf;
- activa la caché y la compresión;
- añade cabeceras de seguridad.

En Nginx, añade `application/wasm wasm;` a `mime.types`.

## 3. Configuración

Los límites se configuran en [`js/config.js`](js/config.js). No hay variables de entorno, porque no hay servidor.

| Opción | Valor por defecto | Descripción |
|---|---|---|
| `maxFileMB` | 100 | Tamaño máximo por archivo |
| `maxFiles` | 20 | Archivos por operación |
| `maxPages` | 500 | Páginas máximas por documento |
| `resultTTLMinutes` | 30 | Minutos hasta liberar el resultado de la memoria |
| `tesseract.*` | jsDelivr, versión 5.1.1 | Origen del motor de OCR y de los idiomas |

No hay claves ni contraseñas en el código.

## 4. Arquitectura

```
index.html            Estructura base, carga de estilos y librerías base
css/style.css         Diseño (tokens de color, modo claro/oscuro, responsive)
js/app.js             Enrutador por hash (#/unir-pdf), página de inicio, buscador y tema
js/config.js          Límites configurables
js/core/              Módulos compartidos
  flow.js             Flujo común de 3 pasos: subir → configurar → descargar
  files.js            Validación por contenido real (magic bytes), límites y nombres de salida
  pdf.js              pdf.js (lectura/renderizado) y pdf-lib (escritura)
  qpdf.js             qpdf en WebAssembly (AES-256, descifrado, reparación, aplanado)
  pagegrid.js         Cuadrícula de miniaturas (seleccionar, arrastrar, rotar, eliminar)
  editor.js           Editor de páginas (Fabric.js) para Editar y Firmar
  signature.js        Diálogo de firma (dibujar, escribir, subir)
  docx.js             Generador de .docx propio
  pptx-render.js      Renderizador de .pptx propio
  htmlpdf.js          HTML → páginas PDF con capa de texto buscable
  stamp.js            Posicionamiento en páginas giradas (marca de agua, numeración)
  text.js, ranges.js, errors.js, dom.js
js/tools/             Una herramienta por archivo (id, título, categoría y setup/run)
vendor/               Librerías con versión fija, incluidas en el proyecto (sin CDN)
tests/                Pruebas E2E (Playwright) y generador de archivos de prueba
tools/serve.mjs       Servidor estático mínimo para desarrollo
```

Cada herramienta exporta un objeto con `id`, `title`, `input` (tipo de archivo) y `setup(ctx)`. `setup` devuelve `{ options, validate, run(progress) }` y `flow.js` se encarga del resto:
- la zona de subida (arrastrar, elegir o pegar con Ctrl+V);
- la validación;
- la barra de progreso real;
- los errores en español;
- la pantalla de resultado;
- "Continuar con otra herramienta", que pasa el archivo resultante sin volver a subirlo.

### Librerías incluidas en `vendor/`

| Librería | Versión | Licencia | Uso |
|---|---|---|---|
| pdf-lib | 1.17.1 | MIT | Crear y modificar PDF |
| pdf.js (legacy) | 4.10.38 | Apache-2.0 | Leer y renderizar PDF. Se usa con `isEvalSupported: false` (mitigación de CVE-2024-4367) |
| qpdf (WebAssembly) | 12.2 (@neslinesli93/qpdf-wasm 0.3.0) | Apache-2.0 / ISC | Cifrado AES-256, descifrado, reparación, aplanado, optimización |
| JSZip | 3.10.1 | MIT | ZIP, .docx y .pptx |
| SortableJS | 1.15.6 | MIT | Arrastrar y soltar |
| SheetJS | 0.20.3 | Apache-2.0 | Leer y escribir Excel |
| PptxGenJS | 4.0.1 | MIT | Crear PowerPoint |
| Fabric.js | 5.3.0 | MIT | Editor visual |
| docx-preview | 0.3.6 | Apache-2.0 | Renderizar Word |
| html2canvas | 1.4.1 | MIT | Capturar HTML |
| jsdiff | 5.2.0 | BSD-3 | Comparar textos |
| Font Awesome Free | 6.5.1 | CC BY 4.0 / OFL / MIT | Íconos |

Solo se cargan desde internet, y solo cuando se necesitan:
- **tesseract.js 5.1.1**: el motor de OCR, desde jsDelivr (versión fija).
- **Google Fonts**: 4 fuentes manuscritas para la firma escrita. Si no cargan, se usa una cursiva del sistema.

## 5. Herramientas y estado

✅ = funciona y tiene prueba automática que pasa en escritorio (y en móvil las marcadas 📱).

| # | Herramienta | Estado | Cómo funciona | Limitaciones conocidas |
|---|---|---|---|---|
| 1 | Unir PDF | ✅ 📱 | Tarjetas por archivo, arrastrar para ordenar, miniaturas | — |
| 2 | Dividir PDF | ✅ | Por rangos (`1-3,5,8-10`), cada N páginas o una por archivo. Genera PDF o ZIP | — |
| 3 | Extraer páginas | ✅ | Miniaturas y rango sincronizados, Mayús+clic, opción ZIP | — |
| 4 | Eliminar páginas | ✅ 📱 | Miniaturas y rango | No permite eliminar todas las páginas |
| 5 | Organizar PDF | ✅ | Arrastrar, rotar y eliminar por página; añadir más PDF | — |
| 6 | Rotar PDF | ✅ | 90/180/270°, todas o las seleccionadas | — |
| 7 | Comprimir PDF | ✅ | Recomprime las imágenes JPEG/Flate de 8 bits según el nivel (Básico/Recomendado/Máximo) y optimiza con qpdf (object streams, recompresión Flate). Muestra el peso original, el final y el % | No hay Ghostscript en el navegador: no recomprime imágenes CMYK, indexadas, de 1 bit ni con máscaras de color, ni reduce fuentes. Los PDF de solo texto se reducen poco. Si no se reduce, devuelve el original y lo avisa |
| 8 | Reparar PDF | ✅ | qpdf (reconstruye la tabla xref) → pdf-lib (lectura secuencial) → pdf.js (recupera las páginas legibles como imagen) | En el último método el texto deja de ser seleccionable (se avisa y se sugiere OCR) |
| 9 | OCR | ✅ | tesseract.js en español, inglés o ambos. Capa de texto invisible sobre la página original | Necesita internet la primera vez. Puede tardar varios segundos por página. La precisión depende del escaneo |
| 10 | PDF a Word | ✅ | Modo editable (párrafos con tamaño, negrita, cursiva y alineación), modo "diseño exacto" (página como imagen) o ambos | No reconstruye tablas, columnas ni imágenes en el modo editable. Los PDF escaneados necesitan OCR antes |
| 11 | PDF a Excel | ✅ | Detecta filas y columnas por la posición del texto. Convierte números (`1.234,56`, `2.50`) | Las tablas con celdas combinadas o con diseños complejos pueden necesitar ajustes. No incluye imágenes |
| 12 | PDF a PowerPoint | ✅ | Una diapositiva por página, en alta calidad, con el texto de la página en las notas | El contenido de la diapositiva es una imagen: no se edita como texto |
| 13 | PDF a JPG/PNG | ✅ | Página a imagen (72/150/300 ppp, calidad JPG) o extracción de imágenes incrustadas. Una imagen o ZIP | — |
| 15 | Word a PDF | ✅ | Solo `.docx`. Resultado con texto buscable | Las fuentes que no estén instaladas se sustituyen. Encabezados y pies solo una vez por sección. Los `.doc` y `.odt` muestran un error claro con instrucciones |
| 16 | Excel a PDF | ✅ | `.xlsx`, `.xls`, `.ods` y `.csv`. Tabla paginada con texto seleccionable, orientación y ajuste al ancho | No reproduce colores, bordes personalizados, gráficos ni celdas combinadas |
| 17 | PowerPoint a PDF | ✅ | Solo `.pptx`, con un renderizador propio: fondos, textos del tema, viñetas, formas, imágenes, tablas y grupos. Texto buscable | Sin animaciones, vídeo, gráficos, SmartArt, WordArt ni sombras. Las imágenes EMF/WMF no se muestran. Los `.ppt` y `.odp` muestran un error claro |
| 18 | JPG/PNG a PDF | ✅ 📱 | Varias imágenes (JPG, PNG, WEBP, GIF), reordenar, A4/Carta/ajustar a la imagen, orientación y márgenes. Respeta la orientación EXIF de las fotos | Los GIF animados usan solo el primer cuadro |
| 20 | Editar PDF | ✅ | Texto (Helvetica/Times/Courier, tamaño, color, negrita, cursiva), imágenes, rectángulos, elipses, líneas, resaltado, dibujo a mano alzada y comentarios. Mover, redimensionar, borrar, deshacer y rehacer | El texto se incrusta como texto vectorial real con fuentes estándar: si lleva caracteres fuera del alfabeto latino, se incrusta como imagen. Formas y dibujos se incrustan como imagen de alta resolución. Los comentarios son anotaciones PDF reales. No edita el texto que ya tenía el PDF |
| 21 | Firmar PDF | ✅ 📱 | Firma dibujada, escrita (4 fuentes) o subida (quitando el fondo blanco), iniciales y fecha. Se coloca y redimensiona en cualquier página, incluso girada | Es una firma visual (imagen), no una firma digital con certificado |
| 22 | Rellenar formulario | ✅ | Detecta campos AcroForm (texto, casillas, opción única y listas), los rellena y opcionalmente los aplana | Los formularios XFA (dinámicos) no se pueden rellenar; se avisa |
| 23 | Marca de agua | ✅ | Texto o imagen, opacidad, rotación, 9 posiciones o mosaico, encima o debajo del contenido, rango de páginas. Vista previa real | Si se elige "debajo" en un escaneo, el fondo de la imagen la tapa (es lo esperado) |
| 24 | Numerar páginas | ✅ 📱 | 6 posiciones, 5 formatos ("1", "Página 1 de N"…), número inicial, rango, tamaño, margen y color. Vista previa real | — |
| 25 | Proteger PDF | ✅ 📱 | qpdf con AES-256 (`/AESV3`), permisos de impresión, copia, modificación y comentarios, contraseña de propietario opcional | — |
| 26 | Desbloquear PDF | ✅ | Distingue "contraseña incorrecta", "no protegido" y "solo tiene restricciones" (que se quitan sin contraseña) | Solo con la contraseña correcta: no descifra por fuerza bruta |
| 27 | Recortar PDF | ✅ | Recuadro arrastrable (ratón, táctil o teclado), para la página actual o para todas | Usa CropBox/TrimBox: el contenido recortado sigue dentro del archivo, pero oculto |
| 28 | Aplanar PDF | ✅ | qpdf `--generate-appearances --flatten-annotations` (todo o solo lo imprimible) | — |
| 29 | Comparar PDF | ✅ | Diferencias palabra por palabra (añadido en verde, eliminado en rojo), estadísticas e informe HTML descargable | Solo compara texto, no formato ni imágenes |

### No incluidas (y por qué)

| # | Herramienta | Motivo |
|---|---|---|
| 14 | PDF a PDF/A | Para generar un PDF/A válido hay que incrustar todas las fuentes, convertir los colores a un perfil ICC y validar el resultado (Ghostscript + veraPDF). Nada de eso existe en el navegador. Poner metadatos "PDF/A" sin cumplir la norma sería un resultado falso, así que no se ofrece. |
| 19 | HTML/URL a PDF | Opcional en el encargo. Desde el navegador no se pueden descargar otras páginas web (CORS), y hace falta un Chromium en un servidor. |

Si en el futuro se añade un backend (por ejemplo, FastAPI + Ghostscript + LibreOffice en Docker), habría que migrar primero PDF/A, HTML a PDF, `.doc`, `.odt`, `.ppt` y `.odp`, y la compresión con Ghostscript.

## 6. Seguridad y privacidad

- Ningún archivo se envía a un servidor. Esto se puede comprobar en la pestaña "Red" del navegador: solo se descargan los archivos del propio sitio y, para el OCR, el motor y los idiomas.
- Cada archivo se valida por su **contenido real**, no solo por la extensión:
  - PDF por la cabecera `%PDF-`;
  - imágenes por su firma;
  - Office abriendo el ZIP y comprobando su estructura interna.
- Cada ejecución de qpdf se hace en una instancia WebAssembly nueva, con un sistema de archivos virtual aislado y los argumentos como lista (sin shell).
- Las contraseñas no se registran en ningún sitio y se borran de los campos al terminar.
- pdf.js se ejecuta con `isEvalSupported: false`.
- Las librerías llevan versión fija y están alojadas en el propio sitio. No se usa `@latest`.

## 7. Accesibilidad

- Se puede usar con teclado:
  - la zona de subida responde a Enter/Espacio;
  - las miniaturas se seleccionan con Espacio y con Mayús para rangos;
  - el recorte se mueve con las flechas;
  - el editor responde a Ctrl+Z, Ctrl+Y y Supr.
- Etiquetas ARIA en los botones de solo ícono, `aria-live` para el progreso y los errores, y foco atrapado en el diálogo de firma.
- Contraste AA en ambos temas y respeto a `prefers-reduced-motion`.
- Responsive. En móvil, el botón principal queda fijo en la parte inferior.

## 8. Desarrollo y pruebas

Requisitos: Node.js 18+.

```bash
npm install
npm run serve        # http://localhost:5173
npm run fixtures     # regenera tests/fixtures (normal, escaneado, protegido, dañado, formulario, 120 páginas, rotado, docx/xlsx/ods/pptx, imágenes)
npx playwright install chromium
npm test             # pruebas de extremo a extremo (escritorio + móvil)
npm run lint         # ESLint
npm run format       # Prettier
```

Las pruebas (`tests/e2e/*.spec.js`) recorren el flujo completo de cada herramienta:
1. suben un archivo real;
2. configuran;
3. procesan;
4. descargan;
5. verifican el resultado con pdf-lib, pdf.js, JSZip o SheetJS: páginas, texto extraíble, rotaciones, cifrado `/AESV3`, campos de formulario, posiciones en páginas giradas, etc.

También prueban los casos límite: archivo vacío, formato falso, PDF protegido, contraseña incorrecta, `.doc` antiguo y PDF sin formulario.

**Estado actual: 54 pruebas pasan (escritorio y móvil).**

> Nota para Windows con políticas que bloquean ejecutables en `AppData`: instala o copia los navegadores de Playwright en otra unidad y define `PLAYWRIGHT_BROWSERS_PATH` (por ejemplo, `set PLAYWRIGHT_BROWSERS_PATH=E:\APP\.pw-browsers`).
