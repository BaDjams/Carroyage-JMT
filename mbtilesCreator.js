// mbtilesCreator.js

// Les helpers EPSG:3395 (Yandex) sont définis dans zoneDownloader.js (chargé avant ce fichier) :
// _yMerc3395(latRad) → valeur Mercator ellipsoïdale

let creatorMap = null;
let creatorDrawnItems = null;
let currentCreatorBounds = null;
let activeJobs = [];
let jobIdCounter = 1;
let creatorBaseMaps = {};

// Limites de sécurité
const MAX_SAFE_TILES_MEMORY = 8000;   // sans OPFS (in-memory sql-wasm)
const MAX_SAFE_TILES_OPFS   = 100000; // avec OPFS (stockage disque)
const TILE_SIZE_ESTIMATE_KB = 50;

// Détection OPFS (Origin Private File System) — pas besoin de SharedArrayBuffer
let _opfsAvailable = null;
async function checkOPFS() {
    if (_opfsAvailable !== null) return _opfsAvailable;
    try {
        if (!navigator.storage?.getDirectory) { _opfsAvailable = false; return false; }
        const root = await navigator.storage.getDirectory();
        const fh = await root.getFileHandle('_opfs_probe_', { create: true });
        const w = await fh.createWritable();
        await w.write(new Uint8Array([1]));
        await w.close();
        await root.removeEntry('_opfs_probe_');
        _opfsAvailable = true;
    } catch { _opfsAvailable = false; }
    return _opfsAvailable;
}

