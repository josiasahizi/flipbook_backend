const { exec, execFile } = require('child_process');
const util = require('util');
const path = require('path');
const fs = require('fs-extra');
const { PDFDocument, StandardFonts, rgb, degrees } = require('pdf-lib');
const sharp = require('sharp');

const execAsync = util.promisify(exec);
const execFileAsync = util.promisify(execFile);

/// Convertit un fichier Word/PPT/texte en PDF via LibreOffice en mode headless.
/// Nécessite que LibreOffice ('soffice') soit installé sur la machine serveur.
async function convertToPdf(inputPath, outputDir) {
  await execAsync(
    `soffice --headless --convert-to pdf --outdir "${outputDir}" "${inputPath}"`
  );
  const baseName = path.basename(inputPath, path.extname(inputPath));
  return path.join(outputDir, `${baseName}.pdf`);
}

/// Convertit un e-book (.epub) en PDF via Calibre ('ebook-convert').
/// Nécessite que Calibre soit installé sur la machine serveur.
async function convertEpubToPdf(inputPath, outputDir) {
  const baseName = path.basename(inputPath, path.extname(inputPath));
  const outputPdf = path.join(outputDir, `${baseName}.pdf`);
  await execAsync(`ebook-convert "${inputPath}" "${outputPdf}"`);
  return outputPdf;
}

/// Découpe un PDF en une image JPEG par page + extrait le texte de chaque page.
/// Retourne { imagePaths, textContents } où textContents[i] = texte de la page i+1.
async function pdfToImages(pdfPath, outputDir) {
  const prefix = path.join(outputDir, 'page');
  // JPEG qualité 85 à 300 DPI : le 600 DPI PNG précédent produisait des
  // pages ~5000x7000px sans perte, très lentes à rasteriser ET très
  // lourdes à uploader vers Supabase Storage — c'était le principal
  // goulot d'étranglement de la conversion. 300 DPI (~2480x3508px pour de
  // l'A4) reste largement net sur un écran de téléphone, même zoomé, la
  // couche de netteté dédiée du lecteur (#zoom-overlay) prenant le relais
  // pendant le pincement.
  //
  // Rendu des images et extraction du texte en parallèle : deux passes
  // indépendantes sur le même PDF, pas besoin de les sérialiser.
  await Promise.all([
    execAsync(`pdftoppm -jpeg -jpegopt quality=85 -r 300 -aa yes -aaVector yes "${pdfPath}" "${prefix}"`),
    execAsync(`pdftotext "${pdfPath}" "${prefix}"`),
  ]);

  const files = await fs.readdir(outputDir);
  const imageFiles = files
    .filter((f) => f.startsWith('page') && (f.endsWith('.png') || f.endsWith('.jpg')))
    .sort((a, b) => {
      const numA = parseInt(a.match(/(\d+)/)?.[1] ?? '0', 10);
      const numB = parseInt(b.match(/(\d+)/)?.[1] ?? '0', 10);
      return numA - numB;
    })
    .map((f) => path.join(outputDir, f));

  const textFiles = files
    .filter((f) => f.startsWith('page') && f.endsWith('.txt'))
    .sort((a, b) => {
      const numA = parseInt(a.match(/(\d+)/)?.[1] ?? '0', 10);
      const numB = parseInt(b.match(/(\d+)/)?.[1] ?? '0', 10);
      return numA - numB;
    });

  const textContents = [];
  for (const txtFile of textFiles) {
    const txtPath = path.join(outputDir, txtFile);
    const content = await fs.readFile(txtPath, 'utf-8');
    textContents.push(content.trim());
    await fs.remove(txtPath); // nettoyage fichiers .txt temporaires
  }

  return { imagePaths: imageFiles, textContents };
}

/// Combine plusieurs images en un seul fichier PDF (une image = une page),
/// dans l'ordre fourni. Utilisé pour la fonctionnalité "plusieurs images →
/// un seul PDF" (comme un scanner).
async function combineImagesToPdf(imagePaths, outputDir) {
  const pdfDoc = await PDFDocument.create();

  for (const imgPath of imagePaths) {
    const imgBytes = await fs.readFile(imgPath);
    const ext = path.extname(imgPath).toLowerCase();
    const image = ext === '.png'
      ? await pdfDoc.embedPng(imgBytes)
      : await pdfDoc.embedJpg(imgBytes);

    const page = pdfDoc.addPage([image.width, image.height]);
    page.drawImage(image, { x: 0, y: 0, width: image.width, height: image.height });
  }

  const pdfBytes = await pdfDoc.save();
  const pdfPath = path.join(outputDir, 'combined.pdf');
  await fs.writeFile(pdfPath, pdfBytes);
  return pdfPath;
}

/// Convertit une image d'un format vers un autre (JPG, PNG, WEBP) via sharp.
/// [format] doit être l'une des clés de IMAGE_OUTPUT_FORMATS ci-dessous.
const IMAGE_OUTPUT_FORMATS = {
  jpg: { sharpMethod: 'jpeg', ext: 'jpg', options: { quality: 90 } },
  png: { sharpMethod: 'png', ext: 'png', options: {} },
  webp: { sharpMethod: 'webp', ext: 'webp', options: { quality: 90 } },
};

