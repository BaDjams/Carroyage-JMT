#!/usr/bin/env python3
"""Liste les couches servies par un WMTS du SHOM.

Les identifiants de couches (« RASTER_MARINE_3857_WMTS », les couches INSPIRE…)
ne sont pas devinables : ils se relèvent sur le GetCapabilities du service. Ce
script les imprime, avec leur TileMatrixSet et leur plage de zooms, et propose
la ligne à coller dans config.private.js.

    python3 tools/shom_layers.py                      # service INSPIRE, libre
    python3 tools/shom_layers.py --cle MA_CLE         # service sous abonnement
    python3 tools/shom_layers.py --filtre raster      # ne garde que ces couches
    python3 tools/shom_layers.py --fichier capa.xml   # parse un fichier deja telecharge

Aucune dependance : bibliotheque standard uniquement.
"""
import argparse
import sys
import urllib.request
import xml.etree.ElementTree as ET

INSPIRE = 'https://services.data.shom.fr/INSPIRE/wmts'
ABONNE = 'https://services.data.shom.fr/{cle}/wmts'
NS = {
    'wmts': 'http://www.opengis.net/wmts/1.0',
    'ows': 'http://www.opengis.net/ows/1.1',
}


def telecharge(url: str) -> bytes:
    req = urllib.request.Request(
        url + '?SERVICE=WMTS&VERSION=1.0.0&REQUEST=GetCapabilities',
        headers={'User-Agent': 'Carroyage-JMT/shom_layers'},
    )
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.read()


def couches(xml_bytes: bytes):
    racine = ET.fromstring(xml_bytes)
    for couche in racine.iterfind('.//wmts:Contents/wmts:Layer', NS):
        ident = couche.findtext('ows:Identifier', default='', namespaces=NS)
        titre = couche.findtext('ows:Title', default='', namespaces=NS)
        jeux = []
        for lien in couche.iterfind('wmts:TileMatrixSetLink', NS):
            nom = lien.findtext('wmts:TileMatrixSet', default='', namespaces=NS)
            niveaux = [m.text for m in lien.iterfind(
                'wmts:TileMatrixSetLimits/wmts:TileMatrixLimits/wmts:TileMatrix', NS)]
            jeux.append((nom, niveaux))
        yield ident, titre, jeux


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--cle', help="clé d'abonnement SHOM ; sans elle, le service INSPIRE libre")
    ap.add_argument('--filtre', help='ne montre que les couches dont l’identifiant contient ce texte')
    ap.add_argument('--fichier', help='parse un GetCapabilities déjà téléchargé au lieu du réseau')
    args = ap.parse_args()

    url = ABONNE.format(cle=args.cle) if args.cle else INSPIRE
    try:
        brut = open(args.fichier, 'rb').read() if args.fichier else telecharge(url)
    except OSError as e:
        print(f'Service injoignable ({e}).', file=sys.stderr)
        print('Vérifier la clé, le réseau, ou télécharger le GetCapabilities à la main :',
              file=sys.stderr)
        print(f'  {url}?SERVICE=WMTS&VERSION=1.0.0&REQUEST=GetCapabilities', file=sys.stderr)
        return 1

    try:
        trouvees = list(couches(brut))
    except ET.ParseError as e:
        print(f'Réponse illisible ({e}) — clé refusée ou page d’erreur renvoyée ?', file=sys.stderr)
        return 1

    if args.filtre:
        f = args.filtre.lower()
        trouvees = [c for c in trouvees if f in c[0].lower() or f in c[1].lower()]

    if not trouvees:
        print('Aucune couche trouvée.' + (' Filtre trop strict ?' if args.filtre else ''))
        return 1

    print(f'{len(trouvees)} couche(s) — source : {args.fichier or url}\n')
    for ident, titre, jeux in trouvees:
        print(f'  {ident}')
        if titre and titre != ident:
            print(f'      {titre}')
        for nom, niveaux in jeux:
            plage = f'z{niveaux[0]} à z{niveaux[-1]}' if niveaux else 'plage non déclarée'
            print(f'      TileMatrixSet {nom} ({plage})')
    variable = 'SHOM_RASTER_LAYER' if args.cle else 'SHOM_INSPIRE_LAYER'
    print(f"\nÀ reporter dans config.private.js, par exemple :\n  var {variable} = '{trouvees[0][0]}';")
    return 0


if __name__ == '__main__':
    sys.exit(main())
