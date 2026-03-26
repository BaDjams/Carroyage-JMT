
const markerToolbox = document.getElementById('markerToolbox');
// En haut de ton script
const stuckData = new Map(); // garder ceci comme unique source de vérité


// Variables pour la fonction copier/coller
let copiedMarkerData = null;
let pasteCount = 0; // Compteur pour le décalage accumulé

// --- Carte ---
var map = L.map('map', { zoomControl:false }).setView([48.85887,2.34598],13);
var osm = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom:19, attribution:'© OSM'});
var satellite = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { attribution:'© Esri'});
var googleHybrid = L.tileLayer('http://mt{s}.google.com/vt/lyrs=y&hl=fr&x={x}&y={y}&z={z}&apistyle=s.t%3a2|s.e%3al|p.v%3aoff', {
  subdomains: ['0', '1', '2', '3'],
  maxZoom: 21,
  attribution: '© Google'
}).addTo(map);
var googleMaps = L.tileLayer('http://mt{s}.google.com/vt/lyrs=m&hl=fr&x={x}&y={y}&z={z}&apistyle=s.t%3a2|s.e%3al|p.v%3aoff', {
  subdomains: ['0', '1', '2', '3'],
  maxZoom: 21,
  attribution: '© Google'
});


const basemapSelector = document.getElementById('basemapSelector');

// Gestion du clic sur le bouton de basculement
document.getElementById("toggleBasemap").addEventListener("click", function(){
  basemapSelector.style.display = basemapSelector.style.display === 'none' ? 'block' : 'none';
});

// Gestion de la sélection dans le menu déroulant
document.querySelectorAll('.basemap-option').forEach(option => {
  option.addEventListener('click', function() {
    const selectedBasemap = this.dataset.basemap;
    
    // Mettre àjour l'état actif
    document.querySelectorAll('.basemap-option').forEach(opt => opt.classList.remove('active'));
    this.classList.add('active');
    
    // Changer le fond de carte
    if(selectedBasemap === 'osm') {
      map.removeLayer(satellite);
      map.removeLayer(googleHybrid);
      map.removeLayer(googleMaps);
      osm.addTo(map);
    } else if(selectedBasemap === 'satellite') {
      map.removeLayer(osm);
      map.removeLayer(googleHybrid);
      map.removeLayer(googleMaps);
      satellite.addTo(map);
    } else if(selectedBasemap === 'google') {
      map.removeLayer(osm);
      map.removeLayer(satellite);
      map.removeLayer(googleMaps);
      googleHybrid.addTo(map);
    } else if(selectedBasemap === 'googlemaps') {
      map.removeLayer(osm);
      map.removeLayer(satellite);
      map.removeLayer(googleHybrid);
      googleMaps.addTo(map);
    }
    
    // Fermer le menu
    basemapSelector.style.display = 'none';
  });
});

// Fermer le menu si on clique ailleurs
document.addEventListener('click', function(event) {
  if (!event.target.closest('#toggleBasemap') && !event.target.closest('#basemapSelector')) {
    basemapSelector.style.display = 'none';
  }
});
L.control.scale({ position: 'bottomleft', metric: true, imperial: false, maxWidth: 200 }).addTo(map);

// --- Indicateur de zoom ---
const zoomIndicator = document.getElementById('zoomIndicator');
let zoomUpdateTimer = null;

function updateZoomIndicator() {
  zoomIndicator.textContent = `${map.getZoom()}`;
}

// Optimisation : debouncing pour l'indicateur de zoom
function debouncedUpdateZoomIndicator() {
  if (zoomUpdateTimer) {
    clearTimeout(zoomUpdateTimer);
  }
  zoomUpdateTimer = setTimeout(updateZoomIndicator, 100); // 100ms de debounce
}

// Mettre àjour l'indicateur de zoom lors des changements avec debouncing
map.on('zoomend', debouncedUpdateZoomIndicator);
updateZoomIndicator(); // Initialiser avec le zoom actuel

// --- Variables globales optimisées ---
const CrisisMapper = {
  // État de l'application
  selectedImagePath: "",
  selectedImageType: null,
  selectedMarker: null,
  altPressed: false,
  justAddedMarker: false,
  
  // Données principales
  sections: [
    { id: 'carroyages', name: 'Carroyages', order: 0, menuId: 'carroCustom' },
    { id: 'icones', name: 'Icônes', order: 1, menuId: 'iconCustom' },
    { id: 'vectoriels', name: 'Outils Vectoriels', order: 2, menuId: 'vectorCustom' }
  ],
  markers: [],
  addedImages: [],
  vectorElements: [], // Nouveaux éléments vectoriels
  currentProject: null,
  
  // Cache DOM pour éviter les requêtes répétées
  domCache: {},
  
  // Configuration
  config: {
    maxImageSize: 5 * 1024 * 1024, // 5MB max par image
    debounceDelay: 300, // ms pour la recherche
    maxMarkers: 1000 // Limite de marqueurs
  }
};

// Rétrocompatibilité
var selectedImagePath = CrisisMapper.selectedImagePath;
var selectedImageType = CrisisMapper.selectedImageType;
var selectedMarker = CrisisMapper.selectedMarker;
var altPressed = CrisisMapper.altPressed;
let justAddedMarker = CrisisMapper.justAddedMarker;
let sections = CrisisMapper.sections;
let markers = CrisisMapper.markers;
let currentProject = CrisisMapper.currentProject;
let addedImages = CrisisMapper.addedImages;
let vectorElements = CrisisMapper.vectorElements;

// --- Cache DOM optimisé ---
const DOMCache = {
  get: (id) => {
    if (!CrisisMapper.domCache[id]) {
      CrisisMapper.domCache[id] = document.getElementById(id);
    }
    return CrisisMapper.domCache[id];
  },
  
  clear: () => {
    CrisisMapper.domCache = {};
  },
  
  refresh: (id) => {
    delete CrisisMapper.domCache[id];
    return DOMCache.get(id);
  }
};

// --- Indicateur ALT ---
var altIndicator = document.createElement('div');
altIndicator.style.cssText = "position:absolute;bottom:20px;right:20px;padding:6px 10px;background:rgba(76,175,80,0.8);color:white;font-weight:bold;border-radius:5px;z-index:1002;display:none;";
altIndicator.textContent='Mode répétition : ALT';
document.body.appendChild(altIndicator);

// Fonction Alt+clic supprimée selon les spécifications

document.addEventListener("keydown", e => {
  // Gestion des raccourcis clavier
  if (e.ctrlKey) {
    if (e.key === 'c' && selectedMarker) {
      e.preventDefault();
      copyMarker(selectedMarker);
      return;
    }
    if (e.key === 'v') {
      e.preventDefault();
      pasteMarker();
      return;
    }
  }
  
  // Gestion de la suppression
  if ((e.key === "Delete" || e.key === "Backspace") && selectedMarker) {
    // Vérifier si c'est un marqueur de type carroyage
    if (selectedMarker._section === 'carroyages') {
      CustomMessages.confirm('⚠️ ATTENTION : Vous êtes sur le point de supprimer un marqueur de type CARROYAGE.\n\nLes carroyages sont généralement des éléments importants de votre carte.\n\nÊtes-vous sûr de vouloir continuer ?', 'Suppression de carroyage', (confirmed) => {
        if (!confirmed) return; // Annuler la suppression si l'utilisateur refuse
        
        // Continuer avec la suppression
        deleteSelectedMarker();
      });
      return;
    }
    
    // Supprimer directement si ce n'est pas un carroyage
    deleteSelectedMarker();
  }
});

// Fonction pour supprimer le marqueur sélectionné
function deleteSelectedMarker() {
  if (!selectedMarker) return;
  
  // Supprimer le marker de stuckData s'il y est
  if (stuckData.has(selectedMarker)) {
    stuckData.delete(selectedMarker);
  }
  
  // Supprimer le marqueur du tableau markers
  const markerIndex = markers.indexOf(selectedMarker);
  if (markerIndex > -1) {
    markers.splice(markerIndex, 1);
  }
  
  if (selectedMarker.borderDiv) map.removeLayer(selectedMarker.borderDiv);
  map.removeLayer(selectedMarker);
  selectedMarker = null;

  // --- Masquer la toolbox ---
  markerToolbox.style.display = 'none';
}

// Gestionnaire d'événements pour la toolbox
document.addEventListener('click', function(e) {
  // Vérifier si le clic est sur un outil de la toolbox
  if (e.target.closest('#markerToolbox .tool-icon')) {
    const toolIcon = e.target.closest('.tool-icon');
    const action = toolIcon.dataset.action;
    
    if (action === 'delete' && selectedMarker) {
      // Vérifier si c'est un marqueur de type carroyage
      if (selectedMarker._section === 'carroyages') {
        CustomMessages.confirm('⚠️ ATTENTION : Vous êtes sur le point de supprimer un marqueur de type CARROYAGE.\n\nLes carroyages sont généralement des éléments importants de votre carte.\n\nÊtes-vous sûr de vouloir continuer ?', 'Suppression de carroyage', (confirmed) => {
          if (!confirmed) return; // Annuler la suppression si l'utilisateur refuse
          
          // Continuer avec la suppression
          deleteSelectedMarker();
        });
        return;
      }
      
      // Supprimer directement si ce n'est pas un carroyage
      deleteSelectedMarker();
    }
    
    // Gestion des boutons copier/coller
    if (action === 'copy' && selectedMarker) {
      copyMarker(selectedMarker);
    }
    
    if (action === 'paste') {
      pasteMarker();
    }
  }
});

document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && selectedMarker) {
    // Désélectionne le marker
    selectedMarker.isSelected = false;

    // Met à jour le cadre
    if (selectedMarker.updateBorder) selectedMarker.updateBorder();

    // Masque la toolbox
    markerToolbox.style.display = 'none';

    // Réinitialise la variable
    selectedMarker = null;
  }
});


// WeakMap pour stocker les markers "stuck"

function toggleStuck(marker) {
    if (!marker) return;

    // Activation du stuck
    if (!stuckData.has(marker)) {
        const center = marker.getLatLng();
        const icon = marker._icon.querySelector('img');
        const originalSize = icon ? [icon.width, icon.height] : (marker._originalSize || [100, 100]);
        
        // Stockage des données
        stuckData.set(marker, {
            center: center,
            rotation: marker._rotation || 0,
            originalSize: originalSize,
            originalZoom: map.getZoom(),
            imageSrc: selectedImagePath || marker._icon.querySelector('img').src
        });

        marker.dragging.disable();
        marker.setOpacity(1.0);

        // Mettre à jour l'icône de la toolbox pour indiquer l'état stuck
        const stuckIcon = document.querySelector('[data-action="stuck"]');
        if (stuckIcon) {
            stuckIcon.textContent = '📌'; // Icône épinglée
            stuckIcon.style.color = 'red';
        }

    } else {
        // Désactivation du stuck
        marker.dragging.enable();
        marker.setOpacity(1);
        stuckData.delete(marker);

        // Remettre l'icône normale
        const stuckIcon = document.querySelector('[data-action="stuck"]');
        if (stuckIcon) {
            stuckIcon.textContent = '📌';
            stuckIcon.style.color = '';
        }
    }

    if(marker.updateBorder) marker.updateBorder();
    updateStuckMarker(marker); // appliquer scale & rotation immédiatement
    
    // Mettre à jour les poignées après le changement d'état stuck
    if (marker.isSelected) {
        // Reconfigurer les poignées pour refléter le nouvel état
        setupIntegratedResizeHandles(marker);
    }
}

// Fonction pour appliquer zoom / rotation / taille
function updateStuckMarker(marker) {
    if (!stuckData.has(marker)) return;

    const data = stuckData.get(marker);
    const currentZoom = map.getZoom();
    const originalZoom = data.originalZoom || 13;
    
    // Calculer le facteur de zoom
    const zoomFactor = Math.pow(2, currentZoom - originalZoom);
    
    // Recalculer la taille en pixels
    const newWidth = data.originalSize[0] * zoomFactor;
    const newHeight = data.originalSize[1] * zoomFactor;


    // Créer une nouvelle icône avec la taille mise à jour ET la rotation
    const imageSrc = data.imageSrc || marker._icon.querySelector('img').src;
    const rotation = data.rotation || marker._rotation || 0;
    const newIcon = L.divIcon({
        html: `<img src="${imageSrc}" style="width:${newWidth}px;height:${newHeight}px;transform-origin:50% 50%;transform:rotate(${rotation}deg);">`,
        iconSize: [newWidth, newHeight],
        iconAnchor: [newWidth/2, newHeight/2],
        className: ''
    });

    // Appliquer la nouvelle icône
    marker.setIcon(newIcon);

    // Mettre à jour la rotation stockée dans le marqueur
    marker._rotation = rotation;

    // Garder le centre fixe
    marker.setLatLng(data.center);

    if(marker.updateBorder) marker.updateBorder();
}

// Mise à jour automatique au zoom pour markers stuck
let zoomTimeout;
map.on('zoom', () => {
    // Délai pour éviter les mises à jour trop fréquentes
    clearTimeout(zoomTimeout);
    zoomTimeout = setTimeout(() => {
        for (const [marker, data] of stuckData) {
            updateStuckMarker(marker);
        }
    }, 50); // 50ms de délai
});

// Mise à jour finale lors de la fin du zoom
map.on('zoomend', () => {
    for (const [marker, data] of stuckData) {
        updateStuckMarker(marker);
    }
});

// Mise à jour lors du déplacement de la carte
map.on('moveend', () => {
    for (const [marker, data] of stuckData) {
        updateStuckMarker(marker);
    }
});

// --- Fonctions utilitaires ---
function resetCustomSelects(){
  document.querySelectorAll('.custom-select').forEach(custom=>{
    const defaultOption = custom.querySelector('.option[data-path=""]');
    const selectedSpan = custom.querySelector('span');
    selectedSpan.textContent = defaultOption.textContent.trim(); // texte
    const img = custom.querySelector('.selected-option img');  // supprimer uniquement l'image de selected-option
    if(img) img.remove();
  });
}

function getIconSize(w,h,type){
  var mapSize = map.getSize();
  if(type==="carroyages"){
    var targetHeight = mapSize.y*0.85; // 85% de la hauteur de la page
    var scale = targetHeight/h;
    return [w*scale, h*scale];
  } else {
    var maxDim = Math.max(mapSize.x,mapSize.y);
    var scale = (maxDim*0.03)/Math.max(w,h); // 3% de la dimension maximale
    return [w*scale,h*scale];
  }
}

function resizeMarker(marker, scale) {
  if (!marker || !marker._icon) return;
  const img = marker._icon.querySelector('img');
  if (!img) return;

  // Ne pas recalculer la taille des marqueurs restaurés depuis GPS
  if (marker._restoredFromGPS) {
    console.log(`Marqueur restauré depuis GPS - taille préservée (${marker._originalSize[0]}x${marker._originalSize[1]}px)`);
    return;
  }

  // Taille originale stockée
  if(!marker._originalSize) {
    marker._originalSize = [img.width, img.height];
  }

  const newWidth = marker._originalSize[0] * scale;
  const newHeight = marker._originalSize[1] * scale;

  img.style.width = newWidth + "px";
  img.style.height = newHeight + "px";

  // Recentrage via iconAnchor avec rotation préservée
  const rotation = marker._rotation || 0;
  const imgWithRotation = img.outerHTML.replace(
    /style="[^"]*"/g, 
    `style="width:${newWidth}px;height:${newHeight}px;transform:rotate(${rotation}deg);transform-origin:50% 50%;"`
  );
  
  marker.setIcon(L.divIcon({
    html: imgWithRotation,
    iconSize: [newWidth,newHeight],
    iconAnchor: [newWidth/2,newHeight/2],
    className: ''
  }));

  // Réappliquer rotation et cadre
  applyRotation(marker);
  if(marker.updateBorder) marker.updateBorder();
}

// 📁¥ Fonction utilitaire pour appliquer la rotation (cadre ↑ marqueur)
function applyRotation(marker) {
  if (!marker) return;
  
  // 0. Mettre à jour la rotation dans les données stuck si le marqueur est stuck
  if (stuckData.has(marker)) {
    const data = stuckData.get(marker);
    data.rotation = marker._rotation || 0;
    stuckData.set(marker, data);
  }
  
  // 1. D'abord, mettre à jour le cadre de sélection
  if (marker.updateBorder) {
    marker.updateBorder();
  }
  
  // 2. Ensuite, synchroniser le marqueur avec le cadre
  if (marker.borderDiv) {
    syncMarkerWithFrame(marker);
  }
  
  // 3. Mettre à jour les poignées de redimensionnement pour qu'elles suivent la rotation
  if (marker.isSelected && marker.resizeZones && marker.resizeZones.length > 0) {
    updateResizeZonesPosition(marker);
  }
}

// 📁¥ Fonction pour appliquer la rotation à l'image du marqueur lors de la sélection
function applyRotationToIconImage(marker) {
  if (!marker || !marker._icon) return;
  const img = marker._icon.querySelector('img');
  if (img) {
    img.style.transform = `rotate(${marker._rotation || 0}deg)`;
    img.style.transformOrigin = '50% 50%';
  }
}

// 📁¥ Fonction pour synchroniser le marqueur avec le cadre de sélection
function syncMarkerWithFrame(marker) {
  if (!marker.borderDiv) return;
  
  // Le marqueur suit la position du cadre
  marker.setLatLng(marker.borderDiv.getLatLng());
  
  // Le marqueur suit la taille du cadre
  const frameSize = marker.borderDiv.options.icon.options.iconSize;
  const currentIcon = marker.options.icon;
  const rotation = marker._rotation || 0;
  
  const newHtml = currentIcon.options.html.replace(
    /style="[^"]*"/g, 
    `style="width:${frameSize[0]}px;height:${frameSize[1]}px;transform:rotate(${rotation}deg);transform-origin:50% 50%;"`
  );
  
  const newIcon = L.divIcon({
    html: newHtml,
    iconSize: frameSize,
    iconAnchor: [frameSize[0] / 2, frameSize[1] / 2],
    className: currentIcon.options.className || ''
  });
  
  marker.setIcon(newIcon);
  
  // Mettre à jour la rotation dans les données stuck si le marqueur est stuck
  if (stuckData.has(marker)) {
    const data = stuckData.get(marker);
    data.rotation = rotation;
    stuckData.set(marker, data);
  }
}

// --- Curseur ---
function setupMarkerHoverCursor(marker){
  marker.on('mouseover', ()=>{ const el = marker.getElement(); if(el) el.classList.add('cursor-move'); });
  marker.on('mouseout', ()=>{ const el = marker.getElement(); if(el) el.classList.remove('cursor-move'); });
}

// --- Poignées de redimensionnement et rotation intégrées ---
function setupIntegratedResizeHandles(marker) {
  // Fonction pour configurer les événements des poignées
  const setupHandles = () => {
    if (!marker.borderDiv || !marker.borderDiv._icon) return;
    
    const borderElement = marker.borderDiv._icon;
    const isStuck = stuckData.has(marker);
    
    // Configurer les poignées de redimensionnement
    const resizeHandles = borderElement.querySelectorAll('.marker-resize-zone');
    resizeHandles.forEach(handle => {
      const corner = handle.dataset.corner;
      if (!corner) return;
      
      // Supprimer les anciens événements pour éviter les doublons
      handle.removeEventListener('mousedown', handle._resizeHandler);
      
      // Si le marqueur est stuck, désactiver les poignées de redimensionnement
      if (isStuck) {
        // Désactiver visuellement et fonctionnellement
        handle.style.pointerEvents = 'none';
        handle.style.opacity = '0.3';
        handle.style.cursor = 'not-allowed';
        return; // Ne pas ajouter d'événements
      } else {
        // Réactiver visuellement et fonctionnellement
        handle.style.pointerEvents = 'auto';
        handle.style.opacity = '1';
        handle.style.cursor = '';
        
        // Créer le gestionnaire d'événement
        handle._resizeHandler = (e) => {
          e.preventDefault();
          e.stopPropagation();
          startResize(marker, corner, e);
        };
        
        // Ajouter le nouvel événement
        handle.addEventListener('mousedown', handle._resizeHandler);
      }
    });
    
    // Configurer la poignée de rotation
    const rotationHandle = borderElement.querySelector('.marker-rotation-handle');
    if (rotationHandle) {
      // Supprimer les anciens événements pour éviter les doublons
      rotationHandle.removeEventListener('mousedown', rotationHandle._rotationHandler);
      
      // Si le marqueur est stuck, désactiver la poignée de rotation
      if (isStuck) {
        // Désactiver visuellement et fonctionnellement
        rotationHandle.style.pointerEvents = 'none';
        rotationHandle.style.opacity = '0.3';
        rotationHandle.style.cursor = 'not-allowed';
      } else {
        // Réactiver visuellement et fonctionnellement
        rotationHandle.style.pointerEvents = 'auto';
        rotationHandle.style.opacity = '1';
        rotationHandle.style.cursor = 'grab';
        
        // Créer le gestionnaire d'événement
        rotationHandle._rotationHandler = (e) => {
          e.preventDefault();
          e.stopPropagation();
          startRotation(marker, e);
        };
        
        // Ajouter le nouvel événement
        rotationHandle.addEventListener('mousedown', rotationHandle._rotationHandler);
      }
    } else {
    }
  };
  
  // Configurer immédiatement si le cadre existe
  setupHandles();
  
  // Reconfigurer à chaque mise à jour du cadre
  const originalUpdateBorder = marker.updateBorder;
  marker.updateBorder = function() {
    originalUpdateBorder.call(this);
    // Petit délai pour s'assurer que le DOM est mis à jour
    setTimeout(setupHandles, 10);
  };
}

