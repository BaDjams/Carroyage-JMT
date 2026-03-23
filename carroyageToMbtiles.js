// carroyageToMbtiles.js

/**
 * Orchestrateur principal pour la génération de MBTiles (Overlay DJI)
 * Accepte optionalCadoData { config, gridData } pour le Mode 1.
 */
async function generateMbtilesProcess(filename, useUtm, useCfsi, useCado, bbox, baseZoom, userPOIs, optionalCadoData = null) {
    if (typeof window.initSqlJs !== 'function') throw new Error("SQL.js non chargé.");

    // Configuration Zoom
    // On génère le zoom de base + 2 niveaux de sur-zoom pour la netteté en vol
    const minZ = baseZoom;
    const maxZ = Math.min(baseZoom + 2, 19); 
    const maxCanvasSize = 8192; // Limite de sécurité navigateur
    
    // Initialisation DB
    const SQL = await window.initSqlJs({ locateFile: file => file });
    const db = new SQL.Database();
    
    db.run("CREATE TABLE metadata (name text, value text);");
    db.run("CREATE TABLE tiles (zoom_level integer, tile_column integer, tile_row integer, tile_data blob);");
    db.run("CREATE UNIQUE INDEX tile_index on tiles (zoom_level, tile_column, tile_row);");

    // Métadonnées
    db.run("INSERT INTO metadata VALUES (?, ?)", ["name", filename]);
    db.run("INSERT INTO metadata VALUES (?, ?)", ["format", "png"]);
    db.run("INSERT INTO metadata VALUES (?, ?)", ["type", "overlay"]);
    db.run("INSERT INTO metadata VALUES (?, ?)", ["version", "1.2"]);
    db.run("INSERT INTO metadata VALUES (?, ?)", ["bounds", `${bbox.west},${bbox.south},${bbox.east},${bbox.north}`]);
    db.run("INSERT INTO metadata VALUES (?, ?)", ["minzoom", String(minZ)]);
    db.run("INSERT INTO metadata VALUES (?, ?)", ["maxzoom", String(maxZ)]);
    db.run("INSERT INTO metadata VALUES (?, ?)", ["scheme", "tms"]);

    // Configuration CADO
    let cadoConfig = null;
    let cadoGridData = null;

    if (useCado) {
        // Priorité aux données passées en argument (Mode 1)
        if (optionalCadoData && optionalCadoData.config && optionalCadoData.gridData) {
            cadoConfig = optionalCadoData.config;
            cadoGridData = optionalCadoData.gridData;
        } 
        // Sinon Fallback sur l'interface (Mode 2)
        else if (typeof getZoneCadoConfigAndBounds === 'function') {
            try {
                const cadoRes = getZoneCadoConfigAndBounds();
                cadoConfig = cadoRes.config;
                
                // Style forcé Digital
                cadoConfig.lineWidth = 2;
                cadoConfig.gridColor = document.getElementById('utm-grid-color') ? document.getElementById('utm-grid-color').value : "#FF0000";
                
                if(typeof calculateGridData === 'function') {
                    cadoGridData = calculateGridData(cadoConfig);
                    cadoConfig.a1Coords = [cadoRes.a1CornerLon, cadoRes.a1CornerLat];
                }
            } catch(e) { console.warn("MBTiles: CADO config not found from UI", e); }
        }
    }

    // 3. Boucle de génération sur les niveaux de zoom
    for (let z = minZ; z <= maxZ; z++) {
        await processZoomLevel(db, z, bbox, useUtm, useCfsi, cadoConfig, cadoGridData, userPOIs, maxCanvasSize);
    }

    // 4. Export
    const data = db.export();
    return new Blob([data], { type: 'application/x-sqlite3' });
}

/**
 * Traite un niveau de zoom : Dessin Vectoriel -> Rasterisation -> Tuilage
 */
