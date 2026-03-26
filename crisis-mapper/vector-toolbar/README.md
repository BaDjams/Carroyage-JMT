# Barre d'outils vectorielle - Crisis Mapper

## 📋 Description

La barre d'outils vectorielle est un module complémentaire pour Crisis Mapper qui permet de créer et gérer des éléments vectoriels directement sur la carte. Elle offre une interface intuitive pour dessiner, mesurer et annoter des cartes de crise.

## 🚀 Fonctionnalités

### Outils de dessin
- **Générateur de carroyages** : Création de grilles orthonormées avec échelle personnalisable
- **Lignes** : Lignes simples, polylignes et courbes vectorielles
- **Polygones** : Polygones libres et formes géométriques régulières
- **Formes simples** : Rectangles, cercles, ellipses
- **Texte** : Insertion de texte avec personnalisation

### Outils d'analyse
- **Isochrones** : Zones d'accessibilité temporelle
- **Isodistances** : Zones d'accessibilité spatiale
- **Zoning** : Création de zones selon différents critères
- **Mesure** : Outils de mesure de distances et surfaces

### Outils d'information
- **Stamps** : Insertion d'éléments prédéfinis
- **Informations** : Affichage de données sur des points/zones

## 📁 Structure des fichiers

```
vector-toolbar/
├── vector-toolbar.html      # Interface principale de la barre d'outils
├── vector-toolbar.css       # Styles de la barre d'outils
├── vector-toolbar.js        # Logique de la barre d'outils
├── vector-toolbox.html      # Interface de la toolbox de gestion
├── vector-toolbox.css       # Styles de la toolbox
├── vector-toolbox.js        # Logique de la toolbox
├── integration.js           # Fichier d'intégration avec Crisis Mapper
└── README.md               # Documentation
```

## 🔧 Installation

1. **Intégration automatique** : Le fichier `integration.js` s'occupe de l'intégration avec Crisis Mapper
2. **Bouton d'activation** : Un bouton "Outils Vectoriels" apparaît en haut à droite de l'écran
3. **Chargement dynamique** : Les fichiers sont chargés automatiquement au premier clic

## 🎯 Utilisation

### Activation de la barre d'outils
1. Cliquer sur le bouton "Outils Vectoriels" en haut à droite
2. La barre d'outils apparaît à droite de l'écran
3. La toolbox de gestion apparaît à gauche de l'écran

### Utilisation des outils
1. **Sélectionner un outil** dans la barre d'outils
2. **Suivre les instructions** affichées à l'écran
3. **Cliquer sur la carte** pour utiliser l'outil
4. **Modifier les paramètres** dans la toolbox si nécessaire

### Gestion des éléments
- **Sélection** : Cliquer sur un élément dans la toolbox
- **Modification** : Utiliser le bouton ✏️ pour modifier les propriétés
- **Duplication** : Utiliser le bouton 📋 pour dupliquer
- **Suppression** : Utiliser le bouton 🗑️ pour supprimer

## ⚙️ Configuration

### Paramètres par défaut
- **Couleur** : Vert (#4CAF50)
- **Épaisseur** : 3px
- **Opacité** : 80%

### Personnalisation
Les paramètres peuvent être modifiés dans la section "Paramètres" de la toolbox.

## 🔒 Fonctionnalités avancées

### Verrouillage de position
- **Cadenas** : Cliquer sur l'icône 🔒/🔓 pour verrouiller/déverrouiller la position
- **Déplacement** : Glisser-déposer quand déverrouillé
- **Sauvegarde** : La position est sauvegardée automatiquement

### Sauvegarde et export
- **Sauvegarde automatique** : Les éléments sont sauvegardés localement
- **Export** : Exportation en format JSON
- **Import** : Importation d'éléments vectoriels

### Intégration avec Crisis Mapper
- **Synchronisation** : Les éléments vectoriels sont intégrés au système de marqueurs
- **Sauvegarde de projet** : Inclusion dans les sauvegardes de projet
- **Gestion des sections** : Organisation par sections comme les marqueurs

## 🎨 Styles et thème

La barre d'outils respecte le style de Crisis Mapper :
- **Police** : Open Sans
- **Couleurs** : Palette cohérente avec le programme principal
- **Responsive** : Adaptation aux différentes tailles d'écran
- **Transparence** : Fond blanc transparent avec effet de flou

## 🐛 Dépannage

### Problèmes courants
1. **Barre d'outils ne s'affiche pas** : Vérifier que les fichiers sont présents dans le dossier `vector-toolbar/`
2. **Outils ne fonctionnent pas** : Vérifier que la carte Leaflet est initialisée
3. **Éléments ne s'affichent pas** : Vérifier la console pour les erreurs JavaScript

### Logs de débogage
Les messages de débogage sont affichés dans la console du navigateur.

## 🔄 Mises à jour

### Version 1.0
- Générateur de carroyages complet
- Outils de dessin de base (lignes, polygones, formes)
- Outils de texte et mesure
- Toolbox de gestion
- Intégration avec Crisis Mapper

### Fonctionnalités en développement
- Isochrones et isodistances
- Courbes vectorielles avancées
- Stamps personnalisables
- Outils de zoning

## 📞 Support

Pour toute question ou problème :
1. Vérifier la console du navigateur pour les erreurs
2. Consulter la documentation Crisis Mapper
3. Vérifier que tous les fichiers sont présents et accessibles

## 📄 Licence

Ce module est intégré à Crisis Mapper et suit les mêmes conditions d'utilisation.
