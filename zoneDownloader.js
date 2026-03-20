// zoneDownloader.js

const ZD_TILE_SIZE = 256;
let loadedZoneKmlFeatures = [];
let kmlResources = { images: {} };

// Cache pour la librairie chargée dynamiquement (JSON)
let cachedIconLibrary = null;

// --- GESTION DES POIS UTILISATEUR ---
let userPOIs = [];
let isAddingPoint = false;
let poiMarkersLayer = null;

// =============================================================================
// INITIALISATION ET LISTENERS
// =============================================================================

document.addEventListener('DOMContentLoaded', () => {
    
    // 1. GESTION DU PANEL 5 (Choix des carroyages - EXCLUSIF)
    const gridRadios = document.querySelectorAll('input[name="zone-grid-choice"]');
    const cadoOptions = document.getElementById('zone-cado-options');

    const updateCadoVisibility = () => {
        const selected = document.querySelector('input[name="zone-grid-choice"]:checked');
        if (selected && selected.value === 'cado') {
            cadoOptions.classList.remove('hidden');
        } else {
            cadoOptions.classList.add('hidden');
        }
    };

    if (gridRadios.length > 0) {
        gridRadios.forEach(radio => {
            radio.addEventListener('change', updateCadoVisibility);
        });
        updateCadoVisibility();
    }

    // 2. GESTION DU PANEL 7 (Bouton Export Fichier Vectoriel / Raster DJI)
    const formatRadios = document.querySelectorAll('input[name="zone-file-format"]');
    const exportBtn = document.getElementById('generate-zone-vector-button');
    
    if (exportBtn) {
        const updateBtnText = () => {
            const fmt = document.querySelector('input[name="zone-file-format"]:checked').value;
            if (fmt === 'MBTILES') exportBtn.textContent = "Générer l'overlay DJI (.mbtiles)";
            else exportBtn.textContent = `Générer le fichier ${fmt}`;
        };

        if (formatRadios.length > 0) {
            formatRadios.forEach(radio => {
                radio.addEventListener('change', updateBtnText);
            });
            updateBtnText();
        }
        exportBtn.addEventListener('click', handleZoneVectorExport);
    }
    
    // 3. GESTION DU PANEL 6 (Bouton Image)
    const imgBtn = document.getElementById('generate-zone-png-button');
    if (imgBtn) {
        const newBtn = imgBtn.cloneNode(true);
        if (imgBtn.parentNode) {
            imgBtn.parentNode.replaceChild(newBtn, imgBtn);
            newBtn.addEventListener('click', generateZonePNG);
        }
    }
    
    // 4. Initialisation des composants graphiques
    if (typeof initVisualIconSelector === 'function') {
        setTimeout(initVisualIconSelector, 500);
    }
});

// =============================================================================
// GESTION DE LA BIBLIOTHEQUE D'ICONES
// =============================================================================

function getIconsSync() {
    let finalIcons = [];
    const storedCustom = localStorage.getItem('userIcons');
    if (storedCustom) {
        try {
            const customIcons = JSON.parse(storedCustom);
            customIcons.forEach(icon => { icon.path = ['00_Mes Icônes']; });
            finalIcons = finalIcons.concat(customIcons);
        } catch(e) { console.error("Erreur lecture localstorage icons:", e); }
    }
    if (typeof ICON_CATALOG !== 'undefined') {
        finalIcons = finalIcons.concat(ICON_CATALOG);
    }
    return finalIcons;
}
window.getIconLibrary = getIconsSync;

// =============================================================================
// LOGIQUE DE SELECTION VISUELLE
// =============================================================================

function initVisualIconSelector() {
    const visualContainer = document.getElementById('poi-visual-selector');
    const hiddenInput = document.getElementById('poi-type-selector');
    const categoryFilter = document.getElementById('poi-category-filter');
    initIconScaler();
    if (!visualContainer || !hiddenInput) return;
    const allIcons = getIconsSync();
    visualContainer.innerHTML = '';
    visualContainer.className = 'tree-view-container custom-scrollbar'; 
    if (allIcons.length === 0) {
        visualContainer.innerHTML = '<p class="text-sm text-gray-500 text-center p-4">Aucune icône disponible.</p>';
        return;
    }
    if (categoryFilter) {
        const categories = new Set();
        allIcons.forEach(icon => {
            const catStr = Array.isArray(icon.path) ? icon.path.join(' > ') : (icon.category || 'Divers');
            categories.add(catStr.replace(/\d+_/, '')); 
        });
        categoryFilter.innerHTML = '<option value="all">Toutes les catégories</option>';
        Array.from(categories).sort().forEach(cat => {
            const opt = document.createElement('option');
            opt.value = cat;
            opt.textContent = cat;
            categoryFilter.appendChild(opt);
        });
        categoryFilter.onchange = (e) => {
            if (e.target.value === 'all') renderFullTree(allIcons, visualContainer, hiddenInput);
            else renderFilteredGrid(allIcons, e.target.value, visualContainer, hiddenInput);
        };
    }
    renderFullTree(allIcons, visualContainer, hiddenInput);
}

function initIconScaler() {
    const slider = document.getElementById('poi-icon-scale');
    const label = document.getElementById('poi-icon-scale-label');
    if (slider && label) {
        const newSlider = slider.cloneNode(true);
        slider.parentNode.replaceChild(newSlider, slider);
        newSlider.addEventListener('input', (e) => {
            label.textContent = `${e.target.value}x`;
            updatePOIMarkers();
        });
    }
}

function renderFullTree(icons, container, inputElement) {
    container.innerHTML = ''; 
    const treeData = buildTreeFromFlatList(icons);
    const rootUl = document.createElement('ul');
    rootUl.className = 'tree-root';
    renderTreeNodes(treeData, rootUl, inputElement);
    container.appendChild(rootUl);
}

function renderFilteredGrid(icons, categoryString, container, inputElement) {
    container.innerHTML = '';
    const gridDiv = document.createElement('div');
    gridDiv.className = 'icon-grid-container'; 
    const filtered = icons.filter(icon => {
        const catStr = Array.isArray(icon.path) ? icon.path.join(' > ') : (icon.category || '');
        return catStr.replace(/\d+_/, '') === categoryString;
    });
    filtered.forEach(icon => {
        const item = document.createElement('div');
        item.className = 'icon-selection-item';
        if (inputElement.value === icon.id) item.classList.add('selected');
        item.innerHTML = `<img src="${icon.url}" loading="lazy"><span>${icon.label}</span>`;
        item.onclick = () => {
            document.querySelectorAll('.icon-selection-item').forEach(el => el.classList.remove('selected'));
            item.classList.add('selected');
            inputElement.value = icon.id;
        };
        gridDiv.appendChild(item);
    });
    container.appendChild(gridDiv);
}

function buildTreeFromFlatList(icons) {
    const root = {};
    icons.forEach(icon => {
        let pathParts = [];
        if (Array.isArray(icon.path)) { pathParts = icon.path; } 
        else if (icon.category) { pathParts = icon.category.replace(/\\/g, '/').split('/'); } 
        else { pathParts = ['Divers']; }
        let currentLevel = root;
        pathParts.forEach((part, index) => {
            const cleanPart = part.trim();
            if (!currentLevel[cleanPart]) currentLevel[cleanPart] = { __name: cleanPart, __children: {}, __files: [] };
            if (index === pathParts.length - 1) currentLevel[cleanPart].__files.push(icon);
            else currentLevel = currentLevel[cleanPart].__children;
        });
    });
    return root;
}

function renderTreeNodes(nodeDict, parentElement, inputElement) {
    const sortedKeys = Object.keys(nodeDict).sort();
    sortedKeys.forEach(key => {
        const node = nodeDict[key];
        const li = document.createElement('li');
        const details = document.createElement('details');
        if (key === 'Racine' && parentElement.className.includes('tree-root')) details.open = true;
        const displayName = node.__name.replace(/^\d+_/, '');
        const summary = document.createElement('summary');
        summary.innerHTML = `<span class="folder-icon">📁</span> <span class="folder-name">${displayName}</span>`;
        summary.addEventListener('click', function(e) {
            if (!details.open) {
                const siblings = parentElement.querySelectorAll(':scope > li > details[open]');
                siblings.forEach(sib => { if (sib !== details) sib.removeAttribute('open'); });
            }
        });
        details.appendChild(summary);
        const ul = document.createElement('ul');
        if (Object.keys(node.__children).length > 0) renderTreeNodes(node.__children, ul, inputElement);
        if (node.__files.length > 0) {
            node.__files.sort((a, b) => a.label.localeCompare(b.label));
            node.__files.forEach(icon => {
                const fileLi = document.createElement('li');
                fileLi.className = 'file-item';
                if (inputElement.value === icon.id) fileLi.classList.add('selected');
                fileLi.innerHTML = `<div class="icon-preview-wrapper"><img src="${icon.url}" loading="lazy" alt="${icon.label}" title="${icon.label}"></div><span class="icon-label">${icon.label}</span>`;
                fileLi.addEventListener('click', (e) => {
                    e.stopPropagation();
                    document.querySelectorAll('.tree-view-container .file-item.selected').forEach(el => el.classList.remove('selected'));
                    fileLi.classList.add('selected');
                    inputElement.value = icon.id;
                });
                ul.appendChild(fileLi);
            });
        }
        if (ul.hasChildNodes()) { details.appendChild(ul); li.appendChild(details); parentElement.appendChild(li); }
    });
}

window.refreshZoneIconSelector = initVisualIconSelector;

// =============================================================================
// GESTION INTERACTION CARTE (POI)
// =============================================================================

function toggleAddPointMode() {
    isAddingPoint = !isAddingPoint;
    const mapContainer = document.getElementById('zone-interactive-map');
    if (isAddingPoint) mapContainer.style.cursor = 'crosshair';
    else mapContainer.style.cursor = '';
    return isAddingPoint;
}

