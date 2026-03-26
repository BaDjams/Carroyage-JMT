// desktop-layers.js
// Gestionnaire de couches pour le mode desktop CADO.
// – Crée/renomme/masque/supprime des couches Leaflet.
// – Intercepte les ajouts de marqueurs et vecteurs pour les ranger dans la couche active.
// – Exporte une image (tuiles + vecteurs) bornée par le carroyage visible.
//
// Dépendances (chargées avant ce script dans desktop.html) :
//   leaflet.js, imagetoprint.js (itpLatLonToWorldPixels, coordsToQuadKey),
//   tileSource.js (tileSourceIsActive, tileSourceReadTile, tileSourceGetBestZoom),
//   utilities.js (downloadFile)

'use strict';

// ---------------------------------------------------------------------------
// LayerManager
// ---------------------------------------------------------------------------

class LayerManager {

    constructor(map) {
        this.map           = map;
        this.layers        = [];   // [{id, name, type, icon, group, visible, locked}]
        this._nextId       = 1;
        this._activeId     = null;
        this._panel        = null;
        this._intercepting = false;

        this._buildPanel();
        this._setupIntercept();
        this._setupRemoveSync();

        // Couches par défaut (verrouillées : non supprimables)
        this._addDefault('carroyage', '📐 Carroyage', 'carroyage');
        this._addDefault('marqueurs', '📍 Marqueurs',  'markers');
        this._addDefault('vecteurs',  '✏️ Vecteurs',   'vecteurs');

        window.layerManager = this;
        console.log('[LayerManager] initialisé.');
    }

    // ── Gestion des couches ─────────────────────────────────────────────────

    _addDefault(id, name, type) {
        const group = L.layerGroup().addTo(this.map);
        this.layers.push({ id, name, type, group, visible: true, locked: true });
        if (!this._activeId) this._activeId = id;
        this._renderPanel();
    }

    /** Crée une nouvelle couche utilisateur. Retourne son id. */
    createLayer(name, type = 'generic') {
        const id    = 'layer_' + (this._nextId++);
        const group = L.layerGroup().addTo(this.map);
        this.layers.push({ id, name, type, group, visible: true, locked: false });
        this._renderPanel();
        return id;
    }

    /** Supprime une couche (et tous ses éléments). */
    deleteLayer(id) {
        const idx = this.layers.findIndex(l => l.id === id);
        if (idx === -1 || this.layers[idx].locked) return;
        const removed = this.layers.splice(idx, 1)[0];
        removed.group.clearLayers();
        this.map.removeLayer(removed.group);
        if (this._activeId === id) {
            this._activeId = this.layers.length ? this.layers[this.layers.length - 1].id : null;
        }
        this._renderPanel();
    }

    /** Bascule la visibilité d'une couche. */
    toggleLayer(id) {
        const layer = this.layers.find(l => l.id === id);
        if (!layer) return;
        layer.visible = !layer.visible;
        layer.visible ? this.map.addLayer(layer.group) : this.map.removeLayer(layer.group);
        this._renderPanel();
    }

    /** Définit la couche active (où vont les nouveaux éléments). */
    setActive(id) {
        if (this.layers.find(l => l.id === id)) {
            this._activeId = id;
            this._renderPanel();
        }
    }

    getActive() {
        return this.layers.find(l => l.id === this._activeId) || null;
    }

    /**
     * Ajoute un élément Leaflet dans la couche active.
     * Si preferredType est donné, cherche en priorité une couche active de ce type.
     */
    addToActiveLayer(leafletElement, preferredType) {
        let target = null;
        if (preferredType) {
            const active = this.getActive();
            if (active && active.type === preferredType) {
                target = active;
            } else {
                target = [...this.layers].reverse().find(l => l.type === preferredType && l.visible);
            }
        }
        if (!target) target = this.getActive();
        if (!target) { leafletElement.addTo(this.map); return; }
        target.group.addLayer(leafletElement);
    }

    _isManaged(el) {
        return this.layers.some(l => l.group.hasLayer(el));
    }

    // ── Interception des ajouts sur la carte ────────────────────────────────