function initCreatorMode() {
    if (creatorMap) return;

    // Détection OPFS en arrière-plan pour adapter les seuils d'avertissement
    checkOPFS().then(() => updateCreatorUI());

    // 1. Initialisation Carte
    creatorMap = L.map('creator-interactive-map').setView([46.2276, 2.2137], 5);
    
    // Definition locale QuadKey pour Creator
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

    // Correction projection Yandex EPSG:3395 (même logique que dans index.html)
    const L_YandexLayerCreator = L.TileLayer.extend({
        getTileUrl: function (coords) {
            const z = coords.z, x = coords.x;
            const n = Math.pow(2, z);
            const latN = Math.atan(Math.sinh(Math.PI * (1 - 2 * coords.y / n)));
            const y3395 = Math.floor(n / 2 * (1 - _yMerc3395(latN) / Math.PI));
            return L.Util.template(this._url, L.extend({}, this.options, { x, y: y3395, z }));
        },
        createTile: function (coords, done) {
            const tile = L.TileLayer.prototype.createTile.call(this, coords, done);
            const z = coords.z, n = Math.pow(2, z);
            const tileSize = this.getTileSize().y;
            const latN_3857 = Math.atan(Math.sinh(Math.PI * (1 - 2 * coords.y / n)));
            const y3395 = Math.floor(n / 2 * (1 - _yMerc3395(latN_3857) / Math.PI));
            const fracY = (n / 2 * (1 - _yMerc3395(latN_3857) / Math.PI)) - y3395;
            const offsetPx = -(fracY * tileSize);
            tile.style.marginTop = offsetPx + 'px';
            tile.style.height = (tileSize + Math.ceil(-offsetPx) + 1) + 'px';
            return tile;
        }
    });

    creatorBaseMaps = {};
    if (typeof MAP_LAYERS !== 'undefined') {
        MAP_LAYERS.forEach(layerConfig => {
            if (layerConfig.requiresKey) {
                const keyVal = (typeof window[layerConfig.requiresKey] !== 'undefined') ? window[layerConfig.requiresKey] : '';
                if (!keyVal) return;
            }
            let leafletLayer;
            if (layerConfig.layers.length > 1) {
                const groupLayers = layerConfig.layers.map(l => {
                    if (l.type === 'yandex') return new L_YandexLayerCreator(l.url, { maxZoom: layerConfig.maxZoom || 18, attribution: layerConfig.name, keepBuffer: 0, updateWhenZooming: false });
                    return L.tileLayer(l.url, { maxZoom: layerConfig.maxZoom || 20, attribution: layerConfig.name, keepBuffer: 0, updateWhenZooming: false });
                });
                leafletLayer = L.layerGroup(groupLayers);
            } else {
                const l = layerConfig.layers[0];
                if (l.type === 'quadkey') leafletLayer = new L_QuadKeyLayer(l.url, { maxZoom: layerConfig.maxZoom || 19, attribution: layerConfig.name });
                else if (l.type === 'yandex') leafletLayer = new L_YandexLayerCreator(l.url, { maxZoom: layerConfig.maxZoom || 18, attribution: layerConfig.name, keepBuffer: 0, updateWhenZooming: false });
                else leafletLayer = L.tileLayer(l.url, { maxZoom: layerConfig.maxZoom || 20, attribution: layerConfig.name, keepBuffer: 0, updateWhenZooming: false });
            }
            if (leafletLayer) creatorBaseMaps[layerConfig.name] = leafletLayer;
        });
    }

    // Layer défaut
    const defaultKey = Object.keys(creatorBaseMaps)[0];
    if(creatorBaseMaps[defaultKey]) creatorBaseMaps[defaultKey].addTo(creatorMap);

    L.control.layers(creatorBaseMaps).addTo(creatorMap);

    // Sync Dropdown -> Map
    const select = document.getElementById('creator-layer-select');
    select.addEventListener('change', () => {
        const layerId = select.value;
        const layerConfig = MAP_LAYERS.find(l => l.id === layerId);
        if(layerConfig && creatorBaseMaps[layerConfig.name]) {
            Object.values(creatorBaseMaps).forEach(l => creatorMap.removeLayer(l));
            creatorBaseMaps[layerConfig.name].addTo(creatorMap);
        }
    });

    // Sync Map -> Dropdown
    creatorMap.on('baselayerchange', function(e) {
        const correspondingMapLayer = MAP_LAYERS.find(layer => layer.name === e.name);
        if (correspondingMapLayer) {
            select.value = correspondingMapLayer.id;
            // Update Zoom Checkboxes based on new layer max zoom
            const maxZ = correspondingMapLayer.maxZoom || 19;
            const previouslyChecked = getSelectedZooms();
            generateZoomCheckboxes(maxZ);
            previouslyChecked.forEach(z => {
                if (z <= maxZ) {
                    const el = document.querySelector(`.zoom-checkbox-label[data-zoom="${z}"]`);
                    if(el) el.classList.add('checked');
                }
            });
            updateCreatorUI();
        }
    });

    creatorDrawnItems = new L.FeatureGroup();
    creatorMap.addLayer(creatorDrawnItems);

    const drawControl = new L.Control.Draw({
        draw: {
            rectangle: { shapeOptions: { color: '#8b5cf6' } }, 
            polyline: false, polygon: false, circle: false, marker: false, circlemarker: false
        },
        edit: { featureGroup: creatorDrawnItems }
    });
    creatorMap.addControl(drawControl);

    creatorMap.on(L.Draw.Event.CREATED, (e) => {
        creatorDrawnItems.clearLayers();
        creatorDrawnItems.addLayer(e.layer);
        currentCreatorBounds = e.layer.getBounds();
        updateCreatorUI();
    });
    creatorMap.on(L.Draw.Event.EDITED, (e) => e.layers.eachLayer(l => {
        currentCreatorBounds = l.getBounds();
        updateCreatorUI();
    }));
    creatorMap.on(L.Draw.Event.DELETED, () => {
        currentCreatorBounds = null;
        updateCreatorUI();
    });

    const updateZoomDisplay = () => {
        const z = creatorMap.getZoom();
        const el = document.getElementById('creator-current-map-zoom');
        if(el) el.textContent = z;
        document.querySelectorAll('.zoom-checkbox-label').forEach(lbl => {
            if(parseInt(lbl.dataset.zoom) === z) lbl.classList.add('ring-2', 'ring-blue-400');
            else lbl.classList.remove('ring-2', 'ring-blue-400');
        });
    };
    creatorMap.on('zoomend', updateZoomDisplay);
    updateZoomDisplay();

    populateCreatorLayers();
    generateZoomCheckboxes(19); // Default init
    setupCreatorAddressSearch();

    document.getElementById('creator-start-btn').addEventListener('click', startMbtilesJob);
    document.getElementById('creator-select-all-zooms').addEventListener('click', () => toggleZooms(true));
    document.getElementById('creator-select-none-zooms').addEventListener('click', () => toggleZooms(false));
}

window.initCreatorMode = initCreatorMode;

// --- UI HELPERS ---

