const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs-extra');
const { v4: uuidv4 } = require('uuid');

const supabase = require('../services/supabaseClient');
const { convertFileToPageImages, combineImagesToPdf } = require('../services/converter');
const { createTempDir, cleanupTempDir } = require('../utils/tempFiles');
const { classifyConversionError } = require('../utils/errorMessages');

const router = express.Router();
const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50 MB
const upload = multer({ dest: '/tmp/flipbook-uploads', limits: { fileSize: MAX_FILE_SIZE } });

/// Enveloppe un middleware multer pour transformer ses erreurs (fichier
/// trop volumineux, champ manquant...) en réponse JSON claire, au lieu de
/// laisser Express planter avec une erreur non gérée.
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

const EXTENSIONS_AUTORISEES = [
  '.pdf', '.doc', '.docx', '.ppt', '.pptx',
  '.txt', '.epub',
  '.jpg', '.jpeg', '.png',
];
const EXTENSIONS_IMAGES = ['.jpg', '.jpeg', '.png'];

/// Découpe un tableau en lots de taille `size`.
function chunk(array, size) {
  const chunks = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
}

/// Envoie une liste de fichiers locaux vers Supabase Storage, sous
/// pages/{flipbookId}/..., et retourne leurs URLs publiques dans l'ordre.
///
/// Les uploads sont faits en parallèle (par lots de 5) plutôt qu'un par un :
/// c'était le principal goulot d'étranglement sur les PDF de nombreuses
/// pages, chaque upload ayant sa propre latence réseau qui s'additionnait.
async function uploadPagesToStorage(localImagePaths, flipbookId) {
  const CONCURRENCY = 5;
  const pageUrls = new Array(localImagePaths.length);

  const batches = chunk(localImagePaths.map((p, i) => ({ path: p, index: i })), CONCURRENCY);

  for (const batch of batches) {
    await Promise.all(
      batch.map(async ({ path: localPath, index }) => {
        const fileBuffer = await fs.readFile(localPath);
        // L'extension suit le fichier réel : PNG (images originales
        // re-uploadées telles quelles) ou JPG (pages générées depuis un PDF)
        const isPng = path.extname(localPath).toLowerCase() === '.png';
        const storagePath = `pages/${flipbookId}/page-${index + 1}${isPng ? '.png' : '.jpg'}`;

        const { error: uploadError } = await supabase.storage
          .from('flipbook-pages')
          .upload(storagePath, fileBuffer, {
            contentType: isPng ? 'image/png' : 'image/jpeg',
          });
        if (uploadError) throw uploadError;

        const { data } = supabase.storage.from('flipbook-pages').getPublicUrl(storagePath);
        pageUrls[index] = data.publicUrl;
      })
    );
  }

  return pageUrls;
}

/// Envoie un fichier PDF local vers Supabase Storage et retourne son URL
/// publique (utilisée pour le bouton "Télécharger" côté app).
async function uploadPdfToStorage(pdfPath, flipbookId) {
  const fileBuffer = await fs.readFile(pdfPath);
  const storagePath = `pdfs/${flipbookId}/document.pdf`;

  const { error: uploadError } = await supabase.storage
    .from('flipbook-pages')
    .upload(storagePath, fileBuffer, { contentType: 'application/pdf' });
  if (uploadError) throw uploadError;

  const { data } = supabase.storage.from('flipbook-pages').getPublicUrl(storagePath);
  return data.publicUrl;
}

/**
 * POST /convert
 * Reçoit UN fichier (form-data, champ "file").
 * Convertit le fichier en pages-images + PDF, les envoie dans Supabase
 * Storage, et renvoie les URLs.
 */