// --- Marker hover + sélection fusionné ---
function setupMarker(marker){
  marker.borderDiv = null;
  marker.isSelected = false;
  marker._rotation = marker._rotation || 0;
  


  function updateBorder(){
    try {
      const iconOpts = marker && marker.options && marker.options.icon && marker.options.icon.options;
      const iconSize = iconOpts && iconOpts.iconSize;
      if (!iconSize) return;

      const rotationDeg = marker._rotation || 0;
      const isStuck = stuckData.has(marker);
      
      // Logique d'affichage du cadre :
      // - Marqueurs sélectionnés : toujours afficher
      // - Marqueurs stuck : afficher si sélectionné ou au survol
      // - Marqueurs normaux : afficher si sélectionné ou au survol
      const shouldShowBorder = marker.isSelected || marker._isHovered;
      
      // Les poignées sont maintenant intégrées nativement dans le HTML du cadre
      // Plus besoin de gestion séparée
      
      const color = isStuck ? 'red' : (marker.isSelected ? 'lime' : 'cyan');
      const borderStyle = '2px dashed'; // Tous les cadres en tirets maintenant
      const anchor = iconOpts.iconAnchor || [Math.round(iconSize[0]/2), Math.round(iconSize[1]/2)];

      // Gérer l'affichage du cadre selon les conditions
      if (shouldShowBorder) {
        // si n'existe pas -> création, sinon on met à jour icon (pour anchor/size)
        if (!marker.borderDiv){
          // Créer le HTML du cadre avec les poignées intégrées
          const rotationDeg = marker._rotation || 0;
          const isSelected = marker.isSelected;
          
          const borderHtml = `
            <div class="hover-border" style="
              width: ${Math.round(iconSize[0])}px; 
              height: ${Math.round(iconSize[1])}px;
              border: ${borderStyle} ${color};
              border-radius: 5px;
              box-sizing: border-box;
              transform: rotate(${rotationDeg}deg);
              transform-origin: 50% 50%;
              position: relative;
            ">
              ${isSelected ? `
                <!-- Poignées de redimensionnement -->
                <div class="marker-resize-zone nw" data-corner="nw" style="
                  position: absolute; left: -6px; top: -6px; width: 12px; height: 12px;
                  background: #4CAF50; border: 2px solid white; border-radius: 50%;
                  cursor: nw-resize; z-index: 1000; box-shadow: 0 2px 4px rgba(0,0,0,0.3);
                  transform: rotate(${-rotationDeg}deg); transform-origin: 50% 50%;
                "></div>
                <div class="marker-resize-zone ne" data-corner="ne" style="
                  position: absolute; right: -6px; top: -6px; width: 12px; height: 12px;
                  background: #4CAF50; border: 2px solid white; border-radius: 50%;
                  cursor: ne-resize; z-index: 1000; box-shadow: 0 2px 4px rgba(0,0,0,0.3);
                  transform: rotate(${-rotationDeg}deg); transform-origin: 50% 50%;
                "></div>
                <div class="marker-resize-zone sw" data-corner="sw" style="
                  position: absolute; left: -6px; bottom: -6px; width: 12px; height: 12px;
                  background: #4CAF50; border: 2px solid white; border-radius: 50%;
                  cursor: sw-resize; z-index: 1000; box-shadow: 0 2px 4px rgba(0,0,0,0.3);
                  transform: rotate(${-rotationDeg}deg); transform-origin: 50% 50%;
                "></div>
                <div class="marker-resize-zone se" data-corner="se" style="
                  position: absolute; right: -6px; bottom: -6px; width: 12px; height: 12px;
                  background: #4CAF50; border: 2px solid white; border-radius: 50%;
                  cursor: se-resize; z-index: 1000; box-shadow: 0 2px 4px rgba(0,0,0,0.3);
                  transform: rotate(${-rotationDeg}deg); transform-origin: 50% 50%;
                "></div>
                
                <!-- Poignée de rotation -->
                <div class="marker-rotation-handle" data-action="rotate" style="
                  position: absolute; top: -25px; left: 50%; transform: translateX(-50%);
                  width: 16px; height: 16px; background: #FF9800; border: 2px solid white;
                  border-radius: 50%; cursor: grab; z-index: 1000; box-shadow: 0 2px 4px rgba(0,0,0,0.3);
                  display: flex; align-items: center; justify-content: center; font-size: 10px; color: white;
                  font-weight: bold; user-select: none; pointer-events: auto;
                ">↻</div>
              ` : ''}
            </div>
          `;
          
          marker.borderDiv = L.marker(marker.getLatLng(), {
            icon: L.divIcon({
              html: borderHtml,
              iconSize: iconSize,
              iconAnchor: anchor,
              className: ''
            }),
            interactive: false,
            zIndexOffset: (marker.options && marker.options.zIndexOffset ? marker.options.zIndexOffset : 1000) + 1
          }).addTo(map);
        } else {
          // Mettre à jour le cadre existant avec les poignées intégrées
          const rotationDeg = marker._rotation || 0;
          const isSelected = marker.isSelected;
          
          const borderHtml = `
            <div class="hover-border" style="
              width: ${Math.round(iconSize[0])}px; 
              height: ${Math.round(iconSize[1])}px;
              border: ${borderStyle} ${color};
              border-radius: 5px;
              box-sizing: border-box;
              transform: rotate(${rotationDeg}deg);
              transform-origin: 50% 50%;
              position: relative;
            ">
              ${isSelected ? `
                <!-- Poignées de redimensionnement -->
                <div class="marker-resize-zone nw" data-corner="nw" style="
                  position: absolute; left: -6px; top: -6px; width: 12px; height: 12px;
                  background: #4CAF50; border: 2px solid white; border-radius: 50%;
                  cursor: nw-resize; z-index: 1000; box-shadow: 0 2px 4px rgba(0,0,0,0.3);
                  transform: rotate(${-rotationDeg}deg); transform-origin: 50% 50%;
                "></div>
                <div class="marker-resize-zone ne" data-corner="ne" style="
                  position: absolute; right: -6px; top: -6px; width: 12px; height: 12px;
                  background: #4CAF50; border: 2px solid white; border-radius: 50%;
                  cursor: ne-resize; z-index: 1000; box-shadow: 0 2px 4px rgba(0,0,0,0.3);
                  transform: rotate(${-rotationDeg}deg); transform-origin: 50% 50%;
                "></div>
                <div class="marker-resize-zone sw" data-corner="sw" style="
                  position: absolute; left: -6px; bottom: -6px; width: 12px; height: 12px;
                  background: #4CAF50; border: 2px solid white; border-radius: 50%;
                  cursor: sw-resize; z-index: 1000; box-shadow: 0 2px 4px rgba(0,0,0,0.3);
                  transform: rotate(${-rotationDeg}deg); transform-origin: 50% 50%;
                "></div>
                <div class="marker-resize-zone se" data-corner="se" style="
                  position: absolute; right: -6px; bottom: -6px; width: 12px; height: 12px;
                  background: #4CAF50; border: 2px solid white; border-radius: 50%;
                  cursor: se-resize; z-index: 1000; box-shadow: 0 2px 4px rgba(0,0,0,0.3);
                  transform: rotate(${-rotationDeg}deg); transform-origin: 50% 50%;
                "></div>
                
                <!-- Poignée de rotation -->
                <div class="marker-rotation-handle" data-action="rotate" style="
                  position: absolute; top: -25px; left: 50%; transform: translateX(-50%);
                  width: 16px; height: 16px; background: #FF9800; border: 2px solid white;
                  border-radius: 50%; cursor: grab; z-index: 1000; box-shadow: 0 2px 4px rgba(0,0,0,0.3);
                  display: flex; align-items: center; justify-content: center; font-size: 10px; color: white;
                  font-weight: bold; user-select: none; pointer-events: auto;
                ">↻</div>
              ` : ''}
            </div>
          `;
          
          marker.borderDiv.setIcon(L.divIcon({
            html: borderHtml,
            iconSize: iconSize,
            iconAnchor: anchor,
            className: ''
          }));
          marker.borderDiv.setLatLng(marker.getLatLng());
        }
      } else {
        // Supprimer le cadre si on ne doit pas l'afficher
        if (marker.borderDiv) {
          try { map.removeLayer(marker.borderDiv); } catch(e){}
          marker.borderDiv = null;
        }
        return; // Sortir de la fonction si pas de cadre à afficher
      }

      // appliquer style (taille + couleur + rotation) au div interne
// appliquer style (taille + couleur + rotation) au div interne
const borderIconDom = marker.borderDiv && marker.borderDiv._icon;
if (borderIconDom){
    const div = borderIconDom.querySelector('.hover-border') || borderIconDom.firstChild;
    if (div ){
        div.style.width = Math.round(iconSize[0]) + "px";
        div.style.height = Math.round(iconSize[1]) + "px";
        div.style.border = borderStyle + " " + color;
        div.style.borderRadius = "5px";
        div.style.boxSizing = "border-box";

        // 📁¥ ajouter rotation ici
        div.style.transform = `rotate(${rotationDeg}deg)`;
        div.style.transformOrigin = '50% 50%';
    }
}

      // repositionne le cadre exactement sur le marker
      if (marker.borderDiv) marker.borderDiv.setLatLng(marker.getLatLng());
      
      // Mettre à jour les poignées après la mise à jour du cadre
      if (marker.isSelected) {
        setupIntegratedResizeHandles(marker);
      }
    } catch (err){
      console.error("updateBorder erreur:", err);
    }
  }

  marker.updateBorder = updateBorder;

  // Appliquer la rotation lors de l'ajout du marqueur
  marker.on('add', () => applyRotation(marker));

  // Clic : toggle sélection
  marker.on('click', e => {
    if (selectedMarker && selectedMarker !== marker) {
      selectedMarker.isSelected = false;
      if (selectedMarker.updateBorder) selectedMarker.updateBorder();
    }

    marker.isSelected = !marker.isSelected;
    selectedMarker = marker.isSelected ? marker : null;

    // applique rotation éventuelle à l'image et met à jour le cadre
    applyRotationToIconImage(marker);
    updateBorder();

    markerToolbox.style.display = marker.isSelected ? 'flex' : 'none';
    e.originalEvent.stopPropagation();
  });

  // hover
  marker.on('mouseover', ()=>{ 
    marker._isHovered = true;
    if(marker.updateBorder) marker.updateBorder(); 
  });
  marker.on('mouseout', (e)=>{
    // Ne pas déclencher mouseout si on survole les poignées de redimensionnement
    if (marker.resizeZones && marker.resizeZones.length > 0) {
      const target = e.originalEvent.relatedTarget;
      if (target && marker.resizeZones.some(zone => zone.contains(target))) {
        return; // Ne pas déclencher mouseout si on va vers une poignée
      }
    }
    marker._isHovered = false;
    if(marker.updateBorder) marker.updateBorder();
  });

  // drag : déplacer le cadre en même temps (seulement si pas stuck)
  marker.on('drag', ()=>{
    if(!stuckData.has(marker) && marker.borderDiv) {
      marker.borderDiv.setLatLng(marker.getLatLng());
    }
  });

  // s'assurer que l'image garde la rotation si l'icône est recréée
marker.on('add', () => applyRotation(marker));

  makeMarkerDraggable(marker);
  setupMarkerHoverCursor(marker);
  
  // Configurer les événements des poignées intégrées
  setupIntegratedResizeHandles(marker);
  
  // Log pour vérifier si setupMarker modifie la taille
  if (marker._restoredFromGPS) {
    const img = marker._icon ? marker._icon.querySelector('img') : null;
    if (img) {
      console.log(`Après setupMarker - taille: ${img.width}x${img.height}px (section: ${marker._section})`);
    }
  }
}

// --- Fonction pour réorganiser le z-index des marqueurs ---
function reorganizeMarkerZIndex() {
  // Séparer les marqueurs par type
  const carroyageMarkers = markers.filter(marker => marker._section === 'carroyages');
  const otherMarkers = markers.filter(marker => marker._section !== 'carroyages');
  
  // Appliquer z-index négatif aux carroyages (arrière-plan)
  carroyageMarkers.forEach((marker, index) => {
    marker.setZIndexOffset(-1000 - index);
  });
  
  // Appliquer z-index positif aux autres marqueurs (premier plan)
  otherMarkers.forEach((marker, index) => {
    marker.setZIndexOffset(1000 + index);
  });
  
}

// --- Draggable ---
function makeMarkerDraggable(marker){
  marker.options.draggable=true;
  // Ne pas activer le dragging si le marker est stuck
  if(!stuckData.has(marker)) {
    marker.dragging.enable();
  }
}

// --- Redimensionnement avec la souris ---
function addResizeHandles(marker) {
  if (!marker.isSelected) return;
  
  // Si le marqueur est stuck, ne pas ajouter les poignées de redimensionnement
  if (stuckData.has(marker)) {
    return;
  }
  
  // Vérifier si les zones existent déjà et sont toujours valides
  if (marker.resizeZones && marker.resizeZones.length > 0) {
    // Vérifier que les poignées sont toujours attachées au DOM
    const validZones = marker.resizeZones.filter(zone => zone.parentNode);
    if (validZones.length === marker.resizeZones.length) {
      return; // Ne pas recréer si elles existent déjà et sont valides
    } else {
      // Nettoyer les poignées orphelines
      marker.resizeZones = validZones;
    }
  }
  
  // Supprimer les zones existantes
  removeResizeHandles(marker);
  
  // Créer les zones de redimensionnement intégrées au CADRE DE SÉLECTION
  const borderElement = marker.borderDiv ? marker.borderDiv._icon : null;
  if (!borderElement) {
    console.warn('addResizeHandles: Le cadre de sélection n\'existe pas. Le marqueur doit être sélectionné d\'abord.');
    return;
  }
  
  marker.resizeZones = [];
  const corners = ['nw', 'ne', 'sw', 'se'];
  
  corners.forEach(corner => {
    const zone = document.createElement('div');
    zone.className = `marker-resize-zone ${corner}`;
    zone.dataset.corner = corner;
    
    // Ajouter la zone au CADRE DE SÉLECTION (pas au marqueur)
    borderElement.appendChild(zone);
    marker.resizeZones.push(zone);
    
    // Gestion du redimensionnement
    zone.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      startResize(marker, corner, e);
    });
    
    // Empêcher la disparition des poignées lors du survol
    zone.addEventListener('mouseenter', (e) => {
      e.stopPropagation();
    });
    
    zone.addEventListener('mouseleave', (e) => {
      e.stopPropagation();
    });
  });
  
  // Positionner correctement les poignées dès leur création
  updateResizeZonesPosition(marker);
}

function removeResizeHandles(marker) {
  if (marker.resizeZones) {
    marker.resizeZones.forEach(zone => {
      if (zone.parentNode) {
        zone.parentNode.removeChild(zone);
      }
    });
    marker.resizeZones = [];
  }
  
  
  // Nettoyer les anciennes poignées si elles existent
  if (marker.resizeHandles) {
    marker.resizeHandles.forEach(handle => {
      map.removeLayer(handle);
    });
    marker.resizeHandles = [];
  }
}

function updateResizeZonesPosition(marker) {
  if (!marker.resizeZones || marker.resizeZones.length === 0) return;
  
  // Utiliser le cadre de sélection comme référence
  const borderElement = marker.borderDiv ? marker.borderDiv._icon : null;
  if (!borderElement) return;
  
  const iconOpts = marker.options.icon.options;
  const width = iconOpts.iconSize[0];
  const height = iconOpts.iconSize[1];
  const rotation = marker._rotation || 0;
  
  // Cache pour éviter les recalculs inutiles
  if (marker._lastResizeUpdate && 
      marker._lastResizeUpdate.width === width && 
      marker._lastResizeUpdate.height === height && 
      marker._lastResizeUpdate.rotation === rotation) {
    return; // Pas de changement, pas besoin de recalculer
  }
  
  // Positionner les poignées aux coins du cadre (plus simple !)
  marker.resizeZones.forEach(zone => {
    const corner = zone.dataset.corner;
    if (!corner) return;
    
    // Réinitialiser les styles
    zone.style.left = '';
    zone.style.right = '';
    zone.style.top = '';
    zone.style.bottom = '';
    zone.style.transform = '';
    
    // Positionner aux coins du cadre
    switch(corner) {
      case 'nw':
        zone.style.left = '-6px';
        zone.style.top = '-6px';
        break;
      case 'ne':
        zone.style.right = '-6px';
        zone.style.top = '-6px';
        break;
      case 'sw':
        zone.style.left = '-6px';
        zone.style.bottom = '-6px';
        break;
      case 'se':
        zone.style.right = '-6px';
        zone.style.bottom = '-6px';
        break;
    }
    
    // 🔥 Appliquer la rotation du cadre aux poignées
    if (rotation !== 0) {
      zone.style.transform = `rotate(${rotation}deg)`;
      zone.style.transformOrigin = '50% 50%';
    } else {
      zone.style.transform = '';
    }
    
    // Améliorer l'indicateur visuel des poignées
    zone.style.background = '#4CAF50';
    zone.style.border = '2px solid white';
    zone.style.borderRadius = '50%';
    zone.style.boxShadow = '0 2px 4px rgba(0,0,0,0.3)';
    zone.style.width = '12px';
    zone.style.height = '12px';
    
    // S'assurer que les poignées restent visibles et fonctionnelles
    zone.style.display = 'block';
    zone.style.position = 'absolute';
  });
  
  // Mettre à jour le cache
  marker._lastResizeUpdate = { width, height, rotation };
}

// --- Fonction de rotation avec la poignée ---
function startRotation(marker, e) {
  const startMouseX = e.clientX;
  const startMouseY = e.clientY;
  const startRotation = marker._rotation || 0;
  const center = marker.getLatLng();
  
  // Calculer l'angle initial entre la souris et le centre du marqueur
  const rect = marker.borderDiv._icon.getBoundingClientRect();
  const centerX = rect.left + rect.width / 2;
  const centerY = rect.top + rect.height / 2;
  const startAngle = Math.atan2(startMouseY - centerY, startMouseX - centerX);
  
  let isRotating = false;
  
  // Optimisation : variables pour debouncing de la rotation
  let lastRotationTime = 0;
  const ROTATION_INTERVAL = 16; // 60fps
  
  function onMouseMove(e) {
    e.preventDefault();
    e.stopPropagation();
    
    isRotating = true;
    
    // Optimisation : limiter le rendu de rotation à 60fps
    const currentTime = performance.now();
    if (currentTime - lastRotationTime < ROTATION_INTERVAL) {
      return; // Ignorer ce frame pour maintenir 60fps
    }
    lastRotationTime = currentTime;
    
    // Calculer l'angle actuel
    const currentAngle = Math.atan2(e.clientY - centerY, e.clientX - centerX);
    const deltaAngle = currentAngle - startAngle;
    
    // Convertir en degrés et appliquer
    const deltaDegrees = deltaAngle * (180 / Math.PI);
    const newRotation = startRotation + deltaDegrees;
    
    
    // Appliquer la rotation
    marker._rotation = newRotation;
    applyRotation(marker);
  }
  
  function onMouseUp(e) {
    e.preventDefault();
    e.stopPropagation();
    
    document.removeEventListener('mousemove', onMouseMove);
    document.removeEventListener('mouseup', onMouseUp);
    
    if (isRotating) {
      // Mettre àjour le curseur
      const rotationHandle = marker.borderDiv._icon.querySelector('.marker-rotation-handle');
      if (rotationHandle) {
        rotationHandle.style.cursor = 'grab';
      }
    }
  }
  
  // Ajouter les événements globaux
  document.addEventListener('mousemove', onMouseMove);
  document.addEventListener('mouseup', onMouseUp);
  
  // Changer le curseur
  const rotationHandle = marker.borderDiv._icon.querySelector('.marker-rotation-handle');
  if (rotationHandle) {
    rotationHandle.style.cursor = 'grabbing';
  }
}

