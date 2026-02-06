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

    onlineLayerGroup = L.layerGroup().addTo(importMap);
    
    const hybridLayer = MAP_LAYERS.find(m => m.id === "google_hybrid") || MAP_LAYERS[0];
    if (hybridLayer && hybridLayer.layers[0]) {
         L.tileLayer(hybridLayer.layers[0].url, { maxZoom: 21, attribution: "Google Hybrid" }).addTo(onlineLayerGroup);
    } else {
        L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(onlineLayerGroup);
    }

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
        // Mise à jour dynamique du titre si on change de zoom
        updateImportTitleOnZoomChange(zoom);
        updateImportTileInfo();
    });

    importMap.on('click', (e) => {
        if (isImportAddingPoint) addImportPOI(e.latlng);
    });

    setupImportAddressSearch();
}

function updateImportTitleOnZoomChange(zoom) {
    // Met à jour la partie "zoom X" du titre si elle existe déjà
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

    visualContainer.className = 'icon-grid-container custom-scrollbar';
    visualContainer.style.display = 'grid';
    visualContainer.style.gridTemplateColumns = 'repeat(auto-fill, minmax(60px, 1fr))';
    visualContainer.style.gap = '0.5rem';

    const allIcons = window.getIconLibrary ? window.getIconLibrary() : [];
    visualContainer.innerHTML = '';
    
    if (allIcons.length === 0) {
        visualContainer.innerHTML = '<p class="text-sm text-gray-500 text-center p-4">Aucune icône.</p>';
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
            if (e.target.value === 'all') renderImportFullTree(allIcons, visualContainer, hiddenInput);
            else renderImportFilteredGrid(allIcons, e.target.value, visualContainer, hiddenInput);
        };
    }
    renderImportFullTree(allIcons, visualContainer, hiddenInput);
}

function renderImportFullTree(icons, container, inputElement) {
    container.innerHTML = ''; 
    const buildTree = window.buildTreeFromFlatList || localBuildTree; 
    const treeData = buildTree(icons);
    const rootUl = document.createElement('ul');
    rootUl.className = 'tree-root';
    renderImportTreeNodes(treeData, rootUl, inputElement);
    container.appendChild(rootUl);
}

function renderImportFilteredGrid(icons, categoryString, container, inputElement) {
    container.innerHTML = '';
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

    const marker = L.marker(latlng, {
        icon: L.icon({ iconUrl: url, iconSize: [size, size], iconAnchor: [size/2, size/2] })
    }).addTo(importMap);
    
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
        if (zip && !kmlFile) throw new Error("Aucun fichier KML trouvé dans le KMZ.");
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
    } catch (error) {
        console.error("Erreur KMZ:", error);
        alert("Erreur lecture KMZ: " + error.message);
    }
}

async function handleMBTilesLoad(e) {
    const file = e.target.files[0];
    const statusSpan = document.getElementById('import-db-status');

    if (!file) {
        statusSpan.textContent = "Aucune (Mode Online)";
        statusSpan.className = "text-sm font-bold text-gray-400";
        if (mbtilesLayer) importMap.removeLayer(mbtilesLayer);
        mbtilesDB = null;
        if(onlineLayerGroup) onlineLayerGroup.addTo(importMap);
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

        // AUTO-FILL TITRE (Feature demandée)
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

        if(onlineLayerGroup) importMap.removeLayer(onlineLayerGroup);
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
        alert("Erreur chargement MBTiles : " + err.message);
        if(onlineLayerGroup) onlineLayerGroup.addTo(importMap);
    }
}

