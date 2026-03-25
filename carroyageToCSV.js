// carroyageToCSV.js

/**
 * Génère un CSV au format standard WKT (Well-Known Text)
 * Compatible Google Earth Pro (Import), QGIS, ArcGIS.
 * Accepte des données CADO manuelles (optionalCadoData) pour le Mode 1.
 */
async function generateGridCSV(filename, useUtm, useCfsi, useCado, userPOIs, optionalCadoData = null) {
    const rows = [];
    
    rows.push(["WKT", "name", "description", "latitude", "longitude"]);

    const escapeCsv = (str) => {
        if (str === null || str === undefined) return "";
        return `"${str.toString().replace(/"/g, '""')}"`;
    };

    const addRow = (type, coordinates, name, desc) => {
        let wkt = "";
        let lat = "";
        let lon = "";

        if (type === "Point") {
            wkt = `POINT(${coordinates[0].toFixed(7)} ${coordinates[1].toFixed(7)})`;
            lon = coordinates[0].toFixed(7);
            lat = coordinates[1].toFixed(7);
        } else if (type === "LineString") {
            const coordPairs = coordinates.map(c => `${c[0].toFixed(7)} ${c[1].toFixed(7)}`).join(",");
            wkt = `LINESTRING(${coordPairs})`;
        }

        rows.push([wkt, escapeCsv(name), escapeCsv(desc), lat, lon]);
    };

    // --- 1. CADO ---
    if (useCado) {
        let config = null;
        let gridData = null;

        // Si des données sont fournies (Mode 1), on les utilise
        if (optionalCadoData && optionalCadoData.config && optionalCadoData.gridData) {
            config = optionalCadoData.config;
            gridData = optionalCadoData.gridData;
        } 
        // Sinon (Mode 2), on va les chercher dans l'interface
        else if (typeof getZoneCadoConfigAndBounds === 'function') {
            try {
                const res = getZoneCadoConfigAndBounds();
                config = res.config;
                gridData = calculateGridData(config);
            } catch(e) { console.warn("Impossible de récupérer config CADO Mode 2", e); }
        }

        if (config && gridData) {
            // Lignes
            const allLines = [...gridData.horizontalLines, ...gridData.verticalLines];
            allLines.forEach(line => {
                if (line.points.length < 2) return;
                addRow("LineString", line.points, line.name, "Ligne CADO");
            });

            // Points (Labels)
            if (config.includePoints) {
                gridData.points.forEach(pt => {
                    addRow("Point", pt.coordinates, pt.name, "Label CADO");
                });
            }
        }
    }

    // --- 2. CFSI ---
    if (useCfsi && typeof CFSI_UTILS !== 'undefined') {
        // ... (Code CFSI inchangé, dépend toujours du Mode 2/Input Zone pour l'instant) ...
        // Si vous voulez le CFSI en Mode 1 (non demandé), il faudrait adapter ici aussi.
        // Pour l'instant, on garde la logique existante :
        const nwInput = document.getElementById("zone-nw-coords");
        if (nwInput && nwInput.value) {
            const nwStr = nwInput.value;
            const seStr = document.getElementById("zone-se-coords").value;
            const [north, west] = nwStr.split(',').map(parseFloat);
            const [south, east] = seStr.split(',').map(parseFloat);

            const nwL2 = CFSI_UTILS.wgs84ToL2E(north, west);
            const seL2 = CFSI_UTILS.wgs84ToL2E(south, east);

            const rawMinX = Math.min(nwL2.x, seL2.x), rawMaxX = Math.max(nwL2.x, seL2.x);
            const rawMinY = Math.min(nwL2.y, seL2.y), rawMaxY = Math.max(nwL2.y, seL2.y);
            const lMinX = Math.floor(rawMinX / 2000) * 2000;
            const lMaxX = Math.ceil(rawMaxX  / 2000) * 2000;
            const lMinY = Math.floor(rawMinY / 2000) * 2000;
            const lMaxY = Math.ceil(rawMaxY  / 2000) * 2000;

            for (let x = lMinX; x <= lMaxX; x += 2000) {
                const pStart = CFSI_UTILS.l2EToWgs84(x, lMinY);
                const pEnd = CFSI_UTILS.l2EToWgs84(x, lMaxY);
                addRow("LineString", [[pStart.lon, pStart.lat], [pEnd.lon, pEnd.lat]], "Ligne X", "Grille CFSI");
            }
            for (let y = lMinY; y <= lMaxY; y += 2000) {
                const pStart = CFSI_UTILS.l2EToWgs84(lMinX, y);
                const pEnd = CFSI_UTILS.l2EToWgs84(lMaxX, y);
                addRow("LineString", [[pStart.lon, pStart.lat], [pEnd.lon, pEnd.lat]], "Ligne Y", "Grille CFSI");
            }

            for (let x = lMinX; x < lMaxX; x += 2000) {
                for (let y = lMinY; y < lMaxY; y += 2000) {
                    const centerX = x + 1000;
                    const centerY = y + 1000;
                    if (centerX < rawMinX || centerX > rawMaxX || centerY < rawMinY || centerY > rawMaxY) { continue; }

                    const comps = CFSI_UTILS.getComponentsFromLambert(centerX, centerY);
                    if (comps) {
                        const geo = CFSI_UTILS.l2EToWgs84(centerX, centerY);
                        addRow("Point", [geo.lon, geo.lat], comps.full2k, "Label CFSI");
                    }
                }
            }
        }
    }

    // --- 3. UTM ---
    if (useUtm && typeof WGS84_to_UTM !== 'undefined' && typeof calculateGridForZoneStrip !== 'undefined') {
        const nwInput = document.getElementById("zone-nw-coords");
        if (nwInput && nwInput.value) {
            const nwStr = nwInput.value;
            const seStr = document.getElementById("zone-se-coords").value;
            const [north, west] = nwStr.split(',').map(parseFloat);
            const [south, east] = seStr.split(',').map(parseFloat);

            const startZone = WGS84_to_UTM.fromLatLon(north, west).zoneNumber;
            const endZone = WGS84_to_UTM.fromLatLon(south, east).zoneNumber;

            for (let zone = startZone; zone <= endZone; zone++) {
                const zLeft = (zone - 1) * 6 - 180;
                const zRight = zone * 6 - 180;
                const cLeft = Math.max(west, zLeft);
                const cRight = Math.min(east, zRight);
                if (cLeft >= cRight) continue;

                const gridData = calculateGridForZoneStrip(north, cLeft, south, cRight, zone);
                const allLines = [...gridData.eastingLines, ...gridData.northingLines];

                allLines.forEach(line => {
                    if (line.coordinates.length < 2) return;
                    const coords = line.coordinates.map(c => [c[0], c[1]]);
                    addRow("LineString", coords, line.name, "Ligne UTM");
                });
            }
        }
    }

    // --- 4. POIS ---
    if (userPOIs && userPOIs.length > 0) {
        userPOIs.forEach(poi => {
            addRow("Point", [poi.lon, poi.lat], poi.name || poi.type, "POI Utilisateur");
        });
    }

    // Export
    const csvContent = rows.map(e => e.join(",")).join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    
    if (typeof downloadFile === 'function') {
        downloadFile(blob, `${filename}.csv`);
    } else {
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.setAttribute("href", url);
        link.setAttribute("download", `${filename}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }
}