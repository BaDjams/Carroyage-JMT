#!/usr/bin/env python3
"""Tests de tools/bathy_mbtiles.py, sur des jeux synthetiques fideles aux formats reels.

    python3 tools/test_bathy_mbtiles.py            # ou : python3 -m unittest tools/test_bathy_mbtiles.py

Aucun acces reseau : le fond de carte est servi par un serveur local.
"""
import contextlib
import http.server
import io
import json
import math
import os
import shutil
import sqlite3
import sys
import tempfile
import threading
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

try:
    import numpy as np
    import rasterio
    import rasterio.shutil
    from PIL import Image
    from rasterio.transform import from_origin
    from rasterio.warp import transform as transforme_points
    import bathy_mbtiles as bm
except ImportError as e:  # pragma: no cover
    raise unittest.SkipTest(f'dependance manquante : {e.name} -- pip install -r tools/requirements-bathy.txt')


# ---------------------------------------------------------------------------
# Fabriques de jeux de donnees
# ---------------------------------------------------------------------------

def tuile_de(lon, lat, z):
    n = 1 << z
    x = int((lon + 180) / 360 * n)
    y = int((1 - math.log(math.tan(math.radians(lat)) + 1 / math.cos(math.radians(lat))) / math.pi) / 2 * n)
    return x, y


def ecrit_asc(chemin, z, x0, y0, taille, nodata=-99999.0):
    """ESRI ASCII Grid comme les dalles Litto3D et les MNT HOMONIM : sans .prj."""
    z = np.where(np.isnan(z), nodata, z)
    with open(chemin, 'w') as f:
        f.write(f'ncols {z.shape[1]}\nnrows {z.shape[0]}\nxllcorner {x0}\nyllcorner {y0}\n'
                f'cellsize {taille}\nNODATA_value {nodata}\n')
        for ligne in z:
            f.write(' '.join(f'{v:.3f}' for v in ligne) + '\n')


def ecrit_tif(chemin, z, transform, crs, nodata=-99999.0):
    with rasterio.open(chemin, 'w', driver='GTiff', width=z.shape[1], height=z.shape[0], count=1,
                       dtype='float32', crs=crs, transform=transform, nodata=nodata) as ds:
        ds.write(np.where(np.isnan(z), nodata, z).astype('float32'), 1)


def centres(transform, largeur, hauteur):
    c, l = np.meshgrid(np.arange(largeur) + 0.5, np.arange(hauteur) + 0.5)
    x = transform.c + c * transform.a
    y = transform.f + l * transform.e
    return x, y


def source(chemins, **kw):
    kw.setdefault('reference', 'ZH')
    return bm.Source(nom=kw.pop('nom', os.path.basename(chemins[0])), fichiers=list(chemins), **kw)


def rendu_pour(familles, intervalles, teintes=(), etiquettes=False):
    return bm.Rendu(dict(familles=familles, intervalles=intervalles, teintes=list(teintes),
                         etiquettes=etiquettes, fond='aucun'))


def pics(profil, seuil=40):
    """Centres des traits sur un profil d'opacite : barycentre de chaque plage au-dessus du seuil."""
    centres_ = []
    i = 0
    while i < len(profil):
        if profil[i] > seuil:
            j = i
            while j < len(profil) and profil[j] > seuil:
                j += 1
            poids = profil[i:j].astype(float)
            # + 0,5 : le pixel k couvre [k, k+1[, son centre est en k + 0,5
            centres_.append(float((np.arange(i, j) * poids).sum() / poids.sum()) + 0.5)
            i = j
        else:
            i += 1
    return centres_


class Base(unittest.TestCase):
    def setUp(self):
        self.dossier = tempfile.mkdtemp(prefix='bathy_test_')
        self.travail = os.path.join(self.dossier, 'travail')

    def tearDown(self):
        shutil.rmtree(self.dossier, ignore_errors=True)

    def chemin(self, nom):
        return os.path.join(self.dossier, nom)

    def config(self, sources, **kw):
        return bm.Config(sortie=self.chemin('sortie.mbtiles'), sources=sources, travail=self.travail, **kw)

    def prepare(self, cfg):
        with contextlib.redirect_stdout(io.StringIO()):
            familles = bm.prepare_sources(cfg, self.travail)
        return familles


