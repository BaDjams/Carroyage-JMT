// settingsManager.js

// Variable globale pour stocker les icônes
// On charge depuis LocalStorage ou on utilise la liste par défaut de icons.js
let currentIconLibrary = [];

function initSettingsManager() {
    const storedIcons = localStorage.getItem('userIcons');
    if (storedIcons) {
        currentIconLibrary = JSON.parse(storedIcons);
    } else if (typeof ICON_LIBRARY !== 'undefined') {
        // Ajout d'une propriété 'order' et 'category' par défaut
        currentIconLibrary = ICON_LIBRARY.map((icon, index) => ({
            ...icon,
            order: index + 1,
            category: 'Défaut'
        }));
        saveIconsToStorage();
    }

    // Listeners UI
    const settingsBtn = document.getElementById('settingsBtn');
    const modal = document.getElementById('settings-modal');
    const closeBtn = document.getElementById('close-settings-btn');
    const saveBtn = document.getElementById('save-settings-btn');
    const resetBtn = document.getElementById('reset-settings-btn');
    const dropZone = document.getElementById('drop-zone');
    
    // Nouveaux boutons Import/Export
    const exportBtn = document.getElementById('export-icons-btn');
    const importTrigger = document.getElementById('import-icons-trigger');
    const importInput = document.getElementById('import-icons-input');

    if (settingsBtn) {
        settingsBtn.addEventListener('click', () => {
            renderSettingsTable();
            modal.classList.remove('hidden');
        });
    }

    if (closeBtn) {
        closeBtn.addEventListener('click', () => {
            modal.classList.add('hidden');
        });
    }

    if (saveBtn) {
        saveBtn.addEventListener('click', () => {
            saveSettingsFromTable();
            modal.classList.add('hidden');
            updateAppDropdowns(); 
        });
    }

    if (resetBtn) {
        resetBtn.addEventListener('click', () => {
            if (confirm("Attention : Cela va effacer toutes vos icônes personnalisées et rétablir la liste par défaut du programme. Continuer ?")) {
                localStorage.removeItem('userIcons');
                // Rechargement depuis icons.js
                if (typeof ICON_LIBRARY !== 'undefined') {
                    currentIconLibrary = ICON_LIBRARY.map((icon, index) => ({
                        ...icon,
                        order: index + 1,
                        category: 'Défaut'
                    }));
                }
                saveIconsToStorage();
                renderSettingsTable();
                updateAppDropdowns();
            }
        });
    }

    // --- LOGIQUE EXPORT ---
    if (exportBtn) {
        exportBtn.addEventListener('click', () => {
            // On met à jour les données avant d'exporter
            saveSettingsFromTable(); 
            
            const dataStr = JSON.stringify(currentIconLibrary, null, 2);
            const blob = new Blob([dataStr], { type: "application/json" });
            const url = URL.createObjectURL(blob);
            
            const a = document.createElement('a');
            a.href = url;
            a.download = "cado_icons_config.json";
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        });
    }

    // --- LOGIQUE IMPORT ---
    if (importTrigger && importInput) {
        importTrigger.addEventListener('click', () => importInput.click());
        
        importInput.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (!file) return;

            const reader = new FileReader();
            reader.onload = (event) => {
                try {
                    const importedData = JSON.parse(event.target.result);
                    if (Array.isArray(importedData)) {
                        if(confirm(`Voulez-vous remplacer votre liste actuelle par les ${importedData.length} icônes de ce fichier ?`)) {
                            currentIconLibrary = importedData;
                            saveIconsToStorage();
                            renderSettingsTable();
                            updateAppDropdowns();
                            alert("Configuration chargée avec succès !");
                        }
                    } else {
                        alert("Le format du fichier JSON est incorrect.");
                    }
                } catch (err) {
                    console.error(err);
                    alert("Erreur lors de la lecture du fichier JSON.");
                }
            };
            reader.readAsText(file);
            // Reset pour permettre de recharger le même fichier si besoin
            importInput.value = ''; 
        });
    }

    // Drag & Drop Logic
    if (dropZone) {
        dropZone.addEventListener('dragover', (e) => {
            e.preventDefault();
            dropZone.classList.add('border-blue-600', 'bg-blue-100');
        });

        dropZone.addEventListener('dragleave', (e) => {
            e.preventDefault();
            dropZone.classList.remove('border-blue-600', 'bg-blue-100');
        });

        dropZone.addEventListener('drop', (e) => {
            e.preventDefault();
            dropZone.classList.remove('border-blue-600', 'bg-blue-100');
            
            const files = e.dataTransfer.files;
            if (files.length > 0) {
                handleDroppedFiles(files);
            }
        });
    }

    updateAppDropdowns();
}