function handleMapClickForPOI(e) {
    if (!isAddingPoint) return;
    const lat = e.latlng.lat;
    const lon = e.latlng.lng;
    const typeId = document.getElementById('poi-type-selector').value; 
    const name = document.getElementById('poi-name-input').value.trim();
    const allIcons = getIconsSync();
    const iconConfig = allIcons.find(i => i.id === typeId);
    const url = iconConfig ? iconConfig.url : "https://maps.google.com/mapfiles/kml/pushpin/ylw-pushpin.png";
    const poi = { id: Date.now(), lat, lon, type: typeId, name, url };
    userPOIs.push(poi);
    updatePOIMarkers();
    updatePOIList();
    toggleAddPointMode();
    const addBtn = document.getElementById('add-poi-btn');
    if (addBtn) {
        addBtn.textContent = "+ Ajouter un point";
        addBtn.classList.remove('bg-red-600', 'hover:bg-red-700');
        addBtn.classList.add('bg-blue-600', 'hover:bg-blue-700');
    }
}

function updatePOIMarkers() {
    const map = window.zoneMap; 
    if (!map) return;
    if (!poiMarkersLayer) { poiMarkersLayer = L.layerGroup().addTo(map); }
    poiMarkersLayer.clearLayers();
    const scaleInput = document.getElementById('poi-icon-scale');
    const userScale = scaleInput ? parseFloat(scaleInput.value) : 1.0;
    const finalSize = 48 * userScale;
    const anchorPos = finalSize / 2;
    userPOIs.forEach(poi => {
        const customIcon = L.icon({
            iconUrl: poi.url,
            iconSize: [finalSize, finalSize],
            iconAnchor: [anchorPos, anchorPos], 
            popupAnchor: [0, -anchorPos]
        });
        const marker = L.marker([poi.lat, poi.lon], { icon: customIcon });
        if (poi.name) marker.bindTooltip(poi.name, { permanent: true, direction: 'top', offset: [0, -(anchorPos + 5)] });
        marker.on('click', () => { if (confirm(`Supprimer le point "${poi.name || poi.type}" ?`)) removePOI(poi.id); });
        poiMarkersLayer.addLayer(marker);
    });
}

function removePOI(id) {
    userPOIs = userPOIs.filter(p => p.id !== id);
    updatePOIMarkers();
    updatePOIList();
}

function updatePOIList() {
    const tbody = document.getElementById('poi-table-body');
    const container = document.getElementById('poi-list-container');
    if (userPOIs.length === 0) { container.classList.add('hidden'); return; }
    container.classList.remove('hidden');
    tbody.innerHTML = '';
    const allIcons = getIconsSync();
    userPOIs.forEach(poi => {
        const iconDef = allIcons.find(i => i.id === poi.type);
        const label = iconDef ? iconDef.label : poi.type;
        const row = document.createElement('tr');
        row.className = "bg-white border-b dark:bg-gray-800 dark:border-gray-700";
        row.innerHTML = `
            <td class="px-2 py-1 font-medium text-gray-900 whitespace-nowrap dark:text-white text-xs text-center"><img src="${poi.url}" class="w-6 h-6 inline-block object-contain"></td>
            <td class="px-2 py-1 text-xs">${poi.name || label}</td>
            <td class="px-2 py-1 text-xs">${poi.lat.toFixed(4)}, ${poi.lon.toFixed(4)}</td>
            <td class="px-2 py-1 text-right"><button onclick="window.removePOI(${poi.id})" class="font-medium text-red-600 dark:text-red-500 hover:underline text-xs">X</button></td>
        `;
        tbody.appendChild(row);
    });
}
window.removePOI = removePOI;

// =============================================================================
// FONCTIONS UTILITAIRES / CONFIG
// =============================================================================

function getIconData(url) {
    return new Promise((resolve) => {
        if (url.startsWith('data:image')) { resolve(url); return; }
        fetch(url)
            .then(r => { if(!r.ok) throw new Error(r.status); return r.blob(); })
            .then(b => {
                const reader = new FileReader();
                reader.onloadend = () => resolve(reader.result);
                reader.readAsDataURL(b);
            })
            .catch(e => {
                const img = new Image();
                if (!url.startsWith('data:')) img.crossOrigin = "Anonymous";
                img.onload = () => {
                    const c = document.createElement('canvas');
                    c.width = img.naturalWidth || 32; c.height = img.naturalHeight || 32;
                    c.getContext('2d').drawImage(img,0,0);
                    try { resolve(c.toDataURL('image/png')); } catch(err) { resolve(null); }
                };
                img.onerror = () => resolve(null);
                img.src = url;
            });
    });
}

function loadImageForCanvas(url) {
    return new Promise((resolve) => {
        const img = new Image();
        if (!url.startsWith('data:')) img.crossOrigin = "Anonymous";
        let safeUrl = url;
        if (url.startsWith('http')) safeUrl = url + (url.includes('?') ? '&' : '?') + 't=' + Date.now();
        img.onload = () => resolve(img);
        img.onerror = () => resolve(null);
        img.src = safeUrl;
    });
}

async function drawUserPOIsOnCanvas(ctx, latLonToCanvasPixels, scaleFactor = 1) {
    const uniqueUrls = [...new Set(userPOIs.map(p => p.url))];
    const imageCache = {};
    await Promise.all(uniqueUrls.map(async (url) => {
        const img = await loadImageForCanvas(url);
        if (img) imageCache[url] = img;
    }));
    userPOIs.forEach(poi => {
        const px = latLonToCanvasPixels(poi.lat, poi.lon);
        const img = imageCache[poi.url];
        const size = 48 * scaleFactor;
        if (img) ctx.drawImage(img, px.x - size/2, px.y - size/2, size, size);
        else {
            ctx.beginPath(); ctx.arc(px.x, px.y, 10 * scaleFactor, 0, 2*Math.PI); 
            ctx.fillStyle = 'red'; ctx.fill();
        }
        if (poi.name) {
            const fontSize = 14 * scaleFactor;
            const textOffset = (size / 2) + (2 * scaleFactor);
            ctx.font = `bold ${fontSize}px Arial`;
            ctx.textAlign = "center"; ctx.textBaseline = "top";
            ctx.strokeStyle = "white"; ctx.lineWidth = 3 * scaleFactor;
            ctx.strokeText(poi.name, px.x, px.y + textOffset); 
            ctx.fillStyle = "black"; ctx.fillText(poi.name, px.x, px.y + textOffset);
        }
    });
}