async function convertImageFormat(inputPath, outputDir, format) {
  const target = IMAGE_OUTPUT_FORMATS[format];
  if (!target) throw new Error(`Format d'image cible non supporté : ${format}`);

  const outputPath = path.join(outputDir, `converted.${target.ext}`);
  await sharp(inputPath)[target.sharpMethod](target.options).toFile(outputPath);
  return outputPath;
}

/// Convertit un PDF en document Word (.docx) via LibreOffice.
/// Deux précisions nécessaires, sinon la conversion échoue :
/// - --infilter="writer_pdf_import" force LibreOffice à ouvrir le PDF
///   comme un document texte (Writer), pas comme un dessin (Draw, son
///   comportement par défaut pour les PDF) ;
/// - le filtre d'export "MS Word 2007 XML" précise le format .docx cible.
/// Le résultat est une conversion "raisonnable" mais pas toujours parfaite
/// sur des PDF très complexes (mise en page riche, tableaux imbriqués...).
async function convertPdfToWord(inputPath, outputDir) {
  await execAsync(
    `soffice --headless --infilter="writer_pdf_import" ` +
    `--convert-to "docx:MS Word 2007 XML" --outdir "${outputDir}" "${inputPath}"`
  );
  const baseName = path.basename(inputPath, path.extname(inputPath));
  return path.join(outputDir, `${baseName}.docx`);
}

/// Fusionne plusieurs PDF en un seul, dans l'ordre fourni.
async function mergePdfs(pdfPaths, outputDir) {
  const mergedPdf = await PDFDocument.create();

  for (const pdfPath of pdfPaths) {
    const bytes = await fs.readFile(pdfPath);
    const pdf = await PDFDocument.load(bytes);
    const pages = await mergedPdf.copyPages(pdf, pdf.getPageIndices());
    pages.forEach((page) => mergedPdf.addPage(page));
  }

  const mergedBytes = await mergedPdf.save();
  const outputPath = path.join(outputDir, 'merged.pdf');
  await fs.writeFile(outputPath, mergedBytes);
  return outputPath;
}

/// Divise un PDF en un fichier PDF par page, et les regroupe dans une
/// archive .zip (plus pratique à télécharger qu'un fichier par fichier).
async function splitPdfToZip(pdfPath, outputDir) {
  const archiver = require('archiver');
  const sourceBytes = await fs.readFile(pdfPath);
  const sourcePdf = await PDFDocument.load(sourceBytes);
  const pageCount = sourcePdf.getPageCount();

  const pagesDir = path.join(outputDir, 'split-pages');
  await fs.ensureDir(pagesDir);

  for (let i = 0; i < pageCount; i++) {
    const singlePagePdf = await PDFDocument.create();
    const [copiedPage] = await singlePagePdf.copyPages(sourcePdf, [i]);
    singlePagePdf.addPage(copiedPage);
    const bytes = await singlePagePdf.save();
    await fs.writeFile(path.join(pagesDir, `page-${i + 1}.pdf`), bytes);
  }

  const zipPath = path.join(outputDir, 'pages.zip');
  await new Promise((resolve, reject) => {
    const output = fs.createWriteStream(zipPath);
    const archive = archiver('zip', { zlib: { level: 9 } });
    output.on('close', resolve);
    archive.on('error', reject);
    archive.pipe(output);
    archive.directory(pagesDir, false);
    archive.finalize();
  });

  return zipPath;
}

/// Compresse un PDF (réduit sa taille de fichier) via Ghostscript.
/// Nécessite que Ghostscript soit installé sur la machine serveur
/// (commande 'gs' sur Linux/macOS, 'gswin64c' sur Windows — configurable
/// via la variable d'environnement GHOSTSCRIPT_CMD).
async function compressPdf(inputPath, outputDir) {
  const gsCommand = process.env.GHOSTSCRIPT_CMD || 'gs';
  const outputPath = path.join(outputDir, 'compressed.pdf');

  await execAsync(
    `${gsCommand} -sDEVICE=pdfwrite -dCompatibilityLevel=1.4 ` +
    `-dPDFSETTINGS=/ebook -dNOPAUSE -dBATCH ` +
    `-sOutputFile="${outputPath}" "${inputPath}"`
  );

  return outputPath;
}

