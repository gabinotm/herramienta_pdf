// Generador mínimo de documentos Word (.docx, Office Open XML) usando JSZip.

const EMU_PER_PT = 12700;
const TWIP_PER_PT = 20;

function esc(text) {
    return String(text)
        // Caracteres no permitidos en XML 1.0
        .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, '')
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export class DocxBuilder {
    constructor() {
        this.body = [];
        this.media = [];
        this.page = { w: 595, h: 842, margin: 56 };
    }

    setPage(widthPt, heightPt, marginPt = 56) {
        this.page = { w: widthPt, h: heightPt, margin: marginPt };
    }

    /** runs: [{ text, size (pt), bold, italic, color ('RRGGBB') }] */
    paragraph(runs, { align = 'left', after = 6, before = 0, indentPt = 0 } = {}) {
        const jc = { left: 'left', center: 'center', right: 'right', justify: 'both' }[align] || 'left';
        const ppr = `<w:pPr><w:spacing w:before="${Math.round(before * TWIP_PER_PT)}" w:after="${Math.round(after * TWIP_PER_PT)}"/>${indentPt ? `<w:ind w:left="${Math.round(indentPt * TWIP_PER_PT)}"/>` : ''}<w:jc w:val="${jc}"/></w:pPr>`;
        const r = runs.filter(run => run.text).map(run => {
            const rpr = [
                run.bold ? '<w:b/>' : '',
                run.italic ? '<w:i/>' : '',
                run.color ? `<w:color w:val="${run.color}"/>` : '',
                run.size ? `<w:sz w:val="${Math.max(2, Math.round(run.size * 2))}"/><w:szCs w:val="${Math.max(2, Math.round(run.size * 2))}"/>` : '',
            ].join('');
            return `<w:r>${rpr ? `<w:rPr>${rpr}</w:rPr>` : ''}<w:t xml:space="preserve">${esc(run.text)}</w:t></w:r>`;
        }).join('');
        this.body.push(`<w:p>${ppr}${r}</w:p>`);
    }

    pageBreak() {
        this.body.push('<w:p><w:r><w:br w:type="page"/></w:r></w:p>');
    }

    /** Imagen en línea. type: 'png' | 'jpeg' */
    image(bytes, type, widthPt, heightPt) {
        const id = this.media.length + 1;
        const file = `image${id}.${type === 'png' ? 'png' : 'jpeg'}`;
        this.media.push({ id, file, bytes });
        const cx = Math.round(widthPt * EMU_PER_PT);
        const cy = Math.round(heightPt * EMU_PER_PT);
        this.body.push(`<w:p><w:pPr><w:spacing w:before="0" w:after="0"/><w:jc w:val="center"/></w:pPr><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${id}" name="Imagen ${id}"/><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="${id}" name="${file}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="rImg${id}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`);
    }

    async toBlob() {
        const zip = new JSZip();
        const { w, h, margin } = this.page;
        const orient = w > h ? ' w:orient="landscape"' : '';
        const m = Math.round(margin * TWIP_PER_PT);
        const sect = `<w:sectPr><w:pgSz w:w="${Math.round(w * TWIP_PER_PT)}" w:h="${Math.round(h * TWIP_PER_PT)}"${orient}/><w:pgMar w:top="${m}" w:right="${m}" w:bottom="${m}" w:left="${m}" w:header="360" w:footer="360" w:gutter="0"/></w:sectPr>`;
        zip.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Default Extension="jpeg" ContentType="image/jpeg"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>');
        zip.file('_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
        zip.file('word/styles.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri"/><w:sz w:val="22"/><w:lang w:val="es-ES"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="259" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style></w:styles>');
        const rels = this.media.map(m2 => `<Relationship Id="rImg${m2.id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/${m2.file}"/>`).join('');
        zip.file('word/_rels/document.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>${rels}</Relationships>`);
        for (const m2 of this.media) zip.file(`word/media/${m2.file}`, m2.bytes);
        zip.file('word/document.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><w:body>${this.body.join('')}${sect}</w:body></w:document>`);
        return zip.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', compression: 'DEFLATE' });
    }
}
