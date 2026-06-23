// tileSource.js
// Source de tuiles MBTiles : lecture PARESSEUSE via wa-sqlite + un VFS « fichier »
// en lecture seule qui lit le .mbtiles par PLAGES D'OCTETS (File.slice), build
// Asyncify. La base n'est jamais chargée entièrement en mémoire (contrairement à
// l'ancienne approche sql.js + file.arrayBuffer()), donc plus de limite ~2 Gio
// sous Chrome : on ne lit que les pages B-tree nécessaires à chaque tuile.
//
// ⚠ Ce fichier est un ES MODULE (chargé via <script type="module"> dans index.html).
// Il importe wa-sqlite (vendoré localement dans vendor/wa-sqlite/, aucun npm/CDN)
// et ré-expose toute son API sur window pour les scripts classiques consommateurs
// (imagetoprint.js, zoneDownloader.js, le calque Leaflet d'index.html).
//
// NB : sql.js reste utilisé par ailleurs pour l'ÉCRITURE des MBTiles
// (carroyageToMbtiles.js / mbtilesCreator.js) ; wa-sqlite ne sert qu'à la LECTURE.

import SQLiteAsyncFactory from './vendor/wa-sqlite/wa-sqlite-async.js';
import { Factory } from './vendor/wa-sqlite/sqlite-api.js';
import * as VFS from './vendor/wa-sqlite/VFS.js';

// URL du .wasm résolue relativement à CE module (robuste quel que soit le chemin
// de service de l'application).
const wasmUrl = new URL('./vendor/wa-sqlite/wa-sqlite-async.wasm', import.meta.url).href;

const VFS_NAME = 'cado-file-ro';
const DB_NAME  = 'mbtiles.db';

let _sqlite3 = null;   // API wa-sqlite (Factory)
let _vfs     = null;   // instance du VFS « fichier »
let _db      = null;   // pointeur de la base ouverte
let _file    = null;   // File MBTiles courant
let _tsZooms = [];
let _tsBounds = null;
let _tsName  = '';

// ---------------------------------------------------------------------------
// VFS lecture seule adossé à un File (lectures par plages, Asyncify)
// ---------------------------------------------------------------------------
class FileVFS extends VFS.Base {
    name = VFS_NAME;
    file = null;          // File MBTiles courant (défini avant open)
    _byId = new Map();    // fileId → File

    xOpen(name, fileId, flags, pOutFlags) {
        return this.handleAsync(async () => {
            // Seule la base principale est adossée au File ; on n'ouvre rien d'autre
            // (lecture seule → pas de journal/WAL).
            if (!(flags & VFS.SQLITE_OPEN_MAIN_DB) || !this.file) return VFS.SQLITE_CANTOPEN;
            this._byId.set(fileId, this.file);
            pOutFlags.setInt32(0, flags, true);
            return VFS.SQLITE_OK;
        });
    }
    xClose(fileId) {
        return this.handleAsync(async () => { this._byId.delete(fileId); return VFS.SQLITE_OK; });
    }
    xRead(fileId, pData, iOffset) {
        return this.handleAsync(async () => {
            const file = this._byId.get(fileId);
            const size = file.size;
            const bgn = Math.min(iOffset, size);
            const end = Math.min(iOffset + pData.byteLength, size);
            const n = Math.max(0, end - bgn);
            if (n > 0) {
                const buf = await file.slice(bgn, end).arrayBuffer();
                pData.set(new Uint8Array(buf), 0);
            }
            if (n < pData.byteLength) { pData.fill(0, n); return VFS.SQLITE_IOERR_SHORT_READ; }
            return VFS.SQLITE_OK;
        });
    }
    xFileSize(fileId, pSize64) {
        return this.handleAsync(async () => {
            pSize64.setBigInt64(0, BigInt(this._byId.get(fileId).size), true);
            return VFS.SQLITE_OK;
        });
    }
    xAccess(name, flags, pResOut) {
        // Aucun fichier annexe (journal/WAL) : on répond « inexistant ».
        return this.handleAsync(async () => { pResOut.setInt32(0, 0, true); return VFS.SQLITE_OK; });
    }
    xDeviceCharacteristics(fileId) { return VFS.SQLITE_IOCAP_IMMUTABLE; }
    // Lecture seule : écritures neutralisées.
    xWrite()    { return VFS.SQLITE_READONLY; }
    xTruncate() { return VFS.SQLITE_READONLY; }
    xSync()     { return VFS.SQLITE_OK; }
    xDelete()   { return VFS.SQLITE_OK; }
    xLock()     { return VFS.SQLITE_OK; }
    xUnlock()   { return VFS.SQLITE_OK; }
}

