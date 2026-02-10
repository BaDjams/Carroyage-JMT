// mbtilesMode.js

let importMap = null;
let importDrawnItems = null;
let mbtilesDB = null;
let mbtilesLayer = null;
let mbtilesMetadata = {};
let importUserPOIs = [];
let isImportAddingPoint = false;
let onlineLayerGroup = null;
let loadedImportKmlFeatures = [];
let importKmlResources = { images: {} };

// Stockage des calques de base
let importBaseMaps = {}; 

function initMbtilesMode() {
    initImportMap();
    setupImportListeners();
    setTimeout(initImportVisualIconSelector, 500);
}
window.initMbtilesMode = initMbtilesMode;

function initImportMap() {
    importMap = L.map('import-interactive-map', {
        minZoom: 1, maxZoom: 22, crs: L.CRS.EPSG3857 
    }).setView([46.2276, 2.2137], 5);
    window.importMap = importMap;

    const L_QuadKeyLayer = L.TileLayer.extend({
        getTileUrl: function (coords) {
            const x = coords.x, y = coords.y, z = coords.z;
            let quadKey = '';
            for (let i = z; i > 0; i--) {
                let digit = 0;
                const mask = 1 << (i - 1);
                if ((y & mask) !== 0) { digit += 2; }
                if ((x & mask) !== 0) { digit += 1; }
                quadKey += digit.toString();
            }
            return L.Util.template(this._url, { s: (x + y) % 4, q: quadKey, z: z });
        }
    });

    importBaseMaps = {};
    if (typeof MAP_LAYERS !== 'undefined') {
        MAP_LAYERS.forEach(layerConfig => {
            let leafletLayer;
            if (layerConfig.layers.length > 1) {
                const groupLayers = layerConfig.layers.map(l => 
                    L.tileLayer(l.url, { maxZoom: layerConfig.maxZoom || 20, attribution: layerConfig.name })
                );
                leafletLayer = L.layerGroup(groupLayers);
            } else {
                const l = layerConfig.layers[0];
                if (l.type === 'quadkey') {
                    leafletLayer = new L_QuadKeyLayer(l.url, { maxZoom: layerConfig.maxZoom || 19, attribution: layerConfig.name });
                } else {
                    leafletLayer = L.tileLayer(l.url, { maxZoom: layerConfig.maxZoom || 20, attribution: layerConfig.name });
                }
            }
            if (leafletLayer) importBaseMaps[layerConfig.name] = leafletLayer;
        });
    }

    const defaultKey = Object.keys(importBaseMaps).find(k => k.includes("Google Hybrid")) || Object.keys(importBaseMaps)[0];
    if (defaultKey && importBaseMaps[defaultKey]) {
        importBaseMaps[defaultKey].addTo(importMap);
    } else {
        L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(importMap);
    }

    L.control.layers(importBaseMaps).addTo(importMap);

    importDrawnItems = new L.FeatureGroup();
    importMap.addLayer(importDrawnItems);

    const drawControl = new L.Control.Draw({
        draw: {
            rectangle: { shapeOptions: { color: '#f59e0b', weight: 3 } }, 
            polyline: false, polygon: false, circle: false, marker: false, circlemarker: false
        },
        edit: { featureGroup: importDrawnItems }
    });
    importMap.addControl(drawControl);

    importMap.on(L.Draw.Event.CREATED, (e) => {
        importDrawnItems.clearLayers();
        importDrawnItems.addLayer(e.layer);
        updateImportZoneCoords(e.layer.getBounds());
    });
    importMap.on(L.Draw.Event.EDITED, (e) => e.layers.eachLayer(l => updateImportZoneCoords(l.getBounds())));
    importMap.on(L.Draw.Event.DELETED, () => {
        document.getElementById('import-nw-coords').value = '';
        document.getElementById('import-se-coords').value = '';
        updateImportTileInfo();
    });

    importMap.on('zoomend', () => {
        const zoom = importMap.getZoom();
        document.getElementById('import-info-current-zoom').textContent = zoom;
        updateImportTitleOnZoomChange(zoom);
        updateImportTileInfo();
    });

    importMap.on('click', (e) => {
        if (isImportAddingPoint) addImportPOI(e.latlng);
    });

    setupImportAddressSearch();
}

function updateImportTitleOnZoomChange(zoom) {
    const titleInput = document.getElementById('import-zone-title');
    let currentTitle = titleInput.value;
    if (currentTitle.includes("_zoom ")) {
        titleInput.value = currentTitle.replace(/_zoom \d+/, `_zoom ${zoom}`);
    }
}

function updateImportZoneCoords(bounds) {
    const nw = bounds.getNorthWest();
    const se = bounds.getSouthEast();
    document.getElementById('import-nw-coords').value = `${nw.lat.toFixed(6)}, ${nw.lng.toFixed(6)}`;
    document.getElementById('import-se-coords').value = `${se.lat.toFixed(6)}, ${se.lng.toFixed(6)}`;
    
    const widthMeters = haversineDistance({lat: nw.lat, lon: nw.lng}, {lat: nw.lat, lon: se.lng});
    if (widthMeters > 0) {
        document.getElementById('import-cado-scale').value = Math.max(1, Math.round(widthMeters / 26));
    }
    updateImportTileInfo();
}

