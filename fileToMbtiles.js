// fileToMbtiles.js — « Générer un MBTiles depuis un fichier » (mode Créer MBTiles).
//
// Transforme un PDF à l'échelle, une image, un GeoTIFF ou un JP2 en .mbtiles pour
// CadoTour, ou en GeoTIFF (EPSG:3857) pour un SIG :
//   • PDF ou image (JPEG, PNG, WebP…) : des points d'appui relient le fichier à
//     la carte — un .points exporté par CadoTour (positions sur la carte), dont
//     on pointe chaque repère sur le fichier, ou des points posés ici, fichier
//     puis carte. Deux suffisent pour un plan à l'échelle (similitude) ; trois et
//     plus permettent une transformation affine, ou « déformable » (spline de
//     plaque mince) pour une image déformée — assemblage de photos de drone :
//     elle passe par chaque point et se plie entre eux. L'écart de chaque point
//     est affiché, en mètres.
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
        kind: 'pdf', name: file.name, file, doc, pages: doc.numPages, page: null, pageNo: 1,
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
        ...FTM_POINT_SOURCE, warp: null,
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

// Position des sources recalées par points (PDF, image) : transformation affine
// st.T, ou spline (warp) en mode déformable.
const FTM_POINT_SOURCE = {
    toMerc(x, y) { return this.warp ? this.warp.fwd(x, y) : ftmApply(this.T, x, y); },
    mercToSource(X, Y) { return this.warp ? this.warp.inv(X, Y) : ftmApply(ftmInvert(this.T), X, Y); },
};

// ===== Sources : image ordinaire (JPEG, PNG, WebP…) =====
//
// Sans position : recalée par des points d'appui, comme un PDF. Unité : le pixel.
// L'image est décodée une fois (ImageBitmap) ; chaque rendu n'en dessine que la
// partie utile.

async function ftmOpenImage(file) {
    let bmp;
    try { bmp = await createImageBitmap(file); }
    catch { throw new Error("image illisible par le navigateur, ou trop grande pour lui. L'enregistrer en JPEG, ou la réduire (16 000 px de côté au plus)."); }
    const label = ftmSniffImage(new Uint8Array(await file.slice(0, 16).arrayBuffer()))?.toUpperCase()
        || (file.name.match(/\.([^.]+)$/)?.[1] || 'image').toUpperCase();
    const src = {
        ...FTM_POINT_SOURCE,
        kind: 'image', name: file.name, needsPoints: true, unit: 'px', affine: true, T: null, warp: null,
        width: bmp.width, height: bmp.height, users: 0, retired: false,
        render(ctx, M, w, h, options = {}) {
            const Mi = ftmInvert(M), [u0, v0, u1, v1] = options.region || [0, 0, w, h];
            const cs = [[u0, v0], [u1, v0], [u0, v1], [u1, v1]].map(([u, v]) => ftmApply(Mi, u, v));
            const x0 = Math.max(0, Math.floor(Math.min(...cs.map(c => c[0]))) - 1), x1 = Math.min(this.width, Math.ceil(Math.max(...cs.map(c => c[0]))) + 1);
            const y0 = Math.max(0, Math.floor(Math.min(...cs.map(c => c[1]))) - 1), y1 = Math.min(this.height, Math.ceil(Math.max(...cs.map(c => c[1]))) + 1);
            if (x1 > x0 && y1 > y0 && bmp) {
                ctx.save();
                ctx.setTransform(...M);
                ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
                ctx.drawImage(bmp, x0, y0, x1 - x0, y1 - y0, x0, y0, x1 - x0, y1 - y0);
                ctx.restore();
            }
            const p = Promise.resolve();
            p.cancel = () => {};
            return p;
        },
        async analyse() { return { textSizes: [], rasterPxPerUnit: 1 }; },
        info() { return `Image ${label} — ${ftmNum(this.width)} × ${ftmNum(this.height)} px`; },
        // Mémoire de l'image libérée quand plus rien ne s'en sert (fenêtre, tâches).
        retain() { this.users++; },
        release() { if (--this.users === 0 && this.retired) this.dispose(); },
        retire() { this.retired = true; if (!this.users) this.dispose(); },
        dispose() { bmp?.close(); bmp = null; },
    };
    return src;
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

    // Plus aucune feuille : visionneuse vide.
    clear() {
        this._renderTask?.cancel?.(); clearTimeout(this._detailTimer);
        this.source = null; this.base = null; this.detail = null; this.drawing = null;
        this.polys = []; this.history = []; this.points = []; this.selectedPoly = this.selectedVertex = -1;
        this.draw();
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
// Une feuille découpée n'y montre que ses zones gardées (clip) : bordures et
// légendes disparaissent de la carte comme du fichier produit.

// Trace sur ctx l'union des anneaux, tous ramenés au même sens de parcours.
function ftmTraceRings(ctx, rings) {
    ctx.beginPath();
    for (const poly of rings) {
        const signed = poly.reduce((s, p, i) => { const q = poly[(i + 1) % poly.length]; return s + p[0] * q[1] - q[0] * p[1]; }, 0);
        const ring = signed < 0 ? poly.slice().reverse() : poly;
        ring.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)); ctx.closePath();
    }
}

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
        const key = st.clip ? st.clipKey : '';
        if (this._img.width !== bc.width || this._img.height !== bc.height || this._img._src !== bc || this._img._key !== key) {
            this._img.width = bc.width; this._img.height = bc.height; this._img._src = bc; this._img._key = key;
            const ctx = this._img.getContext('2d');
            if (st.clip) {
                // Zones gardées (unités de st.base.M), puis l'aperçu à l'intérieur seulement.
                ctx.setTransform(...M); ftmTraceRings(ctx, st.clip); ctx.fill('nonzero');
                ctx.setTransform(1, 0, 0, 1, 0, 0);
                ctx.globalCompositeOperation = 'source-in';
                ctx.drawImage(bc, 0, 0);
                ctx.globalCompositeOperation = 'source-over';
            } else ctx.drawImage(bc, 0, 0);
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

// ===== Rendu déformé (mode « Déformable ») =====
//
// Une spline ne se dessine pas d'une seule matrice : pour chaque pixel de sortie,
// la spline inverse donne sa position dans le fichier (grille de nœuds tous les
// 16 px, interpolée entre eux — ftmWarpGrid), où la couleur est lue. Le fichier
// est d'abord rendu, à la finesse voulue, sur un canevas intermédiaire qui couvre
// la partie utile ; ftmWarpSample fait le reste.

const FTM_WARP_READ_MAX = 4096;             // côté maximal du canevas intermédiaire

// Dessine la source sur ctx, B : Mercator → pixels de ctx, dans region [u0, v0, u1, v1].
function ftmRenderWarped(src, warp, ctx, B, region) {
    let inner = null, cancelled = false;
    const p = (async () => {
        const [u0, v0, u1, v1] = region, ow = u1 - u0, oh = v1 - v0;
        const Bi = ftmInvert(B);
        const grid = ftmWarpGrid((u, v) => warp.inv(...ftmApply(Bi, u0 + u, v0 + v)), ow, oh);
        const { gx, gy, cols, rows, step } = grid;
        // Partie utile du fichier, et sa finesse : unités source par pixel de sortie
        // au plus serré.
        let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, fine = Infinity;
        for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
            const k = j * cols + i, x = gx[k], y = gy[k];
            if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
            if (i + 1 < cols) fine = Math.min(fine, Math.hypot(gx[k + 1] - x, gy[k + 1] - y) / step);
            if (j + 1 < rows) fine = Math.min(fine, Math.hypot(gx[k + cols] - x, gy[k + cols] - y) / step);
        }
        x0 = Math.max(0, Math.floor(x0) - 2); y0 = Math.max(0, Math.floor(y0) - 2);
        x1 = Math.min(src.width, Math.ceil(x1) + 2); y1 = Math.min(src.height, Math.ceil(y1) + 2);
        if (!(x1 > x0 && y1 > y0)) return;
        // Échelle du canevas intermédiaire : un de ses pixels par pixel de sortie,
        // sans dépasser la finesse propre d'une image (1 pixel par unité).
        let k = 1 / Math.max(fine, 1e-9);
        if (src.unit === 'px') k = Math.min(k, 1);
        k = Math.min(k, FTM_WARP_READ_MAX / (x1 - x0), FTM_WARP_READ_MAX / (y1 - y0));
        const tw = Math.max(1, Math.ceil((x1 - x0) * k)), th = Math.max(1, Math.ceil((y1 - y0) * k));
        const tmp = document.createElement('canvas'); tmp.width = tw; tmp.height = th;
        const tctx = tmp.getContext('2d', { willReadFrequently: true });
        inner = src.render(tctx, [k, 0, 0, k, -x0 * k, -y0 * k], tw, th);
        await inner;
        if (cancelled) return;
        const data = tctx.getImageData(0, 0, tw, th).data;
        tmp.width = tmp.height = 0;
        for (let i = 0; i < gx.length; i++) { gx[i] = (gx[i] - x0) * k; gy[i] = (gy[i] - y0) * k; }
        const out = ctx.createImageData(ow, oh);
        ftmWarpSample(data, tw, th, out.data, ow, oh, grid);
        ctx.putImageData(out, u0, v0);
    })();
    p.cancel = () => { cancelled = true; inner?.cancel?.(); };
    return p;
}

