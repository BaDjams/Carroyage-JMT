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
import gzip
import sys
import urllib.error
import urllib.request
import xml.etree.ElementTree as ET
import zlib

SHOM_INSPIRE = 'https://services.data.shom.fr/INSPIRE/wmts'
SHOM_ABONNE = 'https://services.data.shom.fr/{cle}/wmts'
NS = {
    'wmts': 'http://www.opengis.net/wmts/1.0',
    'ows': 'http://www.opengis.net/ows/1.1',
    'wms': 'http://www.opengis.net/wms',
}


def _decompresse(corps: bytes, encodage: str) -> bytes:
    """Certains serveurs compressent sans l\'annoncer, ou l\'annoncent sans le faire."""
    if corps[:2] == b'\x1f\x8b' or 'gzip' in encodage:
        try:
            return gzip.decompress(corps)
        except OSError:
            return corps
    if 'deflate' in encodage:
        for wbits in (zlib.MAX_WBITS, -zlib.MAX_WBITS):
            try:
                return zlib.decompress(corps, wbits)
            except zlib.error:
                continue
    return corps


def telecharge(url: str, service: str, version: str):
    """Renvoie (corps, statut, type_mime, url_demandee). Ne leve pas sur 4xx/5xx :
    un service OGC renvoie souvent son ServiceException avec un code d\'erreur, et
    ce corps-la est precisement ce qu\'il faut montrer."""
    sep = '&' if '?' in url else '?'
    complete = f'{url}{sep}SERVICE={service.upper()}&VERSION={version}&REQUEST=GetCapabilities'
    req = urllib.request.Request(complete, headers={
        'User-Agent': 'Carroyage-JMT/ogc_layers',
        'Accept': 'application/xml, text/xml, */*',
    })
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            corps = _decompresse(r.read(), (r.headers.get('Content-Encoding') or '').lower())
            return corps, r.status, r.headers.get('Content-Type', ''), complete
    except urllib.error.HTTPError as e:
        corps = _decompresse(e.read(), (e.headers.get('Content-Encoding') or '').lower())
        return corps, e.code, e.headers.get('Content-Type', ''), complete


def nettoie(corps: bytes) -> bytes:
    """Retire le BOM et les blancs de tete : un XML parfaitement valide precede
    d\'un BOM fait echouer le parseur sur « line 1, column 0 »."""
    return corps.lstrip(b'\xef\xbb\xbf').lstrip()


def classe(racine):
    """Un GetCapabilities, une exception OGC, ou autre chose ? Une page HTML bien
    formee et une exception OGC se parsent tres bien comme du XML : sans ce tri,
    l\'outil annoncait « aucune couche trouvee » au lieu de dire ce qui cloche."""
    tag = racine.tag.split('}')[-1].lower()
    if tag in ('capabilities', 'wms_capabilities', 'wmt_ms_capabilities'):
        return 'capabilities', ''
    if 'exception' in tag:
        messages = [(e.text or '').strip() for e in racine.iter()
                    if 'exception' in e.tag.split('}')[-1].lower() and (e.text or '').strip()]
        return 'exception', ' / '.join(messages) or 'sans message'
    return 'autre', f'racine <{tag}>'


