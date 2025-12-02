# Dossier /data

Dépose ici tes fichiers JSON (un par magasin et/ou par ville), par ex.:
- `walmart_laval.json`

## Format JSON attendu
Chaque fichier est un tableau d'objets:
[
  {
    "title": "Nom du produit",
    "image": "URL complète de l'image",
    "price": 199.99,
    "salePrice": 99.99,
    "store": "Walmart",
    "city": "Laval",
    "url": "https://exemple.com/produit"
  }
]

Champs requis: title, image, price, salePrice, store, city, url.