// Aperçu déformé posé sur la carte : l'aperçu du fichier, redressé dans un
// canevas Mercator nord en haut (2 048 px au plus), que FtmPreviewLayer place
// ensuite comme une image ordinaire. Recalculé seulement si la spline change.
// sheet : la feuille (cache du résultat), base : son aperçu { canvas, M }.
function ftmWarpedPreview(sheet, base) {
    const src = sheet.source, warp = src.warp, st = sheet;
    if (st._warpPreview?.warp === warp && st._warpPreview.base === base) return st._warpPreview.out;
    const page = [[0, 0], [src.width, 0], [src.width, src.height], [0, src.height]], ring = [];
    page.forEach((p, i) => { const q = page[(i + 1) % 4]; for (let t = 0; t < 32; t++) ring.push(warp.fwd(p[0] + (q[0] - p[0]) * t / 32, p[1] + (q[1] - p[1]) * t / 32)); });
    const b = ftmPolygonBounds([ring]);
    const r = Math.max(b.x1 - b.x0, b.y1 - b.y0) / 2048;
    const ow = Math.max(1, Math.ceil((b.x1 - b.x0) / r)), oh = Math.max(1, Math.ceil((b.y1 - b.y0) / r));
    const Bm = [1 / r, 0, 0, -1 / r, -b.x0 / r, b.y1 / r], Bmi = ftmInvert(Bm);
    if (st._warpPreviewData?.base !== base) {
        st._warpPreviewData = { base, data: base.canvas.getContext('2d').getImageData(0, 0, base.canvas.width, base.canvas.height).data };
    }
    const grid = ftmWarpGrid((u, v) => ftmApply(base.M, ...warp.inv(...ftmApply(Bmi, u, v))), ow, oh);
    const canvas = document.createElement('canvas'); canvas.width = ow; canvas.height = oh;
    const ctx = canvas.getContext('2d');
    const img = ctx.createImageData(ow, oh);
    ftmWarpSample(st._warpPreviewData.data, base.canvas.width, base.canvas.height, img.data, ow, oh, grid);
    ctx.putImageData(img, 0, 0);
    const out = { canvas, M: Bm };
    st._warpPreview = { warp, base, out };
    return out;
}

// ===== Fenêtre =====

