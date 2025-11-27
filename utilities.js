// utilities.js

const TILE_SIZE = 256;
const MAX_ZOOM = 19;
const R = 6378137; 

const toRad = deg => deg * Math.PI / 180;
const toDeg = rad => rad * 180 / Math.PI;

function letterToNumber(str) {
    if (!str || typeof str !== 'string') return 0;
    if (str.startsWith('-')) return -letterToNumber(str.substring(1));
    return str.toUpperCase().split('').reduce((acc, char) => acc * 26 + char.charCodeAt(0) - 64, 0);
}

function numberToLetter(num) {
    if (num < 0) return '-' + numberToLetter(-num);
    if (num === 0) return '';
    let letter = '';
    let tempNum = num;
    while (tempNum > 0) {
        const remainder = (tempNum - 1) % 26;
        letter = String.fromCharCode(65 + remainder) + letter;
        tempNum = Math.floor((tempNum - 1) / 26);
    }
    return letter;
}

function generateIndices(start, end) {
    const indices = [];
    if (start <= end) {
        for (let i = start; i <= end; i++) { if (i !== 0) indices.push(i); }
    } else {
        for (let i = start; i >= end; i--) { if (i !== 0) indices.push(i); }
    }
    return indices;
}

const getOffsetInCells = (n) => {
    if (n > 0) return n - 1;
    return n;
};

const getNextIndex = (n) => (n === -1 ? 1 : n + 1);

function calculateAndRotatePoint(colNumber, rowNumber, config, a1Lat, a1Lon) {
    const metersToLatDegrees = (meters) => meters / 111320;
    const metersToLonDegrees = (meters, lat) => meters / (111320 * Math.cos(toRad(lat)));

    const xOffsetMeters = (colNumber > 0 ? colNumber - 1 : colNumber) * config.scale;
    const yOffsetMeters = (rowNumber > 0 ? rowNumber - 1 : rowNumber) * config.scale;

    const finalYOffset = config.letteringDirection === 'ascending' ? yOffsetMeters : -yOffsetMeters;

    const unrotatedLon = a1Lon + metersToLonDegrees(xOffsetMeters, a1Lat);
    const unrotatedLat = a1Lat + metersToLatDegrees(finalYOffset);

    if (config.deviation === 0 || !config.deviation) {
        return [unrotatedLon, unrotatedLat];
    }

    const pivotLon = config.longitude;
    const pivotLat = config.latitude;
    const deviationRad = -toRad(config.deviation);

    const cartesianX = (unrotatedLon - pivotLon) * 111320 * Math.cos(toRad(pivotLat));
    const cartesianY = (unrotatedLat - pivotLat) * 111320;

    const rotatedX = cartesianX * Math.cos(deviationRad) - cartesianY * Math.sin(deviationRad);
    const rotatedY = cartesianX * Math.sin(deviationRad) + cartesianY * Math.cos(deviationRad);

    const finalLon = pivotLon + metersToLonDegrees(rotatedX, pivotLat);
    const finalLat = pivotLat + metersToLatDegrees(rotatedY);

    return [finalLon, finalLat];
}

function downloadFile(blob, fileName) {
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.style.display = 'none';
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
    document.body.removeChild(a);
}

function showError(message) {
    const errorDiv = document.getElementById("error-message");
    errorDiv.textContent = message;
    errorDiv.classList.remove("hidden");
    setTimeout(() => errorDiv.classList.add("hidden"), 5000);
}

function hideError() {
    document.getElementById("error-message").classList.add("hidden");
}

// --- DESSIN CADO PARTAGÉ ---

function drawLabelWithOutline(ctx, text, x, y, config) {
    const darkColorsForWhiteOutline = ['black', 'red', 'blue', 'green', 'violet', 'brown'];
    const outlineColor = darkColorsForWhiteOutline.includes(config.colorName) ? 'white' : 'black';
    ctx.strokeStyle = outlineColor;
    ctx.lineWidth = 3;
    ctx.strokeText(text, x, y);
    ctx.fillStyle = config.gridColor;
    ctx.fillText(text, x, y);
}

