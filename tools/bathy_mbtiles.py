#!/usr/bin/env python3
"""Bathymetrie fine -> MBTiles.

Assemble des sources bathymetriques de precisions et de formats differents --
Litto3D, MNT HOMONIM du SHOM, EMODnet, GEBCO, swissBATHY3D, leves de sondes
XYZ, cartes S-57 -- en une seule carte d'isobathes, et l'ecrit en MBTiles :
lisible par l'application (mode MBTiles), par les drones DJI et par QGIS.

Principe :
  1. chaque source est preparee une fois : lue quel que soit son format,
     ramenee a la reference verticale de la carte, maillee si ce sont des
     sondes, puis rangee dans un GeoTIFF tuile avec apercus (cache reutilise
     d'une execution a l'autre) ;
  2. chaque tuile est composee en Web Mercator : la source la plus fine
     l'emporte la ou elle a des donnees, les autres comblent autour ;
  3. une isobathe n'est tracee qu'au pas que sa source sait porter : pas
     d'isobathe metrique inventee dans une grille de 100 m.

    python3 tools/bathy_mbtiles.py bathy.toml
    python3 tools/bathy_mbtiles.py bathy.toml --inventaire   # sources, pas, volumes : rien n'est produit
    python3 tools/bathy_mbtiles.py bathy.toml --zoom-max 16 --processus 4

Dependances : pip install -r tools/requirements-bathy.txt
Configuration commentee : tools/exemples/bathy.toml -- DOCUMENTATION.md §7.8.
"""
import argparse
import concurrent.futures as cf
import glob
import hashlib
import io
import json
import math
import os
import sqlite3
import sys
import time
import urllib.error
import urllib.request
from dataclasses import asdict, dataclass, field, fields

try:
    import contourpy
    import numpy as np
    import rasterio
    from PIL import Image, ImageDraw, ImageFont
    from rasterio.crs import CRS
    from rasterio.enums import Resampling
    from rasterio.errors import WindowError
    from rasterio.transform import Affine, array_bounds, from_origin
    from rasterio.warp import reproject, transform_bounds
    from rasterio.warp import transform as transforme_points
    from rasterio.windows import Window
    from rasterio.windows import from_bounds as fenetre_de_bornes
except ImportError as e:  # pragma: no cover -- message destine a l'utilisateur
    sys.exit(f'Dependance manquante : {e.name}. Installer : pip install -r tools/requirements-bathy.txt')

VERSION_OUTIL = '1'
R_MERCATOR = 20037508.342789244     # demi-circonference EPSG:3857, borne du monde tuile
TAILLE = 256                        # tuile rendue, comme partout dans l'application
MARGE = 16                          # pixels lus autour de la tuile : continuite des isobathes d'une tuile a l'autre
SUR = 4                             # suréchantillonnage du dessin, pour l'anticrenelage
NODATA = -99999.0                   # valeur absente des GeoTIFF prepares (celle de Litto3D)
PAS_JOLIS = (0.5, 1, 2, 2.5, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 5000)
WEB_MERCATOR = CRS.from_epsg(3857)
WGS84 = CRS.from_epsg(4326)

# Fonds cuisables sous les isobathes : les memes gabarits que map-layers.js.
FONDS = {
    'plan-ign': ('https://data.geopf.fr/wmts?Layer=GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2&Style=normal'
                 '&TileMatrixSet=PM&SERVICE=WMTS&REQUEST=GetTile&Version=1.0.0&FORMAT=image/png'
                 '&TileMatrix={z}&TileCol={x}&TileRow={y}', '© IGN'),
    'ortho-ign': ('https://data.geopf.fr/wmts?Layer=ORTHOIMAGERY.ORTHOPHOTOS&Style=normal'
                  '&TileMatrixSet=PM&SERVICE=WMTS&REQUEST=GetTile&Version=1.0.0&FORMAT=image/jpeg'
                  '&TileMatrix={z}&TileCol={x}&TileRow={y}', '© IGN'),
}

# Traits en pixels de tuile (multiplies par SUR sur la toile de dessin).
STYLES = {
    'normale': ((74, 116, 168, 200), 1.0),
    'maitresse': ((38, 82, 138, 235), 1.7),
    'zero': ((20, 45, 80, 255), 2.2),
}
COULEUR_ETIQUETTE = (30, 62, 110, 255)
COULEUR_HALO = (255, 255, 255, 235)


class Erreur(Exception):
    """Erreur de configuration ou de donnees, presentee telle quelle a l'utilisateur."""


# ---------------------------------------------------------------------------
# Geometrie des tuiles et petits calculs
# ---------------------------------------------------------------------------

def bornes_tuile(z, x, y):
    """Emprise EPSG:3857 (ouest, sud, est, nord) de la tuile XYZ."""
    cote = 2 * R_MERCATOR / (1 << z)
    ouest = -R_MERCATOR + x * cote
    nord = R_MERCATOR - y * cote
    return ouest, nord - cote, ouest + cote, nord


def plage_tuiles(z, bornes3857):
    """Tuiles (x0, x1, y0, y1), bornes incluses, qui touchent une emprise EPSG:3857."""
    ouest, sud, est, nord = bornes3857
    n = 1 << z
    cote = 2 * R_MERCATOR / n
    eps = cote * 1e-9
    x0 = max(0, int(math.floor((ouest + R_MERCATOR) / cote)))
    x1 = min(n - 1, int(math.floor((est - eps + R_MERCATOR) / cote)))
    y0 = max(0, int(math.floor((R_MERCATOR - nord) / cote)))
    y1 = min(n - 1, int(math.floor((R_MERCATOR - sud - eps) / cote)))
    return x0, x1, y0, y1


def latitude_y3857(y):
    return math.degrees(math.atan(math.sinh(y / 6378137.0)))


def pixel_sol(z, lat):
    """Taille au sol (m) d'un pixel de tuile 256 px au zoom z et a la latitude lat."""
    return 2 * R_MERCATOR / (TAILLE << z) * math.cos(math.radians(lat))


def zoom_natif(res_m, lat):
    """Plus petit zoom dont le pixel est au moins aussi fin que la resolution de la source."""
    for z in range(0, 23):
        if pixel_sol(z, lat) <= res_m * 1.001:
            return z
    return 22


def pas_joli_au_moins(v, multiple_de=None):
    for p in PAS_JOLIS:
        if p >= v - 1e-9 and (multiple_de is None or est_multiple(p, multiple_de)):
            return p
    return PAS_JOLIS[-1]


def pas_joli_au_plus(v):
    meilleur = PAS_JOLIS[0]
    for p in PAS_JOLIS:
        if p <= v + 1e-9:
            meilleur = p
    return meilleur


def est_multiple(v, pas):
    q = v / pas
    return abs(q - round(q)) < 1e-6


def pas_min_de_resolution(res_m):
    """Pas d'isobathe honnete pour une grille : environ le cinquieme de sa
    resolution horizontale, jamais moins d'un metre. 1 m pour Litto3D (1 et 5 m),
    25 m pour une grille de 100 m, 100 m pour GEBCO (~450 m)."""
    return pas_joli_au_moins(max(1.0, res_m / 5.0))


def pas_maitresse(pas):
    """Isobathe maitresse, epaissie et etiquetee : 5 m pour un pas de 1 m, 10 m pour 2 ou 2,5 m..."""
    return pas_joli_au_moins(4 * pas, multiple_de=pas)


MULTIPLES_PAR_ECART = (2, 5, 10, 20, 50, 100, 200, 500, 1000)


def intervalle_au_zoom(z, fin, zoom_detail):
    """Pas des isobathes au zoom z : `fin` a partir de zoom_detail, puis de plus en
    plus large en dezoomant, pour qu'une vue d'ensemble reste lisible."""
    ecart = zoom_detail - z
    if ecart <= 0:
        return fin
    return pas_joli_au_moins(fin * MULTIPLES_PAR_ECART[min(ecart, len(MULTIPLES_PAR_ECART)) - 1],
                             multiple_de=fin)


def texte_profondeur(d):
    """Profondeur a la francaise : « 5 », « 2,5 »."""
    if abs(d - round(d)) < 1e-9:
        return str(int(round(d)))
    return f'{d:.1f}'.replace('.', ',')


def nombre_fr(v, decimales=2):
    return f'{v:+.{decimales}f}'.replace('.', ',')


# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