router.post('/convert', handleUpload(upload.single('file')), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'Aucun fichier reçu (champ "file" manquant).' });
  }

  const ext = path.extname(req.file.originalname).toLowerCase();
  if (!EXTENSIONS_AUTORISEES.includes(ext)) {
    await fs.remove(req.file.path);
    return res.status(400).json({ error: `Format non supporté : ${ext}` });
  }

  const tempDir = await createTempDir();

  try {
    const inputPath = path.join(tempDir, `input${ext}`);
    await fs.move(req.file.path, inputPath);

    const { imagePaths, pdfPath, textContents } = await convertFileToPageImages(inputPath, tempDir);
    if (imagePaths.length === 0) {
      throw new Error('La conversion n\'a produit aucune page.');
    }

    const flipbookId = uuidv4();
    const pageUrls = await uploadPagesToStorage(imagePaths, flipbookId);

    // Stocker le texte extrait pour la recherche plein texte
    if (textContents && textContents.length > 0) {
      const pageTextRows = textContents.map((text, idx) => ({
        flipbook_id: flipbookId,
        page: idx + 1,
        text_content: text || '',
      }));
      const { error: textError } = await supabase
        .from('flipbook_page_text')
        .insert(pageTextRows);
      if (textError) {
        console.error('Erreur stockage texte pages:', textError);
        // Non bloquant : on continue même si l'indexation échoue
      }
    }

    // Le PDF n'existe que si le fichier d'origine n'était pas une simple image
    let pdfUrl = null;
    if (pdfPath) {
      pdfUrl = await uploadPdfToStorage(pdfPath, flipbookId);
    }

    res.json({ flipbookId, pageCount: pageUrls.length, pageUrls, pdfUrl });
  } catch (err) {
    console.error('Erreur de conversion :', err);
    res.status(500).json(classifyConversionError(err));
  } finally {
    await cleanupTempDir(tempDir);
    await fs.remove(req.file.path).catch(() => {});
  }
});

/**
 * POST /convert-images
 * Reçoit PLUSIEURS images (form-data, champ "images", plusieurs fichiers),
 * les combine en un seul PDF (comme un scanner), puis crée le flipbook à
 * partir de ce PDF.
 */
router.post('/convert-images', handleUpload(upload.array('images', 50)), async (req, res) => {
  if (!req.files || req.files.length === 0) {
    return res.status(400).json({ error: 'Aucune image reçue (champ "images" manquant).' });
  }

  for (const file of req.files) {
    const ext = path.extname(file.originalname).toLowerCase();
    if (!EXTENSIONS_IMAGES.includes(ext)) {
      await Promise.all(req.files.map((f) => fs.remove(f.path)));
      return res.status(400).json({ error: `Format d'image non supporté : ${ext}` });
    }
  }

  const tempDir = await createTempDir();

  try {
    // Renomme chaque image avec son extension d'origine et son ordre
    // d'upload, pour que la fusion en PDF respecte l'ordre choisi.
    const orderedImagePaths = [];
    for (let i = 0; i < req.files.length; i++) {
      const file = req.files[i];
      const ext = path.extname(file.originalname).toLowerCase();
      const dest = path.join(tempDir, `input-${i + 1}${ext}`);
      await fs.move(file.path, dest);
      orderedImagePaths.push(dest);
    }

    const pdfPath = await combineImagesToPdf(orderedImagePaths, tempDir);

    const flipbookId = uuidv4();
    // Les pages du flipbook sont les images originales (pas besoin de les
    // re-générer depuis le PDF, elles sont déjà des images de bonne qualité).
    const pageUrls = await uploadPagesToStorage(orderedImagePaths, flipbookId);
    const pdfUrl = await uploadPdfToStorage(pdfPath, flipbookId);

    // Insérer lignes de texte vides pour les images (pas d'OCR pour l'instant)
    const emptyTextRows = orderedImagePaths.map((_, idx) => ({
      flipbook_id: flipbookId,
      page: idx + 1,
      text_content: '',
    }));
    const { error: textError } = await supabase
      .from('flipbook_page_text')
      .insert(emptyTextRows);
    if (textError) {
      console.error('Erreur stockage texte pages (images):', textError);
    }

    res.json({ flipbookId, pageCount: pageUrls.length, pageUrls, pdfUrl });
  } catch (err) {
    console.error('Erreur de fusion en PDF :', err);
    res.status(500).json(classifyConversionError(err));
  } finally {
    await cleanupTempDir(tempDir);
    await Promise.all(req.files.map((f) => fs.remove(f.path).catch(() => {})));
  }
});

module.exports = router;
