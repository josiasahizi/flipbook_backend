const express = require('express');

const supabase = require('../services/supabaseClient');

const router = express.Router();

// ============================================================
// RÉCOMPENSES — publicités récompensées (+1 place flipbook)
// ============================================================

/// POST /rewards/ad-watched
/// Crédite +1 place bonus (user_stats.bonus_slots) à l'utilisateur
/// authentifié après le visionnage complet d'une publicité récompensée.
/// Le SDK AdMob confirme côté client que la pub a été vue en entier avant
/// d'appeler cette route (voir AdsService.showRewardedAd) — l'écriture se
/// fait via la clé service_role, jamais directement par le client.
router.post('/rewards/ad-watched', async (req, res) => {
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

    const { data: rows, error: fetchError } = await supabase
      .from('user_stats')
      .select('bonus_slots')
      .eq('user_id', user.id)
      .limit(1);
    if (fetchError) throw fetchError;

    const newBonusSlots = (rows?.[0]?.bonus_slots ?? 0) + 1;

    const { error: upsertError } = await supabase
      .from('user_stats')
      .upsert({ user_id: user.id, bonus_slots: newBonusSlots }, { onConflict: 'user_id' });
    if (upsertError) throw upsertError;

    res.json({ bonusSlots: newBonusSlots });
  } catch (err) {
    console.error('Erreur POST /rewards/ad-watched:', err);
    res.status(500).json({ error: 'Erreur serveur', code: 'SERVER_ERROR' });
  }
});

module.exports = router;
