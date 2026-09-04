const fs = require('fs-extra');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const os = require('os');

/// Crée un dossier temporaire unique pour une conversion, et retourne son chemin.
async function createTempDir() {
  const dir = path.join(os.tmpdir(), `flipbook-${uuidv4()}`);
  await fs.ensureDir(dir);
  return dir;
}

/// Supprime un dossier temporaire (à appeler une fois la conversion terminée).
async function cleanupTempDir(dir) {
  await fs.remove(dir);
}

module.exports = { createTempDir, cleanupTempDir };
