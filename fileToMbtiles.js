// fileToMbtiles.js — « Générer un MBTiles depuis un fichier » (mode Créer MBTiles).
//
// Transforme un PDF à l'échelle, un GeoTIFF ou un JP2 en .mbtiles pour CadoTour :
//   • PDF : des points d'appui relient le plan à la carte — un .points exporté
//     par CadoTour (positions sur la carte), dont on pointe chaque repère sur le
//     plan, ou des points posés ici, plan puis carte. Deux suffisent pour un plan
//     à l'échelle (similitude) ; trois et plus permettent une transformation
//     affine. L'écart de chaque point est affiché, en mètres.
//   • GeoTIFF : le géoréférencement est lu dans le fichier, rien à pointer.
//   • JP2 + J2W + XML : lecture par blocs dans un Web Worker avec OpenJPEG
//     WebAssembly. Le J2W prime sur les axes internes du JP2.
// Une sélection (rectangle, polygone éditable) ne garde que les zones voulues. Les
// niveaux de zoom sont proposés d'après la finesse du fichier (pixels d'image,
// taille du texte vectoriel), puis le fichier est rendu par BLOCS de 8 × 8 tuiles
// au zoom maximal — un rendu de PDF coûte surtout un temps fixe, quelle que soit
// la surface — et les niveaux inférieurs sont tirés de ces tuiles.
//
// Chargé à la demande (bouton « Générer depuis un fichier » du mode Créer
// MBTiles), avec fileToMbtilesCore.js (calculs, testés sous Node) ; pdf.js,
// geotiff.js et proj4 ne le sont qu'à l'ouverture d'un fichier qui en a besoin.

const FTM_BLOCK_TILES = 8;                 // côté d'un bloc rendu d'un seul tenant, en tuiles
const FTM_STRIP_BLOCKS = 3;                // largeur des bandes verticales de blocs, rendues l'une après l'autre
const FTM_PREVIEW_MAX = 3000;              // aperçu du fichier : plus grand côté, en pixels
const FTM_MAX_TILES = 400000;              // au-delà, le fichier final dépasse ce que le navigateur assemble

let ftmState = null;                        // état de la fenêtre ouverte
let ftmJobCounter = 1;

// ===== Petits outils =====

function ftmEl(tag, attrs = {}, ...children) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
        if (k === 'class') e.className = v;
        else if (k === 'text') e.textContent = v;
        else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
        else if (v !== false && v != null) e.setAttribute(k, v === true ? '' : v);
    }
    for (const c of children) if (c != null) e.append(c);
    return e;
}

const ftmNum = (v, d = 0) => Number(v).toLocaleString('fr-FR', { maximumFractionDigits: d, minimumFractionDigits: d });

function ftmFormatMeters(m) {
    if (!Number.isFinite(m)) return '—';
    if (m < 0.1) return `${ftmNum(m * 100, 1)} cm`;
    if (m < 10) return `${ftmNum(m, 2)} m`;
    if (m < 1000) return `${ftmNum(m, 0)} m`;
    return `${ftmNum(m / 1000, 2)} km`;
}

async function ftmWebpSupported() {
    const c = document.createElement('canvas'); c.width = c.height = 1;
    return c.toDataURL('image/webp').startsWith('data:image/webp');
}

// ===== Sources : PDF =====

async function ftmLoadPdfJs() {
    if (window.__ftmPdfjs) return window.__ftmPdfjs;
    const lib = await import(new URL('vendor/pdfjs/pdf.min.js', document.baseURI).href);
    lib.GlobalWorkerOptions.workerSrc = new URL('vendor/pdfjs/pdf.worker.min.js', document.baseURI).href;
    window.__ftmPdfjs = lib;
    return lib;
}

async function ftmOpenPdf(file) {
    const pdfjs = await ftmLoadPdfJs();
    const data = new Uint8Array(await file.arrayBuffer());
    const doc = await pdfjs.getDocument({ data, useSystemFonts: true }).promise;
    const src = {
        kind: 'pdf', name: file.name, doc, pages: doc.numPages, page: null, pageNo: 1,
        needsPoints: true, unit: 'pt', width: 0, height: 0, affine: true, T: null,
        async setPage(n) {
            this.pageNo = n;
            this.page = await doc.getPage(n);
            this.viewport = this.page.getViewport({ scale: 1 });
            this.width = this.viewport.width; this.height = this.viewport.height;
            this._analysis = null;
        },
        // Rend la page sur ctx, M = matrice canevas « unités source → pixels ».
        render(ctx, M) {
            const task = this.page.render({ canvasContext: ctx, viewport: this.viewport, transform: M });
            const p = task.promise;
            p.cancel = () => task.cancel();
            return p;
        },
        toMerc(x, y) { return ftmApply(this.T, x, y); },
        mercToSource(X, Y) { return ftmApply(ftmInvert(this.T), X, Y); },
        // Finesse du contenu : tailles du texte, densité des images (pixels par point).
        async analyse() {
            if (this._analysis) return this._analysis;
            const textSizes = [];
            try {
                const tc = await this.page.getTextContent();
                for (const it of tc.items) {
                    const n = (it.str || '').replace(/\s/g, '').length;
                    if (!n || !it.transform) continue;
                    textSizes.push({ size: Math.hypot(it.transform[2], it.transform[3]), weight: n });
                }
            } catch { /* pas de texte lisible */ }
            let raster = null;
            try { raster = await ftmPdfImageDensity(this.page, pdfjs.OPS, this.width * this.height); } catch { /* sans images */ }
            this._analysis = { textSizes, rasterPxPerUnit: raster };
            return this._analysis;
        },
        info() { return `PDF, page ${this.pageNo}/${this.pages} — ${ftmNum(this.width * 25.4 / 72 / 10, 1)} × ${ftmNum(this.height * 25.4 / 72 / 10, 1)} cm`; },
    };
    await src.setPage(1);
    return src;
}

// Densité (pixels par point PDF) de la plus grande image de la page, d'après la
// matrice courante au moment où elle est peinte. null s'il n'y a pas d'image
// couvrant au moins 2 % de la page.
async function ftmPdfImageDensity(page, OPS, pageArea) {
    const ops = await page.getOperatorList();
    const stack = [];
    let ctm = [1, 0, 0, 1, 0, 0], best = null;
    const mul = (m, n) => [m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1], m[0] * n[2] + m[2] * n[3],
        m[1] * n[2] + m[3] * n[3], m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]];
    for (let i = 0; i < ops.fnArray.length; i++) {
        const fn = ops.fnArray[i], args = ops.argsArray[i];
        if (fn === OPS.save) stack.push(ctm);
        else if (fn === OPS.restore) ctm = stack.pop() || ctm;
        else if (fn === OPS.transform) ctm = mul(ctm, args);
        else if (fn === OPS.paintFormXObjectBegin) { stack.push(ctm); if (args?.[0]) ctm = mul(ctm, args[0]); }
        else if (fn === OPS.paintFormXObjectEnd) ctm = stack.pop() || ctm;
        else if (fn === OPS.paintImageXObject || fn === OPS.paintInlineImageXObject) {
            const w = fn === OPS.paintImageXObject ? args[1] : args[0]?.width;
            const h = fn === OPS.paintImageXObject ? args[2] : args[0]?.height;
            const sx = Math.hypot(ctm[0], ctm[1]), sy = Math.hypot(ctm[2], ctm[3]);
            if (!(w > 0 && h > 0 && sx > 0 && sy > 0)) continue;
            const area = sx * sy;
            if (area < 0.02 * pageArea) continue;
            if (!best || area > best.area) best = { area, density: Math.sqrt((w / sx) * (h / sy)) };
        }
    }
    return best ? best.density : null;
}

// ===== Sources : GeoTIFF =====