function ftmBuildModal() {
    const modal = ftmEl('div', { id: 'ftm-modal', class: 'ftm-modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Générer un MBTiles ou un GeoTIFF depuis un fichier' });
    modal.innerHTML = `
      <div class="ftm-header">
        <strong>Générer un MBTiles ou un GeoTIFF depuis un fichier</strong>
        <span class="ftm-sub">PDF, image (JPEG, PNG, WebP), GeoTIFF ou JP2 + J2W → .mbtiles pour CadoTour, ou GeoTIFF</span>
        <button type="button" class="ftm-close" data-act="close" aria-label="Fermer">✕</button>
      </div>
      <div class="ftm-body">
        <aside class="ftm-side">
          <section class="ftm-step">
            <h4>1. Fichier</h4>
            <div class="ftm-btns">
              <label class="ftm-btn ftm-btn-main">Choisir les fichiers…
                <input type="file" id="ftm-file" accept=".pdf,.jpg,.jpeg,.jfif,.png,.webp,.gif,.bmp,.avif,.tif,.tiff,.jp2,.j2w,.jp2w,.wld,.xml,application/pdf,image/jpeg,image/png,image/webp,image/tiff" multiple hidden></label>
              <label class="ftm-btn" id="ftm-add-row" hidden title="Ajouter un fichier à l'assemblage, sans retirer les feuilles déjà ouvertes">＋ Ajouter une feuille…
                <input type="file" id="ftm-add-file" accept=".pdf,.jpg,.jpeg,.jfif,.png,.webp,.gif,.bmp,.avif,.tif,.tiff,.jp2,.j2w,.jp2w,.wld,.xml,application/pdf,image/jpeg,image/png,image/webp,image/tiff" multiple hidden></label>
            </div>
            <p class="ftm-note">Un PDF, une image (JPEG, PNG, WebP : capture, assemblage de photos de drone…), un GeoTIFF, ou plusieurs JP2 jointifs avec leurs J2W et XML, sélectionnés ensemble. Les parties compatibles seront assemblées dans un seul fichier.</p>
            <p class="ftm-note">Plan découpé en plusieurs feuilles (nord, nord-est, est…) : choisir tous les PDF ou images ensemble, ou les ajouter un à un. Chaque feuille se recale par ses points et se découpe par ses zones (étapes 2 et 3), puis toutes sont assemblées dans un seul fichier.</p>
            <div id="ftm-sheets-wrap" hidden>
              <div id="ftm-sheets" class="ftm-sheets" role="list" aria-label="Feuilles de l'assemblage"></div>
              <p class="ftm-note">Cliquer une feuille pour la recaler ou la découper. Dans les recouvrements, la feuille du haut passe devant. Une feuille masquée n'est pas assemblée.</p>
            </div>
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
            <div id="ftm-page-row" hidden>
              <label class="ftm-row">Page <select id="ftm-page"></select></label>
              <button type="button" class="ftm-btn" data-act="page-sheet" id="ftm-page-sheet" title="Ouvrir une autre page de ce PDF comme feuille supplémentaire">＋ Autre page en nouvelle feuille</button>
            </div>
          </section>
          <section class="ftm-step" id="ftm-points-step" hidden>
            <h4>2. Points d'appui</h4>
            <p class="ftm-note">Un repère visible sur le fichier ET sur la carte. Importez le <b>.points</b> relevé dans CadoTour puis pointez chaque repère sur le fichier, ou ajoutez des points : clic sur le fichier, puis sur la carte.</p>
            <div class="ftm-btns">
              <label class="ftm-btn">Importer .points<input type="file" id="ftm-points-file" accept=".points,.txt,.csv" hidden></label>
              <button type="button" class="ftm-btn" data-act="add-point">＋ Point</button>
              <button type="button" class="ftm-btn" data-act="export-points" title="Points complétés (positions sur le plan), relisibles ici ou par QGIS">Exporter .points</button>
            </div>
            <div id="ftm-hint" class="ftm-hint"></div>
            <table class="ftm-table"><thead><tr><th>N°</th><th title="Position sur le fichier">Fichier</th><th title="Position sur la carte">Carte</th><th>Écart</th><th></th></tr></thead><tbody id="ftm-points"></tbody></table>
            <label class="ftm-row">Transformation
              <select id="ftm-kind"><option value="similarity">Similitude (plan à l'échelle)</option><option value="affine">Affine (3 points et plus)</option><option value="tps">Déformable (3 points et plus)</option></select></label>
            <p class="ftm-note" id="ftm-tps-note" hidden>Déformable : le fichier passe exactement par chaque point et se plie entre eux. Pour un assemblage de photos (Microsoft ICE…) ou un scan gondolé. Répartir les points sur toute l'image, bords et coins compris, plus serrés là où elle est tordue. L'écart d'un point est celui que prédisent les autres sans lui : un écart isolé trahit un point mal placé.</p>
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
            <h4>4. Fichier produit</h4>
            <label class="ftm-row">Sortie <select id="ftm-output"><option value="mbtiles">MBTiles (CadoTour)</option><option value="geotiff">GeoTIFF (QGIS, SIG)</option></select></label>
            <label class="ftm-row">Nom <input type="text" id="ftm-name" class="ftm-input"></label>
            <div class="ftm-row"><span id="ftm-zoom-label">Zooms</span> <span id="ftm-zmin-wrap"><select id="ftm-zmin"></select> à</span> <select id="ftm-zmax"></select></div>
            <div id="ftm-zoom-why" class="ftm-note"></div>
            <label class="ftm-row">Format <select id="ftm-format"></select></label>
            <div id="ftm-mnt-wrap">
              <label class="ftm-note"><input type="checkbox" id="ftm-mnt"> Inclure le MNT pour le relief 3D dans CadoTour</label>
              <p class="ftm-note">Télécharge les altitudes Terrarium de la zone (connexion nécessaire), dans le même fichier. Résolution du relief indépendante de celle de la photo.</p>
            </div>
            <p class="ftm-note" id="ftm-geotiff-note" hidden>GeoTIFF en Web Mercator (EPSG:3857), nord en haut, pixel du zoom choisi : il se cale tout seul dans QGIS. Hors de la zone gardée, le fond est blanc.</p>
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
        modal, $, awaiting: null, webp: canEncodeWebp(),
        sheets: [], active: -1, _kind: 'similarity',
    };
    // Une feuille par fichier ouvert. Le fichier, ses points, sa transformation et
    // sa spline sont ceux de la feuille ACTIVE : st.source, st.points… y mènent,
    // si bien que le recalage s'écrit comme pour un fichier seul.
    for (const key of FTM_SHEET_KEYS) {
        Object.defineProperty(st, key, {
            get() { const s = st.sheets[st.active]; return s ? s[key] : FTM_SHEET_EMPTY[key](st); },
            set(v) { const s = st.sheets[st.active]; if (s) s[key] = v; else if (key === 'kind') st._kind = v; },
        });
    }
    st.viewer = new FtmViewer($('ftm-viewer'), {
        onPlace: (x, y) => ftmPlaceOnPlan(x, y),
        onSelectionChange: () => ftmRefresh(),
    });
    // Carte : fonds de map-layers.js (couches simples, WMS et ArcGIS).
    st.map = L.map($('ftm-map'), { zoomControl: true }).setView([46.6, 2.4], 6);
    const bases = {};
    (typeof MAP_LAYERS !== 'undefined' ? MAP_LAYERS : []).forEach(cfg => {
        if (cfg.requiresKey && !window[cfg.requiresKey]) return;
        if (cfg.layers.some(l => l.type === 'yandex' || l.type === 'quadkey')) return;
        const mk = l => l.type === 'wms'
            ? L.tileLayer.wms(l.url, { layers: l.layers, styles: l.styles || '', format: l.format || 'image/png', transparent: l.transparent !== false, version: l.version || '1.3.0', maxZoom: 22, maxNativeZoom: l.maxZoom ?? cfg.maxZoom ?? 19 })
            : l.type === 'arcgis-cache'
            ? agcLeafletLayer(l, { maxZoom: 22, maxNativeZoom: l.maxZoom ?? cfg.maxZoom ?? 19 })
            : L.tileLayer(l.url, { maxZoom: 22, maxNativeZoom: l.maxZoom ?? cfg.maxZoom ?? 19, subdomains: l.subdomains || 'abc' });
        bases[cfg.name] = cfg.layers.length > 1 ? L.layerGroup(cfg.layers.map(mk)) : mk(cfg.layers[0]);
    });
    const first = Object.values(bases)[0] || L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 22, maxNativeZoom: 19 });
    first.addTo(st.map);
    if (Object.keys(bases).length > 1) L.control.layers(bases, null, { collapsed: true }).addTo(st.map);
    st.markers = L.layerGroup().addTo(st.map);
    st.footprint = L.layerGroup().addTo(st.map);
    st.opacity = 0.6;
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
        if (act === 'page-sheet') ftmAddPageSheet();
        const row = e.target.closest('[data-sheet]');
        if (row) {
            const i = Number(row.dataset.sheet), sheetAct = e.target.closest('[data-sheet-act]')?.dataset.sheetAct;
            if (sheetAct === 'up') ftmMoveSheet(i, -1);
            else if (sheetAct === 'down') ftmMoveSheet(i, 1);
            else if (sheetAct === 'remove') ftmRemoveSheet(i);
            else if (sheetAct === 'visible') ftmToggleSheet(i, e.target.checked);
            else if (!sheetAct) ftmActivateSheet(i);
        }
    });
    $('ftm-file').addEventListener('change', e => { const files = Array.from(e.target.files); e.target.value = ''; if (files.length) ftmOpenFile(files); });
    $('ftm-add-file').addEventListener('change', e => { const files = Array.from(e.target.files); e.target.value = ''; if (files.length) ftmOpenFile(files, false); });
    $('ftm-points-file').addEventListener('change', async e => {
        const f = e.target.files[0]; e.target.value = '';
        if (!f) return;
        try { ftmImportPoints(ftmParsePoints(await f.text())); } catch (err) { alert(err.message); }
    });
    $('ftm-page').addEventListener('change', async e => {
        const sheet = st.sheets[st.active];
        await st.source.setPage(Number(e.target.value));
        await st.viewer.setSource(st.source);
        sheet.thumb = ftmThumb(st.viewer.base);
        ftmRefresh();
    });
    $('ftm-kind').addEventListener('change', e => { st.kind = e.target.value; ftmRefresh(); });
    $('ftm-opacity').addEventListener('input', e => { st.opacity = e.target.value / 100; st.sheets.forEach(s => s.layer?.setOpacity(st.opacity)); });
    for (const id of ['ftm-zmin', 'ftm-zmax', 'ftm-format', 'ftm-mnt']) $(id).addEventListener('change', () => ftmUpdateEstimate());
    $('ftm-output').addEventListener('change', () => { ftmSetOutput(); ftmUpdateZooms(); });
    $('ftm-black').addEventListener('change', async e => {
        const src = st.source;
        if (!src || src.kind !== 'jp2' || st.opening) return;
        const previous = src.excludeBlack;
        src.excludeBlack = e.target.checked; st.opening = true;
        $('ftm-file').disabled = $('ftm-black').disabled = $('ftm-generate').disabled = true;
        try { await st.viewer.setSource(src, true); st.sheets[st.active].thumb = ftmThumb(st.viewer.base); }
        catch (err) { src.excludeBlack = previous; e.target.checked = previous; st.viewer.setStatus(''); alert(err.message); }
        finally { st.opening = false; $('ftm-file').disabled = $('ftm-black').disabled = false; ftmRefresh(); }
    });
    ftmSetOutput();
    for (let z = 0; z <= FTM_ZOOM_CEIL; z++) { $('ftm-zmin').append(new Option(z, z)); $('ftm-zmax').append(new Option(z, z)); }
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && !modal.hidden && st.awaiting) { st.awaiting = null; ftmRenderPoints(); } });
    setTimeout(() => { st.map.invalidateSize(); st.viewer.resize(); }, 50);
    ftmRefresh();
}

// MBTiles ou GeoTIFF : formats, zooms (un seul pour le GeoTIFF : la finesse de
// ses pixels), MNT et bouton.
function ftmSetOutput() {
    const st = ftmState, $ = st.$, tif = $('ftm-output').value === 'geotiff';
    const fmt = $('ftm-format'), was = fmt.value;
    fmt.replaceChildren();
    if (tif) fmt.append(new Option('JPEG dans le TIFF (léger, conseillé)', 'geotiff-jpeg'), new Option('Sans compression (sans perte, lourd)', 'geotiff'));
    else {
        if (st.webp) fmt.append(new Option('WebP (léger, conseillé)', 'webp'));
        fmt.append(new Option('PNG (sans perte)', 'png'), new Option('JPEG (photos, sans transparence)', 'jpg'));
    }
    if ([...fmt.options].some(o => o.value === was)) fmt.value = was;
    $('ftm-zmin-wrap').hidden = tif;
    $('ftm-zoom-label').textContent = tif ? 'Pixel du zoom' : 'Zooms';
    $('ftm-mnt-wrap').hidden = tif;
    $('ftm-geotiff-note').hidden = !tif;
    $('ftm-generate').textContent = tif ? 'Générer le GeoTIFF' : 'Générer le .mbtiles';
    ftmUpdateEstimate();
}

function ftmSetTool(tool) {
    const st = ftmState;
    st.viewer.setTool(tool === 'pan' && st.awaiting === 'plan' ? 'place' : tool);
    st.modal.querySelectorAll('button[data-tool]').forEach(b => b.classList.toggle('is-active', b.dataset.tool === tool));
    ftmRefresh();
}

// ----- Feuilles -----
//
// Une feuille : un fichier ouvert, avec ses points d'appui, sa transformation
// et ses zones gardées. Les champs de FTM_SHEET_KEYS sont lus et écrits par
// st.source, st.points… (feuille active) ; polys, history et view gardent la
// sélection et le cadrage de la visionneuse quand la feuille n'est pas active,
// thumb un aperçu réduit pour la carte.

const FTM_SHEET_KEYS = ['source', 'points', 'selected', 'T', 'warp', 'kind', '_warpFit', '_warpPreview', '_warpPreviewData'];
// Valeurs lues quand aucune feuille n'est ouverte.
const FTM_SHEET_EMPTY = {
    source: () => null, points: () => [], selected: () => -1, T: () => null, warp: () => null,
    kind: st => st._kind, _warpFit: () => null, _warpPreview: () => null, _warpPreviewData: () => null,
};
const FTM_THUMB_MAX = 1600;                 // aperçu gardé pour une feuille inactive, plus grand côté
let ftmSheetCounter = 0;

function ftmNewSheet(src, file) {
    return {
        id: ++ftmSheetCounter, source: src, file, points: [], selected: -1, T: null, warp: null,
        kind: ftmState.$('ftm-kind').value || 'similarity', _warpFit: null, _warpPreview: null, _warpPreviewData: null,
        polys: [], history: [], view: null, thumb: null, visible: true, layer: null,
    };
}

// Aperçu réduit { canvas, M } d'un aperçu de la visionneuse.
function ftmThumb(base) {
    if (!base) return null;
    const k = Math.min(1, FTM_THUMB_MAX / Math.max(base.canvas.width, base.canvas.height));
    if (k === 1) return base;
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(base.canvas.width * k)); c.height = Math.max(1, Math.round(base.canvas.height * k));
    const ctx = c.getContext('2d'); ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(base.canvas, 0, 0, c.width, c.height);
    return { canvas: c, M: ftmMultiply([c.width / base.canvas.width, 0, 0, c.height / base.canvas.height, 0, 0], base.M) };
}

const ftmActiveSheet = () => ftmState.sheets[ftmState.active] || null;
// Zones gardées d'une feuille : celles de la visionneuse pour la feuille active.
const ftmSheetPolys = sheet => (sheet === ftmActiveSheet() ? ftmState.viewer.polys : sheet.polys);
const ftmSheetGeoref = sheet => !!sheet?.source && (!sheet.source.needsPoints || !!sheet.T);
function ftmSheetLabel(sheet) {
    const src = sheet.source;
    return src.kind === 'pdf' && src.pages > 1 ? `${src.name}, page ${src.pageNo}` : src.name;
}
// Feuilles assemblées, de celle du dessous à celle du dessus.
const ftmJobSheets = () => ftmState.sheets.filter(s => s.visible).reverse();

// Sélection et cadrage de la feuille active rangés dans la feuille, avant d'en
// changer ; son aperçu réduit sert ensuite à la carte.
function ftmStashActive() {
    const st = ftmState, s = ftmActiveSheet();
    if (!s) return;
    s.polys = st.viewer.copyPolys(); s.history = st.viewer.history.slice(); s.view = { ...st.viewer.view };
    if (st.viewer.source === s.source && st.viewer.base && s._thumbOf !== st.viewer.base) { s.thumb = ftmThumb(st.viewer.base); s._thumbOf = st.viewer.base; }
}

function ftmSetBusy(busy) {
    const st = ftmState, $ = st.$;
    st.opening = busy;
    for (const id of ['ftm-file', 'ftm-add-file', 'ftm-black', 'ftm-page', 'ftm-page-sheet']) $(id).disabled = busy;
    if (busy) $('ftm-generate').disabled = true;
    $('ftm-sheets').classList.toggle('is-busy', busy);
}

// Rend une feuille active : sa sélection et son cadrage reviennent dans la
// visionneuse, ses points dans le tableau. rendered : la visionneuse montre
// déjà son fichier (il vient d'être ouvert).
async function ftmActivateSheet(i, { rendered = false } = {}) {
    const st = ftmState, s = st.sheets[i];
    if (!s || (st.opening && !rendered) || (i === st.active && !rendered)) return;
    ftmStashActive();
    st.active = i; st.awaiting = null;
    const viewer = st.viewer;
    viewer.polys = s.polys.map(p => p.map(q => q.slice())); viewer.history = s.history.slice();
    viewer.selectedPoly = viewer.selectedVertex = -1; viewer.drawing = null;
    if (!rendered) {
        ftmSetBusy(true);
        try { await viewer.setSource(s.source, true); }
        catch (e) { console.error(e); alert(`Impossible d'afficher ${s.source.name} : ${e.message}`); }
        finally { ftmSetBusy(false); }
    }
    if (s.view) { viewer.view = { ...s.view }; viewer.draw(); viewer.scheduleDetail(); }
    else if (!rendered) viewer.fit();
    if (viewer.base && s._thumbOf !== viewer.base) { s.thumb = ftmThumb(viewer.base); s._thumbOf = viewer.base; }
    ftmShowSheetUi(s);
    ftmSetTool('pan');
}

