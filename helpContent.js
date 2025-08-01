// helpContent.js

const HELP_CONTENT_HTML = `
    <h4 class="text-content border-b pb-1 font-semibold">Convertisseurs de Coordonnées</h4>
    <p>
        Cette section vous permet de convertir un point géographique entre plusieurs systèmes de coordonnées.
    </p>
    <ul class="list-disc pl-5 space-y-1">
        <li>Entrez une coordonnée dans l'un des champs : GPS (Décimal ou DMS), Mercator ou UTM.</li>
        <li>Cliquez sur le bouton <strong>"Convertir"</strong> correspondant.</li>
        <li>Tous les autres champs seront automatiquement mis à jour.</li>
        <li>Le format UTM attendu est : <code>Zone Lettre Easting Northing</code> (ex: <code>31 U 448252 5411943</code>).</li>
        <li>Le bouton "Voir sur Maps" ouvre Google Maps à l'emplacement correspondant.</li>
    </ul>

    <h4 class="text-content border-b pb-1 font-semibold">Générateur de Carroyage CADO</h4>
    <p>
        Génère un carroyage personnalisé (A1, B2, etc.) basé sur un point de référence. La compréhension des deux points suivants est essentielle :
    </p>
    <ul class="list-disc pl-5 space-y-2">
        <li><strong>Point de Référence :</strong> Les coordonnées que vous entrez. C'est le <strong>pivot</strong> autour duquel la grille tourne (quand vous appliquez une déviation). Un cercle jaune est dessiné autour de ce point dans le fichier final.</li>
        <li><strong>Point d'Origine (A1) :</strong> Le coin de la case A1, qui sert d'<strong>ancre</strong> pour positionner toute la grille. Un repère jaune est placé à cet endroit.</li>
    </ul>
    <p><strong>Comment le Point de Référence est-il utilisé ?</strong></p>
    <ul class="list-disc pl-5 space-y-1">
        <li>Si vous choisissez <strong>"Origine (A1)"</strong>, vos coordonnées de référence définissent directement l'emplacement du coin de la case A1.</li>
        <li>Si vous choisissez <strong>"Milieu du carroyage"</strong>, vos coordonnées de référence définissent le centre géométrique exact de la zone que vous demandez (ex: le centre de la zone G5 à M20). L'outil calcule alors où se trouve le Point d'Origine A1 par rapport à ce centre.</li>
    </ul>

    <h4 class="text-content border-b pb-1 font-semibold">Générateur d'Image (PNG)</h4>
    <p>
        Cette fonctionnalité crée une image PNG haute résolution de votre carroyage, superposé sur un fond de carte réel. Elle inclut des éléments contextuels comme un cartouche d'information, une boussole, et une clé de subdivision.
    </p>
    <p><strong>Conditions d'activation :</strong></p>
    <ul class="list-disc pl-5 space-y-1">
        <li>La <strong>Déviation</strong> doit être à <strong>0°</strong>.</li>
        <li>Le <strong>Point de référence</strong> doit être sur <strong>"Origine (A1)"</strong> (n'importe quel type de grille est alors supporté).</li>
        <li><strong>OU</strong> le Point de référence est sur <strong>"Milieu du carroyage"</strong> ET un type de grille "imprimable" est sélectionné (ex: Q12, Z18).</li>
    </ul>
     <p><strong>Fonctionnalités :</strong></p>
     <ul class="list-disc pl-5 space-y-1">
        <li><strong>Rendu dynamique :</strong> Tous les éléments (grille, cartouche, boussole) s'adaptent automatiquement à la taille de la grille choisie (Q12, Z18, etc.).</li>
        <li><strong>Choix du fond de carte :</strong> Vous pouvez sélectionner différents fonds de carte (Bing, OSM, Esri) via la liste déroulante à côté du bouton.</li>
        <li><strong>Lisibilité Améliorée :</strong> Les étiquettes de la grille possèdent un contour pour rester lisibles sur n'importe quel fond.</li>
    </ul>


    <h4 class="text-content border-b pb-1 font-semibold">Générateur de Grille UTM</h4>
    <p>
        Génère les lignes de la grille UTM officielle (précision 1km) pour une zone rectangulaire.
    </p>
     <p><strong>Fonctionnalités clés :</strong></p>
    <ul class="list-disc pl-5 space-y-1">
        <li><strong>Multi-zone :</strong> Gère automatiquement la traversée de plusieurs zones UTM.</li>
        <li><strong>Lignes Précises :</strong> Les lignes sont "tessellées" pour suivre la courbure de la Terre, garantissant une grande précision visuelle dans Google Earth.</li>
        <li><strong>Respect des Limites :</strong> Les lignes s'arrêtent proprement aux frontières des zones, sans déborder.</li>
        <li><strong>Étiquettes Alignées :</strong> Des étiquettes (tous les 5km) sont placées directement <em>sur</em> les lignes de grille pour un repérage clair et sans décalage.</li>
    </ul>

    <h4 class="text-content border-b pb-1 font-semibold">Formats de Fichiers</h4>
     <ul class="list-disc pl-5 space-y-1">
        <li><strong>KMZ :</strong> Format compressé pour Google Earth. Idéal pour le carroyage CADO avec icônes intégrées et pour la grille UTM.</li>
        <li><strong>KML :</strong> Format standard pour Google Earth et Google Maps (sans icônes intégrées).</li>
        <li><strong>GeoJSON :</strong> Format universel pour les systèmes d'information géographique (SIG).</li>
        <li><strong>GPX :</strong> Format pour les appareils GPS et les applications de randonnée comme OsmAnd.</li>
    </ul>
`;