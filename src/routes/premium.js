const express = require('express');
const crypto = require('crypto');

const supabase = require('../services/supabaseClient');

const router = express.Router();

const GENIUSPAY_API_URL = 'https://pay.genius.ci/api/v1/merchant/payments';
const PREMIUM_PRICE_XOF = 2000;
const WEBHOOK_MAX_AGE_SECONDS = 300;

// ============================================================
// PREMIUM — achat unique à vie via GeniusPay (mobile money CI)
// ============================================================

/// POST /premium/checkout
/// Crée une transaction GeniusPay pour l'utilisateur authentifié et renvoie
/// l'URL de la page de paiement hébergée (Orange Money / MTN / Moov / Wave).
router.post('/premium/checkout', async (req, res) => {
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

    const response = await fetch(GENIUSPAY_API_URL, {
      method: 'POST',
      headers: {
        'X-API-Key': process.env.GENIUSPAY_API_KEY,
        'X-API-Secret': process.env.GENIUSPAY_API_SECRET,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        amount: PREMIUM_PRICE_XOF,
        currency: 'XOF',
        description: 'Flipbook Premium — accès illimité à vie',
        customer: user.email ? { email: user.email } : undefined,
        metadata: { user_id: user.id },
      }),
    });

    const payload = await response.json();
    if (!response.ok) {
      console.error('Erreur création paiement GeniusPay:', payload);
      return res.status(502).json({ error: 'Erreur du service de paiement', code: 'PAYMENT_PROVIDER_ERROR' });
    }

    res.json({ checkout_url: payload.data.checkout_url, reference: payload.data.reference });
  } catch (err) {
    console.error('Erreur POST /premium/checkout:', err);
    res.status(500).json({ error: 'Erreur serveur', code: 'SERVER_ERROR' });
  }
});

/// POST /premium/webhook
/// Reçu par GeniusPay après un paiement. Vérifie la signature HMAC-SHA256
/// avant de faire confiance au contenu, puis passe l'utilisateur en Premium
/// à la réception d'un événement payment.success.
router.post('/premium/webhook', async (req, res) => {
  const signature = req.headers['x-webhook-signature'];
  const timestamp = req.headers['x-webhook-timestamp'];
  const event = req.headers['x-webhook-event'];
  const secret = process.env.GENIUSPAY_WEBHOOK_SECRET;

  if (!signature || !timestamp || !event) {
    return res.status(400).json({ error: 'Requête invalide', code: 'BAD_REQUEST' });
  }

  const age = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (!Number.isFinite(age) || age > WEBHOOK_MAX_AGE_SECONDS) {
    return res.status(401).json({ error: 'Timestamp expiré', code: 'STALE_TIMESTAMP' });
  }

  // GeniusPay signe `timestamp + "." + JSON.stringify(payload_reparsé)`, pas
  // les octets bruts reçus sur le fil (voir leur propre exemple Node.js) —
  // on doit donc re-sérialiser req.body (déjà parsé par express.json())
  // pour obtenir exactement la même chaîne, sans quoi la signature ne
  // correspondra jamais (ex. les nombres décimaux perdent leurs zéros).
  const expectedSignature = crypto
    .createHmac('sha256', secret)
    .update(`${timestamp}.${JSON.stringify(req.body)}`)
    .digest('hex');

  const signatureBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expectedSignature);
  const signatureValid =
    signatureBuffer.length === expectedBuffer.length &&
    crypto.timingSafeEqual(signatureBuffer, expectedBuffer);

  if (!signatureValid) {
    return res.status(401).json({ error: 'Signature invalide', code: 'INVALID_SIGNATURE' });
  }

  const { data } = req.body;
  if (event === 'payment.success') {
    const userId = data?.metadata?.user_id;
    if (userId) {
      const { error } = await supabase
        .from('user_stats')
        .upsert({ user_id: userId, is_premium: true }, { onConflict: 'user_id' });
      if (error) console.error('Erreur activation Premium:', error);
    }
  }

  res.json({ received: true });
});

module.exports = router;