# ---------------------------------------------------------------------------
# Geometrie : une isobathe tombe au pixel pres a sa place
# ---------------------------------------------------------------------------

class TestGeometrie(Base):
    def test_isobathes_au_pixel_pres(self):
        """Plan incline le long de X, en Web Mercator : l'isobathe d est la verticale
        X = X0 + 20 d. Chaque trait rendu doit tomber a moins de 0,2 px de sa place -- la
        borne du trace est 1/8 de pixel (coordonnees entieres sur une toile 4 fois plus fine)."""
        z, x, y = 17, *tuile_de(-4.5, 48.35, 17)
        ouest, sud, est, nord = bm.bornes_tuile(z, x, y)
        p = (est - ouest) / bm.TAILLE
        x0 = ouest - 50.0
        t = from_origin(ouest - 400, nord + 400, 1.0, 1.0)
        n = int(est - ouest) + 800
        cx, _ = centres(t, n, n)
        ecrit_tif(self.chemin('plan.tif'), -(cx - x0) / 20.0, t, 'EPSG:3857')
        cfg = self.config([source([self.chemin('plan.tif')])], teintes=[], etiquettes=False)
        familles = self.prepare(cfg)
        img, traces = rendu_pour(familles, {17: 1.0}).tuile(z, x, y)
        attendus = [d for d in range(0, 40) if 0 <= (x0 + 20 * d - ouest) / p <= bm.TAILLE - 1]
        self.assertTrue(set(attendus) <= {int(d) for d, _ in traces}, traces)
        alpha = np.asarray(img)[:, :, 3]
        trouves = pics(alpha[128])
        for d in attendus:
            u = (x0 + 20 * d - ouest) / p
            ecart = min(abs(u - c) for c in trouves)
            self.assertLess(ecart, 0.2, f'isobathe {d} m : attendue a {u:.2f} px, ecart {ecart:.2f} px')

    def test_maitresses_plus_epaisses(self):
        z, x, y = 17, *tuile_de(-4.5, 48.35, 17)
        ouest, sud, est, nord = bm.bornes_tuile(z, x, y)
        t = from_origin(ouest - 400, nord + 400, 1.0, 1.0)
        n = int(est - ouest) + 800
        cx, _ = centres(t, n, n)
        ecrit_tif(self.chemin('plan.tif'), -(cx - (ouest - 50.0)) / 20.0, t, 'EPSG:3857')
        familles = self.prepare(self.config([source([self.chemin('plan.tif')])]))
        _, traces = rendu_pour(familles, {17: 1.0}).tuile(z, x, y)
        styles = dict(traces)
        self.assertEqual(styles[5.0], 'maitresse')
        self.assertEqual(styles[10.0], 'maitresse')
        self.assertEqual(styles[4.0], 'normale')


# ---------------------------------------------------------------------------
# Sources multiples : priorite, pas minimal honnete, formats
# ---------------------------------------------------------------------------

def surface_cote(lon, lat):
    """Fond realiste : cote vers -4,43, pente de 2 % vers l'ouest, haut-fond a (-4,50 ; 48,36)."""
    dist = (-4.43 - lon) * 111320 * math.cos(math.radians(48.35))
    haut_fond = 15 * np.exp(-(((lon + 4.50) / 0.006) ** 2 + ((lat - 48.36) / 0.004) ** 2))
    return 8.0 - 0.02 * dist + haut_fond


