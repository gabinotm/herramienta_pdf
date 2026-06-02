const preview =
    document.getElementById('preview');

const pdfInput =
    document.getElementById('pdfInput');

const pdfInput2 =
    document.getElementById('pdfInput2');

const uploadArea =
    document.getElementById('uploadArea');

const totalFiles =
    document.getElementById('totalFiles');

const totalPages =
    document.getElementById('totalPages');

const modal =
    document.getElementById('modal');

const zoomCanvas =
    document.getElementById('zoomCanvas');
const processModal =
    document.getElementById('processModal');

const processTitle =
    document.getElementById('processTitle');

const processText =
    document.getElementById('processText');

const progressBar =
    document.getElementById('progressBar');

const progressPercent =
    document.getElementById('progressPercent');

const processFiles =
    document.getElementById('processFiles');

const processPages =
    document.getElementById('processPages');
const processActions =
    document.getElementById('processActions');

const downloadBtn =
    document.getElementById('downloadBtn');

const processIcon =
    document.getElementById('processIcon');

const progressWrapper =
    document.getElementById('progressWrapper');
const organizeSection =
    document.getElementById('organizeSection');

const splitSection =
    document.getElementById('splitSection');

const convertSection =
    document.getElementById('convertSection');

const organizeBtn =
    document.getElementById('organizeBtn');

const splitBtn =
    document.getElementById('splitBtn');

const convertBtn =
    document.getElementById('convertBtn');

const globalPreviewContainer =
    document.getElementById(
        'globalPreviewContainer'
    );

    const toast =
document.getElementById('toast');

const toastTitle =
document.getElementById('toastTitle');

const toastText =
document.getElementById('toastText');


let filesArray = [];

let pagesArray = [];

let sortableInstance = null;

let currentZoom = 1.5;

let currentPage = null;

let convertType = 'pdf-png';

const zoomLevel =
    document.getElementById('zoomLevel');

/* UPLOAD */

pdfInput.addEventListener('change', (e) => {

    addFiles(Array.from(e.target.files));

});

pdfInput2.addEventListener('change', (e) => {

    addFiles(Array.from(e.target.files));

});

uploadArea.addEventListener('dragover', (e) => {

    e.preventDefault();

    uploadArea.classList.add('dragover');

});

uploadArea.addEventListener('dragleave', () => {

    uploadArea.classList.remove('dragover');

});

uploadArea.addEventListener('drop', (e) => {

    e.preventDefault();

    uploadArea.classList.remove('dragover');

    addFiles(Array.from(e.dataTransfer.files));
    const pageTitle =
        document.getElementById('pageTitle');

    const pageDescription =
        document.getElementById('pageDescription');

});

/* ADD FILES */

async function addFiles(newFiles) {

    const pdfs =
        newFiles.filter(
            file => file.type === 'application/pdf'
        );

    if (pdfs.length === 0) {

        alert('Solo PDFs');

        return;

    }

    /* SHOW LOADER */

    showProcessModal();

    processTitle.innerText =
        'Cargando PDFs';

    processText.innerText =
        'Preparando archivos...';

    /* RESET */

    let loadedPages = 0;

    let estimatedPages = 0;

    /* ESTIMATE */

    for (const file of pdfs) {

        try {

            const tempPdf =
                await pdfjsLib
                    .getDocument(
                        URL.createObjectURL(file)
                    ).promise;

            estimatedPages +=
                tempPdf.numPages;

        } catch (e) {

            console.log(e);

        }

    }

    /* ADD FILES */

    for (let i = 0; i < pdfs.length; i++) {

        const file = pdfs[i];

        processText.innerText =
            'Cargando ' + file.name;

        filesArray.push(file);

        /* LOAD PDF */

        const pdf =
            await pdfjsLib
                .getDocument(
                    URL.createObjectURL(file)
                ).promise;

        /* PAGE LOADING */

        for (let p = 0; p < pdf.numPages; p++) {

            loadedPages++;

            updateProgress(

                (loadedPages / estimatedPages) * 100,

                'Cargando página ' +
                loadedPages +
                ' de ' +
                estimatedPages

            );

            /* SMOOTH */

            await new Promise(resolve =>
                setTimeout(resolve, 25)
            );

        }

    }

    /* COMPLETE */

    updateProgress(
        100,
        'Finalizando carga...'
    );

    /* SMALL DELAY */

    await new Promise(resolve =>
        setTimeout(resolve, 500)
    );

    /* CLOSE */

    processModal.style.display =
        'none';

    /* RENDER */

    renderPDFs();

}

