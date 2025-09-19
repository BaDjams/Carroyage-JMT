// zoneDownloader.js

const ZD_TILE_SIZE = 256;
let loadedZoneKmlFeatures = []; // Pour stocker les données du KMZ
let kmlResources = { images: {} }; // Pour stocker les icônes chargées depuis le KMZ

// --- Fonctions de projection (partagées) ---
function zdCoordsToQuadKey(x, y, zoom) {
    let quadKey = '';
    for (let i = zoom; i > 0; i--) {
        let digit = 0;
        const mask = 1 << (i - 1);
        if ((y & mask) !== 0) { digit += 2; }
        if ((x & mask) !== 0) { digit += 1; }
        quadKey += digit.toString();
    }
    return quadKey;
}

function zdLatLonToWorldPixels(lat, lon, zoom) {
    const siny = Math.sin(toRad(lat));
    const yClamped = Math.max(Math.min(siny, 0.9999), -0.9999);
    const y = 0.5 - Math.log((1 + yClamped) / (1 - yClamped)) / (4 * Math.PI);
    const x = (lon + 180) / 360;
    const mapSize = ZD_TILE_SIZE * Math.pow(2, zoom);
    return { x: x * mapSize, y: y * mapSize };
}

/**
 * Fonction principale qui orchestre la création de l'image de la zone.
 */
async function generateZonePNG() {
    const loadingIndicator = document.getElementById("loading-indicator");
    const loadingMessage = document.getElementById("loading-message");

    loadingMessage.textContent = "Préparation de l'export de la zone...";
    loadingIndicator.classList.remove("hidden");
    hideError();

    try {
        const nwCoordsStr = document.getElementById("zone-nw-coords").value;
        const seCoordsStr = document.getElementById("zone-se-coords").value;
        if (!nwCoordsStr || !seCoordsStr) throw new Error("Veuillez d'abord dessiner une zone rectangulaire sur la carte.");

        const [north, west] = nwCoordsStr.split(',').map(c => parseFloat(c.trim()));
        const [south, east] = seCoordsStr.split(',').map(c => parseFloat(c.trim()));

        const title = document.getElementById("zone-title").value || "Export de zone";
        const zoom = parseInt(document.getElementById("zone-info-zoom").textContent, 10);
        const mapLayerName = document.getElementById("zone-info-layer").textContent;
        
        const selectedMap = MAP_LAYERS.find(m => m.name === mapLayerName);
        if (!selectedMap) throw new Error("Impossible de trouver la configuration du fond de carte.");
        
        const format = document.querySelector('input[name="image-format-zone"]:checked').value;
        const quality = parseInt(document.getElementById('zone-jpeg-quality').value) / 100;
        const mimeType = format === 'jpeg' ? 'image/jpeg' : 'image/png';
        const fileExtension = format === 'jpeg' ? '.jpg' : '.png';

        const boundingBox = { north, west, south, east };

        loadingMessage.textContent = "Téléchargement des fonds de carte...";
        const { finalCanvas } = await zdCreateFinalCanvas(boundingBox, zoom, selectedMap);
        const ctx = finalCanvas.getContext('2d');
        // --- NOUVELLE ÉTAPE : DESSIN DU KML ---
        if (loadedZoneKmlFeatures.length > 0) {
            loadingMessage.textContent = "Dessin des éléments KML...";
            drawZoneKmlFeatures(ctx, boundingBox, zoom, loadedZoneKmlFeatures);
        }
        // --- FIN DE LA NOUVELLE ÉTAPE ---
		loadingMessage.textContent = "Finalisation de l'image...";
		drawZoneCartouche(ctx, title, boundingBox, mapLayerName, zoom);
        drawZoneCompass(ctx, finalCanvas.width, finalCanvas.height);

        const fileName = `${title.replace(/[^a-z0-9]/gi, '_')}_${mapLayerName}_z${zoom}${fileExtension}`;
        finalCanvas.toBlob((blob) => {
            if (blob) {
                downloadFile(blob, fileName);
            } else {
                showError("Erreur lors de la création du fichier image.");
            }
        }, mimeType, quality);

    } catch (error) {
        console.error("Erreur lors de la génération de l'image de zone :", error);
        showError(error.message);
    } finally {
        loadingIndicator.classList.add("hidden");
    }
}

