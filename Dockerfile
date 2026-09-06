FROM node:22-slim

# Installe LibreOffice (conversion Word/PPT/TXT ↔ PDF), Poppler
# (PDF → images), Calibre (EPUB → PDF) et Ghostscript (compression PDF)
RUN apt-get update && \
    apt-get install -y --no-install-recommends libreoffice poppler-utils calibre ghostscript && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev

COPY . .

EXPOSE 3000
CMD ["node", "src/index.js"]