// Étapes 1 à 3 aux couleurs de la feuille active.
function ftmShowSheetUi(s) {
    const $ = ftmState.$, src = s?.source;
    $('ftm-page-row').hidden = !(src?.kind === 'pdf' && src.pages > 1);
    if (src?.kind === 'pdf') {
        $('ftm-page').replaceChildren(...Array.from({ length: src.pages }, (_, i) => new Option(`${i + 1} / ${src.pages}`, i + 1)));
        $('ftm-page').value = String(src.pageNo);
    }
    $('ftm-points-step').hidden = !src?.needsPoints;
    $('ftm-geo-step').hidden = !src || src.needsPoints;
    $('ftm-file-info').textContent = src ? (ftmState.sheets.length > 1 ? `Feuille ${ftmState.active + 1} : ` : '') + src.info() : '';
    if (src && !src.needsPoints) $('ftm-geo-info').textContent = (src.kind === 'jp2' ? 'Lu dans les fichiers sélectionnés : ' : 'Lu dans le fichier : ') + src.info() + '.';
    if (src) $('ftm-kind').value = s.kind;
    if (src?.kind === 'jp2') $('ftm-black').checked = src.excludeBlack !== false;
}

// Ouvre les fichiers choisis. replace : nouveau document (les feuilles ouvertes
// sont retirées) ; sinon, les fichiers s'ajoutent comme feuilles. Plusieurs PDF
// ou images choisis ensemble font chacun leur feuille.
async function ftmOpenFile(files, replace = true) {
    const st = ftmState, $ = st.$;
    if (st.opening) return;
    let groups;
    try { groups = ftmSplitSheetFiles(files).map(g => ftmGroupInputFiles(g)); } catch (err) { alert(err.message); return; }
    ftmStashActive();
    const before = $('ftm-file-info').textContent;
    const opened = [];
    ftmSetBusy(true);
    try {
        for (const group of groups) {
            const { file } = group;
            const isPdf = /\.pdf$/i.test(file.name) || file.type === 'application/pdf';
            let src;
            $('ftm-file-info').textContent = `Ouverture de ${file.name}…`;
            try {
                src = isPdf ? await ftmOpenPdf(file) : ftmIsPlainImage(file) ? await ftmOpenImage(file)
                    : /\.jp2$/i.test(file.name) ? await ftmOpenJp2(file, group) : await ftmOpenTiff(file);
                $('ftm-file-info').textContent = `Rendu de l’aperçu de ${file.name}…`;
                await st.viewer.setSource(src);
                opened.push({ src, group, thumb: ftmThumb(st.viewer.base), base: st.viewer.base });
            } catch (e) {
                console.error(e);
                src?.retire?.();
                st.viewer.setStatus('');
                alert(`Impossible d'ouvrir ${file.name} : ${e.message}`);
            }
        }
    } finally { ftmSetBusy(false); }
    if (!opened.length) {
        // Rien d'ouvert : la feuille active revient dans la visionneuse.
        $('ftm-file-info').textContent = before;
        const s = ftmActiveSheet();
        if (s && st.viewer.source !== s.source) { const i = st.active; st.active = -1; await ftmActivateSheet(i); }
        ftmRefresh();
        return;
    }
    if (replace) {
        for (const s of st.sheets) { s.layer?.remove(); s.source.retire?.(); }
        st.sheets = []; st.active = -1; st.zoomTouched = false;
        const { group } = opened[0];
        $('ftm-name').value = opened.length > 1 ? 'Assemblage' : group.file.name.replace(/\.[^.]+$/, '') + (group.images.length > 1 ? '-mosaique' : '');
    } else if (!$('ftm-name').value) $('ftm-name').value = 'Assemblage';
    for (const o of opened) {
        const s = ftmNewSheet(o.src, o.group.file);
        s.thumb = o.thumb; s._thumbOf = o.base;
        st.sheets.push(s);
    }
    // La dernière ouverte est déjà dans la visionneuse.
    st.active = -1;
    await ftmActivateSheet(st.sheets.length - 1, { rendered: true });
    const last = opened.at(-1).src;
    if (!last.needsPoints) st.map.fitBounds(ftmSourceBoundsLatLng(last), { maxZoom: 18 });
    else if (!replace) {
        // Les feuilles déjà calées montrent où pointer la nouvelle.
        const b = ftmSheetsBoundsLatLng();
        if (b) st.map.fitBounds(b.pad(0.1), { maxZoom: 18 });
    }
}