function startResize(marker, corner, e) {
  const startSize = marker.options.icon.options.iconSize;
  const startMouseX = e.clientX;
  const startMouseY = e.clientY;
  
  // Stocker la taille initiale pour le calcul
  let currentScale = 1;
  
  // Variable pour éviter la recréation multiple des zones
  let isResizing = false;
  
  // Optimisation : variables pour debouncing du rendu
  let lastRenderTime = 0;
  const RENDER_INTERVAL = 16; // 60fps (1000ms / 60fps = 16.67ms)
  
  
  // Calculer la sensibilité une seule fois au début du redimensionnement
  const mapSize = map.getSize();
  const currentWidth = marker.options.icon.options.iconSize[0];
  const currentHeight = marker.options.icon.options.iconSize[1];
  
  // Calculer le pourcentage de la page occupé par le marqueur
  const widthPercentage = (currentWidth / mapSize.x) * 100;
  const heightPercentage = (currentHeight / mapSize.y) * 100;
  const maxPercentage = Math.max(widthPercentage, heightPercentage);
  
  // Interpoler la sensibilité entre 200 (5%) et 1500 (85%)
  const minPercentage = 5;
  const maxPercentageRef = 85;
  const minSensitivity = 200;
  const maxSensitivity = 1500;
  
  const sensitivity = Math.max(minSensitivity, Math.min(maxSensitivity, 
    minSensitivity + (maxSensitivity - minSensitivity) * 
    ((maxPercentage - minPercentage) / (maxPercentageRef - minPercentage))
  ));
  
  function onMouseMove(e) {
    e.preventDefault();
    e.stopPropagation();
    
    isResizing = true;
    
    // Optimisation : limiter le rendu à60fps
    const currentTime = performance.now();
    if (currentTime - lastRenderTime < RENDER_INTERVAL) {
      return; // Ignorer ce frame pour maintenir 60fps
    }
    lastRenderTime = currentTime;
    
    // Calculer le déplacement de la souris
    const deltaX = e.clientX - startMouseX;
    const deltaY = e.clientY - startMouseY;
    
    // Prendre en compte la rotation du marqueur pour le redimensionnement
    const rotation = marker._rotation || 0;
    const rotationRad = rotation * Math.PI / 180;
    
    // Transformer les coordonnées selon la rotation
    const rotatedDeltaX = deltaX * Math.cos(-rotationRad) - deltaY * Math.sin(-rotationRad);
    const rotatedDeltaY = deltaX * Math.sin(-rotationRad) + deltaY * Math.cos(-rotationRad);
    
    // Calculer le facteur de redimensionnement basé sur la direction du coin (avec rotation)
    let scaleDelta = 0;
    switch(corner) {
      case 'nw':
        scaleDelta = -(rotatedDeltaX + rotatedDeltaY) / sensitivity;
        break;
      case 'ne':
        scaleDelta = (rotatedDeltaX - rotatedDeltaY) / sensitivity;
        break;
      case 'sw':
        scaleDelta = (-rotatedDeltaX + rotatedDeltaY) / sensitivity;
        break;
      case 'se':
        scaleDelta = (rotatedDeltaX + rotatedDeltaY) / sensitivity;
        break;
    }
    
    // Appliquer le changement de scale
    currentScale = Math.max(0.1, Math.min(10, 1 + scaleDelta)); // Limite de scale de 0.1x à10x
    
    // Appliquer le redimensionnement en conservant les proportions (sans limite de pixels)
    const newWidth = Math.max(10, startSize[0] * currentScale); // Seule limite : minimum 10px
    const newHeight = Math.max(10, startSize[1] * currentScale);
    
    // Recréer l'icône avec la nouvelle taille (méthode plus fiable)
    const currentIcon = marker.options.icon;
    const newHtml = currentIcon.options.html.replace(
      /style="[^"]*"/g, 
      `style="width:${newWidth}px;height:${newHeight}px;transform-origin:50% 50%;"`
    );
    
    const newIcon = L.divIcon({
      html: newHtml,
      iconSize: [newWidth, newHeight],
      iconAnchor: [newWidth / 2, newHeight / 2],
      className: currentIcon.options.className || ''
    });
    
        // Sauvegarder les zones de redimensionnement avant de changer l'icône
        const savedZones = marker.resizeZones ? [...marker.resizeZones] : [];
    
    // NOUVELLE APPROCHE : Redimensionner le CADRE DE SÉLECTION directement
    if (marker.borderDiv) {
      // Mettre àjour la taille du cadre de sélection
      const newFrameIcon = L.divIcon({
        html: `<div class="hover-border"></div>`,
        iconSize: [newWidth, newHeight],
        iconAnchor: [newWidth / 2, newHeight / 2],
        className: ''
      });
      
      marker.borderDiv.setIcon(newFrameIcon);
      
      // Appliquer la rotation au cadre
      const borderIconDom = marker.borderDiv._icon;
      if (borderIconDom) {
        const div = borderIconDom.querySelector('.hover-border') || borderIconDom.firstChild;
        if (div) {
          div.style.width = Math.round(newWidth) + "px";
          div.style.height = Math.round(newHeight) + "px";
          div.style.border = '2px dashed ' + (stuckData.has(marker) ? 'red' : 'lime');
          div.style.borderRadius = "5px";
          div.style.boxSizing = "border-box";
          div.style.transform = `rotate(${marker._rotation || 0}deg)`;
          div.style.transformOrigin = '50% 50%';
        }
      }
      
      // Synchroniser le marqueur avec le cadre
      syncMarkerWithFrame(marker);
    }
    
    // Mettre àjour les poignées de redimensionnement
    updateResizeZonesPosition(marker);
    
    // Restaurer les zones de redimensionnement immédiatement
    if (savedZones.length > 0) {
      setTimeout(() => {
        const borderElement = marker.borderDiv ? marker.borderDiv._icon : null;
        if (borderElement) {
          // Restaurer les zones de redimensionnement
          marker.resizeZones = [];
          savedZones.forEach(zone => {
            const newZone = zone.cloneNode(true);
            borderElement.appendChild(newZone);
            marker.resizeZones.push(newZone);

            // Réattacher l'événement
            newZone.addEventListener('mousedown', (e) => {
              e.preventDefault();
              e.stopPropagation();
              startResize(marker, newZone.dataset.corner, e);
            });
          });
          
          // Mettre àjour les positions des poignées
          updateResizeZonesPosition(marker);
        }
      }, 0);
    }
  }
  
  function onMouseUp() {
    document.removeEventListener('mousemove', onMouseMove);
    document.removeEventListener('mouseup', onMouseUp);
    
    // Le redimensionnement est déjàfinalisé dans onMouseMove
    isResizing = false;
  }
  
  // Ajouter les événements au document
  document.addEventListener('mousemove', onMouseMove);
  document.addEventListener('mouseup', onMouseUp);
}

// --- Fonctions de rotation directe ---





// Fonction updateResizeHandles supprimée - plus nécessaire avec les zones intégrées

// --- Ajout marker sur la carte ---
map.on('mousedown', function(e){
  if(!selectedImagePath) return;

  const latlng = e.latlng;
  var img = new Image(); img.src = selectedImagePath;
  img.onload = function(){
    var size = getIconSize(img.width,img.height,selectedImageType);
    var customIcon = L.divIcon({
      html: `<img src="${selectedImagePath}" style="width:${size[0]}px;height:${size[1]}px;transform-origin:50% 50%;">`,
      iconSize: size,
      iconAnchor: [size[0]/2, size[1]/2],
      className: ''
    });

    var zIndexOffset = selectedImageType==="carroyages"?0:1000;
    var marker = L.marker(latlng,{
      icon: customIcon,
      zIndexOffset: zIndexOffset,
      draggable:true
    }).addTo(map);

    // Ajouter les propriétés nécessaires pour l'export/import
    marker._imagePath = selectedImagePath;
    marker._imageData = selectedImagePath; // Si c'est déjàen Base64
    marker._section = selectedImageType;
    marker._id = Date.now() + Math.random();
    marker._rotation = 0;
    marker._scale = 1;

    setupMarker(marker);
    markers.push(marker); // Ajouter àla liste des marqueurs

    // Réorganiser le z-index pour s'assurer que les carroyages restent en arrière-plan
    reorganizeMarkerZIndex();

    // Sauvegarder l'image dans addedImages si elle n'y est pas déjà
    const imageExists = CrisisMapper.addedImages.some(img => 
      img.section === selectedImageType && 
      img.data === selectedImagePath
    );
    
    if (!imageExists) {
      // Extraire le nom de l'image depuis le chemin ou utiliser un nom par défaut
      const imageName = selectedImagePath.includes('/') 
        ? selectedImagePath.split('/').pop().split('.')[0]
        : `image_${Date.now()}`;
      
      // Utiliser selectedImagePath comme base64Data et générer un chemin virtuel
      const virtualPath = `images/${selectedImageType}/${imageName}.png`;
      saveImageToStorage(selectedImageType, virtualPath, imageName, selectedImagePath);
    }

    // Sélection auto
    if (selectedMarker && selectedMarker !== marker) {
      selectedMarker.isSelected = false;
      if (selectedMarker.updateBorder) selectedMarker.updateBorder();
    }
    marker.isSelected = true;
    selectedMarker = marker;
    if (marker.updateBorder) marker.updateBorder();
    markerToolbox.style.display = 'flex';

    // ⚡ Marquer qu'on vient d'ajouter un marker
    justAddedMarker = true;

    // Réinitialiser la sélection après ajout
    resetCustomSelects();
    selectedImagePath="";
    selectedImageType=null;
  }
});

// --- Désélection en cliquant sur la carte ---
map.on('click', function(e){
  if (justAddedMarker) {
    // Ignorer le premier click qui suit un ajout
    justAddedMarker = false;
    return;
  }

  setTimeout(() => {
    if(selectedMarker) {
      selectedMarker.isSelected = false;
      if(selectedMarker.updateBorder) selectedMarker.updateBorder();
      selectedMarker = null;
      markerToolbox.style.display = 'none';
    }
  }, 50);
});

// --- Clavier ---
document.addEventListener("keydown", e=>{
if((e.key==="Delete"||e.key==="Backspace") && selectedMarker){
  // Vérifier si c'est un marqueur de type carroyage
  if (selectedMarker._section === 'carroyages') {
    CustomMessages.confirm('⚠️ ATTENTION : Vous êtes sur le point de supprimer un marqueur de type CARROYAGE.\n\nLes carroyages sont généralement des éléments importants de votre carte.\n\nÊtes-vous sûr de vouloir continuer ?', 'Suppression de carroyage', (confirmed) => {
      if (!confirmed) return; // Annuler la suppression si l'utilisateur refuse
      
      // Continuer avec la suppression
      deleteSelectedMarker();
    });
    return;
  }
  
  // Supprimer directement si ce n'est pas un carroyage
  deleteSelectedMarker();
}

});

// --- Sidebar responsive ---
function updateSizes(){
  const sb = document.querySelector('.floating-sidebar');
  
  // Vérifier que la sidebar existe avant de calculer les tailles
  if (!sb) {
    console.warn('Sidebar non trouvée, report de updateSizes()');
    setTimeout(updateSizes, 100);
    return;
  }

  // Ne pas forcer les dimensions - laisser les styles CSS gérer
  sb.style.width = '';
  sb.style.height = '';

  // Police proportionnelle à la largeur
  let fontSize = window.innerWidth * 0.012;
  if (fontSize < 10) fontSize = 10;
  if (fontSize > 20) fontSize = 20;
  sb.style.fontSize = fontSize + 'px';

  // Tous les éléments internes (menus, options) suivent la taille
  document.querySelectorAll('.custom-select .selected-option, .custom-select .option').forEach(el => {
    el.style.padding = (window.innerWidth * 0.0012) + 'px';
    el.style.fontSize = (fontSize * 0.7) + 'px'; // proportion interne
  });

  // Bouton basemap ðŸ—ºï¸ - Ajusté pour harmoniser avec les autres boutons
  const btn = document.querySelector('.map-topright');
  btn.style.width = (window.innerWidth * 0.025) + 'px'; // 2.5vw comme les autres boutons
  btn.style.height = (window.innerWidth * 0.025) + 'px'; // Même hauteur que largeur
  btn.style.fontSize = (window.innerWidth * 0.022) + 'px'; // 2.2vw pour l'emoji carte
}

// Optimisation : debouncing pour le redimensionnement de fenêtre
let resizeDebounceTimer = null;
function debouncedUpdateSizes() {
  if (resizeDebounceTimer) {
    clearTimeout(resizeDebounceTimer);
  }
  resizeDebounceTimer = setTimeout(() => {
    const sidebar = DOMCache.get('sidebar');
    if (sidebar && !sidebar.classList.contains('collapsed')) {
      updateSizes();
      adjustSidebarHeight(); // Ajuster la hauteur après redimensionnement
    }
  }, 150); // 150ms de debounce
}

// Appel initial + écoute resize avec debouncing
window.addEventListener('resize', debouncedUpdateSizes);
// Appel initial seulement si la sidebar n'est pas enroulée
setTimeout(() => {
  const sidebar = document.getElementById('sidebar');
  if (sidebar && !sidebar.classList.contains('collapsed')) {
    updateSizes();
  }
}, 100);


// --- Menus personnalisés ---
document.querySelectorAll('.custom-select').forEach(custom=>{
  const selected = custom.querySelector('.selected-option');
  const optionsContainer = custom.querySelector('.options');
  const optionsList = custom.querySelectorAll('.option');

  selected.addEventListener('click', ()=>{ optionsContainer.style.display = optionsContainer.style.display==='block'?'none':'block'; });
optionsList.forEach(option=>{
  option.addEventListener('click', ()=>{
    updateSelectedOption(custom, option);
    optionsContainer.style.display='none';
  });
});

  document.addEventListener('click', e=>{ if(!custom.contains(e.target)) optionsContainer.style.display='none'; });
});

// --- Search bar ---
const input = document.getElementById('addressInput');
const suggestions = document.getElementById('suggestions');
let debounceTimer;
input.addEventListener('input', e=>{
  const query=e.target.value.trim(); if(!query){ suggestions.style.display='none'; return; }
  clearTimeout(debounceTimer);
  debounceTimer=setTimeout(()=>{ searchAddress(query); },300);
});
document.addEventListener("click",(e)=>{ if(!document.getElementById("searchBar").contains(e.target)) suggestions.style.display="none"; });

// Debounced search function
const debouncedSearch = (() => {
  let timeoutId;
  return (query, callback) => {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => callback(query), CrisisMapper.config.debounceDelay);
  };
})();

