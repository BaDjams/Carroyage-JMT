// seedManager.js
// Encode / restaure les paramètres clés de la session CADO dans un code SEED compact (binaire → base64).
// Format : 8 octets → 11 caractères base64 (sans padding).

// Types de grille dans l'ordre d'index (3 bits → 8 valeurs max)
const SEED_GRID_TYPES = ['Q12', 'Z18', 'Q9', 'Z14', 'Z26', 'custom'];

// ----------------------------------------------------------------
// Génération du SEED (binaire compact)
// ----------------------------------------------------------------
// Disposition des bits (8 octets = 64 bits, 4 bits de padding à la fin) :
//   bits  0-20 (21 bits) : latInt  = round((lat+90)  × 10000)  → précision ~11m
//   bits 21-42 (22 bits) : lonInt  = round((lon+180) × 10000)  → précision ~11m
//   bits 43-52 (10 bits) : scale   = round(scale / 10)         → pas 10 m, max 10230 m
//   bits 53-55  (3 bits) : gridType index (cf. SEED_GRID_TYPES)
//   bit  56              : swapAxes
//   bit  57              : doubleEntry
//   bit  58              : letteringDir (1 = ascending)
//   bit  59              : referencePoint (1 = center)
//   bits 60-63  (4 bits) : padding zéro

function generateSeed() {
    try {
        const decStr = document.getElementById('decimal-coords')?.value.trim() || '';
        const parts  = decStr.split(',').map(s => parseFloat(s.trim()));
        const lat = parts[0] || 0;
        const lon = parts[1] || 0;

        const scale        = parseFloat(document.getElementById('scale')?.value || 20);
        const gridTypeVal  = document.querySelector('input[name="grid-type"]:checked')?.value || 'Q12';
        const swapAxes     = document.getElementById('swap-axes')?.checked     ? 1 : 0;
        const doubleEntry  = document.getElementById('double-entry')?.checked  ? 1 : 0;
        const letteringDir = document.querySelector('input[name="lettering-direction"]:checked')?.value === 'ascending' ? 1 : 0;
        const refPoint     = document.querySelector('input[name="reference-point"]:checked')?.value === 'center' ? 1 : 0;

        const latInt      = Math.max(0, Math.min(1800000, Math.round((lat  +  90) * 10000))); // 21 bits
        const lonInt      = Math.max(0, Math.min(3600000, Math.round((lon  + 180) * 10000))); // 22 bits
        const scaleInt    = Math.max(0, Math.min(1023,    Math.round(scale / 10)));            // 10 bits
        const gridTypeIdx = Math.max(0, SEED_GRID_TYPES.indexOf(gridTypeVal)) & 0x07;          //  3 bits

        const b = new Uint8Array(8);

        // Octet 0 : latInt bits 0-7
        b[0] = latInt & 0xFF;
        // Octet 1 : latInt bits 8-15
        b[1] = (latInt >> 8) & 0xFF;
        // Octet 2 : latInt bits 16-20 (5 bits) | lonInt bits 0-2 (3 bits)
        b[2] = ((latInt >> 16) & 0x1F) | ((lonInt & 0x07) << 5);
        // Octet 3 : lonInt bits 3-10
        b[3] = (lonInt >> 3) & 0xFF;
        // Octet 4 : lonInt bits 11-18
        b[4] = (lonInt >> 11) & 0xFF;
        // Octet 5 : lonInt bits 19-21 (3 bits) | scaleInt bits 0-4 (5 bits)
        b[5] = ((lonInt >> 19) & 0x07) | ((scaleInt & 0x1F) << 3);
        // Octet 6 : scaleInt bits 5-9 (5 bits) | gridTypeIdx bits 0-2 (3 bits)
        b[6] = ((scaleInt >> 5) & 0x1F) | (gridTypeIdx << 5);
        // Octet 7 : flags (swapAxes | doubleEntry<<1 | letteringDir<<2 | refPoint<<3)
        b[7] = swapAxes | (doubleEntry << 1) | (letteringDir << 2) | (refPoint << 3);

        return btoa(String.fromCharCode(...b)).replace(/=/g, '');
    } catch(e) {
        console.error('SEED generation error:', e);
        return null;
    }
}

