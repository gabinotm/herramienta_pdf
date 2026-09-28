// Límites configurables de la aplicación.
// Todo se procesa en el navegador del usuario: estos límites protegen la memoria del dispositivo.
export const CONFIG = {
    maxFileMB: 100,      // tamaño máximo por archivo
    maxFiles: 20,        // cantidad máxima de archivos por operación
    maxPages: 500,       // páginas máximas por documento
    resultTTLMinutes: 30, // los resultados se liberan de la memoria pasado este tiempo

    // OCR (tesseract.js se descarga bajo demanda desde jsDelivr, versión fija)
    tesseract: {
        script: 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js',
        workerPath: 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/worker.min.js',
        corePath: 'https://cdn.jsdelivr.net/npm/tesseract.js-core@5.1.1',
        langPath: 'https://tessdata.projectnaptha.com/4.0.0',
    },
};
