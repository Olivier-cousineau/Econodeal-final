# EconoDeal (Static)

Site statique bilingue (FR/EN) avec filtres Magasin/Ville et barre de % de rabais.

## Déploiement rapide

### GitHub Pages
1. Crée un nouveau repo `econodeal-site` sur GitHub.
2. Pousse ces fichiers (`index.html`, dossier `data/`, etc.).
3. Dans **Settings > Pages**, choisis branch `main` et dossier `/root`.
4. L'URL sera disponible après quelques minutes.

### Vercel
1. Déploie la page HTML directement. Si ton projet est en Next.js, tu peux garder ce fichier pour forcer les runtimes personnalisés.
2. Si tu veux utiliser Python
   - Utilise le runtime officiel, par exemple :
     ```json
     {
       "functions": {
         "api/**/*.py": { "runtime": "python3.11" }
       }
     }
     ```
   - Les runtimes valides sont : `nodejs18.x`, `python3.11`, etc.
3. Si ton projet est 100 % Next.js (React)
   - Tu peux simplement supprimer le fichier `vercel.json` (ou enlever la partie `functions`).

## Brancher tes données
- Dépose tes JSON dans `/data` (voir `/data/README.md`).
- Dans `index.html`, remplace `render()` pour faire des `fetch('/data/ton_fichier.json')`,
  merger les tableaux, appliquer les filtres et générer les cartes.

## Automatisations supprimées

Les scripts Python et workflows GitHub Actions qui s'occupaient de récupérer
automatiquement des aubaines Amazon ou Sporting Life ont été retirés. Toutes les
collectes de données devront être reconstruites manuellement à partir de zéro.
Les sections historiques du README ont été effacées afin d'éviter toute
confusion. Si tu dois remettre en place une automatisation, crée un nouveau
script dans `admin/` et ajoute un workflow dans `.github/workflows/` selon tes
besoins.

## Aperçus HTML rapides
- Les jeux de données organisés génèrent un aperçu statique dans `previews/<magasin>/<ville>.html`.
- Par exemple : `previews/sporting-life/montreal.html`, `previews/sporting-life/laval.html` et
  `previews/sporting-life/saint-jerome.html` permettent de feuilleter les aubaines Sporting Life
  directement depuis GitHub sans devoir lancer le site.

> ℹ️ Toutes les automatisations ont été retirées. La mise à jour des données et des aperçus se fait
manuellement en ajoutant ou en remplaçant les fichiers JSON dans `data/`.

## Activer la billetterie Stripe (checkout)

Une intégration Stripe Checkout est disponible sur les pages `pricing*.html` pour encaisser les
abonnements.

1. Dupliquez le fichier `.env.example` en `.env` et remplacez les clés par vos identifiants Stripe
   (utilisez les clés test pour vos essais locaux). Le serveur lit la variable
   `STRIPE_PUBLISHABLE_KEY`, mais acceptera aussi `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` si votre
   frontend utilise déjà cette convention.
2. Installez les dépendances Python supplémentaires :
   ```bash
   pip install -r requirements-server.txt
   ```
3. Les fonctions backend (`/config` et `/create-checkout-session`) chargent désormais automatiquement
   les variables définies dans `.env` ou `.env.local`. Vous pouvez toujours exporter manuellement
   vos variables d'environnement si vous préférez.
4. Lancez le serveur Flask fourni pour exposer les endpoints `/config` et
   `/create-checkout-session` :
   ```bash
   python server.py
   ```
5. Ouvrez `http://localhost:5000/pricing.html` (ou toute autre variante de langue) et cliquez sur
   un bouton d'essai pour rediriger vers Stripe Checkout.

> ⚠️ Les clés secrètes Stripe doivent rester côté serveur. Ne les commitez jamais dans le dépôt.

### Fournir la clé Stripe côté client (hébergement purement statique)

Si vous hébergez uniquement les fichiers statiques sans serveur (ex.: S3, GitHub Pages) et ne
disposez pas d'un endpoint `/config`, vous pouvez exposer la clé publique directement dans la page.
Le script `assets/js/stripe-checkout.js` détecte automatiquement plusieurs emplacements :

- un attribut `data-stripe-publishable-key` sur `<html>` ou `<body>` ;
- une balise `<meta name="stripe-publishable-key" content="pk_live_xxx">` ;
- un bloc `<script data-stripe-config data-publishable-key="pk_test_xxx"></script>` ;
- un objet global `window.__ENV__`, `window.__config` ou `window.__stripeConfig` contenant
  `publishableKey` ou `STRIPE_PUBLISHABLE_KEY` ;
- une variable globale `window.STRIPE_PUBLISHABLE_KEY`, `window.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`,
  `window.STRIPE_PUBLIC_KEY`, `window.stripePublishableKey` ou `window.econodealStripePublishableKey`.

Veillez à n'utiliser qu'une clé **publishable** (publique). Les clés secrètes doivent rester côté
serveur.

© 2025 EconoDeal