async function searchAddress(query){
  if(query.length < 3) {
    const suggestions = DOMCache.get('suggestions');
    suggestions.style.display = 'none';
    return;
  }
  
  try {
  let res = await fetch(`https://api-adresse.data.gouv.fr/search/?q=${encodeURIComponent(query)}&limit=5`);
  let data = await res.json();
  let results = data.features?.map(f=>({name:f.properties.label,lat:f.geometry.coordinates[1],lon:f.geometry.coordinates[0]})) || [];
  if(results.length===0){
    res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&addressdetails=1&limit=5`);
    data = await res.json();
    results = data.map(f=>({name:f.display_name,lat:parseFloat(f.lat),lon:parseFloat(f.lon)}));
  }
    
    const suggestions = DOMCache.get('suggestions');
  suggestions.innerHTML=''; 
  if(results.length>0){
    results.forEach(r=>{ const div=document.createElement('div'); div.textContent=r.name; div.addEventListener('click', ()=>selectAddress(r)); suggestions.appendChild(div); });
    suggestions.style.display='block';
  } else suggestions.style.display='none';
  } catch (error) {
    console.error('Erreur lors de la recherche:', error);
    const suggestions = DOMCache.get('suggestions');
    suggestions.style.display='none';
  }
}

function selectAddress(r){
  map.setView([r.lat,r.lon],17);
  var marker=L.marker([r.lat,r.lon]).addTo(map);
  setupMarker(marker);
  
  // Sélectionner automatiquement le marqueur de recherche
  if (selectedMarker && selectedMarker !== marker) {
    selectedMarker.isSelected = false;
    if (selectedMarker.updateBorder) selectedMarker.updateBorder();
  }
  marker.isSelected = true;
  selectedMarker = marker;
  if (marker.updateBorder) marker.updateBorder();
  markerToolbox.style.display = 'flex';
  
  suggestions.style.display='none';
  input.value=r.name;
}
function updateSelectedOption(custom, option){
  const selected = custom.querySelector('.selected-option');
  const imgSrc = option.querySelector('img')?.src || "";

  // Supprime l'image existante dans selected-option
  const existingImg = selected.querySelector('img');
  if(existingImg) existingImg.remove();

  // Ajouter nouvelle image si elle existe
  if(imgSrc){
    const img = document.createElement('img');
    img.src = imgSrc;
    selected.prepend(img);
  }

  // Mettre à jour le texte
  selected.querySelector('span').textContent = option.textContent.trim();

  // Mettre à jour les variables globales
  selectedImagePath = imgSrc; // Utiliser l'URL de l'image (Base64 ou chemin)
  
  // Déterminer le type basé sur la section
  const sectionData = CrisisMapper.sections.find(s => s.menuId === custom.id);
  selectedImageType = sectionData ? sectionData.id : "icon";
  
  // Sauvegarde automatique supprimée - pas nécessaire pour la sélection de marqueurs
}

// Afficher la toolbox uniquement si un marker est sélectionné
function updateToolbox(marker) {
  const toolbox = document.getElementById('markerToolbox');
  if(marker){
    toolbox.style.display='flex';
    
    // Mettre à jour l'icône stuck selon l'état du marker
    const stuckIcon = document.querySelector('[data-action="stuck"]');
    if (stuckIcon) {
      if (stuckData.has(marker)) {
        stuckIcon.style.color = 'red';
      } else {
        stuckIcon.style.color = '';
      }
    }
  } else {
    toolbox.style.display='none';
  }
}

// à‰couter les clics sur les icônes
document.querySelectorAll('#markerToolbox .tool-icon').forEach(icon=>{
  icon.addEventListener('click', ()=>{
    if(!selectedMarker) return;

    const action = icon.dataset.action;

    // Si stuck, on bloque tout sauf le toggle stuck
    if(stuckData.has(selectedMarker) && action !== 'stuck') return;

    switch(action){
      case 'delete':
        // Vérifier si c'est un marqueur de type carroyage
        if (selectedMarker._section === 'carroyages') {
          CustomMessages.confirm('⚠️ ATTENTION : Vous êtes sur le point de supprimer un marqueur de type CARROYAGE.\n\nLes carroyages sont généralement des éléments importants de votre carte.\n\nÊtes-vous sûr de vouloir continuer ?', 'Suppression de carroyage', (confirmed) => {
            if (!confirmed) return; // Annuler la suppression si l'utilisateur refuse
            
            // Continuer avec la suppression
            deleteSelectedMarker();
          });
          return;
        }
        
        // Supprimer directement si ce n'est pas un carroyage
        deleteSelectedMarker();
        break;
      case 'zoom-in':
        if(!selectedMarker._scale) selectedMarker._scale = 1;
        selectedMarker._scale *= 1.05;
        resizeMarker(selectedMarker, selectedMarker._scale);
        break;
      case 'zoom-out':
        if(!selectedMarker._scale) selectedMarker._scale = 1;
        selectedMarker._scale *= 0.95;
        resizeMarker(selectedMarker, selectedMarker._scale);
        break;
      case 'rotate-cw':
        selectedMarker._rotation = (selectedMarker._rotation || 0) + 10;
        applyRotation(selectedMarker);
        break;
      case 'rotate-ccw':
        selectedMarker._rotation = (selectedMarker._rotation || 0) - 10;
        applyRotation(selectedMarker);
        break;
      case 'stuck':
        toggleStuck(selectedMarker);
        break;
    }
  });
});


// Intégrer la gestion de la toolbox directement dans setupMarker
// (La fonction setupMarker originale gère déjà la sélection)

// --- Gestion des marqueurs ---
const manageMarkersModal = document.getElementById('manageMarkersModal');
const manageMarkersBtn = document.getElementById('manageMarkersBtn');
const closeMarkersModal = document.getElementById('closeMarkersModal');
const closeMarkersBtn = document.getElementById('closeMarkersBtn');

// --- Gestion des projets ---
const manageProjectsModal = document.getElementById('manageProjectsModal');
const manageProjectsBtn = document.getElementById('manageProjectsBtn');
const closeProjectsModal = document.getElementById('closeProjectsModal');
const closeProjectsBtn = document.getElementById('closeProjectsBtn');

// Système de persistance désactivé - données en mémoire uniquement
// addedImages est maintenant géré par CrisisMapper.addedImages

// --- Gestionnaires d'événements pour les nouveaux boutons ---

// Bouton de gestion des marqueurs
manageMarkersBtn.addEventListener('click', () => {
  manageMarkersModal.style.display = 'flex';
  loadTreeList();
});

// Bouton de gestion des projets
manageProjectsBtn.addEventListener('click', () => {
  manageProjectsModal.style.display = 'flex';
});

// Fermer les modales
closeMarkersModal.addEventListener('click', () => {
  manageMarkersModal.style.display = 'none';
});

closeMarkersBtn.addEventListener('click', () => {
  manageMarkersModal.style.display = 'none';
});

closeProjectsModal.addEventListener('click', () => {
  manageProjectsModal.style.display = 'none';
});

closeProjectsBtn.addEventListener('click', () => {
  manageProjectsModal.style.display = 'none';
});

// Fermer en cliquant à l'extérieur
manageMarkersModal.addEventListener('click', (e) => {
  if (e.target === manageMarkersModal) {
    manageMarkersModal.style.display = 'none';
  }
});

manageProjectsModal.addEventListener('click', (e) => {
  if (e.target === manageProjectsModal) {
    manageProjectsModal.style.display = 'none';
  }
});


// --- Fonctions de gestion de l'arborescence ---
function loadTreeList() {
  const treeList = document.getElementById('treeList');
  treeList.innerHTML = '';
  
  CrisisMapper.sections.sort((a, b) => a.order - b.order).forEach((section, index) => {
    const sectionMarkers = CrisisMapper.addedImages.filter(img => img.section === section.id);
    
    // Créer l'élément section
    const sectionElement = document.createElement('div');
    sectionElement.className = 'tree-item tree-section';
    sectionElement.draggable = true;
    sectionElement.dataset.type = 'section';
    sectionElement.dataset.index = index;
    
    sectionElement.innerHTML = `
      <div class="tree-section-header">
        <span class="tree-section-icon">📁</span>
        <span class="tree-section-name">${section.name}</span>
        <span class="tree-section-count">${sectionMarkers.length} marqueur(s)</span>
      </div>
      <div class="tree-actions-small">
        <button class="btn-tree btn-tree-edit" onclick="editSection(${index})" title="Modifier">✏️</button>
        <button class="btn-tree btn-tree-move" onclick="moveSection(${index}, -1)" ${index === 0 ? 'disabled' : ''} title="Monter">⬆️</button>
        <button class="btn-tree btn-tree-move" onclick="moveSection(${index}, 1)" ${index === CrisisMapper.sections.length - 1 ? 'disabled' : ''} title="Descendre">⬇️</button>
        <button class="btn-tree btn-tree-delete" onclick="deleteSection(${index})" title="Supprimer">🗑️</button>
      </div>
    `;
    
    treeList.appendChild(sectionElement);
    
    // Ajouter les marqueurs de cette section
    sectionMarkers.forEach((marker, markerIndex) => {
      const markerElement = document.createElement('div');
      markerElement.className = 'tree-item tree-marker';
      markerElement.dataset.type = 'marker';
      markerElement.dataset.sectionIndex = index;
      markerElement.dataset.markerIndex = CrisisMapper.addedImages.indexOf(marker);
      
      markerElement.innerHTML = `
        <div class="tree-marker-content">
          <span class="tree-marker-icon">📌</span>
          <img src="${marker.data || marker.path}" alt="${marker.name}" class="tree-marker-img" onerror="this.style.display='none'">
          <span class="tree-marker-name">${marker.name}</span>
          <span class="tree-marker-section">${section.name}</span>
        </div>
        <div class="tree-actions-small">
          <button class="btn-tree btn-tree-edit" onclick="editMarker(${CrisisMapper.addedImages.indexOf(marker)})" title="Modifier">✏️</button>
          <button class="btn-tree btn-tree-move" onclick="moveMarkerUp(${CrisisMapper.addedImages.indexOf(marker)})" title="Monter">⬆️</button>
          <button class="btn-tree btn-tree-move" onclick="moveMarkerDown(${CrisisMapper.addedImages.indexOf(marker)})" title="Descendre">⬇️</button>
          <button class="btn-tree btn-tree-delete" onclick="deleteMarker(${CrisisMapper.addedImages.indexOf(marker)})" title="Supprimer">🗑️</button>
        </div>
      `;
      
      treeList.appendChild(markerElement);
    });
  });
  
  // Les boutons de déplacement sont déjà inclus dans le HTML
}

// Fonctions de drag and drop supprimées - remplacées par des boutons

function moveSectionToIndex(fromIndex, toIndex) {
  if (fromIndex === toIndex) return;
  
  const section = CrisisMapper.sections[fromIndex];
  CrisisMapper.sections.splice(fromIndex, 1);
  CrisisMapper.sections.splice(toIndex, 0, section);
  
  // Mettre à jour les ordres
  CrisisMapper.sections.forEach((section, i) => {
    section.order = i;
  });
  
  loadTreeList();
  updateSidebarSections();
  
  // Sauvegarder automatiquement l'état du gestionnaire (optimisé)
  saveMarkerManagerStateOptimized();
}

// Fonction utilitaire pour mettre à jour l'ordre des marqueurs dans une section
function updateMarkerOrdersInSection(sectionId) {
  const sectionMarkers = CrisisMapper.addedImages.filter(img => img.section === sectionId);
  sectionMarkers.forEach((marker, index) => {
    marker.order = index;
  });
}

// Fonctions de déplacement des marqueurs avec boutons
function moveMarkerUp(markerIndex) {
  if (markerIndex < 0 || markerIndex >= CrisisMapper.addedImages.length) return;
  
  const marker = CrisisMapper.addedImages[markerIndex];
  const sectionId = marker.section;
  
  // Trouver tous les marqueurs de la même section
  const sectionMarkerIndices = CrisisMapper.addedImages
    .map((img, index) => img.section === sectionId ? index : -1)
    .filter(index => index !== -1);
  
  const currentPosition = sectionMarkerIndices.indexOf(markerIndex);
  
  if (currentPosition > 0) {
    // Échanger avec le marqueur précédent
    const prevIndex = sectionMarkerIndices[currentPosition - 1];
    [CrisisMapper.addedImages[markerIndex], CrisisMapper.addedImages[prevIndex]] = [CrisisMapper.addedImages[prevIndex], CrisisMapper.addedImages[markerIndex]];
    
    // Mettre à jour les ordres dans la section
    updateMarkerOrdersInSection(sectionId);
    
    loadTreeList();
    updateSidebarSections();
    
    // Sauvegarder automatiquement l'état du gestionnaire
    setTimeout(() => {
      MarkerManagerDB.saveMarkerManagerState().catch(error => {
        console.warn('Erreur lors de la sauvegarde automatique du gestionnaire:', error);
      });
    }, 100);
  }
}

function moveMarkerDown(markerIndex) {
  if (markerIndex < 0 || markerIndex >= CrisisMapper.addedImages.length) return;
  
  const marker = CrisisMapper.addedImages[markerIndex];
  const sectionId = marker.section;
  
  // Trouver tous les marqueurs de la même section
  const sectionMarkerIndices = CrisisMapper.addedImages
    .map((img, index) => img.section === sectionId ? index : -1)
    .filter(index => index !== -1);
  
  const currentPosition = sectionMarkerIndices.indexOf(markerIndex);
  
  if (currentPosition < sectionMarkerIndices.length - 1) {
    // Échanger avec le marqueur suivant
    const nextIndex = sectionMarkerIndices[currentPosition + 1];
    [CrisisMapper.addedImages[markerIndex], CrisisMapper.addedImages[nextIndex]] = [CrisisMapper.addedImages[nextIndex], CrisisMapper.addedImages[markerIndex]];
    
    // Mettre à jour les ordres dans la section
    updateMarkerOrdersInSection(sectionId);
    
    loadTreeList();
    updateSidebarSections();
    
    // Sauvegarder automatiquement l'état du gestionnaire
    setTimeout(() => {
      MarkerManagerDB.saveMarkerManagerState().catch(error => {
        console.warn('Erreur lors de la sauvegarde automatique du gestionnaire:', error);
      });
    }, 100);
  }
}

function getNewIndex(target, type) {
  const items = document.querySelectorAll(`.tree-item[data-type="${type}"]`);
  let newIndex = 0;
  
  for (let i = 0; i < items.length; i++) {
    const box = items[i].getBoundingClientRect();
    if (target.offsetTop < box.top) {
      return i;
    }
    newIndex = i + 1;
  }
  
  return newIndex;
}

function moveSection(index, direction) {
  if (index + direction < 0 || index + direction >= CrisisMapper.sections.length) return;
  
  const temp = CrisisMapper.sections[index];
  CrisisMapper.sections[index] = CrisisMapper.sections[index + direction];
  CrisisMapper.sections[index + direction] = temp;
  
  // Mettre à jour les ordres
  CrisisMapper.sections.forEach((section, i) => {
    section.order = i;
  });
  
  loadTreeList();
  updateSidebarSections();
  
  // Sauvegarder automatiquement l'état du gestionnaire (optimisé)
  saveMarkerManagerStateOptimized();
}

function editSection(index) {
  const section = CrisisMapper.sections[index];
  
  // Créer une modale personnalisée pour l'édition de section
  const modal = document.createElement('div');
  modal.className = 'custom-message-modal';
  modal.style.cssText = `
    position: fixed; top: 0; left: 0; width: 100%; height: 100%;
    background: rgba(0,0,0,0.8); z-index: 10000; display: flex;
    align-items: center; justify-content: center; font-family: Arial, sans-serif;
  `;
  
  const dialog = document.createElement('div');
  dialog.style.cssText = `
    background: white; padding: 30px; border-radius: 10px; box-shadow: 0 10px 30px rgba(0,0,0,0.5);
    max-width: 400px; text-align: center; position: relative;
  `;
  
  dialog.innerHTML = `
    <h3 style="margin-top: 0; color: #333;">✏ï¸ Modifier la section</h3>
    <p style="margin: 20px 0; color: #666;">Nouveau nom de la section :</p>
    <input type="text" id="editSectionName" value="${section.name}" 
           style="width: 100%; padding: 10px; border: 1px solid #ccc; border-radius: 5px; font-size: 16px; margin-bottom: 20px;">
    <div style="display: flex; gap: 10px; justify-content: center;">
      <button id="editSectionConfirm" style="
        background: #4CAF50; color: white; border: none; padding: 12px 24px;
        border-radius: 5px; cursor: pointer; font-size: 14px; font-weight: bold;
      ">Modifier</button>
      <button id="editSectionCancel" style="
        background: #f44336; color: white; border: none; padding: 12px 24px;
        border-radius: 5px; cursor: pointer; font-size: 14px; font-weight: bold;
      ">Annuler</button>
    </div>
  `;
  
  modal.appendChild(dialog);
  document.body.appendChild(modal);
  
  // Focus sur l'input
  const input = document.getElementById('editSectionName');
  input.focus();
  input.select();
  
  // Gestionnaires d'événements
  document.getElementById('editSectionConfirm').addEventListener('click', function() {
    const newName = input.value.trim();
    if (newName) {
      section.name = newName.trim();
      loadTreeList();
      updateSidebarSections();
      
      // Sauvegarder automatiquement l'état du gestionnaire
      setTimeout(() => {
        MarkerManagerDB.saveMarkerManagerState().catch(error => {
          console.warn('Erreur lors de la sauvegarde automatique du gestionnaire:', error);
        });
      }, 100);
    }
    modal.remove();
  });
  
  document.getElementById('editSectionCancel').addEventListener('click', function() {
    modal.remove();
  });
  
  // Fermer avec Échap
  const handleEscape = (e) => {
    if (e.key === 'Escape') {
      modal.remove();
      document.removeEventListener('keydown', handleEscape);
    }
  };
  document.addEventListener('keydown', handleEscape);
}

function deleteSection(index) {
  const section = CrisisMapper.sections[index];
  
  CustomMessages.confirm(`Êtes-vous sûr de vouloir supprimer la section "${section.name}" ?`, 'Suppression de section', (confirmed) => {
    if (!confirmed) return;
    
    // Supprimer tous les marqueurs de cette section
    CrisisMapper.addedImages = CrisisMapper.addedImages.filter(img => img.section !== section.id);
    
    CrisisMapper.sections.splice(index, 1);
    loadTreeList();
    updateSidebarSections();
    
    // Sauvegarder automatiquement l'état du gestionnaire
    setTimeout(() => {
      MarkerManagerDB.saveMarkerManagerState().catch(error => {
        console.warn('Erreur lors de la sauvegarde automatique du gestionnaire:', error);
      });
    }, 100);
  });
}

function addSection() {
  // Créer une modale personnalisée pour l'ajout de section
  const modal = document.createElement('div');
  modal.className = 'custom-message-modal';
  modal.style.cssText = `
    position: fixed; top: 0; left: 0; width: 100%; height: 100%;
    background: rgba(0,0,0,0.8); z-index: 10000; display: flex;
    align-items: center; justify-content: center; font-family: Arial, sans-serif;
  `;
  
  const dialog = document.createElement('div');
  dialog.style.cssText = `
    background: white; padding: 30px; border-radius: 10px; box-shadow: 0 10px 30px rgba(0,0,0,0.5);
    max-width: 400px; text-align: center; position: relative;
  `;
  
  dialog.innerHTML = `
    <h3 style="margin-top: 0; color: #333;">+ Ajouter une section</h3>
    <p style="margin: 20px 0; color: #666;">Nom de la nouvelle section :</p>
    <input type="text" id="addSectionName" placeholder="Nom de la section" 
           style="width: 100%; padding: 10px; border: 1px solid #ccc; border-radius: 5px; font-size: 16px; margin-bottom: 20px;">
    <div style="display: flex; gap: 10px; justify-content: center;">
      <button id="addSectionConfirm" style="
        background: #4CAF50; color: white; border: none; padding: 12px 24px;
        border-radius: 5px; cursor: pointer; font-size: 14px; font-weight: bold;
      ">Ajouter</button>
      <button id="addSectionCancel" style="
        background: #f44336; color: white; border: none; padding: 12px 24px;
        border-radius: 5px; cursor: pointer; font-size: 14px; font-weight: bold;
      ">Annuler</button>
    </div>
  `;
  
  modal.appendChild(dialog);
  document.body.appendChild(modal);
  
  // Focus sur l'input
  const input = document.getElementById('addSectionName');
  input.focus();
  
  // Gestionnaires d'événements
  document.getElementById('addSectionConfirm').addEventListener('click', function() {
    const newName = input.value.trim();
    if (newName) {
      const newSection = {
        id: newName.toLowerCase().replace(/[^a-z0-9]/g, '_'),
        name: newName.trim(),
        order: CrisisMapper.sections.length,
        menuId: `custom_${newName.toLowerCase().replace(/[^a-z0-9]/g, '_')}`
      };
      CrisisMapper.sections.push(newSection);
      loadTreeList();
      updateSidebarSections();
      
      // Sauvegarder automatiquement l'état du gestionnaire
      setTimeout(() => {
        MarkerManagerDB.saveMarkerManagerState().catch(error => {
          console.warn('Erreur lors de la sauvegarde automatique du gestionnaire:', error);
        });
      }, 100);
    }
    modal.remove();
  });
  
  document.getElementById('addSectionCancel').addEventListener('click', function() {
    modal.remove();
  });
  
  // Fermer avec Échap
  const handleEscape = (e) => {
    if (e.key === 'Escape') {
      modal.remove();
      document.removeEventListener('keydown', handleEscape);
    }
  };
  document.addEventListener('keydown', handleEscape);
}

function updateSidebarSections() {
  // Mettre àjour les sections dans la sidebar
  const sidebar = DOMCache.get('sidebar');
  
  // Vider le contenu de la sidebar (pas la sidebar elle-même)
  const sidebarContent = sidebar.querySelector('.sidebar-content');
  if (sidebarContent) {
    sidebarContent.innerHTML = '';
  }
  
  // Créer un fragment pour optimiser les insertions DOM
  const fragment = document.createDocumentFragment();
  
  // Ajouter les sections dans l'ordre
  CrisisMapper.sections.sort((a, b) => a.order - b.order).forEach(section => {
    // Créer le titre de la section
    const sectionTitle = document.createElement('h2');
    sectionTitle.textContent = section.name;
    sectionTitle.className = 'section-title';
    
    // Créer le conteneur de la section
    const sectionDiv = document.createElement('div');
    sectionDiv.className = 'section';
    sectionDiv.style.marginTop = '0.5em';
    
    // Créer le menu déroulant
    const customSelect = document.createElement('div');
    customSelect.className = 'custom-select';
    customSelect.id = section.menuId;
    
    const selectedOption = document.createElement('div');
    selectedOption.className = 'selected-option';
    selectedOption.innerHTML = '<span class="no-img">-- Sélectionner --</span>';
    
    const optionsContainer = document.createElement('div');
    optionsContainer.className = 'options';
    optionsContainer.style.display = 'none';
    optionsContainer.innerHTML = '<div class="option" data-path=""><span class="no-img">-- Sélectionner --</span></div>';
    
    customSelect.appendChild(selectedOption);
    customSelect.appendChild(optionsContainer);
    sectionDiv.appendChild(sectionTitle);
    sectionDiv.appendChild(customSelect);
    fragment.appendChild(sectionDiv);
    
    // Ajouter les événements pour le menu déroulant
    setupCustomSelect(customSelect);
  });
  
  // Insérer tout d'un coup pour optimiser les performances
  if (sidebarContent) {
    sidebarContent.appendChild(fragment);
  }
  
  // Restaurer les images sauvegardées après reconstruction de la sidebar
  restoreImagesFromAddedImages();
  
  // Nettoyer le cache DOM pour les éléments reconstruits
  DOMCache.clear();
  
  // Corriger les tailles après reconstruction de la sidebar (seulement si déroulée)
  setTimeout(() => {
    const sidebar = DOMCache.get('sidebar');
    if (sidebar && !sidebar.classList.contains('collapsed')) {
      updateSizes();
      adjustSidebarHeight(); // Ajuster la hauteur automatiquement
    }
  }, 50);
}

// === GESTION DE LA SIDEBAR Dà‰ROULANTE ===

// Variables pour la gestion de la sidebar
let sidebarHoverTimeout = null;
let sidebarCollapsed = true;

// Fonction pour ajuster automatiquement la hauteur de la sidebar
function adjustSidebarHeight() {
  const sidebar = document.getElementById('sidebar');
  if (!sidebar || sidebar.classList.contains('collapsed')) return;
  
  // Forcer la hauteur à s'adapter au contenu
  sidebar.style.height = 'auto';
  sidebar.style.maxHeight = 'none';
  sidebar.style.overflowY = 'visible';
  
  // Attendre que le DOM se mette à jour, puis calculer la hauteur réelle
  setTimeout(() => {
    const sidebarContent = sidebar.querySelector('.sidebar-content');
    if (sidebarContent) {
      const contentHeight = sidebarContent.scrollHeight;
      const maxHeight = window.innerHeight - 20; // 20px de marge
      
      // Si le contenu dépasse la hauteur maximale, activer le scroll
      if (contentHeight > maxHeight) {
        sidebar.style.maxHeight = maxHeight + 'px';
        sidebar.style.overflowY = 'auto';
      } else {
        sidebar.style.height = 'auto';
        sidebar.style.maxHeight = 'none';
        sidebar.style.overflowY = 'visible';
      }
    }
  }, 100);
}

// Fonction pour gérer le survol de la sidebar
function setupSidebarHover() {
  const sidebar = document.getElementById('sidebar');
  if (!sidebar) return;
  
  // Événement de survol - dérouler la sidebar
  sidebar.addEventListener('mouseenter', function() {
    clearTimeout(sidebarHoverTimeout);
    sidebarCollapsed = false;
    sidebar.classList.remove('collapsed');
    
    // Ajuster la hauteur après déroulement
    setTimeout(adjustSidebarHeight, 100);
  });
  
  // Événement de sortie - enrouler la sidebar après un délai
  sidebar.addEventListener('mouseleave', function() {
    sidebarHoverTimeout = setTimeout(() => {
      sidebarCollapsed = true;
      sidebar.classList.add('collapsed');
    }, 500); // Délai de 500ms avant d'enrouler
  });
  
  // Pas de gestion de clic - la sidebar se comporte uniquement par survol
}

// Initialiser la gestion de la sidebar au chargement
document.addEventListener('DOMContentLoaded', function() {
  setupSidebarHover();
});

function setupCustomSelect(customSelect) {
  const selected = customSelect.querySelector('.selected-option');
  const optionsContainer = customSelect.querySelector('.options');
  const optionsList = customSelect.querySelectorAll('.option');

  selected.addEventListener('click', () => {
    optionsContainer.style.display = optionsContainer.style.display === 'block' ? 'none' : 'block';
    
    // Ajuster la hauteur de la sidebar après ouverture/fermeture de la section
    setTimeout(adjustSidebarHeight, 100);
  });

  optionsList.forEach(option => {
    option.addEventListener('click', () => {
      updateSelectedOption(customSelect, option);
      optionsContainer.style.display = 'none';
      
      // Ajuster la hauteur de la sidebar après sélection d'une option
      setTimeout(adjustSidebarHeight, 100);
    });
  });

  document.addEventListener('click', e => {
    if (!customSelect.contains(e.target)) {
      optionsContainer.style.display = 'none';
      
      // Ajuster la hauteur de la sidebar après fermeture de la section
      setTimeout(adjustSidebarHeight, 100);
    }
  });
}

// --- Fonctions de gestion des marqueurs ---
// Les fonctions loadMarkersList, editMarker, deleteMarker sont maintenant intégrées dans l'arborescence

function editMarker(index) {
  const marker = CrisisMapper.addedImages[index];
  
  // Créer une modale personnalisée pour l'édition
  const modal = document.createElement('div');
  modal.className = 'custom-message-modal';
  modal.style.cssText = `
    position: fixed; top: 0; left: 0; width: 100%; height: 100%;
    background: rgba(0,0,0,0.8); z-index: 10000; display: flex;
    align-items: center; justify-content: center; font-family: Arial, sans-serif;
  `;
  
  const dialog = document.createElement('div');
  dialog.style.cssText = `
    background: white; padding: 30px; border-radius: 10px; box-shadow: 0 10px 30px rgba(0,0,0,0.5);
    max-width: 400px; text-align: center; position: relative;
  `;
  
  dialog.innerHTML = `
    <h3 style="margin-top: 0; color: #333;">✏ï¸ Modifier le marqueur</h3>
    <p style="margin: 20px 0; color: #666;">Nouveau nom du marqueur :</p>
    <input type="text" id="editMarkerName" value="${marker.name}" 
           style="width: 100%; padding: 10px; border: 1px solid #ccc; border-radius: 5px; font-size: 16px; margin-bottom: 20px;">
    <div style="display: flex; gap: 10px; justify-content: center;">
      <button id="editConfirm" style="
        background: #4CAF50; color: white; border: none; padding: 12px 24px;
        border-radius: 5px; cursor: pointer; font-size: 14px; font-weight: bold;
      ">Modifier</button>
      <button id="editCancel" style="
        background: #f44336; color: white; border: none; padding: 12px 24px;
        border-radius: 5px; cursor: pointer; font-size: 14px; font-weight: bold;
      ">Annuler</button>
    </div>
  `;
  
  modal.appendChild(dialog);
  document.body.appendChild(modal);
  
  // Focus sur l'input
  const input = document.getElementById('editMarkerName');
  input.focus();
  input.select();
  
  // Gestionnaires d'événements
  document.getElementById('editConfirm').addEventListener('click', function() {
    const newName = input.value.trim();
    if (newName) {
      marker.name = newName;
      CrisisMapper.addedImages[index] = marker;
      loadTreeList();
      updateSidebarSections();
      
      // Sauvegarder automatiquement l'état du gestionnaire
      setTimeout(() => {
        MarkerManagerDB.saveMarkerManagerState().catch(error => {
          console.warn('Erreur lors de la sauvegarde automatique du gestionnaire:', error);
        });
      }, 100);
    }
    modal.remove();
  });
  
  document.getElementById('editCancel').addEventListener('click', function() {
    modal.remove();
  });
  
  // Fermer avec Échap
  const handleEscape = (e) => {
    if (e.key === 'Escape') {
      modal.remove();
      document.removeEventListener('keydown', handleEscape);
    }
  };
  document.addEventListener('keydown', handleEscape);
}

function deleteMarker(index) {
  const marker = CrisisMapper.addedImages[index];
  CustomMessages.confirm(`Êtes-vous sûr de vouloir supprimer le marqueur "${marker.name}" ?`, 'Suppression de marqueur', (confirmed) => {
    if (!confirmed) return;
    
    const sectionId = marker.section;
    CrisisMapper.addedImages.splice(index, 1);
    
    // Mettre à jour l'ordre des marqueurs restants dans la section
    updateMarkerOrdersInSection(sectionId);
    
    loadTreeList();
    updateSidebarSections();
    
    // Sauvegarder automatiquement l'état du gestionnaire
    setTimeout(() => {
      MarkerManagerDB.saveMarkerManagerState().catch(error => {
        console.warn('Erreur lors de la sauvegarde automatique du gestionnaire:', error);
      });
    }, 100);
  });
}

function addMarker() {
  // Vérifier s'il y a déjà une modal d'ajout de marqueur ouverte
  const existingModal = document.querySelector('#newMarkerFile');
  if (existingModal) {
    existingModal.closest('.modal').remove();
  }
  
  // Créer une modal d'ajout de marqueur
  const modal = document.createElement('div');
  modal.className = 'modal';
  modal.id = 'addMarkerModal';
  modal.style.display = 'flex';
  modal.innerHTML = `
    <div class="modal-content">
      <div class="modal-header">
        <h3>Ajouter un marqueur</h3>
        <span class="close" onclick="this.parentElement.parentElement.parentElement.remove()">&times;</span>
    </div>
      <div class="modal-body">
        <div class="form-group">
          <label for="newMarkerFile">Sélectionner des images (Ctrl+clic pour plusieurs) :</label>
          <input type="file" id="newMarkerFile" accept="image/*" multiple>
          <div id="selectedFilesPreview" style="margin-top: 10px; max-height: 300px; overflow-y: auto;"></div>
        </div>
        <div class="form-group">
          <label for="newMarkerSection">Section :</label>
          <select id="newMarkerSection">
            ${CrisisMapper.sections.map(section => `<option value="${section.id}">${section.name}</option>`).join('')}
          </select>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" onclick="this.parentElement.parentElement.parentElement.remove()">Annuler</button>
        <button class="btn btn-primary" onclick="confirmAddMarker()">Ajouter</button>
      </div>
    </div>
  `;
  
  document.body.appendChild(modal);
  
  // Gestion de la sélection multiple de fichiers
  document.getElementById('newMarkerFile').addEventListener('change', (e) => {
    const files = Array.from(e.target.files);
    const preview = document.getElementById('selectedFilesPreview');
    preview.innerHTML = '';
    
    if (files.length === 0) return;
    
    // Afficher la prévisualisation des fichiers sélectionnés avec champs de nommage
    files.forEach((file, index) => {
      const fileDiv = document.createElement('div');
      fileDiv.style.cssText = 'display: flex; align-items: center; margin: 10px 0; padding: 10px; border: 1px solid #ddd; border-radius: 5px; background: #f9f9f9;';
      
      const reader = new FileReader();
      reader.onload = (e) => {
        const fileName = file.name.replace(/\.[^/.]+$/, "");
        const cleanName = fileName.toUpperCase().replace(/[^A-Z0-9_]/g, '_');
        
        fileDiv.innerHTML = `
          <img src="${e.target.result}" style="width: 50px; height: 50px; object-fit: cover; margin-right: 15px; border-radius: 3px; border: 1px solid #ccc;">
          <div style="flex: 1;">
            <div style="font-weight: bold; font-size: 12px; margin-bottom: 5px;">${file.name}</div>
            <div style="font-size: 10px; color: #666; margin-bottom: 8px;">${(file.size / 1024).toFixed(1)} KB</div>
            <input type="text" 
                   id="fileName_${index}" 
                   value="${cleanName}" 
                   placeholder="Nom du marqueur"
                   style="width: 100%; padding: 5px; border: 1px solid #ccc; border-radius: 3px; font-size: 12px;">
          </div>
        `;
      };
      reader.readAsDataURL(file);
      
      preview.appendChild(fileDiv);
    });
    
    // Afficher le nombre total de fichiers
    const countDiv = document.createElement('div');
    countDiv.style.cssText = 'margin-top: 15px; padding: 10px; background: #e3f2fd; border-radius: 5px; font-size: 12px; text-align: center; font-weight: bold; color: #1976d2;';
    countDiv.textContent = `${files.length} fichier(s) sélectionné(s) - Modifiez les noms si nécessaire`;
    preview.appendChild(countDiv);
  });
}

// Optimisation : debouncing pour la validation des images
let imageValidationDebounceTimer = null;

async function confirmAddMarker() {
  const files = Array.from(document.getElementById('newMarkerFile').files);
  const section = document.getElementById('newMarkerSection').value;
  
  if (files.length === 0) {
    CustomMessages.warning('Veuillez sélectionner au moins un fichier');
    return;
  }
  
  // Optimisation : debouncing pour éviter les validations multiples
  if (imageValidationDebounceTimer) {
    clearTimeout(imageValidationDebounceTimer);
  }
  
  return new Promise((resolve) => {
    imageValidationDebounceTimer = setTimeout(async () => {
      let successCount = 0;
      let errorCount = 0;
      
      // Traiter chaque fichier
      for (let i = 0; i < files.length; i++) {
    const file = files[i];
    
    try {
      // Récupérer le nom saisi pour ce fichier
      const nameInput = document.getElementById(`fileName_${i}`);
      const name = nameInput ? nameInput.value.trim() : file.name.replace(/\.[^/.]+$/, "");
      
      if (!name) {
        console.warn(`Nom manquant pour le fichier ${file.name}`);
        errorCount++;
        continue;
      }
      
      // Convertir en Base64
      const base64Data = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => resolve(e.target.result);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      
      // Générer le nom du fichier
      const extension = file.name.split('.').pop().toUpperCase();
      const cleanName = name.toUpperCase().replace(/[^A-Z0-9_]/g, '_');
      const fileName = `${cleanName}.${extension}`;
      
      // Sauvegarder l'image (ordre correct des paramètres)
      await saveImageToStorage(section, fileName, name, base64Data);
      
      // Ajouter au menu (ordre correct des paramètres)
      addImageToMenu(section, fileName, name, base64Data);
      
      successCount++;
      
    } catch (error) {
      console.error(`Erreur lors du traitement de ${file.name}:`, error);
      errorCount++;
    }
  }
  
  // Fermer la modal
  const addMarkerModal = document.getElementById('addMarkerModal');
  if (addMarkerModal) {
    addMarkerModal.remove();
  }
  
  // Recharger l'arborescence
  loadTreeList();
  
      // Afficher le résultat
      if (errorCount === 0) {
        showMessage(`${successCount} marqueur(s) ajouté(s) avec succès`, 'success');
      } else if (successCount > 0) {
        showMessage(`${successCount} marqueur(s) ajouté(s), ${errorCount} erreur(s)`, 'warning');
      } else {
        showMessage(`Erreur lors de l'ajout des marqueurs`, 'error');
      }
      
      resolve();
    }, 500); // Debounce de 500ms pour la validation des images
  });
}