    _setupIntercept() {
        this.map.on('layeradd', (e) => {
            if (this._intercepting) return;
            const layer = e.layer;

            // Ignorer : groupes, tuiles de fond, éléments non-interactifs (labels grille)
            if (layer instanceof L.LayerGroup)  return;
            if (layer instanceof L.TileLayer)   return;
            if (layer.options && layer.options.interactive === false) return;

            // Ignorer si déjà géré par une de nos couches
            if (this._isManaged(layer)) return;

            // Déterminer le type
            let preferredType = 'generic';
            if (layer instanceof L.Marker)  preferredType = 'markers';
            else if (layer instanceof L.Path) preferredType = 'vecteurs';

            // Déplacer vers la couche cible (asynchrone pour éviter les conflits Leaflet internes)
            setTimeout(() => {
                if (this.map.hasLayer(layer) && !this._isManaged(layer)) {
                    this._intercepting = true;
                    this.map.removeLayer(layer);
                    this._intercepting = false;
                    this.addToActiveLayer(layer, preferredType);
                }
            }, 0);
        });
    }

    /** Nettoie les grilles mortes (retirées de la carte par VectorToolbar reposition). */
    _setupRemoveSync() {
        this.map.on('layerremove', (e) => {
            if (this._intercepting) return;
            if (e.layer instanceof L.LayerGroup && e.layer._gridParams) {
                // La grille a été retirée de la carte (ex: reposition) — la sortir du LayerManager
                this.layers.forEach(l => {
                    if (l.group.hasLayer(e.layer)) l.group.removeLayer(e.layer);
                });
            }
        });
    }

    // ── Panel UI ────────────────────────────────────────────────────────────

    _buildPanel() {
        const panel = document.createElement('div');
        panel.id        = 'cado-layer-panel';
        panel.className = 'cado-layer-panel';
        panel.innerHTML = `
            <div class="clp-header" id="clp-header">
                <span class="clp-title">📁 Couches</span>
                <button class="clp-icon-btn" id="clp-add-btn"    title="Nouvelle couche">＋</button>
                <button class="clp-icon-btn" id="clp-toggle-btn" title="Réduire/Développer">▾</button>
            </div>
            <div class="clp-body" id="clp-body">
                <div class="clp-list" id="clp-list"></div>
                <div class="clp-footer">
                    <button class="clp-export-btn" id="clp-export-btn">📷 Exporter image</button>
                </div>
            </div>`;
        document.body.appendChild(panel);
        this._panel = panel;

        panel.querySelector('#clp-add-btn').addEventListener('click', () => this._promptNewLayer());
        panel.querySelector('#clp-export-btn').addEventListener('click',  () => this.exportImage());

        // Réduire/développer
        let collapsed = false;
        panel.querySelector('#clp-toggle-btn').addEventListener('click', () => {
            collapsed = !collapsed;
            panel.querySelector('#clp-body').style.display = collapsed ? 'none' : '';
            panel.querySelector('#clp-toggle-btn').textContent = collapsed ? '▸' : '▾';
        });

        // Draggable
        const header = panel.querySelector('#clp-header');
        let dragging = false, ox = 0, oy = 0;
        header.addEventListener('mousedown', e => {
            if (e.target.tagName === 'BUTTON') return;
            dragging = true;
            const rect = panel.getBoundingClientRect();
            ox = e.clientX - rect.left;
            oy = e.clientY - rect.top;
            e.preventDefault();
        });
        document.addEventListener('mousemove', e => {
            if (!dragging) return;
            panel.style.left   = (e.clientX - ox) + 'px';
            panel.style.top    = (e.clientY - oy) + 'px';
            panel.style.right  = 'auto';
            panel.style.bottom = 'auto';
        });
        document.addEventListener('mouseup', () => { dragging = false; });
    }