function populateCreatorLayers() {
    const select = document.getElementById('creator-layer-select');
    select.innerHTML = '';
    if (typeof MAP_LAYERS !== 'undefined') {
        MAP_LAYERS.forEach(layer => {
            const opt = document.createElement('option');
            opt.value = layer.id;
            opt.textContent = `${layer.name} (Max Z${layer.maxZoom || 19})`; 
            select.appendChild(opt);
        });
    }
}

function generateZoomCheckboxes(maxZoom) {
    const container = document.getElementById('creator-zoom-grid');
    container.innerHTML = '';
    for (let z = 0; z <= maxZoom; z++) {
        const div = document.createElement('div');
        div.className = 'zoom-checkbox-label';
        div.textContent = `Z${z}`;
        div.dataset.zoom = z;
        div.onclick = function() {
            this.classList.toggle('checked');
            updateCreatorUI();
        };
        container.appendChild(div);
    }
    if (document.querySelectorAll('.zoom-checkbox-label.checked').length === 0) {
        for(let i=10; i<=15; i++) {
            if(i <= maxZoom) {
                const el = container.querySelector(`div[data-zoom="${i}"]`);
                if(el) el.classList.add('checked');
            }
        }
    }
}

function toggleZooms(state) {
    document.querySelectorAll('.zoom-checkbox-label').forEach(el => {
        if(state) el.classList.add('checked');
        else el.classList.remove('checked');
    });
    updateCreatorUI();
}

function getSelectedZooms() {
    const zooms = [];
    document.querySelectorAll('.zoom-checkbox-label.checked').forEach(el => {
        zooms.push(parseInt(el.dataset.zoom));
    });
    return zooms.sort((a,b) => a-b);
}

function updateCreatorUI() {
    const infoTiles = document.getElementById('creator-total-tiles');
    const infoSize = document.getElementById('creator-total-size');
    const warning = document.getElementById('creator-warning');
    const startBtn = document.getElementById('creator-start-btn');
    const coordsDiv = document.getElementById('creator-zone-coords');

    if (!currentCreatorBounds) {
        coordsDiv.textContent = "Aucune zone définie";
        infoTiles.textContent = "0";
        startBtn.disabled = true;
        return;
    }

    const nw = currentCreatorBounds.getNorthWest();
    const se = currentCreatorBounds.getSouthEast();
    coordsDiv.textContent = `NO: ${nw.lat.toFixed(4)}, ${nw.lng.toFixed(4)} | SE: ${se.lat.toFixed(4)}, ${se.lng.toFixed(4)}`;

    const zooms = getSelectedZooms();
    let totalTiles = 0;

    zooms.forEach(z => {
        const tiles = getTileRange(currentCreatorBounds, z);
        totalTiles += (tiles.xMax - tiles.xMin + 1) * (tiles.yMax - tiles.yMin + 1);
    });

    infoTiles.textContent = totalTiles.toLocaleString() + " tuiles";
    const sizeMb = (totalTiles * TILE_SIZE_ESTIMATE_KB) / 1024;
    infoSize.textContent = `~ ${sizeMb.toFixed(1)} Mo`;

    const maxTiles = (_opfsAvailable === true) ? MAX_SAFE_TILES_OPFS : MAX_SAFE_TILES_MEMORY;
    if (totalTiles > maxTiles) {
        warning.classList.remove('hidden');
        warning.textContent = `Attention : ${totalTiles} tuiles dépasse la limite (${maxTiles.toLocaleString()}).`;
        infoTiles.classList.add('text-red-600');
    } else if (totalTiles > MAX_SAFE_TILES_MEMORY && _opfsAvailable === true) {
        warning.classList.remove('hidden');
        warning.textContent = `Volume important (${totalTiles.toLocaleString()} tuiles) — mode OPFS activé (stockage disque).`;
        warning.className = warning.className.replace('text-red', 'text-yellow').replace('text-yellow-500', 'text-yellow-600');
        infoTiles.classList.remove('text-red-600');
    } else {
        warning.classList.add('hidden');
        infoTiles.classList.remove('text-red-600');
    }

    startBtn.disabled = (totalTiles === 0);
}

