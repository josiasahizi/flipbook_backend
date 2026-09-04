# Flipbook Backend

Backend Node.js qui convertit un fichier PDF, Word, PPT ou image en une série
d'images (une par page), et les stocke dans Supabase Storage.

## Prérequis système (à installer sur la machine serveur)

Ce backend s'appuie sur quatre outils externes en ligne de commande :

1. **LibreOffice** (pour convertir Word/PPT/TXT ↔ PDF)
2. **Poppler-utils** (pour convertir PDF → images, via `pdftoppm`)
3. **Calibre** (pour convertir les EPUB → PDF, via `ebook-convert`)
4. **Ghostscript** (pour compresser les PDF, via `gs`)

### Installation sur Ubuntu/Debian
```bash
sudo apt-get update
sudo apt-get install -y libreoffice poppler-utils calibre ghostscript
```

### Installation sur macOS
```bash
brew install libreoffice poppler ghostscript
brew install --cask calibre
```

### Sur Windows
Télécharge et installe [Calibre](https://calibre-ebook.com/download_windows) et
[Ghostscript](https://ghostscript.com/releases/gsdnld.html), puis ajoute
leurs dossiers d'installation au PATH (même procédure que pour
LibreOffice/Poppler).

⚠️ Sur Windows, la commande Ghostscript s'appelle `gswin64c` (pas `gs`).
Ajoute cette ligne à ton `.env` :
```
GHOSTSCRIPT_CMD=gswin64c
```

Vérifie les installations avec :
```powershell
ebook-convert --version
gswin64c --version
```

### Sur Windows
Le plus simple est d'exécuter ce backend dans un conteneur Docker basé sur
Ubuntu (voir `Dockerfile` fourni), plutôt que d'installer LibreOffice
nativement.

## Configuration Supabase

1. Crée un bucket **public** nommé `flipbook-pages` dans Supabase Storage
   (Dashboard > Storage > New bucket > coche "Public bucket")
2. Crée un second bucket **public** nommé `tool-outputs` (pour les fichiers
   générés par la section "Outils" : PDF compressés, fusionnés, etc.)
3. Copie `.env.example` vers `.env` et renseigne :
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY` (⚠️ clé service_role, pas la clé anon)

## Installation et démarrage

```bash
npm install
npm run dev     # mode développement (redémarre automatiquement)
# ou
npm start        # mode production
```

Le serveur démarre sur `http://localhost:3000` par défaut.

## Utilisation de l'API

### `GET /health`
Vérifie que le serveur tourne.

### `POST /convert`
Envoie un fichier à convertir.

**Requête** (`multipart/form-data`) :
- `file` : le fichier PDF/Word/PPT/TXT/EPUB/image

**Réponse** :
```json
{
  "flipbookId": "uuid-généré",
  "pageCount": 5,
  "pageUrls": ["https://.../page-1.png", "..."],
  "pdfUrl": "https://.../document.pdf"
}
```
`pdfUrl` est `null` si le fichier d'origine était une simple image (rien à
proposer au téléchargement dans ce cas).

### `POST /convert-images`
Envoie plusieurs images à fusionner en un seul PDF (comme un scanner).

**Requête** (`multipart/form-data`) :
- `images` : plusieurs fichiers image, dans l'ordre souhaité des pages

**Réponse** : identique à `/convert`, avec `pdfUrl` toujours renseigné.

L'app Flutter appelle ensuite `SupabaseService.createFlipbook(...)` avec ces
`pageUrls` et `pdfUrl` pour enregistrer le flipbook en base de données.

## Section « Outils » (conversions indépendantes du flipbook)

Chaque endpoint reçoit un ou plusieurs fichiers, effectue la conversion,
uploade le résultat dans le bucket `tool-outputs`, et répond avec :
```json
{ "downloadUrl": "https://.../fichier.pdf", "fileName": "fichier.pdf" }
```

| Endpoint | Champ(s) attendu(s) | Description |
|---|---|---|
| `POST /tools/word-to-pdf` | `file` (.doc/.docx) | Word → PDF |
| `POST /tools/pdf-to-word` | `file` (.pdf) | PDF → Word |
| `POST /tools/text-to-pdf` | `file` (.txt) | Texte → PDF |
| `POST /tools/image-to-pdf` | `file` (image) | Une image → PDF |
| `POST /tools/images-to-pdf` | `files` (plusieurs images) | Plusieurs images → un seul PDF |
| `POST /tools/merge-pdf` | `files` (plusieurs .pdf) | Fusionne des PDF |
| `POST /tools/split-pdf` | `file` (.pdf) | Divise en un .zip (1 PDF par page) |
| `POST /tools/compress-pdf` | `file` (.pdf) | Réduit la taille du PDF |

## Prochaine étape

Brancher cet appel dans `upload_screen.dart` (côté Flutter), à l'endroit
indiqué par le commentaire `TODO`.
