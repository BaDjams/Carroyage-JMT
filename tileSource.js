// tileSource.js
// Gestion centralisée de la source de tuiles : en ligne ou MBTiles local.
// Utilisé par imagetoprint.js (carroyage rapide) et zoneDownloader.js (export de zone).

let _tsDB    = null;
let _tsZooms = [];
let _tsBounds = null;
let _tsName  = '';

// ---------------------------------------------------------------------------
// API publique
// ---------------------------------------------------------------------------

async function tileSourceLoad(file) {
    tileSourceClear();
    if (!file) return null;
    await ensureSqlJs();
    if (typeof window.initSqlJs !== 'function') throw new Error("SQL.js non chargé.");
    const SQL = await window.initSqlJs({ locateFile: f => f });
    const buf = await file.arrayBuffer();
    _tsDB = new SQL.Database(new Uint8Array(buf));

    // Métadonnées
    const meta = {};
    try {
        const stmt = _tsDB.prepare("SELECT name, value FROM metadata");
        while (stmt.step()) { const r = stmt.getAsObject(); meta[r.name] = r.value; }
        stmt.free();
    } catch(e) {}
    _tsName   = meta.name || file.name.replace(/\.mbtiles$/i, '');
    _tsBounds = meta.bounds ? meta.bounds.split(',').map(parseFloat) : null;

    // Niveaux de zoom disponibles
    try {
        const res = _tsDB.exec("SELECT DISTINCT zoom_level FROM tiles ORDER BY zoom_level ASC");
        _tsZooms = res[0] ? res[0].values.flat() : [];
    } catch(e) { throw new Error("MBTiles invalide."); }
    if (_tsZooms.length === 0) throw new Error("MBTiles vide : aucune tuile.");

    return { name: _tsName, zooms: _tsZooms, bounds: _tsBounds };
}

function tileSourceClear() {
    if (_tsDB) { try { _tsDB.close(); } catch(e) {} _tsDB = null; }
    _tsZooms = []; _tsBounds = null; _tsName = '';
}

function tileSourceIsActive()              { return _tsDB !== null; }
function tileSourceGetZooms()              { return _tsZooms; }
function tileSourceGetName()               { return _tsName; }
function tileSourceGetBounds()             { return _tsBounds; }

/** Zoom le plus élevé disponible ≤ targetZoom (sinon le minimum disponible). */
function tileSourceGetBestZoom(targetZoom) {
    if (_tsZooms.length === 0) return targetZoom;
    let best = _tsZooms[0];
    for (const z of _tsZooms) { if (z <= targetZoom) best = z; }
    return best;
}

/** Lit une tuile depuis la DB. Renvoie une URL blob ou null. */
function tileSourceReadTile(x, y, z) {
    if (!_tsDB) return null;
    const tmsY = (1 << z) - 1 - y;
    try {
        const stmt = _tsDB.prepare(
            "SELECT tile_data FROM tiles WHERE zoom_level=:z AND tile_column=:x AND tile_row=:y"
        );
        const res = stmt.getAsObject({ ':z': z, ':x': x, ':y': tmsY });
        stmt.free();
        if (res && res.tile_data) return URL.createObjectURL(new Blob([res.tile_data]));
    } catch(e) {}
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
            tileSourceClear();
        }
    } catch(err) {
        tileSourceClear();
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

document.addEventListener('DOMContentLoaded', _initTileSourceUI);