    _renderPanel() {
        const list = this._panel.querySelector('#clp-list');
        list.innerHTML = '';

        this.layers.forEach((layer, idx) => {
            const isActive = layer.id === this._activeId;
            const row = document.createElement('div');
            row.className = 'clp-row' + (isActive ? ' clp-row-active' : '');
            row.dataset.id = layer.id;

            // Boutons de déplacement vertical
            const canUp   = idx > 0;
            const canDown = idx < this.layers.length - 1;

            row.innerHTML = `
                <button class="clp-vis-btn" data-id="${layer.id}" title="${layer.visible ? 'Masquer' : 'Afficher'}">${layer.visible ? '👁' : '🔴'}</button>
                <span   class="clp-layer-name ${isActive ? 'clp-layer-active-text' : ''}" data-id="${layer.id}" title="Activer cette couche">${layer.name}</span>
                <span class="clp-row-actions">
                    <button class="clp-icon-btn clp-mv-up"    data-id="${layer.id}" ${canUp   ? '' : 'disabled'} title="Monter">↑</button>
                    <button class="clp-icon-btn clp-mv-down"  data-id="${layer.id}" ${canDown ? '' : 'disabled'} title="Descendre">↓</button>
                    <button class="clp-icon-btn clp-rename"   data-id="${layer.id}" title="Renommer">✎</button>
                    ${!layer.locked
                        ? `<button class="clp-icon-btn clp-del" data-id="${layer.id}" title="Supprimer">×</button>`
                        : `<span class="clp-del-placeholder"></span>`}
                </span>`;
            list.appendChild(row);
        });

        list.querySelectorAll('.clp-vis-btn').forEach(el =>
            el.addEventListener('click', e => { e.stopPropagation(); this.toggleLayer(e.currentTarget.dataset.id); }));
        list.querySelectorAll('.clp-layer-name').forEach(el =>
            el.addEventListener('click', e => this.setActive(e.currentTarget.dataset.id)));
        list.querySelectorAll('.clp-rename').forEach(el =>
            el.addEventListener('click', e => { e.stopPropagation(); this._promptRename(e.currentTarget.dataset.id); }));
        list.querySelectorAll('.clp-del').forEach(el =>
            el.addEventListener('click', e => {
                e.stopPropagation();
                const l = this.layers.find(x => x.id === e.currentTarget.dataset.id);
                if (l && confirm('Supprimer la couche «' + l.name + '» et tous ses éléments ?')) {
                    this.deleteLayer(l.id);
                }
            }));
        list.querySelectorAll('.clp-mv-up').forEach(el =>
            el.addEventListener('click', e => { e.stopPropagation(); this._moveLayer(e.currentTarget.dataset.id, -1); }));
        list.querySelectorAll('.clp-mv-down').forEach(el =>
            el.addEventListener('click', e => { e.stopPropagation(); this._moveLayer(e.currentTarget.dataset.id, +1); }));
    }

    _moveLayer(id, dir) {
        const idx = this.layers.findIndex(l => l.id === id);
        const newIdx = idx + dir;
        if (newIdx < 0 || newIdx >= this.layers.length) return;
        [this.layers[idx], this.layers[newIdx]] = [this.layers[newIdx], this.layers[idx]];
        this._renderPanel();
    }

    _promptNewLayer() {
        const name = prompt('Nom de la nouvelle couche :');
        if (!name) return;
        const type = prompt('Type (generic / carroyage / markers / vecteurs) :', 'generic');
        const validTypes = ['generic', 'carroyage', 'markers', 'vecteurs'];
        const id = this.createLayer(name.trim(), validTypes.includes(type) ? type : 'generic');
        this.setActive(id);
    }

    _promptRename(id) {
        const layer = this.layers.find(l => l.id === id);
        if (!layer) return;
        const name = prompt('Nouveau nom :', layer.name);
        if (name && name.trim()) { layer.name = name.trim(); this._renderPanel(); }
    }

    // ── Export image ────────────────────────────────────────────────────────

    /** Trouve le premier groupe de grille visible ayant des _gridParams. */
    _findGridForExport() {
        for (const l of this.layers) {
            if (!l.visible) continue;
            let found = null;
            l.group.eachLayer(el => {
                // _map !== null signifie que l'élément est effectivement rendu
                if (!found && el._gridParams && el._map) found = { layer: l, gridGroup: el };
            });
            if (found) return found;
        }
        return null;
    }

    async exportImage() {
        const found = this._findGridForExport();
        if (!found) {
            alert('Aucun carroyage visible — créez d\'abord une grille dans une couche active.');
            return;
        }

        const params = found.gridGroup._gridParams;
        // a1Corner = clickedLatLng = coin SW de la grille (referencePointChoice:'origin', deviation:0)
        const a1Lat  = params.centerLatLng.lat;
        const a1Lng  = params.centerLatLng.lng;
        const scale  = params.scale;
        const width  = params.width;
        const height = params.height;
        const cosPhi = Math.cos(a1Lat * Math.PI / 180);

        const latPerCell = scale / 111320;
        const lngPerCell = scale / (111320 * cosPhi);

        const bbox = {
            south: a1Lat,
            north: a1Lat + height * latPerCell,
            west:  a1Lng,
            east:  a1Lng + width  * lngPerCell
        };

        const btn = this._panel.querySelector('#clp-export-btn');
        btn.textContent = '⏳ Génération…';
        btn.disabled = true;

        try {
            const canvas = await this._renderBbox(bbox);
            canvas.toBlob(blob => {
                if (blob) downloadFile(blob, 'cado-desktop-' + Date.now() + '.png');
            });
        } catch (err) {
            console.error('[CADO export]', err);
            alert('Erreur export : ' + err.message);
        } finally {
            btn.textContent = '📷 Exporter image';
            btn.disabled = false;
        }
    }