function haversineDistance(p1, p2) {
    const R = 6371e3;
    const lat1Rad = toRadians(p1.lat);
    const lat2Rad = toRadians(p2.lat);
    const deltaLatRad = toRadians(p2.lat - p1.lat);
    const deltaLonRad = toRadians(p2.lon - p1.lon);
    const a = Math.sin(deltaLatRad / 2) * Math.sin(deltaLatRad / 2) + Math.cos(lat1Rad) * Math.cos(lat2Rad) * Math.sin(deltaLonRad / 2) * Math.sin(deltaLonRad / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}
function toRadians(deg) { return deg * Math.PI / 180; }

function zdCoordsToQuadKey(x, y, zoom) {
    let quadKey = '';
    for (let i = zoom; i > 0; i--) {
        let digit = 0;
        const mask = 1 << (i - 1);
        if ((y & mask) !== 0) { digit += 2; }
        if ((x & mask) !== 0) { digit += 1; }
        quadKey += digit.toString();
    }
    return quadKey;
}

function zdLatLonToWorldPixels(lat, lon, zoom) {
    const siny = Math.sin(toRadians(lat));
    const yClamped = Math.max(Math.min(siny, 0.9999), -0.9999);
    const y = 0.5 - Math.log((1 + yClamped) / (1 - yClamped)) / (4 * Math.PI);
    const x = (lon + 180) / 360;
    const mapSize = ZD_TILE_SIZE * Math.pow(2, zoom);
    return { x: x * mapSize, y: y * mapSize };
}

// CONFIGURATION CADO
function getZoneCadoConfigAndBounds() {
    const nwCoordsStr = document.getElementById("zone-nw-coords").value;
    const seCoordsStr = document.getElementById("zone-se-coords").value;
    if (!nwCoordsStr || !seCoordsStr) throw new Error("Veuillez d'abord dessiner une zone rectangulaire.");
    
    const [nwLat, nwLon] = nwCoordsStr.split(',').map(c => parseFloat(c.trim()));
    const [seLat, seLon] = seCoordsStr.split(',').map(c => parseFloat(c.trim()));

    // Lecture du Panel 5 (Nouvelle logique)
    const scale = parseFloat(document.getElementById('zone-cado-scale').value);
    if (isNaN(scale) || scale <= 0) throw new Error("L'échelle doit être un nombre positif.");
    
    const direction = document.querySelector('input[name="zone-cado-direction"]:checked').value;
    const swapAxes = document.getElementById('zone-cado-swap-axes').checked;

    const widthMeters = haversineDistance({lat: nwLat, lon: nwLon}, {lat: nwLat, lon: seLon});
    const heightMeters = haversineDistance({lat: nwLat, lon: nwLon}, {lat: seLat, lon: nwLon});
    const numCols = Math.ceil(widthMeters / scale);
    const numRows = Math.ceil(heightMeters / scale);

    if (numCols > 100 || numRows > 100) {
        throw new Error(`Le nombre de cases (${numCols}x${numRows}) est trop élevé (>100). Augmentez l'échelle ou réduisez la zone.`);
    }

    const refLat = (nwLat + seLat) / 2;
    const refLon = (nwLon + seLon) / 2;
    
    const metersToLatDegrees = (meters) => meters / 111320;
    const metersToLonDegrees = (meters, lat) => meters / (111320 * Math.cos(toRadians(lat)));
    
    const xOffsetMeters = (numCols / 2) * scale;
    const yOffsetMeters = (numRows / 2) * scale;
    
    const a1CornerLon = refLon - metersToLonDegrees(xOffsetMeters, refLat);
    let a1CornerLat;
    if (direction === 'ascending') {
        a1CornerLat = refLat - metersToLatDegrees(yOffsetMeters);
    } else {
        a1CornerLat = refLat + metersToLatDegrees(yOffsetMeters);
    }
    
    const config = {
        latitude: refLat,
        longitude: refLon,
        scale: scale,
        lineWidth: parseInt(document.getElementById('common-grid-thickness').value, 10) || 1,
        letteringDirection: direction,
        gridColor: document.getElementById('utm-grid-color').value,
        colorName: document.getElementById('utm-grid-color-name').value,
        colorOpacity: (100 - parseInt(document.getElementById('utm-transparency').value)) / 100,
        gridNameBase: document.getElementById("zone-export-filename").value || "Carroyage CADO",
        gridName: document.getElementById("zone-export-filename").value || "Carroyage CADO",
        deviation: 0,
        labelSize: 1.2,
        iconSize: 1.0,
        referencePointChoice: 'no_cross', 
        startRow: 1, endRow: numRows,
        startCol: 'A', endCol: numberToLetter(numCols),
        includeGrid: true, includePoints: true,
        swapAxes: swapAxes,
        outputFormat: 'KMZ'
    };

    const gridCorners = [
        calculateAndRotatePoint(config.startRow, 1, config, a1CornerLat, a1CornerLon),
        calculateAndRotatePoint(numCols + 1, 1, config, a1CornerLat, a1CornerLon),
        calculateAndRotatePoint(1, numRows + 1, config, a1CornerLat, a1CornerLon),
        calculateAndRotatePoint(numCols + 1, numRows + 1, config, a1CornerLat, a1CornerLon)
    ].map(p => ({ lon: p[0], lat: p[1] }));

    const gridBounds = {
        minLat: Math.min(...gridCorners.map(c => c.lat)),
        maxLat: Math.max(...gridCorners.map(c => c.lat)),
        minLon: Math.min(...gridCorners.map(c => c.lon)),
        maxLon: Math.max(...gridCorners.map(c => c.lon))
    };

    return { config, gridBounds, a1CornerLat, a1CornerLon };
}

// =============================================================================
// GENERATION IMAGE (PNG/JPEG)
// =============================================================================

async function generateZonePNG() {
    const loadingIndicator = document.getElementById("loading-indicator");
    const loadingMessage = document.getElementById("loading-message");
    const upscaleEnabled = document.getElementById('zone-enable-upscale').checked;
    
    // LECTURE DU PANEL 5
    const gridChoiceEl = document.querySelector('input[name="zone-grid-choice"]:checked');
    const gridChoice = gridChoiceEl ? gridChoiceEl.value : 'none';

    const useUtm = (gridChoice === 'utm');
    const useCfsi = (gridChoice === 'cfsi');
    const useCado = (gridChoice === 'cado');

    loadingMessage.textContent = "Préparation de l'export de la zone...";
    loadingIndicator.classList.remove("hidden");
    hideError();

    try {
        let cadoData = null;
        let finalBoundingBox;

        const nwCoordsStr = document.getElementById("zone-nw-coords").value;
        const seCoordsStr = document.getElementById("zone-se-coords").value;
        const [north, west] = nwCoordsStr.split(',').map(c => parseFloat(c.trim()));
        const [south, east] = seCoordsStr.split(',').map(c => parseFloat(c.trim()));
        
        const baseThickness = parseInt(document.getElementById('common-grid-thickness').value, 10) || 1;

        if(useCado) {
            cadoData = getZoneCadoConfigAndBounds();
            const { config, gridBounds } = cadoData;
            const avgLat = (gridBounds.minLat + gridBounds.maxLat) / 2;
            const metersToLat = (meters) => meters / 111320;
            const metersToLon = (meters, lat) => meters / (111320 * Math.cos(toRadians(lat)));

            finalBoundingBox = {
                north: gridBounds.maxLat + metersToLat(0.5 * config.scale),
                south: gridBounds.minLat - metersToLat(1.0 * config.scale),
                west: gridBounds.minLon - metersToLon(1.0 * config.scale, avgLat),
                east: gridBounds.maxLon + metersToLon(0.5 * config.scale, avgLat)
            };
        } else {
            finalBoundingBox = { north, west, south, east };
        }

        const zoom = parseInt(document.getElementById("zone-info-zoom").textContent, 10);
        const mapLayerName = document.getElementById("zone-info-layer").textContent;
        const selectedMap = MAP_LAYERS.find(m => m.name === mapLayerName);
        if (!selectedMap) throw new Error("Impossible de trouver la configuration du fond de carte.");
        
        const format = document.querySelector('input[name="image-format-zone"]:checked').value;
        const quality = parseInt(document.getElementById('zone-jpeg-quality').value) / 100;
        const mimeType = format === 'jpeg' ? 'image/jpeg' : 'image/png';
        const fileExtension = format === 'jpeg' ? '.jpg' : '.png';

        loadingMessage.textContent = "Téléchargement et assemblage des fonds de carte...";
        
        // CORRECTION : Seul le mode UTM nécessite une marge blanche externe pour les labels
        const needsExternalMargin = useUtm;
        
        // 1. Fond de Carte (Tuiles) - Z-INDEX 1
        const { finalCanvas, dynamicMargin, scaleFactor } = await zdCreateFinalCanvas(finalBoundingBox, zoom, selectedMap, needsExternalMargin, upscaleEnabled);
        const ctx = finalCanvas.getContext('2d');
        
        const nwPixel = zdLatLonToWorldPixels(finalBoundingBox.north, finalBoundingBox.west, zoom);
        
        const latLonToCanvasPixels = (lat, lon) => {
            const worldPixels = zdLatLonToWorldPixels(lat, lon, zoom);
            return {
                x: (worldPixels.x - nwPixel.x) * scaleFactor + dynamicMargin,
                y: (worldPixels.y - nwPixel.y) * scaleFactor + dynamicMargin
            };
        };
        
        if (cadoData) {
            cadoData.config.lineWidth = cadoData.config.lineWidth * scaleFactor;
        }

        // 2. DESSIN DES GRILLES - Z-INDEX 2
        
        if (useUtm) {
            loadingMessage.textContent = "Dessin de la grille UTM...";
            const cartoucheFontSize = Math.max(10 * scaleFactor, Math.min(48 * scaleFactor, finalCanvas.width * 0.007));
            await drawUtmGridOnCanvas(ctx, finalBoundingBox, latLonToCanvasPixels, dynamicMargin, cartoucheFontSize, baseThickness * scaleFactor);
        }
        
        if (useCfsi) {
            loadingMessage.textContent = "Dessin du carroyage CFSI...";
            const cfsiFontSize = Math.max(10 * scaleFactor, finalCanvas.width * 0.006); 
            // Note : dynamicMargin sera à 0 ici, ce qui est correct pour CFSI (pas de marge externe)
            await drawCfsiGridOnCanvas(ctx, finalBoundingBox, latLonToCanvasPixels, dynamicMargin, cfsiFontSize, baseThickness * scaleFactor);
        }

        if (useCado && cadoData) {
            loadingMessage.textContent = "Dessin du carroyage CADO...";
            const { config, a1CornerLat, a1CornerLon } = cadoData;
            drawCadoElementsOnCanvas(ctx, config, latLonToCanvasPixels, [a1CornerLon, a1CornerLat]);
            config.lineWidth = config.lineWidth / scaleFactor;
        }

        // 3. DESSIN DES TRACES (LINESTRING) KML - Z-INDEX 3
        if (loadedZoneKmlFeatures.length > 0) {
            loadingMessage.textContent = "Dessin des Traces KML...";
            const lineFeatures = loadedZoneKmlFeatures.filter(f => f.type === 'LineString');
            if (lineFeatures.length > 0) drawZoneKmlFeatures(ctx, zoom, lineFeatures, latLonToCanvasPixels);
        }

        // 4. DESSIN DES ZONES (POLYGON) KML - Z-INDEX 4
        if (loadedZoneKmlFeatures.length > 0) {
            loadingMessage.textContent = "Dessin des Zones KML...";
            const polyFeatures = loadedZoneKmlFeatures.filter(f => f.type === 'Polygon');
            if (polyFeatures.length > 0) drawZoneKmlFeatures(ctx, zoom, polyFeatures, latLonToCanvasPixels);
        }

        // 5. DESSIN DES POINTS (KML + POI USER) - Z-INDEX 5
        if (loadedZoneKmlFeatures.length > 0) {
            loadingMessage.textContent = "Dessin des Points KML...";
            const pointFeatures = loadedZoneKmlFeatures.filter(f => f.type === 'Point');
            if (pointFeatures.length > 0) drawZoneKmlFeatures(ctx, zoom, pointFeatures, latLonToCanvasPixels);
        }

        if (userPOIs.length > 0) {
            loadingMessage.textContent = "Dessin des points d'intérêt...";
            const userScaleInput = document.getElementById('poi-icon-scale');
            const userScalePreference = userScaleInput ? parseFloat(userScaleInput.value) : 1.0;
            await drawUserPOIsOnCanvas(ctx, latLonToCanvasPixels, scaleFactor * userScalePreference);
        }

        // FINITIONS (CARTOUCHE)
        if (!useCado) {
            loadingMessage.textContent = "Finalisation de l'image...";
            const userTitle = document.getElementById("zone-export-filename").value || "Zone";
            
            if (useUtm) {
                const cartoucheFontSize = Math.max(10 * scaleFactor, Math.min(48 * scaleFactor, finalCanvas.width * 0.007));
                const cartoucheTitle = `Export de ${userTitle}_zoom ${zoom}`;
                const cartoucheMetrics = drawZoneCartouche(ctx, cartoucheTitle, finalBoundingBox, mapLayerName, zoom, dynamicMargin, cartoucheFontSize);
                drawZoneCompass(ctx, finalCanvas.width, finalCanvas.height, dynamicMargin, cartoucheMetrics);
            } else {
                // Pour CFSI ou Aucun
                const compassRadius = Math.max(10 * scaleFactor, finalCanvas.width * 0.012); 
                const padding = compassRadius * 0.8; 
                const compassCenterX = finalCanvas.width - dynamicMargin - padding - compassRadius;
                const compassCenterY = dynamicMargin + padding + compassRadius;
                const compassFontSize = compassRadius * 0.9; 
                drawSimpleCompass(ctx, compassCenterX, compassCenterY, compassRadius, compassFontSize);

                const avgLat = (north + south) / 2;
                const realWidthMeters = haversineDistance({lat: avgLat, lon: west}, {lat: avgLat, lon: east});
                const mapPixelWidth = finalCanvas.width - (2 * dynamicMargin);
                const metersPerPixel = realWidthMeters / mapPixelWidth; 

                const scaleBarMargin = (dynamicMargin === 0) ? 20 * scaleFactor : 0;
                drawSmartScaleBar(ctx, finalCanvas.width, finalCanvas.height, scaleBarMargin, metersPerPixel);
            }
        }
        
        const TARGET_EXPORT_HEIGHT = 2160;
        let exportCanvas = finalCanvas;
        if (upscaleEnabled && finalCanvas.height < TARGET_EXPORT_HEIGHT) {
            const exportScale = TARGET_EXPORT_HEIGHT / finalCanvas.height;
            const exportWidth = Math.round(finalCanvas.width * exportScale);

            const scaledCanvas = document.createElement('canvas');
            scaledCanvas.width = exportWidth;
            scaledCanvas.height = TARGET_EXPORT_HEIGHT;
            const scaledCtx = scaledCanvas.getContext('2d');

            scaledCtx.fillStyle = 'white';
            scaledCtx.fillRect(0, 0, scaledCanvas.width, scaledCanvas.height);
            scaledCtx.imageSmoothingEnabled = true;
            scaledCtx.imageSmoothingQuality = 'high';
            scaledCtx.drawImage(finalCanvas, 0, 0, scaledCanvas.width, scaledCanvas.height);
            exportCanvas = scaledCanvas;
        }

        const now = new Date();
        const dateStr = `${String(now.getDate()).padStart(2, '0')}.${String(now.getMonth() + 1).padStart(2, '0')}.${now.getFullYear()}`;

        let gridTypeStr = "Map";
        if (useCado) gridTypeStr += "_CADO";
        if (useUtm) gridTypeStr += "_UTM";
        if (useCfsi) gridTypeStr += "_CFSI";

        let rawTitle = document.getElementById("zone-export-filename").value || "Export";
        if (!rawTitle.startsWith("Export")) rawTitle = `Export_${rawTitle}`;
        const fileName = `${rawTitle}_zoom${zoom}_${gridTypeStr}_${dateStr}${fileExtension}`;
        
        exportCanvas.toBlob((blob) => {
            if (blob) { downloadFile(blob, fileName); } 
            else { 
                showError("Erreur lors de la création du fichier image."); 
            }
        }, mimeType, quality);
    } catch (error) {
        console.error("Erreur image:", error);
        showError(error.message);
    } finally {
        loadingIndicator.classList.add("hidden");
    }
}

// =============================================================================
// GENERATION VECTORIELLE (KMZ/KML/GPX/GeoJSON) - PANEL 7
// =============================================================================

async function handleZoneVectorExport() {
    const loadingIndicator = document.getElementById("loading-indicator");
    const loadingMessage = document.getElementById("loading-message");
    
    // Récupération des choix
    const gridChoiceEl = document.querySelector('input[name="zone-grid-choice"]:checked');
    const gridChoice = gridChoiceEl ? gridChoiceEl.value : 'none';

    const useUtm = (gridChoice === 'utm');
    const useCfsi = (gridChoice === 'cfsi');
    const useCado = (gridChoice === 'cado');
    
    const format = document.querySelector('input[name="zone-file-format"]:checked').value; 
    const filenameBase = document.getElementById('zone-export-filename').value || "Export_Zone";

    if (!useUtm && !useCfsi && !useCado && userPOIs.length === 0 && format !== 'MBTILES') {
        if (!confirm("Aucune grille sélectionnée. Voulez-vous exporter uniquement les points d'intérêt ?")) {
            return;
        }
    }

    loadingMessage.textContent = `Génération du fichier ${format}...`;
    loadingIndicator.classList.remove("hidden");
    hideError();

    try {
        // --- CAS SPECIAL : EXPORT DJI MBTILES (RASTER TRANSPARENT) ---
        if (format === 'MBTILES') {
            await generateZoneMBTiles(filenameBase, useUtm, useCfsi, useCado);
            return; // STOP ICI
        }

        // --- CAS CLASSIQUE : EXPORT VECTORIEL (KML/KMZ/GPX) ---
        let kmlFolders = "";
        const zip = new JSZip();
        const imagesToZip = new Map();

        // 1. GENERATION DES DOSSIERS KML
        if (useUtm) {
            kmlFolders += await generateUtmKmlFolder();
        }
        if (useCfsi) {
            kmlFolders += await generateCfsiKmlFolder();
        }
        if (useCado) {
            kmlFolders += await generateCadoKmlFolder(imagesToZip, format === 'KMZ');
        }
        if (userPOIs.length > 0) {
            kmlFolders += await generatePoiKmlFolder(userPOIs, imagesToZip, format === 'KMZ');
        }

        // 2. CONSTRUCTION KML GLOBAL
        const colorHex = document.getElementById('utm-grid-color').value || "#000000";
        const opacityVal = (100 - parseInt(document.getElementById('utm-transparency').value || 30)) / 100;
        const kmlColor = rgbToKmlColor(colorHex, opacityVal);
        const kmlLabelColor = rgbToKmlColor(colorHex, 1.0);
        // Couleur CFSI secondaire
        const kmlColorMinor = rgbToKmlColor(colorHex, opacityVal * 0.6);

        let kmlContent = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>${filenameBase}</name>
    <Style id="commonLineStyle"><LineStyle><color>${kmlColor}</color><width>2</width></LineStyle><IconStyle><scale>0</scale></IconStyle></Style>
    <Style id="commonLabelStyle"><IconStyle><scale>0</scale></IconStyle><LabelStyle><scale>0.8</scale><color>${kmlLabelColor}</color></LabelStyle></Style>
    
    <Style id="cfsi100kLine"><LineStyle><color>${kmlColor}</color><width>4</width></LineStyle></Style>
    <Style id="cfsi20kLine"><LineStyle><color>${kmlColor}</color><width>3</width></LineStyle></Style>
    <Style id="cfsi2kLine"><LineStyle><color>${kmlColor}</color><width>2</width></LineStyle></Style>
    <Style id="cfsi100mLine"><LineStyle><color>${kmlColorMinor}</color><width>1</width></LineStyle></Style>
    <Style id="cfsiText"><IconStyle><scale>0</scale></IconStyle><LabelStyle><color>${kmlLabelColor}</color><scale>0.9</scale></LabelStyle></Style>

    ${kmlFolders}
  </Document>
</kml>`;

        // 3. EXPORT
        if (format === 'KMZ') {
            zip.file("doc.kml", kmlContent);
            for (const [path, data] of imagesToZip) {
                zip.file(path, data, {base64: true});
            }
            const blob = await zip.generateAsync({ type: "blob", mimeType: 'application/vnd.google-earth.kmz' });
            downloadFile(blob, `${filenameBase}.kmz`);
        } 
        else if (format === 'KML') {
            const blob = new Blob([kmlContent], { type: "application/vnd.google-earth.kml+xml" });
            downloadFile(blob, `${filenameBase}.kml`);
        }
        else if (format === 'GeoJSON' || format === 'GPX') {
            if (useCado) {
                 const { config } = getZoneCadoConfigAndBounds();
                 const gridData = calculateGridData(config); 
                 
                 if (format === 'GeoJSON') {
                     const json = generateGeoJSON(config, gridData); 
                     const blob = new Blob([json], { type: "application/geo+json" });
                     downloadFile(blob, `${filenameBase}.geojson`);
                 } else { 
                     const gpx = generateGPX(config, gridData); 
                     const blob = new Blob([gpx], { type: "application/gpx+xml" });
                     downloadFile(blob, `${filenameBase}.gpx`);
                 }
            } else {
                alert("L'export GeoJSON/GPX n'est implémenté complètement que pour le carroyage CADO. Veuillez sélectionner CADO ou utiliser KMZ.");
            }
        }

    } catch (e) {
        console.error(e);
        alert("Erreur lors de l'export vecteur : " + e.message);
    } finally {
        loadingIndicator.classList.add("hidden");
    }
}

// --- NOUVELLE FONCTION : GENERATE ZONE MBTILES (OVERLAY TRANSPARENT) ---
async function generateZoneMBTiles(filename, useUtm, useCfsi, useCado) {
    if (typeof window.initSqlJs !== 'function') {
        throw new Error("La librairie SQL.js n'est pas chargée.");
    }
    
    // Check si carroyageToMbtiles.js est chargé
    if (typeof generateMbtilesProcess !== 'function') {
        throw new Error("Module MBTiles manquant (carroyageToMbtiles.js).");
    }

    const zoom = parseInt(document.getElementById("zone-info-zoom").textContent, 10);

    // 1. Bbox
    const nwCoordsStr = document.getElementById("zone-nw-coords").value;
    const seCoordsStr = document.getElementById("zone-se-coords").value;
    const [north, west] = nwCoordsStr.split(',').map(c => parseFloat(c.trim()));
    const [south, east] = seCoordsStr.split(',').map(c => parseFloat(c.trim()));
    
    // --- CORRECTION BUG 1 : BBOX "LARGE" POUR CADO ---
    // On doit s'assurer que la Bbox couvre bien toute la grille (qui peut déborder du rectangle user)
    // Et on ajoute un buffer généreux pour que les traits ne soient pas coupés.
    let boundingBox = { north, west, south, east };
    
    if(useCado) {
        const cadoData = getZoneCadoConfigAndBounds();
        const { config, gridBounds } = cadoData;
        const avgLat = (gridBounds.minLat + gridBounds.maxLat) / 2;
        const mToLat = meters => meters / 111320;
        const mToLon = (meters, lat) => meters / (111320 * Math.cos(toRadians(lat)));
        
        // BUFFER 2.0x Scale pour être large
        boundingBox = {
            north: gridBounds.maxLat + mToLat(2.0 * config.scale),
            south: gridBounds.minLat - mToLat(2.0 * config.scale),
            west: gridBounds.minLon - mToLon(2.0 * config.scale, avgLat),
            east: gridBounds.maxLon + mToLon(2.0 * config.scale, avgLat)
        };
    } else {
        // Buffer standard pour UTM/CFSI
        const buffer = 0.005; 
        boundingBox.north += buffer;
        boundingBox.south -= buffer;
        boundingBox.west -= buffer;
        boundingBox.east += buffer;
    }

    // 2. Appel au générateur dédié (dans carroyageToMbtiles.js)
    // On lui passe null pour optionalCadoData, il le recalculera depuis l'UI Zone si nécessaire
    const finalBlob = await generateMbtilesProcess(
        filename, 
        useUtm, 
        useCfsi, 
        useCado, 
        boundingBox, 
        zoom, 
        window.userPOIs
    );

    // 3. Téléchargement
    downloadFile(finalBlob, `${filename}.mbtiles`);
}

// --- GENERATEURS DE DOSSIERS KML ---

async function generateUtmKmlFolder() {
    const nwCoordsStr = document.getElementById("zone-nw-coords").value;
    const seCoordsStr = document.getElementById("zone-se-coords").value;
    const [nwLat, nwLon] = nwCoordsStr.split(',').map(c => parseFloat(c.trim()));
    const [seLat, seLon] = seCoordsStr.split(',').map(c => parseFloat(c.trim()));

    const startZone = WGS84_to_UTM.fromLatLon(nwLat, nwLon).zoneNumber;
    const endZone = WGS84_to_UTM.fromLatLon(seLat, seLon).zoneNumber;
    let kml = "<Folder><name>Grille UTM</name>";

    for (let zone = startZone; zone <= endZone; zone++) {
        const zoneBoundaryLeft = (zone - 1) * 6 - 180;
        const zoneBoundaryRight = zone * 6 - 180;
        const clipLonStart = Math.max(nwLon, zoneBoundaryLeft);
        const clipLonEnd = Math.min(seLon, zoneBoundaryRight);
        if (clipLonStart >= clipLonEnd) continue;

        const gridData = calculateGridForZoneStrip(nwLat, clipLonStart, seLat, clipLonEnd, zone);
        
        [...gridData.eastingLines, ...gridData.northingLines].forEach(line => {
             kml += `
             <Placemark>
                <name>${line.name}</name>
                <styleUrl>#commonLineStyle</styleUrl>
                <LineString><coordinates>${line.coordinates.map(c=>c.join(',')).join(' ')}</coordinates></LineString>
             </Placemark>`;
        });
    }
    kml += "</Folder>";
    return kml;
}

async function generateCfsiKmlFolder() {
    const nwCoordsStr = document.getElementById("zone-nw-coords").value;
    const seCoordsStr = document.getElementById("zone-se-coords").value;
    const [north, west] = nwCoordsStr.split(',').map(c => parseFloat(c.trim()));
    const [south, east] = seCoordsStr.split(',').map(c => parseFloat(c.trim()));

    // Conversion en Lambert II Etendu
    const nwL2 = CFSI_UTILS.wgs84ToL2E(north, west);
    const seL2 = CFSI_UTILS.wgs84ToL2E(south, east);

    // Arrondis aux limites 100m
    const lMinX = Math.floor(Math.min(nwL2.x, seL2.x) / 100) * 100;
    const lMaxX = Math.ceil(Math.max(nwL2.x, seL2.x) / 100) * 100;
    const lMinY = Math.floor(Math.min(nwL2.y, seL2.y) / 100) * 100;
    const lMaxY = Math.ceil(Math.max(nwL2.y, seL2.y) / 100) * 100;

    let folder100k = "<Folder><name>Lignes 100km</name>";
    let folder20k = "<Folder><name>Lignes 20km</name>";
    let folder2km = "<Folder><name>Lignes 2km</name>";
    // Visibilité masquée par défaut pour 100m (trop lourd)
    let folder100m = "<Folder><name>Lignes 100m</name><visibility>0</visibility>";
    
    let folderLabels2km = "<Folder><name>Labels 2km</name>";
    let folderLabels100m = "<Folder><name>Labels 100m</name><visibility>0</visibility>"; // Masqué par défaut

    const lines100k = [], lines20k = [], lines2k = [], lines100m = [];
    const labs2k = [], labs100m = [];

    // --- Génération des lignes X ---
    for (let x = lMinX; x <= lMaxX; x += 100) {
        let style = '#cfsi100mLine';
        let targetArr = lines100m;

        if (x % 100000 === 0) { style = '#cfsi100kLine'; targetArr = lines100k; }
        else if (x % 20000 === 0) { style = '#cfsi20kLine'; targetArr = lines20k; }
        else if (x % 2000 === 0) { style = '#cfsi2kLine'; targetArr = lines2k; }

        const pStart = CFSI_UTILS.l2EToWgs84(x, lMinY);
        const pEnd = CFSI_UTILS.l2EToWgs84(x, lMaxY);
        
        targetArr.push(`<Placemark><styleUrl>${style}</styleUrl><LineString><coordinates>${pStart.lon},${pStart.lat},0 ${pEnd.lon},${pEnd.lat},0</coordinates></LineString></Placemark>`);
    }

    // --- Génération des lignes Y ---
    for (let y = lMinY; y <= lMaxY; y += 100) {
        let style = '#cfsi100mLine';
        let targetArr = lines100m;

        if (y % 100000 === 0) { style = '#cfsi100kLine'; targetArr = lines100k; }
        else if (y % 20000 === 0) { style = '#cfsi20kLine'; targetArr = lines20k; }
        else if (y % 2000 === 0) { style = '#cfsi2kLine'; targetArr = lines2k; }

        const pStart = CFSI_UTILS.l2EToWgs84(lMinX, y);
        const pEnd = CFSI_UTILS.l2EToWgs84(lMaxX, y);
        
        targetArr.push(`<Placemark><styleUrl>${style}</styleUrl><LineString><coordinates>${pStart.lon},${pStart.lat},0 ${pEnd.lon},${pEnd.lat},0</coordinates></LineString></Placemark>`);
    }

    // --- Génération des Labels ---
    for (let x = lMinX; x < lMaxX; x += 100) {
        for (let y = lMinY; y < lMaxY; y += 100) {
            
            const centerX = x + 50;
            const centerY = y + 50;
            
            // Le centre 2km d'un carré [X, X+2000] est à X+1000.
            const isCenter2k = ((centerX - 1000) % 2000 === 0) && ((centerY - 1000) % 2000 === 0);
            
            const comps = CFSI_UTILS.getComponentsFromLambert(centerX, centerY);
            
            if (comps) {
                const centerGeo = CFSI_UTILS.l2EToWgs84(centerX, centerY);
                
                if (isCenter2k) {
                    labs2k.push(`
                    <Placemark>
                        <name>${comps.full2k}</name>
                        <styleUrl>#cfsiText</styleUrl>
                        <Point><coordinates>${centerGeo.lon},${centerGeo.lat},0</coordinates></Point>
                    </Placemark>`);
                }
                
                // Labels 100m complets
                labs100m.push(`
                <Placemark>
                    <name>${comps.full2k} ${comps.c100m}</name>
                    <styleUrl>#cfsiText</styleUrl>
                    <Point><coordinates>${centerGeo.lon},${centerGeo.lat},0</coordinates></Point>
                </Placemark>`);
            }
        }
    }

    folder100k += lines100k.join("") + "</Folder>";
    folder20k += lines20k.join("") + "</Folder>";
    folder2km += lines2k.join("") + "</Folder>";
    folder100m += lines100m.join("") + "</Folder>";
    folderLabels2km += labs2k.join("") + "</Folder>";
    folderLabels100m += labs100m.join("") + "</Folder>";

    return `<Folder><name>Grille CFSI</name>
        <Folder><name>Lignes</name>${folder100k}${folder20k}${folder2km}${folder100m}</Folder>
        <Folder><name>Labels</name>${folderLabels2km}${folderLabels100m}</Folder>
    </Folder>`;
}

async function generateCadoKmlFolder(imagesToZip, isKmz) {
    const { config } = getZoneCadoConfigAndBounds();
    const gridData = calculateGridData(config); 
    
    let kml = "<Folder><name>Grille CADO</name>";
    
    gridData.horizontalLines.concat(gridData.verticalLines).forEach(line => {
        kml += `<Placemark><name>${line.name}</name><styleUrl>#commonLineStyle</styleUrl><LineString><coordinates>${line.points.map(p=>p.join(',')).join(' ')}</coordinates></LineString></Placemark>`;
    });

    if (config.includePoints) {
        const canvas = document.createElement("canvas");
        canvas.width = 64; canvas.height = 64;
        const ctx = canvas.getContext("2d");
        ctx.font = "bold 24px Arial"; ctx.textAlign = "center"; ctx.textBaseline = "middle";

        for (const point of gridData.points) {
            ctx.clearRect(0, 0, 64, 64);
            ctx.fillStyle = config.gridColor;
            ctx.fillText(point.name, 32, 32);
            if(config.gridColor.toUpperCase() === "#FFFFFF") ctx.strokeText(point.name, 32, 32);
            
            const iconName = `cado_${point.name}.png`;
            if (isKmz) {
                const dataUrl = canvas.toDataURL("image/png");
                imagesToZip.set(`icons/${iconName}`, dataUrl.split(',')[1]);
                kml += `
                <Placemark>
                    <name>${point.name}</name>
                    <Style><IconStyle><scale>1.0</scale><Icon><href>icons/${iconName}</href></Icon></IconStyle><LabelStyle><scale>0</scale></LabelStyle></Style>
                    <Point><coordinates>${point.coordinates.join(',')}</coordinates></Point>
                </Placemark>`;
            } else {
                 kml += `<Placemark><name>${point.name}</name><styleUrl>#commonLabelStyle</styleUrl><Point><coordinates>${point.coordinates.join(',')}</coordinates></Point></Placemark>`;
            }
        }
    }
    kml += "</Folder>";
    return kml;
}