/// Extrait chaque page d'un PDF en image (JPG ou PNG) via pdftoppm (Poppler).
/// Retourne { path, isZip } : un chemin d'image directement si le PDF n'a
/// qu'une page, sinon un .zip regroupant toutes les pages (cohérent avec
/// splitPdfToZip ci-dessus, pour rester pratique à télécharger).
async function extractPdfPagesToImages(inputPath, outputDir, format = 'jpg') {
  const prefix = path.join(outputDir, 'page');
  if (format === 'png') {
    await execFileAsync('pdftoppm', ['-png', '-r', '200', inputPath, prefix]);
  } else {
    await execFileAsync('pdftoppm', ['-jpeg', '-jpegopt', 'quality=90', '-r', '200', inputPath, prefix]);
  }

  const files = await fs.readdir(outputDir);
  const imageFiles = files
    .filter((f) => f.startsWith('page') && (f.endsWith('.png') || f.endsWith('.jpg')))
    .sort((a, b) => {
      const numA = parseInt(a.match(/(\d+)/)?.[1] ?? '0', 10);
      const numB = parseInt(b.match(/(\d+)/)?.[1] ?? '0', 10);
      return numA - numB;
    })
    .map((f) => path.join(outputDir, f));

  if (imageFiles.length === 0) {
    throw new Error('Aucune page extraite du PDF.');
  }
  if (imageFiles.length === 1) {
    return { path: imageFiles[0], isZip: false };
  }

  const archiver = require('archiver');
  const zipPath = path.join(outputDir, 'pages.zip');
  await new Promise((resolve, reject) => {
    const output = fs.createWriteStream(zipPath);
    const archive = archiver('zip', { zlib: { level: 9 } });
    output.on('close', resolve);
    archive.on('error', reject);
    archive.pipe(output);
    for (const imgPath of imageFiles) archive.file(imgPath, { name: path.basename(imgPath) });
    archive.finalize();
  });

  return { path: zipPath, isZip: true };
}

/// Ajoute un filigrane texte, en diagonale et semi-transparent, sur toutes
/// les pages d'un PDF (pdf-lib, sans dépendance externe).
async function addWatermark(inputPath, outputDir, text) {
  const bytes = await fs.readFile(inputPath);
  const pdfDoc = await PDFDocument.load(bytes);
  const font = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  for (const page of pdfDoc.getPages()) {
    const { width, height } = page.getSize();
    const fontSize = Math.min(width, height) / 8;
    const textWidth = font.widthOfTextAtSize(text, fontSize);
    page.drawText(text, {
      x: width / 2 - textWidth / 2,
      y: height / 2 - fontSize / 2,
      size: fontSize,
      font,
      color: rgb(0.5, 0.5, 0.5),
      opacity: 0.3,
      rotate: degrees(45),
    });
  }

  const outBytes = await pdfDoc.save();
  const outputPath = path.join(outputDir, 'watermarked.pdf');
  await fs.writeFile(outputPath, outBytes);
  return outputPath;
}

/// Protège un PDF par mot de passe via Ghostscript (déjà requis pour
/// compressPdf). Utilise execFile (pas exec) avec les arguments en tableau
/// pour que le mot de passe ne passe JAMAIS par un shell — il pourrait sinon
/// contenir des caractères spéciaux (guillemets, backticks...) permettant
/// une injection de commande.
async function protectPdf(inputPath, outputDir, password) {
  const gsCommand = process.env.GHOSTSCRIPT_CMD || 'gs';
  const outputPath = path.join(outputDir, 'protected.pdf');

  await execFileAsync(gsCommand, [
    '-sDEVICE=pdfwrite',
    '-dCompatibilityLevel=1.4',
    `-sOwnerPassword=${password}`,
    `-sUserPassword=${password}`,
    '-dEncryptionR=3',
    '-dKeyLength=128',
    '-dNOPAUSE',
    '-dBATCH',
    `-sOutputFile=${outputPath}`,
    inputPath,
  ]);

  return outputPath;
}

/// Point d'entrée principal : convertit n'importe quel fichier supporté
/// (PDF, Word, PPT, TXT, EPUB, image) en pages-images + PDF associé + texte.
///
/// Retourne { imagePaths, pdfPath, textContents } :
/// - imagePaths : liste ordonnée des chemins d'images locales (une par page)
/// - pdfPath : chemin du PDF correspondant (null si le fichier d'origine
///   était une image seule, auquel cas il n'y a pas de PDF à proposer
///   au téléchargement)
/// - textContents : liste du texte extrait par page (string par page,
///   string vide si extraction impossible)
async function convertFileToPageImages(inputPath, outputDir) {
  const ext = path.extname(inputPath).toLowerCase();

  if (['.jpg', '.jpeg', '.png'].includes(ext)) {
    // Une image = un flipbook d'une seule page, on la copie telle quelle
    const dest = path.join(outputDir, `page-1${ext}`);
    await fs.copy(inputPath, dest);
    return { imagePaths: [dest], pdfPath: null, textContents: [''] };
  }

  let pdfPath = inputPath;
  if (ext === '.epub') {
    pdfPath = await convertEpubToPdf(inputPath, outputDir);
  } else if (ext !== '.pdf') {
    // Word (.doc/.docx), PowerPoint (.ppt/.pptx) ou texte (.txt) → LibreOffice
    pdfPath = await convertToPdf(inputPath, outputDir);
  }

  const { imagePaths, textContents } = await pdfToImages(pdfPath, outputDir);
  return { imagePaths, pdfPath, textContents };
}

module.exports = {
  convertFileToPageImages,
  combineImagesToPdf,
  convertToPdf,
  convertPdfToWord,
  convertImageFormat,
  IMAGE_OUTPUT_FORMATS,
  mergePdfs,
  splitPdfToZip,
  compressPdf,
  extractPdfPagesToImages,
  addWatermark,
  protectPdf,
};