/**
 * Crée le canevas final et y assemble les tuiles pour la zone sélectionnée.
 */
async function zdCreateFinalCanvas(boundingBox, zoom, mapConfig) {
    const nwPixel = zdLatLonToWorldPixels(boundingBox.north, boundingBox.west, zoom);
    const sePixel = zdLatLonToWorldPixels(boundingBox.south, boundingBox.east, zoom);

    const canvasWidth = Math.abs(sePixel.x - nwPixel.x);
    const canvasHeight = Math.abs(sePixel.y - nwPixel.y);

    const finalCanvas = document.createElement('canvas');
    finalCanvas.width = canvasWidth;
    finalCanvas.height = canvasHeight;
    const ctx = finalCanvas.getContext('2d');

    const nwTile = { x: Math.floor(nwPixel.x / ZD_TILE_SIZE), y: Math.floor(nwPixel.y / ZD_TILE_SIZE) };
    const seTile = { x: Math.floor(sePixel.x / ZD_TILE_SIZE), y: Math.floor(sePixel.y / ZD_TILE_SIZE) };
    
    for (const layer of mapConfig.layers) {
        const tilePromises = [];
        for (let x = nwTile.x; x <= seTile.x; x++) {
            for (let y = nwTile.y; y <= seTile.y; y++) {
                let tileUrl;
                if (layer.type === 'quadkey') {
                    const quadKey = zdCoordsToQuadKey(x, y, zoom);
                    const subdomain = (x + y) % 4;
                    tileUrl = layer.url.replace('{q}', quadKey).replace('{s}', subdomain);
                } else {
                    tileUrl = layer.url.replace('{z}', zoom).replace('{x}', x).replace('{y}', y);
                }
                
                const promise = new Promise((resolve) => {
                    const img = new Image();
                    img.crossOrigin = "Anonymous";
                    img.onload = () => resolve({ img, x, y, success: true });
                    img.onerror = () => resolve({ success: false });
                    img.src = tileUrl;
                });
                tilePromises.push(promise);
            }
        }
        const resolvedTiles = await Promise.all(tilePromises);
        resolvedTiles.forEach(tileResult => {
            if (tileResult.success) {
                const tileX = (tileResult.x * ZD_TILE_SIZE) - nwPixel.x;
                const tileY = (tileResult.y * ZD_TILE_SIZE) - nwPixel.y;
                ctx.drawImage(tileResult.img, Math.round(tileX), Math.round(tileY));
            }
        });
    }

    return { finalCanvas };
}

/**
 * Dessine le cartouche d'information pour l'export de zone.
 */
function drawZoneCartouche(ctx, title, bbox, layerName, zoom) {
    // [MODIFIÉ] Taille de la police augmentée d'un facteur 1.5.
    const FONT_SIZE = Math.max(10, Math.min(48, ctx.canvas.width * 0.007));
    const PADDING = FONT_SIZE;
    const lineSpacing = FONT_SIZE * 1.3;

    const texts = [
        title,
        `Point NO: ${bbox.north.toFixed(5)}, ${bbox.west.toFixed(5)}`,
        `Point SE: ${bbox.south.toFixed(5)}, ${bbox.east.toFixed(5)}`,
        `Fond: ${layerName} (Zoom ${zoom})`
    ];

    ctx.font = `${FONT_SIZE}px Arial`;
    const cartoucheWidth = Math.max(...texts.map(text => ctx.measureText(text).width)) + (PADDING * 2);
    const cartoucheHeight = (lineSpacing * texts.length) - (lineSpacing - FONT_SIZE) + (PADDING * 2);

    const cartoucheX = PADDING;
    const cartoucheY = PADDING;

    ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
    ctx.fillRect(cartoucheX, cartoucheY, cartoucheWidth, cartoucheHeight);
    ctx.strokeStyle = 'black';
    ctx.lineWidth = 1;
    ctx.strokeRect(cartoucheX, cartoucheY, cartoucheWidth, cartoucheHeight);
    
    ctx.fillStyle = 'black';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    
    let textY = cartoucheY + PADDING;
    for (const text of texts) {
        ctx.fillText(text, cartoucheX + PADDING, textY);
        textY += lineSpacing;
    }
}