async function generatePoiKmlFolder(pois, imagesToZip, isKmz) {
    let kml = "<Folder><name>Points d'intérêt</name>";
    const allIcons = window.getIconLibrary ? window.getIconLibrary() : [];

    for (const [index, poi] of pois.entries()) {
        let iconUrl = "https://maps.google.com/mapfiles/kml/paddle/wht-blank.png";
        const iconDef = allIcons.find(i => i.id === poi.type);
        if (iconDef) iconUrl = iconDef.url;
        if (poi.url) iconUrl = poi.url;

        let href = iconUrl;
        if (isKmz && !iconUrl.startsWith('http') && window.getIconDataGlobal) {
            const iconFilename = `poi_${index}.png`;
            const base64Data = await window.getIconDataGlobal(iconUrl);
            if (base64Data) {
                imagesToZip.set(`files/${iconFilename}`, base64Data.split(',')[1]);
                href = `files/${iconFilename}`;
            }
        }

        kml += `
        <Placemark>
            <name>${poi.name || poi.type}</name>
            <Style><IconStyle><scale>1.2</scale><Icon><href>${href}</href></Icon></IconStyle></Style>
            <Point><coordinates>${poi.lon},${poi.lat},0</coordinates></Point>
        </Placemark>`;
    }
    kml += "</Folder>";
    return kml;
}