    // ── Rendu canvas ────────────────────────────────────────────────────────

    async _renderBbox(bbox) {
        const TARGET_W = 4096; // largeur cible en pixels de sortie

        // 1. Zoom optimal ─────────────────────────────────────────────────────
        const zoom = this._calcZoom(bbox, TARGET_W);

        // 2. World pixels aux coins ────────────────────────────────────────────
        const nwW = itpLatLonToWorldPixels(bbox.north, bbox.west, zoom);
        const seW = itpLatLonToWorldPixels(bbox.south, bbox.east, zoom);

        // 3. Plage de tuiles ───────────────────────────────────────────────────
        const txMin = Math.floor(nwW.x / 256);
        const tyMin = Math.floor(nwW.y / 256);
        const txMax = Math.floor(seW.x / 256);
        const tyMax = Math.floor(seW.y / 256);

        // 4. Canvas des tuiles (non rogné) ────────────────────────────────────
        const tW = (txMax - txMin + 1) * 256;
        const tH = (tyMax - tyMin + 1) * 256;
        const tCanvas = document.createElement('canvas');
        tCanvas.width = tW; tCanvas.height = tH;
        const tCtx = tCanvas.getContext('2d');

        const tileInfo = this._getActiveTileInfo();

        const loadTile = (tx, ty) => new Promise(resolve => {
            const img = new Image();
            img.crossOrigin = 'Anonymous';
            let src = null;
            if (tileSourceIsActive()) {
                src = tileSourceReadTile(tx, ty, tileSourceGetBestZoom(zoom));
            } else if (tileInfo) {
                src = this._buildTileUrl(tileInfo, tx, ty, zoom);
            }
            if (!src) { resolve(); return; }
            const px = (tx - txMin) * 256;
            const py = (ty - tyMin) * 256;
            img.onload  = () => { tCtx.drawImage(img, px, py, 256, 256); resolve(); };
            img.onerror = () => resolve();
            img.src = src + '?_=' + Date.now();
        });

        const promises = [];
        for (let tx = txMin; tx <= txMax; tx++)
            for (let ty = tyMin; ty <= tyMax; ty++)
                promises.push(loadTile(tx, ty));
        await Promise.all(promises);

        // 5. Rogner exactement sur la bbox ────────────────────────────────────
        const cropX = Math.round(nwW.x - txMin * 256);
        const cropY = Math.round(nwW.y - tyMin * 256);
        const cropW = Math.round(seW.x - nwW.x);
        const cropH = Math.round(seW.y - nwW.y);

        const finalCanvas = document.createElement('canvas');
        finalCanvas.width  = cropW;
        finalCanvas.height = cropH;
        const ctx = finalCanvas.getContext('2d');
        ctx.drawImage(tCanvas, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);

        // 6. Fonction de projection geo → canvas final ─────────────────────────
        const toPixel = (lat, lng) => {
            const wp = itpLatLonToWorldPixels(lat, lng, zoom);
            return { x: wp.x - nwW.x, y: wp.y - nwW.y };
        };

        // 7. Dessiner les couches visibles ────────────────────────────────────
        this.layers.filter(l => l.visible).forEach(layer => {
            this._drawGroupOnCanvas(ctx, layer.group, toPixel);
        });

        return finalCanvas;
    }

