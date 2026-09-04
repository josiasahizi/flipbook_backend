const express = require('express');

const supabase = require('../services/supabaseClient');

const router = express.Router();

// ============================================================
// COMPTE — suppression (droit à l'effacement RGPD)
// ============================================================

/// DELETE /account
/// Supprime définitivement le compte de l'utilisateur authentifié : ses
/// flipbooks (base + fichiers Storage), ses signets, ses stats, puis le
/// compte auth lui-même. Nécessite la clé service_role (Admin API), donc
/// ne peut pas être fait directement depuis l'app Flutter.
router.delete('/account', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return res.status(401).json({ error: 'Non authentifié', code: 'UNAUTHORIZED' });
    }

    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) {
      return res.status(401).json({ error: 'Token invalide', code: 'INVALID_TOKEN' });
    }

    const userId = user.id;

    // 1. Nettoyage best-effort du Storage (pages + PDF de chaque flipbook)
    const { data: flipbooks } = await supabase
      .from('flipbooks')
      .select('id, pdf_url')
      .eq('owner_id', userId);

    for (const flipbook of flipbooks || []) {
      try {
        const { data: pageFiles } = await supabase.storage
          .from('flipbook-pages')
          .list(`pages/${flipbook.id}`);
        if (pageFiles?.length) {
          await supabase.storage
            .from('flipbook-pages')
            .remove(pageFiles.map((f) => `pages/${flipbook.id}/${f.name}`));
        }

        if (flipbook.pdf_url) {
          const { data: pdfFiles } = await supabase.storage
            .from('flipbook-pages')
            .list(`pdfs/${flipbook.id}`);
          if (pdfFiles?.length) {
            await supabase.storage
              .from('flipbook-pages')
              .remove(pdfFiles.map((f) => `pdfs/${flipbook.id}/${f.name}`));
          }
        }
      } catch (_) {
        // Nettoyage Storage secondaire — on continue même en cas d'échec.
      }
    }

    try {
      const { data: uploadFiles } = await supabase.storage.from('uploads').list(userId);
      if (uploadFiles?.length) {
        await supabase.storage
          .from('uploads')
          .remove(uploadFiles.map((f) => `${userId}/${f.name}`));
      }
    } catch (_) {
      // idem
    }

    // 2. Suppression des lignes en base (au cas où les FK ne cascadent pas)
    await supabase.from('bookmarks').delete().eq('user_id', userId);
    await supabase.from('flipbooks').delete().eq('owner_id', userId);
    await supabase.from('user_stats').delete().eq('user_id', userId);

    // 3. Suppression du compte auth lui-même (Admin API)
    const { error: deleteError } = await supabase.auth.admin.deleteUser(userId);
    if (deleteError) throw deleteError;

    res.json({ success: true });
  } catch (err) {
    console.error('Erreur DELETE /account:', err);
    res.status(500).json({ error: 'Erreur serveur', code: 'SERVER_ERROR' });
  }
});

module.exports = router;