async function processZoomLevel(db, zoom, bbox, useUtm, useCfsi, cadoConfig, cadoGridData, userPOIs, maxLimit) {
    const nwPx = mbtLatLonToPx(bbox.north, bbox.west, zoom);
    const sePx = mbtLatLonToPx(bbox.south, bbox.east, zoom);
    
    const width = Math.abs(sePx.x - nwPx.x);
    const height = Math.abs(sePx.y - nwPx.y);

    if (width > maxLimit || height > maxLimit) {
        console.warn(`Zoom ${zoom} ignoré : dimensions trop grandes.`);
        return; 
    }

    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(width);
    canvas.height = Math.ceil(height);
    const ctx = canvas.getContext('2d');

    // Fond transparent strict
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Projection locale pour le dessin
    const project = (lat, lon) => {
        const p = mbtLatLonToPx(lat, lon, zoom);
        return { x: p.x - nwPx.x, y: p.y - nwPx.y };
    };

    // Récupération couleur globale (défaut noir)
    const color = (cadoConfig && cadoConfig.gridColor) ? cadoConfig.gridColor : (document.getElementById('utm-grid-color') ? document.getElementById('utm-grid-color').value : "#000000");
    
    // --- DESSIN DES COUCHES ---
    
    // 1. UTM
    if (useUtm) {
        drawDigitalUtm(ctx, bbox, project, color);
    }

    // 2. CFSI
    if (useCfsi) {
        drawDigitalCfsiStrict(ctx, bbox, project, color, zoom);
    }

    // 3. CADO
    if (cadoConfig && cadoGridData) {
        drawDigitalCado(ctx, cadoConfig, cadoGridData, project);
    }

    // 4. KML Imports (Traces et Zones)
    if (typeof loadedZoneKmlFeatures !== 'undefined' && loadedZoneKmlFeatures.length > 0) {
        drawDigitalKml(ctx, loadedZoneKmlFeatures, project);
    }

    // 5. POIs (Utilisateurs ou KML)
    if (userPOIs && userPOIs.length > 0) {
        await drawDigitalPois(ctx, userPOIs, project);
    }

    // --- DECOUPAGE ---
    await sliceAndStore(db, canvas, zoom, nwPx, sePx);
}

/**
 * Découpe le canvas géant en tuiles 256x256 et les stocke
 */
async function sliceAndStore(db, sourceCanvas, zoom, globalNwPx, globalSePx) {
    const TILE_SIZE = 256;
    const tMinX = Math.floor(globalNwPx.x / TILE_SIZE);
    const tMinY = Math.floor(globalNwPx.y / TILE_SIZE);
    const tMaxX = Math.floor(globalSePx.x / TILE_SIZE);
    const tMaxY = Math.floor(globalSePx.y / TILE_SIZE);

    const tileCan = document.createElement('canvas');
    tileCan.width = TILE_SIZE; tileCan.height = TILE_SIZE;
    
    // Optimisation : willReadFrequently pour accélérer getImageData
    const tCtx = tileCan.getContext('2d', { willReadFrequently: true });

    for (let tx = tMinX; tx <= tMaxX; tx++) {
        for (let ty = tMinY; ty <= tMaxY; ty++) {
            const srcX = (tx * TILE_SIZE) - globalNwPx.x;
            const srcY = (ty * TILE_SIZE) - globalNwPx.y;

            tCtx.clearRect(0, 0, TILE_SIZE, TILE_SIZE);
            tCtx.drawImage(sourceCanvas, srcX, srcY, TILE_SIZE, TILE_SIZE, 0, 0, TILE_SIZE, TILE_SIZE);

            const pData = tCtx.getImageData(0,0,TILE_SIZE,TILE_SIZE).data;
            let hasContent = false;
            for(let i=3; i<pData.length; i+=4) {
                if(pData[i] > 0) { hasContent = true; break; }
            }

            if (hasContent) {
                const blob = await new Promise(r => tileCan.toBlob(r, 'image/png'));
                const buf = await blob.arrayBuffer();
                const u8 = new Uint8Array(buf);
                const tmsY = (1 << zoom) - 1 - ty;
                db.run("INSERT INTO tiles VALUES (?, ?, ?, ?)", [zoom, tx, tmsY, u8]);
            }
        }
    }
}

// --- MOTEURS DE DESSIN "DIGITAL" (SANS HALO, NET) ---

function drawSimpleText(ctx, text, x, y, color, size, align="center") {
    ctx.fillStyle = color;
    ctx.font = `bold ${size}px Arial`;
    ctx.textAlign = align;
    ctx.textBaseline = "middle";
    ctx.fillText(text, x, y);
}