async function ftmOpenTiff(file) {
    await loadScriptOnce('vendor/geotiff/geotiff.js');
    await loadScriptOnce('vendor/proj4/proj4.js');
    const tiff = await GeoTIFF.fromBlob(file);
    const image = await tiff.getImage(0);
    const levels = [image];
    const count = await tiff.getImageCount();
    for (let i = 1; i < count; i++) {
        const im = await tiff.getImage(i);
        // Aperçus (overviews) : même emprise, moins de pixels ; les masques sont ignorés.
        if (im.getWidth() < image.getWidth() && im.getSamplesPerPixel() === image.getSamplesPerPixel()) levels.push(im);
    }
    levels.sort((a, b) => b.getWidth() - a.getWidth());
    const geoKeys = image.getGeoKeys() || {};
    // geotiff.js 3 : étiquettes lues par getValue ; les versions antérieures les exposaient en propriétés.
    const fd = image.fileDirectory, tag = n => (typeof fd.getValue === 'function' ? fd.getValue(n) : fd[n]) ?? undefined;
    const P = ftmGeoTiffPixelTransform({ ModelTransformation: tag('ModelTransformation'), ModelTiepoint: tag('ModelTiepoint'), ModelPixelScale: tag('ModelPixelScale') }, geoKeys);
    if (!P) throw new Error("Ce TIFF ne porte pas de géoréférencement (ni ModelTiepoint ni ModelTransformation) : c'est une image simple, sans position sur la carte.");
    const epsg = ftmGeoTiffEpsg(geoKeys);
    const def = epsg ? ftmProjDefinition(epsg) : null;
    if (!def) throw new Error(`Système de coordonnées ${epsg ? 'EPSG:' + epsg : 'non indiqué'} non pris en charge. Reprojeter le GeoTIFF en Lambert 93 (EPSG:2154), en WGS84 (EPSG:4326), en Web Mercator (EPSG:3857) ou en UTM.`);
    const MERC = ftmProjDefinition(3857);
    const fwd = epsg === 3857 ? (x, y) => [x, y] : proj4(def, MERC).forward;
    const inv = epsg === 3857 ? (x, y) => [x, y] : proj4(def, MERC).inverse;
    const Pi = ftmInvert(P);
    const noData = image.getGDALNoData();
    const src = {
        kind: 'tiff', name: file.name, needsPoints: false, unit: 'px', affine: false, epsg,
        width: image.getWidth(), height: image.getHeight(),
        toMerc(x, y) { const [cx, cy] = ftmApply(P, x, y); const r = fwd([cx, cy]); return [r[0], r[1]]; },
        mercToSource(X, Y) { const r = inv([X, Y]); return ftmApply(Pi, r[0], r[1]); },
        render(ctx, M, w, h, options = {}) {
            let cancelled = false;
            const p = (async () => {
                const Mi = ftmInvert(M), [u0, v0, u1, v1] = options.region || [0, 0, w, h];
                const cs = [[u0, v0], [u1, v0], [u0, v1], [u1, v1]].map(([u, v]) => ftmApply(Mi, u, v));
                const x0 = Math.max(0, Math.floor(Math.min(...cs.map(c => c[0])))), x1 = Math.min(this.width, Math.ceil(Math.max(...cs.map(c => c[0]))));
                const y0 = Math.max(0, Math.floor(Math.min(...cs.map(c => c[1])))), y1 = Math.min(this.height, Math.ceil(Math.max(...cs.map(c => c[1]))));
                if (x1 <= x0 || y1 <= y0) return;
                const scale = Math.hypot(M[0], M[1]);                 // pixels canevas par pixel source
                let level = levels[0];
                for (const lv of levels) if (this.width / lv.getWidth() <= 1 / scale) level = lv;   // aperçu assez fin
                const f = this.width / level.getWidth();
                const lx0 = Math.floor(x0 / f), ly0 = Math.floor(y0 / f);
                const lx1 = Math.min(level.getWidth(), Math.ceil(x1 / f)), ly1 = Math.min(level.getHeight(), Math.ceil(y1 / f));
                const ww = lx1 - lx0, wh = ly1 - ly0;
                if (ww <= 0 || wh <= 0) return;
                const k = Math.min(1, 4096 / Math.max(ww, wh));       // lecture bornée
                const ow = Math.max(1, Math.round(ww * k)), oh = Math.max(1, Math.round(wh * k));
                const rgb = await level.readRGB({ window: [lx0, ly0, lx1, ly1], width: ow, height: oh, interleave: true, enableAlpha: true });
                if (cancelled) return;
                const ch = rgb.length / (ow * oh);
                const img = new ImageData(ow, oh);
                for (let i = 0, j = 0; i < ow * oh; i++, j += ch) {
                    img.data[4 * i] = rgb[j]; img.data[4 * i + 1] = rgb[j + 1]; img.data[4 * i + 2] = rgb[j + 2];
                    let a = ch === 4 ? rgb[j + 3] : 255;
                    if (noData != null && rgb[j] === noData && rgb[j + 1] === noData && rgb[j + 2] === noData) a = 0;
                    img.data[4 * i + 3] = a;
                }
                const tmp = document.createElement('canvas'); tmp.width = ow; tmp.height = oh;
                tmp.getContext('2d').putImageData(img, 0, 0);
                // Pixel (i, j) de la lecture ↔ pixel source (lx0·f + i·ww·f/ow, …).
                const W2S = [ww * f / ow, 0, 0, wh * f / oh, lx0 * f, ly0 * f];
                ctx.save();
                ctx.setTransform(...ftmMultiply(M, W2S));
                ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
                ctx.drawImage(tmp, 0, 0);
                ctx.restore();
            })();
            p.cancel = () => { cancelled = true; };
            return p;
        },
        async analyse() { return { textSizes: [], rasterPxPerUnit: 1 }; },
        info() {
            const c = this.toMerc(this.width / 2, this.height / 2), d = this.toMerc(this.width / 2 + 1, this.height / 2);
            const lat = ftmMercToLonLat(...c)[1];
            const px = Math.hypot(d[0] - c[0], d[1] - c[1]) * Math.cos(lat * Math.PI / 180);
            return `GeoTIFF EPSG:${epsg} — ${ftmNum(this.width)} × ${ftmNum(this.height)} px, pixel de ${ftmFormatMeters(px)}`;
        },
    };
    return src;
}

// ===== Sources : JPEG 2000 (navigateur, Web Worker et OpenJPEG WASM) =====

async function ftmOpenJp2(file, companions) {
    await loadScriptOnce('jpeg2000Source.js');
    return ftmOpenJp2Mosaic(companions, {
        epsgText: ftmState.$('ftm-jp2-epsg').value.trim(),
        bandsText: ftmState.$('ftm-jp2-bands').value.trim(),
        excludeBlack: ftmState.$('ftm-black').checked,
    });
}

// ===== Visionneuse du fichier (aperçu, zoom, pointage, sélection) =====

class FtmViewer {
    constructor(container, { onPlace, onSelectionChange }) {
        this.box = container;
        this.canvas = ftmEl('canvas', { class: 'ftm-viewer-canvas' });
        this.status = ftmEl('div', { class: 'ftm-viewer-status' });
        this.box.append(this.canvas, this.status);
        this.onPlace = onPlace;
        this.onSelectionChange = onSelectionChange;
        this.source = null;
        this.base = null;            // { canvas, M } aperçu entier
        this.detail = null;          // { canvas, V } rendu fin de la vue
        this.view = { s: 1, ox: 0, oy: 0 };
        this.tool = 'pan';
        this.polys = [];             // zones gardées, en unités source
        this.drawing = null;
        this.points = [];
        this.selected = -1;
        this.selectedPoly = -1;
        this.selectedVertex = -1;
        this.history = [];
        this._detailTimer = null;
        this._renderTask = null;
        new ResizeObserver(() => this.resize()).observe(this.box);
        this._bind();
    }

    setStatus(t) { this.status.textContent = t || ''; this.status.hidden = !t; }

    async setSource(src, preserveSelection = false) {
        const s = Math.min(FTM_PREVIEW_MAX / src.width, FTM_PREVIEW_MAX / src.height, 4);
        const c = document.createElement('canvas');
        c.width = Math.max(1, Math.round(src.width * s)); c.height = Math.max(1, Math.round(src.height * s));
        this.setStatus('Rendu de l’aperçu…');
        const M = [s, 0, 0, s, 0, 0];
        await src.render(c.getContext('2d'), M, c.width, c.height);
        this._renderTask?.cancel?.(); clearTimeout(this._detailTimer);
        this.source = src; this.detail = null; this.drawing = null;
        if (!preserveSelection) { this.polys = []; this.selectedPoly = this.selectedVertex = -1; this.history = []; }
        this.base = { canvas: c, M };
        this.resize(); if (!preserveSelection) this.fit();
        this.setStatus('');
        this.draw();
        this.scheduleDetail();
    }

    resize() {
        const r = this.box.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
        this.canvas.width = Math.max(1, Math.round(r.width * dpr)); this.canvas.height = Math.max(1, Math.round(r.height * dpr));
        this.canvas.style.width = r.width + 'px'; this.canvas.style.height = r.height + 'px';
        this.dpr = dpr; this.draw();
    }

    fit() {
        if (!this.source) return;
        const W = this.canvas.width, H = this.canvas.height;
        const s = 0.95 * Math.min(W / this.source.width, H / this.source.height);
        this.view = { s, ox: (W - this.source.width * s) / 2, oy: (H - this.source.height * s) / 2 };
        this.draw(); this.scheduleDetail();
    }

    V() { const v = this.view; return [v.s, 0, 0, v.s, v.ox, v.oy]; }
    toSource(px, py) { return [(px - this.view.ox) / this.view.s, (py - this.view.oy) / this.view.s]; }
    eventPoint(e) { const r = this.canvas.getBoundingClientRect(); return [(e.clientX - r.left) * this.dpr, (e.clientY - r.top) * this.dpr]; }

    // Rendu fin de la vue courante, quand on est zoomé au-delà de l'aperçu.
    scheduleDetail() {
        clearTimeout(this._detailTimer);
        if (!this.source || !this.base) return;
        if (this.view.s <= this.base.M[0] * 1.25) { this.detail = null; return; }
        this._detailTimer = setTimeout(() => this.renderDetail(), 350);
    }

    async renderDetail() {
        this._renderTask?.cancel?.();
        const src = this.source, V = this.V();
        const c = document.createElement('canvas'); c.width = this.canvas.width; c.height = this.canvas.height;
        const ctx = c.getContext('2d');
        this.setStatus('Affinage…');
        const task = src.render(ctx, V, c.width, c.height);
        this._renderTask = task;
        try { await task; } catch { return; }
        if (this._renderTask !== task || this.source !== src) return;
        // Ce qui sort de la page reste transparent (le blanc de pdf.js déborde du cadre).
        ctx.globalCompositeOperation = 'destination-in';
        ctx.setTransform(...V); ctx.fillRect(0, 0, src.width, src.height);
        this.detail = { canvas: c, V };
        this.setStatus('');
        this.draw();
    }

    draw() {
        const ctx = this.canvas.getContext('2d');
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        if (!this.source) return;
        const V = this.V();
        ctx.imageSmoothingEnabled = true;
        if (this.base) {
            ctx.setTransform(...ftmMultiply(V, ftmInvert(this.base.M)));
            ctx.drawImage(this.base.canvas, 0, 0);
        }
        if (this.detail) {
            ctx.setTransform(...ftmMultiply(V, ftmInvert(this.detail.V)));
            ctx.drawImage(this.detail.canvas, 0, 0);
        }
        // Cadre du fichier
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.lineWidth = 1;
        ctx.strokeRect(this.view.ox, this.view.oy, this.source.width * this.view.s, this.source.height * this.view.s);
        // Zones gardées
        const path = poly => { ctx.beginPath(); poly.forEach(([x, y], i) => { const px = x * this.view.s + this.view.ox, py = y * this.view.s + this.view.oy; i ? ctx.lineTo(px, py) : ctx.moveTo(px, py); }); };
        for (const poly of this.polys) {
            path(poly); ctx.closePath();
            ctx.fillStyle = 'rgba(37,99,235,0.12)'; ctx.fill();
            ctx.strokeStyle = '#2563eb'; ctx.lineWidth = 2 * this.dpr; ctx.stroke();
        }
        if (this.drawing?.pts.length > 1) {
            path(this.drawing.pts); if (this.drawing.kind === 'rect') ctx.closePath();
            ctx.setLineDash([6 * this.dpr, 4 * this.dpr]); ctx.strokeStyle = '#2563eb'; ctx.lineWidth = 2 * this.dpr; ctx.stroke(); ctx.setLineDash([]);
        }
        const handles = this.tool === 'edit' ? this.handles() : [];
        if (this.drawing?.kind === 'polygon') this.drawing.pts.forEach((p, i) => handles.push({ p, kind: i ? 'vertex' : 'close' }));
        for (const handle of handles) {
            const [x, y] = ftmApply(V, ...handle.p), mid = handle.kind === 'mid';
            ctx.beginPath(); ctx.arc(x, y, (mid ? 4 : 6) * this.dpr, 0, Math.PI * 2);
            ctx.fillStyle = mid ? '#60a5fa' : handle.kind === 'close' || handle.i === this.selectedVertex ? '#fbbf24' : '#fff';
            ctx.fill(); ctx.strokeStyle = '#2563eb'; ctx.lineWidth = 2 * this.dpr; ctx.stroke();
        }
        // Points d'appui
        this.points.forEach((p, i) => {
            if (!Number.isFinite(p.x)) return;
            const px = p.x * this.view.s + this.view.ox, py = p.y * this.view.s + this.view.oy, d = this.dpr;
            const sel = i === this.selected;
            ctx.strokeStyle = '#fff'; ctx.lineWidth = 4 * d;
            ctx.beginPath(); ctx.moveTo(px - 10 * d, py); ctx.lineTo(px + 10 * d, py); ctx.moveTo(px, py - 10 * d); ctx.lineTo(px, py + 10 * d); ctx.stroke();
            ctx.strokeStyle = sel ? '#f59e0b' : (p.enabled === false ? '#9ca3af' : '#dc2626'); ctx.lineWidth = 2 * d; ctx.stroke();
            ctx.font = `bold ${13 * d}px sans-serif`; ctx.lineWidth = 3 * d; ctx.strokeStyle = '#fff';
            ctx.strokeText(String(i + 1), px + 7 * d, py - 7 * d); ctx.fillStyle = ctx.strokeStyle = sel ? '#b45309' : '#991b1b';
            ctx.fillText(String(i + 1), px + 7 * d, py - 7 * d);
        });
    }

