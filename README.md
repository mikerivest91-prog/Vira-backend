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

## Forfaits et blocs de crédits

La page authentifiée `/abonnements` présente Starter (29,99 CAD, 4 vidéos/16 images), Croissance (79,99 CAD, 12/48), Pro (149,99 CAD, 24/96), puis les blocs de 4 exports (24,99 CAD), 16 images (9,99 CAD) et 4 animations de 5 secondes (9,99 CAD). Les achats de la nouvelle boutique sont désactivés par défaut ; l'ancien pilote Stripe de test reste distinct.

Configuration serveur de la nouvelle boutique :

- `OLYVEX_COMMERCE_ENABLED=true` active les droits de la nouvelle boutique ; en mode test, seuls les comptes dans `BILLING_TEST_EMAILS` sont concernés.
- `STRIPE_MODE=test` par défaut, ou `live` explicitement. Les clés, prix, événements et soldes doivent correspondre à ce mode. La clé existante `STRIPE_SECRET_KEY` doit avoir le préfixe approprié.
- `COMMERCE_WEBHOOK_SECRET` correspond au nouvel endpoint brut `/api/commerce/webhook`. Ne pas remplacer le secret de l'ancien endpoint `/api/stripe/webhook`.
- `STRIPE_PRICE_STARTER`, `STRIPE_PRICE_GROWTH`, `STRIPE_PRICE_PRO`, `STRIPE_PRICE_VIDEO_PACK`, `STRIPE_PRICE_IMAGE_PACK`, `STRIPE_PRICE_ANIMATION_PACK`. Starter accepte aussi l'ancien `STRIPE_PRICE_ID` comme valeur de repli. Les montants, devise, récurrence, quantité et mode sont revérifiés côté serveur. Créer des prix CAD sans conversion dynamique, coupons ou taxes ajoutées au total des blocs dans ce premier parcours.
- `STRIPE_PORTAL_CONFIGURATION` : portail dédié actif, même mode, annulation à fin de période activée, modification immédiate de forfait désactivée. La modification des moyens de paiement peut être activée. Les changements de forfait en milieu de période et les proratas ne sont pas implémentés ; le client peut gérer l'annulation puis choisir un nouveau forfait après sa fin.
- Les offres comprenant des images ne sont achetables que si `AI_IMAGES_ENABLED`, `OPENAI_API_KEY` et l'autorisation client correspondante sont configurés. Le bloc animation exige `RUNWAY_CLIENTS_ENABLED=true` et `RUNWAYML_API_SECRET`. Le parcours client est `/animations`, séparé du pilote administrateur. Il réserve un crédit avant l'appel, rend le crédit sur échec fournisseur confirmé et conserve la réservation sur résultat ambigu, sans nouvel envoi automatique.

Événements à abonner : `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.paid`, `invoice.payment_failed`, `charge.refunded`, `charge.dispute.created`. Les livraisons sont signées et l'état courant est relu auprès de Stripe. Une facture de création/renouvellement payée finance la période ; le retour du navigateur n'attribue aucun crédit. Un bloc payé est crédité une seule fois, même avec des événements en double. Une facture proratisée n'est pas acceptée comme renouvellement normal.

Les crédits mensuels expirent à la fin de la période Stripe payée, sans report. Les blocs ont un solde séparé, sans expiration programmée, utilisable avec un abonnement actif. Les unités mensuelles sont consommées avant les blocs. Les tables `olyvex_credit_grants` et `olyvex_credit_spend` conservent les attributions et réservations ; des verrous PostgreSQL sérialisent les opérations par utilisateur. Des déclencheurs restituent une réservation lorsqu'une ligne d'usage média est supprimée après échec. Une attribution révoquée ou expirée ne redevient pas utilisable lors de cette restitution.

Politique prudente du premier parcours : un remboursement, même partiel, ou une contestation suspend les nouvelles créations et révoque les crédits du mode concerné pour vérification manuelle. Ne pas réactiver automatiquement un compte ni recalculer une dette client sans revue des paiements et consommations. Les exports déjà sauvegardés restent accessibles. Les tentatives facturées au résultat incertain demandent également une revue manuelle.

Avant activation commerciale : connecter et tester Stripe de bout en bout, vérifier les produits/prix et le portail, les conditions de vente/facturation applicables, la qualité et l'accès aux fournisseurs IA, puis dimensionner le stockage et les capacités globales. Le plafond média existant est conservé ; les forfaits n'augmentent pas automatiquement l'espace disque. Ne pas ouvrir les achats d'une fonctionnalité encore indisponible.