@dataclass
class Source:
    nom: str
    fichiers: list
    type: str = 'grille'            # grille | sondes | s57
    crs: str = None                 # impose le systeme de coordonnees (fichiers sans .prj)
    valeurs: str = 'altitude'       # altitude (positive vers le haut) | profondeur (positive vers le bas)
    reference: str = None           # reference verticale de la source : IGN69, NM, ZH, LAT, LN02...
    decalage: float = 0.0           # metres AJOUTES pour passer a la reference de la carte
    correction: str = None          # grille de decalages (m), variable dans l'espace, ajoutee pixel a pixel
    surface: float = None           # lacs : altitude du plan d'eau ; profondeur = surface - altitude du fond
    pas_min: float = None           # pas d'isobathe minimal que la source sait porter
    priorite: float = None          # plus grande = gagne ; par defaut, la plus fine gagne
    attribution: str = None
    variable: str = None            # NetCDF a plusieurs variables : laquelle lire
    nodata: float = None            # valeur absente, si le fichier ne la declare pas
    colonnes: list = field(default_factory=lambda: [0, 1, 2])   # sondes : colonnes x, y, z
    separateur: str = None          # sondes : ';' ',' tabulation... ; defaut = detection
    resolution: float = None        # sondes et S-57 : maille de la grille (m) ; defaut = espacement median
    arete_max: float = None         # sondes et S-57 : pas d'interpolation au-dela (m) ; defaut = automatique
    motifs: list = field(default_factory=list)


@dataclass
class Config:
    sortie: str
    sources: list
    nom: str = None
    reference: str = 'ZH'
    intervalle: float = 1.0
    zoom_min: int = None
    zoom_max: int = None
    zoom_detail: int = None
    surzoom: int = None             # None : chaque source est rendue jusqu'au zoom maximal
    emprise: list = None
    fond: str = 'aucun'
    teintes: list = field(default_factory=lambda: [2, 5, 10, 20])
    etiquettes: bool = True
    processus: int = None
    travail: str = None
    max_tuiles: int = 250000


CLES_SOURCE = {f.name for f in fields(Source)} - {'nom', 'motifs'} | {'nom'}
CLES_CONFIG = {'sortie', 'nom', 'reference', 'intervalle', 'zoom_min', 'zoom_max', 'zoom_detail',
               'surzoom', 'emprise', 'processus', 'travail', 'max_tuiles', 'rendu', 'source'}
CLES_RENDU = {'fond', 'teintes', 'etiquettes'}


def lit_fichier_config(chemin):
    with open(chemin, 'rb') as f:
        brut = f.read().decode('utf-8-sig')
    if chemin.lower().endswith('.json'):
        return json.loads(brut)
    try:
        import tomllib
    except ModuleNotFoundError:  # Python < 3.11
        try:
            import tomli as tomllib
        except ModuleNotFoundError:
            raise Erreur('Lecture TOML impossible avec ce Python (< 3.11) : pip install tomli, '
                         'ou ecrire la configuration en JSON.')
    return tomllib.loads(brut)


def _chemin(base, p):
    p = os.path.expanduser(str(p))
    return p if os.path.isabs(p) else os.path.normpath(os.path.join(base, p))


def charge_config(chemin, surcharges=None):
    brut = lit_fichier_config(chemin)
    base = os.path.dirname(os.path.abspath(chemin))
    inconnues = set(brut) - CLES_CONFIG
    if inconnues:
        raise Erreur(f'Cle(s) inconnue(s) dans {chemin} : {", ".join(sorted(inconnues))}.')
    rendu = brut.get('rendu', {})
    inconnues = set(rendu) - CLES_RENDU
    if inconnues:
        raise Erreur(f'Cle(s) inconnue(s) dans [rendu] : {", ".join(sorted(inconnues))}.')
    if 'sortie' not in brut:
        raise Erreur('La configuration doit donner le fichier de « sortie ».')
    sources = [source_depuis_dict(s, base, i + 1) for i, s in enumerate(brut.get('source', []))]
    if not sources:
        raise Erreur('Aucune [[source]] declaree.')
    cfg = Config(sortie=_chemin(base, brut['sortie']), sources=sources)
    for cle in ('nom', 'reference', 'intervalle', 'zoom_min', 'zoom_max', 'zoom_detail', 'surzoom',
                'emprise', 'processus', 'max_tuiles'):
        if cle in brut:
            setattr(cfg, cle, brut[cle])
    if 'travail' in brut:
        cfg.travail = _chemin(base, brut['travail'])
    for cle in CLES_RENDU:
        if cle in rendu:
            setattr(cfg, cle, rendu[cle])
    for cle, valeur in (surcharges or {}).items():
        if valeur is not None:
            setattr(cfg, cle, valeur)
    verifie_config(cfg)
    return cfg


def source_depuis_dict(d, base, rang):
    inconnues = set(d) - CLES_SOURCE
    if inconnues:
        raise Erreur(f'Source n°{rang} : cle(s) inconnue(s) {", ".join(sorted(inconnues))} '
                     f'(cles admises : {", ".join(sorted(CLES_SOURCE))}).')
    if 'fichiers' not in d:
        raise Erreur(f'Source n°{rang} : « fichiers » manquant.')
    motifs = d['fichiers'] if isinstance(d['fichiers'], list) else [d['fichiers']]
    trouves = []
    for m in motifs:
        trouves += glob.glob(_chemin(base, m), recursive=True)
    trouves = sorted({os.path.abspath(f) for f in trouves if os.path.isfile(f)})
    nom = d.get('nom') or os.path.basename(str(motifs[0]))
    if not trouves:
        raise Erreur(f'Source « {nom} » : aucun fichier ne correspond a {motifs}.')
    s = Source(nom=nom, fichiers=trouves, motifs=[str(m) for m in motifs])
    for cle, valeur in d.items():
        if cle in ('fichiers', 'nom'):
            continue
        if cle == 'correction':
            valeur = _chemin(base, valeur)
        setattr(s, cle, valeur)
    if s.type not in ('grille', 'sondes', 's57'):
        raise Erreur(f'Source « {nom} » : type « {s.type} » inconnu (grille, sondes ou s57).')
    if s.valeurs not in ('altitude', 'profondeur'):
        raise Erreur(f'Source « {nom} » : valeurs « {s.valeurs} » inconnues (altitude ou profondeur).')
    if s.surface is not None and s.valeurs == 'profondeur':
        raise Erreur(f'Source « {nom} » : « surface » s\'applique a des altitudes de fond, '
                     f'pas a des profondeurs deja comptees depuis la surface.')
    if s.type == 'sondes' and not s.crs:
        raise Erreur(f'Source « {nom} » : un semis de sondes ne porte pas son systeme de '
                     f'coordonnees, preciser crs (ex. "EPSG:4326" ou "EPSG:2154").')
    if s.type == 's57':
        s.crs = s.crs or 'EPSG:4326'
        if 'valeurs' not in d:
            s.valeurs = 'profondeur'   # les sondes S-57 sont des profondeurs, positives vers le bas
        # Pas de reference par defaut : ZH pour une carte marine, mais le niveau de
        # reference local de la voie d'eau pour une carte fluviale IENC -- a declarer.
    return s


def verifie_config(cfg):
    if cfg.intervalle not in PAS_JOLIS:
        raise Erreur(f'intervalle = {cfg.intervalle} : choisir parmi {", ".join(map(str, PAS_JOLIS))}.')
    if cfg.fond not in FONDS and cfg.fond != 'aucun' and '{z}' not in str(cfg.fond):
        raise Erreur(f'fond = « {cfg.fond} » : « aucun », {", ".join(FONDS)}, '
                     f'ou un gabarit d\'URL contenant {{z}}, {{x}} et {{y}}.')
    if cfg.emprise is not None:
        if len(cfg.emprise) != 4 or not (cfg.emprise[0] < cfg.emprise[2] and cfg.emprise[1] < cfg.emprise[3]):
            raise Erreur('emprise = [lon_min, lat_min, lon_max, lat_max], en degres.')
    cfg.teintes = sorted(float(t) for t in cfg.teintes)


# ---------------------------------------------------------------------------
# Preparation des sources : un GeoTIFF tuile, avec apercus, par source
# ---------------------------------------------------------------------------

def cle_source(s, cfg):
    """Empreinte de la source et de ses fichiers : la preparation est reutilisee
    tant que rien ne change."""
    h = hashlib.sha1()
    h.update(VERSION_OUTIL.encode())
    h.update(json.dumps({k: v for k, v in asdict(s).items() if k != 'motifs'},
                        sort_keys=True, default=str).encode())
    h.update(json.dumps(cfg.emprise).encode())
    for f in s.fichiers + ([s.correction] if s.correction else []):
        st = os.stat(f)
        h.update(f'{f}|{st.st_size}|{int(st.st_mtime)}'.encode())
    return h.hexdigest()[:16]


def distance_m(lon1, lat1, lon2, lat2):
    """Distance au sol (haversine), suffisante pour estimer une resolution."""
    p1, p2 = math.radians(lat1), math.radians(lat2)
    a = (math.sin((p2 - p1) / 2) ** 2
         + math.cos(p1) * math.cos(p2) * math.sin(math.radians(lon2 - lon1) / 2) ** 2)
    return 2 * 6371008.8 * math.asin(math.sqrt(a))


