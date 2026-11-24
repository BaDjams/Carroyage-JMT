// carroyageNautique.js
//
// Carroyage « nautique » de l'export de zone : le carroyage régulier en mer en mailles
// de 1' × 1' ou 3' × 3' (minutes de degré), au sens du carroyage CNIG-GIMeL (Cerema /
// OFB, diffusé sur Géolittoral).
//
// - Calage : minutes ENTIÈRES de degré (1') ou multiples de 3' à partir de 0°. Vérifié
//   sur les shapefiles officiels (métropole, ETRS89 / EPSG:4258).
// - Système : coordonnées géographiques. ETRS89 et WGS84 diffèrent d'environ 1 m au
//   plus : aucune reprojection pour la cartographie web.
// - Identifiants des mailles : « cohérents INSPIRE » — taille de maille dans le nom, puis
//   coin SUD-OUEST de la maille, pour le 1' comme pour le 3' (cf. cellId). Le 1' est
//   identique au nom officiel CNIG-GIMeL. Le 3' officiel, lui, nomme la maille par son
//   coin NORD-OUEST en centièmes de degré : ce nom reste fourni à part (officialId3 ;
//   propriété « id_officiel » du GeoJSON), vérifié sur les 15 433 mailles de la Manche.
// - La grille est régulière et couvre aussi la terre : les mailles officielles sont,
//   elles, limitées à l'espace maritime.
//
// Chargé avant zoneDownloader.js. NAUTIC_UTILS est pur (sans DOM) : tools/test_nautique.mjs
// l'exécute sous Node. Les deux fonctions de dessin, elles, lisent l'interface.
//
// Exports globaux :
//   NAUTIC_UTILS : STEPS, MAX_CELLS, MAX_LABELS, lattice, cellId, officialId3, cellBounds, cells,
//                  labelsAllowed, formatLat, formatLon, lines, kmlFolder, geoJSON
//   drawNauticGridOnCanvas(ctx, bbox, latLonToPixels, margin, fontSize, lineWidth, step)
//                  image de l'export de zone ; rend la maille annoncée au cartouche (« 1' »)
//   drawNauticGridDigital(ctx, bbox, project, color, step)
//                  overlay MBTiles (DJI) : traits nets, sans halo