/**
 * Dessine une boussole simple (flèche Nord).
 */
function drawZoneCompass(ctx, canvasWidth, canvasHeight) {
    // [MODIFIÉ] Taille de la boussole augmentée d'un facteur 1.5.
    const radius = Math.max(30, Math.min(90, canvasWidth * 0.0200));
    // [MODIFIÉ] Marge augmentée pour éloigner la boussole du bord.
    const PADDING = radius * 1.8;

    const centerX = canvasWidth - PADDING;
    const centerY = PADDING;
    
    // Cercle de fond
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius, 0, 2 * Math.PI);
    ctx.fillStyle = 'rgba(200, 200, 200, 0.7)';
    ctx.fill();

    // Flèche
    const arrowLength = radius / 1.2;
    const N_point = { x: centerX, y: centerY - arrowLength };
    const base_point = { x: centerX, y: centerY + (arrowLength * 0.3) };

    ctx.beginPath();
    ctx.moveTo(base_point.x, base_point.y);
    ctx.lineTo(N_point.x, N_point.y);
    ctx.strokeStyle = 'red'; ctx.lineWidth = 3; ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(N_point.x, N_point.y);
    // Les dimensions de la tête de flèche sont relatives au rayon pour bien s'adapter
    const arrowHeadSize = radius * 0.25;
    ctx.lineTo(N_point.x - arrowHeadSize, N_point.y + arrowHeadSize);
    ctx.lineTo(N_point.x + arrowHeadSize, N_point.y + arrowHeadSize);
    ctx.closePath();
    ctx.fillStyle = 'red'; ctx.fill();

    // Lettre 'N'
    const compassNFontSize = radius * 0.6;
    ctx.font = `bold ${compassNFontSize}px Arial`;
    ctx.textAlign = 'center'; 
    ctx.textBaseline = 'bottom';
    ctx.strokeStyle = 'white'; 
    ctx.lineWidth = 3;
    ctx.strokeText('N', N_point.x, N_point.y);
    ctx.fillStyle = 'black';
    ctx.fillText('N', N_point.x, N_point.y);
}

// =======================================================================
// SECTION 1 : FONCTIONS DE PARSING KML (FORTEMENT AMÉLIORÉES)
// =======================================================================

/**
 * Orchestrateur principal pour la gestion du fichier KML/KMZ.
 * @param {Event} event L'événement de changement du champ de fichier.
 */
async function handleZoneKmzFile(event) {
    const file = event.target.files[0];
    loadedZoneKmlFeatures = [];
    kmlResources = { images: {} };
    if (!file) return;

    try {
        const loadingMessage = document.getElementById("loading-message");
        loadingMessage.textContent = "Lecture du fichier KML/KMZ...";
        document.getElementById("loading-indicator").classList.remove("hidden");

        const zip = file.name.toLowerCase().endsWith('.kmz') ? await JSZip.loadAsync(file) : null;
        const kmlFile = zip ? zip.file(/(\.kml)$/i)[0] : null;
        
        if (zip && !kmlFile) throw new Error("Aucun fichier KML trouvé dans le KMZ.");
        
        const kmlText = zip ? await kmlFile.async("string") : await file.text();
        const parser = new DOMParser();
        const kmlDoc = parser.parseFromString(kmlText, "text/xml");

        // Étape 1: Parser tous les styles partagés du document
        const sharedStyles = parseSharedKmlStyles(kmlDoc);

        // Étape 2: Parser les placemarks en utilisant les styles partagés
        const placemarksData = parseKmlPlacemarksFromDoc(kmlDoc, sharedStyles);

        // Étape 3: Charger les icônes requises depuis le fichier KMZ
        if (zip) {
            loadingMessage.textContent = "Chargement des icônes...";
            await loadKmlIcons(placemarksData, zip);
        }

        loadedZoneKmlFeatures = placemarksData;
        alert(`${loadedZoneKmlFeatures.length} élément(s) KML ont été chargé(s) avec succès.`);

    } catch (error) {
        console.error("Erreur lors du chargement du fichier KML/KMZ:", error);
        showError("Impossible de lire le fichier. " + error.message);
        loadedZoneKmlFeatures = [];
        kmlResources = { images: {} };
    } finally {
        document.getElementById("loading-indicator").classList.add("hidden");
    }
}