function drawDigitalUtm(ctx, bbox, project, color) {
    if (typeof WGS84_to_UTM === 'undefined') return;

    const startZone = WGS84_to_UTM.fromLatLon(bbox.north, bbox.west).zoneNumber;
    const endZone = WGS84_to_UTM.fromLatLon(bbox.south, bbox.east).zoneNumber;
    
    ctx.lineWidth = 2;
    const fontSize = 14;

    for (let zone = startZone; zone <= endZone; zone++) {
        if(typeof calculateGridForZoneStrip !== 'function') continue;
        
        const zLeft = (zone - 1) * 6 - 180;
        const zRight = zone * 6 - 180;
        const cLeft = Math.max(bbox.west, zLeft);
        const cRight = Math.min(bbox.east, zRight);
        if (cLeft >= cRight) continue;

        const grid = calculateGridForZoneStrip(bbox.north, cLeft, bbox.south, cRight, zone);
        const lines = [...grid.eastingLines, ...grid.northingLines];

        lines.forEach(line => {
            if (line.coordinates.length < 2) return;
            
            ctx.beginPath();
            ctx.strokeStyle = color;
            let pStart, pEnd;
            line.coordinates.forEach((coord, i) => {
                const p = project(coord[1], coord[0]);
                if (i===0) { ctx.moveTo(p.x, p.y); pStart=p; }
                else { ctx.lineTo(p.x, p.y); pEnd=p; }
            });
            ctx.stroke();

            // Label UTM : Simple, sur la ligne, sans halo
            if (pStart && pEnd) {
                const mx = (pStart.x + pEnd.x) / 2;
                const my = (pStart.y + pEnd.y) / 2;
                let angle = Math.atan2(pEnd.y - pStart.y, pEnd.x - pStart.x);
                if (angle > Math.PI/2 || angle < -Math.PI/2) angle += Math.PI;

                ctx.save();
                ctx.translate(mx, my);
                ctx.rotate(angle);
                // Texte simple, couleur de la grille
                drawSimpleText(ctx, line.name, 0, -5, color, fontSize);
                ctx.restore();
            }
        });
    }
}

function drawDigitalCfsiStrict(ctx, bbox, project, color, zoom) {
    if(typeof CFSI_UTILS === 'undefined') return;

    // Calculs identiques au mode Image
    const nwL2 = CFSI_UTILS.wgs84ToL2E(bbox.north, bbox.west);
    const seL2 = CFSI_UTILS.wgs84ToL2E(bbox.south, bbox.east);
    
    const minX = Math.min(nwL2.x, seL2.x); const maxX = Math.max(nwL2.x, seL2.x);
    const minY = Math.min(nwL2.y, seL2.y); const maxY = Math.max(nwL2.y, seL2.y);

    const gMinX = Math.floor(minX / 100) * 100;
    const gMaxX = Math.ceil(maxX / 100) * 100;
    const gMinY = Math.floor(minY / 100) * 100;
    const gMaxY = Math.ceil(maxY / 100) * 100;

    // Détermination de l'échelle d'affichage des labels 100m
    const pRef1 = project(bbox.north, bbox.west);
    const pRef2 = project(bbox.north, bbox.west + 0.0013); // approx 100m longitude
    const pixelPer100m = Math.abs(pRef2.x - pRef1.x);
    // On affiche les 100m si la case fait plus de 50px
    const show100mLabels = pixelPer100m > 50;

    // 1. DESSIN DES LIGNES
    // Lignes X
    for (let x = gMinX; x <= gMaxX; x += 100) {
        const is2k = (Math.abs(x % 2000) < 1);
        ctx.lineWidth = is2k ? 3 : 1; // 2km épais, 100m fin
        ctx.strokeStyle = color;
        
        const p1 = CFSI_UTILS.l2EToWgs84(x, gMinY);
        const p2 = CFSI_UTILS.l2EToWgs84(x, gMaxY);
        const pp1 = project(p1.lat, p1.lon);
        const pp2 = project(p2.lat, p2.lon);
        
        ctx.beginPath(); ctx.moveTo(pp1.x, pp1.y); ctx.lineTo(pp2.x, pp2.y); ctx.stroke();
    }
    // Lignes Y
    for (let y = gMinY; y <= gMaxY; y += 100) {
        const is2k = (Math.abs(y % 2000) < 1);
        ctx.lineWidth = is2k ? 3 : 1;
        ctx.strokeStyle = color;
        
        const p1 = CFSI_UTILS.l2EToWgs84(gMinX, y);
        const p2 = CFSI_UTILS.l2EToWgs84(gMaxX, y);
        const pp1 = project(p1.lat, p1.lon);
        const pp2 = project(p2.lat, p2.lon);
        
        ctx.beginPath(); ctx.moveTo(pp1.x, pp1.y); ctx.lineTo(pp2.x, pp2.y); ctx.stroke();
    }

    // 2. DESSIN DES LABELS (CENTRÉS COMME L'IMAGE)
    for (let x = gMinX; x < gMaxX; x += 100) {
        for (let y = gMinY; y < gMaxY; y += 100) {
            const centerX = x + 50;
            const centerY = y + 50;
            
            const isCenter2k = ((centerX - 1000) % 2000 === 0) && ((centerY - 1000) % 2000 === 0);
            
            if (isCenter2k || show100mLabels) {
                const comps = CFSI_UTILS.getComponentsFromLambert(centerX, centerY);
                if (!comps) continue;

                const geo = CFSI_UTILS.l2EToWgs84(centerX, centerY);
                const pix = project(geo.lat, geo.lon);

                if (isCenter2k) {
                    // Label 2km : Gros
                    // Nom complet
                    drawSimpleText(ctx, comps.full2k + " " + comps.c100m, pix.x, pix.y, color, 16);
                } else if (show100mLabels) {
                    // Label 100m : Petit
                    drawSimpleText(ctx, comps.c100m, pix.x, pix.y, color, 10);
                }
            }
        }
    }
}