// ----------------------------------------------------------------
// Restauration du SEED
// ----------------------------------------------------------------
function restoreSeed(seed) {
    try {
        const padded = seed + '=='.slice(0, (4 - seed.length % 4) % 4);
        const bin    = atob(padded);
        const b      = new Uint8Array(bin.length).map((_, i) => bin.charCodeAt(i));

        if (b.length < 8) throw new Error('SEED trop court (format invalide).');

        // Décodage
        const latInt      = b[0] | (b[1] << 8) | ((b[2] & 0x1F) << 16);
        const lonInt      = ((b[2] >> 5) & 0x07) | (b[3] << 3) | (b[4] << 11) | ((b[5] & 0x07) << 19);
        const scaleInt    = ((b[5] >> 3) & 0x1F) | ((b[6] & 0x1F) << 5);
        const gridTypeIdx = (b[6] >> 5) & 0x07;
        const swapAxes    =  b[7]       & 1;
        const doubleEntry = (b[7] >> 1) & 1;
        const letteringDir= (b[7] >> 2) & 1;
        const refPoint    = (b[7] >> 3) & 1;

        const lat      = latInt  / 10000 - 90;
        const lon      = lonInt  / 10000 - 180;
        const scale    = scaleInt * 10;
        const gridType = SEED_GRID_TYPES[gridTypeIdx] || 'Q12';

        // Coordonnées
        const coordEl = document.getElementById('decimal-coords');
        if (coordEl) coordEl.value = `${lat.toFixed(4)}, ${lon.toFixed(4)}`;
        if (typeof updateAllFromDecimal === 'function') updateAllFromDecimal(lat, lon);
        if (window.cadoMap) window.cadoMap.setView([lat, lon], 15);

        // Échelle
        const scaleEl = document.getElementById('scale');
        if (scaleEl) scaleEl.value = scale;

        // Type de grille
        const gtEl = document.querySelector(`input[name="grid-type"][value="${gridType}"]`);
        if (gtEl) {
            gtEl.checked = true;
            const customOpts = document.getElementById('custom-grid-options');
            if (customOpts) customOpts.classList.toggle('hidden', gridType !== 'custom');
        }

        // Axes
        const swEl = document.getElementById('swap-axes');
        if (swEl) swEl.checked = !!swapAxes;

        // Double entrée
        const deEl = document.getElementById('double-entry');
        if (deEl) deEl.checked = !!doubleEntry;

        // Direction lettrage
        const ldEl = document.querySelector(`input[name="lettering-direction"][value="${letteringDir ? 'ascending' : 'descending'}"]`);
        if (ldEl) ldEl.checked = true;

        // Point de référence
        const rpEl = document.querySelector(`input[name="reference-point"][value="${refPoint ? 'center' : 'origin'}"]`);
        if (rpEl) rpEl.checked = true;

        if (typeof updateDynamicGridName  === 'function') updateDynamicGridName();
        if (typeof updateCadoGridPreview  === 'function') updateCadoGridPreview();

        return true;
    } catch(e) {
        console.error('SEED restore error:', e);
        alert('Code SEED invalide ou corrompu : ' + e.message);
        return false;
    }
}

// ----------------------------------------------------------------
// Mise à jour automatique du champ SEED
// ----------------------------------------------------------------
function updateSeedInput() {
    const seedInput = document.getElementById('seed-input');
    if (!seedInput) return;
    const seed = generateSeed();
    if (seed) seedInput.value = seed;
}

// ----------------------------------------------------------------
// Initialisation des boutons SEED
// ----------------------------------------------------------------
function initSeedManager() {
    const copyBtn    = document.getElementById('seed-copy-btn');
    const restoreBtn = document.getElementById('seed-restore-btn');
    const seedInput  = document.getElementById('seed-input');
    if (!copyBtn || !restoreBtn || !seedInput) return;

    copyBtn.addEventListener('click', () => {
        const seed = generateSeed();
        if (!seed) { alert('Impossible de générer le SEED. Vérifiez les paramètres.'); return; }
        seedInput.value = seed;
        if (navigator.clipboard) {
            navigator.clipboard.writeText(seed).then(() => {
                copyBtn.textContent = '✓ Copié !';
                setTimeout(() => { copyBtn.textContent = 'Copier SEED'; }, 2500);
            });
        } else {
            seedInput.select();
            document.execCommand('copy');
            copyBtn.textContent = '✓ Copié !';
            setTimeout(() => { copyBtn.textContent = 'Copier SEED'; }, 2500);
        }
    });

    restoreBtn.addEventListener('click', () => {
        const seed = seedInput.value.trim();
        if (!seed) { alert('Collez d\'abord un code SEED dans le champ.'); return; }
        if (restoreSeed(seed)) {
            restoreBtn.textContent = '✓ Restauré !';
            setTimeout(() => { restoreBtn.textContent = 'Restaurer'; }, 2500);
        }
    });
}