// =============================================================================
// FONCTIONS CANEVAS / HELPERS
// =============================================================================

async function zdCreateFinalCanvas(boundingBox, zoom, mapConfig, externalMargin, upscaleEnabled = true) {
    const nwPx = zdLatLonToWorldPixels(boundingBox.north, boundingBox.west, zoom);
    const sePx = zdLatLonToWorldPixels(boundingBox.south, boundingBox.east, zoom);
    
    const natW = Math.abs(sePx.x - nwPx.x);
    const natH = Math.abs(sePx.y - nwPx.y);
    
    const TARGET = 3840; // 4K
    let scale = 1;
    if (upscaleEnabled) {
        const maxDim = Math.max(natW, natH);
        if (maxDim < TARGET) {
            scale = TARGET / maxDim;
            scale = Math.min(scale, 16); 
        }
    }
    
    console.log(`[ZONE] Native: ${Math.round(natW)}x${Math.round(natH)} | Zoom: ${zoom} | Scale: ${scale}`);

    const finalW = Math.round(natW * scale);
    const finalH = Math.round(natH * scale);
    
    let margin = 0;
    if (externalMargin) {
        margin = Math.ceil(Math.max(10 * scale, Math.min(48 * scale, finalW * 0.007)) * 4);
    }

    const tempC = document.createElement('canvas'); 
    tempC.width = natW; 
    tempC.height = natH;
    const tempCtx = tempC.getContext('2d');
    
    const finalC = document.createElement('canvas'); 
    finalC.width = finalW + margin * 2; 
    finalC.height = finalH + margin * 2;
    const ctx = finalC.getContext('2d');
    
    ctx.fillStyle = 'white'; 
    ctx.fillRect(0,0,finalC.width, finalC.height);
    ctx.imageSmoothingEnabled = true; 
    ctx.imageSmoothingQuality = 'high';

    const nwTile = { x: Math.floor(nwPx.x / ZD_TILE_SIZE), y: Math.floor(nwPx.y / ZD_TILE_SIZE) };
    const seTile = { x: Math.floor(sePx.x / ZD_TILE_SIZE), y: Math.floor(sePx.y / ZD_TILE_SIZE) };
    
    for (const layer of mapConfig.layers) {
        const promises = [];
        for (let x = nwTile.x; x <= seTile.x; x++) {
            for (let y = nwTile.y; y <= seTile.y; y++) {
                let url;
                if (layer.type === 'quadkey') {
                    const q = zdCoordsToQuadKey(x,y,zoom);
                    url = layer.url.replace('{q}', q).replace('{s}', (x+y)%4);
                } else {
                    url = layer.url.replace('{z}', zoom).replace('{x}', x).replace('{y}', y);
                }
                const safeUrl = url + (url.includes('?') ? '&' : '?') + 't=' + Date.now();
                promises.push(new Promise(r => {
                    const i = new Image(); i.crossOrigin = "Anonymous";
                    i.onload = () => r({i, x, y, ok:true});
                    i.onerror = () => r({ok:false});
                    i.src = safeUrl;
                }));
            }
        }
        
        (await Promise.all(promises)).forEach(res => {
            if (res.ok) {
                const destX = Math.floor((res.x * ZD_TILE_SIZE) - nwPx.x);
                const destY = Math.floor((res.y * ZD_TILE_SIZE) - nwPx.y);
                tempCtx.drawImage(res.i, destX, destY, ZD_TILE_SIZE + 1, ZD_TILE_SIZE + 1);
            }
        });
    }
    
    ctx.drawImage(tempC, margin, margin, finalW, finalH);
    return { finalCanvas: finalC, dynamicMargin: margin, scaleFactor: scale };
}

