/**
 * TOOLBOX VECTORIELLE - CRISIS MAPPER
 * Gestion des éléments vectoriels créés avec la barre d'outils
 */

class VectorToolbox {
    constructor() {
        this.vectorElements = [];
        this.selectedElement = null;
        this.isMinimized = false;
        this.defaultSettings = {
            color: '#4CAF50',
            weight: 3,
            opacity: 0.8
        };
        
        this.init();
    }

    init() {
        // Attendre que le DOM soit complètement chargé
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => {
                this.setupEventListeners();
                this.loadSettings();
                this.updateElementCount();
                // Ne pas initialiser les paramètres par défaut ici
            });
        } else {
            this.setupEventListeners();
            this.loadSettings();
            this.updateElementCount();
            // Ne pas initialiser les paramètres par défaut ici
        }
    }

    initializeDefaultParameters() {
        // Initialiser avec les paramètres par défaut
        this.updateToolParameters('default');
    }

    setupEventListeners() {
        // Boutons de contrôle
        const minimizeBtn = document.getElementById('minimizeToolbox');
        const closeBtn = document.getElementById('closeToolbox');
        
        if (minimizeBtn) {
            minimizeBtn.addEventListener('click', () => this.toggleMinimize());
        }
        if (closeBtn) {
            closeBtn.addEventListener('click', () => this.closeToolbox());
        }

        // Gestion du pliage/dépliage des sections de la toolbox
        const sectionHeaders = document.querySelectorAll('.toolbox-section .section-header');
        sectionHeaders.forEach(header => {
            header.addEventListener('click', (e) => this.toggleToolboxSection(header));
        });

        // Boutons d'action
        const saveBtn = document.getElementById('saveAllVectors');
        const clearBtn = document.getElementById('clearAllVectors');
        const exportBtn = document.getElementById('exportVectors');
        const importBtn = document.getElementById('importVectors');
        
        if (saveBtn) saveBtn.addEventListener('click', () => this.saveAllVectors());
        if (clearBtn) clearBtn.addEventListener('click', () => this.clearAllVectors());
        if (exportBtn) exportBtn.addEventListener('click', () => this.exportVectors());
        if (importBtn) importBtn.addEventListener('click', () => this.importVectors());

        // Paramètres
        const colorInput = document.getElementById('defaultColor');
        const weightInput = document.getElementById('defaultWeight');
        const opacityInput = document.getElementById('defaultOpacity');
        
        if (colorInput) colorInput.addEventListener('change', (e) => this.updateDefaultColor(e.target.value));
        if (weightInput) weightInput.addEventListener('input', (e) => this.updateDefaultWeight(e.target.value));
        if (opacityInput) opacityInput.addEventListener('input', (e) => this.updateDefaultOpacity(e.target.value));

        // Gestion du déplacement de la toolbox
        const toolbox = document.getElementById('vectorToolbox');
        const header = document.querySelector('.toolbox-header');
        
        if (header) {
            header.addEventListener('mousedown', (e) => this.startDrag(e));
        }
        document.addEventListener('mousemove', (e) => this.drag(e));
        document.addEventListener('mouseup', () => this.endDrag());
    }

    // ===== GESTION DES ÉLÉMENTS VECTORIELS =====
    addVectorElement(element, type, name) {
        const elementData = {
            id: this.generateId(),
            element: element,
            type: type,
            name: name || this.generateElementName(type),
            created: new Date(),
            settings: { ...this.defaultSettings },
            visible: true,
            locked: false
        };

        this.vectorElements.push(elementData);
        this.updateElementList();
        this.updateElementCount();
        this.saveToLocalStorage();
    }

    removeVectorElement(elementId) {
        const index = this.vectorElements.findIndex(el => el.id === elementId);
        if (index !== -1) {
            // Supprimer de la carte
            if (this.vectorElements[index].element && window.map) {
                window.map.removeLayer(this.vectorElements[index].element);
            }
            
            this.vectorElements.splice(index, 1);
            this.updateElementList();
            this.updateElementCount();
            this.saveToLocalStorage();
        }
    }

    selectElement(elementId) {
        // Désélectionner l'élément précédent
        if (this.selectedElement) {
            const prevElement = document.querySelector(`[data-element-id="${this.selectedElement}"]`);
            if (prevElement) {
                prevElement.classList.remove('selected');
            }
        }

        // Sélectionner le nouvel élément
        this.selectedElement = elementId;
        const element = document.querySelector(`[data-element-id="${elementId}"]`);
        if (element) {
            element.classList.add('selected');
        }
    }

    updateElementList() {
        const elementList = document.getElementById('elementList');
        elementList.innerHTML = '';

        this.vectorElements.forEach(elementData => {
            const elementItem = this.createElementItem(elementData);
            elementList.appendChild(elementItem);
        });
    }

    createElementItem(elementData) {
        const item = document.createElement('div');
        item.className = 'element-item';
        item.setAttribute('data-element-id', elementData.id);
        
        if (elementData.locked) {
            item.classList.add('locked');
        }
        
        if (!elementData.visible) {
            item.classList.add('hidden');
        }

        item.innerHTML = `
            <div class="element-info">
                <span class="element-icon">${this.getElementIcon(elementData.type)}</span>
                <div class="element-details">
                    <div class="element-name">${elementData.name}</div>
                    <div class="element-type">${elementData.type}</div>
                </div>
            </div>
            <div class="element-actions">
                <button class="element-action edit" title="Modifier" data-action="edit" data-element-id="${elementData.id}">
                    ✏️
                </button>
                <button class="element-action duplicate" title="Dupliquer" data-action="duplicate" data-element-id="${elementData.id}">
                    📋
                </button>
                <button class="element-action delete" title="Supprimer" data-action="delete" data-element-id="${elementData.id}">
                    🗑️
                </button>
            </div>
        `;

        // Clic pour sélectionner
        item.addEventListener('click', (e) => {
            if (!e.target.closest('.element-action')) {
                this.selectElement(elementData.id);
            }
        });

        // Gestionnaires d'événements pour les boutons d'action
        const editBtn = item.querySelector('[data-action="edit"]');
        const duplicateBtn = item.querySelector('[data-action="duplicate"]');
        const deleteBtn = item.querySelector('[data-action="delete"]');

        if (editBtn) {
            editBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.editElement(elementData.id);
            });
        }

        if (duplicateBtn) {
            duplicateBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.duplicateElement(elementData.id);
            });
        }

        if (deleteBtn) {
            deleteBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                e.preventDefault();
                this.deleteElement(elementData.id);
            });
        }

        return item;
    }

    getElementIcon(type) {
        const icons = {
            'grid': '⊞',
            'line': '📏',
            'polyline': '📐',
            'polygon': '🔷',
            'rectangle': '⬜',
            'circle': '⭕',
            'text': '📝',
            'measurement': '📏',
            'stamp': '🏷️',
            'isochrone': '⏱️',
            'isodistance': '📏',
            'zoning': '🗺️'
        };
        return icons[type] || '📐';
    }

    generateElementName(type) {
        const count = this.vectorElements.filter(el => el.type === type).length + 1;
        return `${type.charAt(0).toUpperCase() + type.slice(1)} ${count}`;
    }

    generateId() {
        return 'vector_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    }

    updateElementCount() {
        const count = this.vectorElements.length;
        const elementCount = document.getElementById('elementCount');
        if (elementCount) {
            elementCount.textContent = count;
        }
    }

    // ===== ACTIONS SUR LES ÉLÉMENTS =====
    editElement(elementId) {
        const elementData = this.vectorElements.find(el => el.id === elementId);
        if (!elementData) return;

        this.showEditModal(elementData);
    }

    showEditModal(elementData) {
        const modal = this.createModal('Modifier l\'élément', `
            <div class="edit-form">
                <div class="form-group">
                    <label>Nom :</label>
                    <input type="text" id="editName" value="${elementData.name}">
                </div>
                <div class="form-group">
                    <label>Couleur :</label>
                    <input type="color" id="editColor" value="${elementData.settings.color}">
                </div>
                <div class="form-group">
                    <label>Épaisseur :</label>
                    <input type="range" id="editWeight" min="1" max="10" value="${elementData.settings.weight}">
                    <span class="weight-value">${elementData.settings.weight}px</span>
                </div>
                <div class="form-group">
                    <label>Opacité :</label>
                    <input type="range" id="editOpacity" min="0.1" max="1" step="0.1" value="${elementData.settings.opacity}">
                    <span class="opacity-value">${Math.round(elementData.settings.opacity * 100)}%</span>
                </div>
                <div class="form-group">
                    <label>
                        <input type="checkbox" id="editVisible" ${elementData.visible ? 'checked' : ''}>
                        Visible
                    </label>
                </div>
                <div class="form-group">
                    <label>
                        <input type="checkbox" id="editLocked" ${elementData.locked ? 'checked' : ''}>
                        Verrouillé
                    </label>
                </div>
                <div class="form-actions">
                    <button id="saveEdit" class="btn-primary">Sauvegarder</button>
                    <button id="cancelEdit" class="btn-secondary">Annuler</button>
                </div>
            </div>
        `);

        // Gestion des changements en temps réel
        const updateElement = () => {
            const name = document.getElementById('editName').value;
            const color = document.getElementById('editColor').value;
            const weight = parseInt(document.getElementById('editWeight').value);
            const opacity = parseFloat(document.getElementById('editOpacity').value);
            const visible = document.getElementById('editVisible').checked;
            const locked = document.getElementById('editLocked').checked;

            // Mettre à jour les données
            elementData.name = name;
            elementData.settings.color = color;
            elementData.settings.weight = weight;
            elementData.settings.opacity = opacity;
            elementData.visible = visible;
            elementData.locked = locked;

            // Mettre à jour l'élément sur la carte
            this.updateElementOnMap(elementData);

            // Mettre à jour l'affichage
            this.updateElementList();
        };

        // Événements
        document.getElementById('editWeight').addEventListener('input', (e) => {
            document.querySelector('.weight-value').textContent = e.target.value + 'px';
            updateElement();
        });

        document.getElementById('editOpacity').addEventListener('input', (e) => {
            document.querySelector('.opacity-value').textContent = Math.round(e.target.value * 100) + '%';
            updateElement();
        });

        document.getElementById('editName').addEventListener('input', updateElement);
        document.getElementById('editColor').addEventListener('change', updateElement);
        document.getElementById('editVisible').addEventListener('change', updateElement);
        document.getElementById('editLocked').addEventListener('change', updateElement);

        document.getElementById('saveEdit').addEventListener('click', () => {
            this.saveToLocalStorage();
            this.closeModal();
        });

        document.getElementById('cancelEdit').addEventListener('click', () => {
            this.closeModal();
        });
    }

    updateElementOnMap(elementData) {
        if (!elementData.element || !window.map) return;

        const element = elementData.element;
        const settings = elementData.settings;

        // Mettre à jour les propriétés selon le type d'élément
        if (element.setStyle) {
            element.setStyle({
                color: settings.color,
                weight: settings.weight,
                opacity: settings.opacity
            });
        }

        // Gérer la visibilité
        if (elementData.visible) {
            if (!window.map.hasLayer(element)) {
                element.addTo(window.map);
            }
        } else {
            if (window.map.hasLayer(element)) {
                window.map.removeLayer(element);
            }
        }
    }

    duplicateElement(elementId) {
        const elementData = this.vectorElements.find(el => el.id === elementId);
        if (!elementData) return;

        // Créer une copie de l'élément
        const newElement = this.cloneElement(elementData.element);
        if (newElement) {
            this.addVectorElement(newElement, elementData.type, elementData.name + ' (copie)');
            this.showMessage('Élément dupliqué avec succès !', 'success');
        }
    }

    cloneElement(element) {
        // Cette méthode devrait être implémentée selon le type d'élément
        // Pour l'instant, on retourne null
        return null;
    }

    deleteElement(elementId) {
        // Vérifier que l'élément existe avant de demander confirmation
        const elementData = this.vectorElements.find(el => el.id === elementId);
        if (!elementData) {
            return;
        }
        
        // Créer une modale de confirmation personnalisée
        this.showDeleteConfirmation(elementId, elementData.name);
    }

    showDeleteConfirmation(elementId, elementName) {
        const modal = this.createModal('Confirmer la suppression', `
            <div class="delete-confirmation">
                <p>Êtes-vous sûr de vouloir supprimer l'élément :</p>
                <p><strong>"${elementName}"</strong> ?</p>
                <div class="form-actions">
                    <button id="confirmDelete" class="btn-primary" style="background: #f44336;">Oui, supprimer</button>
                    <button id="cancelDelete" class="btn-secondary">Annuler</button>
                </div>
            </div>
        `);

        // Gestionnaire pour la confirmation
        document.getElementById('confirmDelete').addEventListener('click', () => {
            this.removeVectorElement(elementId);
            this.showMessage('Élément supprimé avec succès !', 'success');
            this.closeModal();
        });

        // Gestionnaire pour l'annulation
        document.getElementById('cancelDelete').addEventListener('click', () => {
            this.closeModal();
        });
    }

    // ===== ACTIONS GLOBALES =====
    saveAllVectors() {
        this.saveToLocalStorage();
        this.showMessage('Tous les éléments vectoriels ont été sauvegardés !', 'success');
    }

    clearAllVectors() {
        if (confirm('Êtes-vous sûr de vouloir supprimer tous les éléments vectoriels ?')) {
            // Supprimer de la carte
            this.vectorElements.forEach(elementData => {
                if (elementData.element && window.map) {
                    window.map.removeLayer(elementData.element);
                }
            });

            // Vider la liste
            this.vectorElements = [];
            this.updateElementList();
            this.updateElementCount();
            this.saveToLocalStorage();
            
            this.showMessage('Tous les éléments vectoriels ont été supprimés !', 'success');
        }
    }

    exportVectors() {
        const exportData = {
            version: '1.0',
            created: new Date().toISOString(),
            elements: this.vectorElements.map(el => ({
                id: el.id,
                type: el.type,
                name: el.name,
                settings: el.settings,
                visible: el.visible,
                locked: el.locked,
                created: el.created.toISOString()
            }))
        };

        const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        
        const link = document.createElement('a');
        link.href = url;
        link.download = `vector_elements_${new Date().toISOString().split('T')[0]}.json`;
        link.style.display = 'none';
        
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        
        URL.revokeObjectURL(url);
        this.showMessage('Éléments vectoriels exportés avec succès !', 'success');
    }

    importVectors() {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json';
        input.onchange = (e) => {
            const file = e.target.files[0];
            if (!file) return;

            const reader = new FileReader();
            reader.onload = (e) => {
                try {
                    const data = JSON.parse(e.target.result);
                    this.importVectorData(data);
                } catch (error) {
                    this.showMessage('Erreur lors de l\'importation du fichier', 'error');
                }
            };
            reader.readAsText(file);
        };
        input.click();
    }

    importVectorData(data) {
        if (!data.elements || !Array.isArray(data.elements)) {
            this.showMessage('Format de fichier invalide', 'error');
            return;
        }

        // Importer les éléments
        data.elements.forEach(elementData => {
            // Note: La reconstruction des éléments sur la carte devrait être implémentée
            // selon le type d'élément et les données disponibles
            this.vectorElements.push({
                ...elementData,
                element: null, // À reconstruire selon le type
                created: new Date(elementData.created)
            });
        });

        this.updateElementList();
        this.updateElementCount();
        this.saveToLocalStorage();
        this.showMessage(`${data.elements.length} éléments vectoriels importés avec succès !`, 'success');
    }

    // ===== GESTION DE L'INTERFACE =====
    toggleMinimize() {
        this.isMinimized = !this.isMinimized;
        const toolbox = document.getElementById('vectorToolbox');
        const content = document.getElementById('toolboxContent') || document.getElementById('vectorElementsList');
        
        if (toolbox && content) {
            if (this.isMinimized) {
                toolbox.classList.add('minimized');
                content.style.display = 'none';
            } else {
                toolbox.classList.remove('minimized');
                content.style.display = 'block';
            }
        }
    }

    closeToolbox() {
        const toolbox = document.getElementById('vectorToolbox');
        if (toolbox) {
            toolbox.style.display = 'none';
        }
    }

    toggleSection(section) {
        const content = section.querySelector('.section-content');
        const header = section.querySelector('.section-header');
        
        content.classList.toggle('collapsed');
        header.classList.toggle('collapsed');
    }

    // ===== GESTION DU DÉPLACEMENT =====
    startDrag(e) {
        this.isDragging = true;
        const toolbox = document.getElementById('vectorToolbox');
        const rect = toolbox.getBoundingClientRect();
        
        this.dragOffset = {
            x: e.clientX - rect.left,
            y: e.clientY - rect.top
        };
        
        toolbox.style.position = 'fixed';
        toolbox.style.zIndex = '1001';
    }

    drag(e) {
        if (!this.isDragging) return;
        
        const toolbox = document.getElementById('vectorToolbox');
        const x = e.clientX - this.dragOffset.x;
        const y = e.clientY - this.dragOffset.y;
        
        // Limiter aux bords de l'écran
        const maxX = window.innerWidth - toolbox.offsetWidth;
        const maxY = window.innerHeight - toolbox.offsetHeight;
        
        toolbox.style.left = Math.max(0, Math.min(x, maxX)) + 'px';
        toolbox.style.top = Math.max(0, Math.min(y, maxY)) + 'px';
        toolbox.style.right = 'auto';
    }

    endDrag() {
        if (!this.isDragging) return;
        
        this.isDragging = false;
        this.saveToolboxPosition();
    }

    saveToolboxPosition() {
        const toolbox = document.getElementById('vectorToolbox');
        const rect = toolbox.getBoundingClientRect();
        const position = {
            left: rect.left,
            top: rect.top
        };
        localStorage.setItem('vectorToolboxPosition', JSON.stringify(position));
    }

    loadToolboxPosition() {
        const savedPosition = localStorage.getItem('vectorToolboxPosition');
        if (savedPosition) {
            const position = JSON.parse(savedPosition);
            const toolbox = document.getElementById('vectorToolbox');
            if (toolbox) {
                toolbox.style.left = position.left + 'px';
                toolbox.style.top = position.top + 'px';
                toolbox.style.right = 'auto';
            }
        }
    }

    // ===== GESTION DES PARAMÈTRES =====
    updateDefaultColor(color) {
        this.defaultSettings.color = color;
        this.saveSettings();
    }

    updateDefaultWeight(weight) {
        this.defaultSettings.weight = parseInt(weight);
        document.querySelector('.weight-value').textContent = weight + 'px';
        this.saveSettings();
    }

    updateDefaultOpacity(opacity) {
        this.defaultSettings.opacity = parseFloat(opacity);
        document.querySelector('.opacity-value').textContent = Math.round(opacity * 100) + '%';
        this.saveSettings();
    }

    saveSettings() {
        localStorage.setItem('vectorToolboxSettings', JSON.stringify(this.defaultSettings));
    }

    loadSettings() {
        const savedSettings = localStorage.getItem('vectorToolboxSettings');
        if (savedSettings) {
            this.defaultSettings = { ...this.defaultSettings, ...JSON.parse(savedSettings) };
            
            // Mettre à jour l'interface si les éléments existent
            const colorInput = document.getElementById('defaultColor');
            const weightInput = document.getElementById('defaultWeight');
            const opacityInput = document.getElementById('defaultOpacity');
            
            if (colorInput) colorInput.value = this.defaultSettings.color;
            if (weightInput) weightInput.value = this.defaultSettings.weight;
            if (opacityInput) opacityInput.value = this.defaultSettings.opacity;
            
            const weightValue = document.querySelector('.weight-value');
            const opacityValue = document.querySelector('.opacity-value');
            
            if (weightValue) weightValue.textContent = this.defaultSettings.weight + 'px';
            if (opacityValue) opacityValue.textContent = Math.round(this.defaultSettings.opacity * 100) + '%';
        }
    }

    saveToLocalStorage() {
        // Sauvegarder les éléments vectoriels (sans les objets Leaflet)
        const saveData = this.vectorElements.map(el => ({
            ...el,
            element: null // Ne pas sauvegarder l'objet Leaflet
        }));
        localStorage.setItem('vectorElements', JSON.stringify(saveData));
    }

    loadFromLocalStorage() {
        const savedData = localStorage.getItem('vectorElements');
        if (savedData) {
            try {
                const data = JSON.parse(savedData);
                this.vectorElements = data.map(el => ({
                    ...el,
                    element: null, // À reconstruire selon le type
                    created: new Date(el.created)
                }));
                this.updateElementList();
                this.updateElementCount();
            } catch (error) {
                console.error('Erreur lors du chargement des éléments vectoriels:', error);
            }
        }
    }

    // ===== UTILITAIRES =====
    createModal(title, content) {
        const modal = document.createElement('div');
        modal.className = 'vector-modal';
        modal.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0,0,0,0.8);
            z-index: 10000;
            display: flex;
            align-items: center;
            justify-content: center;
            font-family: 'Open Sans', sans-serif;
        `;

        const dialog = document.createElement('div');
        dialog.className = 'modal-content';
        dialog.innerHTML = `
            <h3>${title}</h3>
            ${content}
        `;

        modal.appendChild(dialog);
        document.body.appendChild(modal);

        // Fermer avec Échap
        const handleEscape = (e) => {
            if (e.key === 'Escape') {
                this.closeModal();
                document.removeEventListener('keydown', handleEscape);
            }
        };
        document.addEventListener('keydown', handleEscape);

        return modal;
    }

    closeModal() {
        const modal = document.querySelector('.vector-modal');
        if (modal) {
            modal.remove();
        }
    }

    showMessage(message, type = 'info') {
        // Utiliser le système de messages existant si disponible
        if (window.CustomMessages && window.CustomMessages[type]) {
            window.CustomMessages[type](message);
        } else {
            // Créer un système de messages simple
            this.createSimpleMessage(message, type);
        }
    }

    createSimpleMessage(message, type) {
        const messageDiv = document.createElement('div');
        messageDiv.style.cssText = `
            position: fixed;
            top: 20px;
            left: 50%;
            transform: translateX(-50%);
            background: ${type === 'error' ? '#f44336' : type === 'success' ? '#4CAF50' : '#2196F3'};
            color: white;
            padding: 12px 24px;
            border-radius: 6px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.3);
            z-index: 10001;
            font-family: 'Open Sans', sans-serif;
            font-size: 14px;
            font-weight: 500;
            max-width: 400px;
            text-align: center;
        `;
        messageDiv.textContent = message;
        
        document.body.appendChild(messageDiv);
        
        // Supprimer après 3 secondes
        setTimeout(() => {
            if (messageDiv.parentNode) {
                messageDiv.parentNode.removeChild(messageDiv);
            }
        }, 3000);
    }

    // ===== GESTION DU PLIAGE/DÉPLIAGE =====

    toggleToolboxSection(header) {
        const section = header.parentElement;
        section.classList.toggle('collapsed');
    }

    // ===== GESTION DES PARAMÈTRES DYNAMIQUES =====

    // Palette de 15 couleurs RVB (3 lignes × 5 colonnes)
    getColorPalette() {
        return [
            // Ligne 1: Couleurs primaires et vives
            ['#FF0000', '#FF7F00', '#FFFF00', '#00FF00', '#0000FF'],
            // Ligne 2: Couleurs secondaires et neutres
            ['#800080', '#FF69B4', '#00FFFF', '#8B4513', '#808080'],
            // Ligne 3: Couleurs sombres et spéciales
            ['#000000', '#FFFFFF', '#4B0082', '#40E0D0', '#FF00FF']
        ];
    }

    createColorPalette(containerId, selectedColor = '#4CAF50', onColorSelect = null) {
        const palette = this.getColorPalette();
        let html = '<div class="color-palette">';
        
        palette.forEach((row, rowIndex) => {
            row.forEach((color, colIndex) => {
                const isSelected = color === selectedColor;
                const colorName = this.getColorName(color);
                html += `
                    <button class="color-btn ${isSelected ? 'selected' : ''}" 
                            data-color="${color}" 
                            title="${colorName}"
                            style="background-color: ${color};">
                        ${isSelected ? '✓' : ''}
                    </button>
                `;
            });
        });
        
        html += '</div>';
        
        // Ajouter les événements de clic
        setTimeout(() => {
            const colorButtons = document.querySelectorAll(`#${containerId} .color-btn`);
            colorButtons.forEach(btn => {
                btn.addEventListener('click', (e) => {
                    const color = e.target.dataset.color;
                    
                    // Désélectionner tous les boutons
                    colorButtons.forEach(b => {
                        b.classList.remove('selected');
                        b.textContent = '';
                    });
                    
                    // Sélectionner le bouton cliqué
                    e.target.classList.add('selected');
                    e.target.textContent = '✓';
                    
                    // Appeler la fonction de callback si fournie
                    if (onColorSelect) {
                        onColorSelect(color);
                    }
                });
            });
        }, 100);
        
        return html;
    }

    getColorName(color) {
        const colorNames = {
            '#FF0000': 'Rouge',
            '#FF7F00': 'Orange',
            '#FFFF00': 'Jaune',
            '#00FF00': 'Vert',
            '#0000FF': 'Bleu',
            '#800080': 'Violet',
            '#FF69B4': 'Rose',
            '#00FFFF': 'Cyan',
            '#8B4513': 'Marron',
            '#808080': 'Gris',
            '#000000': 'Noir',
            '#FFFFFF': 'Blanc',
            '#4B0082': 'Indigo',
            '#40E0D0': 'Turquoise',
            '#FF00FF': 'Magenta'
        };
        return colorNames[color] || color;
    }

    updateToolParameters(toolType) {
        console.log('🔧 VectorToolbox: Mise à jour des paramètres pour:', toolType);
        const content = document.getElementById('toolParametersContent');
        if (!content) {
            console.error('❌ Élément toolParametersContent non trouvé');
            return;
        }

        console.log('✅ Contenu trouvé, mise à jour en cours...');
        // Vider le contenu actuel
        content.innerHTML = '';

        switch(toolType) {
            case 'grid':
                console.log('📐 Affichage des paramètres de grille');
                this.showGridParameters(content);
                break;
            case 'text':
                console.log('📝 Affichage des paramètres de texte');
                this.showTextParameters(content);
                break;
            case 'line':
            case 'polyline':
            case 'polygon':
            case 'rectangle':
            case 'circle':
                console.log('🎨 Affichage des paramètres de dessin pour:', toolType);
                this.showDrawingParameters(content, toolType);
                break;
            default:
                console.log('⚙️ Affichage des paramètres par défaut');
                this.showDefaultParameters(content);
                break;
        }
        console.log('✅ Paramètres mis à jour avec succès');
    }

    showGridParameters(container) {
        container.innerHTML = `
            <div class="tool-parameters">
                <div class="setting-group">
                    <label>Échelle de la grille :</label>
                    <select id="gridScale">
                        <option value="1">1 case = 1 mètre</option>
                        <option value="5">1 case = 5 mètres</option>
                        <option value="10" selected>1 case = 10 mètres</option>
                        <option value="15">1 case = 15 mètres</option>
                        <option value="20">1 case = 20 mètres</option>
                        <option value="25">1 case = 25 mètres</option>
                        <option value="50">1 case = 50 mètres</option>
                        <option value="100">1 case = 100 mètres</option>
                        <option value="250">1 case = 250 mètres</option>
                        <option value="500">1 case = 500 mètres</option>
                        <option value="1000">1 case = 1 kilomètre</option>
                        <option value="custom">Personnalisée</option>
                    </select>
                </div>
                <div class="setting-group" id="customScaleGroup" style="display: none;">
                    <label>Échelle personnalisée (mètres) :</label>
                    <input type="number" id="gridCustomScale" min="1" max="10000" value="10" step="1">
                </div>
                <div class="setting-group">
                    <label>Taille de la grille :</label>
                    <select id="gridSize">
                        <option value="small">Petite (10x10)</option>
                        <option value="medium" selected>Moyenne (20x20)</option>
                        <option value="large">Grande (50x50)</option>
                        <option value="custom">Personnalisée</option>
                    </select>
                </div>
                <div class="setting-group" id="customSizeGroup" style="display: none;">
                    <label>Largeur (colonnes) :</label>
                    <input type="number" id="gridWidth" min="5" max="100" value="20">
                    <label>Hauteur (lignes) :</label>
                    <input type="number" id="gridHeight" min="5" max="100" value="20">
                </div>
                <div class="setting-group">
                    <label>Couleur des lignes :</label>
                    <div id="gridColorPalette"></div>
                </div>
                <div class="setting-group">
                    <label>Opacité des lignes :</label>
                    <input type="range" id="gridOpacity" min="0.1" max="1" step="0.1" value="1">
                    <span class="opacity-value">100%</span>
                </div>
                <div class="setting-group">
                    <label>
                        <input type="checkbox" id="showCoordinates" checked>
                        Afficher les coordonnées internes
                    </label>
                </div>
                <div class="setting-group">
                    <label style="font-weight: bold; color: #333; margin-bottom: 10px; border-bottom: 1px solid #ddd; padding-bottom: 5px;">Informations de la carte</label>
                </div>
                <div class="setting-group">
                    <label>Titre de la carte :</label>
                    <input type="text" id="gridTitle" placeholder="Ex: Plan de secours centre-ville" maxlength="50">
                </div>
                <div class="setting-group">
                    <label>Adresse du lieu :</label>
                    <input type="text" id="gridAddress" placeholder="Ex: 123 Rue de la Paix, 75001 Paris" maxlength="80">
                </div>
                <div class="setting-group">
                    <label>Coordonnées GPS (Google) :</label>
                    <input type="text" id="gridGPS" placeholder="Ex: 48.87025, 2.33195" maxlength="30">
                </div>
                <div class="setting-group">
                    <label>Date de la carte :</label>
                    <input type="date" id="gridDate">
                </div>
                <div class="setting-group">
                    <label>Heure de la carte :</label>
                    <input type="time" id="gridTime">
                </div>
                <div class="setting-group">
                    <button id="generateGridBtn" class="btn-primary">Générer</button>
                </div>
                <div class="setting-group" style="text-align: center;">
                    <button id="repositionGridBtn" class="btn-primary" style="display: none; background: #2196F3 !important; border-color: #2196F3 !important;">Repositionner</button>
                </div>
                <div class="setting-group" style="text-align: center;">
                    <button id="deselectGridBtn" class="btn-primary" style="display: none; background: #f44336;">Désélectionner</button>
                </div>
            </div>
        `;

        // Ajouter la palette de couleurs
        const colorContainer = container.querySelector('#gridColorPalette');
        if (colorContainer) {
            colorContainer.innerHTML = this.createColorPalette('gridColorPalette', '#FFFFFF', (color) => {
                console.log('Couleur de grille sélectionnée:', color);
            });
        }

        // Gestion de l'échelle personnalisée
        const gridScaleSelect = container.querySelector('#gridScale');
        const customScaleGroup = container.querySelector('#customScaleGroup');
        
        if (gridScaleSelect && customScaleGroup) {
            gridScaleSelect.addEventListener('change', () => {
                if (gridScaleSelect.value === 'custom') {
                    customScaleGroup.style.display = 'block';
                } else {
                    customScaleGroup.style.display = 'none';
                }
            });
        }

        // Gestion de la taille personnalisée
        const gridSizeSelect = container.querySelector('#gridSize');
        const customSizeGroup = container.querySelector('#customSizeGroup');
        
        if (gridSizeSelect && customSizeGroup) {
            gridSizeSelect.addEventListener('change', () => {
                if (gridSizeSelect.value === 'custom') {
                    customSizeGroup.style.display = 'block';
                } else {
                    customSizeGroup.style.display = 'none';
                }
            });
        }

        // Gestion de l'opacité
        const opacityInput = container.querySelector('#gridOpacity');
        const opacityValue = container.querySelector('.opacity-value');
        
        if (opacityInput && opacityValue) {
            opacityInput.addEventListener('input', (e) => {
                opacityValue.textContent = Math.round(e.target.value * 100) + '%';
            });
        }

        // Bouton de génération
        const generateBtn = container.querySelector('#generateGridBtn');
        if (generateBtn) {
            generateBtn.addEventListener('click', () => {
                this.generateGridFromToolbox();
            });
        }

        // Bouton de repositionnement
        const repositionBtn = container.querySelector('#repositionGridBtn');
        if (repositionBtn) {
            repositionBtn.addEventListener('click', () => {
                this.startGridRepositioning();
            });
        }

        // Bouton de désélection
        const deselectBtn = container.querySelector('#deselectGridBtn');
        if (deselectBtn) {
            deselectBtn.addEventListener('click', () => {
                if (window.vectorToolbar && window.vectorToolbar.deselectGrid) {
                    window.vectorToolbar.deselectGrid();
                    deselectBtn.style.display = 'none';
                    repositionBtn.style.display = 'none';
                    generateBtn.textContent = 'Générer';
                    generateBtn.onclick = () => this.generateGridFromToolbox();
                }
            });
        }
    }

    showTextParameters(container) {
        container.innerHTML = `
            <div class="tool-parameters">
                <h4>Paramètres du texte</h4>
                <div class="setting-group">
                    <label>Taille de police :</label>
                    <select id="textFontSize">
                        <option value="12">12px</option>
                        <option value="14">14px</option>
                        <option value="16" selected>16px</option>
                        <option value="18">18px</option>
                        <option value="20">20px</option>
                        <option value="24">24px</option>
                    </select>
                </div>
                <div class="setting-group">
                    <label>Couleur du texte :</label>
                    <div id="textColorPalette"></div>
                </div>
                <div class="setting-group">
                    <label>Arrière-plan :</label>
                    <div id="textBackgroundPalette"></div>
                </div>
            </div>
        `;

        // Ajouter les palettes de couleurs
        const textColorContainer = container.querySelector('#textColorPalette');
        const textBgContainer = container.querySelector('#textBackgroundPalette');
        
        if (textColorContainer) {
            textColorContainer.innerHTML = this.createColorPalette('textColorPalette', '#333333', (color) => {
                console.log('Couleur de texte sélectionnée:', color);
            });
        }
        
        if (textBgContainer) {
            textBgContainer.innerHTML = this.createColorPalette('textBackgroundPalette', '#FFFFFF', (color) => {
                console.log('Couleur d\'arrière-plan sélectionnée:', color);
            });
        }
    }

    showDrawingParameters(container, toolType) {
        const toolNames = {
            'line': 'ligne',
            'polyline': 'polyligne',
            'polygon': 'polygone',
            'rectangle': 'rectangle',
            'circle': 'cercle'
        };

        container.innerHTML = `
            <div class="tool-parameters">
                <h4>Paramètres de la ${toolNames[toolType] || 'forme'}</h4>
                <div class="setting-group">
                    <label>Couleur :</label>
                    <div id="drawingColorPalette"></div>
                </div>
                <div class="setting-group">
                    <label>Épaisseur :</label>
                    <input type="range" id="drawingWeight" min="1" max="10" value="3">
                    <span class="weight-value">3px</span>
                </div>
                <div class="setting-group">
                    <label>Opacité :</label>
                    <input type="range" id="drawingOpacity" min="0.1" max="1" step="0.1" value="0.8">
                    <span class="opacity-value">80%</span>
                </div>
                ${toolType === 'polygon' || toolType === 'rectangle' || toolType === 'circle' ? `
                <div class="setting-group">
                    <label>Opacité de remplissage :</label>
                    <input type="range" id="drawingFillOpacity" min="0" max="1" step="0.1" value="0.2">
                    <span class="fill-opacity-value">20%</span>
                </div>
                ` : ''}
            </div>
        `;

        // Ajouter la palette de couleurs
        const colorContainer = container.querySelector('#drawingColorPalette');
        if (colorContainer) {
            colorContainer.innerHTML = this.createColorPalette('drawingColorPalette', '#4CAF50', (color) => {
                console.log('Couleur de dessin sélectionnée:', color);
            });
        }

        // Gestion des valeurs dynamiques
        this.setupDynamicValueUpdates(container);
    }

    showDefaultParameters(container) {
        container.innerHTML = `
            <div class="tool-parameters">
                <h4>Paramètres généraux</h4>
                <div class="setting-group">
                    <label>Couleur par défaut :</label>
                    <div id="defaultColorPalette"></div>
                </div>
                <div class="setting-group">
                    <label>Épaisseur par défaut :</label>
                    <input type="range" id="defaultWeight" min="1" max="10" value="3">
                    <span class="weight-value">3px</span>
                </div>
                <div class="setting-group">
                    <label>Opacité par défaut :</label>
                    <input type="range" id="defaultOpacity" min="0.1" max="1" step="0.1" value="0.8">
                    <span class="opacity-value">80%</span>
                </div>
            </div>
        `;

        // Ajouter la palette de couleurs
        const colorContainer = container.querySelector('#defaultColorPalette');
        if (colorContainer) {
            colorContainer.innerHTML = this.createColorPalette('defaultColorPalette', '#4CAF50', (color) => {
                console.log('Couleur par défaut sélectionnée:', color);
            });
        }

        // Gestion des valeurs dynamiques
        this.setupDynamicValueUpdates(container);
    }

    setupDynamicValueUpdates(container) {
        // Gestion de l'épaisseur
        const weightInput = container.querySelector('#defaultWeight, #drawingWeight');
        const weightValue = container.querySelector('.weight-value');
        
        if (weightInput && weightValue) {
            weightInput.addEventListener('input', (e) => {
                weightValue.textContent = e.target.value + 'px';
            });
        }

        // Gestion de l'opacité
        const opacityInput = container.querySelector('#defaultOpacity, #drawingOpacity');
        const opacityValue = container.querySelector('.opacity-value');
        
        if (opacityInput && opacityValue) {
            opacityInput.addEventListener('input', (e) => {
                opacityValue.textContent = Math.round(e.target.value * 100) + '%';
            });
        }

        // Gestion de l'opacité de remplissage
        const fillOpacityInput = container.querySelector('#drawingFillOpacity');
        const fillOpacityValue = container.querySelector('.fill-opacity-value');
        
        if (fillOpacityInput && fillOpacityValue) {
            fillOpacityInput.addEventListener('input', (e) => {
                fillOpacityValue.textContent = Math.round(e.target.value * 100) + '%';
            });
        }
    }

    generateGridFromToolbox() {
        // Vérifier si une grille est sélectionnée
        if (window.vectorToolbar && window.vectorToolbar.selectedGrid) {
            // Mettre à jour la grille existante
            console.log('🔄 Mise à jour de la grille sélectionnée depuis la toolbox');
            window.vectorToolbar.updateSelectedGrid(window.vectorToolbar.selectedGrid);
        } else {
            // Obtenir les paramètres de la toolbox
            const scaleSelect = document.getElementById('gridScale')?.value || '10';
            let scale;
            if (scaleSelect === 'custom') {
                scale = parseInt(document.getElementById('gridCustomScale')?.value || 10);
            } else {
                scale = parseInt(scaleSelect);
            }
            const size = document.getElementById('gridSize')?.value || 'medium';
            const opacity = parseFloat(document.getElementById('gridOpacity')?.value || 0.7);
            const showCoordinates = document.getElementById('showCoordinates')?.checked !== false;
            
            // Obtenir la couleur sélectionnée
            const selectedColorBtn = document.querySelector('#gridColorPalette .color-btn.selected');
            const color = selectedColorBtn ? selectedColorBtn.dataset.color : '#333333';
            
            // Obtenir les informations de la carte
            const title = document.getElementById('gridTitle')?.value || '';
            const address = document.getElementById('gridAddress')?.value || '';
            const gps = document.getElementById('gridGPS')?.value || '';
            const date = document.getElementById('gridDate')?.value || '';
            const time = document.getElementById('gridTime')?.value || '';
            
            const gridInfo = { title, address, gps, date, time };
            
            let width, height;
            if (size === 'custom') {
                width = parseInt(document.getElementById('gridWidth')?.value || 20);
                height = parseInt(document.getElementById('gridHeight')?.value || 20);
            } else {
                const sizes = {
                    'small': [10, 10],
                    'medium': [20, 20],
                    'large': [50, 50]
                };
                [width, height] = sizes[size];
            }

            // Créer une nouvelle grille
            console.log('🆕 Création d\'une nouvelle grille depuis la toolbox');
            if (window.vectorToolbar && window.vectorToolbar.generateGridWithParams) {
                window.vectorToolbar.generateGridWithParams(scale, width, height, color, opacity, showCoordinates, gridInfo);
            } else {
                console.warn('VectorToolbar non disponible pour générer la grille');
            }
        }
    }

    startGridRepositioning() {
        // Vérifier qu'une grille est sélectionnée
        if (!window.vectorToolbar || !window.vectorToolbar.selectedGrid) {
            this.showMessage('Aucune grille sélectionnée pour le repositionnement', 'error');
            return;
        }

        const selectedGrid = window.vectorToolbar.selectedGrid;
        
        // Activer le mode de repositionnement
        this.isRepositioning = true;
        this.gridToReposition = selectedGrid;
        
        // Changer le curseur de la carte
        if (window.map) {
            window.map.getContainer().style.cursor = 'crosshair';
        }
        
        // Afficher un message d'instruction
        this.showMessage('Cliquez sur la carte pour repositionner la grille (coin inférieur gauche)', 'info');
        
        // Ajouter un gestionnaire de clic sur la carte
        this.mapClickHandler = (e) => {
            this.repositionGrid(e.latlng);
        };
        
        if (window.map) {
            window.map.on('click', this.mapClickHandler);
        }
        
        // Mettre à jour l'interface
        const repositionBtn = document.getElementById('repositionGridBtn');
        if (repositionBtn) {
            repositionBtn.textContent = 'Annuler';
            repositionBtn.style.background = '#f44336';
            repositionBtn.style.borderColor = '#f44336';
        }
    }

    repositionGrid(newLatLng) {
        if (!this.isRepositioning || !this.gridToReposition) {
            return;
        }

        // Récupérer les paramètres de la grille existante
        const gridData = this.gridToReposition._gridParams;
        if (!gridData) {
            this.showMessage('Impossible de récupérer les paramètres de la grille', 'error');
            this.cancelRepositioning();
            return;
        }

        // 1. Supprimer l'ancienne grille de la carte
        if (window.map && this.gridToReposition) {
            window.map.removeLayer(this.gridToReposition);
        }

        // 2. Supprimer de la liste des éléments vectoriels du vector-toolbar
        if (window.vectorToolbar && window.vectorToolbar.vectorElements) {
            const vectorIndex = window.vectorToolbar.vectorElements.indexOf(this.gridToReposition);
            if (vectorIndex > -1) {
                window.vectorToolbar.vectorElements.splice(vectorIndex, 1);
            }
        }

        // 3. Supprimer de la toolbox
        const toolboxIndex = this.vectorElements.findIndex(el => el.element === this.gridToReposition);
        if (toolboxIndex > -1) {
            this.vectorElements.splice(toolboxIndex, 1);
            // Mettre à jour la liste dans l'interface
            this.updateElementList();
        }

        // 4. Créer la nouvelle grille aux nouvelles coordonnées
        if (window.vectorToolbar && window.vectorToolbar.createGrid) {
            const newGrid = window.vectorToolbar.createGrid(
                newLatLng,
                gridData.scale,
                gridData.width,
                gridData.height,
                gridData.color,
                gridData.opacity,
                gridData.showCoordinates,
                gridData.gridInfo || {}
            );

            // La grille est déjà ajoutée à la liste des éléments vectoriels et à la toolbox par createGrid
            
            // Sélectionner la nouvelle grille
            if (window.vectorToolbar.selectGrid) {
                window.vectorToolbar.selectGrid(newGrid);
            }
        }

        // Terminer le repositionnement
        this.cancelRepositioning();
        this.showMessage('Grille repositionnée avec succès !', 'success');
    }

    cancelRepositioning() {
        this.isRepositioning = false;
        this.gridToReposition = null;
        
        // Restaurer le curseur de la carte
        if (window.map) {
            window.map.getContainer().style.cursor = '';
        }
        
        // Supprimer le gestionnaire de clic
        if (this.mapClickHandler && window.map) {
            window.map.off('click', this.mapClickHandler);
            this.mapClickHandler = null;
        }
        
        // Restaurer l'interface
        const repositionBtn = document.getElementById('repositionGridBtn');
        if (repositionBtn) {
            repositionBtn.textContent = 'Repositionner';
            repositionBtn.style.background = '#2196F3';
            repositionBtn.style.borderColor = '#2196F3';
        }
    }

    closeToolbox() {
        // Masquer la toolbox
        const toolbox = document.getElementById('vectorToolbox');
        if (toolbox) {
            toolbox.style.display = 'none';
        }
        
        // Désélectionner la grille si elle est sélectionnée
        if (window.vectorToolbar && window.vectorToolbar.selectedGrid) {
            window.vectorToolbar.deselectGrid();
        }
    }
}

// L'initialisation se fait maintenant via VectorToolbarManager

// Exposer la classe globalement
window.VectorToolbox = VectorToolbox;

// Variable globale pour l'instance de la toolbox
window.vectorToolbox = null;

// L'initialisation se fait maintenant via VectorToolbarManager