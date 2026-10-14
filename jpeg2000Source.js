// Adaptateur JP2 pour fileToMbtiles.js. Aucun serveur ni service distant :
// un Web Worker lit le File sélectionné et décode ses blocs avec OpenJPEG WASM.

function ftmJp2Xml(text, filename) {
    if (!text) return {};
    if (/<!DOCTYPE|<!ENTITY/i.test(text)) throw new Error('Le XML ne doit pas contenir de DTD ou d’entités.');
    const doc = new DOMParser().parseFromString(text, 'application/xml');
    if (doc.getElementsByTagName('parsererror').length) throw new Error('Le XML fourni est illisible.');
    const all = (tag, node = doc) => Array.from(node.getElementsByTagNameNS('*', tag));
    const value = tag => all(tag)[0]?.textContent.trim();
    const root = doc.documentElement.localName, out = {};
    if (root === 'Dimap_Document' || root === 'PAMDataset') {
        const paths = all('DATA_FILE_PATH').map(el => (el.getAttribute('href') || '').replace(/\\/g, '/').split('/').pop().toLowerCase());
        if (paths.length && !paths.includes(filename.toLowerCase())) throw new Error('Ce XML DIMAP décrit une autre image JP2.');
        const crs = value('PROJECTED_CRS_CODE') || value('GEODETIC_CRS_CODE') || value('SRS');
        if (crs) {
            out.epsg = ftmEpsgFromText(crs);
            if (!out.epsg) throw new Error('Le système de coordonnées du XML ne contient pas de code EPSG reconnu.');
        }
        const gt = value('GeoTransform');
        if (gt) {
            const n = gt.split(',').map(Number);
            if (n.length !== 6 || !n.every(Number.isFinite)) throw new Error('GeoTransform invalide dans le XML.');
            out.P = [n[1], n[4], n[2], n[5], n[0], n[3]];
        }
        for (const special of all('Special_Value')) {
            const kind = all('SPECIAL_VALUE_TEXT', special)[0]?.textContent.trim().toUpperCase();
            const count = all('SPECIAL_VALUE_COUNT', special)[0]?.textContent.trim();
            if (kind === 'NODATA' && count !== undefined && Number.isFinite(Number(count))) out.nodata = Number(count);
        }
    } else {
        const grid = all('RectifiedGrid')[0];
        if (!grid) return out;
        const point = all('Point', grid)[0], origin = all('pos', point || grid)[0];
        const offsets = all('offsetVector', grid);
        const srs = point?.getAttribute('srsName') || grid.getAttribute('srsName');
        out.epsg = ftmEpsgFromText(srs);
        if (!out.epsg || !origin || offsets.length !== 2) return {};
        const parse = el => el.textContent.trim().split(/\s+/).map(Number);
        let o = parse(origin), x = parse(offsets[0]), y = parse(offsets[1]);
        if ([o, x, y].some(p => p.length !== 2 || !p.every(Number.isFinite))) throw new Error('Grille GMLJP2 invalide.');
        // GML suit les axes EPSG (latitude, longitude pour les CRS géographiques).
        if ([4326, 4171, 4258].includes(out.epsg)) { o.reverse(); x.reverse(); y.reverse(); }
        out.P = [x[0], x[1], y[0], y[1], o[0] - (x[0] + y[0]) / 2, o[1] - (x[1] + y[1]) / 2];
    }
    return out;
}