/**
 * Parse les balises <Style> et <StyleMap> partagées dans le document KML.
 * @param {XMLDocument} kmlDoc
 * @returns {Object} Un dictionnaire des styles partagés.
 */
function parseSharedKmlStyles(kmlDoc) {
    const styles = {};
    const styleElements = kmlDoc.querySelectorAll('Document > Style, Document > StyleMap');

    styleElements.forEach(styleEl => {
        const styleId = '#' + styleEl.getAttribute('id');
        if (styleEl.tagName === 'StyleMap') {
            const normalPair = Array.from(styleEl.querySelectorAll('Pair')).find(
                p => p.querySelector('key')?.textContent === 'normal'
            );
            const styleUrl = normalPair?.querySelector('styleUrl')?.textContent;
            if (styleUrl) {
                // Pour l'instant, on lie juste le StyleMap à l'URL du style normal
                 styles[styleId] = { isMap: true, normalUrl: styleUrl };
            }
        } else {
            styles[styleId] = parseStyleElement(styleEl);
        }
    });

    // Résoudre les références des StyleMap
    Object.values(styles).forEach(style => {
        if (style.isMap && styles[style.normalUrl]) {
            Object.assign(style, styles[style.normalUrl]);
        }
    });

    return styles;
}

/**
 * Parse une seule balise <Style> et retourne un objet de style.
 * @param {Element} styleEl L'élément <Style> à parser.
 * @returns {Object} Un objet contenant les propriétés de style.
 */
function parseStyleElement(styleEl) {
    const style = {};
    const iconStyle = styleEl.querySelector('IconStyle');
    const labelStyle = styleEl.querySelector('LabelStyle');
    const lineStyle = styleEl.querySelector('LineStyle');
    const polyStyle = styleEl.querySelector('PolyStyle');

    if (iconStyle) {
        style.iconUrl = iconStyle.querySelector('Icon > href')?.textContent || null;
        style.iconScale = parseFloat(iconStyle.querySelector('scale')?.textContent || 1.0);
    }
    if (labelStyle) {
        style.labelColor = kmlColorToCss(labelStyle.querySelector('color')?.textContent || 'ffffffff');
        style.labelScale = parseFloat(labelStyle.querySelector('scale')?.textContent || 1.0);
    }
    if (lineStyle) {
        style.lineColor = kmlColorToCss(lineStyle.querySelector('color')?.textContent || 'ff0000ff'); // Rouge par défaut
        style.lineWidth = parseFloat(lineStyle.querySelector('width')?.textContent || 2);
    }
    if (polyStyle) {
        style.polyColor = kmlColorToCss(polyStyle.querySelector('color')?.textContent || 'ff0000ff'); // Rouge par défaut
        // La balise <fill> contient 1 (vrai) or 0 (faux)
        style.polyFill = polyStyle.querySelector('fill')?.textContent !== '0';
        // La balise <outline> contient 1 (vrai) or 0 (faux)
        style.polyOutline = polyStyle.querySelector('outline')?.textContent !== '0';
    }
    return style;
}

/**
 * Extrait les Placemarks et leur associe leur style (partagé ou en ligne).
 * @param {XMLDocument} kmlDoc
 * @param {Object} sharedStyles
 * @returns {Array}
 */
function parseKmlPlacemarksFromDoc(kmlDoc, sharedStyles) {
    const features = [];
    kmlDoc.querySelectorAll('Placemark').forEach(placemark => {
        const name = placemark.querySelector('name')?.textContent || '';
        let style = {};

        const styleUrl = placemark.querySelector('styleUrl')?.textContent;
        const inlineStyleEl = placemark.querySelector('Style');

        if (styleUrl && sharedStyles[styleUrl]) {
            style = sharedStyles[styleUrl];
        } else if (inlineStyleEl) {
            style = parseStyleElement(inlineStyleEl);
        }

        // ... (le reste du parsing de géométrie reste identique)
        const point = placemark.getElementsByTagName('Point')[0];
        // ... (idem pour LineString et Polygon)

        if (point) {
            const coordsStr = point.getElementsByTagName('coordinates')[0]?.textContent.trim();
            if (coordsStr) {
                const [lon, lat] = coordsStr.split(',').map(parseFloat);
                features.push({ type: 'Point', name, style, coordinates: [lon, lat] });
            }
        } 
        // ...
    });
    return features;
}