def res_metres(crs, res, bornes):
    """Resolution au sol (m), mesuree au centre de l'emprise quelle que soit la
    projection : en Web Mercator, une unite vaut 1/cos(latitude) metre, soit 1,5
    a la latitude de Brest -- prendre les unites pour des metres fausserait le pas
    minimal des isobathes et les zooms."""
    cx, cy = (bornes[0] + bornes[2]) / 2, (bornes[1] + bornes[3]) / 2
    lon, lat = transforme_points(crs, WGS84, [cx, cx + abs(res[0]), cx], [cy, cy, cy + abs(res[1])])
    return (distance_m(lon[0], lat[0], lon[1], lat[1]) + distance_m(lon[0], lat[0], lon[2], lat[2])) / 2


def ouvre_grille(chemin, s):
    """Ouvre un raster quel que soit son format ; choisit la variable des NetCDF qui en ont plusieurs."""
    try:
        ds = rasterio.open(chemin)
    except rasterio.errors.RasterioIOError as e:
        if chemin.lower().endswith(('.xyz', '.txt', '.csv')):
            raise Erreur(f'{chemin} : illisible comme grille reguliere ({e}). '
                         f'Si ce sont des sondes eparses, declarer type = "sondes".')
        raise Erreur(f'{chemin} : format non reconnu ({e}).')
    if ds.count == 0 and ds.subdatasets:
        voulu = s.variable
        choix = None
        for sd in ds.subdatasets:
            nomvar = sd.rsplit(':', 1)[-1]
            if voulu and nomvar == voulu:
                choix = sd
            elif not voulu and choix is None and nomvar.lower() in ('elevation', 'depth', 'z', 'band1', 'bathymetry'):
                choix = sd
        if choix is None:
            noms = ', '.join(sd.rsplit(':', 1)[-1] for sd in ds.subdatasets)
            ds.close()
            raise Erreur(f'{chemin} contient plusieurs variables ({noms}) : preciser variable = "...".')
        ds.close()
        ds = rasterio.open(choix)
    return ds


class Preparateur:
    """Ecrit une source dans un GeoTIFF sur sa propre grille, en valeurs deja
    converties dans la reference verticale de la carte (altitude, negative sous le zero)."""

    def __init__(self, s):
        self.s = s
        self._correction = None

    # -- conversions verticales --------------------------------------------
    def convertit(self, z):
        """Conversions scalaires : signe, plan d'eau, decalage."""
        z = z.astype(np.float64, copy=True)
        if self.s.valeurs == 'profondeur':
            z = -z
        if self.s.surface is not None:
            z = z - float(self.s.surface)
        return z + float(self.s.decalage)

    def corrige(self, z, transform, crs):
        """Grille de correction, echantillonnee sur la grille des donnees. La ou
        elle manque, la valeur convertie est inconnue : elle devient absente."""
        if not self.s.correction:
            return z
        if self._correction is None:
            self._correction = rasterio.open(self.s.correction)
        c = self._correction
        corr = np.full(z.shape, np.nan, np.float64)
        reproject(source=rasterio.band(c, 1), destination=corr, src_nodata=c.nodata,
                  dst_transform=transform, dst_crs=crs, dst_nodata=np.nan,
                  resampling=Resampling.bilinear)
        return z + corr

    # -- ecriture -------------------------------------------------------------
    @staticmethod
    def profil(crs, transform, largeur, hauteur):
        bloc_x = min(512, max(16, int(math.ceil(largeur / 16)) * 16))
        bloc_y = min(512, max(16, int(math.ceil(hauteur / 16)) * 16))
        return dict(driver='GTiff', width=largeur, height=hauteur, count=1, dtype='float32', crs=crs,
                    transform=transform, nodata=NODATA, tiled=True, blockxsize=bloc_x, blockysize=bloc_y,
                    compress='deflate', predictor=3, BIGTIFF='IF_SAFER', SPARSE_OK='TRUE')

    @staticmethod
    def fusionne(dst, z, fenetre):
        """Ecrit z (NaN = absent) dans la fenetre, sans effacer une valeur deja
        presente par une absence : les dalles voisines se partagent leurs bords."""
        ancien = dst.read(1, window=fenetre).astype(np.float64)
        ancien[ancien == NODATA] = np.nan
        neuf = np.where(np.isnan(z), ancien, z)
        dst.write(np.where(np.isnan(neuf), NODATA, neuf).astype(np.float32), 1, window=fenetre)

    @staticmethod
    def construit_apercus(dst):
        facteurs, f = [], 2
        while max(dst.width, dst.height) / f >= 128:
            facteurs.append(f)
            f *= 2
        if facteurs:
            dst.build_overviews(facteurs, Resampling.average)
            dst.update_tags(ns='rio_overview', resampling='average')


def prepare_grille(s, cfg, sortie):
    prep = Preparateur(s)
    infos = []
    for f in s.fichiers:
        with ouvre_grille(f, s) as ds:
            crs = CRS.from_user_input(s.crs) if s.crs else ds.crs
            if crs is None:
                raise Erreur(f'{f} ne declare pas son systeme de coordonnees (pas de .prj ?) : '
                             f'preciser crs dans la source « {s.nom} » -- "EPSG:2154" pour Litto3D '
                             f'en metropole, "EPSG:4326" pour une grille en degres.')
            infos.append(dict(f=f, crs=crs, bornes=tuple(ds.bounds), res=ds.res, l=ds.width, h=ds.height))
    crs_ref = infos[0]['crs']
    autres = [i['f'] for i in infos if i['crs'] != crs_ref]
    if autres:
        raise Erreur(f'Source « {s.nom} » : systemes de coordonnees differents ({crs_ref.to_string()} '
                     f'pour {os.path.basename(infos[0]["f"])}, autre chose pour {os.path.basename(autres[0])}). '
                     f'Declarer une source par systeme.')
    if cfg.emprise:
        e = transform_bounds(WGS84, crs_ref, *cfg.emprise, densify_pts=21)
        infos = [i for i in infos if i['bornes'][0] < e[2] and i['bornes'][2] > e[0]
                 and i['bornes'][1] < e[3] and i['bornes'][3] > e[1]]
        if not infos:
            return None
    fin = min(infos, key=lambda i: abs(i['res'][0]) * abs(i['res'][1]))
    rx, ry = abs(fin['res'][0]), abs(fin['res'][1])
    ox, oy = fin['bornes'][0], fin['bornes'][3]
    gauche = min(i['bornes'][0] for i in infos)
    bas = min(i['bornes'][1] for i in infos)
    droite = max(i['bornes'][2] for i in infos)
    haut = max(i['bornes'][3] for i in infos)
    if cfg.emprise:
        gauche, bas, droite, haut = max(gauche, e[0]), max(bas, e[1]), min(droite, e[2]), min(haut, e[3])
    # Grille de la source alignee sur celle de sa dalle la plus fine : les dalles
    # Litto3D s'y posent sans reechantillonnage.
    gauche = ox + math.floor((gauche - ox) / rx + 1e-9) * rx
    droite = ox + math.ceil((droite - ox) / rx - 1e-9) * rx
    haut = oy - math.floor((oy - haut) / ry + 1e-9) * ry
    bas = oy - math.ceil((oy - bas) / ry - 1e-9) * ry
    largeur, hauteur = int(round((droite - gauche) / rx)), int(round((haut - bas) / ry))
    t_dst = from_origin(gauche, haut, rx, ry)
    with rasterio.open(sortie, 'w+', **Preparateur.profil(crs_ref, t_dst, largeur, hauteur)) as dst:
        for i in infos:
            with ouvre_grille(i['f'], s) as ds:
                nd = s.nodata if s.nodata is not None else ds.nodata
                for ligne0 in range(0, ds.height, 1024):
                    # 2 lignes de recouvrement : l'interpolation d'un morceau non aligne voit ses voisins
                    debut = max(0, ligne0 - 2)
                    fin_l = min(ds.height, ligne0 + 1024 + 2)
                    fen_src = Window(0, debut, ds.width, fin_l - debut)
                    z = ds.read(1, window=fen_src).astype(np.float64)
                    if nd is not None:
                        z[z == nd] = np.nan
                    z[~np.isfinite(z)] = np.nan
                    t_src = ds.window_transform(fen_src)
                    z = prep.corrige(prep.convertit(z), t_src, crs_ref)
                    ecrit_morceau(dst, z, t_src, crs_ref, garder=(ligne0 - debut, ligne0 + 1024 - debut))
        Preparateur.construit_apercus(dst)
    return dict(res=(rx, ry), crs=crs_ref)