    zoomAt(px, py, k) {
        const v = this.view, s = Math.min(Math.max(v.s * k, 1e-4), 400);
        this.view = { s, ox: px - (px - v.ox) * s / v.s, oy: py - (py - v.oy) * s / v.s };
        this.draw(); this.scheduleDetail();
    }

    setTool(t) { this.tool = t; this.drawing = null; this.canvas.dataset.tool = t; this.draw(); }

    selectionChanged() { this.draw(); this.onSelectionChange?.(); }
    copyPolys() { return this.polys.map(poly => poly.map(p => p.slice())); }
    remember(polys = this.copyPolys()) { this.history.push(polys); if (this.history.length > 50) this.history.shift(); }
    clampPoint(p) { return [Math.min(Math.max(p[0], 0), this.source.width), Math.min(Math.max(p[1], 0), this.source.height)]; }
    handles() {
        const poly = this.polys[this.selectedPoly];
        if (!poly) return [];
        return poly.map((p, i) => ({ p, i, kind: 'vertex' })).concat(poly.map((p, i) => {
            const q = poly[(i + 1) % poly.length]; return { p: [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2], i: i + 1, kind: 'mid' };
        }));
    }
    hitHandle(x, y, touch = false) {
        const radius = (touch ? 18 : 10) * this.dpr;
        return this.handles().find(h => { const p = ftmApply(this.V(), ...h.p); return Math.hypot(p[0] - x, p[1] - y) <= radius; });
    }
    finishPolygon() {
        const pts = this.drawing?.kind === 'polygon' && this.drawing.pts;
        if (!pts || pts.length < 3 || ftmPolygonArea(pts) < 1e-8) return;
        this.remember(); this.polys.push(pts.map(p => p.slice())); this.selectedPoly = this.polys.length - 1;
        this.selectedVertex = -1;
        ftmSetTool('edit'); this.selectionChanged();
    }
    removeVertex(index = this.selectedVertex) {
        const poly = this.polys[this.selectedPoly];
        if (!poly || poly.length <= 3 || index < 0 || index >= poly.length) return;
        const next = poly.filter((p, i) => i !== index);
        if (ftmPolygonArea(next) < 1e-8) return;
        this.remember(); this.polys[this.selectedPoly] = next; this.selectedVertex = -1; this.selectionChanged();
    }
    removePolygon() {
        if (!this.polys[this.selectedPoly]) return;
        this.remember(); this.polys.splice(this.selectedPoly, 1); this.selectedPoly = this.selectedVertex = -1; this.selectionChanged();
    }
    undo() {
        if (this.drawing?.kind === 'polygon') { this.drawing.pts.pop(); if (!this.drawing.pts.length) this.drawing = null; }
        else if (this.history.length) { this.polys = this.history.pop(); this.selectedPoly = this.selectedVertex = -1; }
        this.selectionChanged();
    }

    _bind() {
        const c = this.canvas;
        c.tabIndex = 0;
        c.setAttribute('aria-label', 'Sélection sur le fichier : polygones et sommets modifiables');
        c.addEventListener('wheel', e => { e.preventDefault(); const [x, y] = this.eventPoint(e); this.zoomAt(x, y, Math.exp(-e.deltaY * 0.0015)); }, { passive: false });
        let drag = null, longPress, ignoreContextUntil = 0;
        c.addEventListener('pointerdown', e => {
            if (!this.source || ftmState?.opening) return;
            c.focus({ preventScroll: true });
            c.setPointerCapture(e.pointerId);
            const [x, y] = this.eventPoint(e);
            const p = this.clampPoint(this.toSource(x, y));
            const handle = this.tool === 'edit' && this.hitHandle(x, y, e.pointerType === 'touch');
            if (e.button === 2 && handle) return;
            drag = { x, y, x0: x, y0: y, p, kind: 'pan', moved: false, button: e.button };
            if (e.button !== 0) return;
            if (this.tool === 'polygon') drag.kind = 'polygon';
            if (this.tool === 'rect') { drag.kind = 'rect'; this.drawing = { kind: 'rect', start: p, pts: [p] }; }
            if (this.tool === 'edit') {
                const before = this.copyPolys();
                if (handle) {
                    if (handle.kind === 'mid') this.polys[this.selectedPoly].splice(handle.i, 0, handle.p.slice());
                    this.selectedVertex = handle.i; drag.kind = 'vertex'; drag.before = before;
                    if (e.pointerType !== 'mouse' && handle.kind === 'vertex') longPress = setTimeout(() => {
                        drag = null; ignoreContextUntil = Date.now() + 1000; this.removeVertex(handle.i);
                    }, 550);
                } else {
                    this.selectedPoly = this.polys.findLastIndex(poly => ftmPointInPolygon(p, poly)); this.selectedVertex = -1;
                    if (this.selectedPoly >= 0) { drag.kind = 'shape'; drag.before = before; }
                }
                this.selectionChanged();
            }
        });
        c.addEventListener('pointermove', e => {
            if (!drag) return;
            const [x, y] = this.eventPoint(e);
            if (Math.hypot(x - drag.x0, y - drag.y0) > 4 * this.dpr) { drag.moved = true; clearTimeout(longPress); }
            if (drag.kind === 'pan') {
                this.view.ox += x - drag.x; this.view.oy += y - drag.y; drag.x = x; drag.y = y;
                this.draw();
            } else {
                const p = this.clampPoint(this.toSource(x, y));
                if (drag.kind === 'rect' && this.drawing) {
                    const [sx, sy] = this.drawing.start;
                    this.drawing.pts = [[sx, sy], [p[0], sy], [p[0], p[1]], [sx, p[1]]];
                } else if (drag.kind === 'vertex') this.polys[this.selectedPoly][this.selectedVertex] = p;
                else if (drag.kind === 'shape' && drag.moved) {
                    const poly = drag.before[this.selectedPoly], b = ftmPolygonBounds([poly]);
                    const dx = Math.max(-b.x0, Math.min(this.source.width - b.x1, p[0] - drag.p[0]));
                    const dy = Math.max(-b.y0, Math.min(this.source.height - b.y1, p[1] - drag.p[1]));
                    this.polys[this.selectedPoly] = poly.map(q => [q[0] + dx, q[1] + dy]);
                }
                this.draw();
            }
        });
        const end = e => {
            clearTimeout(longPress);
            if (!drag) return;
            const [x, y] = this.eventPoint(e);
            if (drag.kind === 'pan' && drag.moved) this.scheduleDetail();
            if (!drag.moved && this.tool === 'place' && drag.button === 0) this.onPlace?.(...this.toSource(x, y));
            if (drag.kind === 'polygon' && !drag.moved) {
                const p = this.clampPoint(this.toSource(x, y));
                if (!this.drawing) this.drawing = { kind: 'polygon', pts: [] };
                const pts = this.drawing.pts, first = pts[0], last = pts.at(-1);
                if (pts.length >= 3 && Math.hypot(p[0] - first[0], p[1] - first[1]) * this.view.s <= 10 * this.dpr) { this.finishPolygon(); this._justFinished = Date.now(); }
                else if (!last || Math.hypot(p[0] - last[0], p[1] - last[1]) * this.view.s > 3 * this.dpr) pts.push(p);
            }
            if (drag.kind === 'rect' && this.drawing) {
                const poly = this.drawing.pts.map(([px, py]) => [Math.min(Math.max(px, 0), this.source.width), Math.min(Math.max(py, 0), this.source.height)]);
                if (poly.length >= 3 && ftmPolygonArea(poly) > 1e-6 * this.source.width * this.source.height) {
                    this.remember(); this.polys.push(poly); this.selectedPoly = this.polys.length - 1; this.selectedVertex = -1;
                    ftmSetTool('edit');
                }
                this.drawing = null; this.draw();
            }
            if (drag.before && (drag.moved || JSON.stringify(drag.before) !== JSON.stringify(this.polys))) {
                if (ftmPolygonArea(this.polys[this.selectedPoly]) < 1e-8) this.polys = drag.before;
                else this.remember(drag.before);
            }
            drag = null;
            this.selectionChanged();
        };
        c.addEventListener('pointerup', end);
        c.addEventListener('pointercancel', () => { clearTimeout(longPress); if (drag?.before) this.polys = drag.before; drag = null; this.drawing = null; this.selectionChanged(); });
        c.addEventListener('contextmenu', e => {
            e.preventDefault(); clearTimeout(longPress); drag = null;
            if (Date.now() < ignoreContextUntil) return;
            if (this.tool === 'edit') { const h = this.hitHandle(...this.eventPoint(e)); if (h?.kind === 'vertex') this.removeVertex(h.i); }
        });
        c.addEventListener('dblclick', e => {
            e.preventDefault();
            if (this.tool === 'polygon') this.finishPolygon();
            else if (this.tool === 'edit' && Date.now() - (this._justFinished || 0) > 400) {
                const h = this.hitHandle(...this.eventPoint(e)); if (h?.kind === 'vertex') this.removeVertex(h.i);
            }
        });
        c.addEventListener('keydown', e => {
            if (e.key === 'Enter') this.finishPolygon();
            else if (e.key === 'Escape') { this.drawing = null; this.selectionChanged(); }
            else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' || e.key === 'Backspace' && this.drawing) this.undo();
            else if (e.key === 'Delete' || e.key === 'Backspace') this.selectedVertex >= 0 ? this.removeVertex() : this.removePolygon();
            else return;
            e.preventDefault();
        });
    }
}