// --- EXPORT PNG ---
async function generateImportPNG() {
    const nwStr = document.getElementById('import-nw-coords').value;
    const seStr = document.getElementById('import-se-coords').value;
    const upscaleEnabled = document.getElementById('import-enable-upscale').checked;
    if (!nwStr || !seStr) { alert("Veuillez dessiner une zone sur la carte."); return; }

    const [nwLatRaw, nwLonRaw] = nwStr.split(',').map(parseFloat);
    const [seLatRaw, seLonRaw] = seStr.split(',').map(parseFloat);
    const zoom = importMap.getZoom();

    const loadingDiv = document.getElementById('loading-indicator');
    loadingDiv.classList.remove('hidden');
    document.getElementById('loading-message').textContent = "Génération de l'image...";

    // SYNC OPTIONS GLOBALES
    document.getElementById('utm-grid-color').value = document.getElementById('import-grid-color').value;
    document.getElementById('utm-grid-color-name').value = document.getElementById('import-grid-color-name').value;
    document.getElementById('utm-transparency').value = document.getElementById('import-transparency').value;
    document.getElementById('common-grid-thickness').value = document.getElementById('import-grid-thickness').value;

    const isCado = document.getElementById('import-overlay-cado').checked;
    const isUtm = document.getElementById('import-overlay-utm').checked;

    try {
        let extractionNW = { lat: nwLatRaw, lon: nwLonRaw };
        let extractionSE = { lat: seLatRaw, lon: seLonRaw };
        let cadoConfig = null;
        let scaleFactor = 1;

        if (isCado) {
            const scale = parseInt(document.getElementById('import-cado-scale').value);
            const direction = document.querySelector('input[name="import-cado-direction"]:checked').value;
            const wM = haversineDistance({lat:nwLatRaw, lon:nwLonRaw}, {lat:nwLatRaw, lon:seLonRaw});
            const hM = haversineDistance({lat:nwLatRaw, lon:nwLonRaw}, {lat:seLatRaw, lon:nwLonRaw});
            const numCols = Math.ceil(wM/scale);
            const numRows = Math.ceil(hM/scale);
            const mToDegLat = 1/111320;
            const mToDegLon = 1/(111320*Math.cos(toRadians((nwLatRaw+seLatRaw)/2)));
            const marginSizeLarge = 1.2 * scale;
            const marginSizeSmall = 0.5 * scale;
            const mTopM = (direction === 'ascending') ? marginSizeSmall : marginSizeLarge;
            const mBottomM = (direction === 'ascending') ? marginSizeLarge : marginSizeSmall;

            extractionNW = { lat: nwLatRaw + (mTopM * mToDegLat), lon: nwLonRaw - (marginSizeLarge * mToDegLon) };
            extractionSE = { lat: seLatRaw - (mBottomM * mToDegLat), lon: seLonRaw + (marginSizeSmall * mToDegLon) };

            cadoConfig = {
                latitude: (nwLatRaw+seLatRaw)/2, longitude: (nwLonRaw+seLonRaw)/2,
                scale: scale, lineWidth: 1, letteringDirection: direction,
                gridColor: document.getElementById('import-grid-color').value,
                colorName: document.getElementById('import-grid-color-name').value,
                gridNameBase: 'Export de Google Maps Hybride', deviation: 0, startRow:1, startCol:'A', referencePointChoice: 'no_cross',
                endCol: numberToLetter(numCols), endRow: numRows
            };
        }

        const nwPx = zdLatLonToWorldPixels(extractionNW.lat, extractionNW.lon, zoom);
        const sePx = zdLatLonToWorldPixels(extractionSE.lat, extractionSE.lon, zoom);
        const natW = Math.abs(sePx.x - nwPx.x);
        const natH = Math.abs(sePx.y - nwPx.y);

        const TARGET_HEIGHT = 2160;
        let scale = 1; // Par défaut 1 (natif)

        if (upscaleEnabled) {
            if (natH < TARGET_HEIGHT) {
                scale = TARGET_HEIGHT / natH;
                scale = Math.min(scale, 16);
            }
        }
        
        const finalW = Math.round(natW * scaleFactor);
        const finalH = Math.round(natH * scaleFactor);

        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = natW;
        tempCanvas.height = natH;
        const tempCtx = tempCanvas.getContext('2d');

        const TILE_SIZE = 256;
        const nwTile = { x: Math.floor(nwPx.x / TILE_SIZE), y: Math.floor(nwPx.y / TILE_SIZE) };
        const seTile = { x: Math.floor(sePx.x / TILE_SIZE), y: Math.floor(sePx.y / TILE_SIZE) };

        if (mbtilesDB) {
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
                        tempCtx.drawImage(imgBitmap, destX, destY, TILE_SIZE + 1, TILE_SIZE + 1);
                    }
                }
            }
        } else {
            let urlTemplate = "https://mt0.google.com/vt/lyrs=y&hl=fr&x={x}&y={y}&z={z}"; 
            const promises = [];
            for (let x = nwTile.x; x <= seTile.x; x++) {
                for (let y = nwTile.y; y <= seTile.y; y++) {
                    const url = urlTemplate.replace('{z}', zoom).replace('{x}', x).replace('{y}', y);
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
                    tempCtx.drawImage(t.img, destX, destY, TILE_SIZE+1, TILE_SIZE+1);
                }
            });
        }

        const finalC = document.createElement('canvas');
        finalC.width = finalW;
        finalC.height = finalH;
        const ctx = finalC.getContext('2d');
        ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(tempCanvas, 0, 0, finalW, finalH);

        const latLonToCanvasPixels = (lat, lon) => {
            const wp = zdLatLonToWorldPixels(lat, lon, zoom);
            return {
                x: (wp.x - nwPx.x) * scaleFactor,
                y: (wp.y - nwPx.y) * scaleFactor
            };
        };

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
        
        // --- PREPARATION DU TITRE ET NOM DE FICHIER ---
        const now = new Date();
        const day = String(now.getDate()).padStart(2, '0');
        const month = String(now.getMonth() + 1).padStart(2, '0');
        const year = now.getFullYear();
        const dateStr = `${day}.${month}.${year}`;

        // Titre utilisateur (ex: "MonFichier_zoom 12")
        let rawTitle = document.getElementById('import-zone-title').value || "Export";
        
        // Nom du fichier généré : "Export de [Titre]_[Type de grille]_date [Date].ext"
        // Titre dans cartouche : "Export de [Titre]" (première ligne)
        
        let gridTypeStr = "sans carroyage";
        if (isCado) gridTypeStr = "carroyage CADO";
        else if (isUtm) gridTypeStr = "carroyage UTM";

        // Nettoyage pour éviter "Export de Export de..."
        if (!rawTitle.startsWith("Export de")) {
            rawTitle = `Export de ${rawTitle}`;
        }
        
        const cartoucheTitle = rawTitle;
        const exportFileName = `${rawTitle}_${gridTypeStr}_date ${dateStr}`;

        if (isUtm) {
            // FIX BUG UTM : On passe explicitement la boundingBox calculée
            const utmBbox = { 
                north: extractionNW.lat, 
                west: extractionNW.lon, 
                south: extractionSE.lat, 
                east: extractionSE.lon 
            };
            
            if (typeof drawUtmGridOnCanvas === 'function') {
                // margin = 0 car on dessine sur toute l'image
                await drawUtmGridOnCanvas(ctx, utmBbox, latLonToCanvasPixels, 0, cartoucheFontSize, thickness * scaleFactor);
            }
            if (window.drawZoneCartouche) {
                const metrics = window.drawZoneCartouche(ctx, cartoucheTitle, utmBbox, "MBTiles", zoom, 20*scaleFactor, cartoucheFontSize);
                if (window.drawZoneCompass) window.drawZoneCompass(ctx, finalW, finalH, 20*scaleFactor, metrics);
            }
        } else if (isCado && cadoConfig) {
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
             drawSmartScaleBar(ctx, finalW, finalH, 20*scaleFactor, mPerPx);
             const compassRadius = Math.max(10 * scaleFactor, finalW * 0.012);
             drawSimpleCompass(ctx, finalW - 50*scaleFactor, 50*scaleFactor, compassRadius, compassRadius * 0.9);
        }

        const format = document.querySelector('input[name="image-format-import"]:checked').value;
        const mimeType = format === 'jpeg' ? 'image/jpeg' : 'image/png';
        const fileExt = format === 'jpeg' ? '.jpg' : '.png';
        const quality = 0.92;

        finalC.toBlob(b => {
            downloadFile(b, exportFileName + fileExt);
            loadingDiv.classList.add('hidden');
        }, mimeType, quality);

    } catch (e) {
        console.error(e);
        alert("Erreur génération : " + e.message);
        loadingDiv.classList.add('hidden');
    }
}