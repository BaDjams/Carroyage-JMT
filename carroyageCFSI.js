const CFSI_UTILS = (function() {
    // CONSTANTES ELLIPSOÏDES & PROJECTIONS
    const WGS84_A = 6378137.0;
    const WGS84_E2 = 0.00669437999014;
    const NTF_A = 6378249.2;
    const NTF_B = 6356515.0;
    const NTF_E2 = (NTF_A*NTF_A - NTF_B*NTF_B) / (NTF_A*NTF_A);
    const NTF_E = Math.sqrt(NTF_E2);

    const L2_N = 0.7289686274;       
    const L2_C = 11745793.39;        
    const L2_XS = 600000.0;          
    const L2_YS = 2200000.0;         
    const L2_LAMBDA0 = 2.33722917;
    
    // CORRECTION MAJEURE : Rayon à la latitude origine (Lat 46.8°)
    // Indispensable pour avoir des coordonnées Y positives conformes à la grille DFCI
    const L2_R0 = 5999695.768; 

    const DX = 168.0; const DY = 60.0; const DZ = -320.0;

    // CONFIGURATION GRILLE CFSI
    const GRID_ORIGIN_X = 0;
    const GRID_ORIGIN_Y = 1500000;

    const ALPH_100K_X = "ABCDEFGHJKLMN";      
    const ALPH_100K_Y = "ABCDEFGHJKMNPQRSTUVW"; 
    const ALPH_2K_X   = "ABCDEFGHKL";           
    const ALPH_100M   = "ABCDEFGHKLMNPRSTUXYZ"; 

    function toRad(deg) { return parseFloat(deg) * Math.PI / 180; }
    function toDeg(rad) { return rad * 180 / Math.PI; }

    function wgs84ToL2E(lat, lon) {
        const phi = toRad(lat);
        const lam = toRad(lon);
        
        // WGS84 -> NTF Géo
        const sinPhi = Math.sin(phi); const cosPhi = Math.cos(phi);
        const nu = WGS84_A / Math.sqrt(1 - WGS84_E2 * sinPhi * sinPhi);
        const x_wgs = nu * cosPhi * Math.cos(lam); const y_wgs = nu * cosPhi * Math.sin(lam); const z_wgs = (nu * (1 - WGS84_E2)) * sinPhi;
        const x_ntf = x_wgs + DX; const y_ntf = y_wgs + DY; const z_ntf = z_wgs + DZ;
        
        const p = Math.sqrt(x_ntf*x_ntf + y_ntf*y_ntf);
        let phi_ntf = Math.atan2(z_ntf, p * (1 - NTF_E2));
        for(let i=0; i<5; i++) {
            const sinPhiNtf = Math.sin(phi_ntf);
            const nu_ntf = NTF_A / Math.sqrt(1 - NTF_E2 * sinPhiNtf * sinPhiNtf);
            phi_ntf = Math.atan2(z_ntf + NTF_E2 * nu_ntf * sinPhiNtf, p);
        }
        const lam_ntf = Math.atan2(y_ntf, x_ntf); 

        // Projection Lambert II
        const lambda_paris = toRad(L2_LAMBDA0);
        const gamma = L2_N * (lam_ntf - lambda_paris);
        const lat_iso = Math.log(Math.tan(Math.PI/4 + phi_ntf/2) * Math.pow((1 - NTF_E * Math.sin(phi_ntf)) / (1 + NTF_E * Math.sin(phi_ntf)), NTF_E/2));
        const R = L2_C * Math.exp(-L2_N * lat_iso);

        // CORRECTION : Ajout de L2_R0 pour obtenir le vrai Y Lambert
        return { 
            x: L2_XS + R * Math.sin(gamma), 
            y: L2_YS + L2_R0 - R * Math.cos(gamma) 
        };
    }

    function l2EToWgs84(x, y) {
        const dx = x - L2_XS;
        // CORRECTION : Prise en compte de L2_R0 pour l'inverse
        // dy représente ici la distance verticale par rapport au Pole, pas à l'origine locale
        const dy = (L2_YS + L2_R0) - y;
        
        const R = Math.sqrt(dx*dx + dy*dy);
        const gamma = Math.atan2(dx, dy);
        
        const lat_iso = -1/L2_N * Math.log(R/L2_C);
        let phi_ntf = 2 * Math.atan(Math.exp(lat_iso)) - Math.PI/2;
        for(let i=0; i<6; i++) {
            const esin = NTF_E * Math.sin(phi_ntf);
            phi_ntf = 2 * Math.atan(Math.pow((1+esin)/(1-esin), NTF_E/2) * Math.exp(lat_iso)) - Math.PI/2;
        }
        
        const lambda_paris = toRad(L2_LAMBDA0);
        const lam_ntf = lambda_paris + gamma / L2_N;

        const sinPhi = Math.sin(phi_ntf); const cosPhi = Math.cos(phi_ntf);
        const nu = NTF_A / Math.sqrt(1 - NTF_E2 * sinPhi * sinPhi);
        const x_ntf = nu * cosPhi * Math.cos(lam_ntf); const y_ntf = nu * cosPhi * Math.sin(lam_ntf); const z_ntf = (nu * (1 - NTF_E2)) * sinPhi;
        const x_wgs = x_ntf - DX; const y_wgs = y_ntf - DY; const z_wgs = z_ntf - DZ;

        const p = Math.sqrt(x_wgs*x_wgs + y_wgs*y_wgs);
        const lam_wgs = Math.atan2(y_wgs, x_wgs);
        let phi_wgs = Math.atan2(z_wgs, p * (1 - WGS84_E2));
        for(let i=0; i<5; i++) {
            const sinPhiW = Math.sin(phi_wgs);
            const nu_w = WGS84_A / Math.sqrt(1 - WGS84_E2 * sinPhiW * sinPhiW);
            phi_wgs = Math.atan2(z_wgs + WGS84_E2 * nu_w * sinPhiW, p);
        }

        return { lat: toDeg(phi_wgs), lon: toDeg(lam_wgs) };
    }

    function getComponentsFromLambert(x, y) {
        const dx = Math.floor(x - GRID_ORIGIN_X);
        const dy = Math.floor(y - GRID_ORIGIN_Y);

        if (dx < 0 || dy < 0) return null;

        // 1. Carré 100km
        const idx100X = Math.floor(dx / 100000);
        const idx100Y = Math.floor(dy / 100000);
        if (idx100X >= ALPH_100K_X.length || idx100Y >= ALPH_100K_Y.length) return null;
        const c100 = ALPH_100K_X[idx100X] + ALPH_100K_Y[idx100Y];

        // 2. Carré 20km
        const c20 = "" + (Math.floor((dx % 100000) / 20000) * 2) + (Math.floor((dy % 100000) / 20000) * 2);

        // 3. Carré 2km
        const idx2kX = Math.floor((dx % 20000) / 2000);
        const idx2kY = Math.floor((dy % 20000) / 2000);
        if (idx2kX >= ALPH_2K_X.length) return null;
        const c2k = ALPH_2K_X[idx2kX] + idx2kY;

        // 4. Carré 100m
        const idxX = Math.floor((dx % 2000) / 100);
        const idxY = Math.floor((dy % 2000) / 100);
        
        // Sécurité
        const charX = ALPH_100M[idxX];
        const charY = ALPH_100M[idxY];
        if (!charX || !charY) return null;

        const c100m = charX + " " + charY.toLowerCase();

        return { 
            full2k: `${c100} ${c20} ${c2k}`, 
            c100m: c100m, 
            idxX, idxY 
        };
    }

    return { wgs84ToL2E, l2EToWgs84, getComponentsFromLambert };
})();