function updateImportTileInfo() {
    const nwStr = document.getElementById('import-nw-coords').value;
    const seStr = document.getElementById('import-se-coords').value;
    const spanTiles = document.getElementById('import-info-tiles');
    
    if (!nwStr || !seStr) {
        spanTiles.textContent = "0 (Dessinez une zone)";
        return;
    }
    const [nwLat, nwLon] = nwStr.split(',').map(parseFloat);
    const [seLat, seLon] = seStr.split(',').map(parseFloat);
    const zoom = importMap.getZoom();
    const n = Math.pow(2, zoom);
    const x1 = Math.floor((nwLon + 180) / 360 * n);
    const y1 = Math.floor((1 - Math.log(Math.tan(nwLat * Math.PI / 180) + 1 / Math.cos(nwLat * Math.PI / 180)) / Math.PI) / 2 * n);
    const x2 = Math.floor((seLon + 180) / 360 * n);
    const y2 = Math.floor((1 - Math.log(Math.tan(seLat * Math.PI / 180) + 1 / Math.cos(seLat * Math.PI / 180)) / Math.PI) / 2 * n);
    const cols = Math.abs(x2 - x1) + 1;
    const rows = Math.abs(y2 - y1) + 1;
    spanTiles.textContent = `${cols} x ${rows} (${cols * rows})`;
}

function setupImportListeners() {
    document.getElementById('mbtiles-file').addEventListener('change', handleMBTilesLoad);
    document.getElementById('import-kmz-input').addEventListener('change', handleImportKmzLoad);

    const chkCado = document.getElementById('import-overlay-cado');
    const chkUtm = document.getElementById('import-overlay-utm');
    const optCado = document.getElementById('import-cado-options');

    chkCado.addEventListener('change', (e) => {
        optCado.classList.toggle('hidden', !e.target.checked);
        if(e.target.checked) chkUtm.checked = false;
    });
    chkUtm.addEventListener('change', (e) => {
        if(e.target.checked) {
            chkCado.checked = false;
            optCado.classList.add('hidden');
        }
    });

    document.getElementById('import-btn-png').addEventListener('click', generateImportPNG);
    
    document.getElementById('import-add-poi-btn').addEventListener('click', () => {
        isImportAddingPoint = !isImportAddingPoint;
        const btn = document.getElementById('import-add-poi-btn');
        document.getElementById('import-interactive-map').style.cursor = isImportAddingPoint ? 'crosshair' : '';
        btn.textContent = isImportAddingPoint ? "Annuler l'ajout" : "+ Activer l'ajout sur la carte";
        btn.classList.toggle('bg-red-600', isImportAddingPoint);
    });

    document.getElementById('import-clear-poi-btn').addEventListener('click', () => {
        importMap.eachLayer(layer => {
            if (layer instanceof L.Marker && !importDrawnItems.hasLayer(layer)) {
                importMap.removeLayer(layer);
            }
        });
        importUserPOIs = [];
    });

    const scaleSlider = document.getElementById('import-poi-icon-scale');
    const scaleLabel = document.getElementById('import-poi-icon-scale-label');
    if (scaleSlider && scaleLabel) {
        scaleSlider.addEventListener('input', (e) => {
            scaleLabel.textContent = `${e.target.value}x`;
        });
    }

    document.querySelectorAll('#import-color-options .color-option').forEach(option => {
        option.addEventListener('click', function() {
            document.querySelectorAll('#import-color-options .color-option').forEach(opt => opt.classList.remove('selected'));
            this.classList.add('selected');
            document.getElementById('import-grid-color').value = this.dataset.color;
            document.getElementById('import-grid-color-name').value = this.dataset.name;
        });
    });

    document.getElementById('import-transparency').addEventListener('input', e => { 
        document.getElementById('import-transparency-value').textContent = `${e.target.value}%`; 
    });
}

function initImportVisualIconSelector() {
    const visualContainer = document.getElementById('import-poi-visual-selector');
    const hiddenInput = document.getElementById('import-poi-type-selector');
    const categoryFilter = document.getElementById('import-poi-category-filter');
    
    if (!visualContainer || !hiddenInput) return;

    // SUPPRESSION DU STYLE FORCÉ ICI.
    // On laisse les fonctions de rendu décider de la classe (Grille ou Arbre).
    
    const allIcons = window.getIconLibrary ? window.getIconLibrary() : [];
    visualContainer.innerHTML = '';
    
    if (allIcons.length === 0) { 
        visualContainer.innerHTML = '<p class="text-sm text-gray-500 p-4">Aucune icône.</p>'; 
        return; 
    }

    if (categoryFilter) {
        const categories = new Set();
        allIcons.forEach(icon => { 
            const catStr = Array.isArray(icon.path) ? icon.path.join(' > ') : (icon.category || 'Divers'); 
            categories.add(catStr.replace(/\d+_/, '')); 
        });

        while (categoryFilter.options.length > 1) { categoryFilter.remove(1); }

        Array.from(categories).sort().forEach(cat => { 
            const opt = document.createElement('option'); 
            opt.value = cat; 
            opt.textContent = cat; 
            categoryFilter.appendChild(opt); 
        });

        categoryFilter.onchange = (e) => { 
            if (e.target.value === 'all') {
                renderImportFullTree(allIcons, visualContainer, hiddenInput);
            } else {
                renderImportFilteredGrid(allIcons, e.target.value, visualContainer, hiddenInput);
            }
        };
    }
    // Rendu initial : Arbre complet
    renderImportFullTree(allIcons, visualContainer, hiddenInput);
}

