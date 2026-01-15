import os
import json
from PIL import Image

# --- CONFIGURATION ---
SOURCE_DIR = "icons/sticker"       # Vos dossiers sources
TARGET_DIR = "icons/sticks"    # Dossier images optimisées
JS_OUTPUT_FILE = "icons-catalog.js"      # Fichier JS généré
MAX_SIZE = (64, 64)                      # Taille image

def process_library():
    if not os.path.exists(SOURCE_DIR):
        print(f"❌ Erreur: Le dossier '{SOURCE_DIR}' n'existe pas.")
        return

    icons_list = []
    print(f"🚀 Début de l'optimisation des images...")

    count = 0

    for root, dirs, files in os.walk(SOURCE_DIR):
        for filename in files:
            if filename.lower().endswith('.png'):
                # Chemins
                src_path = os.path.join(root, filename)
                rel_path = os.path.relpath(root, SOURCE_DIR)
                
                # Création dossier cible
                target_folder = os.path.join(TARGET_DIR, rel_path)
                os.makedirs(target_folder, exist_ok=True)
                
                target_path = os.path.join(target_folder, filename)
                
                # 1. Optimisation
                try:
                    with Image.open(src_path) as img:
                        if img.mode != 'RGBA':
                            img = img.convert('RGBA')
                        img.thumbnail(MAX_SIZE, Image.Resampling.LANCZOS)
                        img.save(target_path, "PNG", optimize=True)
                except Exception as e:
                    print(f"⚠️ Erreur sur {filename}: {e}")
                    continue

                # 2. Indexation
                web_url = target_path.replace("\\", "/")
                
                if rel_path == ".":
                    folder_path = ["Divers"]
                else:
                    folder_path = rel_path.replace("\\", "/").split("/")

                label = os.path.splitext(filename)[0].replace("_", " ").title()

                icon_entry = {
                    "id": f"pro_{count}",
                    "label": label,
                    "path": folder_path,
                    "category": " / ".join(folder_path),
                    "url": web_url,
                    "scale": 1.0,
                    "order": count
                }
                icons_list.append(icon_entry)
                count += 1

    # --- 3. Ecriture du fichier JS ---
    # On écrit une variable globale JavaScript
    json_data = json.dumps(icons_list, indent=2, ensure_ascii=False)
    js_content = f"// Catalogue généré automatiquement\nconst ICON_CATALOG = {json_data};\n"

    with open(JS_OUTPUT_FILE, "w", encoding="utf-8") as f:
        f.write(js_content)

    print(f"✅ Terminé ! {count} icônes traitées.")
    print(f"📁 Fichier JS généré : {JS_OUTPUT_FILE}")

if __name__ == "__main__":
    process_library()