function getTileRange(bounds, zoom) {
    const nw = bounds.getNorthWest();
    const se = bounds.getSouthEast();
    
    const n = Math.pow(2, zoom);
    const xMin = Math.floor((nw.lng + 180) / 360 * n);
    const xMax = Math.floor((se.lng + 180) / 360 * n);
    
    const yMin = Math.floor((1 - Math.log(Math.tan(nw.lat * Math.PI / 180) + 1 / Math.cos(nw.lat * Math.PI / 180)) / Math.PI) / 2 * n);
    const yMax = Math.floor((1 - Math.log(Math.tan(se.lat * Math.PI / 180) + 1 / Math.cos(se.lat * Math.PI / 180)) / Math.PI) / 2 * n);

    return { xMin, xMax, yMin, yMax: Math.max(yMin, yMax) }; 
}

// --- JOB MANAGEMENT ---

class MbtilesJob {
    constructor(id, bounds, zooms, layerConfig, filename) {
        this.id = id;
        this.bounds = bounds;
        this.zooms = zooms;
        this.layerConfig = layerConfig;
        this.filename = filename;
        this.status = 'pending';
        this.totalTiles = 0;
        this.processedTiles = 0;
        this.db = null;
        this.isCancelled = false;
        this.useOPFS = false;
        this.opfsDir = null;

        this.totalTiles = this.computeTotalTiles();
        this._startTime = null;
        this._pausedMs = 0;
        this._pauseStart = null;
        this.createUI();
    }

    computeTotalTiles() {
        let count = 0;
        this.zooms.forEach(z => {
            const range = getTileRange(this.bounds, z);
            count += (range.xMax - range.xMin + 1) * (Math.max(range.yMin, range.yMax) - Math.min(range.yMin, range.yMax) + 1);
        });
        return count;
    }

    *tileGenerator() {
        for (const z of this.zooms) {
            const range = getTileRange(this.bounds, z);
            const yStart = Math.min(range.yMin, range.yMax);
            const yEnd = Math.max(range.yMin, range.yMax);
            for (let x = range.xMin; x <= range.xMax; x++) {
                for (let y = yStart; y <= yEnd; y++) {
                    yield { x, y, z };
                }
            }
        }
    }

    createUI() {
        const container = document.getElementById('creator-jobs-list');
        const emptyMsg = container.querySelector('p.italic');
        if (emptyMsg) emptyMsg.remove();

        const div = document.createElement('div');
        div.id = `job-${this.id}`;
        div.className = "bg-gray-50 dark:bg-gray-700 p-3 rounded border border-gray-200 dark:border-gray-600 text-sm";
        div.innerHTML = `
            <div class="flex justify-between items-center mb-2">
                <span class="font-bold truncate" title="${this.filename}">${this.filename}</span>
                <span class="text-xs font-mono" id="job-status-${this.id}">En attente</span>
            </div>
            <div class="w-full bg-gray-200 rounded-full h-2.5 dark:bg-gray-600 mb-2">
                <div id="job-bar-${this.id}" class="bg-blue-600 h-2.5 rounded-full" style="width: 0%"></div>
            </div>
            <div class="flex justify-between text-xs text-gray-500">
                <span id="job-count-${this.id}">0 / ${this.totalTiles}</span>
                <span id="job-eta-${this.id}" class="text-gray-400 italic"></span>
                <div class="space-x-2 btn-action-container">
                    <button id="job-pause-${this.id}" class="hover:text-blue-600">Pause</button>
                    <button id="job-cancel-${this.id}" class="hover:text-red-600">Annuler</button>
                </div>
            </div>
        `;
        container.prepend(div);

        div.querySelector(`#job-pause-${this.id}`).onclick = () => this.togglePause();
        div.querySelector(`#job-cancel-${this.id}`).onclick = () => this.cancel();
    }

    _formatETA(seconds) {
        if (seconds < 60) return `~${Math.ceil(seconds)}s`;
        if (seconds < 3600) return `~${Math.floor(seconds / 60)}m${Math.ceil(seconds % 60).toString().padStart(2, '0')}s`;
        const h = Math.floor(seconds / 3600);
        const m = Math.ceil((seconds % 3600) / 60);
        return `~${h}h${m.toString().padStart(2, '0')}m`;
    }