async function ftmOpenJpeg2000(file, companions, { epsgText = '', bandsText = '', excludeBlack = true } = {}) {
    if (epsgText && !/^\d+$/.test(epsgText)) throw new Error('Saisir un code EPSG entier, par exemple 4326 ou 2154.');
    if (bandsText && !/^\d+(\s*,\s*\d+){0,2}$/.test(bandsText)) throw new Error('Bandes : une bande grise (1) ou trois bandes RVB (1,2,3).');
    if (companions.xml?.size > 4 * 1024 * 1024 || companions.world?.size > 64 * 1024) throw new Error('Le fichier de métadonnées est trop volumineux (XML : 4 Mo, J2W : 64 Ko).');
    await loadScriptOnce('vendor/proj4/proj4.js');
    const worker = new Worker(new URL('jpeg2000Worker.js', document.baseURI));
    const pending = new Map();
    let serial = 0, failure = null;
    const fail = err => { for (const task of pending.values()) task.reject(err); pending.clear(); };
    worker.onerror = event => { failure = new Error(event.message || 'Le décodeur JPEG 2000 n’a pas pu démarrer.'); fail(failure); };
    worker.onmessage = ({ data }) => {
        const task = pending.get(data.id);
        if (!task) return;
        if (data.type === 'tile') {
            try { task.tile?.(data); } catch (err) { pending.delete(data.id); task.reject(err); worker.postMessage({ type: 'cancel', id: data.id }); }
            return;
        }
        pending.delete(data.id);
        if (data.type === 'error') task.reject(new Error(data.message));
        else task.resolve(data);
    };
    function request(type, data, tile) {
        if (failure) return Promise.reject(failure);
        const id = ++serial;
        const p = new Promise((resolve, reject) => { pending.set(id, { resolve, reject, tile }); worker.postMessage({ type, id, ...data }); });
        p.cancel = () => {
            const task = pending.get(id);
            if (!task) return;
            pending.delete(id); worker.postMessage({ type: 'cancel', id });
            task.reject(new DOMException('Rendu annulé.', 'AbortError'));
        };
        return p;
    }
    try {
        const info = await request('open', { file });
        const external = ftmJp2Xml(companions.xml ? await companions.xml.text() : '', file.name);
        let internal = {};
        if (info.geotiffs.length) {
            await loadScriptOnce('vendor/geotiff/geotiff.js');
            const tiff = await GeoTIFF.fromArrayBuffer(info.geotiffs[0].buffer);
            const image = await tiff.getImage();
            const keys = image.getGeoKeys() || {}, fd = image.fileDirectory;
            const tag = n => (typeof fd.getValue === 'function' ? fd.getValue(n) : fd[n]) ?? undefined;
            internal = { epsg: ftmGeoTiffEpsg(keys), P: ftmGeoTiffPixelTransform({ ModelTransformation: tag('ModelTransformation'), ModelTiepoint: tag('ModelTiepoint'), ModelPixelScale: tag('ModelPixelScale') }, keys) };
        }
        if (!internal.P || !internal.epsg) {
            for (const text of info.xml) {
                const gml = ftmJp2Xml(text, file.name);
                if (gml.P) { internal = { ...gml, ...Object.fromEntries(Object.entries(internal).filter(([, v]) => v != null)) }; break; }
            }
        }
        const P = companions.world ? ftmParseWorldFile(await companions.world.text()) : external.P || internal.P;
        const epsg = epsgText ? Number(epsgText) : external.epsg || internal.epsg;
        if (!P) throw new Error('Position absente : sélectionner aussi le J2W associé au JP2.');
        if (!epsg) throw new Error('Projection absente : joindre le XML ou renseigner le code EPSG dans les options JP2. Le J2W ne précise pas la projection.');
        if (!P.every(Number.isFinite) || P[0] * P[3] === P[1] * P[2]) throw new Error('Géoréférencement JP2 invalide.');
        const def = ftmProjDefinition(epsg);
        if (!def) throw new Error(`Projection EPSG:${epsg} non prise en charge. Utiliser WGS84, Lambert 93, Web Mercator ou UTM.`);
        const explicitBands = bandsText ? bandsText.split(',').map(n => Number(n) - 1) : null;
        const declared = [1, 2, 3].map(a => info.channels.find(c => c.type === 0 && c.association === a)?.index);
        const bands = explicitBands || (info.components === 1 ? [0] : declared.every(b => b !== undefined) ? declared : [0, 1, 2]);
        if (![1, 3].includes(bands.length) || bands.some(b => b < 0 || b >= info.components)) throw new Error(`Choisir une bande grise ou trois bandes RVB entre 1 et ${info.components}.`);
        const alpha = info.channels.find(c => c.type === 1)?.index ?? null;
        const proj = proj4(def, ftmProjDefinition(3857)), Pi = ftmInvert(P);
        const src = {
            kind: 'jp2', name: file.name, needsPoints: false, unit: 'px', affine: false, epsg, P, excludeBlack,
            width: info.width, height: info.height, users: 0, retired: false,
            toMerc(x, y) { return proj.forward(ftmApply(P, x, y)); },
            mercToSource(X, Y) { return ftmApply(Pi, ...proj.inverse([X, Y])); },
            retain() { this.users++; },
            release() { if (--this.users === 0 && this.retired) this.dispose(); },
            retire() { this.retired = true; if (!this.users) this.dispose(); },
            dispose() { failure = new DOMException('Source fermée.', 'AbortError'); fail(failure); worker.terminate(); },
            render(ctx, M, w, h, options = {}) {
                const Mi = ftmInvert(M);
                const corners = [[0, 0], [w, 0], [0, h], [w, h]].map(c => ftmApply(Mi, ...c));
                const window = [Math.max(0, Math.floor(Math.min(...corners.map(c => c[0])))), Math.max(0, Math.floor(Math.min(...corners.map(c => c[1])))),
                    Math.min(this.width, Math.ceil(Math.max(...corners.map(c => c[0])))), Math.min(this.height, Math.ceil(Math.max(...corners.map(c => c[1]))))];
                if (window[0] >= window[2] || window[1] >= window[3]) return Promise.resolve();
                const scale = Math.max(Math.hypot(M[0], M[1]), Math.hypot(M[2], M[3]));
                const reducePower = Math.min(info.levels, Math.max(0, Math.floor(Math.log2(1 / scale))));
                return request('render', { window, reducePower, bands, alpha, nodata: external.nodata ?? null, excludeBlack: options.excludeBlack ?? this.excludeBlack }, image => {
                    const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
                    canvas.getContext('2d').putImageData(new ImageData(image.rgba, image.width, image.height), 0, 0);
                    ctx.save();
                    ctx.setTransform(...M); ctx.beginPath(); ctx.rect(0, 0, this.width, this.height); ctx.clip();
                    ctx.setTransform(...ftmMultiply(M, [image.divisor, 0, 0, image.divisor, image.x, image.y]));
                    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
                    ctx.drawImage(canvas, 0, 0); ctx.restore();
                    if (ftmState?.opening) ftmState.viewer.setStatus(`Rendu de l’aperçu… ${image.done}/${image.total} blocs`);
                });
            },
            async analyse() { return { textSizes: [], rasterPxPerUnit: 1 }; },
            info() { return `JP2 EPSG:${epsg} — ${ftmNum(this.width)} × ${ftmNum(this.height)} px · position ${companions.world ? 'J2W' : external.P ? 'XML' : 'JP2'} · bandes ${bands.map(b => b + 1).join(', ')}`; },
        };
        return src;
    } catch (err) { worker.terminate(); throw err; }
}

