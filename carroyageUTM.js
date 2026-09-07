// carroyageUTM.js

/**********************************************************************************/
/*    BIBLIOTHÈQUE DE CONVERSION WGS84 <> UTM (Inchangée)                         */
/**********************************************************************************/
const WGS84_to_UTM = (function() {
    const PI = Math.PI;
    const a = 6378137;
    const eccSquared = 0.00669438;
    const k0 = 0.9996;

    function toDegrees(rad) { return rad / PI * 180; }
    function toRadians(deg) { return deg * PI / 180; }

    function getUTMZoneLetter(lat) {
        if (lat >= 84 || lat < -80) return null;
        if (lat >= 72) return 'X'; if (lat >= 64) return 'W'; if (lat >= 56) return 'V';
        if (lat >= 48) return 'U'; if (lat >= 40) return 'T'; if (lat >= 32) return 'S';
        if (lat >= 24) return 'R'; if (lat >= 16) return 'Q'; if (lat >= 8) return 'P';
        if (lat >= 0) return 'N'; if (lat >= -8) return 'M'; if (lat >= -16) return 'L';
        if (lat >= -24) return 'K'; if (lat >= -32) return 'J'; if (lat >= -40) return 'H';
        if (lat >= -48) return 'G'; if (lat >= -56) return 'F'; if (lat >= -64) return 'E';
        if (lat >= -72) return 'D'; return 'C';
    }

    function fromLatLon(lat, lon, forceZone = null) {
        const lonTemp = (lon + 180) - Math.floor((lon + 180) / 360) * 360 - 180;
        const latRad = toRadians(lat);
        let zoneNumber = forceZone !== null ? forceZone : Math.floor((lonTemp + 180) / 6) + 1;
        
        if (lat >= 56.0 && lat < 64.0 && lonTemp >= 3.0 && lonTemp < 12.0) zoneNumber = 32;
        if (lat >= 72.0 && lat < 84.0) {
            if (lonTemp >= 0.0 && lonTemp < 9.0) zoneNumber = 31;
            else if (lonTemp >= 9.0 && lonTemp < 21.0) zoneNumber = 33;
            else if (lonTemp >= 21.0 && lonTemp < 33.0) zoneNumber = 35;
            else if (lonTemp >= 33.0 && lonTemp < 42.0) zoneNumber = 37;
        }

        const lonOrigin = (zoneNumber - 1) * 6 - 180 + 3;
        const lonOriginRad = toRadians(lonOrigin);
        const eccPrimeSquared = eccSquared / (1 - eccSquared);
        const N = a / Math.sqrt(1 - eccSquared * Math.pow(Math.sin(latRad), 2));
        const T = Math.pow(Math.tan(latRad), 2);
        const C = eccPrimeSquared * Math.pow(Math.cos(latRad), 2);
        const A = (toRadians(lonTemp) - lonOriginRad) * Math.cos(latRad);
        const M = a * ((1 - eccSquared / 4 - 3 * Math.pow(eccSquared, 2) / 64 - 5 * Math.pow(eccSquared, 3) / 256) * latRad - (3 * eccSquared / 8 + 3 * Math.pow(eccSquared, 2) / 32 + 45 * Math.pow(eccSquared, 3) / 1024) * Math.sin(2 * latRad) + (15 * Math.pow(eccSquared, 2) / 256 + 45 * Math.pow(eccSquared, 3) / 1024) * Math.sin(4 * latRad) - (35 * Math.pow(eccSquared, 3) / 3072) * Math.sin(6 * latRad));
        const UTMEasting = k0 * N * (A + (1 - T + C) * Math.pow(A, 3) / 6 + (5 - 18 * T + Math.pow(T, 2) + 72 * C - 58 * eccPrimeSquared) * Math.pow(A, 5) / 120) + 500000.0;
        let UTMNorthing = k0 * (M + N * Math.tan(latRad) * (Math.pow(A, 2) / 2 + (5 - T + 9 * C + 4 * Math.pow(C, 2)) * Math.pow(A, 4) / 24 + (61 - 58 * T + Math.pow(T, 2) + 600 * C - 330 * eccPrimeSquared) * Math.pow(A, 6) / 720));
        if (lat < 0) UTMNorthing += 10000000.0;
        
        return { easting: UTMEasting, northing: UTMNorthing, zoneNumber: zoneNumber, zoneLetter: getUTMZoneLetter(lat) };
    }

    function toLatLon(easting, northing, zoneNumber, zoneLetter) {
        if (!zoneLetter) return { latitude: NaN, longitude: NaN };
        const e1 = (1 - Math.sqrt(1 - eccSquared)) / (1 + Math.sqrt(1 - eccSquared));
        const x = easting - 500000.0;
        let y = northing;
        // Bandes C à M = hémisphère sud (false northing de 10 000 km). La bande N,
        // qui couvre 0° à 8° N, appartient à l'hémisphère nord et ne doit pas être décalée.
        if ('CDEFGHJKLM'.includes(zoneLetter)) y -= 10000000.0;
        
        const lonOrigin = (zoneNumber - 1) * 6 - 180 + 3;
        const M = y / k0;
        const mu = M / (a * (1 - eccSquared / 4 - 3 * Math.pow(eccSquared, 2) / 64 - 5 * Math.pow(eccSquared, 3) / 256));
        const phi1Rad = mu + (3 * e1 / 2 - 27 * Math.pow(e1, 3) / 32) * Math.sin(2 * mu) + (21 * Math.pow(e1, 2) / 16 - 55 * Math.pow(e1, 4) / 32) * Math.sin(4 * mu) + (151 * Math.pow(e1, 3) / 96) * Math.sin(6 * mu);
        const eccPrimeSquared = eccSquared / (1 - eccSquared);
        const C1 = eccPrimeSquared * Math.pow(Math.cos(phi1Rad), 2);
        const T1 = Math.pow(Math.tan(phi1Rad), 2);
        const N1 = a / Math.sqrt(1 - eccSquared * Math.pow(Math.sin(phi1Rad), 2));
        const R1 = a * (1 - eccSquared) / Math.pow(1 - eccSquared * Math.pow(Math.sin(phi1Rad), 2), 1.5);
        const D = x / (N1 * k0);
        let lat = phi1Rad - N1 * Math.tan(phi1Rad) / R1 * (Math.pow(D, 2) / 2 - (5 + 3 * T1 + 10 * C1 - 4 * Math.pow(C1, 2) - 9 * eccPrimeSquared) * Math.pow(D, 4) / 24 + (61 + 90 * T1 + 298 * C1 + 45 * Math.pow(T1, 2) - 252 * eccPrimeSquared - 3 * Math.pow(C1, 2)) * Math.pow(D, 6) / 720);
        lat = toDegrees(lat);
        let lon = (D - (1 + 2 * T1 + C1) * Math.pow(D, 3) / 6 + (5 - 2 * C1 + 28 * T1 - 3 * Math.pow(C1, 2) + 8 * eccPrimeSquared + 24 * Math.pow(T1, 2)) * Math.pow(D, 5) / 120) / Math.cos(phi1Rad);
        lon = lonOrigin + toDegrees(lon);
        return { latitude: lat, longitude: lon };
    }
    
    return { fromLatLon, toLatLon, getUTMZoneLetter };
})();