    updateUI() {
        const bar = document.getElementById(`job-bar-${this.id}`);
        const count = document.getElementById(`job-count-${this.id}`);
        const status = document.getElementById(`job-status-${this.id}`);
        const eta = document.getElementById(`job-eta-${this.id}`);

        if (!bar) return;

        const pct = (this.processedTiles / this.totalTiles) * 100;
        bar.style.width = `${pct}%`;
        count.textContent = `${this.processedTiles} / ${this.totalTiles}`;
        status.textContent = this.status.toUpperCase();

        // ETA : basé sur la vitesse moyenne depuis le démarrage (hors pauses)
        if (eta && this.status === 'running' && this.processedTiles > 0 && this._startTime) {
            const elapsed = (Date.now() - this._startTime - this._pausedMs) / 1000;
            const rate = this.processedTiles / elapsed; // tuiles/s
            const remaining = (this.totalTiles - this.processedTiles) / rate;
            eta.textContent = this._formatETA(remaining);
        } else if (eta && this.status !== 'running') {
            eta.textContent = '';
        }
        
        if (this.status === 'done') {
            status.className = "text-xs font-mono text-green-600 font-bold";
            bar.className = "bg-green-500 h-2.5 rounded-full";
        } else if (this.status === 'error') {
            status.className = "text-xs font-mono text-red-600 font-bold";
            bar.className = "bg-red-500 h-2.5 rounded-full";
        }
    }

    async _initDb() {
        if (typeof window.initSqlJs !== 'function') throw new Error("SQL.js manquant");
        const SQL = await window.initSqlJs({ locateFile: file => file });
        this.db = new SQL.Database();
        this.db.run("CREATE TABLE metadata (name text, value text);");
        this.db.run("CREATE TABLE tiles (zoom_level integer, tile_column integer, tile_row integer, tile_data blob);");
        this.db.run("CREATE UNIQUE INDEX tile_index on tiles (zoom_level, tile_column, tile_row);");
        const boundsStr = `${this.bounds.getWest()},${this.bounds.getSouth()},${this.bounds.getEast()},${this.bounds.getNorth()}`;
        this.db.run("INSERT INTO metadata VALUES (?, ?)", ["name", this.filename]);
        this.db.run("INSERT INTO metadata VALUES (?, ?)", ["format", "png"]);
        this.db.run("INSERT INTO metadata VALUES (?, ?)", ["bounds", boundsStr]);
        this.db.run("INSERT INTO metadata VALUES (?, ?)", ["type", "overlay"]);
        this.db.run("INSERT INTO metadata VALUES (?, ?)", ["version", "1.2"]);
    }

    async start() {
        this.status = 'running';
        this.updateUI();

        try {
            this.useOPFS = await checkOPFS();

            if (this.useOPFS) {
                // Mode OPFS : les tuiles sont écrites sur disque, pas en RAM
                const root = await navigator.storage.getDirectory();
                // Nettoyage éventuel d'un job précédent avec le même id
                try { await root.removeEntry(`mbtiles_job_${this.id}`, { recursive: true }); } catch {}
                this.opfsDir = await root.getDirectoryHandle(`mbtiles_job_${this.id}`, { create: true });
            } else {
                // Mode mémoire : init sql-wasm immédiatement
                await this._initDb();
                this.db.run("BEGIN TRANSACTION;");
            }

            await this.processQueue();

        } catch (e) {
            console.error(e);
            this.status = 'error';
            this.updateUI();
            alert(`Erreur Job ${this.filename}: ${e.message}`);
        }
    }

    // Construit les URLs pour une tuile (toutes les couches)
    _tileUrls(tile) {
        return this.layerConfig.layers.map(layer => {
            if (layer.type === 'quadkey') {
                const q = coordsToQuadKey(tile.x, tile.y, tile.z);
                return layer.url.replace('{q}', q).replace('{s}', (tile.x + tile.y) % 4);
            } else if (layer.type === 'yandex') {
                const n = Math.pow(2, tile.z);
                const latN = Math.atan(Math.sinh(Math.PI * (1 - 2 * tile.y / n)));
                const y3395 = Math.floor(n / 2 * (1 - _yMerc3395(latN) / Math.PI));
                return layer.url.replace('{z}', tile.z).replace('{x}', tile.x).replace('{y}', y3395);
            } else {
                return layer.url.replace('{z}', tile.z).replace('{x}', tile.x).replace('{y}', tile.y);
            }
        });
    }