def aligne(t_src, t_dst):
    if abs(t_src.a - t_dst.a) > 1e-9 * abs(t_dst.a) or abs(t_src.e - t_dst.e) > 1e-9 * abs(t_dst.e):
        return False
    dc = (t_src.c - t_dst.c) / t_dst.a
    dr = (t_src.f - t_dst.f) / t_dst.e
    return abs(dc - round(dc)) < 1e-6 and abs(dr - round(dr)) < 1e-6


def ecrit_morceau(dst, z, t_src, crs, garder=None):
    """Pose un morceau de source dans le GeoTIFF prepare. Aligne : copie exacte des
    lignes utiles ; sinon interpolation bilineaire sur la grille de destination."""
    if aligne(t_src, dst.transform):
        if garder is not None:
            g0, g1 = garder
            z = z[g0:min(g1, z.shape[0])]
            t_src = t_src * Affine.translation(0, g0)
        col = int(round((t_src.c - dst.transform.c) / dst.transform.a))
        lig = int(round((t_src.f - dst.transform.f) / dst.transform.e))
        h, w = z.shape
        l0, c0 = max(0, lig), max(0, col)
        l1, c1 = min(dst.height, lig + h), min(dst.width, col + w)
        if l1 <= l0 or c1 <= c0:
            return
        Preparateur.fusionne(dst, z[l0 - lig:l1 - lig, c0 - col:c1 - col], Window(c0, l0, c1 - c0, l1 - l0))
        return
    b = array_bounds(z.shape[0], z.shape[1], t_src)
    try:
        fen = fenetre_de_bornes(*b, transform=dst.transform)
        fen = Window(math.floor(fen.col_off), math.floor(fen.row_off),
                     math.ceil(fen.width) + 1, math.ceil(fen.height) + 1)
        fen = fen.intersection(Window(0, 0, dst.width, dst.height))
    except WindowError:
        return
    tmp = np.full((int(fen.height), int(fen.width)), np.nan, np.float64)
    reproject(source=z, destination=tmp, src_transform=t_src, src_crs=crs, src_nodata=np.nan,
              dst_transform=dst.window_transform(fen), dst_crs=crs, dst_nodata=np.nan,
              resampling=Resampling.bilinear)
    Preparateur.fusionne(dst, tmp, fen)


# -- Sondes eparses et cartes S-57 : maillage par triangulation -------------

def _decoupe(ligne, sep):
    return ligne.split() if sep == ' ' else ligne.split(sep)


def _nombres(morceaux, cols, sep):
    # virgule decimale admise des que la virgule n'est pas le separateur
    return [float(morceaux[c].strip() if sep == ',' else morceaux[c].strip().replace(',', '.')) for c in cols]


def lit_semis(chemin, s):
    """Lit un semis x y z tolerant : separateur detecte par essai sur la premiere
    ligne numerique (; tabulation espaces ,), virgule decimale acceptee, lignes
    d'en-tete et commentaires ignores."""
    cols = [int(c) for c in s.colonnes]
    sep = s.separateur
    xs, ys, zs = [], [], []
    ignorees = 0
    with open(chemin, 'r', encoding='utf-8', errors='replace') as f:
        for ligne in f:
            ligne = ligne.strip()
            if not ligne or ligne.startswith(('#', '//', '!')):
                continue
            v = None
            if sep is None:
                for candidat in (';', '\t', ' ', ','):
                    try:
                        v = _nombres(_decoupe(ligne, candidat), cols, candidat)
                        sep = candidat
                        break
                    except (ValueError, IndexError):
                        continue
            else:
                try:
                    v = _nombres(_decoupe(ligne, sep), cols, sep)
                except (ValueError, IndexError):
                    v = None
            if v is None:
                ignorees += 1
                continue
            xs.append(v[0])
            ys.append(v[1])
            zs.append(v[2])
    return np.array(xs), np.array(ys), np.array(zs), ignorees


def lit_s57(chemin):
    """Sondes (SOUNDG) et isobathes cartographiees (DEPCNT) d'une carte S-57 ou
    d'une carte fluviale IENC : des points (lon, lat, profondeur) pour la
    triangulation. Les isobathes y entrent comme lignes de points, ce que font
    les hydrographes pour contraindre une surface entre des sondes eparses."""
    try:
        import pyogrio
        import shapely
    except ImportError as e:
        raise Erreur(f'Lecture S-57 : dependance manquante ({e.name}) -- pip install pyogrio shapely.')
    couches = {c[0] for c in pyogrio.list_layers(chemin)}
    xs, ys, zs = [], [], []
    if 'SOUNDG' in couches:
        _, _, geoms, _ = pyogrio.raw.read(chemin, layer='SOUNDG')
        for g in shapely.from_wkb(geoms):
            if g is None or g.is_empty:
                continue
            c = shapely.get_coordinates(g, include_z=True)
            c = c[np.isfinite(c[:, 2])]
            xs.append(c[:, 0])
            ys.append(c[:, 1])
            zs.append(c[:, 2])
    if 'DEPCNT' in couches:
        _, _, geoms, champs = pyogrio.raw.read(chemin, layer='DEPCNT', columns=['VALDCO'])
        for g, v in zip(shapely.from_wkb(geoms), champs[0]):
            if g is None or g.is_empty or v is None or not np.isfinite(v):
                continue
            # un point tous les ~5 m le long de l'isobathe
            c = shapely.get_coordinates(shapely.segmentize(g, max_segment_length=0.00005))
            xs.append(c[:, 0])
            ys.append(c[:, 1])
            zs.append(np.full(len(c), float(v)))
    if not xs:
        raise Erreur(f'{chemin} : ni sondes (SOUNDG) ni isobathes (DEPCNT) -- rien a mailler.')
    return np.concatenate(xs), np.concatenate(ys), np.concatenate(zs)


def prepare_semis(s, cfg, sortie):
    from scipy.spatial import Delaunay, cKDTree

    prep = Preparateur(s)
    crs_src = CRS.from_user_input(s.crs)
    X, Y, Z = [], [], []
    for f in s.fichiers:
        if s.type == 's57':
            x, y, z = lit_s57(f)
        else:
            x, y, z, ignorees = lit_semis(f, s)
            if ignorees > 1:
                print(f'    {os.path.basename(f)} : {ignorees} lignes non numeriques ignorees')
        X.append(x)
        Y.append(y)
        Z.append(z)
    x, y, z = np.concatenate(X), np.concatenate(Y), np.concatenate(Z)
    ok = np.isfinite(x) & np.isfinite(y) & np.isfinite(z)
    x, y, z = x[ok], y[ok], prep.convertit(z[ok])
    if len(x) < 3:
        raise Erreur(f'Source « {s.nom} » : moins de trois sondes exploitables.')
    # Repere de maillage : celui du semis s'il est projete, Web Mercator sinon.
    if crs_src.is_geographic:
        if cfg.emprise:
            garde = (x >= cfg.emprise[0]) & (x <= cfg.emprise[2]) & (y >= cfg.emprise[1]) & (y <= cfg.emprise[3])
            x, y, z = x[garde], y[garde], z[garde]
        lat = float(np.median(y))
        gx, gy = transforme_points(crs_src, WEB_MERCATOR, x.tolist(), y.tolist())
        x, y, crs_m = np.asarray(gx), np.asarray(gy), WEB_MERCATOR
        echelle = 1.0 / math.cos(math.radians(lat))     # unites 3857 par metre au sol
    else:
        crs_m, echelle = crs_src, 1.0
        if cfg.emprise:
            e = transform_bounds(WGS84, crs_src, *cfg.emprise, densify_pts=21)
            garde = (x >= e[0]) & (x <= e[2]) & (y >= e[1]) & (y <= e[3])
            x, y, z = x[garde], y[garde], z[garde]
    if len(x) < 3:
        return None
    pts = np.column_stack([x, y])
    pts, inverse = np.unique(pts, axis=0, return_inverse=True)
    z = np.bincount(inverse.ravel(), weights=z) / np.bincount(inverse.ravel())   # sondes confondues : moyenne
    d, _ = cKDTree(pts).query(pts, k=2)
    espacement = float(np.median(d[:, 1])) / echelle
    res_m = float(s.resolution) if s.resolution else pas_joli_au_plus(max(0.5, espacement))
    tri = Delaunay(pts)
    sommets = pts[tri.simplices]
    aretes = np.stack([np.linalg.norm(sommets[:, i] - sommets[:, (i + 1) % 3], axis=1) for i in range(3)], 1) / echelle
    arete_max = float(s.arete_max) if s.arete_max else 3.0 * float(np.percentile(aretes, 90))
    triangle_ok = aretes.max(1) <= arete_max
    pas = res_m * echelle
    gauche = math.floor(pts[:, 0].min() / pas) * pas
    haut = math.ceil(pts[:, 1].max() / pas) * pas
    largeur = int(math.ceil((pts[:, 0].max() - gauche) / pas)) + 1
    hauteur = int(math.ceil((haut - pts[:, 1].min()) / pas)) + 1
    t_dst = from_origin(gauche, haut, pas, pas)
    with rasterio.open(sortie, 'w+', **Preparateur.profil(crs_m, t_dst, largeur, hauteur)) as dst:
        for l0 in range(0, hauteur, 512):
            nl = min(512, hauteur - l0)
            cc, ll = np.meshgrid(np.arange(largeur) + 0.5, np.arange(l0, l0 + nl) + 0.5)
            gx = gauche + cc.ravel() * pas
            gy = haut - ll.ravel() * pas
            q = np.column_stack([gx, gy])
            simplexe = tri.find_simplex(q)
            bon = simplexe >= 0
            bon[bon] = triangle_ok[simplexe[bon]]
            valeurs = np.full(q.shape[0], np.nan)
            if bon.any():
                sp = simplexe[bon]
                tr = tri.transform[sp]
                b = np.einsum('ijk,ik->ij', tr[:, :2], q[bon] - tr[:, 2])
                poids = np.column_stack([b, 1 - b.sum(1)])
                valeurs[bon] = (z[tri.simplices[sp]] * poids).sum(1)
            morceau = valeurs.reshape(nl, largeur)
            t_m = t_dst * Affine.translation(0, l0)
            morceau = prep.corrige(morceau, t_m, crs_m)
            dst.write(np.where(np.isnan(morceau), NODATA, morceau).astype(np.float32), 1,
                      window=Window(0, l0, largeur, nl))
        Preparateur.construit_apercus(dst)
    return dict(res=(pas, pas), crs=crs_m, res_m=res_m, arete_max=arete_max, sondes=len(pts))