// Une autre page du PDF de la feuille active, en feuille supplémentaire : la
// première page qu'aucune feuille de ce fichier n'utilise encore.
async function ftmAddPageSheet() {
    const st = ftmState, s = ftmActiveSheet();
    if (!s || s.source.kind !== 'pdf' || st.opening) return;
    const used = new Set(st.sheets.filter(o => o.source.kind === 'pdf' && o.file === s.file).map(o => o.source.pageNo));
    let page = 1;
    while (used.has(page) && page < s.source.pages) page++;
    if (used.has(page)) page = s.source.pageNo % s.source.pages + 1;
    ftmStashActive();
    ftmSetBusy(true);
    let src;
    try {
        src = await ftmOpenPdf(s.file);
        await src.setPage(page);
        await st.viewer.setSource(src);
    } catch (e) {
        console.error(e); src?.retire?.(); src = null;
        alert(`Impossible d'ouvrir la page ${page} : ${e.message}`);
    } finally { ftmSetBusy(false); }
    if (!src) { const i = st.active; st.active = -1; await ftmActivateSheet(i); return; }
    const sheet = ftmNewSheet(src, s.file);
    sheet.thumb = ftmThumb(st.viewer.base); sheet._thumbOf = st.viewer.base;
    st.sheets.push(sheet);
    st.active = -1;
    await ftmActivateSheet(st.sheets.length - 1, { rendered: true });
}

async function ftmRemoveSheet(i) {
    const st = ftmState, s = st.sheets[i];
    if (!s || st.opening) return;
    s.layer?.remove(); s.source.retire?.();
    const wasActive = i === st.active;
    st.sheets.splice(i, 1);
    if (!st.sheets.length) {
        st.active = -1; st.awaiting = null;
        st.viewer.clear();
        ftmShowSheetUi(null);
        ftmRefresh();
        return;
    }
    if (wasActive) { st.active = -1; await ftmActivateSheet(Math.min(i, st.sheets.length - 1)); }
    else { if (i < st.active) st.active--; ftmRefresh(); }
}

// Feuille déplacée d'un cran vers le haut (d = -1, passe devant) ou le bas.
function ftmMoveSheet(i, d) {
    const st = ftmState, j = i + d;
    if (j < 0 || j >= st.sheets.length || st.opening) return;
    [st.sheets[i], st.sheets[j]] = [st.sheets[j], st.sheets[i]];
    if (st.active === i) st.active = j; else if (st.active === j) st.active = i;
    ftmRefresh();
}

function ftmToggleSheet(i, visible) {
    const s = ftmState.sheets[i];
    if (!s) return;
    s.visible = visible;
    ftmRefresh();
}

// Liste des feuilles (affichée dès la deuxième).
function ftmRenderSheets() {
    const st = ftmState, $ = st.$, n = st.sheets.length;
    $('ftm-add-row').hidden = !n;
    $('ftm-sheets-wrap').hidden = n < 2;
    const list = $('ftm-sheets');
    list.replaceChildren(...st.sheets.map((s, i) => {
        const src = s.source, usable = src.needsPoints ? ftmUsablePoints(s.points).length : 0;
        const state = !src.needsPoints ? 'géoréférencée' : s.T ? `calée, ${usable} points` : 'à caler';
        const zones = ftmSheetPolys(s).length;
        return ftmEl('div', { class: 'ftm-sheet' + (i === st.active ? ' is-active' : '') + (s.visible ? '' : ' is-hidden'), role: 'listitem', 'data-sheet': i },
            ftmEl('input', { type: 'checkbox', checked: s.visible, 'data-sheet-act': 'visible', title: s.visible ? 'Masquer (non assemblée)' : 'Afficher (assemblée)' }),
            ftmEl('button', { type: 'button', class: 'ftm-sheet-name', title: 'Recaler ou découper cette feuille' }, `${i + 1}. ${ftmSheetLabel(s)}`),
            ftmEl('span', { class: 'ftm-sheet-state' + (ftmSheetGeoref(s) ? ' is-ok' : '') }, state + (zones ? ` · ${zones} zone${zones > 1 ? 's' : ''}` : '')),
            ftmEl('button', { type: 'button', class: 'ftm-mini', 'data-sheet-act': 'up', title: 'Monter : passe devant', disabled: i === 0 }, '↑'),
            ftmEl('button', { type: 'button', class: 'ftm-mini', 'data-sheet-act': 'down', title: 'Descendre : passe derrière', disabled: i === n - 1 }, '↓'),
            ftmEl('button', { type: 'button', class: 'ftm-mini', 'data-sheet-act': 'remove', title: 'Retirer cette feuille' }, '✕'));
    }));
}

// Aperçu d'une feuille sur la carte : découpé à ses zones gardées.
function ftmSheetPreview(sheet) {
    const st = ftmState, src = sheet.source;
    if (!sheet.visible || !ftmSheetGeoref(sheet)) return null;
    const active = sheet === ftmActiveSheet();
    const base = active && st.viewer.source === src ? st.viewer.base : sheet.thumb;
    if (!base) return null;
    const polys = ftmSheetPolys(sheet);
    const clipKey = JSON.stringify(polys) + (src.warp ? sheet._warpFit?.key : '');
    if (src.warp) {
        return { base: ftmWarpedPreview(sheet, base), toMerc: (x, y) => [x, y], clip: polys.length ? ftmMercPolygons(sheet) : null, clipKey };
    }
    return { base, toMerc: (x, y) => src.toMerc(x, y), clip: polys.length ? polys : null, clipKey };
}

// Aperçus de toutes les feuilles, empilés comme elles le seront : celle du haut
// de la liste au-dessus.
function ftmSyncPreviews() {
    const st = ftmState;
    for (const s of [...st.sheets].reverse()) {
        if (!s.layer) { s.layer = new FtmPreviewLayer(() => ftmSheetPreview(s)); s.layer.setOpacity(st.opacity); s.layer.addTo(st.map); }
        s.layer.update();
        if (s.layer._img) s.layer._img.parentNode?.appendChild(s.layer._img);
    }
}

// Emprise des feuilles calées, en LatLng (null s'il n'y en a pas).
function ftmSheetsBoundsLatLng() {
    const rings = ftmState.sheets.filter(ftmSheetGeoref).flatMap(s => ftmMercPolygons(s));
    if (!rings.length) return null;
    return L.latLngBounds(rings.flat().map(([X, Y]) => { const [lon, lat] = ftmMercToLonLat(X, Y); return [lat, lon]; }));
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
    // Plusieurs feuilles : un .points par feuille, au nom de son fichier.
    const stem = st.sheets.length > 1 ? ftmSheetLabel(ftmActiveSheet()).replace(/\.[^.]+(, page (\d+))?$/, (m, p, n) => (n ? `-p${n}` : ''))
        : st.$('ftm-name').value || 'points';
    const a = ftmEl('a', { href: URL.createObjectURL(blob), download: `${stem}.points` });
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
            place('plan', Number.isFinite(p.x), 'Pointer ce repère sur le fichier'),
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
    const onFile = st.source?.kind === 'image' ? "l'IMAGE" : 'le PLAN';
    hint.textContent = !st.source ? '' : st.awaiting === 'plan' ? `Point ${n} : cliquez sa position sur ${onFile} (Échap pour annuler).`
        : st.awaiting === 'map' ? `Point ${n} : cliquez sa position sur la CARTE (Échap pour annuler).`
            + (st.sheets.some((s, k) => k !== st.active && s.points.some(p => Number.isFinite(p.lat))) ? ' Repère commun à une autre feuille : cliquer son rond gris reprend sa position exacte.' : '')
        : '';
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
    // Repères des autres feuilles : un repère vu sur deux feuilles qui se
    // recouvrent n'a qu'une position sur la carte. Un clic dessus, quand le point
    // attend sa position sur la carte, la reprend exactement.
    st.sheets.forEach((s, k) => {
        if (k === st.active) return;
        s.points.forEach((p, i) => {
            if (!Number.isFinite(p.lat)) return;
            const m = L.circleMarker([p.lat, p.lon], { radius: 5, color: '#475569', weight: 2, fillColor: '#fff', fillOpacity: 1, bubblingMouseEvents: false, className: 'ftm-other-point' });
            m.bindTooltip(`Feuille ${k + 1}, point ${i + 1}${st.awaiting === 'map' ? ' — cliquer pour reprendre sa position' : ''}`);
            m.on('click', () => ftmPlaceOnMap(p.lon, p.lat));
            m.addTo(st.markers);
        });
    });
    st.viewer.points = st.points; st.viewer.selected = st.selected; st.viewer.draw();
}

// ----- Recalcul général -----