    // Fetch + composition d'une tuile sur un canvas dédié → retourne le blob PNG ou null
    async _processTile(tile) {
        const canvas = document.createElement('canvas');
        canvas.width = 256; canvas.height = 256;
        const ctx = canvas.getContext('2d');
        let hasContent = false;
        for (const url of this._tileUrls(tile)) {
            const ok = await this.fetchAndDrawLayer(url, canvas, ctx);
            if (ok) hasContent = true;
        }
        if (!hasContent) return null;
        return new Promise(r => canvas.toBlob(r, 'image/png'));
    }

    async processQueue() {
        const CONCURRENCY = 6;
        const tiles = [...this.tileGenerator()];  // on matérialise pour pouvoir gérer la pause

        let i = 0;
        const writeTile = async (tile, blob) => {
            const tmsY = (1 << tile.z) - 1 - tile.y;
            if (this.useOPFS) {
                const fh = await this.opfsDir.getFileHandle(`${tile.z}_${tile.x}_${tmsY}`, { create: true });
                const w = await fh.createWritable();
                await w.write(blob);
                await w.close();
            } else {
                const u8 = new Uint8Array(await blob.arrayBuffer());
                this.db.run("INSERT INTO tiles VALUES (?, ?, ?, ?)", [tile.z, tile.x, tmsY, u8]);
            }
        };

        this._startTime = Date.now();

        // Pool de CONCURRENCY workers qui piochent dans la liste de tuiles
        const worker = async () => {
            while (true) {
                if (this.isCancelled) return;

                // Pause : on attend sans consommer de slot
                while (this.status === 'paused' && !this.isCancelled) {
                    await new Promise(r => setTimeout(r, 300));
                }
                if (this.isCancelled) return;

                const idx = i++;
                if (idx >= tiles.length) return;

                const tile = tiles[idx];
                try {
                    const blob = await this._processTile(tile);
                    if (blob) await writeTile(tile, blob);
                } catch (err) {
                    console.warn(`Failed tile ${tile.z}/${tile.x}/${tile.y}`, err);
                }

                this.processedTiles++;
                if (this.processedTiles % CONCURRENCY === 0) {
                    this.updateUI();
                    await new Promise(r => setTimeout(r, 0)); // cède la main au rendu
                }
            }
        };

        // Lance CONCURRENCY workers en parallèle, attend qu'ils aient tous fini
        await Promise.all(Array.from({ length: CONCURRENCY }, worker));

        if (!this.isCancelled) {
            if (this.useOPFS) {
                await this.assembleFromOPFS();
            } else {
                this.db.run("COMMIT;");
                this.finish();
            }
        }
    }

    async assembleFromOPFS() {
        // Phase 2 : lecture OPFS → sql-wasm → export
        const statusEl = document.getElementById(`job-status-${this.id}`);
        if (statusEl) statusEl.textContent = 'ASSEMBLAGE…';

        await this._initDb();
        this.db.run("BEGIN TRANSACTION;");

        let count = 0;
        for await (const [name, handle] of this.opfsDir.entries()) {
            if (handle.kind !== 'file') continue;
            const parts = name.split('_');
            const z = parseInt(parts[0]), x = parseInt(parts[1]), tmsY = parseInt(parts[2]);
            const file = await handle.getFile();
            const u8 = new Uint8Array(await file.arrayBuffer());
            this.db.run("INSERT INTO tiles VALUES (?, ?, ?, ?)", [z, x, tmsY, u8]);
            count++;
            if (count % 100 === 0) await new Promise(r => setTimeout(r, 0));
        }

        this.db.run("COMMIT;");

        // Nettoyage OPFS
        try {
            const root = await navigator.storage.getDirectory();
            await root.removeEntry(`mbtiles_job_${this.id}`, { recursive: true });
        } catch {}
        this.opfsDir = null;

        this.finish();
    }

    fetchAndDrawLayer(url, canvas, ctx) {
        return new Promise((resolve) => {
            const img = new Image();
            img.crossOrigin = "Anonymous";
            img.onload = () => { ctx.drawImage(img, 0, 0, 256, 256); resolve(true); };
            img.onerror = () => resolve(false);
            img.src = url;
        });
    }