/* RENDER */

async function renderPDFs() {

    preview.innerHTML = '';

    pagesArray = [];

    let total = 0;

    for (const file of filesArray) {

        const url =
            URL.createObjectURL(file);

        const pdf =
            await pdfjsLib.getDocument(url).promise;

        total += pdf.numPages;

        for (let i = 0; i < pdf.numPages; i++) {

            const page =
                await pdf.getPage(i + 1);

            const viewport =
                page.getViewport({
                    scale: 0.55
                });

            const canvas =
                document.createElement('canvas');

            const context =
                canvas.getContext('2d');

            canvas.width = viewport.width;

            canvas.height = viewport.height;

            await page.render({

                canvasContext: context,
                viewport: viewport

            }).promise;

            pagesArray.push({

                file,
                pageIndex: i

            });

            const card =
                document.createElement('div');

            card.className = 'pdf-item';

            card.dataset.index =
                pagesArray.length - 1;

            const previewContainer =
                document.createElement('div');

            previewContainer.className =
                'preview-container';

            previewContainer.appendChild(canvas);

            const body =
                document.createElement('div');

            body.className =
                'card-body';

            const filename =
                document.createElement('div');

            filename.className =
                'filename';

            filename.innerText =
                file.name;

            const pageLabel =
                document.createElement('div');

            pageLabel.className =
                'pages';

            pageLabel.innerText =
                'Página ' + (i + 1);

            const actions =
                document.createElement('div');

            actions.className =
                'card-actions';

            const viewBtn =
                document.createElement('button');

            viewBtn.className =
                'card-btn preview-btn';

            viewBtn.innerHTML =
                '<i class="fa-solid fa-eye"></i>';

            viewBtn.onclick = () => {

                openZoom(pdf, i);

            };

            const deleteBtn =
                document.createElement('button');

            deleteBtn.className =
                'card-btn delete-btn';

            deleteBtn.innerHTML =
                '<i class="fa-solid fa-trash"></i>';

            deleteBtn.onclick = () => {

                pagesArray.splice(
                    card.dataset.index,
                    1
                );

                card.remove();

                updateStats();

                toggleUploadArea();

            };

            actions.appendChild(viewBtn);

            actions.appendChild(deleteBtn);

            body.appendChild(filename);

            body.appendChild(pageLabel);

            body.appendChild(actions);

            card.appendChild(previewContainer);

            card.appendChild(body);

            preview.appendChild(card);

        }

    }

    updateStats();

    toggleUploadArea();

    activateSortable();

}

/* SORTABLE */

function activateSortable() {

    if (sortableInstance) {

        sortableInstance.destroy();

    }

    sortableInstance =
        Sortable.create(preview, {

            animation: 200,

            ghostClass: 'dragging',

            onEnd: (evt) => {

                const moved =
                    pagesArray.splice(
                        evt.oldIndex,
                        1
                    )[0];

                pagesArray.splice(
                    evt.newIndex,
                    0,
                    moved
                );

            }

        });

}

/* STATS */

function updateStats() {

    totalFiles.innerText =
        filesArray.length;

    totalPages.innerText =
        pagesArray.length;

}

function toggleUploadArea() {

    if (pagesArray.length > 0) {

        uploadArea.style.display =
            'none';

        globalPreviewContainer.style.display =
            'block';

    } else {

        uploadArea.style.display =
            'block';

        globalPreviewContainer.style.display =
            'none';

    }

}

/* ZOOM */

async function openZoom(pdf, index) {

    modal.style.display = 'block';

    const page =
        await pdf.getPage(index + 1);

    renderZoomPage(page);

}