function drawZoneCartouche(ctx, title, bbox, layerName, zoom, margin, fontSize) {
    const PADDING = fontSize;
    const lineSpacing = fontSize * 1.3;
    const utmNW = WGS84_to_UTM.fromLatLon(bbox.north, bbox.west);
    const utmSE = WGS84_to_UTM.fromLatLon(bbox.south, bbox.east);
    const utmNW_string = `${utmNW.zoneNumber}${utmNW.zoneLetter} ${Math.round(utmNW.easting)} E ${Math.round(utmNW.northing)} N`;
    const utmSE_string = `${utmSE.zoneNumber}${utmSE.zoneLetter} ${Math.round(utmSE.easting)} E ${Math.round(utmSE.northing)} N`;
    const texts = [ title, `UTM NO: ${utmNW_string}`, `UTM SE: ${utmSE_string}`, `Fond: ${layerName} (Zoom ${zoom})`];
    ctx.font = `${fontSize}px Arial`;
    const cartoucheWidth = Math.max(...texts.map(text => ctx.measureText(text).width)) + (PADDING * 2);
    const cartoucheHeight = (lineSpacing * texts.length) - (lineSpacing - fontSize) + (PADDING * 2);
    const cartoucheX = margin + PADDING;
    const cartoucheY = margin + PADDING;
    ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
    ctx.fillRect(cartoucheX, cartoucheY, cartoucheWidth, cartoucheHeight);
    ctx.strokeStyle = 'black';
    ctx.lineWidth = 1;
    ctx.strokeRect(cartoucheX, cartoucheY, cartoucheWidth, cartoucheHeight);
    ctx.fillStyle = 'black';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    let textY = cartoucheY + PADDING;
    for (const text of texts) {
        ctx.fillText(text, cartoucheX + PADDING, textY);
        textY += lineSpacing;
    }
    return { fontSize, cartoucheHeight };
}

function drawZoneCompass(ctx, canvasWidth, canvasHeight, margin, cartoucheMetrics) {
    const radius = Math.max(20, (cartoucheMetrics.cartoucheHeight * 0.75) / 2);
    const PADDING = radius * 1.6; 
    const centerX = canvasWidth - margin - PADDING;
    const centerY = margin + PADDING;
    const compassFontSize = radius * 0.6;
    drawSimpleCompass(ctx, centerX, centerY, radius, compassFontSize);
}

function drawSimpleCompass(ctx, x, y, radius, fontSize) {
    ctx.save();
    ctx.translate(x, y);
    ctx.beginPath();
    ctx.arc(0, 0, radius, 0, 2 * Math.PI, false);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
    ctx.fill();
    ctx.strokeStyle = 'black';
    ctx.lineWidth = 1;
    ctx.stroke();

    const arrowLen = radius * 0.9;
    const arrowWidth = radius * 0.25;

    ctx.beginPath();
    ctx.moveTo(0, -arrowLen);
    ctx.lineTo(arrowWidth, 0);
    ctx.lineTo(-arrowWidth, 0);
    ctx.closePath();
    ctx.fillStyle = 'red';
    ctx.fill();
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(0, arrowLen);
    ctx.lineTo(arrowWidth, 0);
    ctx.lineTo(-arrowWidth, 0);
    ctx.closePath();
    ctx.fillStyle = 'white';
    ctx.fill();
    ctx.stroke();

    ctx.font = `bold ${radius * 0.6}px Arial`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.lineWidth = radius * 0.15; 
    ctx.strokeStyle = 'white';
    ctx.lineJoin = 'round';
    ctx.strokeText('N', 0, -arrowLen - (radius * 0.1));
    ctx.fillStyle = 'black';
    ctx.fillText('N', 0, -arrowLen - (radius * 0.1));

    ctx.restore();
}