// --- Fonction pour calculer les 4 coins GPS exacts d'un marqueur ---
function getMarkerCorners(marker) {
  if (!marker || !marker._icon) return null;
  
  const latlng = marker.getLatLng();
  const iconSize = marker.options.icon.options.iconSize;
  const iconAnchor = marker.options.icon.options.iconAnchor;
  
  // Utiliser la méthode Leaflet pour convertir les pixels en coordonnées GPS
  const mapSize = map.getSize();
  const mapBounds = map.getBounds();
  
  // Calculer les décalages en pixels par rapport au centre
  const halfWidthPixels = iconSize[0] / 2;
  const halfHeightPixels = iconSize[1] / 2;
  
  // Convertir les décalages pixels en coordonnées GPS
  const centerPixel = map.latLngToContainerPoint(latlng);
  
  // Calculer les 4 coins en pixels
  const topLeftPixel = L.point(centerPixel.x - halfWidthPixels, centerPixel.y - halfHeightPixels);
  const topRightPixel = L.point(centerPixel.x + halfWidthPixels, centerPixel.y - halfHeightPixels);
  const bottomLeftPixel = L.point(centerPixel.x - halfWidthPixels, centerPixel.y + halfHeightPixels);
  const bottomRightPixel = L.point(centerPixel.x + halfWidthPixels, centerPixel.y + halfHeightPixels);
  
  // Convertir les pixels en coordonnées GPS
  const topLeft = map.containerPointToLatLng(topLeftPixel);
  const topRight = map.containerPointToLatLng(topRightPixel);
  const bottomLeft = map.containerPointToLatLng(bottomLeftPixel);
  const bottomRight = map.containerPointToLatLng(bottomRightPixel);
  
  // Calculer les 4 coins avec précision GPS maximale
  const corners = {
    topLeft: {
      lat: topLeft.lat,
      lng: topLeft.lng
    },
    topRight: {
      lat: topRight.lat,
      lng: topRight.lng
    },
    bottomLeft: {
      lat: bottomLeft.lat,
      lng: bottomLeft.lng
    },
    bottomRight: {
      lat: bottomRight.lat,
      lng: bottomRight.lng
    }
  };
  
  
  return corners;
}

// --- Fonction pour recréer un marqueur àpartir de ses 4 coins GPS exacts ---
function createMarkerFromCorners(markerData, img) {
  if (!markerData.corners) {
    // Fallback vers l'ancien système si pas de coins
    const baseSize = getIconSize(img.width, img.height, markerData.section === 'carroyages' ? 'carroyages' : 'icon');
    const scale = markerData.scale || 1;
    const finalSize = [baseSize[0] * scale, baseSize[1] * scale];
    
    const customIcon = L.divIcon({
      html: `<img src="${markerData.imageData || markerData.imagePath}" style="width:${finalSize[0]}px;height:${finalSize[1]}px;transform-origin:50% 50%;">`,
      iconSize: finalSize,
      iconAnchor: [finalSize[0]/2, finalSize[1]/2],
      className: ''
    });
    
    return L.marker(markerData.position, {
      icon: customIcon,
      zIndexOffset: markerData.section === 'carroyages' ? -1000 : 1000,
      draggable: true
    });
  }
  
  // Utiliser les coordonnées GPS exactes des 4 coins
  const corners = markerData.corners;
  
  // Calculer la position centrale
  const centerLat = (corners.topLeft.lat + corners.bottomLeft.lat) / 2;
  const centerLng = (corners.topLeft.lng + corners.topRight.lng) / 2;
  const center = L.latLng(centerLat, centerLng);
  
  // Convertir les 4 coins GPS en pixels sur la carte actuelle
  const mapSize = map.getSize();
  const mapBounds = map.getBounds();
  
  // Convertir les coordonnées GPS en pixels
  const topLeftPixel = map.latLngToContainerPoint(L.latLng(corners.topLeft.lat, corners.topLeft.lng));
  const topRightPixel = map.latLngToContainerPoint(L.latLng(corners.topRight.lat, corners.topRight.lng));
  const bottomLeftPixel = map.latLngToContainerPoint(L.latLng(corners.bottomLeft.lat, corners.bottomLeft.lng));
  const bottomRightPixel = map.latLngToContainerPoint(L.latLng(corners.bottomRight.lat, corners.bottomRight.lng));
  
  // Calculer la taille en pixels àpartir des coins
  const widthPixels = Math.abs(topRightPixel.x - topLeftPixel.x);
  const heightPixels = Math.abs(bottomLeftPixel.y - topLeftPixel.y);
  
  // S'assurer que la taille est raisonnable
  // Pour les carroyages, utiliser une limite plus élevée car ils sont naturellement plus grands
  const maxSize = markerData.section === 'carroyages' ? 2000 : 1000;
  const iconWidth = Math.max(20, Math.min(widthPixels, maxSize));
  const iconHeight = Math.max(20, Math.min(heightPixels, maxSize));
  
  
  const customIcon = L.divIcon({
    html: `<img src="${markerData.imageData || markerData.imagePath}" style="width:${iconWidth}px;height:${iconHeight}px;transform-origin:50% 50%;">`,
    iconSize: [iconWidth, iconHeight],
    iconAnchor: [iconWidth/2, iconHeight/2],
    className: ''
  });
  
  const marker = L.marker(center, {
    icon: customIcon,
    zIndexOffset: markerData.section === 'carroyages' ? -1000 : 1000,
    draggable: true
  });
  
  // Stocker la taille originale pour éviter les recalculs
  marker._originalSize = [iconWidth, iconHeight];
  marker._restoredFromGPS = true; // Marquer comme restauré depuis GPS
  
  
  // Réorganiser le z-index après création
  reorganizeMarkerZIndex();
  
  return marker;
}