def diagnostic(corps: bytes, statut, mime: str, url: str, erreur) -> None:
    """Dit ce qui est REELLEMENT arrive : sans le corps de la reponse, un
    « reponse illisible » n\'apprend rien a personne."""
    texte = nettoie(corps).decode('utf-8', errors='replace')
    debut = texte[:300].replace('\n', ' ').strip()
    tete = texte[:400].lower()

    print(f'Reponse illisible : {erreur}', file=sys.stderr)
    print(f'  URL     : {url}', file=sys.stderr)
    print(f'  Statut  : {statut}   Type : {mime or "non declare"}   Taille : {len(corps)} octets', file=sys.stderr)
    print(f'  Debut   : {debut or "(corps vide)"}', file=sys.stderr)

    if isinstance(erreur, str) and erreur.startswith('exception OGC'):
        cause = 'le service a rejete la requete : lire le message ci-dessus.'
    elif isinstance(erreur, str) and erreur.startswith("ce n'est pas"):
        cause = ("la reponse est du XML valide, mais pas un GetCapabilities : "
                 "portail d'authentification, proxy d'entreprise, ou URL de service inexacte.")
    elif not corps:
        cause = 'le service a renvoye un corps vide.'
    elif corps[:2] == b'\x1f\x8b':
        cause = 'contenu encore compresse (gzip) : le serveur compresse sans l\'annoncer.'
    elif 'serviceexception' in tete or 'exceptionreport' in tete:
        cause = 'le service a repondu une exception OGC : lire le message ci-dessus.'
    elif '<html' in tete or '<!doctype html' in tete:
        cause = ('une page HTML, pas du XML : portail d\'authentification ou proxy '
                 'd\'entreprise, erreur du serveur, ou URL de service inexacte.')
    else:
        cause = 'contenu non XML.'
    print(f'  Cause probable : {cause}', file=sys.stderr)
    print('  Pour inspecter la reponse entiere : rejouer avec --brut reponse.xml', file=sys.stderr)


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
    ap.add_argument('--version', help="version du service ; 1.0.0 en WMTS, 1.3.0 en WMS")
    ap.add_argument('--brut', help='enregistre la reponse brute dans ce fichier, pour inspection')
    args = ap.parse_args()

    if args.url:
        url = args.url
    elif args.cle:
        url = SHOM_ABONNE.format(cle=args.cle)
    else:
        url = SHOM_INSPIRE
    service = args.service or ('wms' if '/wms' in url.lower() else 'wmts')

    versions = [args.version] if args.version else (
        ['1.0.0'] if service == 'wmts' else ['1.3.0', '1.1.1'])

    if args.fichier:
        try:
            brut, statut, mime, demandee = open(args.fichier, 'rb').read(), 'fichier', '', args.fichier
        except OSError as e:
            print(f'Fichier illisible ({e}).', file=sys.stderr)
            return 1
        try:
            racine = ET.fromstring(nettoie(brut))
        except ET.ParseError as e:
            diagnostic(brut, statut, mime, demandee, e)
            return 1
        genre, message = classe(racine)
        if genre != 'capabilities':
            diagnostic(brut, statut, mime, demandee,
                       f'exception OGC — {message}' if genre == 'exception'
                       else f"ce n'est pas un GetCapabilities ({message})")
            return 1
    else:
        racine, brut, derniere = None, b'', None
        # Un service qui refuse une version repond une exception : on retente avec
        # la version precedente avant de declarer forfait.
        for v in versions:
            try:
                brut, statut, mime, demandee = telecharge(url, service, v)
            except OSError as e:
                print(f'Service injoignable ({e}).', file=sys.stderr)
                print('Verifier la cle, le reseau, ou telecharger le GetCapabilities a la main :', file=sys.stderr)
                sep = '&' if '?' in url else '?'
                print(f'  {url}{sep}SERVICE={service.upper()}&REQUEST=GetCapabilities', file=sys.stderr)
                return 1
            if args.brut:
                open(args.brut, 'wb').write(brut)
                print(f'Reponse brute enregistree dans {args.brut} ({len(brut)} octets).')
            try:
                candidate = ET.fromstring(nettoie(brut))
            except ET.ParseError as e:
                derniere = (brut, statut, mime, demandee, e)
            else:
                genre, message = classe(candidate)
                if genre == 'capabilities':
                    racine = candidate
                    break
                derniere = (brut, statut, mime, demandee,
                            f'exception OGC — {message}' if genre == 'exception'
                            else f"ce n'est pas un GetCapabilities ({message})")
            if v != versions[-1]:
                print(f'Version {v} sans reponse exploitable, nouvel essai en '
                      f'{versions[versions.index(v) + 1]}...', file=sys.stderr)
        if racine is None:
            diagnostic(*derniere)
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