function drawSmartScaleBar(ctx, canvasWidth, canvasHeight, margin, metersPerPixel) {
    const targetWidthPx = canvasWidth * 0.04;
    const rawMeters = targetWidthPx * metersPerPixel;
    const magnitude = Math.pow(10, Math.floor(Math.log10(rawMeters)));
    const residual = rawMeters / magnitude;
    let roundedMeters;
    if (residual < 1.5) roundedMeters = 1 * magnitude;
    else if (residual < 3.5) roundedMeters = 2 * magnitude;
    else if (residual < 7.5) roundedMeters = 5 * magnitude;
    else roundedMeters = 10 * magnitude;
    
    const finalBarWidthPx = roundedMeters / metersPerPixel;
    const barHeight = Math.max(14, canvasHeight * 0.015);
    const fontSize = barHeight * 0.9;
    const padding = barHeight * 0.5;
    
    const x = margin + padding;
    const y = canvasHeight - margin - barHeight - padding;
    
    ctx.fillStyle = 'yellow';
    ctx.strokeStyle = 'black';
    ctx.lineWidth = 2;
    
    ctx.beginPath();
    ctx.rect(x, y, finalBarWidthPx, barHeight);
    ctx.fill();
    ctx.stroke();
    
    ctx.fillStyle = 'black';
    ctx.font = `bold ${fontSize}px Arial`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const label = roundedMeters >= 1000 ? `${roundedMeters/1000} km` : `${roundedMeters} m`;
    ctx.fillText(label, x + (finalBarWidthPx / 2), y + (barHeight / 2));
}