async function renderZoomPage(page) {

    currentPage = page;

    const viewport =
        page.getViewport({
            scale: currentZoom
        });

    const context =
        zoomCanvas.getContext('2d');

    const ratio =
        window.devicePixelRatio || 1;

    /* HD QUALITY */

    zoomCanvas.width =
        viewport.width * ratio;

    zoomCanvas.height =
        viewport.height * ratio;

    zoomCanvas.style.width =
        viewport.width + 'px';

    zoomCanvas.style.height =
        viewport.height + 'px';

    context.setTransform(
        ratio,
        0,
        0,
        ratio,
        0,
        0
    );

    await page.render({

        canvasContext: context,

        viewport: viewport

    }).promise;

    /* ZOOM TEXT */

    zoomLevel.innerText =
        Math.round(
            currentZoom * 100
        ) + '%';

}
function showSection(section) {

    /* HIDE ALL */

    organizeSection.style.display =
        'none';

    splitSection.style.display =
        'none';

    convertSection.style.display =
        'none';

    /* REMOVE ACTIVE */

    organizeBtn.classList.remove(
        'active'
    );

    splitBtn.classList.remove(
        'active'
    );

    convertBtn.classList.remove(
        'active'
    );

    /* ORGANIZE */

    if (section === 'organize') {

        organizeSection.style.display =
            'block';

        organizeBtn.classList.add(
            'active'
        );

        /* HEADER */

        pageTitle.innerText =
            'Organizar PDFs';

        pageDescription.innerText =
            'Reordena, elimina y administra páginas PDF';

    }

    /* SPLIT */

    if (section === 'split') {

        splitSection.style.display =
            'block';

        splitBtn.classList.add(
            'active'
        );

        /* HEADER */

        pageTitle.innerText =
            'Separar PDF';

        pageDescription.innerText =
            'Extrae páginas individuales de tus PDFs';

    }

    /* CONVERT */

    if (section === 'convert') {

        convertSection.style.display =
            'block';

        convertBtn.classList.add(
            'active'
        );

        /* HEADER */

        pageTitle.innerText =
            'Convertir PDF';

        pageDescription.innerText =
            'Convierte páginas PDF a imágenes PNG HD';

    }

}
function comingSoonConvert(){

showToast(

'🚀 Muy pronto',

'La herramienta Convertir archivos estará disponible próximamente'

);

}
function showToast(

title,
text

){

toastTitle.innerText =
title;

toastText.innerText =
text;

/* SHOW */

toast.classList.add(
'show-toast'
);

/* HIDE */

setTimeout(()=>{

toast.classList.remove(
'show-toast'
);

},3500);

}
function setConvertType(type, element) {

    convertType = type;

    /* REMOVE ACTIVE */

    document
        .querySelectorAll('.convert-card')
        .forEach(card => {

            card.classList.remove(
                'active-convert'
            );

        });

    /* ACTIVE */

    element.classList.add(
        'active-convert'
    );

}
function showProcessModal() {

    processModal.style.display =
        'flex';

    processFiles.innerText =
        filesArray.length;

    processPages.innerText =
        pagesArray.length;

    processActions.style.display =
        'none';

    progressWrapper.style.display =
        'block';

    processIcon.classList.remove(
        'process-success'
    );

    processIcon.innerHTML =
        '<i class="fa-solid fa-file-pdf"></i>';

    updateProgress(0);

}
async function executeConvert() {

    /* PDF PNG */

    if (convertType === 'pdf-png') {

        convertSelectedPages();

    }

    /* PDF JPG */

    if (convertType === 'pdf-jpg') {

        convertToJPG();

    }

    /* WORD PDF */

    if (convertType === 'word-pdf') {

        fakeConversion(
            'Convirtiendo Word a PDF',
            'WORD_A_PDF.pdf'
        );

    }

    /* PDF WORD */

    if (convertType === 'pdf-word') {

        fakeConversion(
            'Convirtiendo PDF a Word',
            'PDF_A_WORD.docx'
        );

    }

    /* IMG PDF */

    if (convertType === 'img-pdf') {

        fakeConversion(
            'Convirtiendo imágenes a PDF',
            'IMAGENES_A_PDF.pdf'
        );

    }

}
async function fakeConversion(title, fileName) {

    showProcessModal();

    processTitle.innerText =
        title;

    /* STEPS */

    const steps = [

        'Preparando archivos...',
        'Analizando contenido...',
        'Procesando páginas...',
        'Convirtiendo formato...',
        'Finalizando archivo...'

    ];

    /* PROGRESS */

    for (let i = 0; i <= 100; i += 10) {

        const stepIndex =
            Math.min(
                Math.floor(i / 25),
                steps.length - 1
            );

        updateProgress(
            i,
            steps[stepIndex]
        );

        await new Promise(resolve =>
            setTimeout(resolve, 250)
        );

    }

    /* CREATE FAKE FILE */

    const blob =
        new Blob(

            [
                'Conversión simulada'
            ],

            {
                type:
                    'application/octet-stream'
            }

        );

    const url =
        URL.createObjectURL(blob);

    /* SUCCESS */

    showConvertSuccess(url);

    /* DOWNLOAD */

    downloadBtn.onclick = () => {

        const a =
            document.createElement('a');

        a.href = url;

        a.download =
            fileName;

        document.body.appendChild(a);

        a.click();

        document.body.removeChild(a);

    };

}
function hideProcessModal() {

    /* CLOSE MODAL */

    processModal.style.display =
        'none';

    /* RESET */

    updateProgress(
        0,
        'Preparando...'
    );

    processActions.style.display =
        'none';

    progressWrapper.style.display =
        'block';

    /* CLEAN */

    filesArray = [];

    pagesArray = [];

    preview.innerHTML = '';

    updateStats();

    toggleUploadArea();

    showSection('organize');

}
function hideOnlyProcessModal() {

    processModal.style.display =
        'none';

    updateProgress(
        0,
        'Preparando...'
    );

    processActions.style.display =
        'none';

    progressWrapper.style.display =
        'block';

}
function showSuccessState(

url,
title='PDF listo',
text='Proceso completado',
buttonText='Descargar PDF'

){

processTitle.innerText =
title;

processText.innerText =
text;

processIcon.classList.add(
'process-success'
);

processIcon.innerHTML =
'<i class="fa-solid fa-check"></i>';

progressWrapper.style.display =
'none';

processActions.style.display =
'flex';

/* BUTTON TEXT */

downloadBtn.innerHTML = `
<i class="fa-solid fa-download"></i>
${buttonText}
`;

/* DOWNLOAD */

downloadBtn.onclick = ()=>{

const a =
document.createElement('a');

a.href = url;

a.download =
buttonText
.replaceAll(' ','_') +
'.pdf';

document.body.appendChild(a);

a.click();

document.body.removeChild(a);

};

}
function updateProgress(percent, text = 'Procesando...') {

    progressBar.style.width =
        percent + '%';

    progressPercent.innerText =
        Math.round(percent) + '%';

    processText.innerText = text;

}
function zoomIn() {

    currentZoom += 0.2;

    if (currentPage) {

        renderZoomPage(currentPage);

    }

}