function drawSubdivisionKey(ctx, latLonToPixels, config, a1CornerCoords) {
    const [a1Lon, a1Lat] = a1CornerCoords;
    const startColNum = letterToNumber(config.startCol);
    const bottomRowNum = (config.letteringDirection === 'ascending') 
        ? Math.min(config.startRow, config.endRow) 
        : Math.max(config.startRow, config.endRow);
    const geo_bl = calculateAndRotatePoint(startColNum, bottomRowNum, config, a1Lat, a1Lon);
    const geo_br = calculateAndRotatePoint(startColNum + 1, bottomRowNum, config, a1Lat, a1Lon);
    const geo_tl = calculateAndRotatePoint(startColNum, bottomRowNum + 1, config, a1Lat, a1Lon);
    const geo_tr = calculateAndRotatePoint(startColNum + 1, bottomRowNum + 1, config, a1Lat, a1Lon);
    const geo_center = calculateAndRotatePoint(startColNum + 0.5, bottomRowNum + 0.5, config, a1Lat, a1Lon);
    const px_tl = latLonToPixels(geo_tl[1], geo_tl[0]);
    const px_tr = latLonToPixels(geo_tr[1], geo_tr[0]);
    const px_bl = latLonToPixels(geo_bl[1], geo_bl[0]);
    const px_br = latLonToPixels(geo_br[1], geo_br[0]);
    const px_center = latLonToPixels(geo_center[1], geo_center[0]);
    const opacity = '0.7';
    const drawSubdivision = (color, p1, p2, p3, p4) => {
        ctx.fillStyle = color;
        ctx.beginPath(); ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y); ctx.lineTo(p3.x, p3.y); ctx.lineTo(p4.x, p4.y); ctx.closePath(); ctx.fill();
    };
    drawSubdivision(`rgba(255, 255, 0, ${opacity})`, px_tl, {x: (px_tl.x + px_tr.x)/2, y: (px_tl.y + px_tr.y)/2}, px_center, {x: (px_tl.x + px_bl.x)/2, y: (px_tl.y + px_bl.y)/2});
    drawSubdivision(`rgba(0, 0, 255, ${opacity})`, {x: (px_tl.x + px_tr.x)/2, y: (px_tl.y + px_tr.y)/2}, px_tr, {x: (px_tr.x + px_br.x)/2, y: (px_tr.y + px_br.y)/2}, px_center);
    drawSubdivision(`rgba(0, 128, 0, ${opacity})`, {x: (px_tl.x + px_bl.x)/2, y: (px_tl.y + px_bl.y)/2}, px_center, {x: (px_bl.x + px_br.x)/2, y: (px_bl.y + px_br.y)/2}, px_bl);
    drawSubdivision(`rgba(255, 0, 0, ${opacity})`, px_center, {x: (px_tr.x + px_br.x)/2, y: (px_tr.y + px_br.y)/2}, px_br, {x: (px_bl.x + px_br.x)/2, y: (px_bl.y + px_br.y)/2});
    ctx.strokeStyle = 'black'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(px_tl.x, px_tl.y); ctx.lineTo(px_tr.x, px_tr.y); ctx.lineTo(px_br.x, px_br.y); ctx.lineTo(px_bl.x, px_bl.y); ctx.closePath();
    ctx.stroke();
}

function drawReferenceCross(ctx, latLonToPixels, config) {
    if (config.referencePointChoice !== 'center') return;
    const refPointCoords = { lat: config.latitude, lon: config.longitude };
    const center = latLonToPixels(refPointCoords.lat, refPointCoords.lon);
    const crossSize = 15;
    ctx.strokeStyle = '#FF0000';
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(center.x, center.y - crossSize); ctx.lineTo(center.x, center.y + crossSize); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(center.x - crossSize, center.y); ctx.lineTo(center.x + crossSize, center.y); ctx.stroke();
}

