import json
import base64
from PIL import Image, ImageDraw, ImageFont
import io
import string
import os
import sys
import winreg
import argparse

def find_font_by_name(font_name):
    font_paths = []

    # Clés de registre à vérifier
    registry_keys = [
        (winreg.HKEY_LOCAL_MACHINE, r"SOFTWARE\Microsoft\Windows NT\CurrentVersion\Fonts"),
        (winreg.HKEY_CURRENT_USER, r"Software\Microsoft\Windows NT\CurrentVersion\Fonts")
    ]

    for root_key, sub_key in registry_keys:
        try:
            key = winreg.OpenKey(root_key, sub_key)
            for i in range(0, winreg.QueryInfoKey(key)[1]):
                value = winreg.EnumValue(key, i)
                if font_name.lower() in value[0].lower():
                    font_file = value[1]
                    if not os.path.isfile(font_file):
                        font_path = os.path.join(os.environ['WINDIR'], 'Fonts', font_file)
                    else:
                        font_path = font_file
                    if os.path.isfile(font_path):
                        font_paths.append(font_path)
        except Exception as e:
            print(f"Erreur lors de la recherche de la police dans {sub_key}: {e}")
            continue  # Essayer la clé suivante

    if font_paths:
        return font_paths[0]  # Retourne le premier chemin trouvé
    else:
        return None

def parse_letter(s):
    s = s.strip().upper()
    sign = 1
    if s.startswith('-'):
        sign = -1
        s = s[1:]
    num = letter_to_number(s)
    if num is None:
        return None
    return sign * num

def letter_to_number(letter):
    """Convertit une lettre (ou une chaîne de lettres) en nombre (A=1, B=2, ..., Z=26, AA=27, AB=28, ...)"""
    total = 0
    for i, char in enumerate(reversed(letter)):
        if not char.isalpha():
            return None
        total += (ord(char) - ord('A') + 1) * (26 ** i)
    return total

def number_to_letter(n):
    """Convertit un nombre en lettre (1=A, 2=B, ..., 26=Z, 27=AA, 28=AB, ...)"""
    if n == 0:
        return None  # Le zéro n'est pas valide
    sign = ''
    if n < 0:
        sign = '-'
        n = -n
    result = ''
    while n > 0:
        n, remainder = divmod(n - 1, 26)
        result = chr(65 + remainder) + result
    return sign + result

def generate_letters(start_letter, end_letter):
    start_index = parse_letter(start_letter)
    end_index = parse_letter(end_letter)

    if start_index is None or end_index is None:
        print("Lettres de début ou de fin invalides.")
        sys.exit(1)

    if start_index > end_index:
        step = -1
    else:
        step = 1

    letters = []
    for index in range(start_index, end_index + step, step):
        if index == 0:
            continue  # Ignorer le zéro
        letter = number_to_letter(index)
        if letter is None:
            continue
        letters.append(letter)

    return letters

def generate_numbers(start_number, end_number):
    if start_number > end_number:
        step = -1
    else:
        step = 1

    numbers = []
    for number in range(start_number, end_number + step, step):
        if number == 0:
            continue  # Ignorer le zéro
        numbers.append(number)

    return numbers

def hex_to_rgb(hex_color):
    """Convertit un code couleur hexadécimal en tuple RGB"""
    hex_color = hex_color.lstrip('#')
    if len(hex_color) != 6:
        raise ValueError(f"Couleur hexadécimale invalide: {hex_color}")
    return tuple(int(hex_color[i:i+2], 16) for i in (0, 2, 4))

def format_name_for_json(lettre, nombre):
    # Formater la lettre
    if lettre.startswith('-'):
        lettre_formatee = 'neg_' + lettre[1:]
    else:
        lettre_formatee = lettre

    # Formater le nombre
    if isinstance(nombre, int):
        if nombre < 0:
            nombre_formate = 'neg_' + str(-nombre)
        else:
            nombre_formate = str(nombre)
    else:
        nombre_str = str(nombre)
        if nombre_str.startswith('-'):
            nombre_formate = 'neg_' + nombre_str[1:]
        else:
            nombre_formate = nombre_str

    # Combiner la lettre et le nombre avec un underscore
    return f"{lettre_formatee}_{nombre_formate}"

# Ajout de l'analyse des arguments de ligne de commande
parser = argparse.ArgumentParser(description='Générer des images avec des combinaisons lettres/nombres.')
parser.add_argument('--start_letter', type=str, default='A', help='Lettre de début (par défaut: A)')
parser.add_argument('--end_letter', type=str, default='Z', help='Lettre de fin (par défaut: Z)')
parser.add_argument('--start_number', type=int, default=1, help='Nombre de début (par défaut: 1)')
parser.add_argument('--end_number', type=int, default=26, help='Nombre de fin (par défaut: 26)')
parser.add_argument('--contour_thickness', type=int, default=1, help='Épaisseur du contour (par défaut: 1)')
parser.add_argument('--export_png', action='store_true', help='Générer un dossier avec les images PNG')
parser.add_argument('--text_color', type=str, default='#000000', help='Couleur du texte en hexadécimal (par défaut: #000000 pour noir)')
parser.add_argument('--contour_color', type=str, default='#FFFFFF', help='Couleur du contour en hexadécimal (par défaut: #FFFFFF pour blanc)')
parser.add_argument('--output_dir', type=str, default='images', help='Dossier de sortie pour les images PNG (par défaut: images)')
parser.add_argument('--output_json', type=str, default='output.json', help='Nom du fichier JSON de sortie (par défaut: output.json)')