function zoomOut() {

    if (currentZoom <= 0.4) return;

    currentZoom -= 0.2;

    if (currentPage) {

        renderZoomPage(currentPage);

    }

}

function closeModal() {

    modal.style.display = 'none';

}

/* CLEAR */

function clearAll() {

    filesArray = [];

    pagesArray = [];

    preview.innerHTML = '';

    updateStats();

    toggleUploadArea();

}

/* MERGE */

async function mergePDFs() {

    try {

        if (pagesArray.length === 0) {

            alert('No hay páginas');

            return;

        }

        showProcessModal();

        processTitle.innerText =
            'Uniendo PDFs';

        const { PDFDocument } =
            PDFLib;

        const mergedPdf =
            await PDFDocument.create();

        /* PROCESS */

        for (let i = 0; i < pagesArray.length; i++) {

            const item =
                pagesArray[i];

            updateProgress(

                ((i + 1) / pagesArray.length) * 100,

                'Uniendo página ' +
                (i + 1) +
                ' de ' +
                pagesArray.length

            );

            const bytes =
                await item.file.arrayBuffer();

            const sourcePdf =
                await PDFDocument.load(bytes);

            const [copiedPage] =
                await mergedPdf.copyPages(
                    sourcePdf,
                    [item.pageIndex]
                );

            mergedPdf.addPage(copiedPage);

            await new Promise(resolve =>
                setTimeout(resolve, 40)
            );

        }

        /* FINALIZING */

        updateProgress(
            100,
            'Finalizando PDF...'
        );

        const mergedBytes =
            await mergedPdf.save();

        const blob =
            new Blob(
                [mergedBytes],
                {
                    type: 'application/pdf'
                }
            );

        const url =
            URL.createObjectURL(blob);

        /* SUCCESS */

        setTimeout(() => {

            showSuccessState(
url,
'PDF listo',
'Tu archivo fue unido correctamente',
'Descargar PDF Unido'
);

        }, 500);

    } catch (error) {

        console.error(error);

        hideProcessModal();

        alert(
            'Error al unir PDFs'
        );

    }

}