async function drawCfsiGridOnCanvas(ctx, bbox, latLonToPixels, margin, fontSize, lineWidth) {
    const color = document.getElementById('utm-grid-color') ? document.getElementById('utm-grid-color').value : '#000000';
    const trEl = document.getElementById('utm-transparency');
    const transparency = trEl ? (100 - parseInt(trEl.value)) / 100 : 0.5;
    const r = parseInt(color.slice(1, 3), 16), g = parseInt(color.slice(3, 5), 16), b = parseInt(color.slice(5, 7), 16);

    const nw = CFSI_UTILS.wgs84ToL2E(bbox.north, bbox.west);
    const se = CFSI_UTILS.wgs84ToL2E(bbox.south, bbox.east);
    const widthMeters = Math.abs(se.x - nw.x);
    const heightMeters = Math.abs(se.y - nw.y);
    const maxDim = Math.max(widthMeters, heightMeters);

    const isSmallArea = maxDim <= 3500;
    // NOUVEAU : Détection du niveau de zoom "très proche" (moins de 700m de large)
    const isVeryClose = maxDim <= 700; 
    
    ctx.save();
    ctx.beginPath();
    ctx.rect(margin, margin, ctx.canvas.width - 2 * margin, ctx.canvas.height - 2 * margin);
    ctx.clip();

    // Arrondis grille
    const lMinX = Math.floor(nw.x / 100) * 100;
    const lMaxX = Math.ceil(se.x / 100) * 100;
    const lMinY = Math.floor(se.y / 100) * 100;
    const lMaxY = Math.ceil(nw.y / 100) * 100;

    // 1. DESSIN DES LIGNES
    ctx.beginPath();
    for (let x = lMinX; x <= lMaxX; x += 100) {
        const is2k = (Math.abs(x % 2000) < 1);
        if (!is2k && !isSmallArea) continue;
        
        ctx.strokeStyle = `rgba(${r}, ${g}, ${b}, ${is2k ? transparency : transparency / 2.5})`;
        ctx.lineWidth = is2k ? lineWidth * 2 : lineWidth * 1.0;
        
        const p1 = latLonToPixels(CFSI_UTILS.l2EToWgs84(x, lMinY).lat, CFSI_UTILS.l2EToWgs84(x, lMinY).lon);
        const p2 = latLonToPixels(CFSI_UTILS.l2EToWgs84(x, lMaxY).lat, CFSI_UTILS.l2EToWgs84(x, lMaxY).lon);
        
        if (p1 && p2) {
             ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y); ctx.stroke(); ctx.beginPath();
        }
    }
    for (let y = lMinY; y <= lMaxY; y += 100) {
        const is2k = (Math.abs(y % 2000) < 1);
        if (!is2k && !isSmallArea) continue;

        ctx.strokeStyle = `rgba(${r}, ${g}, ${b}, ${is2k ? transparency : transparency / 2.5})`;
        ctx.lineWidth = is2k ? lineWidth * 2 : lineWidth * 1.0;
        
        const p1 = latLonToPixels(CFSI_UTILS.l2EToWgs84(lMinX, y).lat, CFSI_UTILS.l2EToWgs84(lMinX, y).lon);
        const p2 = latLonToPixels(CFSI_UTILS.l2EToWgs84(lMaxX, y).lat, CFSI_UTILS.l2EToWgs84(lMaxX, y).lon);

        if (p1 && p2) {
            ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y); ctx.stroke(); ctx.beginPath();
        }
    }

    // 2. DESSIN DU TEXTE
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const safeFontSize = fontSize || 12;

    if (isSmallArea) {
        const anchorIndices = [0, 9, 19]; 
        for (let x = lMinX; x <= lMaxX; x += 100) {
            for (let y = lMinY; y <= lMaxY; y += 100) {
                const centerX = x + 50;
                const centerY = y + 50;
                
                const comps = CFSI_UTILS.getComponentsFromLambert(centerX, centerY);
                if (!comps) continue; 

                const ll = CFSI_UTILS.l2EToWgs84(centerX, centerY);
                const p = latLonToPixels(ll.lat, ll.lon);

                if (!p || isNaN(p.x) || isNaN(p.y)) continue;

                const isAncre = anchorIndices.includes(comps.idxX) && anchorIndices.includes(comps.idxY);
                
                // Dessin des quadrants colorés (uniquement sur les ancres pour garder le repère visuel)
                if (isAncre) {
                    const quadrants = [
                        { c: 'rgba(255,0,0,0.3)', dx: 0, dy: 50 },
                        { c: 'rgba(0,255,0,0.3)', dx: 50, dy: 50 },
                        { c: 'rgba(255,255,0,0.3)', dx: 0, dy: 0 },
                        { c: 'rgba(0,0,255,0.3)', dx: 50, dy: 0 }
                    ];
                    quadrants.forEach(q => {
                        const c1 = CFSI_UTILS.l2EToWgs84(x + q.dx, y + q.dy);
                        const c2 = CFSI_UTILS.l2EToWgs84(x + q.dx + 50, y + q.dy + 50);
                        const pix1 = latLonToPixels(c1.lat, c1.lon);
                        const pix2 = latLonToPixels(c2.lat, c2.lon);
                        if(pix1 && pix2) {
                            ctx.fillStyle = q.c;
                            ctx.fillRect(pix1.x, pix1.y, pix2.x - pix1.x, pix2.y - pix1.y);
                        }
                    });
                }

                // MODIFICATION ICI : Choix du texte à afficher
                // Si c'est une ancre OU si on est très proche -> Nom complet
                let textToDraw = "";
                if (isAncre || isVeryClose) {
                    ctx.font = `bold ${safeFontSize * 0.6}px Arial`;
                    textToDraw = `${comps.full2k} ${comps.c100m}`;
                } else {
                    ctx.font = `bold ${safeFontSize * 0.6}px Arial`;
                    textToDraw = comps.c100m;
                }

                drawTextWithOutline(ctx, textToDraw, p.x, p.y, safeFontSize * 0.05);
            }
        }
    } else {
        ctx.font = `bold ${safeFontSize * 1.5}px Arial`;
        const minX_2k = Math.floor(lMinX / 2000) * 2000;
        const minY_2k = Math.floor(lMinY / 2000) * 2000;

        for (let x = minX_2k; x <= lMaxX; x += 2000) {
            for (let y = minY_2k; y <= lMaxY; y += 2000) {
                const centerX = x + 1000;
                const centerY = y + 1000;
                const comps = CFSI_UTILS.getComponentsFromLambert(centerX, centerY);
                
                if (comps) {
                    const ll = CFSI_UTILS.l2EToWgs84(centerX, centerY);
                    const p = latLonToPixels(ll.lat, ll.lon);
                    if (p && !isNaN(p.x)) {
                        drawTextWithOutline(ctx, comps.full2k, p.x, p.y, safeFontSize * 0.1);
                    }
                }
            }
        }
    }
    ctx.restore();
    
    const userTitle = document.getElementById("zone-title") ? document.getElementById("zone-title").value : "Zone CFSI";
    const centerLat = (bbox.north + bbox.south) / 2;
    const centerLon = (bbox.west + bbox.east) / 2;
    
    // Mise à jour du texte de précision dans le cartouche
    let scaleLabel;
    if (isVeryClose) scaleLabel = "Précision: 100 m (Zoom Max)";
    else if (isSmallArea) scaleLabel = "Précision: 100 m";
    else scaleLabel = "Précision: 2 km";

    drawCfsiCartouche(ctx, userTitle, scaleLabel, centerLat, centerLon, margin, safeFontSize);
}