/**
 * Charge les images des icônes depuis le fichier ZIP.
 * @param {Array} placemarksData
 * @param {JSZip} zip
 */
async function loadKmlIcons(placemarksData, zip) {
    const iconPromises = [];
    const loadedUrls = new Set();

    placemarksData.forEach(feature => {
        if (feature.type === 'Point' && feature.style?.iconUrl && !loadedUrls.has(feature.style.iconUrl)) {
            const iconUrl = feature.style.iconUrl;
            loadedUrls.add(iconUrl);

            let promise;

            // NOUVEAU : Gère les URL web et les chemins locaux différemment
            if (iconUrl.startsWith('http')) {
                // C'est une URL web
                promise = new Promise((resolve) => {
                    const img = new Image();
                    // Indispensable pour que le canvas ne soit pas "contaminé" par une ressource externe
                    img.crossOrigin = "Anonymous";
                    img.onload = () => {
                        kmlResources.images[iconUrl] = img;
                        resolve();
                    };
                    img.onerror = () => {
                        console.warn(`Impossible de charger l'icône depuis l'URL: ${iconUrl}`);
                        resolve(); // On résout pour ne pas bloquer les autres images
                    };
                    img.src = iconUrl;
                });
            } else if (zip) {
                // C'est un chemin local dans le KMZ
                const iconFile = zip.file(iconUrl);
                if (iconFile) {
                    promise = iconFile.async('base64').then(base64 => {
                        return new Promise((resolve) => {
                            const img = new Image();
                            img.onload = () => {
                                kmlResources.images[iconUrl] = img;
                                resolve();
                            };
                            img.onerror = () => resolve();
                            img.src = 'data:image/png;base64,' + base64;
                        });
                    });
                }
            }

            if (promise) {
                iconPromises.push(promise);
            }
        }
    });
    await Promise.all(iconPromises);
}


/**
 * Convertit une couleur KML (aabbggrr) en format CSS (rgba).
 * @param {string} kmlColor
 * @returns {string}
 */
function kmlColorToCss(kmlColor) {
    if (!kmlColor || kmlColor.length !== 8) return 'rgba(255,255,255,1)';
    const a = parseInt(kmlColor.substring(0, 2), 16) / 255;
    const b = kmlColor.substring(2, 4);
    const g = kmlColor.substring(4, 6);
    const r = kmlColor.substring(6, 8);
    return `rgba(${parseInt(r, 16)}, ${parseInt(g, 16)}, ${parseInt(b, 16)}, ${a})`;
}

function getContrastingOutlineColor(rgbaColor) {
    // Si la couleur n'est pas valide, retourne du noir par sécurité
    if (!rgbaColor || !rgbaColor.startsWith('rgba')) return 'black';

    // Extrait les composantes r, g, b de la chaîne "rgba(r, g, b, a)"
    try {
        const [r, g, b] = rgbaColor.match(/\d+/g).map(Number);
        
        // Calcule la "luminance" de la couleur. C'est une mesure de sa clarté perçue.
        // La formule utilise des poids standards pour chaque couleur.
        const luminance = (0.299 * r + 0.587 * g + 0.114 * b);

        // Si la luminance est supérieure à un certain seuil (ici 186), la couleur est considérée
        // comme claire, donc on utilise un contour noir. Sinon, un contour blanc.
        return luminance > 186 ? 'black' : 'white';

    } catch (e) {
        return 'black'; // Fallback
    }
}
// =======================================================================
// SECTION 2 : FONCTION DE DESSIN SUR CANVAS (FORTEMENT AMÉLIORÉE)
// =======================================================================