/* SPLIT */

async function splitSelectedPages(){

try{

if(pagesArray.length === 0){

showToast(
'Sin páginas',
'Primero debes subir un PDF'
);

return;

}

/* OPEN MODAL */

showProcessModal();

processTitle.innerText =
'Separando PDF';

processText.innerText =
'Preparando páginas...';

/* ZIP */

const zip =
new JSZip();

/* TOTAL */

const total =
pagesArray.length;

/* PROCESS */

for(let i=0;i<total;i++){

const item =
pagesArray[i];

/* PROGRESS */

const percent =
((i + 1) / total) * 100;

updateProgress(

percent,

'Separando página ' +
(i + 1) +
' de ' +
total

);

/* CREATE NEW PDF */

const { PDFDocument } =
PDFLib;

const newPdf =
await PDFDocument.create();

/* LOAD SOURCE */

const sourcePdf =
await PDFDocument.load(
await item.file.arrayBuffer()
);

/* COPY PAGE */

const [copiedPage] =
await newPdf.copyPages(

sourcePdf,

[item.pageIndex]

);

newPdf.addPage(
copiedPage
);

/* SAVE */

const pdfBytes =
await newPdf.save();

/* ZIP */

zip.file(

`pagina_${i+1}.pdf`,

pdfBytes

);

/* VISUAL DELAY */

await new Promise(resolve=>
setTimeout(resolve,80)
);

}

/* FINAL */

updateProgress(
100,
'Generando ZIP final...'
);

/* ZIP GENERATION */

const zipBlob =
await zip.generateAsync({

type:'blob'

});

/* URL */

const url =
URL.createObjectURL(zipBlob);

/* SUCCESS */

setTimeout(()=>{

processTitle.innerText =
'PDF separado';

processText.innerText =
'Todas las páginas fueron separadas correctamente';

processIcon.classList.add(
'process-success'
);

processIcon.innerHTML =
'<i class="fa-solid fa-check"></i>';

progressWrapper.style.display =
'none';

processActions.style.display =
'flex';

/* DOWNLOAD */
downloadBtn.innerHTML = `
<i class="fa-solid fa-download"></i>
Descargar ZIP
`;
downloadBtn.onclick = ()=>{

const a =
document.createElement('a');

a.href = url;

a.download =
'PDF_SEPARADO.zip';

document.body.appendChild(a);

a.click();

document.body.removeChild(a);

};

},700);

}catch(error){

console.error(error);

hideOnlyProcessModal();

showToast(
'Error',
'No se pudo separar el PDF'
);

}

}

/* CONVERT */