function drawCfsiCartouche(ctx, title, scaleText, lat, lon, margin, fontSize) {
    if(!ctx) return;
    const cartFontSize = fontSize * 0.8;
    const padding = cartFontSize;
    const lineSpacing = cartFontSize * 1.4;
    const texts = [
        `Carte: ${title}`,
        `Système: CFSI (L93)`,
        scaleText,
        `Centre: ${lat ? lat.toFixed(5) : ''}, ${lon ? lon.toFixed(5) : ''}`
    ];
    ctx.font = `bold ${cartFontSize}px Arial`;
    let maxWidth = 0;
    texts.forEach(t => maxWidth = Math.max(maxWidth, ctx.measureText(t).width));
    const boxWidth = maxWidth + (padding * 2);
    const boxHeight = (texts.length * lineSpacing) + padding;
    const x = margin + padding;
    const y = margin + padding;
    ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
    ctx.fillRect(x, y, boxWidth, boxHeight);
    ctx.strokeStyle = 'black';
    ctx.strokeRect(x, y, boxWidth, boxHeight);
    ctx.fillStyle = 'black';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    texts.forEach((txt, i) => ctx.fillText(txt, x + padding, y + padding/2 + (i * lineSpacing)));
}

function drawTextWithOutline(ctx, text, x, y, outlineWidth) {
    if(!text) return;
    ctx.strokeStyle = "rgba(255, 255, 255, 0.8)";
    ctx.lineWidth = Math.max(2, outlineWidth); 
    ctx.lineJoin = "round";
    ctx.strokeText(text, x, y);
    ctx.fillStyle = "rgba(0, 0, 0, 1)";
    ctx.fillText(text, x, y);
}