function drawDigitalCado(ctx, config, gridData, project) {
    const lw = config.lineWidth || 2;
    const fSize = 14;

    ctx.strokeStyle = config.gridColor;
    ctx.lineWidth = lw;
    
    // Lignes
    const lines = [...gridData.horizontalLines, ...gridData.verticalLines];
    lines.forEach(line => {
        ctx.beginPath();
        line.points.forEach((pt, i) => {
            const pix = project(pt[1], pt[0]);
            if(i===0) ctx.moveTo(pix.x, pix.y);
            else ctx.lineTo(pix.x, pix.y);
        });
        ctx.stroke();
    });

    // Points (Labels)
    if(config.includePoints) {
        gridData.points.forEach(pt => {
            const pix = project(pt.coordinates[1], pt.coordinates[0]);
            drawSimpleText(ctx, pt.name, pix.x, pix.y, config.gridColor, fSize);
        });
    }
}

function drawDigitalKml(ctx, features, project) {
    features.forEach(f => {
        if(f.type === 'LineString') {
            ctx.strokeStyle = 'red'; ctx.lineWidth = 3;
            ctx.beginPath();
            f.coordinates.forEach((c, i) => {
                const p = project(c[1], c[0]);
                if(i===0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y);
            });
            ctx.stroke();
        }
        else if(f.type === 'Polygon') {
            ctx.strokeStyle = 'blue'; ctx.lineWidth = 3;
            // Semi-transparent pour ne pas masquer la carte dessous (Overlay)
            ctx.fillStyle = 'rgba(0,0,255,0.2)';
            ctx.beginPath();
            f.coordinates.forEach((c, i) => {
                const p = project(c[1], c[0]);
                if(i===0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y);
            });
            ctx.closePath();
            ctx.fill(); ctx.stroke();
        }
    });
}

async function drawDigitalPois(ctx, pois, project) {
    const uniqueUrls = [...new Set(pois.map(p => p.url))];
    const imgCache = {};
    
    const loadImg = (url) => new Promise(resolve => {
        const i = new Image();
        i.crossOrigin = "Anonymous";
        i.onload = () => resolve(i);
        i.onerror = () => resolve(null);
        i.src = url;
    });

    await Promise.all(uniqueUrls.map(async u => {
        imgCache[u] = await loadImg(u);
    }));

    pois.forEach(p => {
        const pix = project(p.lat, p.lon);
        const img = imgCache[p.url];
        if (img) {
            const w = 32; const h = 32;
            ctx.drawImage(img, pix.x - w/2, pix.y - h/2, w, h);
        } else {
            ctx.beginPath(); ctx.arc(pix.x, pix.y, 5, 0, 2*Math.PI);
            ctx.fillStyle = 'red'; ctx.fill();
        }
        if (p.name) {
            drawSimpleText(ctx, p.name, pix.x, pix.y + 20, 'black', 12);
        }
    });
}

// Helper de projection (Mercator Sphérique)
function mbtLatLonToPx(lat, lon, zoom) {
    const siny = Math.sin(lat * Math.PI / 180);
    const yClamped = Math.max(Math.min(siny, 0.9999), -0.9999);
    const y = 0.5 - Math.log((1 + yClamped) / (1 - yClamped)) / (4 * Math.PI);
    const x = (lon + 180) / 360;
    const mapSize = 256 * Math.pow(2, zoom);
    return { x: x * mapSize, y: y * mapSize };
}