// ===== Aperçu du fichier posé sur la carte =====
//
// L'image d'aperçu, placée par une matrice CSS calculée à partir de trois de
// ses coins : exacte pour un PDF (transformation affine), très proche pour un
// GeoTIFF projeté (la déformation sur l'emprise d'un aperçu reste minime).

const FtmPreviewLayer = (typeof L !== 'undefined') ? L.Layer.extend({
    initialize(getState) { this._get = getState; this._opacity = 0.6; },
    onAdd(map) {
        this._img = L.DomUtil.create('canvas', 'ftm-preview-overlay leaflet-zoom-hide');
        this._img.style.transformOrigin = '0 0';
        this._img.style.position = 'absolute';
        this._img.style.pointerEvents = 'none';
        map.getPanes().overlayPane.appendChild(this._img);
        map.on('zoomend viewreset moveend', this.update, this);
        this.update();
    },
    onRemove(map) { this._img?.remove(); map.off('zoomend viewreset moveend', this.update, this); },
    setOpacity(o) { this._opacity = o; if (this._img) this._img.style.opacity = o; },
    update() {
        const st = this._get();
        if (!this._map || !st?.base || !st.toMerc) { if (this._img) this._img.style.display = 'none'; return; }
        const { canvas: bc, M } = st.base;
        if (this._img.width !== bc.width || this._img.height !== bc.height || this._img._src !== bc) {
            this._img.width = bc.width; this._img.height = bc.height; this._img._src = bc;
            this._img.getContext('2d').drawImage(bc, 0, 0);
        }
        const Mi = ftmInvert(M);
        const lp = (u, v) => {
            const [x, y] = ftmApply(Mi, u, v), [X, Y] = st.toMerc(x, y), [lon, lat] = ftmMercToLonLat(X, Y);
            return this._map.latLngToLayerPoint([lat, lon]);
        };
        const p0 = lp(0, 0), p1 = lp(bc.width, 0), p2 = lp(0, bc.height);
        const a = (p1.x - p0.x) / bc.width, b = (p1.y - p0.y) / bc.width, c = (p2.x - p0.x) / bc.height, d = (p2.y - p0.y) / bc.height;
        this._img.style.display = '';
        this._img.style.opacity = this._opacity;
        this._img.style.transform = `matrix(${a},${b},${c},${d},${p0.x},${p0.y})`;
    },
}) : null;

// ===== Fenêtre =====

function ftmBuildModal() {
    const modal = ftmEl('div', { id: 'ftm-modal', class: 'ftm-modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Générer un MBTiles depuis un fichier' });
    modal.innerHTML = `
      <div class="ftm-header">
        <strong>Générer un MBTiles depuis un fichier</strong>
        <span class="ftm-sub">PDF, GeoTIFF ou JP2 + J2W → .mbtiles lisible par CadoTour</span>
        <button type="button" class="ftm-close" data-act="close" aria-label="Fermer">✕</button>
      </div>
      <div class="ftm-body">
        <aside class="ftm-side">
          <section class="ftm-step">
            <h4>1. Fichier</h4>
            <label class="ftm-btn ftm-btn-main">Choisir les fichiers…
              <input type="file" id="ftm-file" accept=".pdf,.tif,.tiff,.jp2,.j2w,.jp2w,.wld,.xml,application/pdf,image/tiff" multiple hidden></label>
            <p class="ftm-note">Un PDF, un GeoTIFF, ou plusieurs JP2 jointifs avec leurs J2W et XML, sélectionnés ensemble. Les parties compatibles seront assemblées dans un seul MBTiles.</p>
            <details class="ftm-note">
              <summary>Options JP2 (projection et bandes)</summary>
              <p>Le JP2 est traité directement dans le navigateur, par blocs. Aucun logiciel à installer. Le J2W est prioritaire pour la position ; le XML ou le JP2 fournit la projection.</p>
              <label class="ftm-row">EPSG <input id="ftm-jp2-epsg" class="ftm-input" inputmode="numeric" placeholder="Automatique (XML / JP2)"></label>
              <label class="ftm-row">Bandes RVB <input id="ftm-jp2-bands" class="ftm-input" placeholder="Automatique, ou 1,2,3"></label>
              <p>Le J2W donne la position, pas la projection. Si elle manque, saisir le code EPSG avant d'ouvrir les fichiers. Une bande infrarouge n'est pas utilisée comme transparence. Bandes : une bande grise ou trois numéros dans l'ordre rouge, vert, bleu.</p>
            </details>
            <div id="ftm-file-info" class="ftm-note"></div>
            <label class="ftm-note" id="ftm-black-row"><input type="checkbox" id="ftm-black" checked> Exclure le noir pur #000000 des JP2</label>
            <p class="ftm-note">Les pixels noirs deviennent transparents, y compris au milieu d'une sélection. Décochez pour conserver les vrais éléments noirs. Les valeurs NoData déclarées restent exclues.</p>
            <label id="ftm-page-row" class="ftm-row" hidden>Page <select id="ftm-page"></select></label>
          </section>
          <section class="ftm-step" id="ftm-points-step" hidden>
            <h4>2. Points d'appui</h4>
            <p class="ftm-note">Un repère visible sur le plan ET sur la carte. Importez le <b>.points</b> relevé dans CadoTour puis pointez chaque repère sur le plan, ou ajoutez des points : clic sur le plan, puis sur la carte.</p>
            <div class="ftm-btns">
              <label class="ftm-btn">Importer .points<input type="file" id="ftm-points-file" accept=".points,.txt,.csv" hidden></label>
              <button type="button" class="ftm-btn" data-act="add-point">＋ Point</button>
              <button type="button" class="ftm-btn" data-act="export-points" title="Points complétés (positions sur le plan), relisibles ici ou par QGIS">Exporter .points</button>
            </div>
            <div id="ftm-hint" class="ftm-hint"></div>
            <table class="ftm-table"><thead><tr><th>N°</th><th title="Position sur le plan">Plan</th><th title="Position sur la carte">Carte</th><th>Écart</th><th></th></tr></thead><tbody id="ftm-points"></tbody></table>
            <label class="ftm-row">Transformation
              <select id="ftm-kind"><option value="similarity">Similitude (plan à l'échelle)</option><option value="affine">Affine (3 points et plus)</option></select></label>
            <div id="ftm-fit" class="ftm-note"></div>
          </section>
          <section class="ftm-step" id="ftm-geo-step" hidden>
            <h4>2. Géoréférencement</h4>
            <div id="ftm-geo-info" class="ftm-note"></div>
          </section>
          <section class="ftm-step">
            <h4>3. Zone à garder</h4>
            <div class="ftm-btns">
              <button type="button" class="ftm-btn" data-tool="pan">✋ Déplacer</button>
              <button type="button" class="ftm-btn" data-tool="rect">▭ Rectangle</button>
              <button type="button" class="ftm-btn" data-tool="polygon">⬡ Polygone</button>
              <button type="button" class="ftm-btn" data-tool="edit">✎ Modifier</button>
              <button type="button" class="ftm-btn" data-act="clear-zones">Tout le fichier</button>
            </div>
            <div class="ftm-btns">
              <button type="button" class="ftm-btn" data-act="finish-polygon" id="ftm-finish" disabled>Terminer</button>
              <button type="button" class="ftm-btn" data-act="undo-zone" id="ftm-undo" disabled>Annuler le dernier geste</button>
              <button type="button" class="ftm-btn" data-act="delete-vertex" id="ftm-delete-vertex" disabled>Supprimer le sommet</button>
              <button type="button" class="ftm-btn" data-act="delete-zone" id="ftm-delete-zone" disabled>Supprimer la zone</button>
            </div>
            <p class="ftm-note">Polygone : un clic par sommet, puis Terminer, double-clic ou clic sur le premier point. Modifier : glisser un sommet ou la zone ; les petites poignées ajoutent un sommet. Clic droit, double-clic ou appui long sur un sommet : supprimer (3 minimum).</p>
            <div id="ftm-zones" class="ftm-note">Tout le fichier.</div>
          </section>
          <section class="ftm-step">
            <h4>4. Fichier .mbtiles</h4>
            <label class="ftm-row">Nom <input type="text" id="ftm-name" class="ftm-input"></label>
            <div class="ftm-row">Zooms <select id="ftm-zmin"></select> à <select id="ftm-zmax"></select></div>
            <div id="ftm-zoom-why" class="ftm-note"></div>
            <label class="ftm-row">Format <select id="ftm-format"></select></label>
            <label class="ftm-note"><input type="checkbox" id="ftm-mnt"> Inclure le MNT pour le relief 3D dans CadoTour</label>
            <p class="ftm-note">Télécharge les altitudes Terrarium de la zone (connexion nécessaire), dans le même fichier. Résolution du relief indépendante de celle de la photo.</p>
            <div id="ftm-estimate" class="ftm-note"></div>
            <button type="button" class="ftm-btn ftm-btn-main" data-act="generate" id="ftm-generate" disabled>Générer le .mbtiles</button>
          </section>
        </aside>
        <div class="ftm-panes">
          <div class="ftm-pane"><div class="ftm-pane-title">Fichier <span class="ftm-note">— molette : zoom, glisser : déplacer</span></div><div id="ftm-viewer" class="ftm-viewer"></div></div>
          <div class="ftm-pane"><div class="ftm-pane-title">Carte <label class="ftm-note">aperçu <input type="range" id="ftm-opacity" min="0" max="100" value="60"></label></div><div id="ftm-map" class="ftm-map"></div></div>
        </div>
      </div>`;
    document.body.appendChild(modal);
    return modal;
}

