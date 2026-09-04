const express = require('express');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');

const supabase = require('../services/supabaseClient');
const { createTempDir, cleanupTempDir } = require('../utils/tempFiles');
const { classifyConversionError } = require('../utils/errorMessages');

const router = express.Router();

// ============================================================
// BOOKMARKS — CRUD
// ============================================================

/// GET /bookmarks?flipbook_id=xxx
/// Renvoie tous les signets de l'utilisateur pour ce flipbook
router.get('/bookmarks', async (req, res) => {
  try {
    const flipbookId = req.query.flipbook_id;
    if (!flipbookId) {
      return res.status(400).json({ error: 'flipbook_id requis', code: 'MISSING_FLIPBOOK_ID' });
    }

    const { data, error } = await supabase
      .from('bookmarks')
      .select('id, page, note, created_at')
      .eq('flipbook_id', flipbookId)
      .order('page', { ascending: true });

    if (error) throw error;

    res.json({ bookmarks: data || [] });
  } catch (err) {
    console.error('Erreur GET /bookmarks:', err);
    res.status(500).json({ error: 'Erreur serveur', code: 'SERVER_ERROR' });
  }
});

/// POST /bookmarks
/// Crée un signet pour l'utilisateur connecté
/// Body: { flipbook_id, page, note? }
router.post('/bookmarks', async (req, res) => {
  try {
    const { flipbook_id, page, note } = req.body;

    if (!flipbook_id || !page) {
      return res.status(400).json({ error: 'flipbook_id et page requis', code: 'MISSING_FIELDS' });
    }
    if (typeof page !== 'number' || page < 1) {
      return res.status(400).json({ error: 'page doit être un entier > 0', code: 'INVALID_PAGE' });
    }

    // Récupérer l'utilisateur depuis le token JWT (via supabase auth)
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return res.status(401).json({ error: 'Non authentifié', code: 'UNAUTHORIZED' });
    }

    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) {
      return res.status(401).json({ error: 'Token invalide', code: 'INVALID_TOKEN' });
    }

    const { data, error } = await supabase
      .from('bookmarks')
      .insert({
        user_id: user.id,
        flipbook_id,
        page,
        note: note || null,
      })
      .select('id, page, note, created_at')
      .single();

    if (error) {
      if (error.code === '23505') { // unique violation
        return res.status(409).json({ error: 'Signet déjà existant pour cette page', code: 'BOOKMARK_EXISTS' });
      }
      throw error;
    }

    res.status(201).json({ bookmark: data });
  } catch (err) {
    console.error('Erreur POST /bookmarks:', err);
    res.status(500).json({ error: 'Erreur serveur', code: 'SERVER_ERROR' });
  }
});

/// DELETE /bookmarks/:id
/// Supprime un signet (seulement si propriétaire)
router.delete('/bookmarks/:id', async (req, res) => {
  try {
    const bookmarkId = req.params.id;

    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return res.status(401).json({ error: 'Non authentifié', code: 'UNAUTHORIZED' });
    }

    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) {
      return res.status(401).json({ error: 'Token invalide', code: 'INVALID_TOKEN' });
    }

    // Vérifier que le signet appartient à l'utilisateur
    const { data: bookmark, error: fetchError } = await supabase
      .from('bookmarks')
      .select('user_id')
      .eq('id', req.params.id)
      .single();

    if (fetchError || !bookmark) {
      return res.status(404).json({ error: 'Signet introuvable', code: 'NOT_FOUND' });
    }

    if (bookmark.user_id !== user.id) {
      return res.status(403).json({ error: 'Non autorisé', code: 'FORBIDDEN' });
    }

    const { error } = await supabase
      .from('bookmarks')
      .delete()
      .eq('id', req.params.id);

    if (error) throw error;

    res.json({ success: true });
  } catch (err) {
    console.error('Erreur DELETE /bookmarks:', err);
    res.status(500).json({ error: 'Erreur serveur', code: 'SERVER_ERROR' });
  }
});

module.exports = router;