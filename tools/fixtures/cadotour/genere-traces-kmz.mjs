// Régénère traces-cadotour.kmz avec le code d'export de CadoTour lui-même
// (« Fichier › Exporter en KMZ… » : kmzExport.js puis kmz.buildPoiKmz) :
//   node tools/fixtures/cadotour/genere-traces-kmz.mjs <dossier CadoTour> [sortie.kmz]
// (CadoTour voisin, ses dépendances installées : npm ci). Contenu : un calque de
// dessin (flèche, polyligne, flèche à deux pointes sans nom), une trace enregistrée
// (calque KMZ subKind « track ») et un itinéraire (subKind « route »).
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const cado = path.resolve(process.argv[2] || '../VirtualTour');
const sortie = process.argv[3] || fileURLToPath(new URL('traces-cadotour.kmz', import.meta.url));
const { exportTree, selectionToKmz, defaultSelection } = await import(pathToFileURL(path.join(cado, 'kmzExport.js')).href);
const { buildPoiKmz } = await import(pathToFileURL(path.join(cado, 'kmz.js')).href);

const P = (lat, lon) => ({ lat, lon });
const layers = [
    { id: 'd1', name: 'Dessin tactique', visible: true, shapes: [
        { type: 'arrow', name: 'Axe nord', color: '#e63946', strokeWidth: 3, points: [P(48.380, -4.500), P(48.392, -4.470), P(48.400, -4.440)] },
        { type: 'polyline', name: 'Sentier', color: '#1d3557', points: [P(48.400, -4.440), P(48.420, -4.430), P(48.440, -4.425)] },
        { type: 'arrow', color: '#2a9d8f', arrowEnds: 'both', points: [P(48.360, -4.520), P(48.365, -4.505)] },
    ] },
    { id: 'k1', kind: 'kmz', subKind: 'track', name: 'Trace enregistrée', visible: true, features: [
        { g: 'line', name: 'Patrouille 14h', color: '#ff6600', width: 4, pts: [[48.440, -4.425], [48.450, -4.415], [48.460, -4.400]] },
    ] },
    { id: 'k2', kind: 'kmz', subKind: 'route', name: 'Itinéraire', visible: true, features: [
        { g: 'line', name: 'Route', color: '#1a73e8', width: 4, pts: [[48.460, -4.400], [48.470, -4.390]] },
    ] },
];
const tree = exportTree(layers);
const { features, icons } = selectionToKmz(tree, defaultSelection(tree));
const { blob } = await buildPoiKmz({ name: 'Traces CadoTour', features, icons, getBlob: async () => null, rasterize: async () => null });
writeFileSync(sortie, Buffer.from(await blob.arrayBuffer()));
console.log(`${sortie} : ${features.map(f => `${f.g} ${f.name ?? '(sans nom)'}`).join(' · ')}`);