async function _ensureEngine() {
    if (_sqlite3) return _sqlite3;
    const module = await SQLiteAsyncFactory({ locateFile: () => wasmUrl });
    _sqlite3 = Factory(module);
    _vfs = new FileVFS();
    _sqlite3.vfs_register(_vfs, false);
    return _sqlite3;
}

// Sérialisation des accès à la base : le build Asyncify de wa-sqlite n'est PAS
// ré-entrant (une opération suspendue sur un xRead ne doit pas être interrompue
// par une autre). Or Leaflet déclenche plusieurs createTile en parallèle → on
// fait la queue de toutes les opérations DB sur une même connexion.
let _chain = Promise.resolve();
function _serial(task) {
    const p = _chain.then(task, task);
    _chain = p.then(() => {}, () => {}); // la chaîne survit aux erreurs
    return p;
}

// Exécute un SELECT sans paramètre et retourne les lignes (tableaux de valeurs).
function _all(sql) {
    return _serial(async () => {
        const r = await _sqlite3.execWithParams(_db, sql, null);
        return r.rows;
    });
}

// ---------------------------------------------------------------------------
// API publique
// ---------------------------------------------------------------------------

async function tileSourceLoad(file) {
    await tileSourceClear();
    if (!file) return null;
    const sqlite3 = await _ensureEngine();
    _file = file;
    _vfs.file = file;

    try {
        _db = await _serial(() => sqlite3.open_v2(DB_NAME, VFS.SQLITE_OPEN_READONLY, VFS_NAME));
    } catch (e) {
        _db = null; _file = null; _vfs.file = null;
        throw new Error('Ouverture du MBTiles impossible : ' + (e?.message || e));
    }

    // Optimisation de la lecture paresseuse : agrandir le cache de pages interne de
    // SQLite (≈ 16 Mo ; valeur négative = Kio) pour conserver en mémoire WASM les
    // pages « chaudes » (racines d'index/table relues à chaque tuile) et réduire
    // fortement le nombre de lectures async (xRead → File.slice).
    try { await _all('PRAGMA cache_size=-16384'); } catch (e) {}
    // Les B-tree temporaires (ex. DISTINCT) restent en mémoire → aucune tentative
    // d'ouverture de fichier temporaire (notre VFS n'adosse que la base principale).
    try { await _all('PRAGMA temp_store=MEMORY'); } catch (e) {}

    // Métadonnées (petite table → rapide)
    const meta = {};
    try { for (const [k, v] of await _all('SELECT name, value FROM metadata')) meta[k] = v; } catch (e) {}
    _tsName   = meta.name || file.name.replace(/\.mbtiles$/i, '');
    _tsBounds = meta.bounds ? String(meta.bounds).split(',').map(parseFloat) : null;

    // Niveaux de zoom : privilégier minzoom/maxzoom des métadonnées (immédiat) ;
    // sinon DISTINCT sur l'index (zoom_level, …) — évite de scanner toute la base.
    const zMin = parseInt(meta.minzoom, 10), zMax = parseInt(meta.maxzoom, 10);
    if (Number.isFinite(zMin) && Number.isFinite(zMax) && zMax >= zMin) {
        _tsZooms = [];
        for (let z = zMin; z <= zMax; z++) _tsZooms.push(z);
    } else {
        try {
            _tsZooms = (await _all('SELECT DISTINCT zoom_level FROM tiles ORDER BY zoom_level ASC'))
                .map(r => Number(r[0]));
        } catch (e) {
            await tileSourceClear();
            throw new Error('MBTiles invalide.');
        }
    }
    if (_tsZooms.length === 0) { await tileSourceClear(); throw new Error('MBTiles vide : aucune tuile.'); }

    return { name: _tsName, zooms: _tsZooms, bounds: _tsBounds };
}

async function tileSourceClear() {
    const db = _db;
    if (db != null && _sqlite3) { try { await _serial(() => _sqlite3.close(db)); } catch (e) {} }
    _db = null; _file = null;
    if (_vfs) _vfs.file = null;
    _tsZooms = []; _tsBounds = null; _tsName = '';
}

function tileSourceIsActive()  { return _db !== null; }
function tileSourceGetZooms()  { return _tsZooms; }
function tileSourceGetName()   { return _tsName; }
function tileSourceGetBounds() { return _tsBounds; }