const NAUTIC_UTILS = (() => {
    const STEPS = [1, 3];
    // Au-delà, la zone est refusée (comme la limite de 100 cases du carroyage CADO).
    const MAX_CELLS = 40000;
    // Au-delà, les libellés de mailles ne sont pas générés (lignes seules).
    const MAX_LABELS = 3000;
    const EPS = 1e-9;
    // KML : un libellé de maille n'apparaît que lorsque la maille mesure au moins ce
    // nombre de pixels à l'écran (Region/Lod) ; de loin, seules les lignes restent.
    const KML_LABEL_MIN_LOD_PIXELS = 160;

    // Minutes de degré -> degrés (7 décimales, ~1 cm).
    const deg = (minutes) => Number((minutes / 60).toFixed(7));
    const pad = (n, width) => String(n).padStart(width, '0');

    /**
     * Treillis de mailles couvrant une bbox { north, south, east, west }. Les indices
     * sont des entiers en unités de `step` minutes : la ligne `row` va de row*step à
     * (row+1)*step minutes de latitude, la colonne `col` de col*step à (col+1)*step
     * minutes de longitude. La bbox est calée vers l'extérieur ; rowMax et colMax sont
     * exclusifs. Calculs en minutes entières : aucune dérive flottante sur les bords.
     */
    function lattice(bbox, step) {
        if (!STEPS.includes(step)) throw new Error(`Pas de carroyage nautique inconnu : ${step}'.`);
        const rowMin = Math.floor((bbox.south * 60) / step + EPS);
        let rowMax = Math.ceil((bbox.north * 60) / step - EPS);
        const colMin = Math.floor((bbox.west * 60) / step + EPS);
        let colMax = Math.ceil((bbox.east * 60) / step - EPS);
        if (rowMax <= rowMin) rowMax = rowMin + 1;
        if (colMax <= colMin) colMax = colMin + 1;
        const numRows = rowMax - rowMin;
        const numCols = colMax - colMin;
        if (numRows * numCols > MAX_CELLS) {
            throw new Error(`Le nombre de mailles nautiques (${numRows}x${numCols} = ${numRows * numCols}) dépasse ${MAX_CELLS}. Choisissez 3' ou réduisez la zone.`);
        }
        return { step, rowMin, rowMax, colMin, colMax, numRows, numCols };
    }

    /**
     * Identifiant d'une maille, cohérent INSPIRE : taille de maille, puis coin SUD-OUEST
     * (latitude du bord sud, longitude du bord ouest) en degrés-minutes DDMM.
     *  - « <1|3>_<lat sud DDMM>_N_<lon ouest DDMM>_<E|W> »
     *  - 1' : ex. 1_4918_N_0004_E, identique au nom officiel CNIG-GIMeL ;
     *  - 3' : ex. 3_4930_N_0012_E (le nom officiel est autre, cf. officialId3) ;
     *  - sur le méridien de Greenwich le suffixe E/W est absent (1_4921_N_0000).
     */
    function cellId(step, row, col) {
        const southMin = row * step;
        const westMin = col * step;
        const lonHem = westMin < 0 ? 'W' : 'E';
        const ddmm = (m) => {
            const a = Math.abs(m);
            return Math.floor(a / 60) * 100 + (a % 60);
        };
        const hem = westMin === 0 ? '' : `_${lonHem}`;
        return `${step}_${pad(ddmm(southMin), 4)}_${southMin < 0 ? 'S' : 'N'}_${pad(ddmm(westMin), 4)}${hem}`;
    }

    /**
     * Nom OFFICIEL (CNIG-GIMeL) d'une maille de 3' : « 3_<lat du bord NORD x100, 5
     * chiffres>_N_<lon du bord OUEST x100, 5 chiffres>_<E|W> », ex. 3_04935_N_00030_W.
     * Le 1' officiel est celui de cellId. Sert à retrouver une maille dans les données
     * Géolittoral.
     */
    function officialId3(row, col) {
        const northMin = (row + 1) * 3;
        const westMin = col * 3;
        const lat = (Math.abs(northMin) / 3) * 5;
        const lon = (Math.abs(westMin) / 3) * 5;
        return `3_${pad(lat, 5)}_${northMin < 0 ? 'S' : 'N'}_${pad(lon, 5)}_${westMin < 0 ? 'W' : 'E'}`;
    }

    function cellBounds(step, row, col) {
        return { south: deg(row * step), north: deg((row + 1) * step), west: deg(col * step), east: deg((col + 1) * step) };
    }

    function cells(l) {
        const out = [];
        for (let row = l.rowMin; row < l.rowMax; row++) {
            for (let col = l.colMin; col < l.colMax; col++) {
                const b = cellBounds(l.step, row, col);
                out.push({ id: cellId(l.step, row, col), row, col, ...b,
                    centerLat: (b.south + b.north) / 2, centerLon: (b.west + b.east) / 2 });
            }
        }
        return out;
    }

    const labelsAllowed = (l) => l.numRows * l.numCols <= MAX_LABELS;

    // « 49°18'N » (minutes entières de latitude).
    function formatLat(m) {
        const a = Math.abs(m);
        return `${Math.floor(a / 60)}°${pad(a % 60, 2)}'${m < 0 ? 'S' : 'N'}`;
    }

    // « 0°04'E » (minutes entières de longitude) ; pas de suffixe sur Greenwich.
    function formatLon(m) {
        const a = Math.abs(m);
        return `${Math.floor(a / 60)}°${pad(a % 60, 2)}'${m === 0 ? '' : m < 0 ? 'W' : 'E'}`;
    }

    /**
     * Parallèles et méridiens du treillis : { name, type, major, minutes, coordinates }
     * (coordinates en [lon, lat]). « major » : toutes les 10 mailles (10' pour le 1',
     * 30' pour le 3'). Un sommet par méridien sur chaque parallèle : un parallèle n'est
     * pas un arc de grand cercle, et un segment unique s'en écarterait de plusieurs
     * centaines de mètres sur 100 km (KML, Google Earth).
     */
    function lines(l) {
        const out = [];
        const lonMinutes = [];
        for (let c = l.colMin; c <= l.colMax; c++) lonMinutes.push(c * l.step);
        const south = deg(l.rowMin * l.step);
        const north = deg(l.rowMax * l.step);
        const isMajor = (min) => (min / l.step) % 10 === 0;
        for (let r = l.rowMin; r <= l.rowMax; r++) {
            const min = r * l.step;
            out.push({ name: formatLat(min), type: 'parallel', major: isMajor(min), minutes: min,
                coordinates: lonMinutes.map((lm) => [deg(lm), deg(min)]) });
        }
        for (const lm of lonMinutes) {
            out.push({ name: formatLon(lm), type: 'meridian', major: isMajor(lm), minutes: lm,
                coordinates: [[deg(lm), south], [deg(lm), north]] });
        }
        return out;
    }

    const xmlEscape = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

    /**
     * Dossier KML : lignes (#commonLineStyle ; #nauticMajorLine toutes les 10 mailles) et
     * libellés de mailles au centre (#commonLabelStyle), masqués de loin par une Region/Lod
     * (visibles à partir de KML_LABEL_MIN_LOD_PIXELS pixels par maille). Les styles sont ceux de
     * l'en-tête du KML de zone (handleZoneVectorExport).
     */
    function kmlFolder(bbox, step) {
        const l = lattice(bbox, step);
        let kml = `<Folder><name>Grille nautique ${step}'</name><Folder><name>Lignes</name>`;
        for (const line of lines(l)) {
            kml += `<Placemark><name>${xmlEscape(line.name)}</name><styleUrl>#${line.major ? 'nauticMajorLine' : 'commonLineStyle'}</styleUrl>`
                + `<LineString><coordinates>${line.coordinates.map((c) => `${c[0]},${c[1]},0`).join(' ')}</coordinates></LineString></Placemark>`;
        }
        kml += '</Folder>';
        if (labelsAllowed(l)) {
            kml += '<Folder><name>Mailles</name>';
            for (const c of cells(l)) {
                kml += `<Placemark><name>${c.id}</name><styleUrl>#commonLabelStyle</styleUrl>`
                    + `<Region><LatLonAltBox><north>${c.north}</north><south>${c.south}</south><east>${c.east}</east><west>${c.west}</west></LatLonAltBox>`
                    + `<Lod><minLodPixels>${KML_LABEL_MIN_LOD_PIXELS}</minLodPixels></Lod></Region><Point><coordinates>${c.centerLon},${c.centerLat},0</coordinates></Point></Placemark>`;
            }
            kml += '</Folder>';
        }
        return kml + '</Folder>';
    }

    // GeoJSON : une maille = un polygone (anneau extérieur anti-horaire) portant son identifiant.
    function geoJSON(bbox, step, name) {
        const l = lattice(bbox, step);
        const features = cells(l).map((c) => ({
            type: 'Feature',
            properties: { id: c.id, ...(step === 3 ? { id_officiel: officialId3(c.row, c.col) } : {}), grille: `${step}'`, lat_sud: c.south, lat_nord: c.north, lon_ouest: c.west, lon_est: c.east },
            geometry: { type: 'Polygon', coordinates: [[[c.west, c.south], [c.east, c.south], [c.east, c.north], [c.west, c.north], [c.west, c.south]]] },
        }));
        return JSON.stringify({ type: 'FeatureCollection', name: name || `Grille nautique ${step}'`, features });
    }

    return { STEPS, MAX_CELLS, MAX_LABELS, lattice, cellId, officialId3, cellBounds, cells, labelsAllowed, formatLat, formatLon, lines, kmlFolder, geoJSON };
})();