function drawCartouche(ctx, latLonToPixels, config, a1CornerCoords, cellWidthInPixels) {
    const [a1Lon, a1Lat] = a1CornerCoords;
    const startColNum = letterToNumber(config.startCol);
    const topRowNum = (config.letteringDirection === 'ascending') 
        ? Math.max(config.startRow, config.endRow) + 1 
        : Math.min(config.startRow, config.endRow);
    const anchorGeoPoint = calculateAndRotatePoint(startColNum, topRowNum, config, a1Lat, a1Lon);
    const anchorPixels = latLonToPixels(anchorGeoPoint[1], anchorGeoPoint[0]);
    const FONT_SIZE_RATIO = 0.15;
    const FONT_SIZE_PX = Math.max(12, cellWidthInPixels * FONT_SIZE_RATIO);
    const PADDING_RATIO = 0.5;
    const padding = FONT_SIZE_PX * PADDING_RATIO;
    const lineSpacing = FONT_SIZE_PX * 1.3;
    ctx.font = `${FONT_SIZE_PX}px Arial`;
    const refText = (config.referencePointChoice === 'center') ? `Pt. Réf: ${config.latitude.toFixed(5)}, ${config.longitude.toFixed(5)}` : '';
    const originText = `Origine A1: ${a1Lat.toFixed(5)}, ${a1Lon.toFixed(5)}`;
    const scaleText = `Échelle: 1 case = ${config.scale}m`;
    const textsToDraw = [config.gridNameBase];
    if (refText) textsToDraw.push(refText);
    textsToDraw.push(originText, scaleText);
    const maxTextWidth = Math.max(...textsToDraw.map(text => ctx.measureText(text).width));
    const cartoucheWidth = maxTextWidth + (padding * 2);
    const cartoucheHeight = (lineSpacing * textsToDraw.length) + (padding * 2);
    const cartoucheX = anchorPixels.x + padding;
    const cartoucheY = anchorPixels.y + padding;
    ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
    ctx.fillRect(cartoucheX, cartoucheY, cartoucheWidth, cartoucheHeight);
    ctx.strokeStyle = 'black';
    ctx.lineWidth = 1;
    ctx.strokeRect(cartoucheX, cartoucheY, cartoucheWidth, cartoucheHeight);
    ctx.fillStyle = 'black';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    let textY = cartoucheY + padding + (lineSpacing / 2);
    const refTextPattern = /^Pt\. Réf:/;
    for (const text of textsToDraw) {
        if (refTextPattern.test(text)) {
            const crossSize = FONT_SIZE_PX * 0.4;
            const crossX = cartoucheX + padding + crossSize;
            ctx.strokeStyle = '#FF0000'; ctx.lineWidth = 2; ctx.beginPath();
            ctx.moveTo(crossX - crossSize, textY); ctx.lineTo(crossX + crossSize, textY);
            ctx.moveTo(crossX, textY - crossSize); ctx.lineTo(crossX, textY + crossSize);
            ctx.stroke();
            ctx.fillStyle = 'black';
            ctx.fillText(text, crossX + crossSize + (padding / 2), textY);
        } else {
            ctx.fillText(text, cartoucheX + padding, textY);
        }
        textY += lineSpacing;
    }
}

function drawCompass(ctx, latLonToPixels, config, a1CornerCoords, cellWidthInPixels) {
    const [a1Lon, a1Lat] = a1CornerCoords;
    const endColNum = letterToNumber(config.endCol);
    const topRowNum = (config.letteringDirection === 'ascending') 
        ? Math.max(config.startRow, config.endRow) 
        : Math.min(config.startRow, config.endRow);
    const centerPoint = calculateAndRotatePoint(endColNum + 0.5, topRowNum + 0.5, config, a1Lat, a1Lon);
    const center = latLonToPixels(centerPoint[1], centerPoint[0]);
    const arrowLengthInMeters = config.scale * 0.35; 
    const northGeoPoint = { lat: centerPoint[1] + (arrowLengthInMeters / 111320), lon: centerPoint[0] };
    const northPixel = latLonToPixels(northGeoPoint.lat, northGeoPoint.lon);
    const arrowLengthInPixels = Math.hypot(northPixel.x - center.x, northPixel.y - center.y);
    const radius = arrowLengthInPixels * 1.2;
    ctx.beginPath();
    ctx.arc(center.x, center.y, radius, 0, 2 * Math.PI, false);
    ctx.fillStyle = 'rgba(200, 200, 200, 0.7)';
    ctx.fill();
    const angle = Math.atan2(northPixel.y - center.y, northPixel.x - center.x);
    const N_point = { x: center.x + arrowLengthInPixels * Math.cos(angle), y: center.y + arrowLengthInPixels * Math.sin(angle) };
    const base_point = { x: center.x - (arrowLengthInPixels * 0.3) * Math.cos(angle), y: center.y - (arrowLengthInPixels * 0.3) * Math.sin(angle) };
    ctx.beginPath();
    ctx.moveTo(base_point.x, base_point.y);
    ctx.lineTo(N_point.x, N_point.y);
    ctx.strokeStyle = 'red'; ctx.lineWidth = 3; ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(N_point.x, N_point.y);
    ctx.lineTo(N_point.x - 10 * Math.cos(angle + 0.3), N_point.y - 10 * Math.sin(angle + 0.3));
    ctx.lineTo(N_point.x - 10 * Math.cos(angle - 0.3), N_point.y - 10 * Math.sin(angle - 0.3));
    ctx.closePath();
    ctx.fillStyle = 'red'; ctx.fill();
    const compassNFontSize = cellWidthInPixels * 0.25;
    ctx.font = `bold ${compassNFontSize}px Arial`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
    ctx.strokeStyle = 'white'; ctx.lineWidth = 3;
    ctx.strokeText('N', N_point.x, N_point.y + 2);
    ctx.fillStyle = 'black';
    ctx.fillText('N', N_point.x, N_point.y + 2);
}