/** Zoom le plus élevé disponible ≤ targetZoom (sinon le minimum disponible). */
function tileSourceGetBestZoom(targetZoom) {
    if (_tsZooms.length === 0) return targetZoom;
    let best = _tsZooms[0];
    for (const z of _tsZooms) { if (z <= targetZoom) best = z; }
    return best;
}

/** Lit une tuile (asynchrone). Renvoie une URL blob ou null. */
async function tileSourceReadTile(x, y, z) {
    if (_db == null || !_sqlite3) return null;
    const tmsY = (1 << z) - 1 - y;
    try {
        const rows = await _all(
            `SELECT tile_data FROM tiles WHERE zoom_level=${z | 0} AND tile_column=${x | 0} AND tile_row=${tmsY | 0}`
        );
        const data = rows[0] && rows[0][0];
        if (data && data.byteLength) return URL.createObjectURL(new Blob([data]));
    } catch (e) {}
    return null;
}

// ---------------------------------------------------------------------------
// Gestion UI (partagée entre les modes)
// ---------------------------------------------------------------------------

function _tileSourceUpdateUI() {
    const active = tileSourceIsActive();
    const statusText = active ? _tsName : 'Aucun';
    const infoText   = active ? `Zooms : ${_tsZooms.join(', ')}` : '';
    const colorClass = active ? 'text-green-600' : 'text-gray-400';

    document.querySelectorAll('.mbtiles-status-badge').forEach(el => {
        el.textContent = statusText;
        el.className = `mbtiles-status-badge text-xs font-bold ${colorClass}`;
    });
    document.querySelectorAll('.mbtiles-info-bar').forEach(el => {
        el.textContent = infoText;
        el.classList.toggle('hidden', !infoText);
    });
    document.querySelectorAll('.mbtiles-clear-btn').forEach(el => {
        el.classList.toggle('hidden', !active);
    });
    // Masque le sélecteur de fond de carte en ligne quand MBTiles est actif
    const onlineBlock = document.getElementById('cado-map-provider-wrapper');
    if (onlineBlock) onlineBlock.classList.toggle('hidden', active);

    // Notifie les cartes Leaflet (index.html)
    if (typeof window.tileSourceOnChange === 'function') {
        const info = active ? { name: _tsName, zooms: _tsZooms, bounds: _tsBounds } : null;
        window.tileSourceOnChange(info);
    }
}

async function _handleMbtilesInput(e) {
    const file = e.target.files[0] || null;
    // Statut intermédiaire
    document.querySelectorAll('.mbtiles-status-badge').forEach(el => {
        el.textContent = file ? 'Chargement…' : 'Aucun';
        el.className = 'mbtiles-status-badge text-xs font-bold text-orange-500';
    });
    try {
        if (file) {
            await tileSourceLoad(file);
        } else {
            await tileSourceClear();
        }
    } catch(err) {
        await tileSourceClear();
        document.querySelectorAll('.mbtiles-status-badge').forEach(el => {
            el.textContent = 'Erreur';
            el.className = 'mbtiles-status-badge text-xs font-bold text-red-600';
        });
        document.querySelectorAll('.mbtiles-info-bar').forEach(el => {
            el.textContent = err.message;
            el.classList.remove('hidden');
        });
        // Réinitialise tous les inputs fichier
        document.querySelectorAll('.mbtiles-file-input').forEach(el => { el.value = ''; });
        return;
    }
    _tileSourceUpdateUI();
}

function _initTileSourceUI() {
    document.querySelectorAll('.mbtiles-file-input').forEach(input => {
        input.addEventListener('change', _handleMbtilesInput);
    });
    document.querySelectorAll('.mbtiles-clear-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            tileSourceClear();
            document.querySelectorAll('.mbtiles-file-input').forEach(el => { el.value = ''; });
            _tileSourceUpdateUI();
        });
    });
}

// Ré-exposition sur window : les scripts classiques (imagetoprint.js,
// zoneDownloader.js, le calque Leaflet d'index.html) consomment cette API en
// global et fournissent en retour window.tileSourceOnChange.
// ⚠ tileSourceReadTile est désormais ASYNC (renvoie une Promise) — voir les
// consommateurs adaptés (await / Promise.then).
Object.assign(window, {
    tileSourceLoad,
    tileSourceClear,
    tileSourceIsActive,
    tileSourceGetZooms,
    tileSourceGetName,
    tileSourceGetBounds,
    tileSourceGetBestZoom,
    tileSourceReadTile,
});

// Script module = exécution différée : le DOM peut déjà être prêt.
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _initTileSourceUI);
} else {
    _initTileSourceUI();
}