// Identifiants de mailles (cohérents INSPIRE) au centre, quand la maille est assez grande pour les contenir.
// `draw(text, x, y)` pose le texte ; `inside(p)` écarte les mailles hors de la zone dessinée.
function nauticDrawCellLabels(ctx, cellList, project, inside, draw) {
    for (const c of cellList) {
        const nw = project(c.north, c.west);
        const se = project(c.south, c.east);
        const center = project(c.centerLat, c.centerLon);
        if (!inside(center)) continue;
        const textWidth = ctx.measureText(c.id).width;
        if (Math.abs(se.x - nw.x) < textWidth * 1.15 || Math.abs(se.y - nw.y) < 18) continue;
        draw(c.id, center.x, center.y);
    }
}

// Image de l'export de zone : lignes (trait double toutes les 10 mailles), identifiants de
// mailles si elles sont assez grandes, puis graduations en degrés-minutes sur la bande
// blanche de la marge, comme la grille UTM (drawUtmGridOnCanvas). Rend la maille annoncée
// au cartouche, à la manière du CFSI et du DFCI.
async function drawNauticGridOnCanvas(ctx, bbox, latLonToPixels, margin, fontSize, lineWidth, step) {
    const color = document.getElementById('utm-grid-color').value;
    const opacity = (100 - parseInt(document.getElementById('utm-transparency').value)) / 100;
    // Encre : couleur choisie, ou couleur adaptative lue sur le fond déjà dessiné.
    const ink = createGridInk(ctx, color, opacity);

    const lat = NAUTIC_UTILS.lattice(bbox, step);
    const lineList = NAUTIC_UTILS.lines(lat);
    const box = { x: margin, y: margin, width: ctx.canvas.width - margin * 2, height: ctx.canvas.height - margin * 2 };
    const inBox = (p) => p.x >= box.x && p.x <= box.x + box.width && p.y >= box.y && p.y <= box.y + box.height;
    const labelsToDraw = [];

    ctx.save();
    ctx.beginPath(); ctx.rect(box.x, box.y, box.width, box.height); ctx.clip();

    for (const line of lineList) {
        ctx.lineWidth = line.major ? lineWidth * 2 : lineWidth;
        const pts = line.coordinates.map(c => latLonToPixels(c[1], c[0]));
        ctx.strokeStyle = ink.strokeFor(pts);
        ctx.beginPath();
        pts.forEach((p, i) => { if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y); });
        ctx.stroke();
        const first = pts[0], last = pts[pts.length - 1];
        if (line.type === 'meridian') {
            // Méridien : sommet sud en bas de l'image, sommet nord en haut.
            labelsToDraw.push({ type: 'top', anchor: { x: last.x, y: box.y }, text: line.name });
            labelsToDraw.push({ type: 'bottom', anchor: { x: first.x, y: box.y + box.height }, text: line.name });
        } else {
            labelsToDraw.push({ type: 'left', anchor: { x: box.x, y: first.y }, text: line.name });
            labelsToDraw.push({ type: 'right', anchor: { x: box.x + box.width, y: last.y }, text: line.name });
        }
    }

    if (NAUTIC_UTILS.labelsAllowed(lat)) {
        const labelFont = fontSize * 0.6;
        ctx.font = `bold ${labelFont}px Arial`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        nauticDrawCellLabels(ctx, NAUTIC_UTILS.cells(lat), latLonToPixels, inBox, (text, x, y) =>
            drawTextWithOutline(ctx, text, x, y, labelFont * GRID_LABEL_HALO_RATIO, ink.labelColorsAt(x, y)));
        ctx.textAlign = 'start';
        ctx.textBaseline = 'alphabetic';
    }
    ctx.restore();

    ctx.fillStyle = 'white';
    ctx.fillRect(0, 0, ctx.canvas.width, margin);
    ctx.fillRect(0, ctx.canvas.height - margin, ctx.canvas.width, margin);
    ctx.fillRect(0, 0, margin, ctx.canvas.height);
    ctx.fillRect(ctx.canvas.width - margin, 0, margin, ctx.canvas.height);

    // Graduations : seules les lignes visibles, espacées pour ne pas se chevaucher.
    ctx.font = `bold ${fontSize * 0.75}px Arial`;
    const gap = ctx.measureText("00°00'W").width + fontSize * 0.6;
    const keep = (side, axis) => {
        const lo = axis === 'x' ? box.x : box.y;
        const hi = lo + (axis === 'x' ? box.width : box.height);
        const list = labelsToDraw.filter(l => l.type === side && l.anchor[axis] >= lo && l.anchor[axis] <= hi)
            .sort((a, b) => a.anchor[axis] - b.anchor[axis]);
        const out = [];
        let lastPos = -Infinity;
        for (const l of list) {
            if (l.anchor[axis] - lastPos >= gap) { out.push(l); lastPos = l.anchor[axis]; }
        }
        return out;
    };
    const toDraw = [...keep('top', 'x'), ...keep('bottom', 'x'), ...keep('left', 'y'), ...keep('right', 'y')];
    for (const label of toDraw) {
        // En couleur fixe, le noir reste de rigueur : une grille blanche donnerait des
        // graduations blanches sur une bande blanche.
        ctx.fillStyle = ink.adaptive ? ink.colorAt(label.anchor.x, label.anchor.y) : 'black';
        ctx.save();
        ctx.translate(label.anchor.x, label.anchor.y);
        ctx.textBaseline = 'middle';
        switch (label.type) {
            case 'top': ctx.rotate(-Math.PI / 2); ctx.textAlign = 'left'; ctx.fillText(label.text, 5, 0); break;
            case 'bottom': ctx.rotate(-Math.PI / 2); ctx.textAlign = 'right'; ctx.fillText(label.text, -5, 0); break;
            case 'left': ctx.textAlign = 'right'; ctx.fillText(label.text, -5, 0); break;
            case 'right': ctx.textAlign = 'left'; ctx.fillText(label.text, 5, 0); break;
        }
        ctx.restore();
    }
    ctx.textAlign = 'start';
    ctx.textBaseline = 'alphabetic';
    return `${step}'`;
}

// Overlay MBTiles (DJI) : traits pleins (3 px toutes les 10 mailles) et identifiants de
// mailles lisibles, sans halo, comme les autres couches « digital ».
function drawNauticGridDigital(ctx, bbox, project, color, step) {
    const lat = NAUTIC_UTILS.lattice(bbox, step);
    ctx.strokeStyle = color;
    for (const line of NAUTIC_UTILS.lines(lat)) {
        ctx.lineWidth = line.major ? 3 : 2;
        ctx.beginPath();
        line.coordinates.forEach((c, i) => {
            const p = project(c[1], c[0]);
            if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y);
        });
        ctx.stroke();
    }
    if (NAUTIC_UTILS.labelsAllowed(lat)) {
        ctx.font = 'bold 14px Arial';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = color;
        const w = ctx.canvas.width, h = ctx.canvas.height;
        nauticDrawCellLabels(ctx, NAUTIC_UTILS.cells(lat), project,
            (p) => p.x >= -w && p.x <= 2 * w && p.y >= -h && p.y <= 2 * h,
            (text, x, y) => ctx.fillText(text, x, y));
    }
}