def prepare_sources(cfg, dossier, bavard=True):
    os.makedirs(dossier, exist_ok=True)
    manifeste_chemin = os.path.join(dossier, 'sources.json')
    manifeste = {}
    if os.path.exists(manifeste_chemin):
        with open(manifeste_chemin, encoding='utf-8') as f:
            manifeste = json.load(f)
    familles = []
    for rang, s in enumerate(cfg.sources, 1):
        cle = cle_source(s, cfg)
        chemin = os.path.join(dossier, f'source_{cle}.tif')
        if cle in manifeste and os.path.exists(chemin):
            meta = manifeste[cle]
            if bavard:
                print(f'  {s.nom} : preparation reutilisee')
        else:
            t0 = time.time()
            if bavard:
                print(f'  {s.nom} : preparation de {len(s.fichiers)} fichier(s)...', flush=True)
            info = (prepare_semis if s.type in ('sondes', 's57') else prepare_grille)(s, cfg, chemin)
            if info is None:
                print(f'  {s.nom} : aucune donnee dans l\'emprise, source ignoree')
                continue
            meta = decrit_famille(s, chemin, info, rang)
            manifeste[cle] = meta
            with open(manifeste_chemin, 'w', encoding='utf-8') as f:
                json.dump(manifeste, f, ensure_ascii=False, indent=1)
            if bavard:
                print(f'    fait en {time.time() - t0:.1f} s')
        familles.append(meta)
    # De la moins a la plus prioritaire : la derniere posee l'emporte.
    familles.sort(key=lambda m: (m['priorite'], m['rang']))
    return familles


def decrit_famille(s, chemin, info, rang):
    with rasterio.open(chemin) as ds:
        bornes = tuple(ds.bounds)
        crs = ds.crs
    ll = transform_bounds(crs, WGS84, *bornes, densify_pts=21)
    b3857 = transform_bounds(crs, WEB_MERCATOR, *bornes, densify_pts=21)
    res_m = info.get('res_m') or res_metres(crs, info['res'], bornes)
    pas_min = float(s.pas_min) if s.pas_min else pas_min_de_resolution(res_m)
    # Priorite par defaut : la plus fine gagne, par demi-octave de resolution ; a
    # resolution comparable (Litto3D au metre et un leve au metre), la source
    # declaree en dernier l'emporte, comme l'ordre des couches d'un SIG.
    priorite = float(s.priorite) if s.priorite is not None else -round(2 * math.log2(max(res_m, 1e-3))) / 2
    return dict(nom=s.nom, chemin=chemin, rang=rang, res_m=res_m, pas_min=pas_min, priorite=priorite,
                crs_source=s.crs or crs.to_string(),
                bornes3857=b3857, bornes_lonlat=ll, crs=crs.to_string(),
                reference=s.reference, decalage=float(s.decalage), surface=s.surface,
                correction=bool(s.correction), type=s.type, fichiers=len(s.fichiers),
                attribution=s.attribution or s.nom,
                arete_max=info.get('arete_max'), sondes=info.get('sondes'))


# ---------------------------------------------------------------------------
# Tuiles a produire
# ---------------------------------------------------------------------------

def tuiles_de_famille(meta, z, emprise3857=None):
    """Tuiles du zoom z qui contiennent au moins une donnee de la source, lues
    sur ses apercus au quart de la taille d'une tuile."""
    ens = set()
    with rasterio.open(meta['chemin']) as ds:
        lat = (meta['bornes_lonlat'][1] + meta['bornes_lonlat'][3]) / 2
        cote_sol = 2 * R_MERCATOR / (1 << z) * math.cos(math.radians(lat))
        facteur = max(1.0, (cote_sol / 4) / meta['res_m'])
        fen = Window(0, 0, ds.width, ds.height)
        if emprise3857:
            try:
                e = transform_bounds(WEB_MERCATOR, ds.crs, *emprise3857, densify_pts=21)
                fen = fenetre_de_bornes(*e, transform=ds.transform)
                fen = Window(math.floor(fen.col_off), math.floor(fen.row_off),
                             math.ceil(fen.width) + 1, math.ceil(fen.height) + 1)
                fen = fen.intersection(Window(0, 0, ds.width, ds.height))
            except WindowError:
                return ens
        pas_lignes = max(1, int(4096 * facteur))
        for l0 in range(int(fen.row_off), int(fen.row_off + fen.height), pas_lignes):
            morceau = Window(fen.col_off, l0, fen.width, min(pas_lignes, fen.row_off + fen.height - l0))
            oh = max(1, math.ceil(morceau.height / facteur))
            ow = max(1, math.ceil(morceau.width / facteur))
            d = ds.read(1, window=morceau, out_shape=(oh, ow),
                        resampling=Resampling.average if facteur > 1 else Resampling.nearest)
            lignes, colonnes = np.nonzero(d != NODATA)
            if not lignes.size:
                continue
            t = ds.window_transform(morceau) * Affine.scale(morceau.width / ow, morceau.height / oh)
            coins_x, coins_y = [], []
            for dc, dl in ((0, 0), (1, 0), (0, 1), (1, 1)):
                cx, cy = t * (colonnes + dc, lignes + dl)
                coins_x.append(cx)
                coins_y.append(cy)
            px, py = transforme_points(ds.crs, WEB_MERCATOR, np.concatenate(coins_x).tolist(),
                                       np.concatenate(coins_y).tolist())
            px = np.asarray(px).reshape(4, -1)
            py = np.asarray(py).reshape(4, -1)
            x0, x1, y0, y1 = px.min(0), px.max(0), py.min(0), py.max(0)
            if emprise3857:
                garde = (x1 > emprise3857[0]) & (x0 < emprise3857[2]) & (y1 > emprise3857[1]) & (y0 < emprise3857[3])
                x0, x1, y0, y1 = (np.maximum(x0, emprise3857[0])[garde], np.minimum(x1, emprise3857[2])[garde],
                                  np.maximum(y0, emprise3857[1])[garde], np.minimum(y1, emprise3857[3])[garde])
            for a, b, c, dd in zip(x0, y0, x1, y1):
                tx0, tx1, ty0, ty1 = plage_tuiles(z, (a, b, c, dd))
                for tx in range(tx0, tx1 + 1):
                    for ty in range(ty0, ty1 + 1):
                        ens.add((tx, ty))
    return ens