function setupZoneAddressSearch() {
    const input = document.getElementById('zone-address-search-input');
    const list = document.getElementById('zone-suggestions');
    let timer;

    input.addEventListener('input', () => {
        if (input.value.trim().length < 3) { list.classList.add('hidden'); return; }
        clearTimeout(timer);
        timer = setTimeout(async () => {
            list.innerHTML = '';
            let found = false;
            try {
                const r = await fetch(`https://api-adresse.data.gouv.fr/search/?q=${encodeURIComponent(input.value)}&limit=5`);
                const d = await r.json();
                if (d.features?.length) {
                    found = true;
                    d.features.forEach(f => {
                        const li = document.createElement('li');
                        li.textContent = f.properties.label;
                        li.onclick = () => {
                            input.value = f.properties.label;
                            list.classList.add('hidden');
                            window.zoneMap.flyTo([f.geometry.coordinates[1], f.geometry.coordinates[0]], 15);
                        };
                        list.appendChild(li);
                    });
                }
            } catch(e){}

            if (!found) {
                try {
                    const r = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(input.value)}&limit=5`);
                    const d = await r.json();
                    d.forEach(f => {
                        const li = document.createElement('li');
                        li.textContent = f.display_name;
                        li.onclick = () => {
                            input.value = f.display_name;
                            list.classList.add('hidden');
                            window.zoneMap.flyTo([parseFloat(f.lat), parseFloat(f.lon)], 15);
                        };
                        list.appendChild(li);
                    });
                } catch(e){}
            }
            if (list.children.length > 0) list.classList.remove('hidden');
            else list.classList.add('hidden');

        }, 300);
    });
    
    document.addEventListener('click', (e) => {
        if (!input.contains(e.target) && !list.contains(e.target)) {
            list.classList.add('hidden');
        }
    });
}

async function handleZoneKmzFile(event) {
    const file = event.target.files[0];
    loadedZoneKmlFeatures = [];
    kmlResources = { images: {} };
    if (!file) return;

    try {
        const loadingMessage = document.getElementById("loading-message");
        loadingMessage.textContent = "Lecture du fichier KML/KMZ...";
        document.getElementById("loading-indicator").classList.remove("hidden");

        const zip = file.name.toLowerCase().endsWith('.kmz') ? await JSZip.loadAsync(file) : null;
        const kmlFile = zip ? zip.file(/(\.kml)$/i)[0] : null;
        const kmlText = zip ? await kmlFile.async("string") : await file.text();
        const parser = new DOMParser();
        const kmlDoc = parser.parseFromString(kmlText, "text/xml");

        const sharedStyles = parseSharedKmlStyles(kmlDoc);
        const placemarksData = parseKmlPlacemarksFromDoc(kmlDoc, sharedStyles);

        if (zip) {
            loadingMessage.textContent = "Chargement des icônes...";
            await loadKmlIcons(placemarksData, zip);
        }

        loadedZoneKmlFeatures = placemarksData;
        alert(`${loadedZoneKmlFeatures.length} élément(s) KML ont été chargé(s) avec succès.`);

    } catch (error) {
        console.error("Erreur lors du chargement du fichier KML/KMZ:", error);
        showError("Impossible de lire le fichier. " + error.message);
    } finally {
        document.getElementById("loading-indicator").classList.add("hidden");
    }
}

function parseSharedKmlStyles(kmlDoc) {
    const styles = {};
    const styleElements = kmlDoc.querySelectorAll('Document > Style, Document > StyleMap');

    styleElements.forEach(styleEl => {
        const styleId = '#' + styleEl.getAttribute('id');
        if (styleEl.tagName === 'StyleMap') {
            const normalPair = Array.from(styleEl.querySelectorAll('Pair')).find(
                p => p.querySelector('key')?.textContent === 'normal'
            );
            const styleUrl = normalPair?.querySelector('styleUrl')?.textContent;
            if (styleUrl) styles[styleId] = { isMap: true, normalUrl: styleUrl };
        } else {
            styles[styleId] = parseStyleElement(styleEl);
        }
    });

    Object.values(styles).forEach(style => {
        if (style.isMap && styles[style.normalUrl]) Object.assign(style, styles[style.normalUrl]);
    });
    return styles;
}

function parseStyleElement(styleEl) {
    const style = {};
    const iconStyle = styleEl.querySelector('IconStyle');
    const labelStyle = styleEl.querySelector('LabelStyle');
    const lineStyle = styleEl.querySelector('LineStyle');
    const polyStyle = styleEl.querySelector('PolyStyle');

    if (iconStyle) {
        style.iconUrl = iconStyle.querySelector('Icon > href')?.textContent || null;
        style.iconScale = parseFloat(iconStyle.querySelector('scale')?.textContent || 1.0);
    }
    if (labelStyle) {
        style.labelColor = kmlColorToCss(labelStyle.querySelector('color')?.textContent || 'ffffffff');
    }
    if (lineStyle) {
        style.lineColor = kmlColorToCss(lineStyle.querySelector('color')?.textContent || 'ff0000ff');
        style.lineWidth = parseFloat(lineStyle.querySelector('width')?.textContent || 2);
    }
    if (polyStyle) {
        style.polyColor = kmlColorToCss(polyStyle.querySelector('color')?.textContent || '7f0000ff'); // Semi-transparent par défaut
        // Bugfix: Si fill ou outline ne sont pas présents, ils sont true par défaut en KML.
        // On ne les met à false que si c'est explicitement '0'.
        style.polyFill = polyStyle.querySelector('fill')?.textContent !== '0';
        style.polyOutline = polyStyle.querySelector('outline')?.textContent !== '0';
    }
    return style;
}

function parseKmlPlacemarksFromDoc(kmlDoc, sharedStyles) {
    const features = [];
    kmlDoc.querySelectorAll('Placemark').forEach(placemark => {
        const name = placemark.querySelector('name')?.textContent || '';
        let style = {};
        const styleUrl = placemark.querySelector('styleUrl')?.textContent;
        const inlineStyleEl = placemark.querySelector('Style');

        if (styleUrl && sharedStyles[styleUrl]) style = sharedStyles[styleUrl];
        else if (inlineStyleEl) style = parseStyleElement(inlineStyleEl);

        const point = placemark.getElementsByTagName('Point')[0];
        const lineString = placemark.getElementsByTagName('LineString')[0];
        const polygon = placemark.getElementsByTagName('Polygon')[0];

        if (point) {
            const coordsStr = point.getElementsByTagName('coordinates')[0]?.textContent.trim();
            if (coordsStr) {
                const [lon, lat] = coordsStr.split(',').map(parseFloat);
                features.push({ type: 'Point', name, style, coordinates: [lon, lat] });
            }
        } else if (lineString) {
            const coordsStr = lineString.getElementsByTagName('coordinates')[0]?.textContent.trim();
            if (coordsStr) {
                const coordinates = coordsStr.split(/\s+/).map(c => c.split(',').map(parseFloat));
                features.push({ type: 'LineString', name, style, coordinates });
            }
        } else if (polygon) {
            // BUGFIX ZONES : Gestion des namespaces et structures variées
            const outerBoundary = polygon.getElementsByTagName('outerBoundaryIs')[0];
            if (outerBoundary) {
                const ring = outerBoundary.getElementsByTagName('LinearRing')[0];
                if(ring) {
                    const coordsEl = ring.getElementsByTagName('coordinates')[0];
                    if (coordsEl) {
                        const coordsStr = coordsEl.textContent.trim();
                        // Supporte les séparateurs espace ou retour à la ligne
                        const coordinates = coordsStr.split(/\s+/).map(c => c.split(',').map(parseFloat));
                        features.push({ type: 'Polygon', name, style, coordinates });
                    }
                }
            }
        }
    });
    return features;
}

async function loadKmlIcons(placemarksData, zip) {
    const iconPromises = [];
    const loadedUrls = new Set();
    placemarksData.forEach(feature => {
        if (feature.type === 'Point' && feature.style?.iconUrl && !loadedUrls.has(feature.style.iconUrl)) {
            const iconUrl = feature.style.iconUrl;
            loadedUrls.add(iconUrl);
            let promise;
            if (iconUrl.startsWith('http')) {
                promise = new Promise((resolve) => {
                    const img = new Image();
                    img.crossOrigin = "Anonymous";
                    img.onload = () => { kmlResources.images[iconUrl] = img; resolve(); };
                    img.onerror = () => { resolve(); };
                    img.src = iconUrl;
                });
            } else if (zip) {
                const iconFile = zip.file(iconUrl);
                if (iconFile) {
                    promise = iconFile.async('base64').then(base64 => {
                        return new Promise((resolve) => {
                            const img = new Image();
                            img.onload = () => { kmlResources.images[iconUrl] = img; resolve(); };
                            img.onerror = () => resolve();
                            img.src = 'data:image/png;base64,' + base64;
                        });
                    });
                }
            }
            if (promise) iconPromises.push(promise);
        }
    });
    await Promise.all(iconPromises);
}

function kmlColorToCss(kmlColor) {
    if (!kmlColor || kmlColor.length !== 8) return 'rgba(255,255,255,1)';
    const a = parseInt(kmlColor.substring(0, 2), 16) / 255;
    const b = kmlColor.substring(2, 4);
    const g = kmlColor.substring(4, 6);
    const r = kmlColor.substring(6, 8);
    return `rgba(${parseInt(r, 16)}, ${parseInt(g, 16)}, ${parseInt(b, 16)}, ${a})`;
}

function getContrastingOutlineColor(rgbaColor) {
    if (!rgbaColor || !rgbaColor.startsWith('rgba')) return 'black';
    try {
        const [r, g, b] = rgbaColor.match(/\d+/g).map(Number);
        const luminance = (0.299 * r + 0.587 * g + 0.114 * b);
        return luminance > 186 ? 'black' : 'white';
    } catch (e) { return 'black'; }
}

function drawZoneKmlFeatures(ctx, zoom, features, latLonToCanvasPixels) {
    features.forEach(feature => {
        const style = feature.style || {};
        if (feature.type === 'Point') {
            const center = latLonToCanvasPixels(feature.coordinates[1], feature.coordinates[0]);
            const iconImg = style.iconUrl ? kmlResources.images[style.iconUrl] : null;
            let iconHeight = 32;
            if (iconImg && iconImg.complete && iconImg.naturalWidth > 0) {
                const scale = style.iconScale || 1.0;
                const w = iconImg.naturalWidth * scale;
                const h = iconImg.naturalHeight * scale;
                iconHeight = h;
                ctx.drawImage(iconImg, center.x - w / 2, center.y - h / 2, w, h);
            } else {
                ctx.beginPath(); ctx.arc(center.x, center.y, 6, 0, 2 * Math.PI, false);
                ctx.fillStyle = '#f0e100'; ctx.fill(); ctx.stroke();
            }
            if (feature.name) {
                const textYOffset = (iconHeight / 2) + 5;
                const labelColor = style.labelColor || 'rgba(0, 0, 0, 1)'; 
                ctx.font = `bold ${16}px Arial`; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
                ctx.strokeStyle = getContrastingOutlineColor(labelColor); ctx.lineWidth = 3;
                ctx.strokeText(feature.name, center.x, center.y + textYOffset);
                ctx.fillStyle = labelColor;
                ctx.fillText(feature.name, center.x, center.y + textYOffset);
            }
        } 
        else if (feature.type === 'LineString' && feature.coordinates.length > 1) {
            ctx.strokeStyle = style.lineColor || 'rgba(255, 0, 0, 1)';
            ctx.lineWidth = style.lineWidth || 2;
            ctx.beginPath();
            feature.coordinates.forEach((coord, index) => {
                const px = latLonToCanvasPixels(coord[1], coord[0]);
                if (index === 0) ctx.moveTo(px.x, px.y); else ctx.lineTo(px.x, px.y);
            });
            ctx.stroke();
        } 
        else if (feature.type === 'Polygon' && feature.coordinates.length > 2) {
            ctx.beginPath();
            feature.coordinates.forEach((coord, index) => {
                const px = latLonToCanvasPixels(coord[1], coord[0]);
                if (index === 0) ctx.moveTo(px.x, px.y); else ctx.lineTo(px.x, px.y);
            });
            ctx.closePath();
            
            if (style.polyFill !== false) {
                ctx.fillStyle = style.polyColor || 'rgba(255, 0, 0, 0.5)'; ctx.fill();
            }
            if (style.polyOutline !== false) {
                ctx.strokeStyle = style.lineColor || 'rgba(255, 0, 0, 1)';
                ctx.lineWidth = style.lineWidth || 2; ctx.stroke();
            }
        }
    });
}

async function drawUtmGridOnCanvas(ctx, boundingBox, latLonToCanvasPixels, margin, cartoucheFontSize, lineWidth = 1) {
    const color = document.getElementById('utm-grid-color').value;
    const opacity = (100 - parseInt(document.getElementById('utm-transparency').value)) / 100;
    const r = parseInt(color.slice(1, 3), 16), g = parseInt(color.slice(3, 5), 16), b = parseInt(color.slice(5, 7), 16);
    const gridLineColor = `rgba(${r}, ${g}, ${b}, ${opacity})`;
    const nwLat = boundingBox.north, nwLon = boundingBox.west, seLat = boundingBox.south, seLon = boundingBox.east;
    const drawingBox = { x: margin, y: margin, width: ctx.canvas.width - margin * 2, height: ctx.canvas.height - margin * 2 };
    const startZone = WGS84_to_UTM.fromLatLon(nwLat, nwLon).zoneNumber;
    const endZone = WGS84_to_UTM.fromLatLon(seLat, seLon).zoneNumber;
    const labelsToDraw = [];
    
    ctx.save();
    ctx.beginPath(); ctx.rect(drawingBox.x, drawingBox.y, drawingBox.width, drawingBox.height); ctx.clip();
    
    for (let zone = startZone; zone <= endZone; zone++) {
        const zoneBoundaryLeft = (zone - 1) * 6 - 180;
        const clipLonStart = Math.max(nwLon, zoneBoundaryLeft);
        const clipLonEnd = Math.min(seLon, zone * 6 - 180);
        if (clipLonStart >= clipLonEnd) continue;
        
        const gridData = calculateGridForZoneStrip(nwLat, clipLonStart, seLat, clipLonEnd, zone);
        const allLines = [...gridData.eastingLines, ...gridData.northingLines];

        for (const line of allLines) {
            const isMajorLine = (parseInt(line.name.split(' ')[1], 10) % 5 === 0);
            ctx.lineWidth = isMajorLine ? lineWidth * 2 : lineWidth;
            ctx.strokeStyle = gridLineColor;
            ctx.beginPath();
            let firstCanvasPoint = null, lastCanvasPoint = null;
            for (let i = 0; i < line.coordinates.length; i++) {
                const p = latLonToCanvasPixels(line.coordinates[i][1], line.coordinates[i][0]);
                if (i === 0) { ctx.moveTo(p.x, p.y); firstCanvasPoint = p; } 
                else { ctx.lineTo(p.x, p.y); }
                lastCanvasPoint = p;
            }
            ctx.stroke();
            
            if (firstCanvasPoint && lastCanvasPoint) {
                const labelText = line.name;
                if (line.type === 'easting') {
                    labelsToDraw.push({ type: 'top', anchor: { x: lastCanvasPoint.x, y: drawingBox.y }, text: labelText });
                    labelsToDraw.push({ type: 'bottom', anchor: { x: firstCanvasPoint.x, y: drawingBox.y + drawingBox.height }, text: labelText });
                } else {
                    labelsToDraw.push({ type: 'left', anchor: { x: drawingBox.x, y: firstCanvasPoint.y }, text: labelText });
                    labelsToDraw.push({ type: 'right', anchor: { x: drawingBox.x + drawingBox.width, y: lastCanvasPoint.y }, text: labelText });
                }
            }
        }
        if (zone < endZone) {
            const boundaryLon = zone * 6 - 180;
            ctx.beginPath(); ctx.strokeStyle = '#FFFF00'; ctx.lineWidth = lineWidth * 2;
            const segments = 20;
            for (let i = 0; i <= segments; i++) {
                const lat = nwLat + (i / segments) * (seLat - nwLat);
                const p = latLonToCanvasPixels(lat, boundaryLon);
                if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y);
            }
            ctx.stroke();
        }
    }
    ctx.restore();

    ctx.fillStyle = 'white';
    ctx.fillRect(0, 0, ctx.canvas.width, margin);
    ctx.fillRect(0, ctx.canvas.height - margin, ctx.canvas.width, margin);
    ctx.fillRect(0, 0, margin, ctx.canvas.height);
    ctx.fillRect(ctx.canvas.width - margin, 0, margin, ctx.canvas.height);

    ctx.fillStyle = 'black';
    ctx.font = `bold ${cartoucheFontSize * 0.75}px Arial`;
    for (const label of labelsToDraw) {
        ctx.save();
        ctx.translate(label.anchor.x, label.anchor.y);
        switch(label.type) {
            case 'top': ctx.rotate(-Math.PI / 2); ctx.textAlign = 'left'; ctx.fillText(label.text, 5, 0); break;
            case 'bottom': ctx.rotate(-Math.PI / 2); ctx.textAlign = 'right'; ctx.fillText(label.text, -5, 0); break;
            case 'left': ctx.textAlign = 'right'; ctx.fillText(label.text, -5, 0); break;
            case 'right': ctx.textAlign = 'left'; ctx.fillText(label.text, 5, 0); break;
        }
        ctx.restore();
    }
}

// --- EXPORT GLOBAL POUR UTM ---
window.getUserPOIs = function() { return userPOIs; };
window.getIconDataGlobal = getIconData;