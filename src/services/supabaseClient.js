const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

// Le backend utilise la clé "service_role" : elle donne un accès complet
// (contrairement à la clé "anon" utilisée côté app Flutter), ce qui permet
// de lire/écrire dans n'importe quel dossier du Storage.
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

module.exports = supabase;
