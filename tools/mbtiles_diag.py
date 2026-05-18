#!/usr/bin/env python3
"""
Diagnostic comparatif de fichiers .mbtiles.

Pour chaque fichier : format réel des tuiles, profondeur de couleur,
taille moyenne par zoom, déduplication, tuiles vides.
Compare ensuite les fichiers entre eux pour expliquer un écart de taille.

Usage:
    python tools/mbtiles_diag.py fichier1.mbtiles fichier2.mbtiles [...]
"""

import os
import sqlite3
import struct
import sys


def sniff_format(blob: bytes) -> str:
    if blob[:8] == b"\x89PNG\r\n\x1a\n":
        return "PNG"
    if blob[:2] == b"\xff\xd8":
        return "JPEG"
    if blob[:4] == b"RIFF" and blob[8:12] == b"WEBP":
        return "WEBP"
    if blob[:4] in (b"GIF8",):
        return "GIF"
    return "?"


def png_color_info(blob: bytes) -> str:
    """Lit le chunk IHDR d'un PNG : profondeur de bits + type de couleur."""
    # IHDR commence à l'octet 16 (8 sig + 4 len + 4 'IHDR')
    try:
        width, height = struct.unpack(">II", blob[16:24])
        bit_depth = blob[24]
        color_type = blob[25]
        types = {
            0: "Gris",
            2: "RGB (truecolor)",
            3: "Palette (PNG8)",
            4: "Gris+Alpha",
            6: "RGBA (truecolor+alpha)",
        }
        return f"{width}x{height} {bit_depth}bit {types.get(color_type, color_type)}"
    except Exception:
        return "PNG (IHDR illisible)"


def analyze(path: str) -> dict:
    con = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
    cur = con.cursor()

    objs = cur.execute(
        "SELECT name, type FROM sqlite_master WHERE type IN ('table','view')"
    ).fetchall()
    names = {n for n, _ in objs}
    dedup = {"map", "images"}.issubset(names)

    total_rows = cur.execute("SELECT count(*) FROM tiles").fetchone()[0]
    total_bytes = cur.execute(
        "SELECT coalesce(sum(length(tile_data)),0) FROM tiles"
    ).fetchone()[0]

    # Tuiles physiquement stockées (dédupliquées si schéma map/images)
    if dedup:
        stored_rows, stored_bytes = cur.execute(
            "SELECT count(*), coalesce(sum(length(tile_data)),0) FROM images"
        ).fetchone()
    else:
        stored_rows, stored_bytes = total_rows, total_bytes

    per_zoom = cur.execute(
        "SELECT zoom_level, count(*), avg(length(tile_data)), "
        "min(length(tile_data)), max(length(tile_data)) "
        "FROM tiles GROUP BY zoom_level ORDER BY zoom_level"
    ).fetchall()

    # Échantillon pour déterminer format + couleur
    fmt_counts: dict[str, int] = {}
    color_sample = ""
    for (blob,) in cur.execute(
        "SELECT tile_data FROM tiles WHERE tile_data IS NOT NULL LIMIT 500"
    ):
        f = sniff_format(blob)
        fmt_counts[f] = fmt_counts.get(f, 0) + 1
        if not color_sample and f == "PNG":
            color_sample = png_color_info(blob)

    # Tuiles "vides" = doublons exacts les plus fréquents
    top_dups = cur.execute(
        "SELECT length(tile_data) AS L, count(*) AS C FROM tiles "
        "GROUP BY tile_data ORDER BY C DESC LIMIT 1"
    ).fetchone()

    con.close()
    return {
        "path": path,
        "file_size": os.path.getsize(path),
        "dedup_schema": dedup,
        "total_rows": total_rows,
        "stored_rows": stored_rows,
        "stored_bytes": stored_bytes,
        "fmt_counts": fmt_counts,
        "color_sample": color_sample,
        "per_zoom": per_zoom,
        "top_dup": top_dups,
    }


def human(n: float) -> str:
    for unit in ("o", "Ko", "Mo", "Go"):
        if n < 1024:
            return f"{n:.1f} {unit}"
        n /= 1024
    return f"{n:.1f} To"


def report(r: dict) -> None:
    print("=" * 70)
    print(f"FICHIER : {r['path']}")
    print(f"  Taille fichier        : {human(r['file_size'])}")
    fmt = ", ".join(f"{k}={v}" for k, v in sorted(r["fmt_counts"].items()))
    print(f"  Format des tuiles     : {fmt}  (échantillon 500)")
    if r["color_sample"]:
        print(f"  PNG (1er échantillon) : {r['color_sample']}")
    print(f"  Schéma déduplication  : {'OUI (map+images)' if r['dedup_schema'] else 'NON (table tiles brute)'}")
    print(f"  Tuiles référencées    : {r['total_rows']}")
    print(f"  Tuiles stockées       : {r['stored_rows']}")
    if r["total_rows"]:
        ratio = 100 * (1 - r["stored_rows"] / r["total_rows"])
        print(f"  Gain déduplication    : {ratio:.1f} % de tuiles en moins")
    if r["stored_rows"]:
        avg = r["stored_bytes"] / r["stored_rows"]
        print(f"  Poids moyen / tuile   : {human(avg)}")
    if r["top_dup"]:
        L, C = r["top_dup"]
        print(f"  Tuile la + répétée    : {C} occurrences ({L} o chacune)")
    print("  Par niveau de zoom (z, nb, moy, min, max) :")
    for z, c, a, mn, mx in r["per_zoom"]:
        print(f"    z{z:>2} : {c:>7} tuiles | moy {human(a or 0):>9} "
              f"| min {human(mn or 0):>8} | max {human(mx or 0):>9}")


def main(argv: list[str]) -> int:
    paths = argv[1:]
    if not paths:
        print(__doc__)
        return 1
    results = []
    for p in paths:
        if not os.path.isfile(p):
            print(f"!! Introuvable : {p}")
            continue
        try:
            results.append(analyze(p))
        except Exception as e:
            print(f"!! Erreur sur {p} : {e}")
    for r in results:
        report(r)

    if len(results) >= 2:
        print("=" * 70)
        print("COMPARAISON")
        a, b = results[0], results[1]
        sz = lambda r: r["file_size"]
        big, small = (a, b) if sz(a) >= sz(b) else (b, a)
        print(f"  {os.path.basename(big['path'])} est "
              f"{sz(big)/max(sz(small),1):.1f}x plus lourd que "
              f"{os.path.basename(small['path'])}")
        avg = lambda r: (r["stored_bytes"] / r["stored_rows"]) if r["stored_rows"] else 0
        if avg(small):
            print(f"  Poids moyen/tuile : ratio {avg(big)/avg(small):.1f}x "
                  f"({human(avg(big))} vs {human(avg(small))})")
        print("  Causes probables :")
        if set(big["fmt_counts"]) != set(small["fmt_counts"]):
            print(f"   -> Formats d'image DIFFÉRENTS "
                  f"({'/'.join(sorted(big['fmt_counts']))} vs "
                  f"{'/'.join(sorted(small['fmt_counts']))}) : cause principale.")
        elif big["color_sample"] != small["color_sample"]:
            print(f"   -> Même format mais profondeur couleur différente : "
                  f"'{big['color_sample']}' vs '{small['color_sample']}'.")
        if big["dedup_schema"] != small["dedup_schema"]:
            loser = big if not big["dedup_schema"] else small
            print(f"   -> {os.path.basename(loser['path'])} ne déduplique PAS "
                  "les tuiles identiques.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