function drawCadoElementsOnCanvas(ctx, config, latLonToPixels, a1CornerCoords) {
    const [a1Lon, a1Lat] = a1CornerCoords;
    const startColNum = letterToNumber(config.startCol);
    const endColNum = letterToNumber(config.endCol);
    const startRowNum = config.startRow;
    const endRowNum = config.endRow;

    const colsToDraw = generateIndices(startColNum, endColNum);
    const rowsToDraw = generateIndices(startRowNum, endRowNum);

    if (colsToDraw.length === 0 || rowsToDraw.length === 0) return;

    ctx.strokeStyle = config.gridColor;
    ctx.lineWidth = config.lineWidth || 1;
    
    const colsForLines = [...colsToDraw, getNextIndex(colsToDraw[colsToDraw.length - 1])];
    const rowsForLines = [...rowsToDraw, getNextIndex(rowsToDraw[rowsToDraw.length - 1])];

    colsForLines.forEach(colNum => {
        const startPoint = calculateAndRotatePoint(colNum, rowsForLines[0], config, a1Lat, a1Lon);
        const endPoint = calculateAndRotatePoint(colNum, rowsForLines[rowsForLines.length - 1], config, a1Lat, a1Lon);
        const startPixels = latLonToPixels(startPoint[1], startPoint[0]);
        const endPixels = latLonToPixels(endPoint[1], endPoint[0]);
        ctx.beginPath(); ctx.moveTo(startPixels.x, startPixels.y); ctx.lineTo(endPixels.x, endPixels.y); ctx.stroke();
    });

    rowsForLines.forEach(rowNum => {
        const startPoint = calculateAndRotatePoint(colsForLines[0], rowNum, config, a1Lat, a1Lon);
        const endPoint = calculateAndRotatePoint(colsForLines[colsForLines.length - 1], rowNum, config, a1Lat, a1Lon);
        const startPixels = latLonToPixels(startPoint[1], startPoint[0]);
        const endPixels = latLonToPixels(endPoint[1], endPoint[0]);
        ctx.beginPath(); ctx.moveTo(startPixels.x, startPixels.y); ctx.lineTo(endPixels.x, endPixels.y); ctx.stroke();
    });
    
    const geo_A1_center = calculateAndRotatePoint(startColNum + 0.5, startRowNum + 0.5, config, a1Lat, a1Lon);
    const geo_B1_center = calculateAndRotatePoint(startColNum + 1.5, startRowNum + 0.5, config, a1Lat, a1Lon);
    const px_A1_center = latLonToPixels(geo_A1_center[1], geo_A1_center[0]);
    const px_B1_center = latLonToPixels(geo_B1_center[1], geo_B1_center[0]);
    const cellWidthInPixels = Math.hypot(px_B1_center.x - px_A1_center.x, px_B1_center.y - px_A1_center.y);
    
    const labelFontSize = cellWidthInPixels * 0.75;
    if (labelFontSize > 5) { 
        ctx.font = `bold ${labelFontSize}px Arial`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        for (const i of colsToDraw) {
            const labelPoint = calculateAndRotatePoint(i + 0.5, startRowNum - 0.5, config, a1Lat, a1Lon);
            const labelPixels = latLonToPixels(labelPoint[1], labelPoint[0]);
            drawLabelWithOutline(ctx, numberToLetter(i), labelPixels.x, labelPixels.y, config);
        }

        for (const i of rowsToDraw) {
            const labelPoint = calculateAndRotatePoint(startColNum - 0.5, i + 0.5, config, a1Lat, a1Lon);
            const labelPixels = latLonToPixels(labelPoint[1], labelPoint[0]);
            drawLabelWithOutline(ctx, i.toString(), labelPixels.x, labelPixels.y, config);
        }
    }
        
    drawSubdivisionKey(ctx, latLonToPixels, config, a1CornerCoords);
    drawCartouche(ctx, latLonToPixels, config, a1CornerCoords, cellWidthInPixels);
    drawCompass(ctx, latLonToPixels, config, a1CornerCoords, cellWidthInPixels);
    drawReferenceCross(ctx, latLonToPixels, config);
}