// Les DIMAP peuvent décrire plusieurs parties d'une même acquisition. Un XML
// est associé par ses DATA_FILE_PATH, ou par son nom pour les fichiers PAM.
async function ftmOpenJp2Mosaic(group, options) {
    const groups = group.images.map(g => ({ ...g, xml: null }));
    const used = new Set();
    for (const xml of group.xmls) {
        if (xml.size > 4 * 1024 * 1024) throw new Error('Le XML dépasse 4 Mo : ' + xml.name);
        const text = await xml.text();
        if (/<!DOCTYPE|<!ENTITY/i.test(text)) throw new Error('Le XML ne doit pas contenir de DTD ou d’entités.');
        const doc = new DOMParser().parseFromString(text, 'application/xml');
        if (doc.getElementsByTagName('parsererror').length) throw new Error('XML illisible : ' + xml.name);
        const paths = Array.from(doc.getElementsByTagNameNS('*', 'DATA_FILE_PATH')).map(el => (el.getAttribute('href') || '').replace(/\\/g, '/').split('/').pop().toLowerCase());
        for (const g of groups) {
            const filename = g.file.name.toLowerCase();
            const named = [filename + '.aux.xml', filename.replace(/\.jp2$/, '.xml')].includes(xml.name.toLowerCase());
            if (paths.length ? paths.includes(filename) : named || groups.length === 1 && group.xmls.length === 1) {
                if (g.xml) throw new Error('Plusieurs XML décrivent ' + g.file.name + '. Garder le XML de géoréférencement.');
                g.xml = xml; used.add(xml);
            }
        }
    }
    if (used.size !== group.xmls.length) throw new Error('XML sans image correspondante : ' + group.xmls.filter(x => !used.has(x)).map(x => x.name).join(', '));
    const sources = [];
    try {
        // Ordre stable : en recouvrement, le dernier nom l'emporte, sauf pixels
        // transparents qui laissent apparaître l'image précédente.
        groups.sort((a, b) => a.file.name.localeCompare(b.file.name));
        for (const g of groups) sources.push(await ftmOpenJpeg2000(g.file, g, options));
        if (sources.length === 1) return sources[0];
        const layout = ftmMosaicLayout(sources), first = sources[0];
        return {
            kind: 'jp2', name: sources.map(s => s.name).join(' + '), needsPoints: false, unit: 'px', affine: false,
            epsg: first.epsg, width: layout.width, height: layout.height, excludeBlack: options.excludeBlack,
            sources, layout,
            toMerc(x, y) { return first.toMerc(x + layout.x0, y + layout.y0); },
            mercToSource(X, Y) { const p = first.mercToSource(X, Y); return [p[0] - layout.x0, p[1] - layout.y0]; },
            footprints: sources.map((s, i) => { const [x, y] = layout.offsets[i]; return [[x, y], [x + s.width, y], [x + s.width, y + s.height], [x, y + s.height]]; }),
            retain() { sources.forEach(s => s.retain()); },
            release() { sources.forEach(s => s.release()); },
            retire() { sources.forEach(s => s.retire()); },
            render(ctx, M, w, h, renderOptions = {}) {
                let task, cancelled = false;
                const excludeBlack = renderOptions.excludeBlack ?? this.excludeBlack;
                const result = (async () => {
                    for (let i = 0; i < sources.length; i++) {
                        if (cancelled) throw new DOMException('Rendu annulé.', 'AbortError');
                        const [x, y] = layout.offsets[i];
                        task = sources[i].render(ctx, ftmMultiply(M, [1, 0, 0, 1, x, y]), w, h, { excludeBlack });
                        await task;
                    }
                })();
                result.cancel = () => { cancelled = true; task?.cancel?.(); };
                return result;
            },
            async analyse() { return { textSizes: [], rasterPxPerUnit: 1 }; },
            info() { return `${sources.length} JP2 assemblés · EPSG:${this.epsg} · ${ftmNum(this.width)} × ${ftmNum(this.height)} px · ${layout.overlap ? 'recouvrement : priorité au dernier nom de fichier' : 'images jointives'} · grille commune vérifiée`; },
        };
    } catch (err) { sources.forEach(s => s.retire()); throw err; }
}