async function openFileToMbtiles() {
    if (ftmState) { ftmState.modal.hidden = false; document.body.classList.add('ftm-open'); ftmState.map.invalidateSize(); ftmState.viewer.resize(); return; }
    const modal = ftmBuildModal();
    document.body.classList.add('ftm-open');
    const $ = id => modal.querySelector('#' + id);
    const st = ftmState = {
        modal, $, source: null, points: [], selected: -1, awaiting: null, T: null,
        kind: 'similarity', webp: await ftmWebpSupported(),
    };
    st.viewer = new FtmViewer($('ftm-viewer'), {
        onPlace: (x, y) => ftmPlaceOnPlan(x, y),
        onSelectionChange: () => ftmRefresh(),
    });
    // Carte : fonds de map-layers.js (couches simples et WMS).
    st.map = L.map($('ftm-map'), { zoomControl: true }).setView([46.6, 2.4], 6);
    const bases = {};
    (typeof MAP_LAYERS !== 'undefined' ? MAP_LAYERS : []).forEach(cfg => {
        if (cfg.requiresKey && !window[cfg.requiresKey]) return;
        if (cfg.layers.some(l => l.type === 'yandex' || l.type === 'quadkey')) return;
        const mk = l => l.type === 'wms'
            ? L.tileLayer.wms(l.url, { layers: l.layers, styles: l.styles || '', format: l.format || 'image/png', transparent: l.transparent !== false, version: l.version || '1.3.0', maxZoom: 22, maxNativeZoom: l.maxZoom ?? cfg.maxZoom ?? 19 })
            : L.tileLayer(l.url, { maxZoom: 22, maxNativeZoom: l.maxZoom ?? cfg.maxZoom ?? 19, subdomains: l.subdomains || 'abc' });
        bases[cfg.name] = cfg.layers.length > 1 ? L.layerGroup(cfg.layers.map(mk)) : mk(cfg.layers[0]);
    });
    const first = Object.values(bases)[0] || L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 22, maxNativeZoom: 19 });
    first.addTo(st.map);
    if (Object.keys(bases).length > 1) L.control.layers(bases, null, { collapsed: true }).addTo(st.map);
    st.markers = L.layerGroup().addTo(st.map);
    st.footprint = L.layerGroup().addTo(st.map);
    st.preview = new FtmPreviewLayer(() => (st.source && st.viewer.base && (!st.source.needsPoints || st.T)) ? { base: st.viewer.base, toMerc: (x, y) => st.source.toMerc(x, y) } : null);
    st.preview.addTo(st.map);
    st.map.on('click', e => ftmPlaceOnMap(e.latlng.lng, e.latlng.lat));

    // Événements
    modal.addEventListener('click', e => {
        const act = e.target.closest('[data-act]')?.dataset.act;
        const tool = e.target.closest('button[data-tool]')?.dataset.tool;
        if (tool) ftmSetTool(tool);
        if (act === 'close') { modal.hidden = true; document.body.classList.remove('ftm-open'); }
        if (act === 'add-point') ftmAddPoint();
        if (act === 'export-points') ftmExportPoints();
        if (act === 'clear-zones') { st.viewer.remember(); st.viewer.polys = []; st.viewer.selectedPoly = st.viewer.selectedVertex = -1; ftmSetTool('pan'); ftmRefresh(); }
        if (act === 'finish-polygon') st.viewer.finishPolygon();
        if (act === 'undo-zone') st.viewer.undo();
        if (act === 'delete-vertex') st.viewer.removeVertex();
        if (act === 'delete-zone') st.viewer.removePolygon();
        if (act === 'generate') ftmStartJob();
    });
    $('ftm-file').addEventListener('change', e => { const files = Array.from(e.target.files); e.target.value = ''; if (files.length) ftmOpenFile(files); });
    $('ftm-points-file').addEventListener('change', async e => {
        const f = e.target.files[0]; e.target.value = '';
        if (!f) return;
        try { ftmImportPoints(ftmParsePoints(await f.text())); } catch (err) { alert(err.message); }
    });
    $('ftm-page').addEventListener('change', async e => {
        await st.source.setPage(Number(e.target.value));
        await st.viewer.setSource(st.source);
        ftmRefresh();
    });
    $('ftm-kind').addEventListener('change', e => { st.kind = e.target.value; ftmRefresh(); });
    $('ftm-opacity').addEventListener('input', e => st.preview.setOpacity(e.target.value / 100));
    for (const id of ['ftm-zmin', 'ftm-zmax', 'ftm-format', 'ftm-mnt']) $(id).addEventListener('change', () => ftmUpdateEstimate());
    $('ftm-black').addEventListener('change', async e => {
        const src = st.source;
        if (!src || src.kind !== 'jp2' || st.opening) return;
        const previous = src.excludeBlack;
        src.excludeBlack = e.target.checked; st.opening = true;
        $('ftm-file').disabled = $('ftm-black').disabled = $('ftm-generate').disabled = true;
        try { await st.viewer.setSource(src, true); }
        catch (err) { src.excludeBlack = previous; e.target.checked = previous; st.viewer.setStatus(''); alert(err.message); }
        finally { st.opening = false; $('ftm-file').disabled = $('ftm-black').disabled = false; ftmRefresh(); }
    });
    const fmt = $('ftm-format');
    if (st.webp) fmt.append(new Option('WebP (léger, conseillé)', 'webp'));
    fmt.append(new Option('PNG (sans perte)', 'png'), new Option('JPEG (photos, sans transparence)', 'jpg'));
    for (let z = 0; z <= FTM_ZOOM_CEIL; z++) { $('ftm-zmin').append(new Option(z, z)); $('ftm-zmax').append(new Option(z, z)); }
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && !modal.hidden && st.awaiting) { st.awaiting = null; ftmRenderPoints(); } });
    setTimeout(() => { st.map.invalidateSize(); st.viewer.resize(); }, 50);
    ftmRefresh();
}

function ftmSetTool(tool) {
    const st = ftmState;
    st.viewer.setTool(tool === 'pan' && st.awaiting === 'plan' ? 'place' : tool);
    st.modal.querySelectorAll('button[data-tool]').forEach(b => b.classList.toggle('is-active', b.dataset.tool === tool));
    ftmRefresh();
}

async function ftmOpenFile(files) {
    const st = ftmState, $ = st.$;
    if (st.opening) return;
    let group;
    try { group = ftmGroupInputFiles(files); } catch (err) { alert(err.message); return; }
    const { file } = group;
    const isPdf = /\.pdf$/i.test(file.name) || file.type === 'application/pdf';
    const previous = st.source;
    let src;
    st.opening = true;
    $('ftm-file').disabled = true;
    $('ftm-black').disabled = true;
    $('ftm-generate').disabled = true;
    $('ftm-file-info').textContent = 'Ouverture…';
    try {
        src = isPdf ? await ftmOpenPdf(file) : /\.jp2$/i.test(file.name) ? await ftmOpenJp2(file, group) : await ftmOpenTiff(file);
        $('ftm-file-info').textContent = 'Rendu de l’aperçu…';
        await st.viewer.setSource(src);
    } catch (e) {
        console.error(e);
        src?.retire?.();
        src = null;
        st.viewer.setStatus('');
        $('ftm-file-info').textContent = previous ? previous.info() : '';
        alert(`Impossible d'ouvrir ${file.name} : ${e.message}`);
        return;
    } finally {
        st.opening = false;
        $('ftm-file').disabled = false;
        $('ftm-black').disabled = false;
        if (!src && previous) ftmRefresh();
    }
    previous?.retire?.();
    st.source = src;
    st.points = []; st.selected = -1; st.awaiting = null; st.T = null; st.zoomTouched = false;
    $('ftm-name').value = file.name.replace(/\.[^.]+$/, '') + (group.images.length > 1 ? '-mosaique' : '');
    $('ftm-page-row').hidden = !(src.kind === 'pdf' && src.pages > 1);
    if (src.kind === 'pdf') {
        $('ftm-page').replaceChildren(...Array.from({ length: src.pages }, (_, i) => new Option(`${i + 1} / ${src.pages}`, i + 1)));
    }
    $('ftm-points-step').hidden = !src.needsPoints;
    $('ftm-geo-step').hidden = src.needsPoints;
    $('ftm-file-info').textContent = src.info();
    ftmSetTool('pan');
    if (!src.needsPoints) {
        $('ftm-geo-info').textContent = (src.kind === 'jp2' ? 'Lu dans les fichiers sélectionnés : ' : 'Lu dans le fichier : ') + src.info() + '.';
        const b = ftmSourceBoundsLatLng(src);
        st.map.fitBounds(b, { maxZoom: 18 });
    }
    ftmRefresh();
}

// Emprise du fichier (ou des zones gardées) en LatLng, pour la carte.
function ftmSourceBoundsLatLng(src, polys) {
    const ring = polys?.length ? polys.flat() : [[0, 0], [src.width, 0], [src.width, src.height], [0, src.height]];
    return L.latLngBounds(ring.map(([x, y]) => { const [lon, lat] = ftmMercToLonLat(...src.toMerc(x, y)); return [lat, lon]; }));
}

// ----- Points -----

function ftmImportPoints(list) {
    const st = ftmState;
    if (!list.length) { alert('Aucun point lisible dans ce fichier.'); return; }
    st.points = list;
    st.selected = list.findIndex(p => !Number.isFinite(p.x));
    st.awaiting = st.selected >= 0 ? 'plan' : null;
    const b = L.latLngBounds(list.map(p => [p.lat, p.lon]));
    st.map.fitBounds(b.pad(0.2), { maxZoom: 18 });
    ftmSetTool('pan');
    ftmRefresh();
}

function ftmAddPoint() {
    const st = ftmState;
    if (!st.source) { alert("Ouvrez d'abord un fichier."); return; }
    st.points.push({ lon: NaN, lat: NaN, x: null, y: null, enabled: true });
    st.selected = st.points.length - 1;
    st.awaiting = 'plan';
    ftmSetTool('pan');
    ftmRefresh();
}

function ftmPlaceOnPlan(x, y) {
    const st = ftmState, p = st.points[st.selected];
    if (st.awaiting !== 'plan' || !p) return;
    p.x = x; p.y = y;
    st.awaiting = Number.isFinite(p.lat) ? null : 'map';
    ftmAdvance();
}

function ftmPlaceOnMap(lon, lat) {
    const st = ftmState, p = st.points[st.selected];
    if (st.awaiting !== 'map' || !p) return;
    p.lon = lon; p.lat = lat;
    st.awaiting = Number.isFinite(p.x) ? null : 'plan';
    ftmAdvance();
}

