const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs-extra');
const { v4: uuidv4 } = require('uuid');

const supabase = require('../services/supabaseClient');
const {
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
} = require('../services/converter');
const { createTempDir, cleanupTempDir } = require('../utils/tempFiles');
const { classifyConversionError } = require('../utils/errorMessages');

const router = express.Router();
const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50 MB
const upload = multer({ dest: '/tmp/flipbook-tools-uploads', limits: { fileSize: MAX_FILE_SIZE } });

const BUCKET = 'tool-outputs';

const CONTENT_TYPES = {
  '.pdf': 'application/pdf',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.zip': 'application/zip',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
};

/// Enveloppe un middleware multer pour transformer ses erreurs (fichier
/// trop volumineux...) en réponse JSON claire.
function handleUpload(multerMiddleware) {
  return (req, res, next) => {
    multerMiddleware(req, res, (err) => {
      if (err) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          return res.status(413).json({
            error: 'Ce fichier dépasse la taille maximale autorisée (50 Mo).',
            code: 'FILE_TOO_LARGE',
          });
        }
        return res.status(400).json({ error: err.message, code: 'UPLOAD_ERROR' });
      }
      next();
    });
  };
}

/// Envoie un fichier local vers Supabase Storage (bucket 'tool-outputs')
/// et retourne son URL publique + son nom de fichier.
async function uploadResult(localPath, downloadFileName) {
  const fileBuffer = await fs.readFile(localPath);

  // Le CHEMIN de stockage doit être "propre" (pas d'espaces/accents) pour
  // que l'URL publique générée fonctionne de façon fiable dans tous les
  // navigateurs. Le nom AFFICHÉ à l'utilisateur (downloadFileName), lui,
  // garde ses espaces/accents d'origine.
  const safeName = downloadFileName
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // enlève les accents
    .replace(/[^a-zA-Z0-9.\-_]/g, '_'); // remplace le reste par _

  const storagePath = `${uuidv4()}/${safeName}`;
  const ext = path.extname(safeName).toLowerCase();
  const contentType = CONTENT_TYPES[ext] || 'application/octet-stream';

  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(storagePath, fileBuffer, { contentType });
  if (error) throw error;

  const { data } = supabase.storage.from(BUCKET).getPublicUrl(storagePath);
  return { downloadUrl: data.publicUrl, fileName: downloadFileName };
}

/// Petit utilitaire commun à toutes les routes ci-dessous : crée un dossier
/// temporaire, exécute la conversion fournie, uploade le résultat, répond,
/// puis nettoie systématiquement (succès ou échec).
async function handleConversion(req, res, extAutorisees, converterFn, outputFileName) {
  if (!req.file) {
    return res.status(400).json({ error: 'Aucun fichier reçu (champ "file" manquant).' });
  }
  const ext = path.extname(req.file.originalname).toLowerCase();
  if (!extAutorisees.includes(ext)) {
    await fs.remove(req.file.path);
    return res.status(400).json({ error: `Format non supporté : ${ext}` });
  }

  const tempDir = await createTempDir();
  try {
    const inputPath = path.join(tempDir, `input${ext}`);
    await fs.move(req.file.path, inputPath);

    const outputPath = await converterFn(inputPath, tempDir);
    const fileName = typeof outputFileName === 'function'
      ? outputFileName(req.file.originalname)
      : outputFileName;

    const result = await uploadResult(outputPath, fileName);
    res.json(result);
  } catch (err) {
    console.error('Erreur outil :', err);
    res.status(500).json(classifyConversionError(err));
  } finally {
    await cleanupTempDir(tempDir);
    await fs.remove(req.file.path).catch(() => {});
  }
}

const baseName = (originalName) => path.basename(originalName, path.extname(originalName));

// ---------- Word → PDF ----------
router.post('/tools/word-to-pdf', handleUpload(upload.single('file')), (req, res) =>
  handleConversion(req, res, ['.doc', '.docx'], convertToPdf, (name) => `${baseName(name)}.pdf`)
);

// ---------- PDF → Word ----------
router.post('/tools/pdf-to-word', handleUpload(upload.single('file')), (req, res) =>
  handleConversion(req, res, ['.pdf'], convertPdfToWord, (name) => `${baseName(name)}.docx`)
);

// ---------- Texte → PDF ----------
router.post('/tools/text-to-pdf', handleUpload(upload.single('file')), (req, res) =>
  handleConversion(req, res, ['.txt'], convertToPdf, (name) => `${baseName(name)}.pdf`)
);

// ---------- Image → PDF (une seule image) ----------
router.post('/tools/image-to-pdf', handleUpload(upload.single('file')), (req, res) =>
  handleConversion(
    req, res, ['.jpg', '.jpeg', '.png'],
    (inputPath, outputDir) => combineImagesToPdf([inputPath], outputDir),
    (name) => `${baseName(name)}.pdf`
  )
);

// ---------- Convertir une image dans un autre format (JPG/PNG/WEBP) ----------
router.post('/tools/convert-image', handleUpload(upload.single('file')), (req, res) => {
  const format = String(req.body.format || '').toLowerCase();
  if (!IMAGE_OUTPUT_FORMATS[format]) {
    if (req.file) fs.remove(req.file.path).catch(() => {});
    return res.status(400).json({ error: `Format cible non supporté : ${format || '(vide)'}` });
  }
  const targetExt = IMAGE_OUTPUT_FORMATS[format].ext;

  return handleConversion(
    req, res, ['.jpg', '.jpeg', '.png', '.webp'],
    (inputPath, outputDir) => convertImageFormat(inputPath, outputDir, format),
    (name) => `${baseName(name)}.${targetExt}`
  );
});

