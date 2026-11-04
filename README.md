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

## Limites de ressources

Les préparations média sont sérialisées sur le disque partagé par un verrou PostgreSQL, libéré à la fin du traitement ou à la perte de la connexion. Un traitement actif conserve son verrou si le navigateur se déconnecte. Le quota vidéo mensuel s'applique aussi à l'ancienne route multipart `/api/video/assemble`.

Variables facultatives, avec valeurs par défaut :

- `VOICE_DAILY_LIMIT=20` : tentatives de synthèse par compte et par jour UTC.
- `VOICE_GLOBAL_DAILY_LIMIT=100` : tentatives de synthèse pour l'ensemble du service par jour UTC.
- `MEDIA_STORAGE_LIMIT_MB=200` : sources audio, clips et exports conservés par compte.
- `MEDIA_MIN_FREE_MB=100` : espace disque à préserver, en plus du budget temporaire du traitement.

Les tentatives vocales sont réservées avant l'appel facturé et ne sont pas rendues après un échec fournisseur ambigu. Les valeurs invalides ou nulles n'annulent pas les protections : les valeurs par défaut sont utilisées. Les quotas journaliers sont persistés dans `olyvex_voice_daily_usage` (créée au démarrage). Les sources et exports existants ne sont pas supprimés automatiquement. Au dépassement, seuls les nouveaux fichiers de la tentative sont nettoyés ; le support doit libérer l'espace existant avec le propriétaire.

Vérification locale sans appels IA ni courriels réels : `npm run test:security` et `npm run test:voice`.