// Après un placement : point suivant à compléter, s'il y en a un.
function ftmAdvance() {
    const st = ftmState;
    if (!st.awaiting) {
        const next = st.points.findIndex(p => !Number.isFinite(p.x) || !Number.isFinite(p.lat));
        if (next >= 0) { st.selected = next; st.awaiting = Number.isFinite(st.points[next].x) ? 'map' : 'plan'; }
    }
    ftmSetTool('pan');
    ftmRefresh();
}

function ftmExportPoints() {
    const st = ftmState;
    if (!st.points.length) return;
    const blob = new Blob([ftmWritePoints(st.points)], { type: 'text/plain' });
    const a = ftmEl('a', { href: URL.createObjectURL(blob), download: `${st.$('ftm-name').value || 'points'}.points` });
    a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}

function ftmRenderPoints(residuals) {
    const st = ftmState, tb = st.$('ftm-points');
    tb.replaceChildren();
    st.points.forEach((p, i) => {
        const r = residuals?.each[i];
        const tr = ftmEl('tr', { class: (i === st.selected ? 'is-selected ' : '') + (p.enabled === false ? 'is-off' : '') });
        const place = (what, ok, title) => ftmEl('td', {},
            ftmEl('button', { type: 'button', class: 'ftm-mini' + (ok ? ' is-ok' : ''), title, onclick: ev => {
                ev.stopPropagation(); st.selected = i; st.awaiting = what; ftmSetTool('pan'); ftmRefresh();
            } }, ok ? '✓' : '•'));
        tr.append(
            ftmEl('td', { text: String(i + 1) }),
            place('plan', Number.isFinite(p.x), 'Pointer ce repère sur le plan'),
            place('map', Number.isFinite(p.lat), 'Pointer ce repère sur la carte'),
            ftmEl('td', { class: 'ftm-res', text: r == null ? '—' : ftmFormatMeters(r) }),
            ftmEl('td', {},
                ftmEl('button', { type: 'button', class: 'ftm-mini', title: p.enabled === false ? 'Réutiliser ce point' : 'Ignorer ce point dans le calcul', onclick: ev => {
                    ev.stopPropagation(); p.enabled = p.enabled === false; ftmRefresh();
                } }, p.enabled === false ? '↺' : '⊘'),
                ftmEl('button', { type: 'button', class: 'ftm-mini', title: 'Supprimer ce point', onclick: ev => {
                    ev.stopPropagation(); st.points.splice(i, 1);
                    if (st.selected >= st.points.length) st.selected = st.points.length - 1;
                    st.awaiting = null; ftmRefresh();
                } }, '✕')));
        tr.addEventListener('click', () => { st.selected = i; st.awaiting = null; ftmRefresh(); });
        tb.append(tr);
    });
    // Consigne
    const hint = st.$('ftm-hint');
    const n = st.selected + 1;
    hint.textContent = !st.source ? '' : st.awaiting === 'plan' ? `Point ${n} : cliquez sa position sur le PLAN (Échap pour annuler).`
        : st.awaiting === 'map' ? `Point ${n} : cliquez sa position sur la CARTE (Échap pour annuler).` : '';
    st.$('ftm-map').classList.toggle('is-picking', st.awaiting === 'map');
    // Marqueurs carte
    st.markers.clearLayers();
    st.points.forEach((p, i) => {
        if (!Number.isFinite(p.lat)) return;
        const m = L.marker([p.lat, p.lon], {
            draggable: true,
            icon: L.divIcon({ className: 'ftm-marker' + (i === st.selected ? ' is-selected' : '') + (p.enabled === false ? ' is-off' : ''), html: `<span>${i + 1}</span>`, iconSize: [22, 22], iconAnchor: [11, 11] }),
        });
        m.on('dragend', () => { const ll = m.getLatLng(); p.lat = ll.lat; p.lon = ll.lng; ftmRefresh(); });
        m.on('click', () => { st.selected = i; st.awaiting = null; ftmRefresh(); });
        m.addTo(st.markers);
    });
    st.viewer.points = st.points; st.viewer.selected = st.selected; st.viewer.draw();
}

// ----- Recalcul général -----

function ftmRefresh() {
    const st = ftmState, src = st.source, $ = st.$;
    let residuals = null;
    if (src?.kind === 'pdf') {
        st.T = ftmFitTransform(st.points, st.kind);
        src.T = st.T;
        residuals = st.T ? ftmResiduals(st.points, st.T) : null;
        const need = ftmMinPoints(st.kind), have = ftmUsablePoints(st.points).length;
        if (!st.T) {
            $('ftm-fit').textContent = have < need ? `${need - have} point(s) complet(s) de plus, placé(s) sur le plan ET sur la carte.` : 'Points alignés ou confondus : écartez-les.';
        } else {
            const lat = ftmMercToLonLat(...st.T.slice(4))[1];
            const d = ftmDescribe(st.T, lat);
            $('ftm-fit').innerHTML = `Échelle ≈ <b>1/${ftmNum(Math.round(ftmPrintScale(d.metersPerUnit)))}</b> (1 cm du papier = ${ftmFormatMeters(d.metersPerUnit * 72 / 2.54)}) · ${Math.abs(d.rotation) < 0.05 ? 'nord en haut' : `tourné de ${ftmNum(Math.abs(d.rotation), 1)}° ${d.rotation > 0 ? 'vers la droite' : 'vers la gauche'}`}`
                + (have > need ? ` · écart moyen <b>${ftmFormatMeters(residuals.rms)}</b>` : ' · ajoutez un point de plus pour contrôler l’écart');
        }
    }
    ftmRenderPoints(residuals);
    // Zones
    const nz = st.viewer.polys.length;
    const drawing = st.viewer.drawing?.kind === 'polygon' && st.viewer.drawing.pts;
    const poly = st.viewer.polys[st.viewer.selectedPoly];
    $('ftm-finish').disabled = !drawing || drawing.length < 3;
    $('ftm-undo').disabled = !drawing?.length && !st.viewer.history.length;
    $('ftm-delete-vertex').disabled = !poly || poly.length <= 3 || st.viewer.selectedVertex < 0;
    $('ftm-delete-zone').disabled = !poly;
    $('ftm-zones').textContent = drawing ? `${drawing.length} sommet(s) posé(s) — terminer le polygone avant de générer.`
        : (nz ? `${nz} zone(s) gardée(s) ; le reste devient transparent.` : 'Toute la couverture des fichiers.')
        + (src?.kind === 'jp2' && src.excludeBlack ? ' Noir pur exclu.' : '');
    // Emprise sur la carte
    st.footprint.clearLayers();
    const georef = src && (!src.needsPoints || st.T);
    if (georef) {
        const rings = nz ? st.viewer.polys : src.footprints || [[[0, 0], [src.width, 0], [src.width, src.height], [0, src.height]]];
        for (const ring of rings) {
            L.polygon(ring.map(([x, y]) => { const [lon, lat] = ftmMercToLonLat(...src.toMerc(x, y)); return [lat, lon]; }),
                { color: '#2563eb', weight: 2, fill: false, interactive: false }).addTo(st.footprint);
        }
    }
    st.preview.update();
    ftmUpdateZooms();
}