class TestSources(Base):
    def fabrique_homonim(self, decalage_valeurs=0.0):
        """MNT de facade facon HOMONIM : ESRI ASCII en degres (0,001), sans .prj."""
        t = from_origin(-4.60, 48.40, 0.001, 0.001)
        lon, lat = centres(t, 200, 100)
        z = surface_cote(lon, lat) + decalage_valeurs
        z[z > 5] = np.nan
        ecrit_asc(self.chemin('homonim.asc'), z, -4.60, 48.30, 0.001)
        return self.chemin('homonim.asc')

    def fabrique_litto3d(self, decalage_valeurs=0.0):
        """Dalles facon Litto3D : ESRI ASCII Lambert-93, pas de 5 m, 1 km2, sans .prj."""
        chemins = []
        cx, cy = transforme_points('EPSG:4326', 'EPSG:2154', [-4.435], [48.352])
        x0 = math.floor(cx[0] / 1000) * 1000 - 1000
        y0 = math.floor(cy[0] / 1000) * 1000 - 1000
        for i in range(2):
            for j in range(2):
                gx, gy = x0 + i * 1000, y0 + j * 1000
                t = from_origin(gx, gy + 1000, 5, 5)
                x, y = centres(t, 200, 200)
                lon, lat = transforme_points('EPSG:2154', 'EPSG:4326', x.ravel().tolist(), y.ravel().tolist())
                z = surface_cote(np.array(lon), np.array(lat)).reshape(200, 200) + decalage_valeurs
                z[(z < -15) | (z > 10)] = np.nan
                chemin = self.chemin(f'litto3d_{i}{j}.asc')
                ecrit_asc(chemin, z, gx, gy, 5)
                chemins.append(chemin)
        return chemins, (x0, y0)

    def test_crs_manquant_explique(self):
        s = source([self.fabrique_homonim()])
        with self.assertRaises(bm.Erreur) as e:
            self.prepare(self.config([s]))
        self.assertIn('EPSG:2154', str(e.exception))

    def test_priorite_de_la_source_fine(self):
        """HOMONIM (92 m) et Litto3D (5 m) se recouvrent : la fine gagne, la grossiere comble autour.
        Les valeurs different volontairement de 0,5 m pour savoir laquelle a ete lue."""
        s_h = source([self.fabrique_homonim()], crs='EPSG:4326', nom='homonim')
        l3d, _ = self.fabrique_litto3d(decalage_valeurs=0.5)
        s_l = source(l3d, crs='EPSG:2154', nom='litto3d')
        familles = self.prepare(self.config([s_l, s_h]))
        self.assertEqual([f['nom'] for f in familles], ['homonim', 'litto3d'])   # la fine est posee en dernier
        self.assertEqual([f['pas_min'] for f in familles], [20, 1])
        r = rendu_pour(familles, {15: 2.0})
        z, x, y = 15, *tuile_de(-4.4455, 48.352, 15)
        alt, pas = r.compose(z, x, y)
        ouest, sud, est, nord = bm.bornes_tuile(z, x, y)
        p = (est - ouest) / bm.TAILLE
        t = rasterio.transform.from_origin(ouest - bm.MARGE * p, nord + bm.MARGE * p, p, p)
        cx, cy = centres(t, alt.shape[1], alt.shape[0])
        lon, lat = transforme_points('EPSG:3857', 'EPSG:4326', cx.ravel().tolist(), cy.ravel().tolist())
        attendu = surface_cote(np.array(lon), np.array(lat)).reshape(alt.shape)
        fin = pas == 1
        grossier = pas == 20
        self.assertTrue(fin.any() and grossier.any(), 'la tuile doit chevaucher les deux sources')
        self.assertLess(np.nanmedian(np.abs(alt[fin] - (attendu[fin] + 0.5))), 0.15)
        self.assertLess(np.nanmedian(np.abs(alt[grossier] - attendu[grossier])), 1.0)

    def test_pas_minimal_honnete(self):
        """Hors de Litto3D, dans une grille de 92 m, aucune isobathe metrique : seulement des multiples de 20 m."""
        familles = self.prepare(self.config([source([self.fabrique_homonim()], crs='EPSG:4326')]))
        r = rendu_pour(familles, {14: 1.0})
        z, x, y = 14, *tuile_de(-4.56, 48.34, 14)
        _, traces = r.tuile(z, x, y)
        self.assertTrue(traces, 'la tuile doit porter des isobathes')
        for d, _ in traces:
            self.assertTrue(d == 0 or bm.est_multiple(d, 20), f'isobathe {d} m inventee dans une grille de 92 m')

    def test_netcdf_facon_gebco(self):
        """GEBCO et EMODnet se distribuent en NetCDF : la variable « elevation » est choisie seule."""
        t = from_origin(-5.0, 49.0, 1 / 240, 1 / 240)
        lon, lat = centres(t, 240, 240)
        z = surface_cote(lon, lat).astype('float32')
        tif = self.chemin('gebco.tif')
        ecrit_tif(tif, z, t, 'EPSG:4326')
        nc = self.chemin('gebco.nc')
        rasterio.shutil.copy(tif, nc, driver='netCDF')     # le pilote netCDF n'ecrit que par copie
        familles = self.prepare(self.config([source([nc], nom='gebco', reference='NM', decalage=4.0)]))
        self.assertEqual(len(familles), 1)
        self.assertEqual(familles[0]['pas_min'], 100)      # 1/240 de degre, ~380 m au sol
        with rasterio.open(familles[0]['chemin']) as ds:
            ligne, col = ds.index(-4.55, 48.35)
            lon, lat = ds.xy(ligne, col)
            v = float(ds.read(1)[ligne, col])
        self.assertAlmostEqual(v, float(surface_cote(np.array(lon), np.array(lat))) + 4.0, places=3)


