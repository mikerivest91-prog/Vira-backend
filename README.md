# VIRA backend

Premier backend sécurisé pour VIRA : le navigateur envoie un prompt au serveur, et le serveur appelle le fournisseur d'images.

## Installation

1. Installer Node.js 20+.
2. Dans ce dossier :
   `npm install`
3. Copier `.env.example` vers `.env`.
4. Mettre la clé API dans `.env` :
   `OPENAI_API_KEY=...`
5. Lancer :
   `npm start`

## Test

Ouvrir :
`http://localhost:3000/api/health`

Puis envoyer un POST JSON à :
`/api/images/generate`

Exemple de corps :
`{"prompt":"A cinematic vertical 9:16 city scene at night","size":"1024x1536","quality":"medium"}`

La clé API reste côté serveur et n'est jamais mise dans le HTML.
