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
const TILE_SIZE_ESTIMATE_KB = 15;     // estimation JPEG q0.85 (~12 Ko/tuile observé)

// Encodage des tuiles — uniquement pour les couches COMPOSITES (multi-couches),
// où la fusion de plusieurs images impose un ré-encodage sur canvas.
// Pour les couches simples (1 seule source), les tuiles sont stockées dans leur
// format natif tel quel, sans décodage ni recompression (passthrough).
// JPEG ≈ 8x plus léger que PNG RGBA sur de l'imagerie ortho/satellite.
// JPEG n'a pas de canal alpha : un fond opaque est appliqué avant composition.
const TILE_FORMAT  = 'image/jpeg';
const TILE_QUALITY = 0.92;            // 0..1, ignoré si TILE_FORMAT === 'image/png'
                                      // ré-encodage composite : qualité élevée pour
                                      // rester au plus près de l'ortho d'origine
const TILE_BG      = '#ffffff';       // fond pour les zones transparentes (JPEG only)

// Relief 3D hors-ligne (MNT) — source mondiale "Terrarium" (Mapzen/AWS Open Data
// Terrain Tiles), la même que celle utilisée en ligne par la vue 3D de CadoTour
// (map3d.js : DEM_URL / DEM_MAXZOOM = 12 — la donnée source est ~30 m (SRTM),
// au-delà MapLibre sur-échantillonne lui-même le dernier niveau natif).
//
// Le MNT est écrit dans le MÊME MBTiles que le fond de carte, sur le seul
// niveau de zoom 12, réservé à cet usage : quand l'option est cochée, les
// niveaux 0-12 sont interdits pour le fond (grisés dans le sélecteur) — le
// fond est alors téléchargé à partir du zoom 13. Le zoom 12 ne collisionne
// donc jamais avec une vraie tuile de fond dans la table `tiles` (même clé
// zoom/x/y). Une métadonnée `mnt_zoom` signale la convention aux lecteurs qui
// la connaissent (CadoTour) pour qu'ils excluent ce niveau du rendu 2D et
// l'utilisent comme source `raster-dem` pour la vue 3D.
// Toujours en passthrough (pas de recompression) : l'encodage RVB de
// l'altitude ne doit jamais être altéré.
const MNT_TILE_URL = 'https://elevation-tiles-prod.s3.amazonaws.com/terrarium/{z}/{x}/{y}.png';
const MNT_ZOOM = 12; // seul niveau réservé au MNT — les niveaux < 13 sont interdits pour le fond

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

    // Correction projection Yandex EPSG:3395 — reprojection EXACTE sur canvas
    // (même logique que index.html/createBaseLayers : chaque tuile Leaflet
    // assemble au pixel près les 1-2 tuiles Yandex couvrant sa plage de
    // latitudes, au lieu de l'ancien décalage CSS approché qui laissait des
    // jours horizontaux entre les rangées). _lat3857/_yMerc3395 : zoneDownloader.js.
    const L_YandexLayerCreator = L.GridLayer.extend({
        initialize: function (url, options) {
            this._url = url;
            L.GridLayer.prototype.initialize.call(this, options);
        },
        createTile: function (coords, done) {
            const ts = this.getTileSize().y;
            const tile = document.createElement('canvas');
            tile.width = ts; tile.height = ts;

            const z = coords.z, n = Math.pow(2, z);
            const py = (yTile) => n * ts / 2 * (1 - _yMerc3395(_lat3857(yTile, n)) / Math.PI);
            const pyN = py(coords.y), pyS = py(coords.y + 1);
            const H = pyS - pyN;

            const ty0 = Math.max(0, Math.floor(pyN / ts));
            const ty1 = Math.min(n - 1, Math.floor((pyS - 1e-9) / ts));
            const srcs = [];
            for (let ty = ty0; ty <= ty1; ty++)
                srcs.push({ ty, url: L.Util.template(this._url, L.extend({}, this.options, { x: coords.x, y: ty, z })) });

            const load = (url) => new Promise(resolve => {
                const img = new Image();
                img.crossOrigin = 'anonymous';
                img.onload = () => resolve(img);
                img.onerror = () => {
                    const raw = new Image();
                    raw.onload = () => resolve(raw);
                    raw.onerror = () => resolve(null);
                    raw.src = url;
                };
                img.src = url;
            });

            Promise.all(srcs.map(s => load(s.url))).then(imgs => {
                const ctx = tile.getContext('2d');
                let drawn = 0;
                for (let i = 0; i < srcs.length; i++) {
                    const img = imgs[i];
                    if (!img) continue;
                    const ty = srcs[i].ty;
                    const srcTop = Math.max(pyN, ty * ts), srcBot = Math.min(pyS, (ty + 1) * ts);
                    const sy = srcTop - ty * ts, sh = srcBot - srcTop;
                    const dy = (srcTop - pyN) * ts / H, dh = sh * ts / H;
                    const over = (i < srcs.length - 1) ? 1 : 0;
                    ctx.drawImage(img, 0, sy, img.width, sh, 0, dy, ts, dh + over);
                    drawn++;
                }
                done(drawn ? null : new Error('tuiles Yandex indisponibles'), tile);
            });
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
                    const nativeZ = l.maxZoom ?? layerConfig.maxZoom ?? (l.type === 'yandex' ? 18 : 19);
                    if (l.type === 'yandex') return new L_YandexLayerCreator(l.url, { maxZoom: nativeZ, attribution: layerConfig.name, keepBuffer: 0, updateWhenZooming: false });
                    return L.tileLayer(l.url, { maxZoom: nativeZ, attribution: layerConfig.name, keepBuffer: 0, updateWhenZooming: false });
                });
                leafletLayer = L.layerGroup(groupLayers);
            } else {
                const l = layerConfig.layers[0];
                const nativeZ = l.maxZoom ?? layerConfig.maxZoom ?? (l.type === 'yandex' ? 18 : 19);
                if (l.type === 'quadkey') leafletLayer = new L_QuadKeyLayer(l.url, { maxZoom: nativeZ, attribution: layerConfig.name });
                else if (l.type === 'yandex') leafletLayer = new L_YandexLayerCreator(l.url, { maxZoom: nativeZ, attribution: layerConfig.name, keepBuffer: 0, updateWhenZooming: false });
                else leafletLayer = L.tileLayer(l.url, { maxZoom: nativeZ, attribution: layerConfig.name, keepBuffer: 0, updateWhenZooming: false });
            }
            if (leafletLayer) creatorBaseMaps[layerConfig.name] = leafletLayer;
        });
    }

    // Layer défaut : Ortho IGN + Routes Google
    const defaultCreatorLayer = creatorBaseMaps["Ortho IGN + Routes Google"] || creatorBaseMaps[Object.keys(creatorBaseMaps)[0]];
    if (defaultCreatorLayer) defaultCreatorLayer.addTo(creatorMap);

    L.control.layers(creatorBaseMaps).addTo(creatorMap);

    // Synchro bidirectionnelle select ↔ map (mbtiles creator)
    const select = document.getElementById('creator-layer-select');

    select?.addEventListener('change', function() {
        const ml = MAP_LAYERS.find(l => l.id === this.value);
        if (ml && creatorBaseMaps[ml.name]) {
            Object.values(creatorBaseMaps).forEach(l => creatorMap.removeLayer(l));
            creatorBaseMaps[ml.name].addTo(creatorMap);
        }
    });

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
    document.getElementById('creator-include-mnt')?.addEventListener('change', applyMntZoomLock);
}

