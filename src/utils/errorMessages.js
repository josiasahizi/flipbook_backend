/// Transforme une erreur technique (sortie de LibreOffice, pdftoppm,
/// Ghostscript, etc.) en message clair à destination de l'utilisateur.
/// Le message technique original reste dans `details` pour le débogage.
function classifyConversionError(err) {
  const message = (err && err.message) ? err.message : String(err);
  const lower = message.toLowerCase();

  // Outil externe manquant (LibreOffice, pdftoppm, Calibre, Ghostscript...)
  if (
    lower.includes('is not recognized') ||
    lower.includes('command not found') ||
    lower.includes('enoent')
  ) {
    return {
      error: 'Un outil nécessaire à la conversion est introuvable sur le serveur. '
        + 'Contacte l\'administrateur du backend.',
      code: 'MISSING_TOOL',
    };
  }

  // Fichier PDF corrompu ou invalide (pdftoppm échoue à le lire)
  if (
    lower.includes('may not be a pdf file') ||
    lower.includes('syntax error') ||
    lower.includes('couldn\'t find trailer dictionary') ||
    lower.includes('invalid pdf')
  ) {
    return {
      error: 'Ce fichier PDF semble corrompu ou invalide. Essaie un autre fichier, '
        + 'ou ré-exporte-le depuis son application d\'origine.',
      code: 'INVALID_PDF',
    };
  }

  // Erreur de filtre LibreOffice (format ou contenu non pris en charge)
  if (lower.includes('no export filter') || lower.includes('no import filter')) {
    return {
      error: 'Ce fichier n\'a pas pu être converti — son contenu ou son format '
        + 'n\'est pas pris en charge.',
      code: 'UNSUPPORTED_CONTENT',
    };
  }

  // Aucune page produite
  if (lower.includes('aucune page')) {
    return {
      error: 'La conversion n\'a produit aucune page. Le fichier est peut-être vide.',
      code: 'NO_PAGES',
    };
  }

  // Repli générique
  return {
    error: 'Une erreur inattendue est survenue pendant la conversion. Réessaie, '
      + 'ou essaie avec un autre fichier.',
    code: 'UNKNOWN',
    details: message,
  };
}

module.exports = { classifyConversionError };