/**********************************************************************************/
/*    BIBLIOTHÈQUE DE CONVERSION WGS84 <> MGRS                                    */
/*    (MGRS = UTM + identifiant de carré de 100 km, cf. TM 8358.1 / NGA)          */
/**********************************************************************************/
const WGS84_to_MGRS = (function() {
    // Codes ASCII utilisés pour la rotation des lettres (I et O sont exclus du MGRS).
    const A = 65, I = 73, O = 79, V = 86, Z = 90;

    // Le jeu de lettres du carré 100 km dépend de la zone UTM (cycle de 6 zones).
    const SET_ORIGIN_COLUMN_LETTERS = 'AJSAJS';
    const SET_ORIGIN_ROW_LETTERS    = 'AFAFAF';

    // Northing minimal (en m) de chaque bande de latitude : sert à lever l'ambiguïté
    // du cycle de 2 000 km des lettres de ligne lors du décodage.
    const MIN_NORTHING = {
        C: 1100000, D: 2000000, E: 2800000, F: 3700000, G: 4600000, H: 5500000,
        J: 6400000, K: 7300000, L: 8200000, M: 9100000, N: 0,       P: 800000,
        Q: 1700000, R: 2600000, S: 3500000, T: 4400000, U: 5300000, V: 6200000,
        W: 7000000, X: 7900000
    };

    function get100kSetForZone(zoneNumber) {
        const setParm = zoneNumber % 6;
        return setParm === 0 ? 6 : setParm;
    }

    // Lettre suivante en sautant I et O, avec bouclage en fin d'alphabet.
    function nextLetterCode(code, maxCode) {
        code++;
        if (code === I) code++;
        if (code === O) code++;
        if (code > maxCode) code = A;
        return code;
    }

    // Identifiant à deux lettres du carré de 100 km contenant (easting, northing).
    function get100kID(easting, northing, zoneNumber) {
        const setIndex = get100kSetForZone(zoneNumber) - 1;
        const column = Math.floor(easting / 100000);          // 1 à 8
        const row = Math.floor(northing / 100000) % 20;       // 0 à 19

        let colCode = SET_ORIGIN_COLUMN_LETTERS.charCodeAt(setIndex);
        for (let i = 1; i < column; i++) colCode = nextLetterCode(colCode, Z);

        let rowCode = SET_ORIGIN_ROW_LETTERS.charCodeAt(setIndex);
        for (let i = 0; i < row; i++) rowCode = nextLetterCode(rowCode, V);

        return String.fromCharCode(colCode) + String.fromCharCode(rowCode);
    }

    // Easting (m) de l'origine du carré 100 km désigné par la lettre de colonne.
    function getEastingFrom100kChar(letter, setNumber) {
        let curCol = SET_ORIGIN_COLUMN_LETTERS.charCodeAt(setNumber - 1);
        let easting = 100000;
        for (let i = 0; i < 8; i++) {
            if (curCol === letter.charCodeAt(0)) return easting;
            curCol = nextLetterCode(curCol, Z);
            easting += 100000;
        }
        throw new Error(`Lettre de colonne « ${letter} » invalide pour la zone (jeu ${setNumber}).`);
    }

    // Northing (m) de l'origine du carré 100 km, avant recalage sur la bande de latitude.
    function getNorthingFrom100kChar(letter, setNumber) {
        let curRow = SET_ORIGIN_ROW_LETTERS.charCodeAt(setNumber - 1);
        let northing = 0;
        for (let i = 0; i < 20; i++) {
            if (curRow === letter.charCodeAt(0)) return northing;
            curRow = nextLetterCode(curRow, V);
            northing += 100000;
        }
        throw new Error(`Lettre de ligne « ${letter} » invalide pour la zone (jeu ${setNumber}).`);
    }

    /**
     * Encode un point WGS84 en référence MGRS.
     * @param {number} lat
     * @param {number} lon
     * @param {number} digits nombre de chiffres par axe (1 à 5) — 5 = précision 1 m
     * @param {boolean} spaced insère des espaces (forme lisible « 31U DQ 48251 11942 »)
     */
    function fromLatLon(lat, lon, digits = 5, spaced = true) {
        if (isNaN(lat) || isNaN(lon)) throw new Error("Coordonnées décimales invalides.");
        if (lat >= 84 || lat < -80) throw new Error("MGRS indisponible au-delà de 84°N / 80°S (zones polaires UPS non gérées).");
        digits = Math.min(5, Math.max(1, Math.round(digits)));

        const utm = WGS84_to_UTM.fromLatLon(lat, lon);
        if (!utm.zoneLetter) throw new Error("Bande de latitude MGRS indéterminée.");

        const easting = Math.floor(utm.easting);
        const northing = Math.floor(utm.northing);
        const id100k = get100kID(easting, northing, utm.zoneNumber);

        // Chiffres de position à l'intérieur du carré de 100 km, tronqués à la précision demandée.
        const divisor = Math.pow(10, 5 - digits);
        const e = String(Math.floor((easting % 100000) / divisor)).padStart(digits, '0');
        const n = String(Math.floor((northing % 100000) / divisor)).padStart(digits, '0');

        const zone = `${String(utm.zoneNumber).padStart(2, '0')}${utm.zoneLetter}`;
        return spaced ? `${zone} ${id100k} ${e} ${n}` : `${zone}${id100k}${e}${n}`;
    }

    /**
     * Décode une référence MGRS. Le point retourné est le coin sud-ouest du carré
     * désigné (convention topographique), avec la taille du carré en mètres.
     * Accepte les formes « 31UDQ4825111942 », « 31U DQ 48251 11942 », « 31 U DQ ... ».
     */
    function toLatLon(mgrsStr) {
        if (typeof mgrsStr !== 'string') throw new Error("Référence MGRS invalide.");
        const clean = mgrsStr.toUpperCase().replace(/[\s,]+/g, '');
        const match = clean.match(/^(\d{1,2})([C-HJ-NP-X])([A-HJ-NP-Z])([A-HJ-NP-V])(\d*)$/);
        if (!match) throw new Error("Format MGRS invalide. Attendu : 31U DQ 48251 11942");

        const zoneNumber = parseInt(match[1], 10);
        const zoneLetter = match[2];
        const colLetter = match[3];
        const rowLetter = match[4];
        const numeric = match[5];

        if (zoneNumber < 1 || zoneNumber > 60) throw new Error("Numéro de zone MGRS hors plage (1 à 60).");
        if (numeric.length % 2 !== 0 || numeric.length > 10) {
            throw new Error("Le bloc numérique MGRS doit comporter un nombre pair de chiffres (2 à 10).");
        }

        const setNumber = get100kSetForZone(zoneNumber);
        const east100k = getEastingFrom100kChar(colLetter, setNumber);
        let north100k = getNorthingFrom100kChar(rowLetter, setNumber);

        // Les lettres de ligne se répètent tous les 2 000 km : on remonte jusqu'à
        // atteindre le northing minimal de la bande de latitude.
        const minNorthing = MIN_NORTHING[zoneLetter];
        if (minNorthing === undefined) throw new Error(`Bande de latitude « ${zoneLetter} » inconnue.`);
        while (north100k < minNorthing) north100k += 2000000;

        // Chiffres restants : moitié easting, moitié northing.
        const half = numeric.length / 2;
        const factor = half === 0 ? 0 : Math.pow(10, 5 - half);
        // Les northings de MIN_NORTHING incluent déjà le false northing sud : la valeur
        // obtenue est directement un northing UTM exploitable par WGS84_to_UTM.toLatLon.
        const easting = east100k + (half === 0 ? 0 : parseInt(numeric.slice(0, half), 10) * factor);
        const northing = north100k + (half === 0 ? 0 : parseInt(numeric.slice(half), 10) * factor);

        const wgs = WGS84_to_UTM.toLatLon(easting, northing, zoneNumber, zoneLetter);
        if (isNaN(wgs.latitude) || isNaN(wgs.longitude)) throw new Error("Conversion MGRS impossible.");

        return {
            latitude: wgs.latitude,
            longitude: wgs.longitude,
            easting: easting,
            northing: northing,
            zoneNumber: zoneNumber,
            zoneLetter: zoneLetter,
            precision: half === 0 ? 100000 : factor   // taille du carré en mètres
        };
    }

    return { fromLatLon, toLatLon, get100kID };
})();