/**
 * Dessine les features KML sur le canvas fourni, en utilisant les styles extraits.
 * @param {CanvasRenderingContext2D} ctx Le contexte 2D du canvas.
 * @param {object} boundingBox La bounding box de la zone {north, west, south, east}.
 * @param {number} zoom Le niveau de zoom de la carte.
 * @param {Array} features Les features KML à dessiner.
 */
function drawZoneKmlFeatures(ctx, boundingBox, zoom, features) {
    const nwPixel = zdLatLonToWorldPixels(boundingBox.north, boundingBox.west, zoom);
    const latLonToCanvasPixels = (lat, lon) => {
        const worldPixels = zdLatLonToWorldPixels(lat, lon, zoom);
        return { x: worldPixels.x - nwPixel.x, y: worldPixels.y - nwPixel.y };
    };

    features.forEach(feature => {
        const style = feature.style || {};

        if (feature.type === 'Point') {
            const center = latLonToCanvasPixels(feature.coordinates[1], feature.coordinates[0]);
            const iconImg = style.iconUrl ? kmlResources.images[style.iconUrl] : null;

            let iconHeight = 32; // Hauteur par défaut pour le positionnement du texte

            if (iconImg && iconImg.complete && iconImg.naturalWidth > 0) {
                const scale = style.iconScale || 1.0;
                const w = iconImg.naturalWidth * scale;
                const h = iconImg.naturalHeight * scale;
                iconHeight = h; // Utilise la hauteur réelle de l'icône
                ctx.drawImage(iconImg, center.x - w / 2, center.y - h / 2, w, h);
            } else {
                // Fallback
                ctx.beginPath();
                ctx.arc(center.x, center.y, 6, 0, 2 * Math.PI, false);
                ctx.fillStyle = '#f0e100';
                ctx.fill();
                ctx.lineWidth = 2;
                ctx.strokeStyle = 'black';
                ctx.stroke();
            }

            if (feature.name) {
                const textYOffset = (iconHeight / 2) + 5; // Positionne le texte juste sous l'icône
                const labelColor = style.labelColor || 'rgba(0, 0, 0, 1)'; 
                const outlineColor = getContrastingOutlineColor(labelColor);

                ctx.font = `bold ${16 * (style.labelScale || 1.0)}px Arial`;
                ctx.textAlign = 'center';
                ctx.textBaseline = 'top';
                
                ctx.strokeStyle = outlineColor;
                ctx.lineWidth = 3;
                ctx.strokeText(feature.name, center.x, center.y + textYOffset);

                ctx.fillStyle = labelColor;
                ctx.fillText(feature.name, center.x, center.y + textYOffset);
            }
         

        } 
		// --- PARTIE 2 : LIGNES ---
        else if (feature.type === 'LineString' && feature.coordinates.length > 1) {
            ctx.strokeStyle = style.lineColor || 'rgba(255, 0, 0, 1)'; // Rouge par défaut
            ctx.lineWidth = style.lineWidth || 2;
            ctx.beginPath();
            feature.coordinates.forEach((coord, index) => {
                const px = latLonToCanvasPixels(coord[1], coord[0]);
                if (index === 0) ctx.moveTo(px.x, px.y);
                else ctx.lineTo(px.x, px.y);
            });
            ctx.stroke();
        } 
        
        // --- PARTIE 3 : POLYGONES ---
        else if (feature.type === 'Polygon' && feature.coordinates.length > 2) {
            ctx.beginPath();
            feature.coordinates.forEach((coord, index) => {
                const px = latLonToCanvasPixels(coord[1], coord[0]);
                if (index === 0) ctx.moveTo(px.x, px.y);
                else ctx.lineTo(px.x, px.y);
            });
            ctx.closePath();

            // Remplissage du polygone (si activé dans le KML)
            if (style.polyFill !== false) { // Vrai par défaut
                ctx.fillStyle = style.polyColor || 'rgba(255, 0, 0, 0.5)';
                ctx.fill();
            }

            // Contour du polygone (si activé dans le KML)
            if (style.polyOutline !== false) { // Vrai par défaut
                ctx.strokeStyle = style.lineColor || 'rgba(255, 0, 0, 1)';
                ctx.lineWidth = style.lineWidth || 2;
                ctx.stroke();
            }
        }
    });
}