// --- Fonctions d'import/export des marqueurs ---
async function exportMarkers() {
  try {
    if (CrisisMapper.addedImages.length === 0) {
      showMessage('Aucun marqueur à sauvegarder.', 'warning');
      return;
    }
    
    
    // Validation et nettoyage des marqueurs
    const validMarkers = CrisisMapper.addedImages.filter(marker => {
      if (!marker) return false;
      if (!marker.section || !marker.name) return false;
      if (!marker.data && !marker.path) return false;
      
      // Vérifier la taille des données Base64
      if (marker.data && marker.data.length > CrisisMapper.config.maxImageSize) {
        console.warn(`Marqueur ${marker.name} ignoré: image trop volumineuse`);
        return false;
      }
      
      return true;
    });
    
    if (validMarkers.length === 0) {
      showMessage('Aucun marqueur valide à sauvegarder.', 'warning');
      return;
    }
    
    if (validMarkers.length !== CrisisMapper.addedImages.length) {
      console.warn(`${CrisisMapper.addedImages.length - validMarkers.length} marqueur(s) invalide(s) ignoré(s)`);
    }
    
    const exportData = {
      version: '2.0',
      timestamp: new Date().toISOString(),
      description: 'CRISIS MAPPER - Marqueurs avec images Base64',
      sections: CrisisMapper.sections,
      markers: validMarkers
    };
    
    // Validation de la taille totale
    validateProjectSize(exportData);
    
    const jsonString = JSON.stringify(exportData, null, 2);
    const blob = new Blob([jsonString], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    
    const now = new Date();
    const day = String(now.getDate()).padStart(2, '0');
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const year = now.getFullYear();
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const timestamp = `${day}-${month}-${year}_${hours}h${minutes}`;
    const filename = `crisis_mapper_markers_${timestamp}.json`;
    
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.style.display = 'none';
    
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    
    URL.revokeObjectURL(url);
    
    showMessage(`Marqueurs sauvegardés avec succès ! ${validMarkers.length} marqueur(s) exporté(s).`, 'success');
    
  } catch (error) {
    console.error('Erreur lors de l\'export des marqueurs:', error);
    showMessage('Erreur lors de la sauvegarde: ' + error.message, 'error');
  }
}

function importMarkers() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json';
  input.onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    
    // Validation de la taille du fichier
    if (file.size > 50 * 1024 * 1024) { // 50MB
      showMessage('Le fichier est trop volumineux (limite: 50MB)', 'error');
      return;
    }
    
    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const data = JSON.parse(e.target.result);
        
        // Validation du format de fichier
        if (!data.markers || !Array.isArray(data.markers)) {
          throw new Error('Format de fichier invalide - marqueurs manquants');
        }
        
        if (data.markers.length === 0) {
          showMessage('Aucun marqueur dans le fichier', 'warning');
          return;
        }
        
        if (data.markers.length > 1000) {
          throw new Error('Trop de marqueurs dans le fichier (limite: 1000)');
        }
        
        // Vider les marqueurs actuels
        CrisisMapper.addedImages = [];
        
        // Mettre à jour les sections si disponibles
        if (data.sections && Array.isArray(data.sections)) {
          CrisisMapper.sections = data.sections;
        }
        
        // Validation et ajout des nouveaux marqueurs
        let successCount = 0;
        let errorCount = 0;
        
        data.markers.forEach((markerData, index) => {
          try {
            // Validation des données du marqueur
            if (!markerData.section || !markerData.name) {
              console.warn(`Marqueur ${index + 1} ignoré: données manquantes`);
              errorCount++;
              return;
            }
            
            if (!markerData.data && !markerData.path) {
              console.warn(`Marqueur ${index + 1} ignoré: pas d'image`);
              errorCount++;
              return;
            }
            
            // Vérifier la taille des données Base64
            if (markerData.data && markerData.data.length > CrisisMapper.config.maxImageSize) {
              console.warn(`Marqueur ${index + 1} ignoré: image trop volumineuse`);
              errorCount++;
              return;
            }
            
            // Utiliser les données Base64 comme chemin si disponible
            const imagePath = markerData.data || markerData.path || '';
            const saved = saveImageToStorage(markerData.section, imagePath, markerData.name, markerData.data);
            
            if (saved) {
              successCount++;
            } else {
              errorCount++;
            }
            
          } catch (error) {
            console.error(`Erreur lors du traitement du marqueur ${index + 1}:`, error);
            errorCount++;
          }
        });
        
        // Mettre àjour l'interface (dans le bon ordre)
        updateSidebarSections(); // Reconstruit la sidebar
        loadTreeList(); // Met àjour la liste de gestion
        
        // Sauvegarder automatiquement l'état du gestionnaire après import
        setTimeout(() => {
          MarkerManagerDB.saveMarkerManagerState().catch(error => {
            console.warn('Erreur lors de la sauvegarde automatique du gestionnaire:', error);
          });
        }, 100);
        
        
        // Afficher le résultat
        if (errorCount === 0) {
          showMessage(`${successCount} marqueur(s) chargé(s) avec succès !`, 'success');
        } else if (successCount > 0) {
          showMessage(`${successCount} marqueur(s) chargé(s), ${errorCount} erreur(s)`, 'warning');
        } else {
          showMessage(`Erreur lors du chargement des marqueurs. ${errorCount} erreur(s).`, 'error');
        }
      
      } catch (error) {
        console.error('Erreur lors du chargement du fichier:', error);
        showMessage('Erreur lors du chargement: ' + error.message, 'error');
      }
    };
    
    reader.readAsText(file);
  };
  
  input.click();
}

// --- Fonctions utilitaires de validation ---
function validateProjectSize(projectData) {
  const jsonString = JSON.stringify(projectData);
  const sizeInMB = jsonString.length / (1024 * 1024);
  
  if (sizeInMB > 200) { // Limite de 200MB (plus raisonnable)
    throw new Error(`Le projet est trop volumineux (${sizeInMB.toFixed(1)}MB). Limite: 200MB`);
  }
  
  return true;
}

function validateMarker(marker) {
  if (!marker) return false;
  if (!marker.getLatLng || typeof marker.getLatLng !== 'function') return false;
  if (!marker._imageData && !marker._imagePath) return false;
  if (!marker._section) return false;
  
  return true;
}

function validateProjectFile(data) {
  if (!data) {
    throw new Error('Fichier vide ou corrompu');
  }
  
  if (!data.placedMarkers || !Array.isArray(data.placedMarkers)) {
    throw new Error('Format de fichier invalide - marqueurs manquants');
  }
  
  if (data.placedMarkers.length > 1000) {
    throw new Error('Trop de marqueurs dans le fichier (limite: 1000)');
  }
  
  if (data.placedMarkers.length === 0) {
    throw new Error('Aucun marqueur dans le fichier');
  }
  
  return true;
}

// --- Fonctions d'import/export des projets ---
function exportProject() {
  try {
    // Utiliser le cache optimisé au lieu de parcourir tous les layers
    const actualMarkers = getMapMarkersOptimized();
    
    // Mettre à jour le tableau markers avec les marqueurs réellement présents
    markers = actualMarkers;
    
    console.log(`${markers.length} marqueurs réellement présents sur la carte`);
    
    if (markers.length === 0) {
      showMessage('Aucun marqueur placé sur la carte à sauvegarder.', 'warning');
      return;
    }
    
    // Validation des marqueurs
    const validMarkers = markers.filter(marker => validateMarker(marker));
    
    if (validMarkers.length === 0) {
      showMessage('Aucun marqueur valide à sauvegarder.', 'warning');
      return;
    }
    
    if (validMarkers.length !== markers.length) {
      console.warn(`${markers.length - validMarkers.length} marqueur(s) invalide(s) ignoré(s)`);
    }
    
    // Stuck automatiquement tous les marqueurs avant la sauvegarde
    console.log(`Stuck automatique de ${validMarkers.length} marqueur(s) avant sauvegarde...`);
    validMarkers.forEach(marker => {
      if (!stuckData.has(marker)) {
        // Créer les données stuck pour le marqueur
        const center = marker.getLatLng();
        const icon = marker._icon ? marker._icon.querySelector('img') : null;
        const originalSize = icon ? [icon.width, icon.height] : (marker._originalSize || [100, 100]);
        
        // Stocker les données stuck
        stuckData.set(marker, {
          center: center,
          rotation: marker._rotation || 0,
          originalSize: originalSize,
          originalZoom: map.getZoom(),
          imageSrc: marker._imageData || marker._imagePath
        });
        
        // Désactiver le dragging
        if (marker.dragging) {
          marker.dragging.disable();
        }
        marker.setOpacity(1.0);
        
        // Mettre à jour l'icône de la toolbox si ce marqueur est sélectionné
        if (selectedMarker === marker) {
          const stuckIcon = document.querySelector('[data-action="stuck"]');
          if (stuckIcon) {
            stuckIcon.textContent = '📌';
            stuckIcon.style.color = 'red';
          }
        }
        
        console.log(`Marqueur stuck: ${marker._id || 'sans ID'}`);
      }
    });
    console.log('Tous les marqueurs ont été stuck automatiquement');
    
    const projectData = {
      version: '2.0',
      timestamp: new Date().toISOString(),
      description: 'CRISIS MAPPER - Projet complet avec positions des marqueurs',
      mapCenter: map.getCenter(),
      mapZoom: map.getZoom(),
      placedMarkers: validMarkers.map(marker => {
        try {
          const corners = getMarkerCorners(marker);
          return {
            id: marker._id || Date.now() + Math.random(),
            imagePath: marker._imagePath,
            imageData: marker._imageData,
            position: marker.getLatLng(),
            corners: corners, // Positions GPS des 4 coins
            rotation: marker._rotation || 0,
            scale: marker._scale || 1,
            isStuck: stuckData.has(marker),
            section: marker._section
          };
        } catch (error) {
          console.error('Erreur lors de la sérialisation du marqueur:', error);
          return null;
        }
      }).filter(marker => marker !== null)
    };
    
    // Validation de la taille
    validateProjectSize(projectData);
    
    const jsonString = JSON.stringify(projectData, null, 2);
    const blob = new Blob([jsonString], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    
    const now = new Date();
    const day = String(now.getDate()).padStart(2, '0');
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const year = now.getFullYear();
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const timestamp = `${day}-${month}-${year}_${hours}h${minutes}`;
    const filename = `crisis_mapper_project_${timestamp}.json`;
    
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.style.display = 'none';
    
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    
    URL.revokeObjectURL(url);
    
    // Fermer la modal de gestion des projets
    const manageProjectsModal = document.getElementById('manageProjectsModal');
    if (manageProjectsModal) {
      manageProjectsModal.style.display = 'none';
    }
    
    showMessage(`Projet sauvegardé avec succès ! ${validMarkers.length} marqueur(s) exporté(s).`, 'success');
    
  } catch (error) {
    console.error('Erreur lors de l\'export du projet:', error);
    showMessage('Erreur lors de la sauvegarde: ' + error.message, 'error');
  }
}

function importProject() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json';
  input.onchange = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    
    // Validation de la taille du fichier
    if (file.size > 50 * 1024 * 1024) { // 50MB
      showMessage('Le fichier est trop volumineux (limite: 50MB)', 'error');
      return;
    }
    
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = JSON.parse(e.target.result);
        
        // Validation du format de fichier
        validateProjectFile(data);
        
        // Vider la carte - supprimer TOUS les marqueurs personnalisés
        console.log('Nettoyage de la carte avant import...');
        clearAllMarkers();
        
        // Note: Les sections du volet de gauche ne sont pas modifiées lors du chargement de projet
        // Seuls les marqueurs placés sur la carte sont restaurés
        
        // Attendre que le nettoyage soit terminé avant de restaurer
        setTimeout(() => {
          // Restaurer la vue de la carte
          if (data.mapCenter && data.mapZoom) {
            console.log(`Restauration de la vue: centre ${data.mapCenter.lat.toFixed(6)},${data.mapCenter.lng.toFixed(6)}, zoom ${data.mapZoom}`);
            
            // Forcer le zoom exact et attendre qu'il soit vraiment stabilisé
            const targetZoom = data.mapZoom;
            map.setView(data.mapCenter, targetZoom);
            
            // Attendre que le zoom soit exactement celui demandé
            let attempts = 0;
            const maxAttempts = 20; // Maximum 2 secondes d'attente
            
            const waitForCorrectZoom = () => {
              attempts++;
              const currentZoom = map.getZoom();
              console.log(`Zoom actuel: ${currentZoom}, attendu: ${targetZoom} (tentative ${attempts}/${maxAttempts})`);
              
              if (Math.abs(currentZoom - targetZoom) <= 0.1) {
                console.log(`Zoom correct atteint: ${currentZoom}`);
                // Attendre encore un peu pour s'assurer que tout est stable
                setTimeout(() => {
                  restoreMarkersFromData(data);
                }, 300);
              } else if (attempts >= maxAttempts) {
                console.warn(`Impossible d'atteindre le zoom ${targetZoom} après ${maxAttempts} tentatives. Zoom actuel: ${currentZoom}`);
                // Continuer quand màªme avec le zoom actuel
                restoreMarkersFromData(data);
              } else {
                // Réessayer dans 100ms
                setTimeout(waitForCorrectZoom, 100);
              }
            };
            
            // Commencer à vérifier après un délai initial
            setTimeout(waitForCorrectZoom, 200);
          } else {
            // Si pas de centre/zoom sauvegardé, restaurer immédiatement
            restoreMarkersFromData(data);
          }
        }, 1000); // Attendre 1 seconde pour que le nettoyage soit terminé
        
        function restoreMarkersFromData(data) {
          // Vérifier que le zoom est correct avant de restaurer les marqueurs
          const currentZoom = map.getZoom();
          const expectedZoom = data.mapZoom;
          if (expectedZoom && Math.abs(currentZoom - expectedZoom) > 0.1) {
            console.warn(`Zoom incorrect: attendu ${expectedZoom}, actuel ${currentZoom}`);
          }
          
          // Restaurer les marqueurs placés
          let loadedCount = 0;
          let errorCount = 0;
          const totalMarkers = data.placedMarkers.length;
        
          if (totalMarkers === 0) {
            // Fermer la modal de gestion des projets
            const manageProjectsModal = document.getElementById('manageProjectsModal');
            if (manageProjectsModal) {
              manageProjectsModal.style.display = 'none';
            }
            showMessage('Projet chargé avec succès ! Aucun marqueur à restaurer.', 'success');
            return;
          }
          
          // Pas d'indicateur de progression - chargement silencieux
          
          data.placedMarkers.forEach((markerData, index) => {
            try {
              // Validation des données du marqueur
              if (!markerData.imageData && !markerData.imagePath) {
                console.warn(`Marqueur ${index + 1} ignoré: pas d'image`);
                errorCount++;
                loadedCount++;
                checkLoadingComplete();
                return;
              }
              
              const img = new Image();
              img.src = markerData.imageData || markerData.imagePath;
              
              img.onload = function() {
                try {
                  // Utiliser la nouvelle fonction basée sur les 4 coins
                  const marker = createMarkerFromCorners(markerData, img).addTo(map);
                  
                  // Restaurer les propriétés
                  marker._rotation = markerData.rotation || 0;
                  marker._scale = markerData.scale || 1;
                  marker._section = markerData.section;
                  marker._imagePath = markerData.imagePath;
                  marker._imageData = markerData.imageData;
                  marker._id = markerData.id;
                  
                  // Setup du marqueur AVANT d'ajouter à la liste
                  setupMarker(marker);
                  markers.push(marker);
                  
                  // Mettre en état stuck si nécessaire (AVANT d'appliquer la rotation)
                  if (markerData.isStuck) {
                    console.log(`Restauration du marqueur stuck: ${markerData.id}`);
                    
                    // Créer les données stuck manuellement
                    const center = marker.getLatLng();
                    const icon = marker._icon.querySelector('img');
                    const originalSize = icon ? [icon.width, icon.height] : (marker._originalSize || [100, 100]);
                    
                    // Stocker les données stuck
                    stuckData.set(marker, {
                      center: center,
                      rotation: marker._rotation || 0,
                      originalSize: originalSize,
                      originalZoom: map.getZoom(),
                      imageSrc: markerData.imageData || markerData.imagePath
                    });
                    
                    // Désactiver le dragging
                    marker.dragging.disable();
                    marker.setOpacity(1.0);
                    
                    // Mettre à jour l'icône de la toolbox si un marqueur est sélectionné
                    if (selectedMarker === marker) {
                      const stuckIcon = document.querySelector('[data-action="stuck"]');
                      if (stuckIcon) {
                        stuckIcon.textContent = '📌';
                        stuckIcon.style.color = 'red';
                      }
                    }
                  } else {
                    // Pour les marqueurs non-stuck, s'assurer que la taille est préservée
                    // en stockant la taille originale calculée par createMarkerFromCorners
                    const icon = marker._icon.querySelector('img');
                    if (icon) {
                      marker._originalSize = [icon.width, icon.height];
                      console.log(`Taille originale préservée pour marqueur non-stuck: ${icon.width}x${icon.height}px`);
                    }
                  }
                  
                  // Appliquer la rotation APRÈS le setup
                  if (marker._rotation) {
                    applyRotation(marker);
                  }
                  
  // Mettre à jour le marqueur stuck si nécessaire
  if (markerData.isStuck) {
    updateStuckMarker(marker);
  }
  
  // Réorganiser le z-index après restauration
  reorganizeMarkerZIndex();
  
  loadedCount++;
  checkLoadingComplete();
                  
                } catch (error) {
                  console.error(`Erreur lors de la création du marqueur ${index + 1}:`, error);
                  errorCount++;
                  loadedCount++;
                  checkLoadingComplete();
                }
              };
              
              img.onerror = function() {
                console.error('Erreur lors du chargement de l\'image:', markerData.imagePath || markerData.imageData);
                errorCount++;
                loadedCount++;
                checkLoadingComplete();
              };
              
            } catch (error) {
              console.error(`Erreur lors du traitement du marqueur ${index + 1}:`, error);
              errorCount++;
              loadedCount++;
              checkLoadingComplete();
            }
          });
          
          function checkLoadingComplete() {
            if (loadedCount === totalMarkers) {
              // Fermer la modal de gestion des projets
              const manageProjectsModal = document.getElementById('manageProjectsModal');
              if (manageProjectsModal) {
                manageProjectsModal.style.display = 'none';
              }
              
              if (errorCount === 0) {
                showMessage(`Projet chargé avec succès ! ${totalMarkers} marqueur(s) restauré(s).`, 'success');
              } else if (loadedCount - errorCount > 0) {
                showMessage(`Projet chargé avec succès ! ${loadedCount - errorCount} marqueur(s) restauré(s), ${errorCount} erreur(s).`, 'warning');
              } else {
                showMessage(`Erreur lors du chargement du projet. ${errorCount} erreur(s).`, 'error');
              }
            }
          }
        }
        
      } catch (error) {
        console.error('Erreur lors du chargement du projet:', error);
        showMessage('Erreur lors du chargement: ' + error.message, 'error');
      }
    };
    
    reader.readAsText(file);
  };
  
  input.click();
}

// Fonction utilitaire pour afficher des messages (utilise notre système personnalisé)
function showMessage(message, type = 'info') {
  switch (type) {
    case 'success':
      CustomMessages.success(message);
      break;
    case 'warning':
      CustomMessages.warning(message);
      break;
    case 'error':
      CustomMessages.error(message);
      break;
    case 'info':
    default:
      CustomMessages.info(message);
      break;
  }
}

// Gestionnaires d'événements pour les boutons
document.getElementById('addSectionBtn').addEventListener('click', addSection);
document.getElementById('addMarkerBtn').addEventListener('click', addMarker);
document.getElementById('exportMarkersBtn').addEventListener('click', exportMarkers);
document.getElementById('importMarkersBtn').addEventListener('click', importMarkers);
document.getElementById('exportProjectBtn').addEventListener('click', exportProject);
document.getElementById('importProjectBtn').addEventListener('click', importProject);


// Code supprimé - remplacé par le nouveau système de gestion des marqueurs

// Convertir un fichier en base64
function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => resolve(reader.result);
    reader.onerror = error => reject(error);
  });
}

// Sauvegarder l'image en mémoire uniquement (pas de localStorage)
function saveImageToStorage(section, imagePath, displayName, base64Data) {
  // Vérifier la taille de l'image
  if (base64Data && base64Data.length > CrisisMapper.config.maxImageSize) {
    console.warn('Image trop volumineuse:', displayName, 'Taille:', base64Data.length);
    return false;
  }
  
  // Vérifier la limite de marqueurs
  if (CrisisMapper.addedImages.length >= CrisisMapper.config.maxMarkers) {
    console.warn('Limite de marqueurs atteinte:', CrisisMapper.config.maxMarkers);
    return false;
  }
  
  // Calculer l'ordre dans la section
  const sectionImages = CrisisMapper.addedImages.filter(img => img.section === section);
  const order = sectionImages.length;
  
  const imageData = {
    section: section,
    path: imagePath,
    name: displayName,
    data: base64Data, // Stockage en Base64
    timestamp: Date.now(),
    order: order // Ordre dans la section
  };
  
  CrisisMapper.addedImages.push(imageData);
  
  // Sauvegarder automatiquement l'état du gestionnaire (optimisé)
  saveMarkerManagerStateOptimized();
  
  return true;
}

// Nettoyer les données corrompues dans addedImages
function cleanCorruptedImages() {
  const originalLength = CrisisMapper.addedImages.length;
  CrisisMapper.addedImages = CrisisMapper.addedImages.filter(img => {
    // Vérifier si le nom est corrompu (trop long ou contient des caractères étranges)
    if (img.name && img.name.length > 100) {
      console.warn('Image corrompue supprimée (nom trop long):', img.name.substring(0, 50) + '...');
      return false;
    }
    
    // Vérifier si les données Base64 sont valides
    if (img.data && img.data.startsWith('data:') && img.data.length > 1000000) {
      console.warn('Données Base64 trop volumineuses supprimées:', img.name);
      return false;
    }
    
    // Vérifier si la section existe
    if (!CrisisMapper.sections.find(s => s.id === img.section)) {
      console.warn('Image avec section invalide supprimée:', img.name, '- Section:', img.section);
      return false;
    }
    
    // Vérifier si les propriétés requises existent
    if (!img.section || !img.name || (!img.data && !img.path)) {
      console.warn('Image avec propriétés manquantes supprimée:', img.name);
      return false;
    }
    
    return true;
  });
  
  if (CrisisMapper.addedImages.length !== originalLength) {
    // Plus de localStorage - données en mémoire uniquement
  }
}


// Restaurer les images depuis addedImages après reconstruction de la sidebar
function restoreImagesFromAddedImages() {
  CrisisMapper.addedImages.forEach(imageData => {
    addImageToMenu(imageData.section, imageData.path, imageData.name, imageData.data);
  });
  
  // Corriger les tailles après restauration des images
  setTimeout(() => {
    updateSizes();
  }, 30);
}