// ---------- Compresser un PDF ----------
router.post('/tools/compress-pdf', handleUpload(upload.single('file')), (req, res) =>
  handleConversion(req, res, ['.pdf'], compressPdf, (name) => `${baseName(name)}-compresse.pdf`)
);

// ---------- Plusieurs images → un seul PDF ----------
router.post('/tools/images-to-pdf', handleUpload(upload.array('files', 50)), async (req, res) => {
  if (!req.files || req.files.length === 0) {
    return res.status(400).json({ error: 'Aucune image reçue (champ "files" manquant).' });
  }
  const tempDir = await createTempDir();
  try {
    const orderedPaths = [];
    for (let i = 0; i < req.files.length; i++) {
      const ext = path.extname(req.files[i].originalname).toLowerCase();
      const dest = path.join(tempDir, `input-${i + 1}${ext}`);
      await fs.move(req.files[i].path, dest);
      orderedPaths.push(dest);
    }
    const pdfPath = await combineImagesToPdf(orderedPaths, tempDir);
    const result = await uploadResult(pdfPath, 'images-fusionnees.pdf');
    res.json(result);
  } catch (err) {
    console.error('Erreur fusion images :', err);
    res.status(500).json(classifyConversionError(err));
  } finally {
    await cleanupTempDir(tempDir);
    await Promise.all(req.files.map((f) => fs.remove(f.path).catch(() => {})));
  }
});

// ---------- Regrouper (fusionner) plusieurs PDF ----------
router.post('/tools/merge-pdf', handleUpload(upload.array('files', 50)), async (req, res) => {
  if (!req.files || req.files.length < 2) {
    return res.status(400).json({ error: 'Envoie au moins 2 fichiers PDF à fusionner.' });
  }
  const tempDir = await createTempDir();
  try {
    const orderedPaths = [];
    for (let i = 0; i < req.files.length; i++) {
      const dest = path.join(tempDir, `input-${i + 1}.pdf`);
      await fs.move(req.files[i].path, dest);
      orderedPaths.push(dest);
    }
    const mergedPath = await mergePdfs(orderedPaths, tempDir);
    const result = await uploadResult(mergedPath, 'pdf-fusionne.pdf');
    res.json(result);
  } catch (err) {
    console.error('Erreur fusion PDF :', err);
    res.status(500).json(classifyConversionError(err));
  } finally {
    await cleanupTempDir(tempDir);
    await Promise.all(req.files.map((f) => fs.remove(f.path).catch(() => {})));
  }
});

// ---------- Diviser un PDF (une page = un fichier, regroupés en .zip) ----------
router.post('/tools/split-pdf', handleUpload(upload.single('file')), (req, res) =>
  handleConversion(req, res, ['.pdf'], splitPdfToZip, 'pages.zip')
);

// ---------- PDF → image(s) (une image si 1 page, sinon un .zip) ----------
router.post('/tools/pdf-to-images', handleUpload(upload.single('file')), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'Aucun fichier reçu (champ "file" manquant).' });
  }
  const ext = path.extname(req.file.originalname).toLowerCase();
  if (ext !== '.pdf') {
    await fs.remove(req.file.path);
    return res.status(400).json({ error: `Format non supporté : ${ext}` });
  }
  const format = String(req.body.format || '').toLowerCase() === 'png' ? 'png' : 'jpg';

  const tempDir = await createTempDir();
  try {
    const inputPath = path.join(tempDir, 'input.pdf');
    await fs.move(req.file.path, inputPath);

    const { path: outputPath, isZip } = await extractPdfPagesToImages(inputPath, tempDir, format);
    const name = baseName(req.file.originalname);
    const fileName = isZip ? `${name}-pages.zip` : `${name}.${format}`;
    const result = await uploadResult(outputPath, fileName);
    res.json(result);
  } catch (err) {
    console.error('Erreur PDF vers images :', err);
    res.status(500).json(classifyConversionError(err));
  } finally {
    await cleanupTempDir(tempDir);
    await fs.remove(req.file.path).catch(() => {});
  }
});

// ---------- Filigrane (watermark) texte sur toutes les pages d'un PDF ----------
router.post('/tools/watermark-pdf', handleUpload(upload.single('file')), (req, res) => {
  const text = String(req.body.text || '').trim();
  if (!text) {
    if (req.file) fs.remove(req.file.path).catch(() => {});
    return res.status(400).json({ error: 'Le texte du filigrane est requis.' });
  }
  return handleConversion(
    req, res, ['.pdf'],
    (inputPath, outputDir) => addWatermark(inputPath, outputDir, text),
    (name) => `${baseName(name)}-filigrane.pdf`
  );
});

// ---------- Protection d'un PDF par mot de passe ----------
router.post('/tools/protect-pdf', handleUpload(upload.single('file')), (req, res) => {
  const password = String(req.body.text || '');
  if (password.length < 4) {
    if (req.file) fs.remove(req.file.path).catch(() => {});
    return res.status(400).json({ error: 'Le mot de passe doit contenir au moins 4 caractères.' });
  }
  return handleConversion(
    req, res, ['.pdf'],
    (inputPath, outputDir) => protectPdf(inputPath, outputDir, password),
    (name) => `${baseName(name)}-protege.pdf`
  );
});

module.exports = router;