args = parser.parse_args()

# Conversion des couleurs hexadécimales en RGB
try:
    text_rgb = hex_to_rgb(args.text_color)
    contour_rgb = hex_to_rgb(args.contour_color)
except ValueError as e:
    print(f"Erreur de couleur : {e}")
    sys.exit(1)

# Génération des lettres et des nombres en fonction des arguments
lettres = generate_letters(args.start_letter, args.end_letter)
nombres = generate_numbers(args.start_number, args.end_number)

# Génération des combinaisons
combinations = [(lettre, nombre) for lettre in lettres for nombre in nombres]

print(f"Nombre de combinaisons : {len(combinations)}")  # Vérifier le nombre de combinaisons

data = []

# Police imposée
nom_police = "Cantarell Bold"
taille_image = 64  # Taille de l'image en pixels (largeur et hauteur)
taille_police_initiale = 32  # Taille initiale de la police
epaisseur_contour = args.contour_thickness  # Épaisseur du contour

# Création du dossier pour les images PNG si l'option est activée
if args.export_png:
    output_dir = args.output_dir
    os.makedirs(output_dir, exist_ok=True)

# Trouver le chemin de la police en se basant sur le nom
chemin_police = find_font_by_name(nom_police)
if chemin_police is None:
    print(f"Impossible de trouver la police '{nom_police}'. Assurez-vous qu'elle est installée sur votre système.")
    sys.exit(1)

for lettre, nombre in combinations:
    nom = f"{lettre}{nombre}"
    texte = nom

    print(f"Traitement de : {texte}")  # Vérifier que la boucle s'exécute

    # Initialiser la taille de la police
    taille_police = taille_police_initiale

    while taille_police > 0:
        # Charger la police
        police = ImageFont.truetype(chemin_police, taille_police)

        # Obtenir les métriques de la police
        ascent, descent = police.getmetrics()
        hauteur_texte_reelle = ascent + descent

        # Créer une image temporaire pour mesurer le texte
        img_temp = Image.new('RGBA', (1, 1), (255, 255, 255, 0))
        draw_temp = ImageDraw.Draw(img_temp)

        # Obtenir la taille du texte (bbox)
        bbox = draw_temp.textbbox((0, 0), texte, font=police)
        if bbox:
            largeur_texte = bbox[2] - bbox[0]
        else:
            print(f"Impossible d'obtenir bbox pour '{texte}'")
            break

        # Calculer la largeur et la hauteur totales avec le contour
        largeur_totale = largeur_texte + 2 * epaisseur_contour
        hauteur_totale = hauteur_texte_reelle + 2 * epaisseur_contour

        # Vérifier si le texte avec le contour tient dans l'image
        if largeur_totale <= taille_image and hauteur_totale <= taille_image:
            # Le texte tient dans l'image, on peut continuer
            break
        else:
            # Réduire la taille de la police
            taille_police -= 1

    if taille_police <= 0:
        print(f"Impossible d'ajuster la taille de la police pour '{texte}'.")
        continue

    # Recalculer la position pour centrer le texte, en tenant compte du contour et des métriques
    position_x = (taille_image - largeur_texte - 2 * epaisseur_contour) / 2 + epaisseur_contour
    position_y = (taille_image - hauteur_texte_reelle - 2 * epaisseur_contour) / 2 + epaisseur_contour

    # Ajuster la position verticale en utilisant ascent
    position_y += ascent

    # Créer l'image finale
    img = Image.new('RGBA', (taille_image, taille_image), (255, 255, 255, 0))
    draw = ImageDraw.Draw(img)

    # Dessiner un fin contour autour du texte avec la couleur spécifiée
    for x_offset in range(-epaisseur_contour, epaisseur_contour + 1):
        for y_offset in range(-epaisseur_contour, epaisseur_contour + 1):
            if x_offset == 0 and y_offset == 0:
                continue
            position_offset = (position_x + x_offset, position_y + y_offset - ascent)
            draw.text(position_offset, texte, font=police, fill=contour_rgb + (255,))

    # Dessiner le texte avec la couleur spécifiée
    draw.text((position_x, position_y - ascent), texte, font=police, fill=text_rgb + (255,))

    # Enregistrer l'image dans un buffer en mémoire
    buffer = io.BytesIO()
    img.save(buffer, format="PNG")
    img_str = base64.b64encode(buffer.getvalue()).decode('utf-8')

    # Générer le nom pour le JSON en remplaçant les signes négatifs
    name_for_json = format_name_for_json(lettre, nombre)

    # Ajouter aux données
    data.append({
        "name": name_for_json,
        "base64": img_str
    })

    # Enregistrer l'image en PNG si l'option est activée
    if args.export_png:
        output_path = os.path.join(output_dir, f"{nom}.png")
        img.save(output_path)
        print(f"Image sauvegardée : {output_path}")

    print(f"Données ajoutées pour '{nom}' avec une taille de police de {taille_police}")

print(f"Nombre total d'éléments dans 'data' avant la sauvegarde : {len(data)}")

# Sauvegarder les données dans un fichier JSON
try:
    with open(args.output_json, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=4)
    print(f"Les données ont été sauvegardées avec succès dans '{args.output_json}'.")
except Exception as e:
    print(f"Erreur lors de la sauvegarde des données : {e}")