def zooms_utiles(cfg, familles):
    lat = sum((m['bornes_lonlat'][1] + m['bornes_lonlat'][3]) / 2 for m in familles) / len(familles)
    plus_fine = min(m['res_m'] for m in familles)
    zmax = cfg.zoom_max if cfg.zoom_max is not None else min(18, zoom_natif(plus_fine, lat))
    zmin = cfg.zoom_min if cfg.zoom_min is not None else max(0, zmax - 7)
    if zmin > zmax:
        raise Erreur(f'zoom_min ({zmin}) superieur a zoom_max ({zmax}).')
    zdetail = cfg.zoom_detail if cfg.zoom_detail is not None else max(zmin, zmax - 1)
    for m in familles:
        lat_m = (m['bornes_lonlat'][1] + m['bornes_lonlat'][3]) / 2
        # Par defaut chaque source va jusqu'au zoom maximal : une meme carte a tous les
        # zooms, sans trou au large quand on s'approche. max_tuiles garde le volume.
        m['zoom_utile'] = zmax if cfg.surzoom is None else min(zmax, zoom_natif(m['res_m'], lat_m) + cfg.surzoom)
    return zmin, zmax, zdetail


def ensemble_tuiles(cfg, familles, zmin, zmax):
    emprise3857 = transform_bounds(WGS84, WEB_MERCATOR, *cfg.emprise, densify_pts=21) if cfg.emprise else None
    par_zoom, total = {}, 0
    for z in range(zmin, zmax + 1):
        ens = set()
        for m in familles:
            if z <= m['zoom_utile']:
                ens |= tuiles_de_famille(m, z, emprise3857)
        par_zoom[z] = sorted(ens)
        total += len(ens)
        if total > cfg.max_tuiles:
            # Chaque zoom multiplie le volume par quatre : inutile d'enumerer les suivants.
            raise Erreur(f'Deja {total} tuiles au zoom {z} (limite max_tuiles = {cfg.max_tuiles}), '
                         f'avec {zmax - z} zoom(s) encore a venir. Restreindre l\'emprise a la zone utile, '
                         f'abaisser zoom_max, limiter les sources grossieres avec surzoom = 2, ou relever '
                         f'max_tuiles en connaissance de cause.')
    return par_zoom


# ---------------------------------------------------------------------------
# Rendu d'une tuile
# ---------------------------------------------------------------------------

class SourceOuverte:
    def __init__(self, meta):
        self.meta = meta
        self.ds = rasterio.open(meta['chemin'])
        self.b = meta['bornes3857']
        self.res_m = meta['res_m']
        self.pas_min = meta['pas_min']

    def touche(self, b):
        return self.b[0] < b[2] and self.b[2] > b[0] and self.b[1] < b[3] and self.b[3] > b[1]

    def lit(self, t, n, pixel_sol_m):
        """Valeurs de la source sur la grille n x n de la tuile (EPSG:3857), NaN ailleurs.
        Lecture sur l'apercu adapte, puis interpolation bilineaire."""
        ds = self.ds
        sortie = np.full((n, n), NODATA, np.float32)
        ouest, nord = t.c, t.f
        est, sud = ouest + n * t.a, nord + n * t.e
        try:
            b = transform_bounds(WEB_MERCATOR, ds.crs, ouest, sud, est, nord, densify_pts=21)
            fen = fenetre_de_bornes(*b, transform=ds.transform)
            fen = Window(math.floor(fen.col_off) - 2, math.floor(fen.row_off) - 2,
                         math.ceil(fen.width) + 5, math.ceil(fen.height) + 5)
            fen = fen.intersection(Window(0, 0, ds.width, ds.height))
        except WindowError:
            return np.full((n, n), np.nan, np.float32)
        # Sous un facteur 2, lecture a pleine resolution : une decimation au plus proche
        # voisin deplacerait les valeurs d'un demi-pixel source. Au-dela, moyenne sur les
        # apercus, sans biais pour une surface reguliere.
        facteur = pixel_sol_m / self.res_m
        if facteur < 2:
            oh, ow = int(fen.height), int(fen.width)
        else:
            oh = max(1, int(math.ceil(fen.height / facteur)))
            ow = max(1, int(math.ceil(fen.width / facteur)))
        donnees = ds.read(1, window=fen, out_shape=(oh, ow), resampling=Resampling.average)
        t_src = ds.window_transform(fen) * Affine.scale(fen.width / ow, fen.height / oh)
        reproject(source=donnees, destination=sortie, src_transform=t_src, src_crs=ds.crs,
                  src_nodata=NODATA, dst_transform=t, dst_crs=WEB_MERCATOR, dst_nodata=NODATA,
                  resampling=Resampling.bilinear)
        sortie[sortie == NODATA] = np.nan
        return sortie


class Rendu:
    """Etat d'un processus de rendu : sources ouvertes une fois pour toutes."""

    def __init__(self, etat):
        self.sources = [SourceOuverte(m) for m in etat['familles']]
        self.intervalles = {int(k): v for k, v in etat['intervalles'].items()}
        self.zoom_detail = etat.get('zoom_detail', max(self.intervalles))
        self.teintes = etat['teintes']
        self.etiquettes = etat['etiquettes']
        self.fond = etat['fond']
        self.couleurs_teintes = couleurs_teintes(len(self.teintes))
        try:
            self.police = ImageFont.load_default(size=10 * SUR)
        except TypeError:  # Pillow < 10.1 : police bitmap, sans taille
            self.police = ImageFont.load_default()

    def compose(self, z, x, y):
        """Altitudes (reference de la carte) et pas minimal, sur la grille de la
        tuile elargie de MARGE pixels. La source la plus prioritaire gagne."""
        ouest, sud, est, nord = bornes_tuile(z, x, y)
        p = (est - ouest) / TAILLE
        n = TAILLE + 2 * MARGE
        t = Affine(p, 0, ouest - MARGE * p, 0, -p, nord + MARGE * p)
        lat = latitude_y3857((sud + nord) / 2)
        alt = np.full((n, n), np.nan, np.float32)
        pas = np.full((n, n), np.nan, np.float32)
        elargie = (ouest - MARGE * p, sud - MARGE * p, est + MARGE * p, nord + MARGE * p)
        for s in self.sources:
            if not s.touche(elargie):
                continue
            a = s.lit(t, n, p * math.cos(math.radians(lat)))
            ok = np.isfinite(a)
            alt[ok] = a[ok]
            pas[ok] = s.pas_min
        return alt, pas

    def tuile(self, z, x, y):
        alt, pas = self.compose(z, x, y)
        if not np.isfinite(alt[MARGE:-MARGE, MARGE:-MARGE]).any():
            return None, []
        img, niveaux = self.dessine(alt, pas, z)
        return img, niveaux

    def dessine(self, alt, pas, z):
        C = TAILLE * SUR
        toile = Image.fromarray(self.teinte(alt), 'RGBA') if self.teintes else Image.new('RGBA', (C, C))
        crayon = ImageDraw.Draw(toile)
        intervalle = self.intervalles[z]
        maitre = pas_maitresse(intervalle)
        a_max, a_min = float(np.nanmax(alt)), float(np.nanmin(alt))
        niveaux = [0.0] if a_max >= 0.0 >= a_min else []
        d_haut = max(0.0, -a_max)
        k0 = max(1, int(math.ceil(d_haut / intervalle - 1e-9)))
        k1 = int(math.floor(-a_min / intervalle + 1e-9))
        niveaux += [k * intervalle for k in range(k0, k1 + 1)]
        presents = sorted(float(v) for v in np.unique(pas[np.isfinite(pas)]))
        # Un niveau n'est trace que la ou la source qui couvre le pixel sait le porter.
        groupes = {}
        for d in niveaux:
            porteurs = tuple(pp for pp in presents if d == 0.0 or est_multiple(d, pp))
            if porteurs:
                groupes.setdefault(porteurs, []).append(d)
        # Generalisation : aux zooms de vue d'ensemble, une boucle fermee de moins de
        # 16 px (un ecueil de quelques metres) n'est qu'un point illisible ; aux zooms de
        # detail on la garde -- une tete de roche est ce qu'un bateau doit voir. Les
        # boucles de moins de 4 px sont du bruit a tous les zooms.
        boucle_min = (16 if z < self.zoom_detail else 4) * SUR
        traces, a_etiqueter = [], []
        for porteurs, ds in groupes.items():
            masque = np.isin(pas, porteurs) & np.isfinite(alt)
            gen = contourpy.contour_generator(z=np.ma.array(alt, mask=~masque), line_type='Separate')
            for d in ds:
                style = 'zero' if d == 0.0 else ('maitresse' if est_multiple(d, maitre) else 'normale')
                couleur, epaisseur = STYLES[style]
                lignes = [((l - MARGE + 0.5) * SUR - 0.5) for l in gen.lines(-d) if len(l) >= 2]
                lignes = [l for l in lignes if not (fermee(l) and longueur(l) < boucle_min)]
                largeur = int(round(epaisseur * SUR)) | 1
                for l in lignes:
                    # Pillow tronque les coordonnees et decentre les traits de largeur paire :
                    # on arrondit soi-meme et on ne trace qu'en largeur impaire, pour que
                    # l'isobathe tombe a sa place a 1/8 de pixel pres.
                    crayon.line([(int(round(px)), int(round(py))) for px, py in l], fill=couleur,
                                width=largeur, joint='curve')
                    if style == 'maitresse':        # le zero se lit a son trait, sans cote
                        a_etiqueter.append((d, l))
                if lignes:
                    traces.append((d, style))
        if self.etiquettes:
            place_etiquettes(toile, a_etiqueter, self.police)
        # Reduction par moyenne de surface : exacte pour un dessin au trait, sans les lobes
        # negatifs de LANCZOS qui deplacent le centre des traits fins.
        petite = toile.convert('RGBa').resize((TAILLE, TAILLE), Image.BOX).convert('RGBA')
        return petite, traces

    def teinte(self, alt):
        """Bandes de profondeur teintees, du plus fonce (hauts-fonds) au plus clair,
        calculees sur une altitude interpolee a la resolution de la toile."""
        C = TAILLE * SUR
        interieur = alt[MARGE:-MARGE, MARGE:-MARGE]
        f = np.where(np.isfinite(interieur), interieur, 9999.0).astype(np.float32)
        grand = np.asarray(Image.fromarray(f).resize((C, C), Image.BILINEAR))
        rgba = np.zeros((C, C, 4), np.uint8)
        prof = -grand
        haut = 0.0
        for borne, couleur in zip(self.teintes, self.couleurs_teintes):
            rgba[(prof > haut) & (prof <= borne) & (grand < 9000)] = couleur
            haut = borne
        return rgba