class TestConversions(Base):
    def grille(self, valeurs, nom='g.tif', crs='EPSG:2154'):
        t = from_origin(145000, 6836000, 10, 10)
        ecrit_tif(self.chemin(nom), np.full((50, 50), valeurs, dtype='float64'), t, crs)
        return self.chemin(nom), t

    def valeur_preparee(self, s):
        familles = self.prepare(self.config([s]))
        with rasterio.open(familles[0]['chemin']) as ds:
            return float(ds.read(1)[25, 25])

    def test_profondeurs_et_decalage(self):
        chemin, _ = self.grille(12.0)
        s = source([chemin], valeurs='profondeur', reference='ZH', decalage=2.0)
        self.assertAlmostEqual(self.valeur_preparee(s), -12.0 + 2.0, places=4)

    def test_lac_plan_d_eau(self):
        """Fond d'un lac en altitude (facon swissBATHY3D) : profondeur = surface - fond."""
        chemin, _ = self.grille(340.0)
        s = source([chemin], surface=372.0, reference=None)
        self.assertAlmostEqual(self.valeur_preparee(s), 340.0 - 372.0, places=4)

    def test_grille_de_correction(self):
        chemin, t = self.grille(-8.0)
        corr = self.chemin('corr.tif')
        cx, _ = centres(t, 50, 50)
        ecrit_tif(corr, (cx - 145000) / 100.0, t, 'EPSG:2154')          # 0 a 5 m d'ouest en est
        s = source([chemin], reference='IGN69', correction=corr)
        familles = self.prepare(self.config([s]))
        with rasterio.open(familles[0]['chemin']) as ds:
            a = ds.read(1)
        self.assertAlmostEqual(float(a[10, 10]), -8.0 + (145000 + 105 - 145000) / 100.0, places=3)
        self.assertAlmostEqual(float(a[10, 40]), -8.0 + (405) / 100.0, places=3)

    def test_avertissement_reference(self):
        chemin, _ = self.grille(-5.0)
        cfg = self.config([source([chemin], reference='IGN69', nom='sans-decalage'),
                           source([chemin], reference='IGN69', decalage=3.6, nom='avec-decalage')])
        familles = self.prepare(cfg)
        msgs = bm.avertissements(cfg, familles)
        self.assertEqual(len(msgs), 1)
        self.assertIn('sans-decalage', msgs[0])


# ---------------------------------------------------------------------------
# Sondes eparses et cartes S-57
# ---------------------------------------------------------------------------