// Fonction utilitaire de couleur
function rgbToKmlColor(hex, opacity) {
    const r = parseInt(hex.slice(1, 3), 16).toString(16).padStart(2, '0');
    const g = parseInt(hex.slice(3, 5), 16).toString(16).padStart(2, '0');
    const b = parseInt(hex.slice(5, 7), 16).toString(16).padStart(2, '0');
    const a = Math.floor(255 * opacity).toString(16).padStart(2, '0');
    return `${a}${b}${g}${r}`;
}

async function generateUTMGrid() {
    const loadingIndicator = document.getElementById('loading-indicator');
    document.getElementById('loading-message').textContent = "Génération de la grille UTM en cours...";
    loadingIndicator.classList.remove('hidden');
    hideError();

    try {
        const nwCoordStr = document.getElementById('zone-nw-coords').value;
        const seCoordStr = document.getElementById('zone-se-coords').value;
        if (!nwCoordStr || !seCoordStr) {
            throw new Error("Veuillez d'abord dessiner une zone rectangulaire sur la carte.");
        }

        const gridName = document.getElementById('utm-grid-name').value || 'Grille_UTM_1km';
        const color = document.getElementById('utm-grid-color').value;
        const opacity = (100 - parseInt(document.getElementById('utm-transparency').value)) / 100;

        const [nwLat, nwLon] = nwCoordStr.split(',').map(c => parseFloat(c.trim()));
        const [seLat, seLon] = seCoordStr.split(',').map(c => parseFloat(c.trim()));

        if (isNaN(nwLat) || isNaN(nwLon) || isNaN(seLat) || isNaN(seLon)) {
            throw new Error("Coordonnées de la zone invalides.");
        }

        const startZone = WGS84_to_UTM.fromLatLon(nwLat, nwLon).zoneNumber;
        const endZone = WGS84_to_UTM.fromLatLon(seLat, seLon).zoneNumber;
        let allEastingLines = [], allNorthingLines = [], allBoundaryLines = [];

        for (let zone = startZone; zone <= endZone; zone++) {
            const zoneBoundaryLeft = (zone - 1) * 6 - 180;
            const zoneBoundaryRight = zone * 6 - 180;
            const clipLonStart = Math.max(nwLon, zoneBoundaryLeft);
            const clipLonEnd = Math.min(seLon, zoneBoundaryRight);
            
            if (clipLonStart >= clipLonEnd) continue;

            const gridDataForZone = calculateGridForZoneStrip(nwLat, clipLonStart, seLat, clipLonEnd, zone);
            allEastingLines.push(...gridDataForZone.eastingLines);
            allNorthingLines.push(...gridDataForZone.northingLines);
            
            if (zone < endZone && seLon > zoneBoundaryRight) {
                allBoundaryLines.push({ 
                    name: `Frontière Zone ${zone}/${zone + 1}`, 
                    coordinates: [[zoneBoundaryRight, nwLat, 0], [zoneBoundaryRight, seLat, 0]] 
                });
            }
        }

        const zoneFrame = {
            name: "Cadre de la zone",
            coordinates: [
                [nwLon, nwLat, 0], [seLon, nwLat, 0],
                [seLon, seLat, 0], [nwLon, seLat, 0],
                [nwLon, nwLat, 0]
            ]
        };

        await ensureJSZip();
        const zip = new JSZip();
        const userPOIs = window.getUserPOIs ? window.getUserPOIs() : [];
        await ensureIconsCatalog();
        const allIcons = window.getIconLibrary ? window.getIconLibrary() : [];
        const imagesToZip = new Map();
        const poiParts = [];

        if (userPOIs.length > 0) {
            for (const [index, poi] of userPOIs.entries()) {
                let iconUrl = "https://maps.google.com/mapfiles/kml/paddle/wht-blank.png";
                const iconDef = allIcons.find(i => i.id === poi.type);
                if (iconDef) iconUrl = iconDef.url;
                if (poi.url) iconUrl = poi.url;

                if (!iconUrl.startsWith('http') && window.getIconDataGlobal) {
                    const iconFilename = `icon_${index}.png`;
                    const zipPath = `files/${iconFilename}`;
                    const base64Data = await window.getIconDataGlobal(iconUrl);
                    if (base64Data) {
                        const cleanBase64 = base64Data.split(',')[1];
                        imagesToZip.set(zipPath, cleanBase64);
                        iconUrl = zipPath;
                    }
                }

                poiParts.push(`<Placemark><name>${poi.name || poi.type}</name><Style><IconStyle><scale>1.2</scale><Icon><href>${iconUrl}</href></Icon></IconStyle></Style><Point><coordinates>${poi.lon},${poi.lat},0</coordinates></Point></Placemark>`);
            }
            for (const [path, data] of imagesToZip) {
                zip.file(path, data, {base64: true});
            }
        }
        const poiKml = poiParts.join('');

        const kmlContent = createUTM_KML(
            allEastingLines, allNorthingLines, allBoundaryLines, 
            { gridName, lineColor: color, lineOpacity: opacity },
            poiKml, zoneFrame
        );

        zip.file("doc.kml", kmlContent);
        const buffer = await zip.generateAsync({ type: "arraybuffer" });
        const kmzBlobWithMime = new Blob([buffer], { type: 'application/vnd.google-earth.kmz' });
        downloadFile(kmzBlobWithMime, `${gridName}.kmz`);

    } catch (error) {
        console.error("Erreur lors de la génération de la grille UTM:", error);
        showError(error.message);
    } finally {
        loadingIndicator.classList.add('hidden');
    }
}