window.initCreatorMode = initCreatorMode;

// --- UI HELPERS ---

function populateCreatorLayers() {
    const select = document.getElementById('creator-layer-select');
    select.innerHTML = '';
    if (typeof MAP_LAYERS !== 'undefined') {
        MAP_LAYERS.forEach(layer => {
            if (layer.requiresKey) {
                const keyVal = (typeof window[layer.requiresKey] !== 'undefined') ? window[layer.requiresKey] : '';
                if (!keyVal) return;
            }
            const opt = document.createElement('option');
            opt.value = layer.id;
            opt.textContent = `${layer.name} (Max Z${layer.maxZoom || 19})`;
            select.appendChild(opt);
        });
    }
    const def = MAP_LAYERS?.find(m => m.name === "Ortho IGN + Routes Google");
    if (def && select.querySelector(`option[value="${def.id}"]`)) select.value = def.id;
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
            if (this.classList.contains('mnt-locked')) return;
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
    applyMntZoomLock();
}

function toggleZooms(state) {
    document.querySelectorAll('.zoom-checkbox-label').forEach(el => {
        if (el.classList.contains('mnt-locked')) { el.classList.remove('checked'); return; }
        if(state) el.classList.add('checked');
        else el.classList.remove('checked');
    });
    updateCreatorUI();
}