    /**
     * Parcourt récursivement un L.LayerGroup et dessine sur ctx.
     * Gère : L.Polyline, L.Polygon, L.Circle, L.LayerGroup imbriqué.
     * Les L.Marker (emoji divIcon) ne sont pas rendus (limitation canvas).
     */
    _drawGroupOnCanvas(ctx, group, toPixel) {
        group.eachLayer(el => {
            if (el instanceof L.LayerGroup) {
                // Groupe imbriqué (ex: une grille entière)
                this._drawGroupOnCanvas(ctx, el, toPixel);
            } else if (el instanceof L.Circle && !(el instanceof L.CircleMarker)) {
                const c    = el.getLatLng();
                const rM   = el.getRadius(); // mètres
                const cosPhi = Math.cos(c.lat * Math.PI / 180);
                const rLng = rM / (111320 * cosPhi);
                const cp   = toPixel(c.lat, c.lng);
                const ep   = toPixel(c.lat, c.lng + rLng);
                const rPx  = Math.abs(ep.x - cp.x);
                ctx.save();
                ctx.strokeStyle = el.options.color   || '#fff';
                ctx.lineWidth   = el.options.weight  || 1;
                ctx.globalAlpha = el.options.opacity != null ? el.options.opacity : 1;
                if (el.options.fill) {
                    ctx.fillStyle   = el.options.fillColor   || el.options.color || '#fff';
                    ctx.globalAlpha = el.options.fillOpacity != null ? el.options.fillOpacity : 0.2;
                    ctx.beginPath(); ctx.arc(cp.x, cp.y, rPx, 0, 2 * Math.PI); ctx.fill();
                    ctx.globalAlpha = el.options.opacity != null ? el.options.opacity : 1;
                }
                ctx.beginPath(); ctx.arc(cp.x, cp.y, rPx, 0, 2 * Math.PI); ctx.stroke();
                ctx.restore();
            } else if (el instanceof L.Polyline) {
                // Covers L.Polyline, L.Polygon, L.Rectangle
                const color   = el.options.color   || '#fff';
                const weight  = el.options.weight  || 1;
                const opacity = el.options.opacity != null ? el.options.opacity : 1;
                ctx.save();
                ctx.strokeStyle = color;
                ctx.lineWidth   = weight;
                ctx.globalAlpha = opacity;

                const lls = el.getLatLngs();
                const segments = Array.isArray(lls[0]) ? lls : [lls]; // MultiPolyline → tableau
                segments.forEach(seg => {
                    const pts = seg.map(ll => {
                        const lat = ll instanceof L.LatLng ? ll.lat : ll[0];
                        const lng = ll instanceof L.LatLng ? ll.lng : ll[1];
                        return toPixel(lat, lng);
                    });
                    if (pts.length < 2) return;
                    ctx.beginPath();
                    ctx.moveTo(pts[0].x, pts[0].y);
                    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
                    if (el instanceof L.Polygon) ctx.closePath();
                    ctx.stroke();

                    if (el instanceof L.Polygon && el.options.fill) {
                        ctx.fillStyle   = el.options.fillColor   || color;
                        ctx.globalAlpha = el.options.fillOpacity != null ? el.options.fillOpacity : 0.2;
                        ctx.fill();
                    }
                });
                ctx.restore();
            }
            // L.Marker : non rendu (divIcon HTML → canvas impossible sans html2canvas)
        });
    }

    // ── Helpers ─────────────────────────────────────────────────────────────

    _calcZoom(bbox, targetW) {
        for (let z = 20; z >= 0; z--) {
            const w = itpLatLonToWorldPixels(bbox.north, bbox.west, z);
            const e = itpLatLonToWorldPixels(bbox.north, bbox.east, z);
            if ((e.x - w.x) <= targetW) return z;
        }
        return 15;
    }

    _getActiveTileInfo() {
        let info = null;
        this.map.eachLayer(l => {
            if (!info && l instanceof L.TileLayer && l._url) {
                info = { url: l._url, options: l.options };
            }
        });
        return info;
    }

    _buildTileUrl(tileInfo, x, y, z) {
        let url  = tileInfo.url;
        const opts = tileInfo.options || {};

        if (url.includes('{q}') && typeof coordsToQuadKey === 'function') {
            return url.replace('{q}', coordsToQuadKey(x, y, z));
        }

        const subList = opts.subdomains || 'abc';
        const subs    = Array.isArray(subList) ? subList : subList.split('');
        const s       = subs[(x + y) % subs.length] || '';

        return url
            .replace('{z}', z)
            .replace('{x}', x)
            .replace('{y}', y)
            .replace('{s}', s);
    }
}

// ---------------------------------------------------------------------------
// Initialisation : attendre carte + scripts
// ---------------------------------------------------------------------------

document.addEventListener('DOMContentLoaded', function () {
    // Attendre 250 ms pour laisser vector-toolbar.js créer l'instance vectorToolbar
    setTimeout(function () {
        if (typeof L === 'undefined' || !window.map) {
            console.warn('[LayerManager] Leaflet ou window.map non disponible.');
            return;
        }
        if (typeof itpLatLonToWorldPixels !== 'function') {
            console.warn('[LayerManager] itpLatLonToWorldPixels manquant (imagetoprint.js non chargé).');
        }
        window.layerManager = new LayerManager(window.map);
    }, 250);
});