    finish() {
        this.status = 'done';
        this.updateUI();

        try {
            const data = this.db.export();
            this.db.close();
            this.db = null;

            const blob = new Blob([data], { type: 'application/x-sqlite3' });
            const fname = `${this.filename}.mbtiles`;

            const container = document.getElementById(`job-${this.id}`);
            const btnContainer = container.querySelector('.btn-action-container');
            btnContainer.innerHTML = '';

            const doSave = async () => {
                if (window.showSaveFilePicker) {
                    try {
                        const fh = await window.showSaveFilePicker({
                            suggestedName: fname,
                            types: [{ description: 'MBTiles', accept: { 'application/x-sqlite3': ['.mbtiles'] } }]
                        });
                        const w = await fh.createWritable();
                        await w.write(blob);
                        await w.close();
                        return;
                    } catch (e) {
                        if (e.name === 'AbortError') return; // annulé par l'utilisateur
                        // fallback si showSaveFilePicker échoue pour une autre raison
                    }
                }
                // Fallback : lien de téléchargement classique
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url; a.download = fname; a.click();
                setTimeout(() => URL.revokeObjectURL(url), 10000);
            };

            const dlBtn = document.createElement('button');
            dlBtn.className = "text-green-600 font-bold hover:underline cursor-pointer";
            dlBtn.textContent = "Télécharger";
            dlBtn.onclick = doSave;
            btnContainer.appendChild(dlBtn);

            doSave();

        } catch (err) {
            console.error(err);
            this.status = 'error';
            this.updateUI();
            const container = document.getElementById(`job-${this.id}`);
            const statusDiv = container.querySelector(`#job-status-${this.id}`);
            statusDiv.textContent = "ERREUR MÉMOIRE";
            alert(`Erreur fatale lors de la création du fichier final :\n${err.message}\n\nLa carte est trop volumineuse pour la mémoire du navigateur.`);
        }

        activeJobs = activeJobs.filter(j => j.id !== this.id);
    }

    togglePause() {
        if (this.status === 'running') {
            this.status = 'paused';
            this._pauseStart = Date.now();
            document.getElementById(`job-pause-${this.id}`).textContent = "Reprendre";
        } else if (this.status === 'paused') {
            this.status = 'running';
            if (this._pauseStart) { this._pausedMs += Date.now() - this._pauseStart; this._pauseStart = null; }
            document.getElementById(`job-pause-${this.id}`).textContent = "Pause";
        }
        this.updateUI();
    }

    cancel() {
        this.isCancelled = true;
        this.status = 'error';
        document.getElementById(`job-status-${this.id}`).textContent = "ANNULÉ";
        // Nettoyage OPFS si utilisé
        if (this.opfsDir) {
            navigator.storage.getDirectory().then(root =>
                root.removeEntry(`mbtiles_job_${this.id}`, { recursive: true }).catch(() => {})
            );
            this.opfsDir = null;
        }
    }
}

function startMbtilesJob() {
    if (!currentCreatorBounds) {
        alert("Veuillez définir une zone.");
        return;
    }
    const zooms = getSelectedZooms();
    if (zooms.length === 0) {
        alert("Veuillez sélectionner au moins un niveau de zoom.");
        return;
    }

    const layerId = document.getElementById('creator-layer-select').value;
    const layerConfig = MAP_LAYERS.find(l => l.id === layerId);
    let filename = document.getElementById('creator-filename').value.trim();
    if (!filename) filename = `Carte_Offline_${Date.now()}`;

    const job = new MbtilesJob(jobIdCounter++, currentCreatorBounds, zooms, layerConfig, filename);
    activeJobs.push(job);
    job.start();
}

function setupCreatorAddressSearch() {
    const input = document.getElementById('creator-address-search');
    const list = document.getElementById('creator-suggestions');
    let timer;
    input.addEventListener('input', () => {
        if (input.value.length < 3) { list.classList.add('hidden'); return; }
        clearTimeout(timer);
        timer = setTimeout(async () => {
            try {
                list.innerHTML = '';
                const r = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(input.value)}&limit=5`);
                const d = await r.json();
                d.forEach(f => {
                    const li = document.createElement('li');
                    li.textContent = f.display_name;
                    li.className = "px-4 py-2 hover:bg-gray-100 cursor-pointer text-sm dark:text-gray-200 dark:hover:bg-gray-600";
                    li.onclick = () => {
                        input.value = f.display_name;
                        list.classList.add('hidden');
                        creatorMap.flyTo([f.lat, f.lon], 13);
                    };
                    list.appendChild(li);
                });
                list.classList.remove('hidden');
            } catch(e){}
        }, 300);
    });
    document.addEventListener('click', e => {
        if(!input.contains(e.target) && !list.contains(e.target)) list.classList.add('hidden');
    });
}