def couleurs_teintes(n):
    """Bleus du nautique : fonce pour les hauts-fonds, de plus en plus clair et transparent."""
    fonce, clair = np.array([110, 170, 222, 160]), np.array([220, 236, 250, 70])
    if n <= 1:
        return [tuple(int(v) for v in fonce)] * n
    return [tuple(int(round(v)) for v in fonce + (clair - fonce) * i / (n - 1)) for i in range(n)]


def place_etiquettes(toile, lignes, police):
    """Cote des maitresses, posee dans l'axe de la ligne sur un halo blanc qui
    interrompt le trait, sans chevauchement ni debord de tuile."""
    C = toile.width
    marge = 5 * SUR
    placees = []
    for d, pts in sorted(lignes, key=lambda l: -longueur(l[1])):
        dedans = ((pts[:, 0] >= marge) & (pts[:, 0] <= C - marge)
                  & (pts[:, 1] >= marge) & (pts[:, 1] <= C - marge))
        troncon = plus_long_troncon(pts, dedans)
        if troncon is None:
            continue
        texte = texte_profondeur(d)
        img = rendu_texte(texte, police)
        cumul = np.concatenate([[0.0], np.cumsum(np.linalg.norm(np.diff(troncon, axis=0), axis=1))])
        total = cumul[-1]
        if total < max(img.width * 2.5, 64 * SUR):
            continue
        milieu = total / 2
        p = point_a(troncon, cumul, milieu)
        a = point_a(troncon, cumul, max(0.0, milieu - img.width * 0.6))
        b = point_a(troncon, cumul, min(total, milieu + img.width * 0.6))
        angle = math.degrees(math.atan2(b[1] - a[1], b[0] - a[0]))
        if angle > 90:
            angle -= 180
        elif angle < -90:
            angle += 180
        tourne = img.rotate(-angle, resample=Image.BICUBIC, expand=True)
        x0, y0 = int(round(p[0] - tourne.width / 2)), int(round(p[1] - tourne.height / 2))
        boite = (x0, y0, x0 + tourne.width, y0 + tourne.height)
        if boite[0] < 0 or boite[1] < 0 or boite[2] > C or boite[3] > C:
            continue
        ecart = 28 * SUR
        if any(boite[0] < q[2] + ecart and boite[2] + ecart > q[0] and boite[1] < q[3] + ecart
               and boite[3] + ecart > q[1] for q in placees):
            continue
        toile.alpha_composite(tourne, (x0, y0))
        placees.append(boite)


def rendu_texte(texte, police):
    halo = max(2, SUR)
    x0, y0, x1, y1 = police.getbbox(texte, stroke_width=halo)
    img = Image.new('RGBA', (x1 - x0 + 2, y1 - y0 + 2), (0, 0, 0, 0))
    ImageDraw.Draw(img).text((1 - x0, 1 - y0), texte, font=police, fill=COULEUR_ETIQUETTE,
                             stroke_width=halo, stroke_fill=COULEUR_HALO)
    return img


def fermee(pts):
    return len(pts) > 2 and abs(pts[0][0] - pts[-1][0]) < 1e-6 and abs(pts[0][1] - pts[-1][1]) < 1e-6


def longueur(pts):
    return float(np.linalg.norm(np.diff(pts, axis=0), axis=1).sum()) if len(pts) > 1 else 0.0


def plus_long_troncon(pts, dedans):
    meilleur, debut = None, None
    for i, v in enumerate(list(dedans) + [False]):
        if v and debut is None:
            debut = i
        elif not v and debut is not None:
            if i - debut >= 2 and (meilleur is None or longueur(pts[debut:i]) > longueur(meilleur)):
                meilleur = pts[debut:i]
            debut = None
    return meilleur


def point_a(pts, cumul, s):
    i = int(np.searchsorted(cumul, s))
    if i <= 0:
        return pts[0]
    if i >= len(pts):
        return pts[-1]
    t = (s - cumul[i - 1]) / max(1e-9, cumul[i] - cumul[i - 1])
    return pts[i - 1] + (pts[i] - pts[i - 1]) * t


# -- Fond et encodage ------------------------------------------------------

def telecharge(url, essais=3):
    for i in range(essais):
        try:
            req = urllib.request.Request(url, headers={'User-Agent': 'Carroyage-JMT/bathy_mbtiles'})
            with urllib.request.urlopen(req, timeout=30) as r:
                return r.read()
        except urllib.error.HTTPError as e:
            if e.code not in (429, 500, 502, 503, 504):
                return None
        except (urllib.error.URLError, TimeoutError, OSError):
            pass
        time.sleep(2 ** i)
    return None


def gabarit_fond(fond):
    if fond in (None, 'aucun'):
        return None
    return FONDS[fond][0] if fond in FONDS else fond


_RENDU = None


def _init_rendu(etat):
    global _RENDU
    _RENDU = Rendu(etat)


def rend_tuile(zxy):
    """Point d'entree d'un processus de rendu : (z, x, y) -> (z, x, y, png ou None, fond_ok)."""
    z, x, y = zxy
    img, _ = _RENDU.tuile(z, x, y)
    if img is None:
        return z, x, y, None, True
    fond_ok = True
    modele = gabarit_fond(_RENDU.fond)
    if modele:
        brut = telecharge(modele.replace('{z}', str(z)).replace('{x}', str(x)).replace('{y}', str(y)))
        if brut is None:
            fond_ok = False
        else:
            base = Image.open(io.BytesIO(brut)).convert('RGBA')
            if base.size != (TAILLE, TAILLE):
                base = base.resize((TAILLE, TAILLE), Image.LANCZOS)
            base.alpha_composite(img)
            img = base
    elif img.getextrema()[3][1] == 0:
        return z, x, y, None, True
    tampon = io.BytesIO()
    img.save(tampon, format='PNG', compress_level=6)
    return z, x, y, tampon.getvalue(), fond_ok


# ---------------------------------------------------------------------------
# Ecriture MBTiles
# ---------------------------------------------------------------------------