// Case "Inclure le relief 3D hors-ligne" cochée : les niveaux 0-12 (réservés
// au MNT, cf. MNT_ZOOM) sont interdits pour le fond de carte — le zoom 12 ne
// doit jamais contenir de tuile de fond dans le MBTiles final. Ré-appliqué à
// chaque régénération de la grille (changement de fond de carte) et à chaque
// bascule de la case.
function applyMntZoomLock() {
    const locked = document.getElementById('creator-include-mnt')?.checked;
    document.querySelectorAll('.zoom-checkbox-label').forEach(el => {
        const z = parseInt(el.dataset.zoom, 10);
        if (locked && z <= MNT_ZOOM) {
            el.classList.remove('checked');
            el.classList.add('mnt-locked');
        } else {
            el.classList.remove('mnt-locked');
        }
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

    if (document.getElementById('creator-include-mnt')?.checked) {
        const mntTiles = getTileRange(currentCreatorBounds, MNT_ZOOM);
        totalTiles += (mntTiles.xMax - mntTiles.xMin + 1) * (mntTiles.yMax - mntTiles.yMin + 1);
    }

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
        warning.textContent = `Volume important (${totalTiles.toLocaleString()} tuiles) - OPFS limite la RAM pendant le telechargement, mais l'assemblage SQLite final reste en memoire navigateur.`;
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
    constructor(id, bounds, zooms, layerConfig, filename, includeMnt = false) {
        this.id = id;
        this.bounds = bounds;
        this.zooms = zooms;
        this.layerConfig = layerConfig;
        this.filename = filename;
        this.includeMnt = includeMnt; // ajoute le MNT (zoom MNT_ZOOM) dans ce même MBTiles
        this.status = 'pending';
        this.totalTiles = 0;
        this.processedTiles = 0;
        this.db = null;
        this.isCancelled = false;
        this.useOPFS = false;
        this.opfsDir = null;

        // Format de sortie des tuiles écrit dans les métadonnées MBTiles.
        // - Multi-couches OU Yandex (reprojection toujours par canvas, même
        //   mono-couche) : ré-encodage obligatoire (TILE_FORMAT).
        // - Mono-couche sans Yandex : null = passthrough natif, détecté sur
        //   les octets reçus.
        const hasYandexLayer = layerConfig.layers.some(l => l.type === 'yandex');
        this.tileFormat = (layerConfig.layers.length > 1 || hasYandexLayer)
            ? (TILE_FORMAT === 'image/jpeg' ? 'jpg' : 'png')
            : null;

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
        if (this.includeMnt) {
            const range = getTileRange(this.bounds, MNT_ZOOM);
            count += (range.xMax - range.xMin + 1) * (Math.max(range.yMin, range.yMax) - Math.min(range.yMin, range.yMax) + 1);
        }
        return count;
    }

    *tileGenerator() {
        for (const z of this.zooms) {
            const range = getTileRange(this.bounds, z);
            const yStart = Math.min(range.yMin, range.yMax);
            const yEnd = Math.max(range.yMin, range.yMax);
            for (let x = range.xMin; x <= range.xMax; x++) {
                for (let y = yStart; y <= yEnd; y++) {
                    yield { x, y, z, mnt: false };
                }
            }
        }
        // MNT en dernier : le premier tuile récupérée (utilisée pour détecter le
        // format passthrough, cf. _fetchRawTile) reste une tuile de fond.
        if (this.includeMnt) {
            const range = getTileRange(this.bounds, MNT_ZOOM);
            const yStart = Math.min(range.yMin, range.yMax);
            const yEnd = Math.max(range.yMin, range.yMax);
            for (let x = range.xMin; x <= range.xMax; x++) {
                for (let y = yStart; y <= yEnd; y++) {
                    yield { x, y, z: MNT_ZOOM, mnt: true };
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
        // Le 'format' est inséré juste avant le COMMIT (cf. _insertFormatMetadata),
        // une fois le format réel des tuiles connu en mode passthrough mono-couche.
        this.db.run("INSERT INTO metadata VALUES (?, ?)", ["bounds", boundsStr]);
        this.db.run("INSERT INTO metadata VALUES (?, ?)", ["type", "overlay"]);
        this.db.run("INSERT INTO metadata VALUES (?, ?)", ["version", "1.2"]);
        // Convention lue par CadoTour (tileSource.js) : ce niveau de zoom contient
        // le MNT (Terrarium) et non une tuile de fond — à exclure du rendu 2D et
        // à utiliser comme source raster-dem pour la vue 3D.
        if (this.includeMnt) this.db.run("INSERT INTO metadata VALUES (?, ?)", ["mnt_zoom", String(MNT_ZOOM)]);
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

    // Construit l'URL d'une couche NON-Yandex pour une tuile (Yandex a besoin
    // de 1-2 URLs + un découpage en bandes — cf. _yandexBands ci-dessous, pas
    // d'une simple URL unique).
    _layerUrl(layer, tile) {
        if (layer.type === 'quadkey') {
            const q = coordsToQuadKey(tile.x, tile.y, tile.z);
            return layer.url.replace('{q}', q).replace('{s}', (tile.x + tile.y) % 4);
        }
        return layer.url.replace('{z}', tile.z).replace('{x}', tile.x).replace('{y}', tile.y);
    }

    // Bandes source EPSG:3395 nécessaires pour reprojeter EXACTEMENT une tuile
    // EPSG:3857 (tile.z/x/y) — même calcul que L_YandexLayerCreator (tuile
    // Leaflet), exprimé directement en coordonnées pixel source→destination
    // pour un dessin sur canvas 256×256. Sans ce découpage (ancien code :
    // 1 seule tuile 3395 "la plus proche" étirée sur toute la tuile 256×256),
    // les tuiles Yandex stockées dans le .mbtiles étaient visiblement
    // décalées/mal alignées entre rangées voisines — aucune correction
    // n'existait à la génération (contrairement à l'affichage Leaflet, qui
    // avait au moins le décalage CSS approché).
    _yandexBands(layer, tile) {
        const ts = 256, z = tile.z, n = Math.pow(2, z);
        const py = (yTile) => n * ts / 2 * (1 - _yMerc3395(_lat3857(yTile, n)) / Math.PI);
        const pyN = py(tile.y), pyS = py(tile.y + 1);
        const H = pyS - pyN;
        const ty0 = Math.max(0, Math.floor(pyN / ts));
        const ty1 = Math.min(n - 1, Math.floor((pyS - 1e-9) / ts));
        const bands = [];
        for (let ty = ty0; ty <= ty1; ty++) {
            const srcTop = Math.max(pyN, ty * ts), srcBot = Math.min(pyS, (ty + 1) * ts);
            bands.push({
                url: layer.url.replace('{z}', z).replace('{x}', tile.x).replace('{y}', ty),
                sy: srcTop - ty * ts, sh: srcBot - srcTop,
                dy: (srcTop - pyN) * ts / H, dh: (srcBot - srcTop) * ts / H,
            });
        }
        return bands;
    }

    // Dessine une couche Yandex reprojetée sur le canvas de la tuile (1-2
    // bandes assemblées au pixel près) → true si au moins une bande a pu être
    // dessinée. Chargement des sources en parallèle, dessin nord→sud ensuite.
    async _drawYandexLayer(canvas, ctx, layer, tile) {
        const bands = this._yandexBands(layer, tile);
        const imgs = await Promise.all(bands.map(b => new Promise(resolve => {
            const img = new Image();
            img.crossOrigin = 'anonymous';
            img.onload = () => resolve(img);
            img.onerror = () => resolve(null);
            img.src = b.url;
        })));
        let drawn = 0;
        for (let i = 0; i < bands.length; i++) {
            const img = imgs[i];
            if (!img) continue;
            const b = bands[i];
            // +1 px de recouvrement (sauf dernière bande) : supprime le liseré
            // d'anticrénelage aux frontières fractionnaires (la bande suivante,
            // opaque, repeint par-dessus).
            const over = (i < bands.length - 1) ? 1 : 0;
            try { ctx.drawImage(img, 0, b.sy, img.width, b.sh, 0, b.dy, 256, b.dh + over); drawn++; }
            catch { /* image cassée → bande ignorée, les autres continuent */ }
        }
        return drawn > 0;
    }

    // Récupère une tuile → retourne le blob à stocker (ou null si vide/échec).
    async _processTile(tile) {
        // Tuile MNT (zoom réservé) : toujours mono-source, passthrough — jamais
        // composée avec le fond, même si celui-ci est multi-couches ou Yandex.
        if (tile.mnt) {
            return this._fetchRawTile(MNT_TILE_URL.replace('{z}', tile.z).replace('{x}', tile.x).replace('{y}', tile.y));
        }

        const hasYandex = this.layerConfig.layers.some(l => l.type === 'yandex');

        // --- Cas mono-couche SANS Yandex : passthrough natif (AUCUNE recompression) ---
        // On stocke l'octet pour octet ce que renvoie le serveur, dans son
        // format d'origine (JPEG/PNG/WebP). Évite la perte de génération
        // d'un re-encodage canvas.toBlob() d'un JPEG en JPEG. Une couche Yandex
        // DOIT toujours passer par le canvas : sa reprojection (1-2 bandes
        // source) ne peut jamais être un simple octet-pour-octet.
        if (this.layerConfig.layers.length === 1 && !hasYandex) {
            return this._fetchRawTile(this._layerUrl(this.layerConfig.layers[0], tile));
        }

        // --- Cas multi-couches ou reprojection Yandex : composition sur canvas ---
        // La fusion de plusieurs images (ou la reprojection Yandex) impose un
        // ré-encodage : il n'existe pas de "format natif" pour une tuile composite.
        const canvas = document.createElement('canvas');
        canvas.width = 256; canvas.height = 256;
        const ctx = canvas.getContext('2d');
        // JPEG ne gère pas la transparence : on pose un fond opaque avant
        // composition pour éviter que les zones vides deviennent noires.
        if (TILE_FORMAT === 'image/jpeg') {
            ctx.fillStyle = TILE_BG;
            ctx.fillRect(0, 0, 256, 256);
        }
        let hasContent = false;
        for (const layer of this.layerConfig.layers) {
            const ok = layer.type === 'yandex'
                ? await this._drawYandexLayer(canvas, ctx, layer, tile)
                : await this.fetchAndDrawLayer(this._layerUrl(layer, tile), canvas, ctx);
            if (ok) hasContent = true;
        }
        if (!hasContent) return null;
        return new Promise(r => canvas.toBlob(r, TILE_FORMAT, TILE_QUALITY));
    }

    // Télécharge une tuile et renvoie le blob brut, sans la décoder ni la
    // ré-encoder. Détecte le format réel (une fois par job) pour les métadonnées.
    async _fetchRawTile(url) {
        try {
            const res = await fetch(url, { mode: 'cors', credentials: 'omit' });
            if (!res.ok) return null;
            const blob = await res.blob();
            if (!blob.size) return null;
            const head = new Uint8Array(await blob.slice(0, 16).arrayBuffer());
            const sniffed = this._sniffFormat(head);
            // Rejette les réponses non-image (erreurs XML/HTML renvoyées en HTTP 200)
            if (!sniffed && !(blob.type || '').startsWith('image/')) return null;
            if (this.tileFormat === null) this.tileFormat = sniffed || 'jpg';
            return blob;
        } catch {
            return null;
        }
    }

    // Identifie le format d'image d'après la signature binaire (magic bytes).
    _sniffFormat(b) {
        if (b.length >= 3 && b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF) return 'jpg';
        if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4E && b[3] === 0x47) return 'png';
        if (b.length >= 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
            b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return 'webp';
        return null;
    }

    // Insère le format réel des tuiles dans les métadonnées (avant COMMIT).
    _insertFormatMetadata() {
        this.db.run("INSERT INTO metadata VALUES (?, ?)", ["format", this.tileFormat || 'jpg']);
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
                this._insertFormatMetadata();
                this.db.run("COMMIT;");
                this.finish();
            }
        }
    }

    async assembleFromOPFS() {
        // Phase 2 : lecture OPFS → sql-wasm → export
        const statusEl = document.getElementById(`job-status-${this.id}`);
        const etaEl = document.getElementById(`job-eta-${this.id}`);
        if (etaEl) etaEl.textContent = 'Phase finale en RAM navigateur';
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

        this._insertFormatMetadata();
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
                        await w.write(data);
                        await w.close();
                        return;
                    } catch (e) {
                        if (e.name === 'AbortError') return; // annulé par l'utilisateur
                        // fallback si showSaveFilePicker échoue pour une autre raison
                    }
                }
                // Fallback : lien de téléchargement classique
                const blob = new Blob([data], { type: 'application/x-sqlite3' });
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
    const includeMnt = document.getElementById('creator-include-mnt')?.checked || false;

    const job = new MbtilesJob(jobIdCounter++, currentCreatorBounds, zooms, layerConfig, filename, includeMnt);
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
                const suggestions = await fetchBanAddressSuggestions(input.value, 5);
                suggestions.forEach(item => {
                    const li = createAddressSuggestionItem(item, () => {
                        input.value = item.label;
                        list.classList.add('hidden');
                        creatorMap.flyTo([item.lat, item.lon], 13);
                    }, "px-4 py-2 hover:bg-gray-100 cursor-pointer text-sm dark:text-gray-200 dark:hover:bg-gray-600");
                    list.appendChild(li);
                });
                if (suggestions.length) {
                    list.classList.remove('hidden');
                    return;
                }
            } catch(e){}
            try {
                list.innerHTML = '';
                const r = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(input.value)}&limit=5`);
                const d = await r.json();
                d.forEach(f => {
                    const li = createAddressSuggestionItem({ label: f.display_name }, () => {
                        input.value = f.display_name;
                        list.classList.add('hidden');
                        creatorMap.flyTo([f.lat, f.lon], 13);
                    }, "px-4 py-2 hover:bg-gray-100 cursor-pointer text-sm dark:text-gray-200 dark:hover:bg-gray-600");
                    list.appendChild(li);
                });
                if (list.children.length > 0) list.classList.remove('hidden');
            } catch(e){}
        }, 300);
    });
    document.addEventListener('click', e => {
        if(!input.contains(e.target) && !list.contains(e.target)) list.classList.add('hidden');
    });
}