// --- FONCTIONS DE DÉCOUPAGE GÉOMÉTRIQUE (CLIPPING) ---

function clipLineToRect(coords, n, s, e, w) {
    let res = coords;
    res = clipAxis(res, 1, s, true);  // Lat >= Sud
    res = clipAxis(res, 1, n, false); // Lat <= Nord
    res = clipAxis(res, 0, w, true);  // Lon >= Ouest
    res = clipAxis(res, 0, e, false); // Lon <= Est
    return res;
}

function clipAxis(points, axis, boundary, isMin) {
    if (points.length < 1) return [];
    let newPoints = [];
    let prev = points[0];
    let prevInside = isMin ? prev[axis] >= boundary : prev[axis] <= boundary;

    if (prevInside) newPoints.push(prev);

    for (let i = 1; i < points.length; i++) {
        let curr = points[i];
        let currInside = isMin ? curr[axis] >= boundary : curr[axis] <= boundary;

        if (prevInside !== currInside) {
            if (curr[axis] !== prev[axis]) {
                let t = (boundary - prev[axis]) / (curr[axis] - prev[axis]);
                let intLon = prev[0] + t * (curr[0] - prev[0]);
                let intLat = prev[1] + t * (curr[1] - prev[1]);
                newPoints.push([intLon, intLat, 0]);
            }
        }

        if (currInside) {
            newPoints.push(curr);
        }
        prev = curr;
        prevInside = currInside;
    }
    return newPoints;
}