def ecrit_mbtiles(cfg, familles, par_zoom, zdetail, intervalles, bavard=True):
    etat = dict(familles=familles, intervalles=intervalles, teintes=cfg.teintes,
                etiquettes=cfg.etiquettes, fond=cfg.fond, zoom_detail=zdetail)
    provisoire = cfg.sortie + '.partiel'
    if os.path.exists(provisoire):
        os.remove(provisoire)
    con = sqlite3.connect(provisoire)
    con.execute('PRAGMA journal_mode=OFF')
    con.execute('PRAGMA synchronous=OFF')
    con.executescript("""
        CREATE TABLE metadata (name text, value text);
        CREATE TABLE tiles (zoom_level integer, tile_column integer, tile_row integer, tile_data blob);
        CREATE UNIQUE INDEX tile_index on tiles (zoom_level, tile_column, tile_row);
    """)
    liste = [(z, x, y) for z in sorted(par_zoom) for (x, y) in par_zoom[z]]
    nproc = cfg.processus or max(1, (os.cpu_count() or 2) - 1)
    ecrites, vides, echecs_fond = 0, 0, 0
    zooms_ecrits = set()
    t0 = dernier = time.time()

    def consomme(resultat):
        nonlocal ecrites, vides, echecs_fond
        z, x, y, png, fond_ok = resultat
        if not fond_ok:
            echecs_fond += 1
        if png is None:
            vides += 1
            return
        con.execute('INSERT INTO tiles VALUES (?, ?, ?, ?)', (z, x, (1 << z) - 1 - y, png))
        ecrites += 1
        zooms_ecrits.add(z)

    def avance(i):
        nonlocal dernier
        if not bavard or (time.time() - dernier < 1 and i < len(liste)):
            return
        dernier = time.time()
        ecoule = dernier - t0
        vitesse = i / ecoule if ecoule else 0
        reste = (len(liste) - i) / vitesse if vitesse else 0
        print(f'\r  {i}/{len(liste)} tuiles ({100 * i // max(1, len(liste))} %) -- '
              f'{vitesse:.1f} tuiles/s -- reste ~{reste / 60:.0f} min   ', end='', flush=True)

    if nproc == 1 or len(liste) < 64:
        _init_rendu(etat)
        for i, zxy in enumerate(liste, 1):
            consomme(rend_tuile(zxy))
            avance(i)
    else:
        with cf.ProcessPoolExecutor(max_workers=nproc, initializer=_init_rendu, initargs=(etat,)) as pool:
            for i, r in enumerate(pool.map(rend_tuile, liste, chunksize=8), 1):
                consomme(r)
                avance(i)
    if bavard:
        print()
    if not ecrites:
        con.close()
        os.remove(provisoire)
        raise Erreur('Aucune tuile produite : aucune donnee dans les zooms et l\'emprise demandes.')

    ll = [m['bornes_lonlat'] for m in familles]
    bornes = [min(b[0] for b in ll), min(b[1] for b in ll), max(b[2] for b in ll), max(b[3] for b in ll)]
    if cfg.emprise:
        bornes = [max(bornes[0], cfg.emprise[0]), max(bornes[1], cfg.emprise[1]),
                  min(bornes[2], cfg.emprise[2]), min(bornes[3], cfg.emprise[3])]
    attributions = list(dict.fromkeys(m['attribution'] for m in reversed(familles)))
    if cfg.fond in FONDS:
        attributions.append(FONDS[cfg.fond][1])
    zmin_e, zmax_e = min(zooms_ecrits), max(zooms_ecrits)
    meta = {
        'name': cfg.nom or os.path.splitext(os.path.basename(cfg.sortie))[0],
        'format': 'png',
        'type': 'baselayer',     # comme carroyageToMbtiles.js : les drones DJI refusent « overlay »
        'version': '1.0',
        'scheme': 'tms',
        'minzoom': str(zmin_e),
        'maxzoom': str(zmax_e),
        'bounds': ','.join(f'{v:.6f}' for v in bornes),
        'center': f'{(bornes[0] + bornes[2]) / 2:.6f},{(bornes[1] + bornes[3]) / 2:.6f},{max(zmin_e, zmax_e - 3)}',
        'attribution': ' — '.join(attributions),
        'description': (f'Isobathes au pas de {texte_profondeur(cfg.intervalle)} m a partir du zoom {zdetail}, '
                        f'profondeurs rapportees a la reference {cfg.reference}. Sources : '
                        + ', '.join(m['nom'] for m in reversed(familles)) + '.'),
        'bathy_reference': cfg.reference,
        'bathy_intervalle': str(cfg.intervalle),
        'bathy_sources': json.dumps([{k: m[k] for k in ('nom', 'res_m', 'pas_min', 'reference', 'decalage',
                                                         'surface', 'correction', 'type')}
                                     for m in familles], ensure_ascii=False),
    }
    con.executemany('INSERT INTO metadata VALUES (?, ?)', list(meta.items()))
    con.commit()
    con.close()
    os.replace(provisoire, cfg.sortie)
    return dict(ecrites=ecrites, vides=vides, echecs_fond=echecs_fond, duree=time.time() - t0,
                zmin=zmin_e, zmax=zmax_e)


# ---------------------------------------------------------------------------
# Rapport et programme principal
# ---------------------------------------------------------------------------

def avertissements(cfg, familles):
    msgs = []
    for m in familles:
        if m['surface'] is not None:
            continue
        if not m['reference']:
            msgs.append(f'« {m["nom"]} » : reference verticale non declaree -- impossible de verifier '
                        f'qu\'elle concorde avec {cfg.reference}.')
        elif m['reference'] != cfg.reference and m['decalage'] == 0.0 and not m['correction']:
            msgs.append(f'« {m["nom"]} » est en {m["reference"]}, la carte en {cfg.reference}, sans decalage '
                        f'ni grille de correction : l\'ecart entre ces zeros atteint plusieurs metres en zone '
                        f'de maree, bien plus que le pas des isobathes.')
    return msgs


def rapport_sources(cfg, familles):
    print('\nSources, de la moins a la plus prioritaire :')
    for i, m in enumerate(familles, 1):
        if m['surface'] is not None:
            ref = f'plan d\'eau a {nombre_fr(float(m["surface"]))} m'
        else:
            ref = f'{m["reference"] or "?"} -> {cfg.reference}'
            if m['decalage']:
                ref += f', decalage {nombre_fr(m["decalage"])} m'
            if m['correction']:
                ref += ', grille de correction'
        extra = f', {m["sondes"]} sondes, arete max {m["arete_max"]:.0f} m' if m.get('sondes') else ''
        systeme = m['crs'] if m['type'] == 'grille' else f'{m["crs_source"]}, maille en {m["crs"]}'
        print(f'  {i}. {m["nom"]} ({m["type"]}, {m["fichiers"]} fichier(s), {systeme}) -- '
              f'resolution ~{m["res_m"]:.3g} m, isobathes >= {texte_profondeur(m["pas_min"])} m, '
              f'jusqu\'au zoom {m.get("zoom_utile", "?")}{extra} -- {ref}')


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('config', help='fichier de configuration (.toml ou .json)')
    ap.add_argument('--sortie', help='fichier MBTiles produit (remplace celui de la configuration)')
    ap.add_argument('--zoom-min', type=int)
    ap.add_argument('--zoom-max', type=int)
    ap.add_argument('--emprise', help='lon_min,lat_min,lon_max,lat_max')
    ap.add_argument('--processus', type=int, help='processus de rendu (defaut : coeurs - 1)')
    ap.add_argument('--inventaire', action='store_true',
                    help='prepare les sources et annonce pas, zooms et volumes, sans rien produire')
    args = ap.parse_args(argv)
    try:
        surcharges = dict(sortie=os.path.abspath(args.sortie) if args.sortie else None,
                          zoom_min=args.zoom_min, zoom_max=args.zoom_max, processus=args.processus,
                          emprise=[float(v) for v in args.emprise.split(',')] if args.emprise else None)
        cfg = charge_config(args.config, surcharges)
        dossier = cfg.travail or os.path.splitext(cfg.sortie)[0] + '.travail'
        print(f'Preparation des sources (cache : {dossier})')
        familles = prepare_sources(cfg, dossier)
        if not familles:
            raise Erreur('Aucune source n\'a de donnees dans l\'emprise demandee.')
        zmin, zmax, zdetail = zooms_utiles(cfg, familles)
        intervalles = {z: intervalle_au_zoom(z, cfg.intervalle, zdetail) for z in range(zmin, zmax + 1)}
        rapport_sources(cfg, familles)
        print('\nPas des isobathes par zoom : '
              + ' · '.join(f'z{z} {texte_profondeur(v)} m' for z, v in intervalles.items()))
        for msg in avertissements(cfg, familles):
            print(f'  ATTENTION -- {msg}')
        print('\nRecensement des tuiles...', flush=True)
        par_zoom = ensemble_tuiles(cfg, familles, zmin, zmax)
        total = sum(len(v) for v in par_zoom.values())
        print('  ' + ' · '.join(f'z{z} {len(v)}' for z, v in par_zoom.items()) + f' -- total {total}')
        if args.inventaire:
            print('\nInventaire seul : rien n\'a ete produit.')
            return 0
        print(f'\nRendu vers {cfg.sortie}')
        bilan = ecrit_mbtiles(cfg, familles, par_zoom, zdetail, intervalles)
        taille = os.path.getsize(cfg.sortie) / 1e6
        print(f'Termine : {bilan["ecrites"]} tuiles, zooms {bilan["zmin"]} a {bilan["zmax"]}, '
              f'{taille:.1f} Mo, en {bilan["duree"] / 60:.1f} min.')
        if bilan['echecs_fond']:
            print(f'  ATTENTION -- fond indisponible pour {bilan["echecs_fond"]} tuile(s) : '
                  f'elles ne portent que les isobathes.')
        return 0
    except Erreur as e:
        print(f'\nERREUR : {e}', file=sys.stderr)
        return 1


if __name__ == '__main__':
    sys.exit(main())