// Restaurer les images sauvegardées au chargement (désactivé - pas de localStorage)
function restoreSavedImages() {
  // Plus de localStorage - les images ne sont pas persistantes
  // Les images sont ajoutées uniquement en mémoire pendant la session
  
  // Vider d'abord tous les menus existants (sauf l'option par défaut)
  CrisisMapper.sections.forEach(section => {
    const menu = document.getElementById(section.menuId);
    if (menu) {
  const optionsContainer = menu.querySelector('.options');
      if (optionsContainer) {
        // Garder seulement l'option par défaut "-- Sélectionner --"
        const defaultOption = optionsContainer.querySelector('.option[data-path=""]');
        optionsContainer.innerHTML = '';
        if (defaultOption) {
          optionsContainer.appendChild(defaultOption);
        } else {
          optionsContainer.innerHTML = '<div class="option" data-path=""><span class="no-img">-- Sélectionner --</span></div>';
        }
      }
    }
  });
  
  // Les images ajoutées pendant la session seront restaurées automatiquement
  // via les fonctions d'ajout de marqueurs
}

// Ajouter une image au menu correspondant
function addImageToMenu(section, imagePath, displayName, base64Data = null) {
  // Trouver la section correspondante
  const sectionData = CrisisMapper.sections.find(s => s.id === section);
  if (!sectionData) {
    console.warn('Section non trouvée:', section, '- Image ignorée:', displayName);
    // Supprimer cette image corrompue de addedImages
    const corruptedIndex = CrisisMapper.addedImages.findIndex(img => 
      img.section === section && img.path === imagePath && img.name === displayName
    );
    if (corruptedIndex !== -1) {
      CrisisMapper.addedImages.splice(corruptedIndex, 1);
      // Plus de localStorage - données en mémoire uniquement
    }
    return;
  }
  
  const menu = document.getElementById(sectionData.menuId);
  if (!menu) {
    console.error('Menu non trouvé:', sectionData.menuId);
    return;
  }
  
  const optionsContainer = menu.querySelector('.options');
  
  // Vérifier si l'image n'existe pas déjà (par chemin ou par données Base64)
  const existingOption = optionsContainer.querySelector(`[data-path="${imagePath}"]`);
  if (existingOption) {
    return; // L'image existe déjà
  }
  
  // Vérifier aussi par données Base64 si c'est du Base64
  if (base64Data && base64Data.startsWith('data:')) {
    const existingByData = Array.from(optionsContainer.querySelectorAll('.option')).find(option => {
      const img = option.querySelector('img');
      return img && img.src === base64Data;
    });
    if (existingByData) {
      return; // L'image existe déjà
    }
  }
  
  // Créer la nouvelle option
  const newOption = document.createElement('div');
  newOption.className = 'option';
  
  // Utiliser un identifiant unique basé sur le nom et la section
  const uniqueId = `${section}_${displayName}_${Date.now()}`;
  newOption.setAttribute('data-path', uniqueId);
  
  const img = document.createElement('img');
  // Utiliser les données Base64 si disponibles, sinon le chemin
  img.src = base64Data || imagePath;
  img.className = 'marker-thumbnail';
  
  // Créer le span avec exactement la màªme police que les options existantes
  const textSpan = document.createElement('span');
  textSpan.textContent = ` ${displayName}`;
  // Appliquer les màªmes styles que la sidebar
  textSpan.className = 'marker-text';
  
  newOption.appendChild(img);
  newOption.appendChild(textSpan);
  
  // Ajouter l'événement de clic
  newOption.addEventListener('click', () => {
    updateSelectedOption(menu, newOption);
    optionsContainer.style.display = 'none';
  });
  
  // Insérer avant la dernière option (-- Sélectionner --)
  const lastOption = optionsContainer.lastElementChild;
  optionsContainer.insertBefore(newOption, lastOption);
}

// Fonction générique pour afficher des messages
function showMessage(message, type = 'info') {
  const colors = {
    success: 'linear-gradient(135deg, #4CAF50 0%, #45a049 100%)',
    error: 'linear-gradient(135deg, #f44336 0%, #da190b 100%)',
    warning: 'linear-gradient(135deg, #FF9800 0%, #F57C00 100%)',
    info: 'linear-gradient(135deg, #2196F3 0%, #1976D2 100%)'
  };
  
  const modal = document.createElement('div');
  modal.style.cssText = `
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    background: ${colors[type] || colors.info};
    color: white;
    padding: 20px 30px;
    border-radius: 15px;
    z-index: 3000;
    text-align: center;
    max-width: 400px;
    box-shadow: 0 10px 30px rgba(0,0,0,0.3);
    font-family: Arial, sans-serif;
  `;
  
  modal.innerHTML = `
    <div style="font-size: 16px; margin-bottom: 10px;">${message}</div>
    <button onclick="this.parentElement.remove()" style="
      background: rgba(255,255,255,0.2);
      border: 2px solid white;
      color: white;
      padding: 8px 20px;
      border-radius: 20px;
      cursor: pointer;
      font-size: 14px;
      font-weight: bold;
      transition: all 0.3s ease;
      margin-top: 10px;
    " onmouseover="this.style.background='rgba(255,255,255,0.3)'" onmouseout="this.style.background='rgba(255,255,255,0.2)'">
      OK
    </button>
  `;
  
  document.body.appendChild(modal);
  
  // Auto-suppression après 1.5 secondes
  setTimeout(() => {
    if (modal.parentElement) {
      modal.remove();
    }
  }, 1500);
}

// Afficher message de succès
function showSuccessMessage(section, name) {
  const sectionName = section === 'carroyages' ? 'Carroyages' : 'Icônes';
  
  const modal = document.createElement('div');
  modal.style.cssText = `
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    background: linear-gradient(135deg, #4CAF50 0%, #45a049 100%);
    color: white;
    padding: 30px;
    border-radius: 15px;
    z-index: 3000;
    text-align: center;
    max-width: 500px;
    box-shadow: 0 10px 30px rgba(0,0,0,0.3);
    font-family: Arial, sans-serif;
  `;
  
  modal.innerHTML = `
    <div style="font-size: 24px; margin-bottom: 20px;">✏… Image ajoutée avec succès !</div>
    <div style="background: rgba(255,255,255,0.1); padding: 20px; border-radius: 10px; margin: 20px 0;">
      <p style="margin: 0 0 15px 0; font-size: 16px;">L'image <strong>${name}</strong> a été ajoutée à la section <strong>${sectionName}</strong>.</p>
      <p style="margin: 0 0 15px 0; font-size: 16px;">Le fichier image a été téléchargé. Placez-le dans le dossier <strong>images/${section}/</strong></p>
      <p style="margin: 0 0 15px 0; font-size: 16px;">N'oubliez pas de sauvegarder vos paramètres !</p>
    </div>
    <button onclick="this.parentElement.remove()" aria-label="Fermer ce message" style="
      background: rgba(255,255,255,0.2);
      border: 2px solid white;
      color: white;
      padding: 10px 25px;
      border-radius: 25px;
      cursor: pointer;
      font-size: 16px;
      font-weight: bold;
      transition: all 0.3s ease;
    " onmouseover="this.style.background='rgba(255,255,255,0.3)'" onmouseout="this.style.background='rgba(255,255,255,0.2)'">
      Fermer
    </button>
  `;
  
  document.body.appendChild(modal);
  
  // Auto-suppression après 10 secondes
  setTimeout(() => {
    if (modal.parentElement) {
      modal.remove();
    }
  }, 10000);
}

// Ancien code d'export/import supprimé - remplacé par le nouveau système

// Anciennes fonctions de messages supprimées - remplacées par showMessage()

// Anciennes fonctions de gestion des images supprimées - remplacées par le nouveau système


// === SYSTÈME INDEXEDDB POUR SAUVEGARDE DU GESTIONNAIRE DE MARQUEURS ===
const MarkerManagerDB = {
  dbName: 'CrisisMapperMarkerManager',
  dbVersion: 1,
  db: null,
  saveDebounceTimer: null, // Timer pour debouncing de sauvegarde
  
  // Initialiser la base de données
  async init() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, this.dbVersion);
      
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        this.db = request.result;
        resolve();
      };
      
      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        
        // Store pour l'état du gestionnaire de marqueurs
        if (!db.objectStoreNames.contains('markerManagerState')) {
          const store = db.createObjectStore('markerManagerState', { keyPath: 'id' });
          store.createIndex('timestamp', 'timestamp', { unique: false });
        }
        
      };
    });
  },
  
  // Sauvegarder l'état du gestionnaire de marqueurs (avec debouncing)
  async saveMarkerManagerState() {
    // Debouncing pour éviter les sauvegardes trop fréquentes
    if (this.saveDebounceTimer) {
      clearTimeout(this.saveDebounceTimer);
    }
    
    return new Promise((resolve) => {
      this.saveDebounceTimer = setTimeout(async () => {
        if (!this.db) {
          console.warn('IndexedDB non initialisé');
          resolve();
          return;
        }
        
        try {
          const state = {
            id: 'markerManagerState',
            timestamp: Date.now(),
            addedImages: CrisisMapper.addedImages,
            sections: CrisisMapper.sections,
            sidebarState: {
              carroCustom: document.getElementById('carroCustom')?.querySelector('.selected-option span')?.textContent || '',
              iconCustom: document.getElementById('iconCustom')?.querySelector('.selected-option span')?.textContent || ''
            }
          };
          
          const transaction = this.db.transaction(['markerManagerState'], 'readwrite');
          const store = transaction.objectStore('markerManagerState');
          await store.put(state);
          
        } catch (error) {
          console.error('Erreur lors de la sauvegarde du gestionnaire:', error);
        }
        resolve();
      }, 1500); // Debounce de 1.5 secondes
    });
  },
  
  // Charger l'état du gestionnaire de marqueurs
  async loadMarkerManagerState() {
    if (!this.db) {
      console.warn('IndexedDB non initialisé');
      return null;
    }
    
    try {
      const transaction = this.db.transaction(['markerManagerState'], 'readonly');
      const store = transaction.objectStore('markerManagerState');
      const request = store.get('markerManagerState');
      
      return new Promise((resolve, reject) => {
        request.onsuccess = () => {
          const state = request.result;
          if (state) {
            resolve(state);
          } else {
            resolve(null);
          }
        };
        request.onerror = () => reject(request.error);
      });
    } catch (error) {
      console.error('Erreur lors du chargement du gestionnaire:', error);
      return null;
    }
  },
  
  // Restaurer l'état du gestionnaire de marqueurs
  async restoreMarkerManagerState(state) {
    if (!state) return;
    
    try {
      // Restaurer les images ajoutées et les trier par ordre
      CrisisMapper.addedImages = (state.addedImages || []).sort((a, b) => {
        // Trier d'abord par section, puis par ordre
        if (a.section !== b.section) {
          return a.section.localeCompare(b.section);
        }
        return (a.order || 0) - (b.order || 0);
      });
      
      // Restaurer les sections et les trier par ordre
      if (state.sections) {
        CrisisMapper.sections = state.sections.sort((a, b) => (a.order || 0) - (b.order || 0));
      }
      
      // Les variables selectedImagePath et selectedImageType ne sont plus sauvegardées
      // pour éviter le placement automatique de marqueurs au rafraîchissement
      
      // Restaurer l'état de la sidebar
      if (state.sidebarState) {
        if (state.sidebarState.carroCustom) {
          const carroCustom = document.getElementById('carroCustom');
          if (carroCustom) {
            const span = carroCustom.querySelector('.selected-option span');
            if (span) span.textContent = state.sidebarState.carroCustom;
          }
        }
        
        if (state.sidebarState.iconCustom) {
          const iconCustom = document.getElementById('iconCustom');
          if (iconCustom) {
            const span = iconCustom.querySelector('.selected-option span');
            if (span) span.textContent = state.sidebarState.iconCustom;
          }
        }
      }
      
      // Reconstruire la sidebar
      updateSidebarSections();
      
      
    } catch (error) {
      console.error('Erreur lors de la restauration du gestionnaire:', error);
    }
  }
};

// Système de nettoyage automatique
const AutoCleanup = {
  init: () => {
    // Nettoyer le cache DOM toutes les 5 minutes
    setInterval(() => {
      DOMCache.clear();
    }, 5 * 60 * 1000);
    
    // Nettoyer les images corrompues au démarrage
    cleanCorruptedImages();
    
    // Nettoyer les modales orphelines
    setInterval(() => {
      const orphanModals = document.querySelectorAll('.modal:not(#manageMarkersModal):not(#manageProjectsModal)');
      orphanModals.forEach(modal => {
        if (!modal.parentElement || !document.body.contains(modal)) {
          modal.remove();
        }
      });
    }, 30000); // Toutes les 30 secondes
  }
};

// Fonction de nettoyage complet de la carte
function clearAllMarkers() {
  
  // Nettoyer les variables globales
  markers = [];
  stuckData.clear();
  selectedMarker = null;
  
  // Supprimer tous les marqueurs de la carte
  const allLayers = [];
  map.eachLayer(layer => {
    if (layer instanceof L.Marker) {
      allLayers.push(layer);
    }
  });
  
  
  allLayers.forEach(layer => {
    try {
      // Supprimer aussi les borderDiv s'ils existent
      if (layer.borderDiv) {
        try {
          map.removeLayer(layer.borderDiv);
        } catch (e) {
          console.warn('Erreur lors de la suppression du borderDiv:', e);
        }
      }
      map.removeLayer(layer);
    } catch (e) {
      console.warn('Erreur lors de la suppression d\'un marqueur:', e);
    }
  });
  
  // Masquer la toolbox
  const markerToolbox = document.getElementById('markerToolbox');
  if (markerToolbox) {
    markerToolbox.style.display = 'none';
  }
  
}

// === FONCTIONS DES NOUVEAUX BOUTONS DE GESTION DES MARQUEURS ===

// Fonction pour épingler tous les marqueurs
function bulkStuckAllMarkers() {
  let stuckCount = 0;
  
  markers.forEach(marker => {
    if (!stuckData.has(marker)) {
      const center = marker.getLatLng();
      const icon = marker._icon.querySelector('img');
      const originalSize = icon ? [icon.width, icon.height] : (marker._originalSize || [100, 100]);
      
      // Stocker les données stuck
      stuckData.set(marker, {
        center: center,
        rotation: marker._rotation || 0,
        originalSize: originalSize,
        originalZoom: map.getZoom(),
        imageSrc: marker._imageData || marker._imagePath || marker._icon.querySelector('img').src
      });
      
      marker.dragging.disable();
      marker.setOpacity(1.0);
      stuckCount++;
    }
  });
  
  // Mettre à jour l'icône de la toolbox si un marqueur est sélectionné
  if (selectedMarker && stuckData.has(selectedMarker)) {
    const stuckIcon = document.querySelector('[data-action="stuck"]');
    if (stuckIcon) {
      stuckIcon.textContent = '📌';
      stuckIcon.style.color = 'red';
    }
  }
  
  if (stuckCount > 0) {
    showMessage(`${stuckCount} marqueur(s) épinglé(s) avec succès`, 'success');
  } else {
    showMessage('Tous les marqueurs sont déjà épinglés', 'info');
  }
}

// Fonction pour détacher tous les marqueurs
function bulkUnstuckAllMarkers() {
  if (stuckData.size === 0) {
    showMessage('Aucun marqueur épinglé à détacher', 'info');
    return;
  }
  
  const confirmMessage = `Êtes-vous sûr de vouloir détacher ${stuckData.size} marqueur(s) épinglé(s) ?`;
  
  CustomMessages.confirm(confirmMessage, 'Détachement massif', (confirmed) => {
    if (!confirmed) return;
    
    let unstuckCount = 0;
    
    for (const [marker, data] of stuckData) {
      marker.dragging.enable();
      marker.setOpacity(1);
      stuckData.delete(marker);
      unstuckCount++;
    }
    
    // Mettre à jour l'icône de la toolbox si un marqueur est sélectionné
    if (selectedMarker) {
      const stuckIcon = document.querySelector('[data-action="stuck"]');
      if (stuckIcon) {
        stuckIcon.textContent = '📌';
        stuckIcon.style.color = '';
      }
    }
    
    showMessage(`${unstuckCount} marqueur(s) détaché(s) avec succès`, 'success');
  });
}

// Fonction pour supprimer tous les marqueurs
function bulkDeleteAllMarkers() {
  if (markers.length === 0) {
    showMessage('Aucun marqueur à supprimer', 'info');
    return;
  }
  
  const confirmMessage = `Êtes-vous sûr de vouloir supprimer ${markers.length} marqueur(s) de la carte ?\n\nCette action est irréversible.`;
  
  CustomMessages.confirm(confirmMessage, 'Suppression massive', (confirmed) => {
    if (!confirmed) return;
    
    // Nettoyer les variables globales
    markers.forEach(marker => {
      // Supprimer les poignées de redimensionnement et de rotation
      if (marker.resizeZones) {
        marker.resizeZones.forEach(zone => {
          if (zone.parentNode) {
            zone.parentNode.removeChild(zone);
          }
        });
        marker.resizeZones = [];
      }
      
      // Supprimer le borderDiv s'il existe
      if (marker.borderDiv) {
        try {
          map.removeLayer(marker.borderDiv);
        } catch (e) {
          console.warn('Erreur lors de la suppression du borderDiv:', e);
        }
      }
      
      // Supprimer le marqueur de la carte
      try {
        map.removeLayer(marker);
      } catch (e) {
        console.warn('Erreur lors de la suppression d\'un marqueur:', e);
      }
    });
    
    // Nettoyer les données
    markers = [];
    stuckData.clear();
    selectedMarker = null;
    
    // Masquer la toolbox
    const markerToolbox = document.getElementById('markerToolbox');
    if (markerToolbox) {
      markerToolbox.style.display = 'none';
    }
    
    showMessage('Tous les marqueurs ont été supprimés', 'success');
  });
}

// Ajouter les événements aux nouveaux boutons
document.addEventListener('DOMContentLoaded', () => {
  // Bouton épingler tous les marqueurs
  const bulkStuckBtn = document.getElementById('bulkStuckBtn');
  if (bulkStuckBtn) {
    bulkStuckBtn.addEventListener('click', bulkStuckAllMarkers);
  }
  
  // Bouton détacher tous les marqueurs
  const bulkUnstuckBtn = document.getElementById('bulkUnstuckBtn');
  if (bulkUnstuckBtn) {
    bulkUnstuckBtn.addEventListener('click', bulkUnstuckAllMarkers);
  }
  
  // Bouton supprimer tous les marqueurs
  const bulkDeleteBtn = document.getElementById('bulkDeleteBtn');
  if (bulkDeleteBtn) {
    bulkDeleteBtn.addEventListener('click', bulkDeleteAllMarkers);
  }
});

// === FONCTION COPIER/COLLER MARQUEURS ===

// Fonction pour copier un marqueur
function copyMarker(marker) {
  if (!marker) return;
  
  // Récupérer les données du marqueur
  const icon = marker._icon ? marker._icon.querySelector('img') : null;
  const originalSize = icon ? [icon.width, icon.height] : (marker._originalSize || [100, 100]);
  
  copiedMarkerData = {
    imagePath: marker._imagePath,
    imageData: marker._imageData,
    section: marker._section,
    position: marker.getLatLng(),
    size: originalSize,
    rotation: marker._rotation || 0,
    scale: marker._scale || 1
  };
  
  // Réinitialiser le compteur de collage
  pasteCount = 0;
  
  showMessage('Marqueur copié !', 'success');
}