function ftmRefresh() {
    const st = ftmState, src = st.source, $ = st.$;
    let residuals = null;
    if (src?.needsPoints) {
        const tps = st.kind === 'tps';
        // Déformable : l'affine des moindres carrés sert à décrire l'échelle et
        // l'orientation ; la spline, recalculée seulement quand les points changent.
        st.T = ftmFitTransform(st.points, tps ? 'affine' : st.kind);
        st.warp = null;
        if (tps && st.T) {
            const key = JSON.stringify(st.points.map(p => [p.x, p.y, p.lon, p.lat, p.enabled !== false]));
            if (st._warpFit?.key !== key) {
                const warp = ftmFitWarp(st.points);
                st._warpFit = { key, warp, residuals: warp ? ftmWarpResiduals(st.points) : null };
            }
            st.warp = st._warpFit.warp;
            if (!st.warp) st.T = null;
            // Écarts rangés dans l'ordre des points : la clé les couvre tous.
            else residuals = st._warpFit.residuals;
        } else if (st.T) residuals = ftmResiduals(st.points, st.T);
        src.T = st.T; src.warp = st.warp;
        st.$('ftm-tps-note').hidden = !tps;
        const need = ftmMinPoints(st.kind), have = ftmUsablePoints(st.points).length;
        if (!st.T) {
            $('ftm-fit').textContent = have < need ? `${need - have} point(s) complet(s) de plus, placé(s) sur le fichier ET sur la carte.` : 'Points alignés ou confondus : écartez-les.';
        } else {
            const lat = ftmMercToLonLat(...st.T.slice(4))[1];
            const d = ftmDescribe(st.T, lat);
            const scale = src.unit === 'px' ? `Pixel ≈ <b>${ftmFormatMeters(d.metersPerUnit)}</b> au sol`
                : `Échelle ≈ <b>1/${ftmNum(Math.round(ftmPrintScale(d.metersPerUnit)))}</b> (1 cm du papier = ${ftmFormatMeters(d.metersPerUnit * 72 / 2.54)})`;
            const orient = Math.abs(d.rotation) < 0.05 ? 'nord en haut' : `tourné de ${ftmNum(Math.abs(d.rotation), 1)}° ${d.rotation > 0 ? 'vers la droite' : 'vers la gauche'}`;
            const control = tps
                ? (residuals?.rms != null ? ` · écart de contrôle moyen <b>${ftmFormatMeters(residuals.rms)}</b> (chaque point prédit par les autres)` : ' · ajoutez un 4e point pour contrôler l’écart')
                : (have > need ? ` · écart moyen <b>${ftmFormatMeters(residuals.rms)}</b>` : ' · ajoutez un point de plus pour contrôler l’écart');
            $('ftm-fit').innerHTML = `${tps ? 'Déformable · ' : ''}${scale}${tps ? ' en moyenne' : ''} · ${orient}${control}`;
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
        : (nz ? `${nz} zone(s) gardée(s) ; le reste devient transparent.`
            : st.sheets.length > 1 ? 'Toute la feuille : bordures et légendes comprises. Tracer la zone utile pour les retirer.' : 'Toute la couverture des fichiers.')
        + (src?.kind === 'jp2' && src.excludeBlack ? ' Noir pur exclu.' : '');
    // Emprises sur la carte : la feuille active en trait plein, les autres en tirets.
    st.footprint.clearLayers();
    st.sheets.forEach((s, k) => {
        if (!ftmSheetGeoref(s) || (!s.visible && k !== st.active)) return;
        const active = k === st.active;
        for (const ring of ftmMercPolygons(s)) {
            L.polygon(ring.map(([X, Y]) => { const [lon, lat] = ftmMercToLonLat(X, Y); return [lat, lon]; }),
                { color: active ? '#2563eb' : '#64748b', weight: active ? 2 : 1.5, dashArray: active ? null : '6 4', fill: false, interactive: false }).addTo(st.footprint);
        }
    });
    ftmSyncPreviews();
    ftmRenderSheets();
    ftmUpdateZooms();
}

// Feuilles prêtes à assembler, ou la raison pour laquelle on ne peut pas encore.
function ftmJobReadiness() {
    const st = ftmState, sheets = ftmJobSheets();
    if (!st.sheets.length) return { ok: false, why: '' };
    if (!sheets.length) return { ok: false, why: 'Toutes les feuilles sont masquées : en afficher au moins une.' };
    const late = st.sheets.map((s, i) => ({ s, i })).filter(({ s }) => s.visible && !ftmSheetGeoref(s));
    if (late.length) {
        if (st.sheets.length === 1) return { ok: false, why: '' };
        return { ok: false, why: `À caler avant d'assembler : ${late.map(({ s, i }) => `feuille ${i + 1} (${ftmSheetLabel(s)})`).join(', ')}. Ou la masquer.` };
    }
    return { ok: true, sheets };
}

async function ftmUpdateZooms() {
    const st = ftmState, $ = st.$;
    const ready = ftmJobReadiness();
    const ok = !st.opening && !st.viewer.drawing && ready.ok;
    $('ftm-generate').disabled = !ok;
    if (!ok) { $('ftm-zoom-why').textContent = ready.why || ''; $('ftm-estimate').textContent = ''; return; }
    const suggestions = [];
    for (const sheet of ready.sheets) {
        const src = sheet.source, polys = ftmMercPolygons(sheet);
        const b = ftmPolygonBounds(polys);
        const [, lat] = ftmMercToLonLat((b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2);
        const k = Math.cos(lat * Math.PI / 180);
        const c = src.toMerc(src.width / 2, src.height / 2), d = src.toMerc(src.width / 2 + 1, src.height / 2);
        const metersPerUnit = Math.hypot(d[0] - c[0], d[1] - c[1]) * k;
        const an = await src.analyse();
        if (!st.sheets.includes(sheet) || st.opening) return;
        const sug = ftmSuggestZooms({ metersPerUnit, lat, rasterPxPerUnit: an.rasterPxPerUnit, textSizes: an.textSizes, spanMeters: Math.max(b.x1 - b.x0, b.y1 - b.y0) * k });
        sug.unit = src.unit;
        suggestions.push(sug);
    }
    const sug = ftmCombineZoomSuggestions(suggestions);
    // Toute la zone assemblée doit tenir d'un coup d'œil au zoom minimal.
    const all = ftmAllMercPolygons(), b = ftmPolygonBounds(all);
    const [, lat] = ftmMercToLonLat((b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2);
    const span = Math.max(b.x1 - b.x0, b.y1 - b.y0) * Math.cos(lat * Math.PI / 180);
    while (sug.zmin > 0 && span / ftmGroundResolution(sug.zmin - 1, lat) >= FTM_MIN_SPAN_PX) sug.zmin--;
    if (!st.zoomTouched) { $('ftm-zmin').value = sug.zmin; $('ftm-zmax').value = sug.zmax; }
    const unit = suggestions[sug.from].unit;
    const why = sug.reasons.map(r => r.kind === 'raster' ? `image du fichier : pixel de ${ftmFormatMeters(r.res)} → zoom ${r.zoom}`
        : r.kind === 'text' ? `texte vectoriel (${ftmNum(r.textSize, 1)} ${unit}) lisible à ${FTM_TEXT_PX} px → zoom ${r.zoom}`
        : `dessin vectoriel sans texte → zoom ${r.zoom}`);
    const sheetNote = ready.sheets.length > 1 ? ` — ${ready.sheets.length} feuilles, la plus fine fixe le zoom maximal` : '';
    $('ftm-zoom-why').textContent = ($('ftm-output').value === 'geotiff' ? `Proposé : ${sug.zmax} (${why.join(' ; ')})` : `Proposés : ${sug.zmin} à ${sug.zmax} (${why.join(' ; ')})`) + sheetNote + '.';
    if (!$('ftm-zmin').dataset.bound) {
        $('ftm-zmin').dataset.bound = '1';
        for (const id of ['ftm-zmin', 'ftm-zmax']) $(id).addEventListener('change', () => { st.zoomTouched = true; });
    }
    ftmUpdateEstimate();
}

// Zones gardées d'une feuille (la feuille active par défaut), en Mercator.
function ftmMercPolygons(sheet = ftmActiveSheet()) {
    const src = sheet.source, polys = ftmSheetPolys(sheet);
    const rings = polys.length ? polys : src.footprints || [[[0, 0], [src.width, 0], [src.width, src.height], [0, src.height]]];
    // Côtés densifiés : un GeoTIFF projeté courbe légèrement les droites en
    // Mercator, une spline davantage.
    const n = src.warp ? 24 : src.affine ? 1 : 8;
    return rings.map(ring => {
        const out = [];
        ring.forEach((p, i) => {
            const q = ring[(i + 1) % ring.length];
            for (let k = 0; k < n; k++) out.push(src.toMerc(p[0] + (q[0] - p[0]) * k / n, p[1] + (q[1] - p[1]) * k / n));
        });
        return out;
    });
}

// Zones de toutes les feuilles assemblées, en Mercator.
const ftmAllMercPolygons = () => ftmJobSheets().flatMap(s => ftmMercPolygons(s));

function ftmUpdateEstimate() {
    const st = ftmState, $ = st.$;
    if (st.opening || st.viewer.drawing || !ftmJobReadiness().ok) return;
    let zmin = Number($('ftm-zmin').value), zmax = Number($('ftm-zmax').value);
    if ($('ftm-output').value === 'geotiff') { ftmUpdateGeoTiffEstimate(zmax); return; }
    if (zmin > zmax) { [zmin, zmax] = [zmax, zmin]; $('ftm-zmin').value = zmin; $('ftm-zmax').value = zmax; }
    const sheets = ftmJobSheets();
    const polys = ftmAllMercPolygons();
    // Surface couverte : les recouvrements entre feuilles comptent une fois de
    // trop ; l'emprise totale borne l'estimation.
    const b = ftmPolygonBounds(polys);
    const area = Math.min(polys.reduce((s, p) => s + ftmPolygonArea(p), 0), (b.x1 - b.x0) * (b.y1 - b.y0));
    const tileArea = (ftmMercResolution(zmax) * 256) ** 2;
    const approx = area / tileArea * 4 / 3;
    const fmt = $('ftm-format').value, kb = fmt === 'png' ? 25 : fmt === 'jpg' ? 18 : 10;
    const tooMany = approx > FTM_MAX_TILES;
    const blocks = Math.ceil(area / tileArea / (FTM_BLOCK_TILES * FTM_BLOCK_TILES)) + sheets.length;
    $('ftm-estimate').innerHTML = `≈ <b>${ftmNum(Math.round(approx))}</b> tuiles, ≈ ${ftmNum(approx * kb / 1024, 0)} Mo · ${ftmNum(blocks)} rendus ${sheets.length > 1 ? `de ${sheets.length} feuilles` : 'du fichier'} au zoom ${zmax}.`
        + ($('ftm-mnt').checked ? '<br>Relief ajouté aux niveaux 0 à 12, dans le même MBTiles.' : '')
        + (fmt === 'jpg' ? '<br>JPEG : les zones transparentes seront blanches. Choisir PNG ou WebP pour conserver la transparence.' : '')
        + (tooMany ? `<br><span class="ftm-warn">Trop de tuiles pour le navigateur (au-delà de ${ftmNum(FTM_MAX_TILES)}) : baissez le zoom maximal ou réduisez la zone.</span>` : '');
    $('ftm-generate').disabled = tooMany;
}

// GeoTIFF : dimensions, taille au sol du pixel et poids approximatif.
const FTM_TIFF_MAX_PX = { 'geotiff-jpeg': 1.2e9, geotiff: 2.5e8 };   // fichier gardé en mémoire jusqu'à la fin

function ftmUpdateGeoTiffEstimate(z) {
    const st = ftmState, $ = st.$;
    const g = ftmGeoTiffGrid(ftmAllMercPolygons(), z);
    const lat = ftmMercToLonLat(0, g.originY - g.height * g.res / 2)[1];
    const fmt = $('ftm-format').value, px = g.width * g.height;
    const bytes = px * (fmt === 'geotiff' ? 3 : 0.35);
    const tooMany = px > FTM_TIFF_MAX_PX[fmt];
    $('ftm-estimate').innerHTML = `<b>${ftmNum(g.width)} × ${ftmNum(g.height)}</b> px, pixel de ${ftmFormatMeters(ftmGroundResolution(z, lat))} au sol, ≈ ${ftmNum(bytes / 1048576, 0)} Mo.`
        + (tooMany ? `<br><span class="ftm-warn">Trop grand pour le navigateur (au-delà de ${ftmNum(FTM_TIFF_MAX_PX[fmt] / 1e6)} millions de pixels${fmt === 'geotiff' ? ' sans compression' : ''}) : baissez le zoom, réduisez la zone${fmt === 'geotiff' ? ' ou choisissez JPEG' : ''}.</span>` : '');
    $('ftm-generate').disabled = tooMany;
}

// ===== Génération =====

function ftmStartJob() {
    const st = ftmState, $ = st.$;
    if (st.opening || st.viewer.drawing || $('ftm-generate').disabled) return;
    const ready = ftmJobReadiness();
    if (!ready.ok) return;
    const zmin = Number($('ftm-zmin').value), zmax = Number($('ftm-zmax').value);
    const geotiff = $('ftm-output').value === 'geotiff';
    // Une couche par feuille assemblée, de celle du dessous à celle du dessus.
    const layers = ready.sheets.map(sheet => {
        const src = sheet.source, polys = ftmSheetPolys(sheet);
        return {
            source: src, label: ftmSheetLabel(sheet), T: sheet.T ? sheet.T.slice() : null,
            warp: src.needsPoints ? sheet.warp : null,
            polysSrc: polys.length ? polys.map(poly => poly.map(p => p.slice())) : null,
            polysMerc: ftmMercPolygons(sheet),
            pointsUsed: ftmUsablePoints(sheet.points).length,
            excludeBlack: src.excludeBlack,
        };
    });
    const job = new FtmJob({
        id: ftmJobCounter++, layers, polysMerc: layers.flatMap(l => l.polysMerc),
        zmin: geotiff ? zmax : zmin, zmax, format: $('ftm-format').value, geotiff,
        name: ($('ftm-name').value || 'Plan').trim(), includeMnt: !geotiff && $('ftm-mnt').checked,
    });
    st.modal.hidden = true; document.body.classList.remove('ftm-open');
    job.run();
}

class FtmJob {
    constructor(o) {
        Object.assign(this, o);
        this.layers.forEach(l => l.source.retain?.());
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
        const one = this.layers.length === 1 && this.layers[0];
        this.ui.querySelector('.font-bold').textContent = `${this.name}.${this.geotiff ? 'tif' : 'mbtiles'} — `
            + (one ? `${ftmKindLabel(one.source)}${one.warp ? ', déformable' : ''}` : `${this.layers.length} feuilles assemblées`);
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
        if (this.geotiff) return this.runGeoTiff();
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
            this.layers.forEach(l => l.source.release?.());
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

    // Matrice « unités source → pixels du canevas » (w × h) d'une couche, B : Mercator → canevas.
    sourceMatrix(layer, B, w, h) {
        const src = layer.source;
        if (src.affine) return ftmMultiply(B, layer.T);
        // Source projetée : approximation affine sur l'emprise du canevas (écart
        // de l'ordre du centimètre sur quelques centaines de mètres).
        const Bi = ftmInvert(B);
        const cs = [[0, 0], [w, 0], [0, h], [w, h]].map(([u, v]) => src.mercToSource(...ftmApply(Bi, u, v)));
        const xs = cs.map(c => c[0]), ys = cs.map(c => c[1]);
        const { T } = ftmLocalAffine((x, y) => src.toMerc(x, y), Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys));
        return ftmMultiply(B, T);
    }

    // Dessine les zones gardées de toutes les couches sur ctx (w × h px, effacé
    // d'abord), de celle du dessous à celle du dessus. B : Mercator → canevas ;
    // lecture limitée à region [u0, v0, u1, v1]. Une couche dont les zones ne
    // touchent pas region n'est pas rendue (un rendu de PDF coûte un temps fixe).
    async drawRegion(ctx, B, w, h, region) {
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.globalCompositeOperation = 'source-over';
        ctx.clearRect(0, 0, w, h);
        const Bi = ftmInvert(B), [u0, v0, u1, v1] = region;
        const corners = [[u0, v0], [u1, v0], [u0, v1], [u1, v1]].map(([u, v]) => ftmApply(Bi, u, v));
        const zone = ftmPolygonBounds([corners]);
        const layers = this.layers.filter(l => ftmBoundsOverlap(l.bounds ??= ftmPolygonBounds(l.polysMerc), zone));
        if (layers.length === 1 && this.layers.length === 1) { await this.drawLayer(layers[0], ctx, B, w, h, region); return; }
        if (!this._scratch || this._scratch.width !== w || this._scratch.height !== h) {
            this._scratch = document.createElement('canvas'); this._scratch.width = w; this._scratch.height = h;
        }
        const sctx = this._scratch.getContext('2d', { willReadFrequently: true });
        for (const layer of layers) {
            sctx.setTransform(1, 0, 0, 1, 0, 0); sctx.globalCompositeOperation = 'source-over'; sctx.clearRect(0, 0, w, h);
            await this.drawLayer(layer, sctx, B, w, h, region);
            if (this.cancelled) return;
            ctx.drawImage(this._scratch, 0, 0);
        }
    }

    // Une couche sur ctx (vide), découpée à ses zones gardées.
    async drawLayer(layer, ctx, B, w, h, region) {
        const src = layer.source;
        let M, polys;
        if (layer.warp) {
            // Spline : rendu pixel par pixel, zones découpées dans leur tracé
            // Mercator (côtés densifiés, courbés par la spline).
            this._task = ftmRenderWarped(src, layer.warp, ctx, B, region);
            M = B; polys = layer.polysMerc;
        } else {
            M = this.sourceMatrix(layer, B, w, h);
            this._task = src.render(ctx, M, w, h, { excludeBlack: layer.excludeBlack, region });
            polys = layer.polysSrc || src.footprints || [[[0, 0], [src.width, 0], [src.width, src.height], [0, src.height]]];
        }
        await this._task;
        if (this.cancelled) return;
        // Ne garder que les zones voulues, et rien hors du fichier.
        ctx.setTransform(...M);
        ctx.globalCompositeOperation = 'destination-in';
        ftmTraceRings(ctx, polys);
        ctx.fill('nonzero');
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.globalCompositeOperation = 'source-over';
    }

    async renderMaxZoom(tiles) {
        const side = FTM_BLOCK_TILES * 256;
        const canvas = document.createElement('canvas'); canvas.width = canvas.height = side;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        const tile = document.createElement('canvas'); tile.width = tile.height = 256;
        const tctx = tile.getContext('2d', { willReadFrequently: true });
        const blocks = ftmGroupBlocks(tiles, FTM_BLOCK_TILES, FTM_STRIP_BLOCKS);
        for (const block of blocks) {
            if (this.cancelled) return;
            // Lecture du fichier limitée aux tuiles demandées du bloc (bord de sélection).
            const xs = block.tiles.map(t => t.x - block.x0), ys = block.tiles.map(t => t.y - block.y0);
            const region = [Math.min(...xs) * 256, Math.min(...ys) * 256, (Math.max(...xs) + 1) * 256, (Math.max(...ys) + 1) * 256];
            await this.drawRegion(ctx, ftmMercToBlockMatrix(this.zmax, block.x0, block.y0), side, side, region);
            if (this.cancelled) return;
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

    georefText() {
        const one = l => l.source.needsPoints ? `recalé par ${l.pointsUsed} points d'appui${l.warp ? ' (déformable)' : ''}`
            : `${ftmKindLabel(l.source)} EPSG:${l.source.epsg}`;
        if (this.layers.length === 1) return one(this.layers[0]);
        // Du dessus vers le dessous, comme la liste des feuilles.
        return `${this.layers.length} feuilles assemblées : ` + [...this.layers].reverse().map(l => `${l.label} (${one(l)})`).join(' ; ');
    }

    // Nom des fichiers sources, pour les métadonnées.
    sourceText() {
        return this.layers.length === 1 ? this.layers[0].source.name : `${this.name}`;
    }

    // GeoTIFF : raster Web Mercator sur la grille de pixels du zoom maximal, rendu
    // par bandes (blocs de 2 048 px de large) et écrit au fil de l'eau
    // (createGeoTiffStream, geotiffExport.js). Fond blanc hors des zones gardées.
    async runGeoTiff() {
        try {
            const g = ftmGeoTiffGrid(this.polysMerc, this.zmax), W = g.width, H = g.height;
            if (W * H > FTM_TIFF_MAX_PX[this.format]) throw new Error('Image trop grande : baisser le zoom ou réduire la zone.');
            const CW = FTM_BLOCK_TILES * 256;
            // Bande de 1 024 lignes au plus, et de 48 Mo au plus en mémoire.
            const BH = Math.max(64, Math.min(1024, Math.floor(48e6 / (W * 4) / 64) * 64));
            const bands = Math.ceil(H / BH), cols = Math.ceil(W / CW);
            this.steps = new JobSteps([
                { id: 'render', label: `Rendu du fichier, pixel du zoom ${this.zmax} (${ftmNum(W)} × ${ftmNum(H)} px)`, total: bands * cols },
                { id: 'asm', label: 'Écriture du GeoTIFF', auto: false },
            ]);
            this.ui.querySelector('.ftm-job-steps').replaceChildren(this.steps.el);
            this.status('EN COURS', '');
            const ascii = t => t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\x20-\x7e]/g, '?');
            const tif = createGeoTiffStream({
                width: W, height: H, jpeg: this.format === 'geotiff-jpeg', quality: 0.9, epsg: 3857,
                originX: g.originX, originY: g.originY, pixelScaleX: g.res, pixelScaleY: g.res,
                description: ascii(`${this.sourceText()} - ${this.georefText()} (Carroyage-JMT)`),
            });
            const canvas = document.createElement('canvas'); canvas.width = CW; canvas.height = BH;
            const ctx = canvas.getContext('2d', { willReadFrequently: true });
            const bounds = this.polysMerc.map(p => ftmPolygonBounds([p]));
            this.steps.start('render');
            for (let y = 0; y < H; y += BH) {
                const bh = Math.min(BH, H - y);
                const rows = new Uint8ClampedArray(W * bh * 4).fill(255);
                for (let x = 0; x < W; x += CW) {
                    if (this.cancelled) return;
                    const cw = Math.min(CW, W - x);
                    // Bloc hors de toute zone : reste blanc, sans rendu.
                    const X0 = g.originX + x * g.res, X1 = X0 + cw * g.res, Y1 = g.originY - y * g.res, Y0 = Y1 - bh * g.res;
                    const hit = this.polysMerc.some((p, i) => bounds[i].x1 > X0 && bounds[i].x0 < X1 && bounds[i].y1 > Y0 && bounds[i].y0 < Y1
                        && ftmPolygonArea(ftmClipPolygonToRect(p, X0, Y0, X1, Y1)) > 0);
                    if (hit) {
                        await this.drawRegion(ctx, ftmMercToBlockMatrix(this.zmax, (g.px0 + x) / 256, (g.py0 + y) / 256), CW, BH, [0, 0, cw, bh]);
                        if (this.cancelled) return;
                        const px = ctx.getImageData(0, 0, cw, bh).data;
                        let any = false;
                        for (let r = 0; r < bh; r++) {
                            for (let i = r * cw * 4, o = (r * W + x) * 4, end = i + cw * 4; i < end; i += 4, o += 4) {
                                const a = px[i + 3];
                                if (!a) continue;
                                any = true;
                                const k = a / 255, w = 255 * (1 - k);    // sur fond blanc
                                rows[o] = px[i] * k + w; rows[o + 1] = px[i + 1] * k + w; rows[o + 2] = px[i + 2] * k + w;
                            }
                        }
                        if (any) this.stored++;
                    }
                    this.steps.advance('render');
                    await new Promise(r => setTimeout(r, 0));
                }
                await tif.write(rows, bh);
            }
            if (this.cancelled) return;
            if (!this.stored) throw new Error('Aucun pixel conservé dans la sélection. Modifier la zone ou désactiver l’exclusion du noir.');
            this.steps.finish('render');
            this.steps.start('asm');
            const blob = await tif.finish();
            if (this.cancelled) return;
            this.steps.finish('asm', `${ftmNum(blob.size / 1048576, 1)} Mo`);
            this.status('TERMINÉ', 'text-green-600 font-bold');
            const fname = `${this.name}.tif`;
            const save = () => ftmSaveBytes(blob, fname);
            this.ui.querySelector('.ftm-job-actions').replaceChildren(ftmEl('button', { type: 'button', class: 'text-green-600 font-bold hover:underline', onclick: save }, 'Télécharger'));
            await save();
        } catch (e) {
            if (this.cancelled) return;
            console.error(e);
            this.status('ERREUR', 'text-red-600 font-bold');
            this.steps?.fail();
            const msg = this.ui.querySelector('.ftm-job-message');
            msg.textContent = e.message; msg.hidden = false;
        } finally {
            this.layers.forEach(l => l.source.release?.());
        }
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
                description: `${this.sourceText()} — ${this.georefText()} (Carroyage-JMT)`,
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

// Nature d'une source, pour les libellés.
function ftmKindLabel(src) {
    return { pdf: 'PDF', image: 'Image', jp2: 'JP2', tiff: 'GeoTIFF' }[src.kind] || src.kind;
}

async function ftmSaveBytes(data, fname) {
    const tif = /\.tif$/i.test(fname);
    const type = tif ? 'image/tiff' : 'application/x-sqlite3';
    if (window.showSaveFilePicker) {
        try {
            const fh = await window.showSaveFilePicker({ suggestedName: fname, types: [tif
                ? { description: 'GeoTIFF', accept: { 'image/tiff': ['.tif', '.tiff'] } }
                : { description: 'MBTiles', accept: { 'application/x-sqlite3': ['.mbtiles'] } }] });
            const w = await fh.createWritable(); await w.write(data); await w.close();
            return;
        } catch (e) { if (e.name === 'AbortError') return; }
    }
    const a = ftmEl('a', { href: URL.createObjectURL(data instanceof Blob ? data : new Blob([data], { type })), download: fname });
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