function handleDroppedFiles(files) {
    Array.from(files).forEach(file => {
        if (file.type.startsWith('image/png')) {
            const reader = new FileReader();
            reader.onload = (e) => {
                const base64 = e.target.result;
                
                // On cherche l'ID le plus élevé pour l'ordre
                const maxOrder = currentIconLibrary.reduce((max, item) => Math.max(max, item.order || 0), 0);

                const newIcon = {
                    id: `custom_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
                    label: file.name.replace('.png', ''),
                    url: base64, // C'est ici que l'image est stockée "définitivement" en texte
                    scale: 1.0,
                    order: maxOrder + 1,
                    category: 'Personnalisé'
                };
                currentIconLibrary.push(newIcon);
                renderSettingsTable();
                
                // Sauvegarde automatique après drop
                saveIconsToStorage();
                updateAppDropdowns();
            };
            reader.readAsDataURL(file);
        } else {
            alert("Seuls les fichiers PNG sont acceptés pour l'instant.");
        }
    });
}

function renderSettingsTable() {
    const tbody = document.getElementById('settings-icons-list');
    if (!tbody) return;
    tbody.innerHTML = '';

    currentIconLibrary.sort((a, b) => (a.order || 0) - (b.order || 0));

    currentIconLibrary.forEach((icon) => {
        const tr = document.createElement('tr');
        tr.className = "bg-white border-b dark:bg-gray-800 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-600";
        
        // Aperçu (limité en taille)
        const imgPreview = `<img src="${icon.url}" class="h-8 w-8 object-contain bg-gray-200 rounded p-1">`;

        tr.innerHTML = `
            <td class="px-4 py-2">${imgPreview}</td>
            <td class="px-4 py-2">
                <input type="number" class="icon-order-input w-16 p-1 text-xs border rounded bg-gray-50 dark:bg-gray-700 dark:text-white" value="${icon.order}" data-id="${icon.id}">
            </td>
            <td class="px-4 py-2">
                <input type="text" class="icon-label-input w-full p-1 text-xs border rounded bg-gray-50 dark:bg-gray-700 dark:text-white" value="${icon.label}" data-id="${icon.id}">
            </td>
            <td class="px-4 py-2">
                <input type="text" class="icon-category-input w-full p-1 text-xs border rounded bg-gray-50 dark:bg-gray-700 dark:text-white" value="${icon.category || 'Général'}" data-id="${icon.id}">
            </td>
            <td class="px-4 py-2 text-right">
                <button class="delete-icon-btn text-red-600 hover:text-red-800 font-bold px-2" data-id="${icon.id}">&times;</button>
            </td>
        `;
        tbody.appendChild(tr);
    });

    document.querySelectorAll('.delete-icon-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const id = e.target.getAttribute('data-id');
            if(confirm("Supprimer cette icône ?")) {
                currentIconLibrary = currentIconLibrary.filter(i => i.id !== id);
                saveIconsToStorage();
                renderSettingsTable();
                updateAppDropdowns();
            }
        });
    });
}

function saveSettingsFromTable() {
    const rows = document.querySelectorAll('#settings-icons-list tr');
    
    // On parcourt le tableau affiché pour récupérer les valeurs éditées
    // Note: c'est plus simple de mettre à jour l'objet currentIconLibrary directement
    
    document.querySelectorAll('.icon-order-input').forEach(input => {
        const id = input.getAttribute('data-id');
        const icon = currentIconLibrary.find(i => i.id === id);
        if (icon) icon.order = parseInt(input.value);
    });

    document.querySelectorAll('.icon-label-input').forEach(input => {
        const id = input.getAttribute('data-id');
        const icon = currentIconLibrary.find(i => i.id === id);
        if (icon) icon.label = input.value;
    });

    document.querySelectorAll('.icon-category-input').forEach(input => {
        const id = input.getAttribute('data-id');
        const icon = currentIconLibrary.find(i => i.id === id);
        if (icon) icon.category = input.value;
    });

    saveIconsToStorage();
}

function saveIconsToStorage() {
    localStorage.setItem('userIcons', JSON.stringify(currentIconLibrary));
}

function updateAppDropdowns() {
    // Mettre à jour le selecteur principal de l'appli
    const poiSelect = document.getElementById('poi-type-selector');
    if (!poiSelect) return;

    const selectedValue = poiSelect.value;
    poiSelect.innerHTML = '';

    // Trier pour l'affichage
    const sortedIcons = [...currentIconLibrary].sort((a, b) => (a.order || 0) - (b.order || 0));
    
    // Grouper par catégorie
    const categories = {};
    sortedIcons.forEach(icon => {
        const cat = icon.category || 'Général';
        if (!categories[cat]) categories[cat] = [];
        categories[cat].push(icon);
    });

    for (const [catName, icons] of Object.entries(categories)) {
        const optgroup = document.createElement('optgroup');
        optgroup.label = catName;
        
        icons.forEach(icon => {
            const option = document.createElement('option');
            option.value = icon.id;
            option.textContent = icon.label;
            optgroup.appendChild(option);
        });
        poiSelect.appendChild(optgroup);
    }

    // Restaurer la sélection si possible
    if (selectedValue && currentIconLibrary.find(i => i.id === selectedValue)) {
        poiSelect.value = selectedValue;
    }
}

// Exporter la librairie pour que zoneDownloader.js l'utilise
// On utilise une fonction globale pour récupérer la liste à jour
window.getIconLibrary = function() {
    return currentIconLibrary;
};