class TestSondes(Base):
    def test_lecture_tolerante(self):
        cas = {
            'pv.txt': 'x;y;z\n145000,5;6836000,5;12,5\n145010;6836000;13\n',     # en-tete, ; et virgule decimale
            'tab.txt': '145000.5\t6836000.5\t12.5\n145010\t6836000\t13\n',
            'esp.xyz': '# leve 2026\n145000,5 6836000,5 12,5\n145010 6836000 13\n',  # espaces et virgule decimale
            'csv.csv': '145000.5,6836000.5,12.5\n145010, 6836000, 13\n',
        }
        for nom, texte in cas.items():
            with open(self.chemin(nom), 'w') as f:
                f.write(texte)
            x, y, z, ignorees = bm.lit_semis(self.chemin(nom), bm.Source(nom=nom, fichiers=[]))
            self.assertEqual(list(z), [12.5, 13.0], nom)
            self.assertEqual(x[0], 145000.5, nom)

    def test_triangulation_exacte_sur_un_plan(self):
        rng = np.random.default_rng(1)
        x = 145000 + rng.uniform(0, 400, 3000)
        y = 6836000 + rng.uniform(0, 400, 3000)
        prof = 5 + 0.01 * (x - 145000) + 0.02 * (y - 6836000)
        np.savetxt(self.chemin('leve.xyz'), np.column_stack([x, y, prof]), fmt='%.3f')
        s = source([self.chemin('leve.xyz')], type='sondes', crs='EPSG:2154', valeurs='profondeur', resolution=2.0)
        familles = self.prepare(self.config([s]))
        with rasterio.open(familles[0]['chemin']) as ds:
            a = ds.read(1)
            gx, gy = centres(ds.transform, ds.width, ds.height)
        ok = a != bm.NODATA
        self.assertGreater(ok.mean(), 0.9)
        attendu = -(5 + 0.01 * (gx - 145000) + 0.02 * (gy - 6836000))
        self.assertLess(np.abs(a[ok] - attendu[ok]).max(), 1e-3)
        self.assertEqual(familles[0]['pas_min'], 1)

    def test_pas_d_interpolation_dans_les_trous(self):
        """Deux leves separes de 2 km : rien ne doit etre invente entre eux."""
        rng = np.random.default_rng(2)
        pts = []
        for ox in (145000, 147400):
            x = ox + rng.uniform(0, 300, 1500)
            y = 6836000 + rng.uniform(0, 300, 1500)
            pts.append(np.column_stack([x, y, np.full(1500, 10.0)]))
        np.savetxt(self.chemin('deux.xyz'), np.vstack(pts), fmt='%.3f')
        s = source([self.chemin('deux.xyz')], type='sondes', crs='EPSG:2154', valeurs='profondeur', resolution=5.0)
        familles = self.prepare(self.config([s]))
        with rasterio.open(familles[0]['chemin']) as ds:
            v = next(ds.sample([(146400, 6836150)]))[0]
        self.assertEqual(v, bm.NODATA)

    def test_s57_sondes_et_isobathes(self):
        """Carte S-57 : SOUNDG (multipoints 3D) et DEPCNT (VALDCO). Faute de pouvoir ecrire un
        vrai .000 depuis Python, le jeu est une GeoPackage aux memes classes d'objets."""
        import pyogrio.raw
        import shapely
        from shapely.geometry import LineString, MultiPoint
        sondes = MultiPoint([(-4.500 + i * 0.0005, 48.350 + j * 0.0005, 2.0 + i * 0.5) for i in range(12) for j in range(12)])
        isobathe = LineString([(-4.5002, 48.3500), (-4.5002, 48.3556)])
        gpkg = self.chemin('carte_s57.gpkg')
        pyogrio.raw.write(gpkg, geometry=np.array([shapely.to_wkb(sondes, output_dimension=3)], dtype=object),
                          field_data=[], fields=[], layer='SOUNDG', driver='GPKG', geometry_type='MultiPoint Z',
                          crs='EPSG:4326')
        pyogrio.raw.write(gpkg, geometry=np.array([shapely.to_wkb(isobathe)], dtype=object),
                          field_data=[np.array([2.0])], fields=['VALDCO'], layer='DEPCNT', driver='GPKG',
                          geometry_type='LineString', crs='EPSG:4326', append=True)
        s = bm.source_depuis_dict({'fichiers': gpkg, 'type': 's57', 'resolution': 2}, self.dossier, 1)
        # ZH pour une ENC marine, niveau local pour une IENC fluviale : la reference reste a declarer
        self.assertEqual((s.valeurs, s.reference, s.crs), ('profondeur', None, 'EPSG:4326'))
        familles = self.prepare(self.config([s]))
        with rasterio.open(familles[0]['chemin']) as ds:
            x, y = transforme_points('EPSG:4326', ds.crs, [-4.4975], [48.3525])
            v = next(ds.sample([(x[0], y[0])]))[0]
        self.assertAlmostEqual(v, -(2.0 + 5 * 0.5), delta=0.05)


