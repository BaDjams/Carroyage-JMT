// carroyageUTM.js

/**********************************************************************************/
/*    BIBLIOTHÈQUE DE CONVERSION WGS84 <> UTM                                     */
/**********************************************************************************/
const WGS84_to_UTM = (function() {
    const PI = Math.PI;
    const a = 6378137;
    const eccSquared = 0.00669438;
    const k0 = 0.9996;

    function toDegrees(rad) { return rad / PI * 180; }
    function toRadians(deg) { return deg * PI / 180; }

    function getUTMZoneLetter(lat) {
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
        const e1 = (1 - Math.sqrt(1 - eccSquared)) / (1 + Math.sqrt(1 - eccSquared));
        const x = easting - 500000.0;
        let y = northing;
        if (zoneLetter && 'CDEFGHJKLMN'.includes(zoneLetter)) y -= 10000000.0;
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
    return { fromLatLon, toLatLon };
})();

async function generateUTMGrid() {
    const loadingIndicator = document.getElementById('loading-indicator');
    document.getElementById('loading-message').textContent = "Génération de la grille UTM en cours...";
    loadingIndicator.classList.remove('hidden');
    hideError();

    try {
        const nwCoordStr = document.getElementById('utm-nw-coords').value;
        const seCoordStr = document.getElementById('utm-se-coords').value;
        const gridName = document.getElementById('utm-grid-name').value || 'Grille_UTM_1km';
        const color = document.getElementById('utm-grid-color').value;
        const opacity = (100 - parseInt(document.getElementById('utm-transparency').value)) / 100;

        if (!nwCoordStr || !seCoordStr) throw new Error("Veuillez entrer les coordonnées Nord-Ouest et Sud-Est.");
        const [nwLat, nwLon] = nwCoordStr.split(',').map(c => parseFloat(c.trim()));
        const [seLat, seLon] = seCoordStr.split(',').map(c => parseFloat(c.trim()));
        if (isNaN(nwLat) || isNaN(nwLon) || isNaN(seLat) || isNaN(seLon)) throw new Error("Format de coordonnées invalide.");

        const startZone = WGS84_to_UTM.fromLatLon(nwLat, nwLon).zoneNumber;
        const endZone = WGS84_to_UTM.fromLatLon(seLat, seLon).zoneNumber;
        let allEastingLines = [], allNorthingLines = [], allBoundaryLines = [], allIntermediateLabels = [];

        for (let zone = startZone; zone <= endZone; zone++) {
            const zoneBoundaryLeft = (zone - 1) * 6 - 180;
            const zoneBoundaryRight = zone * 6 - 180;
            const clipLonStart = Math.max(nwLon, zoneBoundaryLeft);
            const clipLonEnd = Math.min(seLon, zoneBoundaryRight);
            if (clipLonStart >= clipLonEnd) continue;

            const gridDataForZone = calculateGridForZoneStrip(nwLat, clipLonStart, seLat, clipLonEnd, zone);
            allEastingLines.push(...gridDataForZone.eastingLines);
            allNorthingLines.push(...gridDataForZone.northingLines);
            allIntermediateLabels.push(...gridDataForZone.intermediateLabels);

            if (zone < endZone && seLon > zoneBoundaryRight) {
                allBoundaryLines.push({ name: `Frontière Zone ${zone}/${zone + 1}`, coordinates: [[zoneBoundaryRight, nwLat, 0], [zoneBoundaryRight, seLat, 0]] });
            }
        }

        const kmlContent = createUTM_KML(allEastingLines, allNorthingLines, allBoundaryLines, allIntermediateLabels, { gridName, lineColor: color, lineOpacity: opacity });
        const zip = new JSZip();
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

function calculateGridForZoneStrip(nwLat, nwLon, seLat, seLon, zoneToUse) {
    const zoneLetter = WGS84_to_UTM.fromLatLon(nwLat, nwLon).zoneLetter;
    
    const utm_nw = WGS84_to_UTM.fromLatLon(nwLat, nwLon, zoneToUse);
    const utm_ne = WGS84_to_UTM.fromLatLon(nwLat, seLon, zoneToUse);
    const utm_sw = WGS84_to_UTM.fromLatLon(seLat, nwLon, zoneToUse);
    
    const minEasting = Math.min(utm_nw.easting, utm_sw.easting);
    const maxEasting = utm_ne.easting;
    const minNorthing = utm_sw.northing;
    const maxNorthing = utm_nw.northing;

    const gridSpacing = 1000, labelSpacing = 5000;
    const eastingLines = [], northingLines = [], intermediateLabels = [];
    const segments = 20;

    for (let e = Math.ceil(minEasting / gridSpacing) * gridSpacing; e <= maxEasting; e += gridSpacing) {
        const linePoints = [];
        for (let i = 0; i <= segments; i++) {
            const currentNorthing = minNorthing + (i / segments) * (maxNorthing - minNorthing);
            const wgsPoint = WGS84_to_UTM.toLatLon(e, currentNorthing, zoneToUse, zoneLetter);
            const tolerance = 1e-9;
            if (wgsPoint.longitude >= (nwLon - tolerance) && wgsPoint.longitude <= (seLon + tolerance)) {
                linePoints.push([wgsPoint.longitude, wgsPoint.latitude, 0]);
            }
        }
        if (linePoints.length > 1) {
             eastingLines.push({ name: `E ${Math.round(e / 1000)}`, coordinates: linePoints, zone: `${zoneToUse}${zoneLetter}` });
        }
        if (Math.round(e) % labelSpacing === 0) {
            for (let n = Math.ceil(minNorthing / labelSpacing) * labelSpacing; n <= maxNorthing; n += labelSpacing) {
                const labelPointWGS = WGS84_to_UTM.toLatLon(e, n, zoneToUse, zoneLetter);
                 if (labelPointWGS.longitude >= nwLon && labelPointWGS.longitude <= seLon) {
                    intermediateLabels.push({ name: `${zoneToUse}${zoneLetter} ${Math.round(e / 1000)} ${Math.round(n / 1000)}`, coordinates: [labelPointWGS.longitude, labelPointWGS.latitude, 0] });
                }
            }
        }
    }

    for (let n = Math.ceil(minNorthing / gridSpacing) * gridSpacing; n <= maxNorthing; n += gridSpacing) {
        const linePoints = [];
        const tempLatForBounds = WGS84_to_UTM.toLatLon(minEasting, n, zoneToUse, zoneLetter).latitude;
        const utmLeft = WGS84_to_UTM.fromLatLon(tempLatForBounds, nwLon, zoneToUse);
        const utmRight = WGS84_to_UTM.fromLatLon(tempLatForBounds, seLon, zoneToUse);
        const startEasting = utmLeft.easting;
        const endEasting = utmRight.easting;

        for (let i = 0; i <= segments; i++) {
            const currentEasting = startEasting + (i / segments) * (endEasting - startEasting);
            const wgsPoint = WGS84_to_UTM.toLatLon(currentEasting, n, zoneToUse, zoneLetter);
            linePoints.push([wgsPoint.longitude, wgsPoint.latitude, 0]);
        }
        
        if (linePoints.length > 1) {
            northingLines.push({ name: `N ${Math.round(n / 1000)}`, coordinates: linePoints, zone: `${zoneToUse}${zoneLetter}` });
        }
        
        if (Math.round(n) % labelSpacing === 0) {
            for (let e = Math.ceil(startEasting / labelSpacing) * labelSpacing; e <= endEasting; e += labelSpacing) {
                const labelPointWGS = WGS84_to_UTM.toLatLon(e, n, zoneToUse, zoneLetter);
                if (labelPointWGS.longitude >= nwLon && labelPointWGS.longitude <= seLon) {
                    intermediateLabels.push({ name: `${zoneToUse}${zoneLetter} ${Math.round(e / 1000)} ${Math.round(n / 1000)}`, coordinates: [labelPointWGS.longitude, labelPointWGS.latitude, 0] });
                }
            }
        }
    }
    return { eastingLines, northingLines, intermediateLabels };
}

function createUTM_KML(eastingLines, northingLines, boundaryLines, intermediateLabels, config) {
    const kmlColor = rgbToKmlColor(config.lineColor, config.lineOpacity);
    let kml = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>${config.gridName}</name>
    <Style id="utmLineStyle"><LineStyle><color>${kmlColor}</color><width>2</width></LineStyle></Style>
    <Style id="utmLabelStyle"><IconStyle><scale>0</scale></IconStyle><LabelStyle><scale>0.7</scale></LabelStyle></Style>
    <Style id="utmIntermediateLabelStyle"><IconStyle><scale>0</scale></IconStyle><LabelStyle><scale>0.6</scale></LabelStyle></Style>
    <Style id="boundaryLineStyle"><LineStyle><color>ff0000ff</color><width>4</width></LineStyle></Style>`;
    
    const linesByZone = {};
    [...eastingLines, ...northingLines].forEach(line => {
        if (!linesByZone[line.zone]) linesByZone[line.zone] = { eastings: [], northings: [] };
        if (line.name.startsWith('E')) {
            linesByZone[line.zone].eastings.push(line);
        } else {
            linesByZone[line.zone].northings.push(line);
        }
    });

    for (const zone in linesByZone) {
        kml += `<Folder><name>Zone ${zone}</name>`;
        kml += `<Folder><name>Lignes Easting</name>${linesByZone[zone].eastings.map(line => createKMLPlacemarkForLine(line, '#utmLineStyle', '#utmLabelStyle')).join('')}</Folder>`;
        kml += `<Folder><name>Lignes Northing</name>${linesByZone[zone].northings.map(line => createKMLPlacemarkForLine(line, '#utmLineStyle', '#utmLabelStyle')).join('')}</Folder>`;
        kml += `</Folder>`;
    }

    if (intermediateLabels.length > 0) {
        kml += `<Folder><name>Étiquettes (carroyage 5km)</name>`;
        intermediateLabels.forEach(label => {
            kml += `<Placemark><name>${label.name}</name><styleUrl>#utmIntermediateLabelStyle</styleUrl><Point><coordinates>${label.coordinates.join(',')}</coordinates></Point></Placemark>`;
        });
        kml += `</Folder>`;
    }

    if (boundaryLines.length > 0) {
        kml += `<Folder><name>Frontières de Zone</name>`;
        boundaryLines.forEach(line => {
            kml += `<Placemark><name>${line.name}</name><styleUrl>#boundaryLineStyle</styleUrl><LineString><tessellate>1</tessellate><coordinates>${line.coordinates.map(c => c.join(',')).join(' ')}</coordinates></LineString></Placemark>`;
        });
        kml += `</Folder>`;
    }

    kml += `  </Document>
</kml>`;
    return kml;
}

function createKMLPlacemarkForLine(line, lineStyleUrl, labelStyleUrl) {
    const coordinateString = line.coordinates.map(c => c.join(',')).join(' ');
    // **CORRECTION** : S'assurer que les points de début/fin sont bien formatés
    const startPoint = line.coordinates[0].join(','); 
    const endPoint = line.coordinates[line.coordinates.length - 1].join(',');
    
    let placemark = `
      <Placemark>
        <name>${line.name}</name>
        <styleUrl>${lineStyleUrl}</styleUrl>
        <LineString>
          <tessellate>1</tessellate>
          <coordinates>${coordinateString}</coordinates>
        </LineString>
      </Placemark>`;
      
    // Ajouter les étiquettes de début et de fin
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
      
    return placemark;
}
