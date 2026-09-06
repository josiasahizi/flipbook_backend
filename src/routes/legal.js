const express = require('express');
const router = express.Router();

const EDITOR_NAME = 'JOSIDEV (Josias Ahizi)';
const CONTACT_EMAIL = 'josidev1307@gmail.com';

function layout(title, bodyHtml) {
  return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${title} — Flipbook</title>
<style>
  body { font-family: -apple-system, Segoe UI, Roboto, Arial, sans-serif; max-width: 720px; margin: 0 auto; padding: 32px 20px 80px; color: #1a1a2e; line-height: 1.6; }
  h1 { color: #6C5CE7; }
  h2 { color: #6C5CE7; font-size: 1.1em; margin-top: 32px; }
  a { color: #6C5CE7; }
</style>
</head>
<body>
${bodyHtml}
</body>
</html>`;
}

router.get('/', (req, res) => {
  res.send(layout('Accueil', `
    <h1>Flipbook</h1>
    <p>Flipbook est une application mobile qui transforme vos documents (PDF, Word, PowerPoint, images) en livres numériques interactifs avec effet de page qui se tourne.</p>
    <p>Éditeur : ${EDITOR_NAME}<br>Contact : <a href="mailto:${CONTACT_EMAIL}">${CONTACT_EMAIL}</a></p>
    <p><a href="/privacy-policy">Politique de confidentialité</a> · <a href="/terms-of-use">Conditions d'utilisation</a></p>
  `));
});

router.get('/privacy-policy', (req, res) => {
  res.send(layout('Politique de confidentialité', `
    <h1>Politique de confidentialité</h1>

    <h2>1. Qui sommes-nous</h2>
    <p>${EDITOR_NAME}, éditeur de l'application Flipbook, est responsable du traitement de vos données personnelles au sens du Règlement Général sur la Protection des Données (RGPD).<br>Contact : ${CONTACT_EMAIL}</p>

    <h2>2. Données que nous collectons</h2>
    <p>• Email, prénom, nom — fournis à l'inscription ou via la connexion Google — pour créer et gérer votre compte.<br>
    • Mot de passe (chiffré) — pour l'authentification.<br>
    • Fichiers que vous importez (PDF, Word, PowerPoint, images) — pour les convertir en flipbook.<br>
    • Flipbooks créés et leurs pages — pour les afficher dans "Mes flipbooks".<br>
    • Signets (numéro de page, note) — pour la fonctionnalité de signets.</p>
    <p>Nous ne collectons aucune donnée de localisation, aucun identifiant publicitaire, et n'utilisons aucun outil d'analyse ou de tracking.</p>

    <h2>3. Base légale du traitement</h2>
    <p>• Exécution du contrat (fourniture du service) pour la création de compte et la conversion de fichiers.<br>
    • Consentement pour l'inscription (case à cocher lors de la création de compte).</p>

    <h2>4. Destinataires des données</h2>
    <p>• Supabase (hébergement de la base de données, de l'authentification et du stockage de fichiers).<br>
    • Google (si vous choisissez "Continuer avec Google") — uniquement pour vérifier votre identité, selon la politique de confidentialité de Google.</p>
    <p>Vos données ne sont jamais vendues ni partagées à des fins publicitaires.</p>

    <h2>5. Durée de conservation</h2>
    <p>Vos données sont conservées tant que votre compte est actif. Vous pouvez les supprimer à tout moment (voir section 7).</p>

    <h2>6. Sécurité</h2>
    <p>Les mots de passe sont chiffrés. Les échanges avec nos serveurs sont chiffrés (HTTPS). L'accès à vos données est protégé par des règles de sécurité au niveau de la base de données (Row Level Security).</p>

    <h2>7. Vos droits</h2>
    <p>Conformément au RGPD, vous disposez des droits suivants :<br>
    • Accès à vos données (visibles dans l'onglet "Profil")<br>
    • Rectification (modifiables depuis l'app)<br>
    • Effacement : bouton "Supprimer mon compte" dans l'onglet Profil — suppression immédiate et définitive de votre compte, vos flipbooks, vos signets et vos fichiers<br>
    • Portabilité et opposition : contactez-nous à ${CONTACT_EMAIL}</p>

    <h2>8. Mineurs</h2>
    <p>L'application n'est pas destinée aux enfants sans le consentement d'un parent ou tuteur légal, conformément à la réglementation applicable.</p>

    <h2>9. Modifications</h2>
    <p>Cette politique peut être mise à jour. Toute modification substantielle vous sera signalée dans l'app.</p>
  `));
});

router.get('/terms-of-use', (req, res) => {
  res.send(layout("Conditions d'utilisation", `
    <h1>Conditions générales d'utilisation</h1>

    <h2>1. Objet</h2>
    <p>Les présentes Conditions Générales d'Utilisation (CGU) définissent les modalités d'accès et d'utilisation de l'application Flipbook, éditée par ${EDITOR_NAME} ("l'Éditeur"), permettant de convertir des documents (PDF, Word, PowerPoint, images) en flipbooks numériques interactifs.</p>

    <h2>2. Acceptation des CGU</h2>
    <p>La création d'un compte et/ou l'utilisation de l'application implique l'acceptation pleine et entière des présentes CGU. Si vous n'acceptez pas ces conditions, vous ne devez pas utiliser l'application.</p>

    <h2>3. Création de compte</h2>
    <p>L'utilisation de certaines fonctionnalités nécessite la création d'un compte (par email/mot de passe ou via un compte Google). Vous vous engagez à fournir des informations exactes et à assurer la confidentialité de vos identifiants. Vous êtes responsable de toute activité effectuée depuis votre compte.</p>

    <h2>4. Contenus importés par l'utilisateur</h2>
    <p>Vous restez propriétaire des fichiers que vous importez et des flipbooks que vous créez. En les important, vous garantissez disposer des droits nécessaires sur ces contenus et accordez à l'Éditeur le droit strictement nécessaire de les traiter techniquement (conversion, stockage, affichage) afin de fournir le service.</p>
    <p>Il est interdit d'importer des contenus illicites, protégés par des droits de tiers sans autorisation, ou contraires à l'ordre public.</p>

    <h2>5. Utilisation autorisée</h2>
    <p>Vous vous engagez à ne pas :<br>
    • tenter de contourner les mesures de sécurité de l'application ou de ses serveurs ;<br>
    • utiliser l'application à des fins frauduleuses ou illégales ;<br>
    • perturber le bon fonctionnement du service.</p>

    <h2>6. Propriété intellectuelle</h2>
    <p>L'application, son design, son code et sa marque sont la propriété de l'Éditeur et sont protégés par le droit de la propriété intellectuelle. Aucune disposition des présentes CGU ne vous confère de droit sur ces éléments, à l'exception d'un droit d'usage personnel de l'application.</p>

    <h2>7. Disponibilité et responsabilité</h2>
    <p>L'Éditeur s'efforce d'assurer la disponibilité et le bon fonctionnement de l'application, sans garantie de continuité absolue. L'Éditeur ne saurait être tenu responsable des dommages indirects résultant de l'utilisation ou de l'impossibilité d'utiliser l'application, ni de la perte de données résultant d'un cas de force majeure.</p>
    <p>Il vous appartient de conserver une copie de vos fichiers originaux en dehors de l'application.</p>

    <h2>8. Suppression de compte et résiliation</h2>
    <p>Vous pouvez supprimer votre compte à tout moment depuis l'onglet "Profil" de l'application. Cette suppression est définitive et entraîne l'effacement de vos données conformément à notre Politique de confidentialité.</p>
    <p>L'Éditeur se réserve le droit de suspendre ou supprimer un compte en cas de manquement grave aux présentes CGU.</p>

    <h2>9. Modification des CGU</h2>
    <p>L'Éditeur peut modifier les présentes CGU à tout moment. La poursuite de l'utilisation de l'application après modification vaut acceptation des nouvelles CGU.</p>

    <h2>10. Droit applicable</h2>
    <p>Les présentes CGU sont soumises au droit ivoirien. Tout litige relatif à leur interprétation ou leur exécution relève de la compétence des tribunaux de Côte d'Ivoire, sous réserve des dispositions impératives applicables aux consommateurs de votre pays de résidence.</p>

    <h2>11. Contact</h2>
    <p>Pour toute question relative aux présentes CGU : ${CONTACT_EMAIL}</p>
  `));
});

module.exports = router;
