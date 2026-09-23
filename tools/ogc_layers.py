#!/usr/bin/env python3
"""Liste les couches servies par un service OGC (WMTS ou WMS).

Les identifiants de couches ne se devinent pas : « RASTER_MARINE_3857_WMTS »
au SHOM, « emodnet:contours » chez EMODnet, et ils changent d'un service à
l'autre. Ce script les imprime, avec leur système de coordonnées et leur plage
de zooms quand le service la déclare, puis rappelle la variable à renseigner
dans config.private.js.

    python3 tools/ogc_layers.py                             # WMTS INSPIRE du SHOM, libre
    python3 tools/ogc_layers.py --cle MA_CLE                # WMTS SHOM sous abonnement
    python3 tools/ogc_layers.py --url https://ows.emodnet-bathymetry.eu/wms
    python3 tools/ogc_layers.py --url <service> --service wmts
    python3 tools/ogc_layers.py --filtre contour            # ne garde que ces couches
    python3 tools/ogc_layers.py --fichier capa.xml          # parse un fichier deja telecharge

Aucune dependance : bibliotheque standard uniquement.
"""
import argparse
import sys
import urllib.request
import xml.etree.ElementTree as ET

SHOM_INSPIRE = 'https://services.data.shom.fr/INSPIRE/wmts'
SHOM_ABONNE = 'https://services.data.shom.fr/{cle}/wmts'
NS = {
    'wmts': 'http://www.opengis.net/wmts/1.0',
    'ows': 'http://www.opengis.net/ows/1.1',
    'wms': 'http://www.opengis.net/wms',
}


def telecharge(url: str, service: str) -> bytes:
    sep = '&' if '?' in url else '?'
    req = urllib.request.Request(
        f'{url}{sep}SERVICE={service.upper()}&VERSION={"1.0.0" if service == "wmts" else "1.3.0"}'
        '&REQUEST=GetCapabilities',
        headers={'User-Agent': 'Carroyage-JMT/ogc_layers'},
    )
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.read()


def couches_wmts(racine):
    for couche in racine.iterfind('.//wmts:Contents/wmts:Layer', NS):
        ident = couche.findtext('ows:Identifier', default='', namespaces=NS)
        titre = couche.findtext('ows:Title', default='', namespaces=NS)
        details = []
        for lien in couche.iterfind('wmts:TileMatrixSetLink', NS):
            nom = lien.findtext('wmts:TileMatrixSet', default='', namespaces=NS)
            niveaux = [m.text for m in lien.iterfind(
                'wmts:TileMatrixSetLimits/wmts:TileMatrixLimits/wmts:TileMatrix', NS)]
            plage = f'z{niveaux[0]} a z{niveaux[-1]}' if niveaux else 'plage non declaree'
            details.append(f'TileMatrixSet {nom} ({plage})')
        yield ident, titre, details


def couches_wms(racine):
    # Les couches WMS s'emboitent ; seules celles qui portent un <Name> sont
    # interrogeables, les autres ne sont que des regroupements.
    def parcours(noeud, crs_herites):
        crs = crs_herites | {c.text for c in noeud.iterfind('wms:CRS', NS) if c.text}
        nom = noeud.findtext('wms:Name', default='', namespaces=NS)
        if nom:
            titre = noeud.findtext('wms:Title', default='', namespaces=NS)
            utiles = sorted(c for c in crs if c in ('EPSG:3857', 'EPSG:4326', 'CRS:84'))
            details = ['CRS : ' + (', '.join(utiles) if utiles else 'aucun des CRS usuels')]
            if 'EPSG:3857' not in crs:
                details.append('ATTENTION : pas de EPSG:3857, inutilisable tel quel')
            yield nom, titre, details
        for fils in noeud.iterfind('wms:Layer', NS):
            yield from parcours(fils, crs)

    for capacite in racine.iterfind('.//wms:Capability', NS):
        for racine_couche in capacite.iterfind('wms:Layer', NS):
            yield from parcours(racine_couche, set())


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--url', help='service a interroger ; par defaut le WMTS INSPIRE du SHOM')
    ap.add_argument('--service', choices=['wmts', 'wms'], help='type de service (devine depuis l\'URL sinon)')
    ap.add_argument('--cle', help="cle d'abonnement SHOM ; sans elle, le service INSPIRE libre")
    ap.add_argument('--filtre', help='ne montre que les couches dont le nom contient ce texte')
    ap.add_argument('--fichier', help='parse un GetCapabilities deja telecharge au lieu du reseau')
    args = ap.parse_args()

    if args.url:
        url = args.url
    elif args.cle:
        url = SHOM_ABONNE.format(cle=args.cle)
    else:
        url = SHOM_INSPIRE
    service = args.service or ('wms' if '/wms' in url.lower() else 'wmts')

    try:
        brut = open(args.fichier, 'rb').read() if args.fichier else telecharge(url, service)
    except OSError as e:
        print(f'Service injoignable ({e}).', file=sys.stderr)
        print('Verifier la cle, le reseau, ou telecharger le GetCapabilities a la main :', file=sys.stderr)
        sep = '&' if '?' in url else '?'
        print(f'  {url}{sep}SERVICE={service.upper()}&REQUEST=GetCapabilities', file=sys.stderr)
        return 1

    try:
        racine = ET.fromstring(brut)
    except ET.ParseError as e:
        print(f'Reponse illisible ({e}) — cle refusee ou page d\'erreur renvoyee ?', file=sys.stderr)
        return 1

    # Le contenu prime sur l'option : un GetCapabilities WMS reste lisible meme
    # si le service a ete devine WMTS (cas d'un --fichier, par exemple).
    trouvees = list(couches_wmts(racine)) or list(couches_wms(racine))

    if args.filtre:
        f = args.filtre.lower()
        trouvees = [c for c in trouvees if f in c[0].lower() or f in (c[1] or '').lower()]

    if not trouvees:
        print('Aucune couche trouvee.' + (' Filtre trop strict ?' if args.filtre else ''))
        return 1

    print(f'{len(trouvees)} couche(s) — source : {args.fichier or url}\n')
    for ident, titre, details in trouvees:
        print(f'  {ident}')
        if titre and titre != ident:
            print(f'      {titre}')
        for d in details:
            print(f'      {d}')

    if 'shom' in url.lower():
        variable = 'SHOM_RASTER_LAYER' if args.cle else 'SHOM_INSPIRE_LAYER'
    elif 'emodnet' in url.lower():
        variable = 'EMODNET_CONTOURS_LAYER'
    else:
        variable = '<variable de la couche>'
    print(f"\nA reporter dans config.private.js, par exemple :\n  var {variable} = '{trouvees[0][0]}';")
    return 0


if __name__ == '__main__':
    sys.exit(main())