// Fonction pour coller un marqueur
function pasteMarker() {
  if (!copiedMarkerData) {
    showMessage('Aucun marqueur copié !', 'warning');
    return;
  }
  
  // Calculer une position décalée basée sur la taille de la fenêtre (2% vers la droite)
  const originalPos = copiedMarkerData.position;
  
  // Convertir la position en pixels sur l'écran
  const originalPoint = map.latLngToContainerPoint(originalPos);
  
  // Calculer le décalage en pixels (2% de la largeur de la fenêtre)
  const windowWidth = window.innerWidth;
  const baseOffsetPixels = windowWidth * 0.02; // 2% de la largeur de la fenêtre
  
  // Incrémenter le compteur de collage et calculer le décalage accumulé
  pasteCount++;
  const totalOffsetPixels = baseOffsetPixels * pasteCount;
  
  // Appliquer le décalage accumulé en pixels
  const newPoint = L.point(
    originalPoint.x + totalOffsetPixels,
    originalPoint.y + totalOffsetPixels // Même décalage vertical pour la cohérence
  );
  
  // Convertir la nouvelle position en coordonnées géographiques
  const newPosition = map.containerPointToLatLng(newPoint);
  
  // Créer le nouveau marqueur
  const img = new Image();
  img.src = copiedMarkerData.imageData || copiedMarkerData.imagePath;
  
  img.onload = function() {
    // Calculer la taille finale avec le scale
    const finalSize = [
      copiedMarkerData.size[0] * copiedMarkerData.scale,
      copiedMarkerData.size[1] * copiedMarkerData.scale
    ];
    
    const customIcon = L.divIcon({
      html: `<img src="${copiedMarkerData.imageData || copiedMarkerData.imagePath}" style="width:${finalSize[0]}px;height:${finalSize[1]}px;transform:rotate(${copiedMarkerData.rotation}deg);transform-origin:50% 50%;">`,
      iconSize: finalSize,
      iconAnchor: [finalSize[0]/2, finalSize[1]/2],
      className: ''
    });
    
    const zIndexOffset = copiedMarkerData.section === 'carroyages' ? 0 : 1000;
    const newMarker = L.marker(newPosition, {
      icon: customIcon,
      zIndexOffset: zIndexOffset,
      draggable: true
    }).addTo(map);
    
    // Ajouter les propriétés nécessaires
    newMarker._imagePath = copiedMarkerData.imagePath;
    newMarker._imageData = copiedMarkerData.imageData;
    newMarker._section = copiedMarkerData.section;
    newMarker._id = Date.now() + Math.random();
    newMarker._rotation = copiedMarkerData.rotation;
    newMarker._scale = copiedMarkerData.scale;
    newMarker._originalSize = copiedMarkerData.size;
    
    setupMarker(newMarker);
    markers.push(newMarker);
    MapMarkersCache.add(newMarker);
    
    // Sélectionner automatiquement le nouveau marqueur
    if (selectedMarker && selectedMarker !== newMarker) {
      selectedMarker.isSelected = false;
      if (selectedMarker.updateBorder) selectedMarker.updateBorder();
    }
    newMarker.isSelected = true;
    selectedMarker = newMarker;
    if (newMarker.updateBorder) newMarker.updateBorder();
    markerToolbox.style.display = 'flex';
    
    showMessage('Marqueur collé !', 'success');
  };
}

// Fonction pour afficher les messages
function showMessage(message, type = 'info') {
  // Créer un élément de message temporaire
  const messageDiv = document.createElement('div');
  messageDiv.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    padding: 15px 20px;
    border-radius: 5px;
    color: white;
    font-weight: bold;
    z-index: 10000;
    max-width: 300px;
    word-wrap: break-word;
    box-shadow: 0 4px 12px rgba(0,0,0,0.3);
    transition: opacity 0.3s ease;
  `;
  
  // Couleur selon le type
  switch(type) {
    case 'success':
      messageDiv.style.backgroundColor = '#4CAF50';
      break;
    case 'error':
      messageDiv.style.backgroundColor = '#f44336';
      break;
    case 'warning':
      messageDiv.style.backgroundColor = '#ff9800';
      break;
    case 'info':
    default:
      messageDiv.style.backgroundColor = '#2196F3';
      break;
  }
  
  messageDiv.textContent = message;
  document.body.appendChild(messageDiv);
  
  // Supprimer après 3 secondes
  setTimeout(() => {
    messageDiv.style.opacity = '0';
    setTimeout(() => {
      if (messageDiv.parentNode) {
        messageDiv.parentNode.removeChild(messageDiv);
      }
    }, 300);
  }, 3000);
}

// === SAUVEGARDE AUTOMATIQUE DU GESTIONNAIRE DE MARQUEURS ===

// Sauvegarde automatique avant fermeture/rafraîchissement
window.addEventListener('beforeunload', async (event) => {
  try {
    await MarkerManagerDB.saveMarkerManagerState();
  } catch (error) {
    console.error('Erreur lors de la sauvegarde du gestionnaire:', error);
  }
});

// Charger automatiquement l'état du gestionnaire au démarrage
document.addEventListener('DOMContentLoaded', async () => {
  try {
    // Initialiser IndexedDB pour le gestionnaire
    await MarkerManagerDB.init();
    
    // Nettoyer la carte au démarrage
    clearAllMarkers();
    
    // Initialiser le menu déroulant des fonds de carte
    const basemapSelector = document.getElementById('basemapSelector');
    if (basemapSelector) {
      basemapSelector.style.display = 'none';
    }
    
    // Réinitialiser les variables de sélection de marqueurs
    selectedImagePath = "";
    selectedImageType = null;
    selectedMarker = null;
    justAddedMarker = false;
    
    // Initialiser le système de nettoyage
    AutoCleanup.init();
    
    updateSidebarSections();
    
    // Corriger les tailles après génération de la sidebar (seulement si déroulée)
    setTimeout(() => {
      const sidebar = document.getElementById('sidebar');
      if (sidebar && !sidebar.classList.contains('collapsed')) {
        updateSizes();
      }
    }, 100); // Petit délai pour s'assurer que la sidebar est générée
    
    // Charger l'état du gestionnaire sauvegardé
    const savedManagerState = await MarkerManagerDB.loadMarkerManagerState();
    if (savedManagerState) {
      await MarkerManagerDB.restoreMarkerManagerState(savedManagerState);
      
      // Corriger les tailles après restauration de l'état (seulement si déroulée)
      setTimeout(() => {
        const sidebar = document.getElementById('sidebar');
        if (sidebar && !sidebar.classList.contains('collapsed')) {
          updateSizes();
        }
      }, 50);
    }
    
  } catch (error) {
    console.error('Erreur lors de l\'initialisation:', error);
    // En cas d'erreur, continuer avec l'application vide
    clearAllMarkers();
    AutoCleanup.init();
    updateSidebarSections();
    
    // Corriger les tailles même en cas d'erreur (seulement si déroulée)
    setTimeout(() => {
      const sidebar = document.getElementById('sidebar');
      if (sidebar && !sidebar.classList.contains('collapsed')) {
        updateSizes();
      }
    }, 100);
  }
});


// === SYSTÈME D'OPTIMISATION DES PERFORMANCES ===

// Cache pour les calculs coûteux
const PerformanceCache = {
  cache: new Map(),
  maxSize: 100,
  
  // Obtenir une valeur du cache
  get(key) {
    const item = this.cache.get(key);
    if (item && Date.now() - item.timestamp < 5000) { // Cache valide 5 secondes
      return item.value;
    }
    if (item) {
      this.cache.delete(key); // Supprimer les entrées expirées
    }
    return null;
  },
  
  // Mettre en cache une valeur
  set(key, value) {
    // Nettoyer le cache si nécessaire
    if (this.cache.size >= this.maxSize) {
      const firstKey = this.cache.keys().next().value;
      this.cache.delete(firstKey);
    }
    
    this.cache.set(key, {
      value: value,
      timestamp: Date.now()
    });
  },
  
  // Invalider le cache
  clear() {
    this.cache.clear();
  },
  
  // Invalider une clé spécifique
  invalidate(key) {
    this.cache.delete(key);
  }
};

// Cache pour les requàªtes DOM fréquentes (déjà déclaré plus haut)

// Fonction optimisée pour getBoundingClientRect avec cache
function getCachedBoundingRect(element) {
  const elementId = element.id || element.className || 'anonymous';
  const cacheKey = `rect_${elementId}_${element.offsetWidth}_${element.offsetHeight}`;
  
  let rect = PerformanceCache.get(cacheKey);
  if (!rect) {
    rect = element.getBoundingClientRect();
    PerformanceCache.set(cacheKey, rect);
  }
  return rect;
}

// Fonction optimisée pour les filtres de marqueurs
function getCachedMarkersBySection(sectionId) {
  const cacheKey = `markers_${sectionId}_${CrisisMapper.addedImages.length}`;
  
  let markers = PerformanceCache.get(cacheKey);
  if (!markers) {
    markers = CrisisMapper.addedImages.filter(img => img.section === sectionId);
    PerformanceCache.set(cacheKey, markers);
  }
  return markers;
}

// Système de debouncing amélioré
const DebounceManager = {
  timers: new Map(),
  
  // Debounce avec délai personnalisé
  debounce(key, func, delay = 3000) {
    // Annuler le timer précédent
    if (this.timers.has(key)) {
      clearTimeout(this.timers.get(key));
    }
    
    // Créer un nouveau timer
    const timer = setTimeout(() => {
      try {
        func();
      } catch (error) {
        console.error(`Erreur dans la fonction debounced ${key}:`, error);
      } finally {
        this.timers.delete(key);
      }
    }, delay);
    
    this.timers.set(key, timer);
  },
  
  // Annuler un debounce
  cancel(key) {
    if (this.timers.has(key)) {
      clearTimeout(this.timers.get(key));
      this.timers.delete(key);
    }
  },
  
  // Nettoyer tous les timers
  clear() {
    this.timers.forEach(timer => clearTimeout(timer));
    this.timers.clear();
  }
};

// Fonction de sauvegarde optimisée avec debouncing
function saveMarkerManagerStateOptimized() {
  DebounceManager.debounce('markerManagerSave', () => {
    MarkerManagerDB.saveMarkerManagerState().catch(error => {
      console.warn('Erreur lors de la sauvegarde automatique du gestionnaire:', error);
    });
  }, 3000); // 3 secondes au lieu de 1.5
}

// Cache pour les marqueurs sur la carte
const MapMarkersCache = {
  markers: new Set(),
  lastUpdate: 0,
  
  // Ajouter un marqueur au cache
  add(marker) {
    this.markers.add(marker);
    this.lastUpdate = Date.now();
  },
  
  // Supprimer un marqueur du cache
  remove(marker) {
    this.markers.delete(marker);
    this.lastUpdate = Date.now();
  },
  
  // Obtenir tous les marqueurs
  getAll() {
    return Array.from(this.markers);
  },
  
  // Vérifier si le cache est à jour
  isUpToDate() {
    return Date.now() - this.lastUpdate < 1000; // Cache valide 1 seconde
  },
  
  // Synchroniser avec le tableau markers global
  sync() {
    if (!this.isUpToDate()) {
      this.markers.clear();
      markers.forEach(marker => this.markers.add(marker));
      this.lastUpdate = Date.now();
    }
  },
  
  // Nettoyer le cache
  clear() {
    this.markers.clear();
    this.lastUpdate = 0;
  }
};

// Fonction optimisée pour obtenir les marqueurs de la carte
function getMapMarkersOptimized() {
  MapMarkersCache.sync();
  return MapMarkersCache.getAll();
}

// Système d'optimisation des animations
const AnimationOptimizer = {
  // Utiliser requestAnimationFrame pour les animations fluides
  animate(callback) {
    return requestAnimationFrame(callback);
  },
  
  // Debounce pour les animations coûteuses
  debounceAnimation(key, callback, delay = 16) { // 16ms = 60fps
    DebounceManager.debounce(`anim_${key}`, callback, delay);
  },
  
  // Optimiser les transitions CSS
  optimizeTransitions() {
    // Désactiver les transitions pendant les opérations lourdes
    document.body.style.transition = 'none';
    
    // Réactiver après un court délai
    setTimeout(() => {
      document.body.style.transition = '';
    }, 100);
  },
  
  // Utiliser will-change pour optimiser les animations
  setWillChange(element, property) {
    if (element && element.style) {
      element.style.willChange = property;
      
      // Nettoyer will-change après l'animation
      setTimeout(() => {
        if (element.style) {
          element.style.willChange = 'auto';
        }
      }, 300);
    }
  }
};

// Fonction optimisée pour les mises à jour de la sidebar
function updateSidebarSectionsOptimized() {
  // Optimiser les transitions
  AnimationOptimizer.optimizeTransitions();
  
  // Utiliser le cache DOM
  const sidebar = DOMCache.get('sidebar');
  const sidebarContent = sidebar ? sidebar.querySelector('.sidebar-content') : null;
  
  if (!sidebarContent) return;
  
  // Utiliser DocumentFragment pour optimiser les insertions DOM
  const fragment = document.createDocumentFragment();
  
  // Créer les sections de manière optimisée
  CrisisMapper.sections.sort((a, b) => a.order - b.order).forEach(section => {
    const sectionElement = createSectionElement(section);
    fragment.appendChild(sectionElement);
  });
  
  // Remplacer le contenu en une seule opération
  sidebarContent.innerHTML = '';
  sidebarContent.appendChild(fragment);
  
  // Restaurer les images après reconstruction
  restoreImagesFromAddedImages();
  
  // Nettoyer le cache DOM
  DOMCache.clear();
}

// Fonction pour créer un élément de section de manière optimisée
function createSectionElement(section) {
  const sectionDiv = document.createElement('div');
  sectionDiv.className = 'section';
  sectionDiv.style.marginTop = '0.5em';
  
  // Créer le titre
  const sectionTitle = document.createElement('h2');
  sectionTitle.textContent = section.name;
  sectionTitle.className = 'section-title';
  
  // Créer le menu déroulant
  const customSelect = document.createElement('div');
  customSelect.className = 'custom-select';
  customSelect.id = section.menuId;
  
  const selectedOption = document.createElement('div');
  selectedOption.className = 'selected-option';
  selectedOption.innerHTML = '<span class="no-img">-- Sélectionner --</span>';
  
  const optionsContainer = document.createElement('div');
  optionsContainer.className = 'options';
  optionsContainer.style.display = 'none';
  optionsContainer.innerHTML = '<div class="option" data-path=""><span class="no-img">-- Sélectionner --</span></div>';
  
  customSelect.appendChild(selectedOption);
  customSelect.appendChild(optionsContainer);
  sectionDiv.appendChild(sectionTitle);
  sectionDiv.appendChild(customSelect);
  
  // Configurer les événements
  setupCustomSelect(customSelect);
  
  return sectionDiv;
}

// === SYSTÈME DE MESSAGES PERSONNALISÉS ===

// Système de messages personnalisés pour remplacer les popups du navigateur
const CustomMessages = {
  // Fonction pour afficher un message d'information
  info: function(message, title = 'Information') {
    this.showMessage(message, title, 'info', false);
  },
  
  // Fonction pour afficher un message de succès
  success: function(message, title = 'Succès') {
    this.showMessage(message, title, 'success', false);
  },
  
  // Fonction pour afficher un message d'avertissement
  warning: function(message, title = 'Avertissement') {
    this.showMessage(message, title, 'warning', false);
  },
  
  // Fonction pour afficher un message d'erreur
  error: function(message, title = 'Erreur') {
    this.showMessage(message, title, 'error', false);
  },
  
  // Fonction pour afficher une confirmation
  confirm: function(message, title = 'Confirmation', callback) {
    this.showMessage(message, title, 'confirm', true, callback);
  },
  
  // Fonction principale pour afficher les messages
  showMessage: function(message, title, type, isConfirm = false, callback = null) {
    // Supprimer les modales existantes
    const existingModals = document.querySelectorAll('.custom-message-modal');
    existingModals.forEach(modal => modal.remove());
    
    const modal = document.createElement('div');
    modal.className = 'custom-message-modal';
    modal.style.cssText = `
      position: fixed; top: 0; left: 0; width: 100%; height: 100%;
      background: rgba(0,0,0,0.8); z-index: 10000; display: flex;
      align-items: center; justify-content: center; font-family: Arial, sans-serif;
    `;
    
    const dialog = document.createElement('div');
    dialog.style.cssText = `
      background: white; padding: 30px; border-radius: 10px; box-shadow: 0 10px 30px rgba(0,0,0,0.5);
      max-width: 500px; text-align: center; position: relative;
    `;
    
    // Définir les couleurs et icônes selon le type
    let icon, bgColor, textColor;
    switch(type) {
      case 'success':
        icon = '✅';
        bgColor = '#4CAF50';
        textColor = 'white';
        break;
      case 'warning':
        icon = '⚠️';
        bgColor = '#FF9800';
        textColor = 'white';
        break;
      case 'error':
        icon = '❌';
        bgColor = '#f44336';
        textColor = 'white';
        break;
      case 'confirm':
        icon = '❓';
        bgColor = '#2196F3';
        textColor = 'white';
        break;
      case 'info':
      default:
        icon = 'ℹ️';
        bgColor = '#2196F3';
        textColor = 'white';
        break;
    }
    
    const buttonsHtml = isConfirm ? `
      <div style="display: flex; gap: 10px; justify-content: center; margin-top: 30px;">
        <button id="confirmYes" style="
          background: #4CAF50; color: white; border: none; padding: 12px 24px;
          border-radius: 5px; cursor: pointer; font-size: 14px; font-weight: bold;
        ">Oui</button>
        <button id="confirmNo" style="
          background: #f44336; color: white; border: none; padding: 12px 24px;
          border-radius: 5px; cursor: pointer; font-size: 14px; font-weight: bold;
        ">Non</button>
      </div>
    ` : `
      <div style="margin-top: 30px;">
        <button id="messageOk" style="
          background: ${bgColor}; color: ${textColor}; border: none; padding: 12px 24px;
          border-radius: 5px; cursor: pointer; font-size: 14px; font-weight: bold;
        ">OK</button>
      </div>
    `;
    
    dialog.innerHTML = `
      <div style="font-size: 48px; margin-bottom: 20px;">${icon}</div>
      <h3 style="margin-top: 0; color: #333; font-size: 20px;">${title}</h3>
      <p style="margin: 20px 0; color: #666; line-height: 1.5; font-size: 16px;">
        ${message}
      </p>
      ${buttonsHtml}
    `;
    
    modal.appendChild(dialog);
    document.body.appendChild(modal);
    
    // Gestionnaires d'événements
    if (isConfirm) {
      document.getElementById('confirmYes').addEventListener('click', function() {
        modal.remove();
        if (callback) callback(true);
      });
      
      document.getElementById('confirmNo').addEventListener('click', function() {
        modal.remove();
        if (callback) callback(false);
      });
    } else {
      document.getElementById('messageOk').addEventListener('click', function() {
        modal.remove();
      });
    }
    
    // Gestionnaire pour les touches clavier
    const handleKeyPress = (e) => {
      if (e.key === 'Escape') {
        modal.remove();
        document.removeEventListener('keydown', handleKeyPress);
        if (isConfirm && callback) callback(false);
      } else if (e.key === 'Enter') {
        // Entrée = clic sur "Oui" pour les confirmations, ou "OK" pour les autres
        if (isConfirm) {
          const confirmYesBtn = document.getElementById('confirmYes');
          if (confirmYesBtn) {
            confirmYesBtn.click();
          }
        } else {
          const messageOkBtn = document.getElementById('messageOk');
          if (messageOkBtn) {
            messageOkBtn.click();
          }
        }
      }
    };
    document.addEventListener('keydown', handleKeyPress);
  }
};

// Désactiver complètement les popups natifs du navigateur
window.alert = function(message) {
  CustomMessages.info(message, 'Information');
};

window.confirm = function(message) {
  return new Promise((resolve) => {
    CustomMessages.confirm(message, 'Confirmation', (result) => {
      resolve(result);
    });
  });
};

// Désactiver les popups de confirmation natifs
window.onbeforeunload = null;

// Gestionnaire principal pour détecter les tentatives de fermeture/rafraîchissement
window.addEventListener('beforeunload', function(event) {
  if (hasMarkersOnMap()) {
    // Utiliser uniquement le popup natif du navigateur
    event.preventDefault();
    event.returnValue = 'Vos modifications non sauvegardées seront perdues.';
    return 'Vos modifications non sauvegardées seront perdues.';
  }
});

// === SYSTÈME DE CONFIRMATION DE FERMETURE SIMPLIFIÉ ===

// Fonction pour vérifier s'il y a des marqueurs sur la carte
function hasMarkersOnMap() {
  return markers && markers.length > 0;
}


// Gestionnaire pour les raccourcis clavier
document.addEventListener('keydown', function(event) {
  // Ctrl+S pour sauvegarder
  if (event.ctrlKey && event.key === 's') {
    event.preventDefault();
    if (hasMarkersOnMap()) {
      try {
        exportProject();
        CustomMessages.success('Projet sauvegardé avec succès !');
      } catch (error) {
        CustomMessages.error('Erreur lors de la sauvegarde: ' + error.message);
      }
    } else {
      CustomMessages.warning('Aucun marqueur àsauvegarder.');
    }
  }
  
  // F5 ou Ctrl+R pour rafraîchir - laisser le navigateur gérer l'avertissement
  // Pas de prévention d'événement, le beforeunload s'occupera de l'avertissement
});