async function ftmUpdateZooms() {
    const st = ftmState, src = st.source, $ = st.$;
    const ready = !st.opening && !st.viewer.drawing && src && (!src.needsPoints || st.T);
    $('ftm-generate').disabled = !ready;
    if (!ready) { $('ftm-zoom-why').textContent = ''; $('ftm-estimate').textContent = ''; return; }
    const polys = ftmMercPolygons();
    const b = ftmPolygonBounds(polys);
    const [, lat] = ftmMercToLonLat((b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2);
    const k = Math.cos(lat * Math.PI / 180);
    const c = src.toMerc(src.width / 2, src.height / 2), d = src.toMerc(src.width / 2 + 1, src.height / 2);
    const metersPerUnit = Math.hypot(d[0] - c[0], d[1] - c[1]) * k;
    const an = await src.analyse();
    if (st.source !== src || st.opening) return;
    const sug = ftmSuggestZooms({ metersPerUnit, lat, rasterPxPerUnit: an.rasterPxPerUnit, textSizes: an.textSizes, spanMeters: Math.max(b.x1 - b.x0, b.y1 - b.y0) * k });
    if (!st.zoomTouched) { $('ftm-zmin').value = sug.zmin; $('ftm-zmax').value = sug.zmax; }
    const why = sug.reasons.map(r => r.kind === 'raster' ? `image du fichier : pixel de ${ftmFormatMeters(r.res)} → zoom ${r.zoom}`
        : r.kind === 'text' ? `texte vectoriel (${ftmNum(r.textSize, 1)} ${src.unit}) lisible à ${FTM_TEXT_PX} px → zoom ${r.zoom}`
        : `dessin vectoriel sans texte → zoom ${r.zoom}`);
    $('ftm-zoom-why').textContent = `Proposés : ${sug.zmin} à ${sug.zmax} (${why.join(' ; ')}).`;
    if (!$('ftm-zmin').dataset.bound) {
        $('ftm-zmin').dataset.bound = '1';
        for (const id of ['ftm-zmin', 'ftm-zmax']) $(id).addEventListener('change', () => { st.zoomTouched = true; });
    }
    ftmUpdateEstimate();
}

function ftmMercPolygons() {
    const st = ftmState, src = st.source;
    const rings = st.viewer.polys.length ? st.viewer.polys : src.footprints || [[[0, 0], [src.width, 0], [src.width, src.height], [0, src.height]]];
    // Côtés densifiés : un GeoTIFF projeté courbe légèrement les droites en Mercator.
    return rings.map(ring => {
        const out = [];
        ring.forEach((p, i) => {
            const q = ring[(i + 1) % ring.length], n = src.affine ? 1 : 8;
            for (let k = 0; k < n; k++) out.push(src.toMerc(p[0] + (q[0] - p[0]) * k / n, p[1] + (q[1] - p[1]) * k / n));
        });
        return out;
    });
}

function ftmUpdateEstimate() {
    const st = ftmState, $ = st.$;
    if (st.opening || st.viewer.drawing || !st.source || (st.source.needsPoints && !st.T)) return;
    let zmin = Number($('ftm-zmin').value), zmax = Number($('ftm-zmax').value);
    if (zmin > zmax) { [zmin, zmax] = [zmax, zmin]; $('ftm-zmin').value = zmin; $('ftm-zmax').value = zmax; }
    const polys = ftmMercPolygons();
    const area = polys.reduce((s, p) => s + ftmPolygonArea(p), 0);
    const tileArea = (ftmMercResolution(zmax) * 256) ** 2;
    const approx = area / tileArea * 4 / 3;
    const fmt = $('ftm-format').value, kb = fmt === 'png' ? 25 : fmt === 'jpg' ? 18 : 10;
    const tooMany = approx > FTM_MAX_TILES;
    const blocks = Math.ceil(area / tileArea / (FTM_BLOCK_TILES * FTM_BLOCK_TILES)) + 1;
    $('ftm-estimate').innerHTML = `≈ <b>${ftmNum(Math.round(approx))}</b> tuiles, ≈ ${ftmNum(approx * kb / 1024, 0)} Mo · ${ftmNum(blocks)} rendus du fichier au zoom ${zmax}.`
        + ($('ftm-mnt').checked ? '<br>Relief ajouté aux niveaux 0 à 12, dans le même MBTiles.' : '')
        + (fmt === 'jpg' ? '<br>JPEG : les zones transparentes seront blanches. Choisir PNG ou WebP pour conserver la transparence.' : '')
        + (tooMany ? `<br><span class="ftm-warn">Trop de tuiles pour le navigateur (au-delà de ${ftmNum(FTM_MAX_TILES)}) : baissez le zoom maximal ou réduisez la zone.</span>` : '');
    $('ftm-generate').disabled = tooMany;
}

// ===== Génération =====

function ftmStartJob() {
    const st = ftmState, $ = st.$, src = st.source;
    if (!src || st.opening || st.viewer.drawing || $('ftm-generate').disabled) return;
    const zmin = Number($('ftm-zmin').value), zmax = Number($('ftm-zmax').value);
    const job = new FtmJob({
        id: ftmJobCounter++, source: src, polysSrc: st.viewer.polys.length ? st.viewer.copyPolys() : null,
        polysMerc: ftmMercPolygons(), zmin, zmax, format: $('ftm-format').value,
        name: ($('ftm-name').value || 'Plan').trim(), T: st.T ? st.T.slice() : null,
        pointsUsed: ftmUsablePoints(st.points).length,
        excludeBlack: src.excludeBlack, includeMnt: $('ftm-mnt').checked,
    });
    st.modal.hidden = true; document.body.classList.remove('ftm-open');
    job.run();
}

class FtmJob {
    constructor(o) {
        Object.assign(this, o);
        this.source.retain?.();
        this.cancelled = false; this.total = 0; this.stored = 0;
        this.createUI();
    }

    createUI() {
        const list = document.getElementById('creator-jobs-list');
        list?.querySelector('p.italic')?.remove();
        this.ui = ftmEl('div', { class: 'bg-gray-50 dark:bg-gray-700 p-3 rounded border border-gray-200 dark:border-gray-600 text-sm' });
        this.ui.innerHTML = `
            <div class="flex justify-between items-center mb-2"><span class="font-bold truncate"></span><span class="text-xs font-mono ftm-job-status">PRÉPARATION</span></div>
            <div class="ftm-job-steps"></div>
            <p class="ftm-job-message text-xs text-red-600 mt-1" hidden></p>
            <div class="flex justify-end text-xs text-gray-500 mt-1"><span class="ftm-job-actions"><button type="button" class="hover:text-red-600">Annuler</button></span></div>`;
        this.ui.querySelector('.font-bold').textContent = `${this.name}.mbtiles — ${this.source.kind === 'pdf' ? 'PDF' : this.source.kind === 'jp2' ? 'JP2' : 'GeoTIFF'}`;
        this.ui.querySelector('.ftm-job-actions button').onclick = () => this.cancel();
        (list || document.body).prepend(this.ui);
    }

    status(t, cls) { const s = this.ui.querySelector('.ftm-job-status'); s.textContent = t; if (cls) s.className = `text-xs font-mono ftm-job-status ${cls}`; }

    // Étapes annoncées dès que le nombre de tuiles de chaque niveau est connu (cf. jobSteps.js).
    showSteps(counts) {
        const plan = [{ id: 'render', label: `Rendu du fichier, zoom ${this.zmax}`, total: counts[this.zmax] }];
        for (let z = this.zmax - 1; z >= this.zmin; z--) plan.push({ id: `z${z}`, label: `Zoom ${z}, réduit du zoom ${z + 1}`, total: counts[z] });
        if (this.includeMnt) plan.push({ id: 'mnt', label: `Relief (MNT), zooms ${MNT_MIN_ZOOM} à ${MNT_MAX_ZOOM}`, total: this.terrainPlan.length });
        plan.push({ id: 'asm', label: 'Assemblage du fichier', auto: false });
        this.steps = new JobSteps(plan);
        this.ui.querySelector('.ftm-job-steps').replaceChildren(this.steps.el);
    }

    cancel() {
        this.cancelled = true;
        this._task?.cancel?.();
        this._fetchController?.abort();
        this.steps?.cancel();
        this.status('ANNULÉ', 'text-red-600 font-bold');
        this.ui.querySelector('.ftm-job-actions').textContent = '';
    }

    async run() {
        try {
            const { zmin, zmax } = this;
            const tiles = ftmTilesForPolygons(this.polysMerc, zmax, FTM_MAX_TILES);
            const counts = ftmPyramidCounts(tiles, zmin, zmax);
            this.total = Object.values(counts).reduce((a, b) => a + b, 0);
            if (this.total > FTM_MAX_TILES) throw new Error('Trop de tuiles : réduire la zone ou le zoom maximal.');
            this.terrainPlan = [];
            if (this.includeMnt) {
                await ensureMbtilesCreatorModule(); // source et convention MNT communes aux deux exports
                if (this.cancelled) return;
                for (let z = MNT_MIN_ZOOM; z <= MNT_MAX_ZOOM; z++) {
                    const level = ftmTilesForPolygons(this.polysMerc, z, FTM_MAX_TILES - this.total - this.terrainPlan.length);
                    for (const t of level) this.terrainPlan.push({ ...t, z });
                }
                this.total += this.terrainPlan.length;
            }
            this.showSteps(counts);
            this.store = await FtmTileStore.create(this.id);
            this.status('EN COURS', '');
            await this.renderMaxZoom(tiles);
            for (let z = zmax - 1; z >= zmin && !this.cancelled; z--) await this.buildLevel(z);
            if (this.cancelled) return;
            if (!this.stored) throw new Error('Aucun pixel conservé dans la sélection. Modifier la zone ou désactiver l’exclusion du noir.');
            if (this.includeMnt) await this.downloadTerrain();
            if (this.cancelled) return;
            await this.assemble();
        } catch (e) {
            if (this.cancelled) return;
            console.error(e);
            this.status('ERREUR', 'text-red-600 font-bold');
            this.steps?.fail();
            const msg = this.ui.querySelector('.ftm-job-message');
            msg.textContent = e.message; msg.hidden = false;
        } finally {
            await this.store?.clear();
            await this.terrainStore?.clear();
            this.source.release?.();
        }
    }

    async downloadTerrain() {
        this.steps.start('mnt');
        this.terrainStore = await FtmTileStore.create(this.id + '_mnt');
        for (const t of this.terrainPlan) {
            if (this.cancelled) return;
            const url = MNT_TILE_URL.replace('{z}', t.z).replace('{x}', t.x).replace('{y}', t.y);
            let blob, lastError;
            for (let attempt = 0; attempt < 3 && !this.cancelled; attempt++) {
                const controller = this._fetchController = new AbortController();
                const timer = setTimeout(() => controller.abort(), 20000);
                try {
                    const response = await fetch(url, { signal: controller.signal });
                    if (!response.ok) throw new Error(`HTTP ${response.status}`);
                    const candidate = await response.blob();
                    if (ftmSniffImage(new Uint8Array(await candidate.slice(0, 16).arrayBuffer())) !== 'png') throw new Error('réponse non PNG');
                    const bmp = await createImageBitmap(candidate);
                    const valid = bmp.width === 256 && bmp.height === 256; bmp.close();
                    if (!valid) throw new Error('dimensions du relief incorrectes');
                    blob = candidate; break;
                } catch (err) { lastError = err; }
                finally { clearTimeout(timer); this._fetchController = null; }
            }
            if (this.cancelled) return;
            if (!blob) throw new Error(`MNT indisponible (${t.z}/${t.x}/${t.y} : ${lastError?.message}). Vérifier la connexion et relancer, ou décocher le MNT.`);
            await this.terrainStore.put(t.z, t.x, t.y, blob);
            this.steps.advance('mnt');
        }
    }

    // Matrice « unités source → pixels du bloc ».
    blockMatrix(block) {
        const B = ftmMercToBlockMatrix(this.zmax, block.x0, block.y0);
        if (this.source.affine) return ftmMultiply(B, this.T);
        // Source projetée : approximation affine sur l'emprise du bloc (écart
        // de l'ordre du centimètre sur quelques centaines de mètres).
        const r = ftmMercResolution(this.zmax) * 256 * block.side;
        const X0 = -FTM_HALF + block.x0 * 256 * ftmMercResolution(this.zmax), Y0 = FTM_HALF - block.y0 * 256 * ftmMercResolution(this.zmax);
        const cs = [[X0, Y0], [X0 + r, Y0], [X0, Y0 - r], [X0 + r, Y0 - r]].map(([X, Y]) => this.source.mercToSource(X, Y));
        const xs = cs.map(c => c[0]), ys = cs.map(c => c[1]);
        const { T } = ftmLocalAffine((x, y) => this.source.toMerc(x, y), Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys));
        return ftmMultiply(B, T);
    }

    async renderMaxZoom(tiles) {
        const side = FTM_BLOCK_TILES * 256;
        const canvas = document.createElement('canvas'); canvas.width = canvas.height = side;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        const tile = document.createElement('canvas'); tile.width = tile.height = 256;
        const tctx = tile.getContext('2d', { willReadFrequently: true });
        const blocks = ftmGroupBlocks(tiles, FTM_BLOCK_TILES, FTM_STRIP_BLOCKS);
        const src = this.source;
        const pagePoly = [[0, 0], [src.width, 0], [src.width, src.height], [0, src.height]];
        for (const block of blocks) {
            if (this.cancelled) return;
            const M = this.blockMatrix(block);
            ctx.setTransform(1, 0, 0, 1, 0, 0);
            ctx.globalCompositeOperation = 'source-over';
            ctx.clearRect(0, 0, side, side);
            // Lecture du fichier limitée aux tuiles demandées du bloc (bord de sélection).
            const xs = block.tiles.map(t => t.x - block.x0), ys = block.tiles.map(t => t.y - block.y0);
            const region = [Math.min(...xs) * 256, Math.min(...ys) * 256, (Math.max(...xs) + 1) * 256, (Math.max(...ys) + 1) * 256];
            this._task = src.render(ctx, M, side, side, { excludeBlack: this.excludeBlack, region });
            await this._task;
            if (this.cancelled) return;
            // Ne garder que les zones voulues, et rien hors du fichier.
            ctx.setTransform(...M);
            ctx.globalCompositeOperation = 'destination-in';
            ctx.beginPath();
            for (const poly of (this.polysSrc || src.footprints || [pagePoly])) {
                // Même orientation pour l'union de zones tracées dans les deux sens.
                const signed = poly.reduce((s, p, i) => { const q = poly[(i + 1) % poly.length]; return s + p[0] * q[1] - q[0] * p[1]; }, 0);
                const ring = signed < 0 ? poly.slice().reverse() : poly;
                ring.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)); ctx.closePath();
            }
            ctx.fill('nonzero');
            ctx.setTransform(1, 0, 0, 1, 0, 0);
            ctx.globalCompositeOperation = 'source-over';
            for (const t of block.tiles) {
                tctx.clearRect(0, 0, 256, 256);
                tctx.drawImage(canvas, (t.x - block.x0) * 256, (t.y - block.y0) * 256, 256, 256, 0, 0, 256, 256);
                await this.saveTile(this.zmax, t.x, t.y, tile, tctx);
                this.steps.advance('render');
            }
            await new Promise(r => setTimeout(r, 0));
        }
        if (!this.cancelled) this.steps.finish('render');
    }

    // Encode et range une tuile, sauf si elle est entièrement transparente.
    async saveTile(z, x, y, canvas, ctx) {
        const px = ctx.getImageData(0, 0, 256, 256).data;
        let any = false;
        for (let i = 3; i < px.length; i += 4) if (px[i]) { any = true; break; }
        if (!any) return;
        let out = canvas;
        if (this.format === 'jpg') {
            out = document.createElement('canvas'); out.width = out.height = 256;
            const o = out.getContext('2d'); o.fillStyle = '#fff'; o.fillRect(0, 0, 256, 256); o.drawImage(canvas, 0, 0);
        }
        const mime = this.format === 'png' ? 'image/png' : this.format === 'jpg' ? 'image/jpeg' : 'image/webp';
        const blob = await new Promise(r => out.toBlob(r, mime, 0.9));
        if (!blob) return;
        if (!this.realFormat) this.realFormat = ftmSniffImage(new Uint8Array(await blob.slice(0, 16).arrayBuffer())) || this.format;
        await this.store.put(z, x, y, blob);
        this.stored++;
    }

    // Niveau z tiré des quatre tuiles filles du niveau z + 1.
    async buildLevel(z) {
        const children = await this.store.keys(z + 1);
        const parents = ftmParentTiles(children);
        const canvas = document.createElement('canvas'); canvas.width = canvas.height = 256;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
        const step = `z${z}`;
        this.steps.start(step);
        let n = 0;
        for (const p of parents) {
            if (this.cancelled) return;
            ctx.clearRect(0, 0, 256, 256);
            for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
                const blob = await this.store.get(z + 1, 2 * p.x + dx, 2 * p.y + dy);
                if (!blob) continue;
                const bmp = await createImageBitmap(blob);
                ctx.drawImage(bmp, dx * 128, dy * 128, 128, 128);
                bmp.close?.();
            }
            await this.saveTile(z, p.x, p.y, canvas, ctx);
            this.steps.advance(step);
            if (++n % 50 === 0) await new Promise(r => setTimeout(r, 0));
        }
        // Les tuiles absentes (transparentes) d'un niveau comptent comme faites.
        this.steps.finish(step);
    }

    async assemble() {
        this.steps.start('asm');
        this.steps.setTotal('asm', this.stored + this.terrainPlan.length);
        this.steps.setNote('asm', 'écriture des tuiles');
        await ensureSqlJs();
        const SQL = await window.initSqlJs({ locateFile: f => f });
        const db = new SQL.Database();
        let data;
        try {
            db.run('CREATE TABLE metadata (name text, value text);');
            db.run('CREATE TABLE tiles (zoom_level integer, tile_column integer, tile_row integer, tile_data blob);');
            if (this.includeMnt) db.run('CREATE TABLE terrain_tiles (zoom_level integer, tile_column integer, tile_row integer, tile_data blob);');
            db.run('BEGIN TRANSACTION;');
            let n = 0;
            for (let z = this.zmin; z <= this.zmax; z++) {
                for (const t of await this.store.keys(z)) {
                    if (this.cancelled) return;
                    const blob = await this.store.get(z, t.x, t.y);
                    db.run('INSERT INTO tiles VALUES (?, ?, ?, ?)', [z, t.x, (1 << z) - 1 - t.y, new Uint8Array(await blob.arrayBuffer())]);
                    this.steps.advance('asm');
                    if (++n % 200 === 0) await new Promise(r => setTimeout(r, 0));
                }
            }
            if (this.includeMnt) {
                for (const t of this.terrainPlan) {
                    if (this.cancelled) return;
                    const blob = await this.terrainStore.get(t.z, t.x, t.y);
                    db.run('INSERT INTO terrain_tiles VALUES (?, ?, ?, ?)', [t.z, t.x, (1 << t.z) - 1 - t.y, new Uint8Array(await blob.arrayBuffer())]);
                    this.steps.advance('asm');
                    if (++n % 200 === 0) await new Promise(r => setTimeout(r, 0));
                }
                db.run('CREATE UNIQUE INDEX terrain_tile_index ON terrain_tiles (zoom_level, tile_column, tile_row);');
            }
            const b = ftmPolygonBounds(this.polysMerc);
            const [w, s] = ftmMercToLonLat(b.x0, b.y0), [e, nn] = ftmMercToLonLat(b.x1, b.y1);
            const meta = {
                name: this.name, format: this.realFormat || this.format, type: 'baselayer', version: '1.2',
                minzoom: String(this.zmin), maxzoom: String(this.zmax),
                bounds: [w, s, e, nn].map(v => v.toFixed(6)).join(','),
                center: `${((w + e) / 2).toFixed(6)},${((s + nn) / 2).toFixed(6)},${Math.min(this.zmax, Math.max(this.zmin, this.zmin + 2))}`,
                description: `${this.source.name} — ${this.source.kind === 'pdf' ? `recalé par ${this.pointsUsed} points d'appui` : `${this.source.kind === 'jp2' ? 'JP2' : 'GeoTIFF'} EPSG:${this.source.epsg}`} (Carroyage-JMT)`,
            };
            if (this.includeMnt) Object.assign(meta, { mnt_storage: 'terrain_tiles', mnt_minzoom: String(MNT_MIN_ZOOM),
                mnt_maxzoom: String(MNT_MAX_ZOOM), mnt_encoding: 'terrarium',
                attribution: 'Relief : Mapzen / AWS Terrain Tiles (sources : https://github.com/tilezen/joerd/blob/master/docs/attribution.md)' });
            for (const [k, v] of Object.entries(meta)) db.run('INSERT INTO metadata VALUES (?, ?)', [k, v]);
            db.run('CREATE UNIQUE INDEX tile_index on tiles (zoom_level, tile_column, tile_row);');
            this.steps.setNote('asm', 'création du fichier');
            db.run('COMMIT;');
            data = db.export();
        } finally { db.close(); }
        if (this.cancelled) return;
        this.steps.finish('asm', `${ftmNum(data.length / 1048576, 1)} Mo`);
        this.status('TERMINÉ', 'text-green-600 font-bold');
        const fname = `${this.name}.mbtiles`;
        const save = () => ftmSaveBytes(data, fname);
        const act = this.ui.querySelector('.ftm-job-actions');
        act.replaceChildren(ftmEl('button', { type: 'button', class: 'text-green-600 font-bold hover:underline', onclick: save }, 'Télécharger'));
        await save();
    }
}