# ---------------------------------------------------------------------------
# Bout en bout : configuration, MBTiles, fond, processus
# ---------------------------------------------------------------------------

class ServeurFond:
    """Serveur local de tuiles unies rouges ; les chemins en /404/ repondent 404."""

    def __enter__(self):
        rouge = io.BytesIO()
        Image.new('RGBA', (256, 256), (255, 0, 0, 255)).save(rouge, format='PNG')
        corps = rouge.getvalue()

        class H(http.server.BaseHTTPRequestHandler):
            def log_message(self, *a):
                pass

            def do_GET(self):
                if self.path.startswith('/404/'):
                    self.send_response(404)
                    self.end_headers()
                    return
                self.send_response(200)
                self.send_header('Content-Type', 'image/png')
                self.send_header('Content-Length', str(len(corps)))
                self.end_headers()
                self.wfile.write(corps)

        self.srv = http.server.HTTPServer(('127.0.0.1', 0), H)
        threading.Thread(target=self.srv.serve_forever, daemon=True).start()
        self.url = f'http://127.0.0.1:{self.srv.server_address[1]}'
        return self

    def __exit__(self, *a):
        self.srv.shutdown()


class TestBoutEnBout(Base):
    def ecrit_config(self, **kw):
        t = from_origin(145000, 6837000, 5, 5)
        x, y = centres(t, 400, 400)
        ecrit_asc(self.chemin('litto.asc'), -(2 + (x - 145000) / 100.0), 145000, 6835000, 5)
        cfg = {'sortie': 'carte.mbtiles', 'reference': 'ZH', 'intervalle': 1, 'zoom_min': 13, 'zoom_max': 16,
               'travail': 'travail', 'processus': 1,
               'source': [{'fichiers': 'litto.asc', 'crs': 'EPSG:2154', 'reference': 'IGN69', 'decalage': 0.5,
                           'attribution': 'Litto3D (c) SHOM/IGN'}]}
        cfg.update(kw)
        with open(self.chemin('bathy.json'), 'w') as f:
            json.dump(cfg, f)
        return self.chemin('bathy.json')

    def lance(self, *args):
        tampon = io.StringIO()
        with contextlib.redirect_stdout(tampon), contextlib.redirect_stderr(tampon):
            code = bm.main(list(args))
        return code, tampon.getvalue()

    def test_mbtiles_complet(self):
        code, sortie = self.lance(self.ecrit_config())
        self.assertEqual(code, 0, sortie)
        con = sqlite3.connect(self.chemin('carte.mbtiles'))
        meta = dict(con.execute('SELECT name, value FROM metadata'))
        self.assertEqual((meta['format'], meta['type'], meta['scheme'], meta['version']),
                         ('png', 'baselayer', 'tms', '1.0'))
        self.assertEqual((meta['minzoom'], meta['maxzoom']), ('13', '16'))
        o, s, e, n = map(float, meta['bounds'].split(','))
        self.assertTrue(-4.6 < o < e < -4.4 and 48.3 < s < n < 48.4, meta['bounds'])
        self.assertIn('Litto3D', meta['attribution'])
        self.assertEqual(json.loads(meta['bathy_sources'])[0]['decalage'], 0.5)
        # Retournement TMS : la tuile stockee a tile_row = 2^z - 1 - y est bien celle de (z, x, y).
        z, x, y_tms, blob = con.execute('SELECT zoom_level, tile_column, tile_row, tile_data FROM tiles '
                                        'WHERE zoom_level = 16 LIMIT 1').fetchone()
        y = (1 << z) - 1 - y_tms
        img = Image.open(io.BytesIO(blob))
        self.assertEqual((img.format, img.size), ('PNG', (256, 256)))
        familles = json.load(open(os.path.join(self.dossier, 'travail', 'sources.json')))
        attendu, _ = rendu_pour(list(familles.values()), {16: 1.0}, teintes=[2, 5, 10, 20],
                                etiquettes=True).tuile(z, x, y)
        self.assertEqual(np.asarray(img).tobytes(), np.asarray(attendu).tobytes())

    def test_cache_de_preparation(self):
        chemin = self.ecrit_config()
        self.lance(chemin)
        code, sortie = self.lance(chemin)
        self.assertEqual(code, 0)
        self.assertIn('preparation reutilisee', sortie)

    def test_inventaire_ne_produit_rien(self):
        code, sortie = self.lance(self.ecrit_config(), '--inventaire')
        self.assertEqual(code, 0, sortie)
        self.assertFalse(os.path.exists(self.chemin('carte.mbtiles')))
        self.assertIn('Pas des isobathes par zoom', sortie)

    def test_cle_inconnue(self):
        code, sortie = self.lance(self.ecrit_config(source=[{'fichiers': 'litto.asc', 'decallage': 1}]))
        self.assertEqual(code, 1)
        self.assertIn('decallage', sortie)

    def test_fond_cuit_sous_les_isobathes(self):
        with ServeurFond() as serveur:
            code, sortie = self.lance(self.ecrit_config(
                rendu={'fond': serveur.url + '/{z}/{x}/{y}.png', 'teintes': []}))
        self.assertEqual(code, 0, sortie)
        con = sqlite3.connect(self.chemin('carte.mbtiles'))
        blob = con.execute('SELECT tile_data FROM tiles WHERE zoom_level = 16 LIMIT 1').fetchone()[0]
        a = np.asarray(Image.open(io.BytesIO(blob)).convert('RGBA'))
        rouges = (a[:, :, 0] > 250) & (a[:, :, 1] < 5) & (a[:, :, 2] < 5)
        self.assertGreater(rouges.mean(), 0.5, 'le fond doit apparaitre hors des traits')
        self.assertLess(rouges.mean(), 0.999, 'les isobathes doivent recouvrir le fond')

    def test_fond_indisponible_signale(self):
        with ServeurFond() as serveur:
            code, sortie = self.lance(self.ecrit_config(rendu={'fond': serveur.url + '/404/{z}/{x}/{y}.png'}))
        self.assertEqual(code, 0, sortie)
        self.assertIn('fond indisponible', sortie)

    def test_plusieurs_processus_meme_resultat(self):
        chemin = self.ecrit_config(zoom_min=14, zoom_max=17)
        self.lance(chemin, '--processus', '1', '--sortie', self.chemin('un.mbtiles'))
        self.lance(chemin, '--processus', '2', '--sortie', self.chemin('deux.mbtiles'))
        lire = lambda nom: sorted(sqlite3.connect(self.chemin(nom)).execute(
            'SELECT zoom_level, tile_column, tile_row, tile_data FROM tiles').fetchall())
        un, deux = lire('un.mbtiles'), lire('deux.mbtiles')
        self.assertGreaterEqual(len(un), 64, 'il faut assez de tuiles pour lancer le pool de processus')
        self.assertEqual(un, deux)


class TestExemple(unittest.TestCase):
    def test_exemple_documente_a_jour(self):
        """tools/exemples/bathy.toml ne doit employer que des cles que l'outil connait."""
        import tomllib
        chemin = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'exemples', 'bathy.toml')
        with open(chemin, 'rb') as f:
            d = tomllib.load(f)
        self.assertLessEqual(set(d), bm.CLES_CONFIG)
        self.assertLessEqual(set(d['rendu']), bm.CLES_RENDU)
        for s in d['source']:
            self.assertLessEqual(set(s), bm.CLES_SOURCE, s.get('nom'))


if __name__ == '__main__':
    unittest.main(verbosity=2)