Tests sans réseau fournisseur : `npm ci --include=dev --ignore-scripts` puis `npm test`. Les tests de crédits utilisent PostgreSQL embarqué (PGlite) et les appels Stripe/Runway sont simulés ; ils ne remplacent pas un paiement de test Stripe et ne constituent pas un test de charge multi-instance.

## Éditeur de scénario et storyboard

Le bouton « Modifier le scénario et les scènes » permet de corriger les textes et de réordonner les quatre scènes avec leurs médias. Le modèle de rubriques est partagé entre serveur et navigateur dans `script-model.js` ; il reconnaît uniquement les titres de section, sans confondre le mot « narration » dans un titre de campagne avec une rubrique. Les termes de marque AI/IA saisis par l'utilisateur ne sont plus remplacés automatiquement lors de l'affichage du scénario.

La route authentifiée `PATCH /api/campaigns/:id/script` verrouille la campagne par propriétaire et compare le scénario d'origine avant toute écriture. Elle préserve le brief, la marque et les médias ; un changement d'ordre applique la même permutation aux deux tableaux de médias. Une narration modifiée invalide la référence audio. Une modification du scénario retire l'export courant des éléments prêts et conserve son URL dans `previousExport` ; le fichier lui-même n'est pas supprimé. La narration est conservée pour une correction de texte non vocal ou un changement d'ordre, sauf incohérence avec le texte d'une voix automatique enregistrée.

Éditer un scénario ne consomme aucun crédit et ne déclenche aucun appel IA. Les descriptions modifiées ne régénèrent pas les visuels ; l'utilisateur les remplace ou les génère séparément. Un nouvel export suit toujours les règles du forfait. Ce storyboard reste limité aux quatre scènes du pipeline actuel et ne constitue pas une timeline multipiste.

Vérification ciblée : `npm run test:editor`. Les tests d'écriture utilisent PostgreSQL embarqué, sans données client ni fournisseur externe.

## Formats et sous-titres

L'étape Export propose portrait 720×1280, carré 720×720 et paysage 1280×720. Le montage conserve les proportions, ajoute des marges et adapte la carte de marque. Les nouveaux imports photo et vidéo préservent leur rapport d'origine ; les anciens médias déjà normalisés en portrait doivent être réimportés pour récupérer leurs proportions originales. Chaque MP4 reste un export décompté selon le forfait existant.

`POST /api/audio/captions` analyse uniquement un WAV du compte connecté, limité à 60 secondes. OpenAI reçoit ce WAV via la clé serveur existante ; le modèle `whisper-1`, `verbose_json` et les repères par mot servent à grouper de courtes lignes sans inventer un minutage uniforme. Aucun nouvel essai automatique. Le résultat est mis en cache à côté de l'audio, contrôlé par son empreinte SHA-256, et compté dans le stockage. Les appels partagent le plafond quotidien vocal et le verrou média global existants. Les corrections manuelles et les téléchargements SRT/VTT ne lancent aucun appel fournisseur. Les temps, le nombre et la taille des lignes sont validés côté serveur. Une modification de voix oblige à recréer ou ressaisir les sous-titres ; les lignes ne sont jamais appliquées à un autre identifiant audio.

`GET/PATCH /api/campaigns/:id/export-settings` stocke les options par propriétaire, sans remplacer le reste de la campagne. L'export revalide la liaison avec l'audio réel avant de réserver un crédit vidéo. Les sous-titres sont incrustés après la marque, avec la police embarquée et une piste transparente temporaire, sans dépendance à libass ni commande contenant le texte utilisateur. La suppression du silence final conserve l'origine temporelle ; les rares repères dépassant ce silence retiré sont coupés à la durée finale.

Limite fournisseur à suivre : la documentation OpenAI consultée le 4 novembre 2026 annonce le retrait de `whisper-1` le 26 février 2027. Cette première intégration utilise les repères documentés disponibles aujourd'hui ; prévoir le remplacement du moteur de synchronisation avant cette date. En cas d'indisponibilité, la saisie manuelle reste accessible et aucune fausse synchronisation n'est générée. Sources : https://developers.openai.com/api/docs/guides/speech-to-text et https://developers.openai.com/api/reference/resources/audio/subresources/transcriptions/methods/create . Vérifier les noms commerciaux et les temps dans l'éditeur avant publication.

Tests : `npm run test:exports` et suite complète `npm test`. Le contrôle de rendu local produit les trois MP4 avec audio, sous-titres et carte de marque ; les tests unitaires du fournisseur utilisent des réponses simulées et ne constituent pas une validation de l'accès fournisseur en production.