// Étiquette MGRS d'une ligne de grille : les deux derniers chiffres du kilomètre
// (00 à 99), comme sur les cartes militaires (le carré de 100 km lève l'ambiguïté).
function formatMgrsLineLabel(km) {
    return String(((km % 100) + 100) % 100).padStart(2, '0');
}

/**
 * Calcule les lignes de grille 1 km d'une bande de zone UTM.
 * @param {string} labelMode 'utm' (étiquettes « 31U 448 ») ou 'mgrs' (étiquettes « 48 »
 *        + identifiants des carrés de 100 km). La géométrie est identique : le MGRS
 *        est le même quadrillage que l'UTM, seule la désignation change.
 */
function calculateGridForZoneStrip(nwLat, nwLon, seLat, seLon, zoneToUse, labelMode = 'utm') {
    const isMgrs = (labelMode === 'mgrs');
    const utm_nw = WGS84_to_UTM.fromLatLon(nwLat, nwLon, zoneToUse);
    const utm_ne = WGS84_to_UTM.fromLatLon(nwLat, seLon, zoneToUse);
    const utm_sw = WGS84_to_UTM.fromLatLon(seLat, nwLon, zoneToUse);
    const utm_se = WGS84_to_UTM.fromLatLon(seLat, seLon, zoneToUse);
    
    const minEasting = Math.min(utm_nw.easting, utm_sw.easting);
    const maxEasting = Math.max(utm_ne.easting, utm_se.easting);
    const minNorthing = Math.min(utm_sw.northing, utm_se.northing);
    const maxNorthing = Math.max(utm_nw.northing, utm_ne.northing);

    const gridSpacing = 1000;
    const eastingLines = [], northingLines = [];
    const segments = 20;

    // --- Lignes Verticales (Eastings) ---
    for (let e = Math.ceil(minEasting / gridSpacing) * gridSpacing; e <= maxEasting; e += gridSpacing) {
        const linePoints = [];
        const midLat = (nwLat + seLat) / 2;
        const zoneLetter = WGS84_to_UTM.getUTMZoneLetter(midLat);
        if (!zoneLetter) continue;

        for (let i = 0; i <= segments; i++) {
            const currentNorthing = minNorthing + (i / segments) * (maxNorthing - minNorthing);
            const wgsPoint = WGS84_to_UTM.toLatLon(e, currentNorthing, zoneToUse, zoneLetter);
            linePoints.push([wgsPoint.longitude, wgsPoint.latitude, 0]);
        }
        
        const clipped = clipLineToRect(linePoints, nwLat, seLat, seLon, nwLon);
        if (clipped.length > 1) {
             const km = Math.round(e / 1000);
             // CORRECTION ICI : Ajout de la lettre après le numéro de zone (ex: 30T 722)
             eastingLines.push({ 
                 name: isMgrs ? formatMgrsLineLabel(km) : `${zoneToUse}${zoneLetter} ${km}`, 
                 coordinates: clipped, 
                 zone: `${zoneToUse}${zoneLetter}`,
                 type: 'easting',
                 km: km,
                 major: isMgrs ? (km % 10 === 0) : (km % 5 === 0),
                 major100k: (km % 100 === 0)
             });
        }
    }

    // --- Lignes Horizontales (Northings) ---
    for (let n = Math.ceil(minNorthing / gridSpacing) * gridSpacing; n <= maxNorthing; n += gridSpacing) {
        const linePoints = [];
        const tempLatForN = WGS84_to_UTM.toLatLon(minEasting, n, zoneToUse, WGS84_to_UTM.getUTMZoneLetter(seLat)).latitude;
        const zoneLetterForN = WGS84_to_UTM.getUTMZoneLetter(tempLatForN);
        if (!zoneLetterForN) continue;

        const utmLeft = WGS84_to_UTM.fromLatLon(tempLatForN, nwLon, zoneToUse);
        const utmRight = WGS84_to_UTM.fromLatLon(tempLatForN, seLon, zoneToUse);
        
        for (let i = 0; i <= segments; i++) {
            const currentEasting = utmLeft.easting + (i / segments) * (utmRight.easting - utmLeft.easting);
            const wgsPoint = WGS84_to_UTM.toLatLon(currentEasting, n, zoneToUse, zoneLetterForN);
            linePoints.push([wgsPoint.longitude, wgsPoint.latitude, 0]);
        }
        
        const clipped = clipLineToRect(linePoints, nwLat, seLat, seLon, nwLon);
        if (clipped.length > 1) {
            const km = Math.round(n / 1000);
            // CORRECTION ICI : Ajout du numéro de zone avant la lettre (ex: 30T 4941)
            northingLines.push({ 
                name: isMgrs ? formatMgrsLineLabel(km) : `${zoneToUse}${zoneLetterForN} ${km}`, 
                coordinates: clipped, 
                zone: `${zoneToUse}${zoneLetterForN}`,
                type: 'northing',
                km: km,
                major: isMgrs ? (km % 10 === 0) : (km % 5 === 0),
                major100k: (km % 100 === 0)
            });
        }
    }
    // --- Identifiants des carrés de 100 km (MGRS uniquement) ---
    // Sur une carte MGRS, les chiffres des lignes ne suffisent pas : chaque carré de
    // 100 km porte son désignateur à deux lettres (ex. « 31U DQ »), placé au centre
    // de la portion visible du carré.
    const squareLabels = [];
    if (isMgrs && typeof WGS84_to_MGRS !== 'undefined') {
        const hemisphereLetter = WGS84_to_UTM.getUTMZoneLetter((nwLat + seLat) / 2);
        if (hemisphereLetter) {
            for (let e0 = Math.floor(minEasting / 100000) * 100000; e0 < maxEasting; e0 += 100000) {
                for (let n0 = Math.floor(minNorthing / 100000) * 100000; n0 < maxNorthing; n0 += 100000) {
                    const centerE = (Math.max(e0, minEasting) + Math.min(e0 + 100000, maxEasting)) / 2;
                    const centerN = (Math.max(n0, minNorthing) + Math.min(n0 + 100000, maxNorthing)) / 2;
                    const p = WGS84_to_UTM.toLatLon(centerE, centerN, zoneToUse, hemisphereLetter);
                    if (isNaN(p.latitude) || isNaN(p.longitude)) continue;
                    if (p.latitude > nwLat || p.latitude < seLat || p.longitude < nwLon || p.longitude > seLon) continue;
                    const band = WGS84_to_UTM.getUTMZoneLetter(p.latitude);
                    if (!band) continue;
                    squareLabels.push({
                        name: `${String(zoneToUse).padStart(2, '0')}${band} ${WGS84_to_MGRS.get100kID(centerE, centerN, zoneToUse)}`,
                        lat: p.latitude,
                        lon: p.longitude,
                        zone: `${zoneToUse}${band}`
                    });
                }
            }
        }
    }

    return { eastingLines, northingLines, squareLabels };
}