function renderImportFullTree(icons, container, inputElement) { 
    container.innerHTML = ''; 
    
    // IMPORTANT : On applique le style ARBRE (Block) et on enlève le style GRILLE
    container.className = 'tree-view-container custom-scrollbar';
    container.style.display = 'block'; 
    container.style.gridTemplateColumns = 'none';
    
    const buildTree = window.buildTreeFromFlatList || localBuildTree; 
    const treeData = buildTree(icons);
    const rootUl = document.createElement('ul');
    rootUl.className = 'tree-root';
    renderImportTreeNodes(treeData, rootUl, inputElement);
    container.appendChild(rootUl); 
}

function renderImportFilteredGrid(icons, categoryString, container, inputElement) { 
    container.innerHTML = ''; 
    
    // IMPORTANT : On applique le style GRILLE ici seulement
    container.className = 'icon-grid-container custom-scrollbar';
    container.style.display = 'grid';
    container.style.gridTemplateColumns = 'repeat(auto-fill, minmax(60px, 1fr))';
    container.style.gap = '0.5rem';

    const filtered = icons.filter(icon => { 
        const catStr = Array.isArray(icon.path) ? icon.path.join(' > ') : (icon.category || ''); 
        return catStr.replace(/\d+_/, '') === categoryString; 
    });
    
    filtered.forEach(icon => { 
        const item = document.createElement('div'); 
        item.className = 'icon-selection-item'; 
        if (inputElement.value === icon.id) item.classList.add('selected'); 
        
        // Structure identique au mode Zone
        item.innerHTML = `<img src="${icon.url}" loading="lazy"><span>${icon.label}</span>`; 
        
        item.onclick = () => { 
            container.querySelectorAll('.icon-selection-item').forEach(el => el.classList.remove('selected')); 
            item.classList.add('selected'); 
            inputElement.value = icon.id; 
        }; 
        container.appendChild(item); 
    }); 
}