async function convertSelectedPages() {

    try {

        if (pagesArray.length === 0) {

            alert('No hay páginas');

            return;

        }

        /* SHOW MODAL */

        showProcessModal();

        processTitle.innerText =
            'Convirtiendo PDF';

        processText.innerText =
            'Preparando imágenes...';

        /* ZIP */

        const zip =
            new JSZip();

        /* PROCESS */

        for (let i = 0; i < pagesArray.length; i++) {

            const item =
                pagesArray[i];

            updateProgress(

                ((i + 1) / pagesArray.length) * 100,

                'Convirtiendo página ' +
                (i + 1) +
                ' de ' +
                pagesArray.length

            );
            async function convertToJPG() {

                try {

                    if (pagesArray.length === 0) {

                        alert('No hay páginas');

                        return;

                    }

                    showProcessModal();

                    processTitle.innerText =
                        'Convirtiendo JPG';

                    const zip =
                        new JSZip();

                    /* PROCESS */

                    for (let i = 0; i < pagesArray.length; i++) {

                        const item =
                            pagesArray[i];

                        updateProgress(

                            ((i + 1) / pagesArray.length) * 100,

                            'Convirtiendo página ' +
                            (i + 1)

                        );

                        const pdf =
                            await pdfjsLib
                                .getDocument(
                                    URL.createObjectURL(item.file)
                                ).promise;

                        const page =
                            await pdf.getPage(
                                item.pageIndex + 1
                            );

                        const viewport =
                            page.getViewport({
                                scale: 2.5
                            });

                        const canvas =
                            document.createElement('canvas');

                        const context =
                            canvas.getContext('2d');

                        canvas.width =
                            viewport.width;

                        canvas.height =
                            viewport.height;

                        await page.render({

                            canvasContext: context,
                            viewport: viewport

                        }).promise;

                        const imageData =
                            canvas.toDataURL(
                                'image/jpeg',
                                1
                            );

                        const response =
                            await fetch(imageData);

                        const blob =
                            await response.blob();

                        zip.file(
                            `pagina_${i + 1}.jpg`,
                            blob
                        );

                    }

                    /* ZIP */

                    const zipBlob =
                        await zip.generateAsync({

                            type: 'blob'

                        });

                    const url =
                        URL.createObjectURL(zipBlob);

                    showConvertSuccess(url);

                } catch (error) {

                    console.error(error);

                    hideOnlyProcessModal();

                    alert(
                        'Error al convertir JPG'
                    );

                }

            }
            /* LOAD PDF */

            const pdf =
                await pdfjsLib
                    .getDocument(
                        URL.createObjectURL(item.file)
                    ).promise;

            /* GET PAGE */

            const page =
                await pdf.getPage(
                    item.pageIndex + 1
                );

            /* HD */

            const viewport =
                page.getViewport({
                    scale: 2.5
                });

            const canvas =
                document.createElement('canvas');

            const context =
                canvas.getContext('2d');

            canvas.width =
                viewport.width;

            canvas.height =
                viewport.height;

            /* RENDER */

            await page.render({

                canvasContext: context,
                viewport: viewport

            }).promise;

            /* PNG */

            const imageData =
                canvas.toDataURL(
                    'image/png'
                );

            /* BLOB */

            const response =
                await fetch(imageData);

            const blob =
                await response.blob();

            /* ADD ZIP */

            zip.file(
                `pagina_${i + 1}.png`,
                blob
            );

            /* SMOOTH */

            await new Promise(resolve =>
                setTimeout(resolve, 40)
            );

        }

        /* FINAL */

        updateProgress(
            100,
            'Generando ZIP...'
        );

        /* GENERATE ZIP */

        const zipBlob =
            await zip.generateAsync({

                type: 'blob'

            });

        /* URL */

        const url =
            URL.createObjectURL(zipBlob);

        /* SUCCESS */

        setTimeout(() => {

            showConvertSuccess(url);

        }, 500);

    } catch (error) {

        console.error(error);

        hideOnlyProcessModal();

        alert(
            'Error al convertir PDF'
        );

    }

}
function showConvertSuccess(url) {

    processTitle.innerText =
        'Conversión completada';

    processText.innerText =
        'Tus imágenes PNG están listas';

    processIcon.classList.add(
        'process-success'
    );

    processIcon.innerHTML =
        '<i class="fa-solid fa-image"></i>';

    progressWrapper.style.display =
        'none';

    processActions.style.display =
        'flex';

    /* DOWNLOAD */

    downloadBtn.onclick = () => {

        const a =
            document.createElement('a');

        a.href = url;

        a.download =
            'PDF_IMAGENES.zip';

        document.body.appendChild(a);

        a.click();

        document.body.removeChild(a);

    };

}
function hideOnlyProcessModal() {

    processModal.style.display =
        'none';

    updateProgress(
        0,
        'Preparando...'
    );

    processActions.style.display =
        'none';

    progressWrapper.style.display =
        'block';

}
showSection('organize');
globalPreviewContainer.style.display =
    'none';

    