async function ftmSaveBytes(data, fname) {
    if (window.showSaveFilePicker) {
        try {
            const fh = await window.showSaveFilePicker({ suggestedName: fname, types: [{ description: 'MBTiles', accept: { 'application/x-sqlite3': ['.mbtiles'] } }] });
            const w = await fh.createWritable(); await w.write(data); await w.close();
            return;
        } catch (e) { if (e.name === 'AbortError') return; }
    }
    const a = ftmEl('a', { href: URL.createObjectURL(new Blob([data], { type: 'application/x-sqlite3' })), download: fname });
    a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}

// Rangement des tuiles en cours de fabrication : sur le disque du navigateur
// (OPFS) quand il le permet, en mémoire sinon.
class FtmTileStore {
    static async create(id) {
        const s = new FtmTileStore();
        s.index = new Map();          // z → Set("x/y")
        try {
            const root = await navigator.storage.getDirectory();
            s.name = `ftm_job_${id}`;
            try { await root.removeEntry(s.name, { recursive: true }); } catch { /* absent */ }
            s.dir = await root.getDirectoryHandle(s.name, { create: true });
            const probe = await s.dir.getFileHandle('probe', { create: true });
            const w = await probe.createWritable(); await w.write(new Blob(['1'])); await w.close();
        } catch { s.dir = null; s.mem = new Map(); }
        return s;
    }
    async put(z, x, y, blob) {
        const k = `${z}_${x}_${y}`;
        if (this.dir) { const fh = await this.dir.getFileHandle(k, { create: true }); const w = await fh.createWritable(); await w.write(blob); await w.close(); }
        else this.mem.set(k, blob);
        if (!this.index.has(z)) this.index.set(z, new Set());
        this.index.get(z).add(`${x}/${y}`);
    }
    async get(z, x, y) {
        if (!this.index.get(z)?.has(`${x}/${y}`)) return null;
        const k = `${z}_${x}_${y}`;
        if (this.dir) return (await this.dir.getFileHandle(k)).getFile();
        return this.mem.get(k) || null;
    }
    async keys(z) { return [...(this.index.get(z) || [])].map(s => { const [x, y] = s.split('/').map(Number); return { x, y }; }); }
    async clear() {
        this.index = new Map(); this.mem = this.mem && new Map();
        if (this.dir) { try { await (await navigator.storage.getDirectory()).removeEntry(this.name, { recursive: true }); } catch { /* déjà parti */ } this.dir = null; }
    }
}