function localBuildTree(icons) {
    const root = {};
    icons.forEach(icon => {
        let pathParts = Array.isArray(icon.path) ? icon.path : (icon.category ? icon.category.replace(/\\/g, '/').split('/') : ['Divers']);
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

function renderImportTreeNodes(nodeDict, parentElement, inputElement) {
    const sortedKeys = Object.keys(nodeDict).sort();
    sortedKeys.forEach(key => {
        const node = nodeDict[key];
        const li = document.createElement('li');
        const details = document.createElement('details');
        if (key === 'Racine' && parentElement.className.includes('tree-root')) details.open = true;
        const displayName = node.__name.replace(/^\d+_/, '');
        const summary = document.createElement('summary');
        summary.innerHTML = `<span class="folder-icon">📁</span> <span class="folder-name">${displayName}</span>`;
        details.appendChild(summary);
        const ul = document.createElement('ul');
        if (Object.keys(node.__children).length > 0) renderImportTreeNodes(node.__children, ul, inputElement);
        if (node.__files.length > 0) {
            node.__files.sort((a, b) => a.label.localeCompare(b.label));
            node.__files.forEach(icon => {
                const fileLi = document.createElement('li');
                fileLi.className = 'file-item';
                if (inputElement.value === icon.id) fileLi.classList.add('selected');
                fileLi.innerHTML = `<div class="icon-preview-wrapper"><img src="${icon.url}" loading="lazy"></div><span class="icon-label">${icon.label}</span>`;
                fileLi.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const container = inputElement.closest('.card').querySelector('.tree-view-container');
                    if(container) container.querySelectorAll('.file-item.selected').forEach(el => el.classList.remove('selected'));
                    fileLi.classList.add('selected');
                    inputElement.value = icon.id;
                });
                ul.appendChild(fileLi);
            });
        }
        if (ul.hasChildNodes()) {
            details.appendChild(ul);
            li.appendChild(details);
            parentElement.appendChild(li);
        }
    });
}
function addImportPOI(latlng) { 
    const id = document.getElementById('import-poi-type-selector').value; 
    const name = document.getElementById('import-poi-name').value; 
    const icons = window.getIconLibrary ? window.getIconLibrary() : []; 
    const iconDef = icons.find(i => i.id === id); 
    const url = iconDef ? iconDef.url : 'https://maps.google.com/mapfiles/kml/pushpin/ylw-pushpin.png'; 
    const scaleInput = document.getElementById('import-poi-icon-scale'); 
    const scale = scaleInput ? parseFloat(scaleInput.value) : 1.0; 
    const size = 32 * scale; 
    const marker = L.marker(latlng, { icon: L.icon({ iconUrl: url, iconSize: [size, size], iconAnchor: [size/2, size/2] }) }).addTo(importMap); 
    if (name) marker.bindTooltip(name, {permanent: true, direction: 'top', offset: [0, -size/2]}); 
    importUserPOIs.push({ lat: latlng.lat, lon: latlng.lng, name, url }); 
    isImportAddingPoint = false; 
    const btn = document.getElementById('import-add-poi-btn'); 
    btn.textContent = "+ Activer l'ajout sur la carte"; 
    btn.classList.remove('bg-red-600'); 
    document.getElementById('import-interactive-map').style.cursor = ''; 
}

function setupImportAddressSearch() { 
    const input = document.getElementById('import-address-search-input'); 
    const list = document.getElementById('import-suggestions'); 
    let timer; 
    input.addEventListener('input', () => { 
        if (input.value.trim().length < 3) { list.classList.add('hidden'); return; } 
        clearTimeout(timer); 
        timer = setTimeout(async () => { 
            list.innerHTML = ''; 
            try { 
                const r = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(input.value)}&limit=5`); 
                const d = await r.json(); 
                if (d.length === 0) { list.classList.add('hidden'); return; } 
                d.forEach(f => { 
                    const li = document.createElement('li'); 
                    li.textContent = f.display_name; 
                    li.className = "px-4 py-2 hover:bg-gray-100 cursor-pointer text-sm text-gray-700 dark:text-gray-200 dark:hover:bg-gray-700"; 
                    li.onclick = () => { 
                        input.value = f.display_name; 
                        list.classList.add('hidden'); 
                        importMap.flyTo([parseFloat(f.lat), parseFloat(f.lon)], 15); 
                    }; 
                    list.appendChild(li); 
                }); 
                list.classList.remove('hidden'); 
            } catch(e) {} 
        }, 300); 
    }); 
    document.addEventListener('click', (e) => { 
        if (!input.contains(e.target) && !list.contains(e.target)) list.classList.add('hidden'); 
    }); 
}

async function handleImportKmzLoad(event) {
    const file = event.target.files[0];
    loadedImportKmlFeatures = [];
    importKmlResources = { images: {} };
    if (!file) return;
    try {
        const zip = file.name.toLowerCase().endsWith('.kmz') ? await JSZip.loadAsync(file) : null;
        const kmlFile = zip ? zip.file(/(\.kml)$/i)[0] : null;
        const kmlText = zip ? await kmlFile.async("string") : await file.text();
        const parser = new DOMParser();
        const kmlDoc = parser.parseFromString(kmlText, "text/xml");
        const sharedStyles = window.parseSharedKmlStyles ? window.parseSharedKmlStyles(kmlDoc) : {};
        const placemarksData = window.parseKmlPlacemarksFromDoc ? window.parseKmlPlacemarksFromDoc(kmlDoc, sharedStyles) : [];
        if (zip && window.loadKmlIcons) {
            const backupResources = window.kmlResources;
            const tempRes = { images: {} };
            window.kmlResources = tempRes; 
            await window.loadKmlIcons(placemarksData, zip);
            importKmlResources.images = { ...tempRes.images };
            window.kmlResources = backupResources;
        }
        loadedImportKmlFeatures = placemarksData;
        loadedImportKmlFeatures.forEach(f => {
            if(f.type === 'Point') L.marker([f.coordinates[1], f.coordinates[0]]).addTo(importMap);
            else if(f.type === 'LineString') L.polyline(f.coordinates.map(c => [c[1], c[0]]), {color:'red'}).addTo(importMap);
            else if(f.type === 'Polygon') L.polygon(f.coordinates.map(c => [c[1], c[0]]), {color:'blue'}).addTo(importMap);
        });
        if (loadedImportKmlFeatures.length > 0) {
            const group = new L.featureGroup(loadedImportKmlFeatures.map(f => {
                if(f.type==='Point') return L.marker([f.coordinates[1], f.coordinates[0]]);
                return L.polyline(f.coordinates.map(c => [c[1],c[0]]));
            }));
            importMap.fitBounds(group.getBounds());
        }
        alert(`${loadedImportKmlFeatures.length} élément(s) KML chargés.`);
    } catch (error) { console.error(error); alert("Erreur KMZ: " + error.message); }
}

async function handleMBTilesLoad(e) {
    const file = e.target.files[0];
    const statusSpan = document.getElementById('import-db-status');
    if (!file) {
        statusSpan.textContent = "Aucune (Mode Online)";
        statusSpan.className = "text-sm font-bold text-gray-400";
        if (mbtilesLayer) importMap.removeLayer(mbtilesLayer);
        mbtilesDB = null;
        const defaultKey = Object.keys(importBaseMaps).find(k => k.includes("Google Hybrid")) || Object.keys(importBaseMaps)[0];
        if(importBaseMaps[defaultKey]) importBaseMaps[defaultKey].addTo(importMap);
        return;
    }
    statusSpan.textContent = "Chargement...";
    statusSpan.className = "text-sm font-bold text-orange-500";
    try {
        if (typeof window.initSqlJs !== 'function') throw new Error("Librairie SQL.js manquante.");
        const config = { locateFile: filename => filename };
        const SQL = await window.initSqlJs(config);
        const buffer = await file.arrayBuffer();
        mbtilesDB = new SQL.Database(new Uint8Array(buffer));
        mbtilesMetadata = {};
        try {
            const stmt = mbtilesDB.prepare("SELECT name, value FROM metadata");
            while(stmt.step()) { const row = stmt.getAsObject(); mbtilesMetadata[row.name] = row.value; }
            stmt.free();
        } catch(err) {}
        let zooms = [];
        try {
            const zoomStmt = mbtilesDB.exec("SELECT DISTINCT zoom_level FROM tiles ORDER BY zoom_level ASC");
            if (zoomStmt.length > 0 && zoomStmt[0].values) zooms = zoomStmt[0].values.flat();
        } catch(err) { throw new Error("MBTiles invalide."); }
        document.getElementById('import-info-zooms').textContent = zooms.join(', ');
        
        const fileName = file.name.replace(/\.mbtiles$/i, '');
        const currentZoom = importMap.getZoom();
        document.getElementById('import-zone-title').value = `Export de ${fileName}_zoom ${currentZoom}`;

        if (mbtilesLayer) importMap.removeLayer(mbtilesLayer);
        const MBTilesLayer = L.TileLayer.extend({
            createTile: function(coords, done) {
                const tile = document.createElement('img');
                const tmsY = (1 << coords.z) - 1 - coords.y;
                try {
                    const stmt = mbtilesDB.prepare("SELECT tile_data FROM tiles WHERE zoom_level = :z AND tile_column = :x AND tile_row = :y");
                    const result = stmt.getAsObject({':z': coords.z, ':x': coords.x, ':y': tmsY});
                    stmt.free();
                    if (result && result.tile_data) {
                        const blob = new Blob([result.tile_data], {type: 'image/png'}); 
                        const url = URL.createObjectURL(blob);
                        tile.src = url;
                        tile.onload = () => { URL.revokeObjectURL(url); done(null, tile); };
                    } else { done(null, tile); }
                } catch(err) { done(err, tile); }
                return tile;
            }
        });
        Object.values(importBaseMaps).forEach(l => importMap.removeLayer(l));
        mbtilesLayer = new MBTilesLayer('', { minZoom: zooms[0], maxZoom: zooms[zooms.length-1], tms: false }).addTo(importMap);
        if (mbtilesMetadata.bounds) {
            const b = mbtilesMetadata.bounds.split(',').map(parseFloat);
            importMap.fitBounds([[b[1], b[0]], [b[3], b[2]]]);
        }
        statusSpan.textContent = "OK (Local)";
        statusSpan.className = "text-sm font-bold text-green-600";
    } catch (err) {
        console.error(err);
        statusSpan.textContent = "Erreur";
        statusSpan.className = "text-sm font-bold text-red-600";
        alert("Erreur MBTiles: " + err.message);
        const defaultKey = Object.keys(importBaseMaps)[0];
        if(importBaseMaps[defaultKey]) importBaseMaps[defaultKey].addTo(importMap);
    }
}

// =============================================================================
// FONCTION CLÉ : CRÉATION DU CANVAS (Logique "zoneDownloader" adaptée)
// =============================================================================
async function createHybridCanvas(boundingBox, zoom, upscaleEnabled, externalMargin) {
    const nwPx = zdLatLonToWorldPixels(boundingBox.north, boundingBox.west, zoom);
    const sePx = zdLatLonToWorldPixels(boundingBox.south, boundingBox.east, zoom);
    
    const natW = Math.abs(sePx.x - nwPx.x);
    const natH = Math.abs(sePx.y - nwPx.y);
    
    const TARGET = 2160;
    let scale = 1;
    if (upscaleEnabled && natH < TARGET) {
        scale = TARGET / natH;
        scale = Math.min(scale, 16); 
    }

    const finalW = Math.round(natW * scale);
    const finalH = Math.round(natH * scale);

    // --- CALCUL MARGE EXTERNE (LOGIQUE ZONE EXPORT) ---
    // Si externalMargin est true (UTM), on ajoute du blanc autour
    let marginPx = 0;
    if (externalMargin) {
        marginPx = Math.ceil(Math.max(10 * scale, Math.min(48 * scale, finalW * 0.007)) * 4);
    }

    const tempCanvas = document.createElement('canvas'); 
    tempCanvas.width = natW; 
    tempCanvas.height = natH;
    const tempCtx = tempCanvas.getContext('2d');
    
    const finalC = document.createElement('canvas'); 
    finalC.width = finalW + marginPx * 2; 
    finalC.height = finalH + marginPx * 2;
    const ctx = finalC.getContext('2d');
    
    ctx.fillStyle = 'white'; 
    ctx.fillRect(0,0,finalC.width, finalC.height);
    ctx.imageSmoothingEnabled = true; 
    ctx.imageSmoothingQuality = 'high';

    const TILE_SIZE = 256;
    const nwTile = { x: Math.floor(nwPx.x / TILE_SIZE), y: Math.floor(nwPx.y / TILE_SIZE) };
    const seTile = { x: Math.floor(sePx.x / TILE_SIZE), y: Math.floor(sePx.y / TILE_SIZE) };

    // --- BRANCHE : SQL vs WEB ---
    if (mbtilesDB) {
        // Mode MBTiles
        for (let x = nwTile.x; x <= seTile.x; x++) {
            for (let y = nwTile.y; y <= seTile.y; y++) {
                const tmsY = (1 << zoom) - 1 - y;
                const stmt = mbtilesDB.prepare("SELECT tile_data FROM tiles WHERE zoom_level = :z AND tile_column = :x AND tile_row = :y");
                const res = stmt.getAsObject({':z': zoom, ':x': x, ':y': tmsY});
                stmt.free();

                if (res && res.tile_data) {
                    const blob = new Blob([res.tile_data]);
                    const imgBitmap = await createImageBitmap(blob);
                    const destX = Math.floor((x * TILE_SIZE) - nwPx.x);
                    const destY = Math.floor((y * TILE_SIZE) - nwPx.y);
                    // Bleeding +1px pour éviter lignes blanches
                    tempCtx.drawImage(imgBitmap, destX, destY, TILE_SIZE + 1, TILE_SIZE + 1);
                }
            }
        }
    } else {
        // Mode Online : Détection URL du calque actif
        let urlTemplate = "https://mt0.google.com/vt/lyrs=y&hl=fr&x={x}&y={y}&z={z}";
        for (const key in importBaseMaps) {
            if (importMap.hasLayer(importBaseMaps[key])) {
                const layer = importBaseMaps[key];
                if (layer._url) urlTemplate = layer._url;
                else if (layer.getLayers && layer.getLayers().length > 0 && layer.getLayers()[0]._url) {
                    urlTemplate = layer.getLayers()[0]._url;
                }
                break;
            }
        }

        const promises = [];
        for (let x = nwTile.x; x <= seTile.x; x++) {
            for (let y = nwTile.y; y <= seTile.y; y++) {
                const url = urlTemplate.replace('{z}', zoom).replace('{x}', x).replace('{y}', y).replace('{s}', (x+y)%4).replace('{q}', coordsToQuadKey(x,y,zoom));
                promises.push(new Promise(resolve => {
                    const img = new Image();
                    img.crossOrigin = "Anonymous";
                    img.onload = () => resolve({img, x, y, ok: true});
                    img.onerror = () => resolve({ok: false});
                    img.src = url;
                }));
            }
        }
        const tiles = await Promise.all(promises);
        tiles.forEach(t => {
            if(t.ok) {
                const destX = Math.floor((t.x * TILE_SIZE) - nwPx.x);
                const destY = Math.floor((t.y * TILE_SIZE) - nwPx.y);
                tempCtx.drawImage(t.img, destX, destY, TILE_SIZE + 1, TILE_SIZE + 1);
            }
        });
    }

    // Dessin final avec décalage Marge
    ctx.drawImage(tempCanvas, marginPx, marginPx, finalW, finalH);
    
    // On renvoie la marge calculée pour que les overlays s'alignent
    return { finalCanvas: finalC, scaleFactor: scale, dynamicMargin: marginPx };
}

// --- FONCTION PRINCIPALE D'EXPORT ---
async function generateImportPNG() {
    const nwStr = document.getElementById('import-nw-coords').value;
    const seStr = document.getElementById('import-se-coords').value;
    if (!nwStr || !seStr) { alert("Veuillez dessiner une zone."); return; }

    const [nwLatRaw, nwLonRaw] = nwStr.split(',').map(parseFloat);
    const [seLatRaw, seLonRaw] = seStr.split(',').map(parseFloat);
    const zoom = importMap.getZoom();

    const loadingDiv = document.getElementById('loading-indicator');
    loadingDiv.classList.remove('hidden');
    document.getElementById('loading-message').textContent = "Génération de l'image...";

    document.getElementById('utm-grid-color').value = document.getElementById('import-grid-color').value;
    document.getElementById('utm-grid-color-name').value = document.getElementById('import-grid-color-name').value;
    document.getElementById('utm-transparency').value = document.getElementById('import-transparency').value;
    document.getElementById('common-grid-thickness').value = document.getElementById('import-grid-thickness').value;

    const isCado = document.getElementById('import-overlay-cado').checked;
    const isUtm = document.getElementById('import-overlay-utm').checked;
    const upscaleEnabled = document.getElementById('import-enable-upscale').checked;

    try {
        let extractionNW = { lat: nwLatRaw, lon: nwLonRaw };
        let extractionSE = { lat: seLatRaw, lon: seLonRaw };
        let cadoConfig = null;

        // --- CAS CADO : MARGE INTERNE (Pas de bordure blanche) ---
        if (isCado) {
            const scale = parseInt(document.getElementById('import-cado-scale').value);
            const direction = document.querySelector('input[name="import-cado-direction"]:checked').value;
            
            // 1. Calculer le centre de la zone dessinée (Point de pivot)
            const centerLat = (nwLatRaw + seLatRaw) / 2;
            const centerLon = (nwLonRaw + seLonRaw) / 2;

            // 2. Calculer les dimensions de la grille (Cases entières)
            const wM = haversineDistance({lat:nwLatRaw, lon:nwLonRaw}, {lat:nwLatRaw, lon:seLonRaw});
            const hM = haversineDistance({lat:nwLatRaw, lon:nwLonRaw}, {lat:seLatRaw, lon:nwLonRaw});
            const numCols = Math.ceil(wM/scale);
            const numRows = Math.ceil(hM/scale);

            // 3. Calculer les distances du centre vers les bords de la GRILLE (en mètres)
            const gridHalfWidthM = (numCols * scale) / 2;
            const gridHalfHeightM = (numRows * scale) / 2;

            // 4. Conversion Mètres -> Degrés (Approx locale)
            const mToDegLat = 1/111320;
            const mToDegLon = 1/(111320*Math.cos(toRadians(centerLat)));

            // 5. Définition des Marges (Depuis le bord de la grille)
            // Ascendant : Labels en Bas (Colonnes) et Gauche (Lignes)
            // Descendant : Labels en Haut (Colonnes) et Gauche (Lignes)
            const marginSizeLarge = 1.0 * scale; 
            const marginSizeSmall = 0.3 * scale;

            const mLeftM = marginSizeLarge; // Toujours à gauche pour les chiffres
            const mRightM = marginSizeSmall; // Toujours petit à droite
            
            const mTopM = (direction === 'ascending') ? marginSizeSmall : marginSizeLarge;
            const mBottomM = (direction === 'ascending') ? marginSizeLarge : marginSizeSmall;

            // 6. Calcul de la zone d'extraction EXACTE
            // On part du centre, on ajoute la demi-grille + la marge
            extractionNW = {
                lat: centerLat + ((gridHalfHeightM + mTopM) * mToDegLat),
                lon: centerLon - ((gridHalfWidthM + mLeftM) * mToDegLon)
            };
            extractionSE = {
                lat: centerLat - ((gridHalfHeightM + mBottomM) * mToDegLat),
                lon: centerLon + ((gridHalfWidthM + mRightM) * mToDegLon)
            };

            // 7. Config pour le dessin
            cadoConfig = {
                latitude: centerLat, longitude: centerLon,
                scale: scale, lineWidth: 1, letteringDirection: direction,
                gridColor: document.getElementById('import-grid-color').value,
                colorName: document.getElementById('import-grid-color-name').value,
                gridNameBase: 'Import CADO', deviation: 0, startRow:1, startCol:'A', referencePointChoice: 'no_cross',
                swapAxes: document.getElementById('import-swap-axes').checked,
                endCol: numberToLetter(numCols), endRow: numRows
            };
        }

        // --- CAS UTM : MARGE EXTERNE BLANCHE ---
        // Si UTM est actif (et pas CADO), on active la marge externe dans createHybridCanvas
        const needsExternalMargin = (isUtm && !isCado);

        const bbox = { north: extractionNW.lat, west: extractionNW.lon, south: extractionSE.lat, east: extractionSE.lon };
        
        // Appel avec argument externalMargin
        const { finalCanvas, scaleFactor, dynamicMargin } = await createHybridCanvas(bbox, zoom, upscaleEnabled, needsExternalMargin);
        
        const ctx = finalCanvas.getContext('2d');
        const finalW = finalCanvas.width;
        const finalH = finalCanvas.height;

        // Projection ajustée avec la marge
        const nwPx = zdLatLonToWorldPixels(extractionNW.lat, extractionNW.lon, zoom);
        const latLonToCanvasPixels = (lat, lon) => {
            const wp = zdLatLonToWorldPixels(lat, lon, zoom);
            return {
                x: (wp.x - nwPx.x) * scaleFactor + dynamicMargin, // Ajout marge
                y: (wp.y - nwPx.y) * scaleFactor + dynamicMargin  // Ajout marge
            };
        };

        // --- DESSIN ---
        if (loadedImportKmlFeatures.length > 0) {
            const backupResources = window.kmlResources;
            window.kmlResources = importKmlResources;
            if (window.drawZoneKmlFeatures) window.drawZoneKmlFeatures(ctx, zoom, loadedImportKmlFeatures, latLonToCanvasPixels);
            window.kmlResources = backupResources;
        }

        if (importUserPOIs.length > 0) {
            const userScaleInput = document.getElementById('import-poi-icon-scale');
            const userScale = userScaleInput ? parseFloat(userScaleInput.value) : 1.0;
            for (const poi of importUserPOIs) {
                const px = latLonToCanvasPixels(poi.lat, poi.lon);
                const img = new Image(); img.src = poi.url;
                await img.decode().catch(()=>{}); 
                const size = 48 * scaleFactor * userScale;
                ctx.drawImage(img, px.x - size/2, px.y - size/2, size, size);
                if (poi.name) {
                    ctx.font = `bold ${14*scaleFactor}px Arial`; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
                    ctx.strokeStyle = 'white'; ctx.lineWidth = 3*scaleFactor;
                    ctx.strokeText(poi.name, px.x, px.y + size/2 + 2);
                    ctx.fillStyle = 'black'; ctx.fillText(poi.name, px.x, px.y + size/2 + 2);
                }
            }
        }

        const thickness = parseInt(document.getElementById('import-grid-thickness').value) || 1;
        const cartoucheFontSize = Math.max(10 * scaleFactor, Math.min(48 * scaleFactor, finalW * 0.007));
        
        const now = new Date();
        const dateStr = `${String(now.getDate()).padStart(2,'0')}.${String(now.getMonth()+1).padStart(2,'0')}.${now.getFullYear()}`;
        let rawTitle = document.getElementById('import-zone-title').value || "Export";
        let gridTypeStr = isCado ? "CADO" : (isUtm ? "UTM" : "sans_carroyage");
        if (!rawTitle.startsWith("Export de")) rawTitle = `Export de ${rawTitle}`;
        const exportFileName = `${rawTitle}_${gridTypeStr}_date ${dateStr}`;

        if (isUtm) {
            const utmBbox = { north: extractionNW.lat, west: extractionNW.lon, south: extractionSE.lat, east: extractionSE.lon };
            
            // On passe dynamicMargin à drawUtmGridOnCanvas
            if (typeof drawUtmGridOnCanvas === 'function') {
                await drawUtmGridOnCanvas(ctx, utmBbox, latLonToCanvasPixels, dynamicMargin, cartoucheFontSize, thickness * scaleFactor);
            }
            if (window.drawZoneCartouche) {
                const metrics = window.drawZoneCartouche(ctx, rawTitle, utmBbox, "MBTiles/Google", zoom, dynamicMargin, cartoucheFontSize);
                if (window.drawZoneCompass) window.drawZoneCompass(ctx, finalW, finalH, dynamicMargin, metrics);
            }
        } 
        else if (isCado && cadoConfig) {
            // ... (Logique CADO inchangée, elle utilise latLonToCanvasPixels qui intègre déjà la marge (0 dans ce cas)) ...
            const wM = haversineDistance({lat:nwLatRaw, lon:nwLonRaw}, {lat:nwLatRaw, lon:seLonRaw});
            const hM = haversineDistance({lat:nwLatRaw, lon:nwLonRaw}, {lat:seLatRaw, lon:nwLonRaw});
            const mToDegLat = 1/111320;
            const mToDegLon = 1/(111320*Math.cos(toRadians((nwLatRaw+seLatRaw)/2)));
            const xOffsetMeters = (Math.ceil(wM/cadoConfig.scale) * cadoConfig.scale) / 2;
            const yOffsetMeters = (Math.ceil(hM/cadoConfig.scale) * cadoConfig.scale) / 2;
            const a1Lon = cadoConfig.longitude - xOffsetMeters * mToDegLon;
            let a1Lat = (cadoConfig.letteringDirection === 'ascending') 
                ? cadoConfig.latitude - yOffsetMeters * mToDegLat 
                : cadoConfig.latitude + yOffsetMeters * mToDegLat;

            cadoConfig.lineWidth = thickness * scaleFactor;
            drawCadoElementsOnCanvas(ctx, cadoConfig, latLonToCanvasPixels, [a1Lon, a1Lat]);
        } else {
             const mPerPx = (haversineDistance({lat:nwLatRaw, lon:nwLonRaw}, {lat:nwLatRaw, lon:seLonRaw})) / (natW * scaleFactor);
             // Marge interne par défaut si pas de grille
             const defaultMargin = 20 * scaleFactor;
             drawSmartScaleBar(ctx, finalW, finalH, defaultMargin, mPerPx);
             const compassRadius = Math.max(10 * scaleFactor, finalW * 0.012);
             drawSimpleCompass(ctx, finalW - 50*scaleFactor, 50*scaleFactor, compassRadius, compassRadius * 0.9);
        }

        const format = document.querySelector('input[name="image-format-import"]:checked').value;
        const mimeType = format === 'jpeg' ? 'image/jpeg' : 'image/png';
        const fileExt = format === 'jpeg' ? '.jpg' : '.png';
        const quality = 0.92;

        finalCanvas.toBlob(b => {
            downloadFile(b, exportFileName + fileExt);
            loadingDiv.classList.add('hidden');
        }, mimeType, quality);

    } catch (e) {
        console.error(e);
        alert("Erreur génération : " + e.message);
        loadingDiv.classList.add('hidden');
    }
}