function createUTM_KML(eastingLines, northingLines, boundaryLines, config, poiKml = "", zoneFrame = null) {
    const kmlColor = rgbToKmlColor(config.lineColor, config.lineOpacity);
    const kmlColorSolid = rgbToKmlColor(config.lineColor, 1.0);

    let kml = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>${config.gridName}</name>
    <Style id="utmLineStyle"><LineStyle><color>${kmlColor}</color><width>2</width></LineStyle><IconStyle><scale>0</scale></IconStyle></Style>
    <Style id="utmLabelStyle"><IconStyle><scale>0</scale></IconStyle><LabelStyle><scale>0.7</scale></LabelStyle></Style>
    <Style id="boundaryLineStyle"><LineStyle><color>ff00ffff</color><width>4</width></LineStyle><IconStyle><scale>0</scale></IconStyle></Style>
    <Style id="zoneFrameStyle"><LineStyle><color>${kmlColorSolid}</color><width>3</width></LineStyle><PolyStyle><fill>0</fill></PolyStyle></Style>`;
    
    if (zoneFrame) {
        kml += `
    <Placemark>
        <name>${zoneFrame.name}</name>
        <styleUrl>#zoneFrameStyle</styleUrl>
        <LineString>
            <tessellate>1</tessellate>
            <coordinates>${zoneFrame.coordinates.map(c => c.join(',')).join(' ')}</coordinates>
        </LineString>
    </Placemark>`;
    }

    const linesByZone = {};
    eastingLines.concat(northingLines).forEach(line => {
        const zoneKey = line.zone;
        if (!linesByZone[zoneKey]) linesByZone[zoneKey] = { eastings: [], northings: [] };
        if (line.type === 'easting') linesByZone[zoneKey].eastings.push(line);
        else linesByZone[zoneKey].northings.push(line);
    });

    const sortedZoneKeys = Object.keys(linesByZone).sort().reverse();

    for (const zoneKey of sortedZoneKeys) {
        kml += `<Folder><name>Zone ${zoneKey}</name>`;
        kml += `<Folder><name>Lignes Easting</name>${linesByZone[zoneKey].eastings.map(line => createKMLPlacemarkForLine(line, '#utmLineStyle', '#utmLabelStyle')).join('')}</Folder>`;
        kml += `<Folder><name>Lignes Northing</name>${linesByZone[zoneKey].northings.map(line => createKMLPlacemarkForLine(line, '#utmLineStyle', '#utmLabelStyle')).join('')}</Folder>`;
        kml += `</Folder>`;
    }

    if (boundaryLines.length > 0) {
        const bParts = boundaryLines.map(line =>
            `<Placemark><name>${line.name}</name><styleUrl>#boundaryLineStyle</styleUrl><LineString><tessellate>1</tessellate><coordinates>${line.coordinates.map(c => c.join(',')).join(' ')}</coordinates></LineString></Placemark>`
        );
        kml += `<Folder><name>Frontières de Zone</name>${bParts.join('')}</Folder>`;
    }

    if (poiKml) {
        kml += `<Folder><name>Points d'intérêt</name>${poiKml}</Folder>`;
    }

    kml += `  </Document>
</kml>`;
    return kml;
}

function createKMLPlacemarkForLine(line, lineStyleUrl, labelStyleUrl) {
    const coordinateString = line.coordinates.map(c => c.join(',')).join(' ');
    const startPoint = line.coordinates[1] ? line.coordinates[1].join(',') : "";
    const endPoint = line.coordinates[line.coordinates.length - 2] ? line.coordinates[line.coordinates.length - 2].join(',') : "";
    
    let placemark = `
      <Placemark>
        <name>${line.name}</name>
        <styleUrl>${lineStyleUrl}</styleUrl>
        <LineString>
          <tessellate>1</tessellate>
          <coordinates>${coordinateString}</coordinates>
        </LineString>
      </Placemark>`;
      
    if (startPoint && endPoint) {
        placemark += `
      <Placemark>
        <name>${line.name}</name>
        <styleUrl>${labelStyleUrl}</styleUrl>
        <Point><coordinates>${startPoint}</coordinates></Point>
      </Placemark>
      <Placemark>
        <name>${line.name}</name>
        <styleUrl>${labelStyleUrl}</styleUrl>
        <Point><coordinates>${endPoint}</coordinates></Point>
      </Placemark>`;
    }
      
    return placemark;
}
