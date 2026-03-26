/**
 * BARRE D'OUTILS VECTORIELLE - CRISIS MAPPER
 * Système de dessin et génération de marqueurs vectoriels
 */

class VectorToolbar {
    constructor() {
        this.activeTool = null;
        this.isDragging = false;
        this.dragOffset = { x: 0, y: 0 };
        this.vectorElements = [];
        this.currentDrawing = null;
        this.drawingMode = false;
        this.toolbox = null; // Référence vers la toolbox
        this.selectedGrid = null; // Grille actuellement sélectionnée
        
        this.init();
    }

    init() {
        // Attendre que le DOM soit complètement chargé
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => {
                this.setupEventListeners();
                this.setupToolbarPosition();
                this.initializeTools();
            });
        } else {
            this.setupEventListeners();
            this.setupToolbarPosition();
            this.initializeTools();
        }
    }

    setupEventListeners() {
        // Bouton d'activation principal
        const openBtn = document.getElementById('openVectorToolbar');
        if (openBtn) {
            openBtn.addEventListener('click', () => this.toggleToolbar());
        }

        // Bouton tout replier/déplier
        const toggleAllBtn = document.getElementById('toggleAllSections');
        if (toggleAllBtn) {
            toggleAllBtn.addEventListener('click', (e) => this.toggleAllSections());
        }

        // Gestion du pliage/dépliage des sections
        const sectionHeaders = document.querySelectorAll('#vectorToolbar > .vector-toolbar > .toolbar-content > .toolbar-section > .section-header');
        sectionHeaders.forEach((header) => {
            // Initialiser l'état des sections repliées
            const section = header.closest('.toolbar-section');
            if (section) {
                const content = section.querySelector('.section-content');
                
                if (section.classList.contains('collapsed') && content) {
                    content.style.display = 'none';
                }
            }
            
            // Ne pas gérer le pliage/dépliage pour les en-têtes qui sont des boutons d'outils
            if (!header.hasAttribute('data-tool')) {
                header.addEventListener('click', (e) => {
                    this.toggleSection(header);
                });
            }
        });

        // Gestion du pliage/dépliage des sections de la toolbox
        const toolboxSectionHeaders = document.querySelectorAll('.vector-toolbox .toolbox-section > .section-header');
        toolboxSectionHeaders.forEach((header) => {
            // Initialiser l'état des sections repliées
            const section = header.closest('.toolbox-section');
            if (section) {
                const content = section.querySelector('.section-content');
                
                if (section.classList.contains('collapsed') && content) {
                    content.style.display = 'none';
                }
            }
            
            header.addEventListener('click', (e) => {
                this.toggleSection(header);
            });
        });

        // Boutons d'outils
        const toolButtons = document.querySelectorAll('.tool-btn');
        toolButtons.forEach(btn => {
            btn.addEventListener('click', (e) => this.selectTool(e.target.closest('.tool-btn')));
        });

        // Gestion du clic droit sur la carte
        if (window.map) {
            console.log('Attachement de l\'événement clic droit');
            window.map.on('contextmenu', (e) => this.handleRightClick(e));
        } else {
            console.log('Carte non trouvée, tentative d\'attachement différé');
            // Essayer d'attacher l'événement plus tard
            setTimeout(() => {
                if (window.map) {
                    console.log('Attachement différé de l\'événement clic droit');
                    window.map.on('contextmenu', (e) => this.handleRightClick(e));
                }
            }, 1000);
        }

        // Gestion du déplacement de la barre d'outils
        const toolbar = document.getElementById('vectorToolbar');
        if (toolbar) {
            toolbar.addEventListener('mousedown', (e) => this.startDrag(e));
        }
        document.addEventListener('mousemove', (e) => this.drag(e));
        document.addEventListener('mouseup', () => this.endDrag());
    }

    setupToolbarPosition() {
        const toolbar = document.getElementById('vectorToolbar');
        if (!toolbar) return;
        
        const savedPosition = localStorage.getItem('vectorToolbarPosition');
        
        if (savedPosition) {
            const position = JSON.parse(savedPosition);
            toolbar.style.right = position.right + 'px';
            toolbar.style.top = position.top + 'px';
            toolbar.style.transform = 'none';
        }
    }

    saveToolbarPosition() {
        const toolbar = document.getElementById('vectorToolbar');
        if (!toolbar) return;
        
        const rect = toolbar.getBoundingClientRect();
        const position = {
            right: window.innerWidth - rect.right,
            top: rect.top
        };
        localStorage.setItem('vectorToolbarPosition', JSON.stringify(position));
    }

    toggleToolbar() {
        const toolbar = document.getElementById('vectorToolbar');
        const toolbox = document.getElementById('vectorToolbox');
        const openBtn = document.getElementById('openVectorToolbar');
        
        if (toolbar) {
            const isVisible = toolbar.style.display !== 'none';
            toolbar.style.display = isVisible ? 'none' : 'block';
            
            // Masquer la toolbox quand on ferme la toolbar
            if (toolbox && isVisible) {
                toolbox.style.display = 'none';
            }
            
            if (openBtn) {
                if (isVisible) {
                    openBtn.innerHTML = '<span>🎨</span><span>Formes</span>';
                    openBtn.title = 'Ouvrir la barre d\'outils vectorielle';
                } else {
                    openBtn.innerHTML = '<span>🎨</span><span>Formes</span>';
                    openBtn.title = 'Masquer la barre d\'outils vectorielle';
                }
            }
        }
    }


    startDrag(e) {
        this.isDragging = true;
        const toolbar = document.getElementById('vectorToolbar');
        const rect = toolbar.getBoundingClientRect();
        
        this.dragOffset.x = e.clientX - rect.left;
        this.dragOffset.y = e.clientY - rect.top;
        
        toolbar.style.position = 'fixed';
        toolbar.style.transform = 'none';
        toolbar.style.zIndex = '1001';
    }

    drag(e) {
        if (!this.isDragging) return;
        
        const toolbar = document.getElementById('vectorToolbar');
        const x = e.clientX - this.dragOffset.x;
        const y = e.clientY - this.dragOffset.y;
        
        // Limiter aux bords de l'écran
        const maxX = window.innerWidth - toolbar.offsetWidth;
        const maxY = window.innerHeight - toolbar.offsetHeight;
        
        toolbar.style.left = Math.max(0, Math.min(x, maxX)) + 'px';
        toolbar.style.top = Math.max(0, Math.min(y, maxY)) + 'px';
        toolbar.style.right = 'auto';
    }

    endDrag() {
        if (!this.isDragging) return;
        
        this.isDragging = false;
        this.saveToolbarPosition();
    }

    toggleSection(header) {
        const section = header.closest('.toolbar-section') || header.closest('.toolbox-section');
        if (!section) {
            return;
        }
        
        const content = section.querySelector('.section-content');
        if (!content) {
            return;
        }
        
        const wasCollapsed = section.classList.contains('collapsed');
        
        section.classList.toggle('collapsed');
        
        const isNowCollapsed = section.classList.contains('collapsed');
        
        // Forcer l'affichage du contenu
        if (isNowCollapsed) {
            content.style.display = 'none';
        } else {
            content.style.display = 'block';
        }
        
        // Gérer l'icône de toggle
        const toggleIcon = header.querySelector('.toggle-icon');
        if (toggleIcon) {
            toggleIcon.textContent = isNowCollapsed ? '▶' : '▼';
        }
    }

    toggleAllSections() {
        const sections = document.querySelectorAll('#vectorToolbar > .vector-toolbar > .toolbar-content > .toolbar-section');
        
        // Vérifier l'état de chaque section
        const sectionStates = Array.from(sections).map((section) => {
            const content = section.querySelector('.section-content');
            const hasCollapsedClass = section.classList.contains('collapsed');
            const computedDisplay = content ? getComputedStyle(content).display : 'none';
            const inlineDisplay = content ? content.style.display : '';
            
            return {
                hasCollapsedClass,
                computedDisplay,
                inlineDisplay
            };
        });
        
        // Vérifier si toutes les sections sont repliées
        const allCollapsed = sectionStates.every(state => {
            return state.hasCollapsedClass || 
                   (state.inlineDisplay === 'none' || state.computedDisplay === 'none');
        });
        
        sections.forEach((section) => {
            const content = section.querySelector('.section-content');
            if (allCollapsed) {
                // Déplier : retirer la classe collapsed et afficher le contenu
                section.classList.remove('collapsed');
                if (content) content.style.display = 'flex';
            } else {
                // Replier : ajouter la classe collapsed et masquer le contenu
                section.classList.add('collapsed');
                if (content) content.style.display = 'none';
            }
        });
        
        // Gérer aussi les sections de la toolbox
        const toolboxSections = document.querySelectorAll('.vector-toolbox .toolbar-section');
        toolboxSections.forEach(section => {
            const content = section.querySelector('.section-content');
            if (allCollapsed) {
                section.classList.remove('collapsed');
                if (content) content.style.display = 'flex';
            } else {
                section.classList.add('collapsed');
                if (content) content.style.display = 'none';
            }
        });
        
        const toggleAllBtn = document.getElementById('toggleAllSections');
        if (toggleAllBtn) {
            const icon = toggleAllBtn.querySelector('.toggle-icon');
            if (allCollapsed) {
                icon.textContent = '▼';
                toggleAllBtn.title = 'Tout est déplié';
            } else {
                icon.textContent = '▲';
                toggleAllBtn.title = 'Tout est replié';
            }
        }
    }

    selectTool(button) {
        // Désactiver l'outil précédent
        if (this.activeTool) {
            this.activeTool.classList.remove('active');
            this.deactivateTool();
        }

        // Activer le nouvel outil
        this.activeTool = button;
        button.classList.add('active');
        
        const toolType = button.dataset.tool;
        this.activateTool(toolType);
        
        // Afficher la toolbox et mettre à jour les paramètres
        this.showToolbox();
        this.updateToolboxParameters(toolType);
    }

    activateTool(toolType) {
        this.drawingMode = true;
        
        switch(toolType) {
            case 'grid':
                // La grille est gérée directement par la toolbox
                break;
            case 'isochrone':
                this.activateIsochroneTool();
                break;
            case 'isodistance':
                this.activateIsodistanceTool();
                break;
            case 'zoning':
                this.activateZoningTool();
                break;
            case 'text':
                this.activateTextTool();
                break;
            case 'line':
                this.activateLineTool();
                break;
            case 'polyline':
                this.activatePolylineTool();
                break;
            case 'curve':
                this.activateCurveTool();
                break;
            case 'polygon':
                this.activatePolygonTool();
                break;
            case 'rectangle':
                this.activateRectangleTool();
                break;
            case 'circle':
                this.activateCircleTool();
                break;
            case 'polygon-shape':
                this.activatePolygonShapeTool();
                break;
            case 'stamp':
                this.activateStampTool();
                break;
            case 'measure':
                this.activateMeasureTool();
                break;
            case 'info':
                this.activateInfoTool();
                break;
        }
    }

    deactivateTool() {
        this.drawingMode = false;
        this.currentDrawing = null;
        
        // Retirer les événements de la carte
        if (window.map) {
            window.map.off('click');
            window.map.off('mousemove');
            window.map.off('mouseup');
        }
        
        // Retirer le curseur personnalisé
        document.body.style.cursor = 'default';
        
        // Masquer la toolbox
        this.hideToolbox();
    }

    // ===== GESTION DE LA TOOLBOX =====
    showToolbox() {
        const toolbox = document.getElementById('vectorToolbox');
        if (toolbox) {
            toolbox.style.display = 'block';
            
            // Attacher les événements de clic aux sections de la toolbox
            this.attachToolboxSectionEvents();
        }
    }

    hideToolbox() {
        const toolbox = document.getElementById('vectorToolbox');
        if (toolbox) {
            toolbox.style.display = 'none';
        }
        
        // Désélectionner la grille si elle est sélectionnée
        if (this.selectedGrid) {
            this.deselectGrid();
        }
    }

    attachToolboxSectionEvents() {
        // Gestion du pliage/dépliage des sections de la toolbox
        const toolboxSectionHeaders = document.querySelectorAll('.vector-toolbox .toolbox-section > .section-header');
        toolboxSectionHeaders.forEach((header) => {
            // Initialiser l'état des sections repliées
            const section = header.closest('.toolbox-section');
            if (section) {
                const content = section.querySelector('.section-content');
                
                if (section.classList.contains('collapsed') && content) {
                    content.style.display = 'none';
                }
            }
            
            // Supprimer tous les anciens event listeners
            const newHeader = header.cloneNode(true);
            header.parentNode.replaceChild(newHeader, header);
            
            // Ajouter le nouvel event listener
            newHeader.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.toggleSection(newHeader);
            });
        });
    }

    // ===== COMMUNICATION AVEC LA TOOLBOX =====
    updateToolboxParameters(toolType) {
        if (window.vectorToolbox && window.vectorToolbox.updateToolParameters) {
            window.vectorToolbox.updateToolParameters(toolType);
        }
    }

    // ===== GÉNÉRATEUR DE CARROYAGES =====

    generateGridWithParams(scale, width, height, color = '#FFFFFF', opacity = 1, showCoordinates = false, gridInfo = {}) {
        // Demander à l'utilisateur de cliquer sur la carte pour positionner la grille
        this.showMessage('Cliquez sur la carte pour positionner le coin inférieur gauche de la grille', 'info');
        
        if (window.map) {
            window.map.on('click', (e) => {
                this.createGrid(e.latlng, scale, width, height, color, opacity, showCoordinates, gridInfo);
                window.map.off('click');
            });
        }
    }

    createGrid(centerLatLng, scale, width, height, color = '#FFFFFF', opacity = 1, showCoordinates = false, gridInfo = {}) {
        const gridGroup = L.layerGroup();
        const cellSize = scale; // en mètres
        
        // Convertir la taille en degrés (approximation)
        const latOffset = cellSize / 111000; // 1 degré ≈ 111km
        const lngOffset = cellSize / (111000 * Math.cos(centerLatLng.lat * Math.PI / 180));

        // Dimensions de la grille étendue (grille principale + 1 case de chaque côté)
        const extendedWidth = width + 2;  // 1 colonne à gauche + grille + 1 colonne à droite
        const extendedHeight = height + 2; // 1 ligne en bas + grille + 1 ligne en haut
        
        // Position de départ de la grille étendue (coin inférieur gauche)
        const startLat = centerLatLng.lat - latOffset;
        const startLng = centerLatLng.lng - lngOffset;

        // Créer les lignes verticales de la grille étendue
        for (let i = 0; i <= extendedWidth; i++) {
            const isThick = (i - 1) % 5 === 0 && i >= 1 && i <= width + 1; // Lignes épaisses seulement dans la grille principale
            const lineStartLat = startLat;
            const lineEndLat = startLat + (extendedHeight * latOffset);
            const lng = startLng + (i * lngOffset);

            const line = L.polyline([
                [lineStartLat, lng],
                [lineEndLat, lng]
            ], {
                color: color,
                weight: isThick ? 2 : 1,
                opacity: opacity
            });
            gridGroup.addLayer(line);
        }

        // Créer les lignes horizontales de la grille étendue
        for (let i = 0; i <= extendedHeight; i++) {
            const isThick = (i - 1) % 5 === 0 && i >= 1 && i <= height + 1; // Lignes épaisses seulement dans la grille principale
            const lineStartLng = startLng;
            const lineEndLng = startLng + (extendedWidth * lngOffset);
            const lat = startLat + (i * latOffset);

            const line = L.polyline([
                [lat, lineStartLng],
                [lat, lineEndLng]
            ], {
                color: color,
                weight: isThick ? 2 : 1,
                opacity: opacity
            });
            gridGroup.addLayer(line);
        }

        // Ajouter les coordonnées dans chaque case de la grille principale (si activé)
        if (showCoordinates) {
        for (let row = 0; row < height; row++) {
            for (let col = 0; col < width; col++) {
                // Exclure la case en haut à droite (boussole) et en bas à gauche (échelle)
                if ((row === height - 1 && col === width - 1) || (row === 0 && col === 0)) {
                    continue;
                }
                // Position dans la grille étendue (décalée de 1 case)
                const extendedRow = row + 1;
                const extendedCol = col + 1;
                
                // Calculer la taille dynamique de la case en pixels
                const cellLat1 = startLat + (extendedRow * latOffset);
                const cellLng1 = startLng + (extendedCol * lngOffset);
                const cellLat2 = startLat + ((extendedRow + 1) * latOffset);
                const cellLng2 = startLng + ((extendedCol + 1) * lngOffset);
                
                // Convertir en pixels pour calculer la taille réelle
                const point1 = window.map.latLngToContainerPoint([cellLat1, cellLng1]);
                const point2 = window.map.latLngToContainerPoint([cellLat2, cellLng2]);
                
                const cellWidthPx = Math.abs(point2.x - point1.x);
                const cellHeightPx = Math.abs(point2.y - point1.y);
                const minCellSize = Math.min(cellWidthPx, cellHeightPx);
                
                // Seuil de visibilité : masquer si la case fait moins de 30px
                if (minCellSize < 30) {
                    continue; // Passer cette case
                }
                
                // Calculer la taille de police dynamique (max 25% de la case)
                const maxFontSize = Math.floor(minCellSize * 0.25);
                const fontSize = Math.max(8, Math.min(maxFontSize, 24)); // Entre 8px et 24px
                
                // Calculer les marges dynamiques (10% de la taille de la case)
                const marginRatio = 0.02;
                const marginLat = latOffset * marginRatio;
                const marginLng = lngOffset * marginRatio;
                
                // Position en bas à gauche de la case (avec marges dynamiques)
                const cellLat = startLat + (extendedRow * latOffset) + marginLat;
                const cellLng = startLng + (extendedCol * lngOffset) + marginLng;
                
                const coord = this.getGridCoordinate(col, row);
                
                // Calculer la taille de l'icône basée sur la taille du texte
                // Utiliser une approche plus intelligente pour éviter la troncature prématurée
                const estimatedTextWidth = coord.length * fontSize * 0.7;
                const maxAllowedWidth = minCellSize * 0.9; // 90% de la case pour la largeur
                const textWidth = Math.min(estimatedTextWidth, maxAllowedWidth);
                const textHeight = fontSize * 1.3; // Hauteur du texte avec line-height
                
                const marker = L.marker([cellLat, cellLng], {
                    icon: L.divIcon({
                        className: 'grid-coordinate',
                        html: `<div style="
                            font-size: ${fontSize}px;
                            color: ${color};
                            font-weight: bold;
                            text-align: left;
                            opacity: 0.4;
                            pointer-events: none;
                            white-space: nowrap;
                            max-width: ${maxAllowedWidth}px;
                            overflow: visible;
                        ">${coord}</div>`,
                        iconSize: [textWidth, textHeight],
                        iconAnchor: [0, textHeight] // Ancrage en bas à gauche
                    })
                });
                gridGroup.addLayer(marker);
                }
            }
        }

        // Ajouter les carrés colorés dans les 4 cases des coins de la grille
        this.addColorSquares(gridGroup, startLat, startLng, latOffset, lngOffset, width, height, opacity);

        // Ajouter la boussole dans la case en haut à droite
        this.addCompassToGrid(gridGroup, startLat, startLng, latOffset, lngOffset, width, height, color, opacity);

        // Ajouter l'échelle dans la case en bas à gauche
        this.addScaleToGrid(gridGroup, startLat, startLng, latOffset, lngOffset, width, height, color, opacity, scale);

        // Ajouter les coordonnées externes (lettres et chiffres)
        this.addExternalCoordinates(gridGroup, startLat, startLng, latOffset, lngOffset, width, height, color);

        // Ajouter l'encart d'informations en haut à gauche
        this.addInfoPanel(gridGroup, startLat, startLng, latOffset, lngOffset, width, height, gridInfo);

        // Ajouter la grille à la carte
        gridGroup.addTo(window.map);
        this.vectorElements.push(gridGroup);

        // Stocker les paramètres de la grille pour la sélection
        gridGroup._gridParams = {
            centerLatLng: centerLatLng,
            scale: scale,
            width: width,
            height: height,
            color: color,
            opacity: opacity,
            showCoordinates: showCoordinates,
            gridInfo: gridInfo
        };

        // Stocker l'état original des lignes pour la restauration
        this.storeOriginalLineStyles(gridGroup);

        // Rendre la grille sélectionnable
        this.makeGridSelectable(gridGroup);

        // Ajouter un gestionnaire de zoom pour mettre à jour les coordonnées
        const updateCoordinates = () => {
            this.updateGridCoordinates(gridGroup, centerLatLng, scale, width, height, color, opacity, showCoordinates, gridInfo);
        };
        
        // Écouter les événements de zoom
        window.map.on('zoomend', updateCoordinates);
        window.map.on('moveend', updateCoordinates);
        
        // Stocker la fonction de mise à jour pour pouvoir la supprimer plus tard
        gridGroup._updateCoordinates = updateCoordinates;

        // Ajouter la grille à la toolbox
        this.addElementToToolbox(gridGroup, 'grid', `Grille ${width}x${height}`);

        this.showMessage(`Grille générée avec succès ! ${width}x${height} cases (${scale}m par case)`, 'success');
        this.deactivateTool();
        
        // Retourner la grille pour permettre la sélection
        return gridGroup;
    }

    // ===== ENCART D'INFORMATIONS POUR LA GRILLE =====
    addInfoPanel(gridGroup, startLat, startLng, latOffset, lngOffset, width, height, gridInfo) {
        // Valeurs de test par défaut
        const testData = {
            title: 'CARTE TEST',
            address: '123 rue de la rue - 75000 - PARIS',
            gps: '48.857616, 2.278266',
            date: new Date().toISOString().split('T')[0], // Aujourd'hui
            time: new Date().toTimeString().split(' ')[0].substring(0, 5) // Maintenant (HH:MM)
        };
        
        // Utiliser les données de test si gridInfo est vide ou incomplet
        const finalGridInfo = {
            title: gridInfo?.title || testData.title,
            address: gridInfo?.address || testData.address,
            gps: gridInfo?.gps || testData.gps,
            date: gridInfo?.date || testData.date,
            time: gridInfo?.time || testData.time
        };
        
        // Vérifier s'il y a des informations à afficher
        if (!finalGridInfo || (!finalGridInfo.title && !finalGridInfo.address && !finalGridInfo.gps && !finalGridInfo.date && !finalGridInfo.time)) {
            return;
        }

        // Positionner le coin haut gauche de l'encart exactement sur le coin supérieur gauche de la case A30
        // La case A30 est en position (height + 1, 1) dans la grille étendue
        const caseA30Lat = startLat + ((height + 1) * latOffset); // Coin supérieur gauche de la case A30
        const caseA30Lng = startLng + (lngOffset * 1); // Coin supérieur gauche de la case A30
        
        const infoPanelLat = caseA30Lat; // Coin haut gauche de l'encart = coin supérieur gauche de A30
        const infoPanelLng = caseA30Lng; // Coin haut gauche de l'encart = coin supérieur gauche de A30
        
        // Calculer la taille de l'encart basée sur les proportions (10% hauteur, 25% largeur)
        const cellSizePx = this.getCellSizeInPixels(startLat, startLng, latOffset, lngOffset);
        const gridTotalHeightPx = height * cellSizePx;
        const gridTotalWidthPx = width * cellSizePx;
        
        const panelHeightPx = gridTotalHeightPx * 0.10; // 10% de la hauteur totale de la grille
        const panelWidthPx = gridTotalWidthPx * 0.20; // 25% de la largeur totale de la grille
        
        // Utiliser la même approche que les coordonnées externes pour la taille de police
        // Calculer la taille de police dynamique basée sur la taille de l'encart
        const baseFontSize = Math.floor(Math.min(panelHeightPx, panelWidthPx) * 0.15); // 15% de la plus petite dimension
        const titleFontSize = Math.floor(baseFontSize * 1.2); // 20% plus grand pour le titre
        
        // Créer le contenu HTML de l'encart (inspiré des coordonnées externes)
        let infoContent = `<div style="
            background: white; 
            border: 2px solid #333; 
            border-radius: 8px; 
            padding: 4px; 
            box-shadow: 0 3px 10px rgba(0,0,0,0.4); 
            font-family: 'Open Sans', sans-serif; 
            width: ${panelWidthPx}px; 
            height: ${panelHeightPx}px; 
            overflow: hidden;
            box-sizing: border-box;
            display: flex;
            flex-direction: column;
            justify-content: flex-start;
            align-items: flex-start;
            position: relative;
        ">`;
        
         if (finalGridInfo.title) {
             infoContent += `<div style="
                 font-weight: bold; 
                 font-size: ${titleFontSize}px; 
                 color: #333; 
                 margin-bottom: 2px; 
                 text-align: center; 
                 border-bottom: 1px solid #333; 
                 padding-bottom: 2px;
                 line-height: 1.0;
                 width: 100%;
                 white-space: nowrap;
                 overflow: hidden;
                 text-overflow: ellipsis;
                 position: relative;
                 z-index: 2;
             ">${finalGridInfo.title}</div>`;
         }
        
         if (finalGridInfo.address) {
             // Diviser l'adresse en mots pour permettre le retour à la ligne automatique
             const addressWords = finalGridInfo.address.split(' ');
             let wrappedAddress = '';
             let currentLine = '';
             const maxCharsPerLine = Math.floor(panelWidthPx / (baseFontSize * 0.6)); // Estimer le nombre de caractères par ligne
             
             for (let i = 0; i < addressWords.length; i++) {
                 const word = addressWords[i];
                 if ((currentLine + ' ' + word).length > maxCharsPerLine && currentLine.length > 0) {
                     wrappedAddress += currentLine + '<br>';
                     currentLine = word;
                 } else {
                     currentLine += (currentLine.length > 0 ? ' ' : '') + word;
                 }
             }
             if (currentLine.length > 0) {
                 wrappedAddress += currentLine;
             }
             
             infoContent += `<div style="
                 font-size: ${baseFontSize}px; 
                 color: #555; 
                 margin-bottom: 1px; 
                 line-height: 1.0;
                 text-align: left;
                 width: 100%;
                 overflow: hidden;
                 position: relative;
                 z-index: 2;
             "><strong>Lieu:</strong> ${wrappedAddress}</div>`;
         }
        
         if (finalGridInfo.gps) {
             infoContent += `<div style="
                 font-size: ${baseFontSize}px; 
                 color: #555; 
                 margin-bottom: 1px;
                 line-height: 1.0;
                 text-align: left;
                 width: 100%;
                 white-space: nowrap;
                 overflow: hidden;
                 text-overflow: ellipsis;
                 position: relative;
                 z-index: 2;
             "><strong>GPS:</strong> ${finalGridInfo.gps}</div>`;
         }
        
         if (finalGridInfo.date || finalGridInfo.time) {
             let dateTimeText = '';
             
             if (finalGridInfo.date) {
                 // Formater la date au format JJ/MM/AAAA
                 const dateObj = new Date(finalGridInfo.date);
                 const day = String(dateObj.getDate()).padStart(2, '0');
                 const month = String(dateObj.getMonth() + 1).padStart(2, '0');
                 const year = dateObj.getFullYear();
                 const formattedDate = `${day}/${month}/${year}`;
                 dateTimeText = formattedDate;
             }
             
             if (finalGridInfo.time) {
                 // Formater l'heure au format hh:mm
                 const timeParts = finalGridInfo.time.split(':');
                 const formattedTime = `${timeParts[0]}:${timeParts[1]}`;
                 if (dateTimeText) {
                     dateTimeText += ` à ${formattedTime}`;
                 } else {
                     dateTimeText = formattedTime;
                 }
             }
             
             infoContent += `<div style="
                 font-size: ${baseFontSize}px; 
                 color: #555;
                 line-height: 1.0;
                 text-align: left;
                 width: 100%;
                 white-space: nowrap;
                 overflow: hidden;
                 text-overflow: ellipsis;
                 position: relative;
                 z-index: 2;
             "><strong>Date:</strong> ${dateTimeText}</div>`;
         }
        
        infoContent += '</div>';

        // Créer le marqueur avec l'encart
        const infoMarker = L.marker([infoPanelLat, infoPanelLng], {
            icon: L.divIcon({
                className: 'grid-info-panel',
                html: infoContent,
                iconSize: [panelWidthPx, panelHeightPx], // Taille basée sur les proportions de la grille
                iconAnchor: [0, 0] // Ancrage en haut à gauche
            }),
            zIndexOffset: 10000 // Z-index très élevé pour être au-dessus de tout
        });

        // Ajouter l'encart en dernier pour qu'il soit au-dessus des coordonnées
        gridGroup.addLayer(infoMarker);
    }

    // ===== FONCTION UTILITAIRE POUR CALCULER LA TAILLE DES CELLULES EN PIXELS =====
    getCellSizeInPixels(lat, lng, latOffset, lngOffset) {
        // Convertir les coordonnées géographiques en pixels
        const point1 = window.map.latLngToContainerPoint([lat, lng]);
        const point2 = window.map.latLngToContainerPoint([lat + latOffset, lng + lngOffset]);
        
        // Retourner la taille moyenne (largeur et hauteur)
        return Math.min(Math.abs(point2.x - point1.x), Math.abs(point2.y - point1.y));
    }

    getGridCoordinate(col, row) {
        // Convertir les colonnes en lettres (A, B, C, ..., Z, AA, AB, ...)
        let colStr = '';
        let colNum = col;
        
        while (colNum >= 0) {
            colStr = String.fromCharCode(65 + (colNum % 26)) + colStr;
            colNum = Math.floor(colNum / 26) - 1;
        }
        
        return colStr + (row + 1);
    }

    // ===== BOUSSOLE POUR LA GRILLE =====
    
    addScaleToGrid(gridGroup, startLat, startLng, latOffset, lngOffset, width, height, color, opacity, scale) {
        // Position de la case en bas à gauche (première colonne, première ligne)
        const scaleCol = 0; // Première colonne (0-indexed)
        const scaleRow = 0; // Première ligne (0-indexed) - en bas de la grille
        
        // Position dans la grille étendue (décalée de 1 case)
        const extendedRow = scaleRow + 1;
        const extendedCol = scaleCol + 1;
        
        // Calculer la taille de la case en pixels
        const cellLat1 = startLat + (extendedRow * latOffset);
        const cellLng1 = startLng + (extendedCol * lngOffset);
        const cellLat2 = startLat + ((extendedRow + 1) * latOffset);
        const cellLng2 = startLng + ((extendedCol + 1) * lngOffset);
        
        const point1 = window.map.latLngToContainerPoint([cellLat1, cellLng1]);
        const point2 = window.map.latLngToContainerPoint([cellLat2, cellLng2]);
        
        const cellWidthPx = Math.abs(point2.x - point1.x);
        const cellHeightPx = Math.abs(point2.y - point1.y);
        const minCellSize = Math.min(cellWidthPx, cellHeightPx);
        
        // Ne pas afficher l'échelle si la cellule est trop petite
        if (minCellSize < 10) {
            return;
        }
        
        // Position au centre de la case
        const centerLat = startLat + (extendedRow + 0.5) * latOffset;
        const centerLng = startLng + (extendedCol + 0.5) * lngOffset;
        
        // Calculer la couleur de fond contrastée (même logique que les coordonnées externes)
        const strokeColor = this.getContrastColor(color);
        
        // Créer une échelle dynamique qui s'adapte à la taille de la cellule
        const scaleHtml = `
            <div class="scale-container" style="
                width: 100%;
                height: 100%;
                position: relative;
                display: flex;
                align-items: center;
                justify-content: center;
            ">
                <!-- Carré de fond pour toute la case (90% de la taille) -->
                <div style="
                    position: absolute;
                    width: 90%;
                    height: 90%;
                    background-color: ${strokeColor};
                    opacity: 0.5;
                    border-radius: 4px;
                    z-index: 1;
                "></div>
                
                <svg class="scale-svg" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" style="
                    width: 95%;
                    height: 95%;
                    max-width: 100%;
                    max-height: 100%;
                    z-index: 2;
                    position: relative;
                ">
                    <!-- Ligne d'échelle -->
                    <line x1="2" y1="60" x2="98" y2="60" 
                        stroke="${color}" stroke-width="3" opacity="${opacity}"/>
                    
                    <!-- Marques aux extrémités -->
                    <line x1="2" y1="65" x2="2" y2="35" 
                        stroke="${color}" stroke-width="3" opacity="${opacity}"/>
                    <line x1="98" y1="65" x2="98" y2="35" 
                        stroke="${color}" stroke-width="3" opacity="${opacity}"/>
                    
                    <!-- Texte de l'échelle -->
                    <text x="50" y="35" text-anchor="middle" 
                        font-family="Open sans" font-size="30" font-weight="bold" 
                        fill="${color}" opacity="${opacity}">${scale}m</text>
                </svg>
            </div>
        `;
        
        // Utiliser la taille réelle de la cellule pour une échelle proportionnelle
        const scaleSize = minCellSize;
        
        const scaleMarker = L.marker([centerLat, centerLng], {
            icon: L.divIcon({
                className: 'grid-scale',
                html: scaleHtml,
                iconSize: [scaleSize, scaleSize],
                iconAnchor: [scaleSize / 2, scaleSize / 2]
            })
        });
        
        // Ajouter le marqueur à la grille
        gridGroup.addLayer(scaleMarker);
    }

    addCompassToGrid(gridGroup, startLat, startLng, latOffset, lngOffset, width, height, color, opacity) {
        // Position de la case en haut à droite (dernière colonne, dernière ligne)
        const compassCol = width - 1; // Dernière colonne (0-indexed)
        const compassRow = height - 1; // Dernière ligne (0-indexed) - en haut de la grille
        
        // Position dans la grille étendue (décalée de 1 case)
        const extendedRow = compassRow + 1;
        const extendedCol = compassCol + 1;
        
        // Calculer la taille dynamique de la case en pixels
        const cellLat1 = startLat + (extendedRow * latOffset);
        const cellLng1 = startLng + (extendedCol * lngOffset);
        const cellLat2 = startLat + ((extendedRow + 1) * latOffset);
        const cellLng2 = startLng + ((extendedCol + 1) * lngOffset);
        
        // Convertir en pixels pour calculer la taille réelle
        const point1 = window.map.latLngToContainerPoint([cellLat1, cellLng1]);
        const point2 = window.map.latLngToContainerPoint([cellLat2, cellLng2]);
        
        const cellWidthPx = Math.abs(point2.x - point1.x);
        const cellHeightPx = Math.abs(point2.y - point1.y);
        const minCellSize = Math.min(cellWidthPx, cellHeightPx);
        
        // Position au centre de la case
        const centerLat = startLat + (extendedRow + 0.5) * latOffset;
        const centerLng = startLng + (extendedCol + 0.5) * lngOffset;
        
        // Ne pas afficher la boussole si la cellule est trop petite
        if (minCellSize < 10) {
            return;
        }
        
        // Créer une boussole dynamique qui s'adapte à la taille de la cellule
        const compassHtml = `
            <div class="compass-container" style="
                width: 100%;
                height: 100%;
                position: relative;
                display: flex;
                align-items: center;
                justify-content: center;
            ">
                <svg class="compass-svg" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" style="
                    width: 95%;
                    height: 95%;
                    max-width: 100%;
                    max-height: 100%;
                ">
                    <circle cx="50" cy="50" r="45" fill="white" stroke="${color}" stroke-width="3" opacity="${opacity}"/>
                    <polygon points="50,10 40,40 60,40" fill="#FF0000" opacity="${opacity}"/>
                    <text x="50" y="85" text-anchor="middle" font-family="Open sans" font-size="50" font-weight="bold" fill="#FF0000" opacity="${opacity}">N</text>
                </svg>
            </div>
        `;
        
        // Utiliser la taille réelle de la cellule pour une boussole proportionnelle
        const compassSize = minCellSize;
        
        const compassMarker = L.marker([centerLat, centerLng], {
            icon: L.divIcon({
                className: 'grid-compass',
                html: compassHtml,
                iconSize: [compassSize, compassSize],
                iconAnchor: [compassSize / 2, compassSize / 2]
            })
        });
        
        // Ajouter le marqueur à la grille
        gridGroup.addLayer(compassMarker);
    }

    getColumnLetter(col) {
        // Convertir les colonnes en lettres (A, B, C, ..., Z, AA, AB, ...)
        let colStr = '';
        let colNum = col;
        
        while (colNum >= 0) {
            colStr = String.fromCharCode(65 + (colNum % 26)) + colStr;
            colNum = Math.floor(colNum / 26) - 1;
        }
        
        return colStr;
    }

    addColorSquares(gridGroup, startLat, startLng, latOffset, lngOffset, width, height, opacity) {
        // Ajouter les carrés colorés uniquement dans les 4 cases des coordonnées externes qui sont dans les coins
        // Ces cases contiennent les lettres et chiffres avec des rectangles en arrière-plan
        
        // 1. Coin bas-gauche : case de coordonnée (ligne 0, colonne 0)
        this.addColorSquaresToExternalCell(gridGroup, startLat, startLng, latOffset, lngOffset, 0, 0, opacity);
        
        // 2. Coin bas-droite : case de coordonnée (ligne 0, colonne width+1)
        this.addColorSquaresToExternalCell(gridGroup, startLat, startLng, latOffset, lngOffset, 0, width+1, opacity);
        
        // 3. Coin haut-gauche : case de coordonnée (ligne height+1, colonne 0)
        this.addColorSquaresToExternalCell(gridGroup, startLat, startLng, latOffset, lngOffset, height+1, 0, opacity);
        
        // 4. Coin haut-droite : case de coordonnée (ligne height+1, colonne width+1)
        this.addColorSquaresToExternalCell(gridGroup, startLat, startLng, latOffset, lngOffset, height+1, width+1, opacity);
    }
    
    addColorSquaresToExternalCell(gridGroup, startLat, startLng, latOffset, lngOffset, row, col, opacity) {
        // Position dans la grille étendue (les cases de coordonnées externes)
        const externalRow = row;
        const externalCol = col;
        
        // Calculer les coordonnées de la case de coordonnée externe
        const cellTopLeftLat = startLat + (externalRow + 1) * latOffset;
        const cellTopLeftLng = startLng + externalCol * lngOffset;
        const cellBottomRightLat = startLat + externalRow * latOffset;
        const cellBottomRightLng = startLng + (externalCol + 1) * lngOffset;
        
        // Calculer les coordonnées du centre de la case
        const centerLat = (cellTopLeftLat + cellBottomRightLat) / 2;
        const centerLng = (cellTopLeftLng + cellBottomRightLng) / 2;
        
        // Calculer les dimensions de chaque quadrant (50% de la case)
        const quadrantLatOffset = latOffset / 2.1;
        const quadrantLngOffset = lngOffset / 2.1;
        
        // Bas gauche : Vert
        const greenSquare = L.rectangle([
            [centerLat - quadrantLatOffset, centerLng - quadrantLngOffset],
            [centerLat, centerLng]
        ], {
            color: '#00FF00',
            fillColor: '#00FF00',
            fillOpacity: opacity,
            weight: 0
        });
        gridGroup.addLayer(greenSquare);
        
        // Haut gauche : Jaune
        const yellowSquare = L.rectangle([
            [centerLat, centerLng - quadrantLngOffset],
            [centerLat + quadrantLatOffset, centerLng]
        ], {
            color: '#FFFF00',
            fillColor: '#FFFF00',
            fillOpacity: opacity,
            weight: 0
        });
        gridGroup.addLayer(yellowSquare);
        
        // Haut droite : Bleu
        const blueSquare = L.rectangle([
            [centerLat, centerLng],
            [centerLat + quadrantLatOffset, centerLng + quadrantLngOffset]
        ], {
            color: '#0000FF',
            fillColor: '#0000FF',
            fillOpacity: opacity,
            weight: 0
        });
        gridGroup.addLayer(blueSquare);
        
        // Bas droite : Rouge
        const redSquare = L.rectangle([
            [centerLat - quadrantLatOffset, centerLng],
            [centerLat, centerLng + quadrantLngOffset]
        ], {
            color: '#FF0000',
            fillColor: '#FF0000',
            fillOpacity: opacity,
            weight: 0
        });
        gridGroup.addLayer(redSquare);
    }

    addExternalCoordinates(gridGroup, startLat, startLng, latOffset, lngOffset, width, height, color) {
        // Ajouter les lettres (abscisses) dans les cases du haut et du bas
        for (let col = 0; col < width; col++) {
            // Case du bas (ligne 0, colonne col+1)
            const colLatBottom = startLat + (0 * latOffset) + (latOffset * 0.5);
            const colLngBottom = startLng + ((col + 1) * lngOffset) + (lngOffset * 0.5);
            
            const colStr = this.getColumnLetter(col);
            
            // Calculer la taille de police basée sur 50% de la case (caractères)
            const cellSizePx = this.getCellSizeInPixels(colLatBottom, colLngBottom, latOffset, lngOffset);
            const fontSize = Math.floor(cellSizePx * 0.6);
            
            // Calculer la couleur du fond
            const strokeColor = this.getContrastColor(color);
            
            const colMarkerBottom = L.marker([colLatBottom, colLngBottom], {
                icon: L.divIcon({
                    className: 'grid-external-coordinate',
                    html: `<div style="
                        position: relative;
                        width: ${cellSizePx}px;
                        height: ${cellSizePx}px;
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        pointer-events: none;
                    ">
                        <div style="
                            position: absolute;
                            width: ${Math.floor(cellSizePx * 0.9)}px;
                            height: ${Math.floor(cellSizePx * 0.9)}px;
                            background-color: ${strokeColor};
                            opacity: 0.5;
                            border-radius: 4px;
                            z-index: 1;
                        "></div>
                        <div style="
                            position: absolute;
                            font-size: ${fontSize}px;
                            color: ${color};
                            font-weight: bold;
                            text-align: center;
                            white-space: nowrap;
                            font-family: 'Open Sans', sans-serif;
                            z-index: 2;
                        ">${colStr}</div>
                    </div>`,
                    iconSize: [cellSizePx, cellSizePx],
                    iconAnchor: [cellSizePx/2, cellSizePx/2]
                })
            });
            gridGroup.addLayer(colMarkerBottom);

            // Case du haut (ligne height+1, colonne col+1)
            const colLatTop = startLat + ((height + 1) * latOffset) + (latOffset * 0.5);
            const colLngTop = startLng + ((col + 1) * lngOffset) + (lngOffset * 0.5);
            
            const colMarkerTop = L.marker([colLatTop, colLngTop], {
                icon: L.divIcon({
                    className: 'grid-external-coordinate',
                    html: `<div style="
                        position: relative;
                        width: ${cellSizePx}px;
                        height: ${cellSizePx}px;
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        pointer-events: none;
                    ">
                        <div style="
                            position: absolute;
                            width: ${Math.floor(cellSizePx * 0.9)}px;
                            height: ${Math.floor(cellSizePx * 0.9)}px;
                            background-color: ${strokeColor};
                            opacity: 0.5;
                            border-radius: 4px;
                            z-index: 1;
                        "></div>
                        <div style="
                            position: absolute;
                            font-size: ${fontSize}px;
                            color: ${color};
                            font-weight: bold;
                            text-align: center;
                            white-space: nowrap;
                            font-family: 'Open Sans', sans-serif;
                            z-index: 2;
                        ">${colStr}</div>
                    </div>`,
                    iconSize: [cellSizePx, cellSizePx],
                    iconAnchor: [cellSizePx/2, cellSizePx/2]
                })
            });
            gridGroup.addLayer(colMarkerTop);
        }

        // Ajouter les chiffres (ordonnées) dans les cases de gauche et de droite
        for (let row = 0; row < height; row++) {
            // Case de gauche (ligne row+1, colonne 0)
            const rowLatLeft = startLat + ((row + 1) * latOffset) + (latOffset * 0.5);
            const rowLngLeft = startLng + (0 * lngOffset) + (lngOffset * 0.5);
            
            const rowStr = (row + 1).toString();
            
            // Calculer la taille de police basée sur 50% de la case (caractères)
            const cellSizePx = this.getCellSizeInPixels(rowLatLeft, rowLngLeft, latOffset, lngOffset);
            const fontSize = Math.floor(cellSizePx * 0.6);
            
            // Calculer la couleur du fond
            const strokeColor = this.getContrastColor(color);
            
            const rowMarkerLeft = L.marker([rowLatLeft, rowLngLeft], {
                icon: L.divIcon({
                    className: 'grid-external-coordinate',
                    html: `<div style="
                        position: relative;
                        width: ${cellSizePx}px;
                        height: ${cellSizePx}px;
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        pointer-events: none;
                    ">
                        <div style="
                            position: absolute;
                            width: ${Math.floor(cellSizePx * 0.9)}px;
                            height: ${Math.floor(cellSizePx * 0.9)}px;
                            background-color: ${strokeColor};
                            opacity: 0.5;
                            border-radius: 4px;
                            z-index: 1;
                        "></div>
                        <div style="
                            position: absolute;
                            font-size: ${fontSize}px;
                            color: ${color};
                            font-weight: bold;
                            text-align: center;
                            white-space: nowrap;
                            font-family: 'Open Sans', sans-serif;
                            z-index: 2;
                        ">${rowStr}</div>
                    </div>`,
                    iconSize: [cellSizePx, cellSizePx],
                    iconAnchor: [cellSizePx/2, cellSizePx/2]
                })
            });
            gridGroup.addLayer(rowMarkerLeft);

            // Case de droite (ligne row+1, colonne width+1)
            const rowLatRight = startLat + ((row + 1) * latOffset) + (latOffset * 0.5);
            const rowLngRight = startLng + ((width + 1) * lngOffset) + (lngOffset * 0.5);
            
            const rowMarkerRight = L.marker([rowLatRight, rowLngRight], {
                icon: L.divIcon({
                    className: 'grid-external-coordinate',
                    html: `<div style="
                        position: relative;
                        width: ${cellSizePx}px;
                        height: ${cellSizePx}px;
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        pointer-events: none;
                    ">
                        <div style="
                            position: absolute;
                            width: ${Math.floor(cellSizePx * 0.9)}px;
                            height: ${Math.floor(cellSizePx * 0.9)}px;
                            background-color: ${strokeColor};
                            opacity: 0.5;
                            border-radius: 4px;
                            z-index: 1;
                        "></div>
                        <div style="
                            position: absolute;
                            font-size: ${fontSize}px;
                            color: ${color};
                            font-weight: bold;
                            text-align: center;
                            white-space: nowrap;
                            font-family: 'Open Sans', sans-serif;
                            z-index: 2;
                        ">${rowStr}</div>
                    </div>`,
                    iconSize: [cellSizePx, cellSizePx],
                    iconAnchor: [cellSizePx/2, cellSizePx/2]
                })
            });
            gridGroup.addLayer(rowMarkerRight);
        }
    }

    getCellSizeInPixels(lat, lng, latOffset, lngOffset) {
        // Calculer la taille d'une case en pixels
        const point1 = window.map.latLngToContainerPoint([lat - latOffset/2, lng - lngOffset/2]);
        const point2 = window.map.latLngToContainerPoint([lat + latOffset/2, lng + lngOffset/2]);
        
        const cellWidthPx = Math.abs(point2.x - point1.x);
        const cellHeightPx = Math.abs(point2.y - point1.y);
        
        return Math.min(cellWidthPx, cellHeightPx);
    }

    getContrastColor(textColor) {
        // Convertir la couleur hex en RGB
        const hex = textColor.replace('#', '');
        const r = parseInt(hex.substr(0, 2), 16);
        const g = parseInt(hex.substr(2, 2), 16);
        const b = parseInt(hex.substr(4, 2), 16);
        
        // Calculer la luminosité relative
        const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
        
        // Retourner noir pour les couleurs claires, blanc pour les couleurs foncées
        return luminance > 0.5 ? '#000000' : '#FFFFFF';
    }

    updateGridCoordinates(gridGroup, centerLatLng, scale, width, height, color, opacity, showCoordinates = true, gridInfo = {}) {
        // Supprimer les anciennes coordonnées internes
        const internalMarkers = gridGroup.getLayers().filter(layer => 
            layer.options.icon && layer.options.icon.options.className === 'grid-coordinate'
        );
        internalMarkers.forEach(marker => gridGroup.removeLayer(marker));
        
        // Supprimer les anciennes coordonnées externes
        const externalMarkers = gridGroup.getLayers().filter(layer => 
            layer.options.icon && layer.options.icon.options.className === 'grid-external-coordinate'
        );
        externalMarkers.forEach(marker => gridGroup.removeLayer(marker));
        
        // Supprimer les anciens carrés colorés
        const colorSquares = gridGroup.getLayers().filter(layer => 
            layer instanceof L.Rectangle && layer.options.fillColor
        );
        colorSquares.forEach(square => gridGroup.removeLayer(square));

        // Supprimer l'ancienne boussole (marqueur avec classe grid-compass)
        const oldCompassMarkers = gridGroup.getLayers().filter(layer => 
            layer instanceof L.Marker && 
            layer.options.icon && 
            layer.options.icon.options.className === 'grid-compass'
        );
        oldCompassMarkers.forEach(marker => gridGroup.removeLayer(marker));

        // Supprimer l'ancienne échelle (marqueur avec classe grid-scale)
        const oldScaleMarkers = gridGroup.getLayers().filter(layer => 
            layer instanceof L.Marker && 
            layer.options.icon && 
            layer.options.icon.options.className === 'grid-scale'
        );
        oldScaleMarkers.forEach(marker => gridGroup.removeLayer(marker));

        // Supprimer l'ancien encart d'informations (toujours supprimé pour être recréé)
        const oldInfoPanels = gridGroup.getLayers().filter(layer => 
            layer instanceof L.Marker && 
            layer.options.icon && 
            layer.options.icon.options.className === 'grid-info-panel'
        );
        oldInfoPanels.forEach(panel => gridGroup.removeLayer(panel));
        
        // Recalculer les coordonnées avec la nouvelle taille
        const cellSize = scale;
        const latOffset = cellSize / 111000;
        const lngOffset = cellSize / (111000 * Math.cos(centerLatLng.lat * Math.PI / 180));
        
        // Position de départ de la grille étendue (coin inférieur gauche)
        const startLat = centerLatLng.lat - latOffset;
        const startLng = centerLatLng.lng - lngOffset;
        
        // Ajouter les nouvelles coordonnées internes (si activé)
        if (showCoordinates) {
            for (let row = 0; row < height; row++) {
                for (let col = 0; col < width; col++) {
                    // Exclure la case en haut à droite (boussole) et en bas à gauche (échelle)
                    if ((row === height - 1 && col === width - 1) || (row === 0 && col === 0)) {
                        continue;
                    }
                    // Position dans la grille étendue (décalée de 1 case)
                    const extendedRow = row + 1;
                    const extendedCol = col + 1;
                    
                    // Calculer la taille dynamique de la case en pixels
                    const cellLat1 = startLat + (extendedRow * latOffset);
                    const cellLng1 = startLng + (extendedCol * lngOffset);
                    const cellLat2 = startLat + ((extendedRow + 1) * latOffset);
                    const cellLng2 = startLng + ((extendedCol + 1) * lngOffset);
                    
                    // Convertir en pixels pour calculer la taille réelle
                    const point1 = window.map.latLngToContainerPoint([cellLat1, cellLng1]);
                    const point2 = window.map.latLngToContainerPoint([cellLat2, cellLng2]);
                    
                    const cellWidthPx = Math.abs(point2.x - point1.x);
                    const cellHeightPx = Math.abs(point2.y - point1.y);
                    const minCellSize = Math.min(cellWidthPx, cellHeightPx);
                    
                    // Seuil de visibilité : masquer si la case fait moins de 30px
                    if (minCellSize < 30) {
                        continue; // Passer cette case
                    }
                    
                    // Calculer la taille de police dynamique (max 25% de la case)
                    const maxFontSize = Math.floor(minCellSize * 0.25);
                    const fontSize = Math.max(8, Math.min(maxFontSize, 24)); // Entre 8px et 24px
                    
                    // Calculer les marges dynamiques (2% de la taille de la case)
                    const marginRatio = 0.02;
                    const marginLat = latOffset * marginRatio;
                    const marginLng = lngOffset * marginRatio;
                    
                    // Position en bas à gauche de la case (avec marges dynamiques)
                    const cellLat = startLat + (extendedRow * latOffset) + marginLat;
                    const cellLng = startLng + (extendedCol * lngOffset) + marginLng;
                    
                    const coord = this.getGridCoordinate(col, row);
                    
                    // Calculer la taille de l'icône basée sur la taille du texte
                    // Utiliser une approche plus intelligente pour éviter la troncature prématurée
                    const estimatedTextWidth = coord.length * fontSize * 0.7;
                    const maxAllowedWidth = minCellSize * 0.9; // 90% de la case pour la largeur
                    const textWidth = Math.min(estimatedTextWidth, maxAllowedWidth);
                    const textHeight = fontSize * 1.3; // Hauteur du texte avec line-height
                    
                    const marker = L.marker([cellLat, cellLng], {
                        icon: L.divIcon({
                            className: 'grid-coordinate',
                            html: `<div style="
                                font-size: ${fontSize}px;
                                color: ${color};
                                font-weight: bold;
                                text-align: left;
                                opacity: 0.4;
                                pointer-events: none;
                                white-space: nowrap;
                                max-width: ${maxAllowedWidth}px;
                                overflow: visible;
                            ">${coord}</div>`,
                            iconSize: [textWidth, textHeight],
                            iconAnchor: [0, textHeight] // Ancrage en bas à gauche
                        })
                    });
                    gridGroup.addLayer(marker);
                }
            }
        }
        
        // Ajouter les nouveaux carrés colorés dans les coins
        this.addColorSquares(gridGroup, startLat, startLng, latOffset, lngOffset, width, height, opacity);
        
        // Recréer la boussole avec la nouvelle taille
        this.addCompassToGrid(gridGroup, startLat, startLng, latOffset, lngOffset, width, height, color, opacity);
        
        // Recréer l'échelle avec la nouvelle taille
        this.addScaleToGrid(gridGroup, startLat, startLng, latOffset, lngOffset, width, height, color, opacity, scale);
        
        // Ajouter les nouvelles coordonnées externes
        this.addExternalCoordinates(gridGroup, startLat, startLng, latOffset, lngOffset, width, height, color);
        
        // Recréer l'encart d'informations (indépendant des coordonnées)
        this.addInfoPanel(gridGroup, startLat, startLng, latOffset, lngOffset, width, height, gridInfo);
        
        // Mettre à jour les styles originaux après la mise à jour des coordonnées
        this.storeOriginalLineStyles(gridGroup);
    }

    storeOriginalLineStyles(gridGroup) {
        const lines = gridGroup.getLayers().filter(layer => layer instanceof L.Polyline);
        gridGroup._originalLineStyles = [];
        
        lines.forEach((line, index) => {
            gridGroup._originalLineStyles[index] = {
                weight: line.options.weight,
                color: line.options.color,
                opacity: line.options.opacity
            };
        });
    }

    // ===== OUTILS DE DESSIN =====
    activateLineTool() {
        this.showMessage('Cliquez sur la carte pour commencer à dessiner une ligne', 'info');
        this.setupDrawingMode('line');
    }

    activatePolylineTool() {
        this.showMessage('Cliquez sur la carte pour dessiner une polyligne (double-clic pour terminer)', 'info');
        this.setupDrawingMode('polyline');
    }

    activatePolygonTool() {
        this.showMessage('Cliquez sur la carte pour dessiner un polygone (double-clic pour terminer)', 'info');
        this.setupDrawingMode('polygon');
    }

    activateRectangleTool() {
        this.showMessage('Cliquez et glissez pour dessiner un rectangle', 'info');
        this.setupDrawingMode('rectangle');
    }

    activateCircleTool() {
        this.showMessage('Cliquez et glissez pour dessiner un cercle', 'info');
        this.setupDrawingMode('circle');
    }

    setupDrawingMode(type) {
        if (!window.map) return;

        let startPoint = null;
        let currentShape = null;
        let isDrawing = false;

        const startDrawing = (e) => {
            startPoint = e.latlng;
            isDrawing = true;
            
            // Obtenir les paramètres par défaut de la toolbox
            const settings = this.getDefaultSettings();
            
            if (type === 'line' || type === 'polyline' || type === 'polygon') {
                currentShape = L.polyline([e.latlng], {
                    color: settings.color,
                    weight: settings.weight,
                    opacity: settings.opacity
                }).addTo(window.map);
            }
        };

        const updateDrawing = (e) => {
            if (!isDrawing || !startPoint) return;

            // Obtenir les paramètres par défaut de la toolbox
            const settings = this.getDefaultSettings();

            if (type === 'rectangle') {
                if (currentShape) {
                    window.map.removeLayer(currentShape);
                }
                currentShape = L.rectangle(L.latLngBounds(startPoint, e.latlng), {
                    color: settings.color,
                    weight: settings.weight,
                    opacity: settings.opacity,
                    fillOpacity: 0.2
                }).addTo(window.map);
            } else if (type === 'circle') {
                if (currentShape) {
                    window.map.removeLayer(currentShape);
                }
                const radius = startPoint.distanceTo(e.latlng);
                currentShape = L.circle(startPoint, {
                    radius: radius,
                    color: settings.color,
                    weight: settings.weight,
                    opacity: settings.opacity,
                    fillOpacity: 0.2
                }).addTo(window.map);
            } else if (type === 'line') {
                if (currentShape) {
                    currentShape.setLatLngs([startPoint, e.latlng]);
                }
            } else if (type === 'polyline' || type === 'polygon') {
                if (currentShape) {
                    const latlngs = currentShape.getLatLngs();
                    latlngs.push(e.latlng);
                    currentShape.setLatLngs(latlngs);
                }
            }
        };

        const endDrawing = (e) => {
            if (!isDrawing || !currentShape) return;
            
            isDrawing = false;
            
            if (type === 'polygon' && currentShape) {
                const latlngs = currentShape.getLatLngs();
                if (latlngs.length > 2) {
                    latlngs.push(latlngs[0]); // Fermer le polygone
                    currentShape.setLatLngs(latlngs);
                }
            }
            
            // Ajouter à la liste des éléments vectoriels
            this.vectorElements.push(currentShape);
            
            // Ajouter l'élément à la toolbox
            this.addElementToToolbox(currentShape, type, this.generateElementName(type));
            
            currentShape = null;
            startPoint = null;
            
            this.showMessage('Forme dessinée avec succès !', 'success');
        };

        // Événements de la carte
        window.map.on('click', (e) => {
            // Désélectionner la grille si on clique ailleurs
            if (this.selectedGrid) {
                this.deselectGrid();
            }
            startDrawing(e);
        });
        window.map.on('mousemove', updateDrawing);
        window.map.on('mouseup', endDrawing);
        
        // Double-clic pour terminer les polylignes et polygones
        if (type === 'polyline' || type === 'polygon') {
            window.map.on('dblclick', () => {
                if (currentShape) {
                    endDrawing();
                }
            });
        }
    }

    // ===== OUTILS DE TEXTE =====
    activateTextTool() {
        this.showMessage('Cliquez sur la carte pour insérer du texte', 'info');
        
        if (window.map) {
            window.map.on('click', (e) => {
                // Désélectionner la grille si on clique ailleurs
                if (this.selectedGrid) {
                    this.deselectGrid();
                }
                this.showTextInputModal(e.latlng);
                window.map.off('click');
            });
        }
    }

    showTextInputModal(position) {
        const modal = this.createModal('Insérer du texte', `
            <div class="text-input-form">
                <div class="form-group">
                    <label>Texte :</label>
                    <textarea id="textInput" placeholder="Saisissez votre texte ici..." rows="4"></textarea>
                </div>
                <div class="form-group">
                    <label>Taille de police :</label>
                    <select id="fontSize">
                        <option value="12">12px</option>
                        <option value="14">14px</option>
                        <option value="16" selected>16px</option>
                        <option value="18">18px</option>
                        <option value="20">20px</option>
                        <option value="24">24px</option>
                    </select>
                </div>
                <div class="form-group">
                    <label>Couleur :</label>
                    <input type="color" id="textColor" value="#333333">
                </div>
                <div class="form-actions">
                    <button id="insertText" class="btn-primary">Insérer</button>
                    <button id="cancelText" class="btn-secondary">Annuler</button>
                </div>
            </div>
        `);

        document.getElementById('insertText').addEventListener('click', () => {
            const text = document.getElementById('textInput').value;
            const fontSize = document.getElementById('fontSize').value;
            const color = document.getElementById('textColor').value;
            
            if (text.trim()) {
                this.insertText(position, text, fontSize, color);
                this.closeModal();
            }
        });

        document.getElementById('cancelText').addEventListener('click', () => {
            this.closeModal();
        });
    }

    insertText(position, text, fontSize, color) {
        const textMarker = L.marker(position, {
            icon: L.divIcon({
                className: 'text-marker',
                html: `<div style="
                    font-size: ${fontSize}px;
                    color: ${color};
                    background: rgba(255,255,255,0.9);
                    padding: 4px 8px;
                    border-radius: 4px;
                    border: 1px solid rgba(0,0,0,0.2);
                    white-space: nowrap;
                    font-family: 'Open Sans', sans-serif;
                ">${text}</div>`,
                iconSize: [text.length * parseInt(fontSize) * 0.6, parseInt(fontSize) + 8],
                iconAnchor: [text.length * parseInt(fontSize) * 0.3, (parseInt(fontSize) + 8) / 2]
            })
        }).addTo(window.map);

        this.vectorElements.push(textMarker);
        
        // Ajouter le texte à la toolbox
        this.addElementToToolbox(textMarker, 'text', `Texte: ${text.substring(0, 20)}${text.length > 20 ? '...' : ''}`);
        
        this.showMessage('Texte inséré avec succès !', 'success');
    }

    // ===== OUTILS DE MESURE =====
    activateMeasureTool() {
        this.showMessage('Cliquez sur la carte pour commencer une mesure', 'info');
        this.setupMeasurementMode();
    }

    setupMeasurementMode() {
        if (!window.map) return;

        let startPoint = null;
        let currentLine = null;
        let isMeasuring = false;

        const startMeasurement = (e) => {
            startPoint = e.latlng;
            isMeasuring = true;
            
            currentLine = L.polyline([e.latlng], {
                color: '#FF5722',
                weight: 3,
                opacity: 0.8,
                dashArray: '5, 5'
            }).addTo(window.map);
        };

        const updateMeasurement = (e) => {
            if (!isMeasuring || !startPoint || !currentLine) return;
            
            currentLine.setLatLngs([startPoint, e.latlng]);
            
            // Calculer et afficher la distance
            const distance = startPoint.distanceTo(e.latlng);
            const distanceText = distance < 1000 ? 
                `${Math.round(distance)} m` : 
                `${(distance / 1000).toFixed(2)} km`;
            
            // Mettre à jour le tooltip
            currentLine.bindTooltip(distanceText, {
                permanent: true,
                direction: 'center',
                className: 'measurement-tooltip'
            }).openTooltip();
        };

        const endMeasurement = (e) => {
            if (!isMeasuring || !currentLine) return;
            
            isMeasuring = false;
            this.vectorElements.push(currentLine);
            
            // Ajouter la mesure à la toolbox
            this.addElementToToolbox(currentLine, 'measurement', 'Mesure');
            
            currentLine = null;
            startPoint = null;
            
            this.showMessage('Mesure terminée !', 'success');
        };

        window.map.on('click', (e) => {
            // Désélectionner la grille si on clique ailleurs
            if (this.selectedGrid) {
                this.deselectGrid();
            }
            startMeasurement(e);
        });
        window.map.on('mousemove', updateMeasurement);
        window.map.on('mouseup', endMeasurement);
    }

    // ===== OUTILS D'INFORMATION =====
    activateInfoTool() {
        this.showMessage('Cliquez sur la carte pour obtenir des informations', 'info');
        
        if (window.map) {
            window.map.on('click', (e) => {
                // Désélectionner la grille si on clique ailleurs
                if (this.selectedGrid) {
                    this.deselectGrid();
                }
                this.showLocationInfo(e.latlng);
                window.map.off('click');
            });
        }
    }

    showLocationInfo(position) {
        const lat = position.lat.toFixed(6);
        const lng = position.lng.toFixed(6);
        
        // Convertir en coordonnées UTM (approximation)
        const utm = this.latLngToUTM(position.lat, position.lng);
        
        const modal = this.createModal('Informations sur la position', `
            <div class="location-info">
                <h3>Coordonnées géographiques</h3>
                <p><strong>Latitude :</strong> ${lat}°</p>
                <p><strong>Longitude :</strong> ${lng}°</p>
                
                <h3>Coordonnées UTM</h3>
                <p><strong>Zone :</strong> ${utm.zone}</p>
                <p><strong>Easting :</strong> ${utm.easting.toFixed(2)} m</p>
                <p><strong>Northing :</strong> ${utm.northing.toFixed(2)} m</p>
                
                <h3>Informations générales</h3>
                <p><strong>Zoom actuel :</strong> ${window.map.getZoom()}</p>
                <p><strong>Altitude :</strong> Non disponible</p>
            </div>
        `);
    }

    latLngToUTM(lat, lng) {
        // Conversion simplifiée Lat/Lng vers UTM
        const zone = Math.floor((lng + 180) / 6) + 1;
        const a = 6378137; // Rayon équatorial
        const e2 = 0.00669438; // Excentricité au carré
        
        const latRad = lat * Math.PI / 180;
        const lngRad = lng * Math.PI / 180;
        
        const N = a / Math.sqrt(1 - e2 * Math.sin(latRad) * Math.sin(latRad));
        const T = Math.tan(latRad) * Math.tan(latRad);
        const C = e2 * Math.cos(latRad) * Math.cos(latRad) / (1 - e2);
        const A = Math.cos(latRad) * (lngRad - ((zone - 1) * 6 - 180) * Math.PI / 180);
        
        const M = a * ((1 - e2 / 4 - 3 * e2 * e2 / 64 - 5 * e2 * e2 * e2 / 256) * latRad
            - (3 * e2 / 8 + 3 * e2 * e2 / 32 + 45 * e2 * e2 * e2 / 1024) * Math.sin(2 * latRad)
            + (15 * e2 * e2 / 256 + 45 * e2 * e2 * e2 / 1024) * Math.sin(4 * latRad)
            - (35 * e2 * e2 * e2 / 3072) * Math.sin(6 * latRad));
        
        const x = 0.9996 * N * (A + (1 - T + C) * A * A * A / 6 + (5 - 18 * T + T * T + 72 * C - 58 * 0.00669438) * A * A * A * A * A / 120) + 500000;
        const y = 0.9996 * (M + N * Math.tan(latRad) * (A * A / 2 + (5 - T + 9 * C + 4 * C * C) * A * A * A * A / 24 + (61 - 58 * T + T * T + 600 * C - 330 * 0.00669438) * A * A * A * A * A * A / 720));
        
        return {
            zone: zone,
            easting: x,
            northing: y
        };
    }

    // ===== OUTILS PLACEHOLDER =====
    activateIsochroneTool() {
        this.showMessage('Fonctionnalité d\'isochrones en cours de développement', 'info');
        this.deactivateTool();
    }

    activateIsodistanceTool() {
        this.showMessage('Fonctionnalité d\'isodistances en cours de développement', 'info');
        this.deactivateTool();
    }

    activateZoningTool() {
        this.showMessage('Fonctionnalité de zoning en cours de développement', 'info');
        this.deactivateTool();
    }

    activateCurveTool() {
        this.showMessage('Fonctionnalité de courbes vectorielles en cours de développement', 'info');
        this.deactivateTool();
    }

    activatePolygonShapeTool() {
        this.showMessage('Fonctionnalité de polygones réguliers en cours de développement', 'info');
        this.deactivateTool();
    }

    activateStampTool() {
        this.showMessage('Fonctionnalité de stamps en cours de développement', 'info');
        this.deactivateTool();
    }

    // ===== SÉLECTION DE GRILLES =====
    makeGridSelectable(gridGroup) {
        // Ajouter un événement de clic sur chaque ligne de la grille
        const lines = gridGroup.getLayers().filter(layer => layer instanceof L.Polyline);
        
        lines.forEach(line => {
            line.on('click', (e) => {
                e.originalEvent.stopPropagation();
                this.selectGrid(gridGroup);
            });
            
            // Changer le curseur au survol
            line.on('mouseover', () => {
                if (window.map) {
                    window.map.getContainer().style.cursor = 'pointer';
                }
            });
            
            line.on('mouseout', () => {
                if (window.map) {
                    window.map.getContainer().style.cursor = 'default';
                }
            });
        });
    }

    selectGrid(gridGroup) {
        if (!gridGroup) {
            console.warn('selectGrid: gridGroup invalide', gridGroup);
            return;
        }
        
        // Désélectionner la grille précédente
        if (this.selectedGrid && this.selectedGrid !== gridGroup) {
            this.deselectGrid();
        }

        // Sélectionner la nouvelle grille
        this.selectedGrid = gridGroup;
        
        // Appliquer le style de sélection
        this.applyGridSelectionStyle(gridGroup, true);
        
        // Ouvrir la toolbox avec les paramètres de la grille
        this.showGridToolbox(gridGroup);
        
        this.showMessage('Grille sélectionnée', 'info');
    }

    deselectGrid() {
        if (this.selectedGrid) {
            this.applyGridSelectionStyle(this.selectedGrid, false);
            this.selectedGrid = null;
            
            // Remettre la toolbox en mode par défaut
            this.updateToolboxParameters('default');
            
            // Remettre le bouton en mode "Générer la grille"
            setTimeout(() => {
                const generateBtn = document.getElementById('generateGridBtn');
                const deselectBtn = document.getElementById('deselectGridBtn');
                const repositionBtn = document.getElementById('repositionGridBtn');
                
                if (generateBtn) {
                    generateBtn.textContent = 'Générer';
                    generateBtn.onclick = () => {
                        if (window.vectorToolbox) {
                            window.vectorToolbox.generateGridFromToolbox();
                        }
                    };
                }
                
                if (deselectBtn) {
                    deselectBtn.style.display = 'none';
                }
                if (repositionBtn) {
                    repositionBtn.style.display = 'none';
                }
            }, 0);
        }
    }

    applyGridSelectionStyle(gridGroup, selected) {
        if (!gridGroup || !gridGroup.getLayers) {
            console.warn('applyGridSelectionStyle: gridGroup invalide', gridGroup);
            return;
        }
        const lines = gridGroup.getLayers().filter(layer => layer instanceof L.Polyline);
        
        lines.forEach((line, index) => {
            if (selected) {
                // Style de sélection : bordure plus épaisse et couleur différente
                line.setStyle({
                    color: '#4CAF50',
                    weight: line.options.weight + 2,
                    opacity: Math.min(line.options.opacity + 0.3, 1)
                });
            } else {
                // Restaurer le style original
                if (gridGroup._originalLineStyles && gridGroup._originalLineStyles[index]) {
                    const originalStyle = gridGroup._originalLineStyles[index];
                    line.setStyle({
                        color: originalStyle.color,
                        weight: originalStyle.weight,
                        opacity: originalStyle.opacity
                    });
                }
            }
        });
    }

    showGridToolbox(gridGroup) {
        // Afficher la toolbox
        this.showToolbox();
        
        // Mettre à jour les paramètres pour la grille sélectionnée
        this.updateToolboxForSelectedGrid(gridGroup);
        
        // S'assurer que les événements de repliage sont attachés
        setTimeout(() => {
            this.attachToolboxSectionEvents();
        }, 100);
    }

    updateToolboxForSelectedGrid(gridGroup) {
        if (!this.toolbox) return;
        
        const params = gridGroup._gridParams;
        if (!params) return;

        // Mettre à jour les paramètres dans la toolbox
        this.updateToolboxParameters('grid');
        
        // Attendre que la toolbox soit mise à jour, puis remplir les valeurs
        setTimeout(() => {
            const scaleSelect = document.getElementById('gridScale');
            const sizeSelect = document.getElementById('gridSize');
            const opacityInput = document.getElementById('gridOpacity');
            const showCoordinatesCheck = document.getElementById('showCoordinates');
            const colorPalette = document.querySelector('#gridColorPalette .color-btn.selected');
            
            if (scaleSelect) scaleSelect.value = params.scale;
            if (opacityInput) {
                opacityInput.value = params.opacity;
                const opacityValue = document.querySelector('.opacity-value');
                if (opacityValue) opacityValue.textContent = Math.round(params.opacity * 100) + '%';
            }
            if (showCoordinatesCheck) showCoordinatesCheck.checked = params.showCoordinates;
            
            // Déterminer la taille
            if (sizeSelect) {
                if (params.width === 10 && params.height === 10) {
                    sizeSelect.value = 'small';
                } else if (params.width === 20 && params.height === 20) {
                    sizeSelect.value = 'medium';
                } else if (params.width === 50 && params.height === 50) {
                    sizeSelect.value = 'large';
                } else {
                    sizeSelect.value = 'custom';
                    const customGroup = document.getElementById('customSizeGroup');
                    if (customGroup) customGroup.style.display = 'block';
                    const widthInput = document.getElementById('gridWidth');
                    const heightInput = document.getElementById('gridHeight');
                    if (widthInput) widthInput.value = params.width;
                    if (heightInput) heightInput.value = params.height;
                }
            }
            
            // Sélectionner la couleur
            if (colorPalette) {
                colorPalette.classList.remove('selected');
                colorPalette.textContent = '';
            }
            const newColorBtn = document.querySelector(`#gridColorPalette .color-btn[data-color="${params.color}"]`);
            if (newColorBtn) {
                newColorBtn.classList.add('selected');
                newColorBtn.textContent = '✓';
            }
            
            // Charger les informations de l'encart
            if (params.gridInfo) {
                const titleInput = document.getElementById('gridTitle');
                const addressInput = document.getElementById('gridAddress');
                const gpsInput = document.getElementById('gridGPS');
                const dateInput = document.getElementById('gridDate');
                const timeInput = document.getElementById('gridTime');
                
                // Utiliser les données finales (avec valeurs de test par défaut)
                const testData = {
                    title: 'CARTE TEST',
                    address: '123 rue de la rue - 75000 - PARIS',
                    gps: '48.857616, 2.278266',
                    date: new Date().toISOString().split('T')[0],
                    time: new Date().toTimeString().split(' ')[0].substring(0, 5)
                };
                
                const finalGridInfo = {
                    title: params.gridInfo.title || testData.title,
                    address: params.gridInfo.address || testData.address,
                    gps: params.gridInfo.gps || testData.gps,
                    date: params.gridInfo.date || testData.date,
                    time: params.gridInfo.time || testData.time
                };
                
                if (titleInput) titleInput.value = finalGridInfo.title;
                if (addressInput) addressInput.value = finalGridInfo.address;
                if (gpsInput) gpsInput.value = finalGridInfo.gps;
                if (dateInput) dateInput.value = finalGridInfo.date;
                if (timeInput) timeInput.value = finalGridInfo.time;
            }
            
            // Modifier le bouton de génération pour mettre à jour la grille
            const generateBtn = document.getElementById('generateGridBtn');
            const deselectBtn = document.getElementById('deselectGridBtn');
            const repositionBtn = document.getElementById('repositionGridBtn');
            
            if (generateBtn) {
                // Supprimer l'ancien event listener
                generateBtn.replaceWith(generateBtn.cloneNode(true));
                const newGenerateBtn = document.getElementById('generateGridBtn');
                
                newGenerateBtn.textContent = 'Mettre à jour';
                newGenerateBtn.onclick = () => this.updateSelectedGrid(gridGroup);
            }
            if (deselectBtn) {
                deselectBtn.style.display = 'inline-block';
            }
            if (repositionBtn) {
                repositionBtn.style.display = 'inline-block';
            }
        }, 0);
    }

    updateSelectedGrid(gridOverlay) {
        if (!this.selectedGrid || this.selectedGrid !== gridOverlay) return;
        
        // Obtenir les nouveaux paramètres
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
        
        const selectedColorBtn = document.querySelector('#gridColorPalette .color-btn.selected');
        const color = selectedColorBtn ? selectedColorBtn.dataset.color : '#333333';
        
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

        // Sauvegarder le point d'origine
        const centerLatLng = gridOverlay._gridParams.centerLatLng;
        
        // 1. Supprimer l'ancienne grille de la carte
        if (window.map.hasLayer(gridOverlay)) {
            window.map.removeLayer(gridOverlay);
        }
        
        // 2. Supprimer de la liste des éléments vectoriels
        const index = this.vectorElements.indexOf(gridOverlay);
        if (index > -1) {
            this.vectorElements.splice(index, 1);
        }
        
        // 3. Supprimer de la toolbox
        if (this.toolbox && this.toolbox.vectorElements) {
            const toolboxIndex = this.toolbox.vectorElements.findIndex(el => el.element === gridOverlay);
            if (toolboxIndex > -1) {
                this.toolbox.vectorElements.splice(toolboxIndex, 1);
            }
        }
        
        // Obtenir les informations de l'encart depuis la toolbox
        const title = document.getElementById('gridTitle')?.value || '';
        const address = document.getElementById('gridAddress')?.value || '';
        const gps = document.getElementById('gridGPS')?.value || '';
        const date = document.getElementById('gridDate')?.value || '';
        const time = document.getElementById('gridTime')?.value || '';
        const gridInfo = { title, address, gps, date, time };
        
        // 4. Créer la nouvelle grille au même point d'origine
        this.createGrid(centerLatLng, scale, width, height, color, opacity, showCoordinates, gridInfo);
        
        this.showMessage('Grille mise à jour avec succès !', 'success');
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
        dialog.style.cssText = `
            background: white;
            padding: 30px;
            border-radius: 10px;
            box-shadow: 0 10px 30px rgba(0,0,0,0.5);
            max-width: 500px;
            width: 90%;
            max-height: 80vh;
            overflow-y: auto;
        `;

        dialog.innerHTML = `
            <h3 style="margin-top: 0; color: #333; text-align: center;">${title}</h3>
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

    initializeTools() {
        // Initialiser les outils au démarrage
        this.connectToToolbox();
    }

    // Méthode pour se connecter à la toolbox
    connectToToolbox() {
        // Attendre que la toolbox soit initialisée
        const checkToolbox = () => {
            if (window.vectorToolbox) {
                this.toolbox = window.vectorToolbox;
                // Initialiser les paramètres par défaut
                this.updateToolboxParameters('default');
            } else {
                // Réessayer dans 100ms
                setTimeout(checkToolbox, 100);
            }
        };
        checkToolbox();
    }

    // Méthode pour obtenir les paramètres par défaut de la toolbox
    getDefaultSettings() {
        if (this.toolbox && this.toolbox.defaultSettings) {
            return this.toolbox.defaultSettings;
        }
        // Paramètres par défaut de fallback
        return {
            color: '#4CAF50',
            weight: 3,
            opacity: 0.8
        };
    }

    // Méthode pour ajouter un élément à la toolbox
    addElementToToolbox(element, type, name) {
        if (this.toolbox && this.toolbox.addVectorElement) {
            this.toolbox.addVectorElement(element, type, name);
        }
    }

    // ===== GESTION DU CLIC DROIT =====
    handleRightClick(e) {
        console.log('Clic droit détecté:', e.latlng);
        e.originalEvent.preventDefault();
        e.originalEvent.stopPropagation();
        
        const latlng = e.latlng;
        const clickTime = new Date();
        
        // Afficher un message de chargement
        this.showMessage('Récupération des informations du lieu...', 'info');
        
        // Récupérer l'adresse via géocodage inverse
        this.getAddressFromCoordinates(latlng, clickTime);
    }

    async getAddressFromCoordinates(latlng, clickTime) {
        const lat = latlng.lat;
        const lng = latlng.lng;
        
        console.log('Géocodage pour:', lat, lng);
        
        try {
            // Essayer d'abord data.gouv.fr (API gratuite et fiable)
            let address = await this.geocodeWithDataGouv(lat, lng);
            console.log('Résultat data.gouv.fr:', address);
            
            let useOSM = false;
            // Si pas d'adresse trouvée, essayer OSM Nominatim en secours
            if (!address) {
                address = await this.geocodeWithOSM(lat, lng);
                console.log('Résultat OSM:', address);
                useOSM = true;
            }
            
            // Afficher les informations
            this.showLocationInfo(latlng, clickTime, address, useOSM);
            
        } catch (error) {
            console.error('Erreur lors du géocodage:', error);
            // Afficher juste les coordonnées en cas d'erreur
            this.showLocationInfo(latlng, clickTime, null);
        }
    }

    async geocodeWithIGN(lat, lng) {
        try {
            // Vérifier si la clé IGN est configurée
            if (!window.VectorToolbarConfig || !window.VectorToolbarConfig.apis || !window.VectorToolbarConfig.apis.ign || !window.VectorToolbarConfig.apis.ign.key) {
                console.log('Clé API IGN non configurée, passage au suivant');
                return null;
            }

            const key = window.VectorToolbarConfig.apis.ign.key;
            
            // Utiliser l'API IGN de géocodage inverse via l'API Géoportail
            // L'API IGN utilise une URL différente pour le géocodage inverse
            const response = await fetch(`https://wxs.ign.fr/${key}/geoportail/geocodage/reverse?lon=${lng}&lat=${lat}&type=StreetAddress&limit=1`);
            const data = await response.json();
            
            if (data.features && data.features.length > 0) {
                const feature = data.features[0];
                const properties = feature.properties;
                
                // Construire l'adresse IGN
                let placeName = '';
                let fullAddress = '';
                
                // Nom du lieu remarquable si disponible
                if (properties.name && this.isPlaceOfInterest(properties.name)) {
                    placeName = properties.name;
                }
                
                // Adresse complète
                if (properties.housenumber) {
                    fullAddress += properties.housenumber + ' ';
                }
                if (properties.street) {
                    fullAddress += properties.street;
                }
                if (properties.postcode) {
                    fullAddress += ', ' + properties.postcode;
                }
                if (properties.city) {
                    fullAddress += ' ' + properties.city;
                }
                
                // Combiner lieu remarquable et adresse
                if (placeName && fullAddress) {
                    return placeName + ' - ' + fullAddress;
                } else if (fullAddress) {
                    return fullAddress;
                } else if (placeName) {
                    return placeName;
                }
            }
            
            return null;
        } catch (error) {
            console.error('Erreur API IGN:', error);
            return null;
        }
    }

    async geocodeWithDataGouv(lat, lng) {
        try {
            const response = await fetch(`https://api-adresse.data.gouv.fr/reverse?lat=${lat}&lon=${lng}`);
            const data = await response.json();
            
            if (data.features && data.features.length > 0) {
                const feature = data.features[0];
                const properties = feature.properties;
                
                // Construire l'adresse avec le nom du lieu si disponible
                let address = properties.label || '';
                let placeName = '';
                
                // Chercher le nom du lieu remarquable
                if (properties.name) {
                    placeName = properties.name;
                } else if (properties.context) {
                    // Chercher dans le contexte pour des lieux remarquables
                    const context = properties.context.split(',');
                    for (const item of context) {
                        const trimmed = item.trim();
                        // Si l'élément contient des mots-clés de lieux remarquables
                        if (this.isPlaceOfInterest(trimmed)) {
                            placeName = trimmed;
                            break;
                        }
                    }
                }
                
                // Ajouter le nom du lieu s'il existe et est différent de l'adresse
                if (placeName && placeName !== address.split(',')[0]) {
                    address = placeName + ' - ' + address;
                }
                
                return address || null;
            }
            return null;
        } catch (error) {
            console.error('Erreur API data.gouv.fr:', error);
            return null;
        }
    }

    async geocodeWithOSM(lat, lng) {
        try {
            const response = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&addressdetails=1&extratags=1&namedetails=1`);
            const data = await response.json();
            
            if (data.display_name) {
                let placeName = '';
                let address = data.display_name;
                
                // Chercher le nom du lieu dans les différents champs
                if (data.name) {
                    placeName = data.name;
                } else if (data.extratags) {
                    // Chercher dans les tags spécifiques pour les lieux remarquables
                    const placeTypes = [
                        'name', 'brand', 'operator', 'tourism', 'amenity', 'shop', 
                        'leisure', 'sport', 'historic', 'building', 'office',
                        'craft', 'healthcare', 'education', 'entertainment'
                    ];
                    
                    for (const tag of placeTypes) {
                        if (data.extratags[tag] && data.extratags[tag] !== 'yes') {
                            // Vérifier que c'est un vrai lieu remarquable
                            if (this.isPlaceOfInterest(data.extratags[tag])) {
                                placeName = data.extratags[tag];
                                break;
                            }
                        }
                    }
                }
                
                // Si on n'a pas trouvé de nom spécifique, chercher dans l'adresse
                if (!placeName && data.display_name) {
                    const addressParts = data.display_name.split(',');
                    for (const part of addressParts) {
                        const trimmed = part.trim();
                        if (this.isPlaceOfInterest(trimmed)) {
                            placeName = trimmed;
                            break;
                        }
                    }
                }
                
                // Si on a trouvé un nom de lieu, l'ajouter
                if (placeName && placeName !== address.split(',')[0]) {
                    address = placeName + ' - ' + address;
                }
                
                return address;
            }
            return null;
        } catch (error) {
            console.error('Erreur API OSM Nominatim:', error);
            return null;
        }
    }

    showLocationInfo(latlng, clickTime, address, useOSM = false) {
        const lat = latlng.lat.toFixed(6);
        const lng = latlng.lng.toFixed(6);
        const googleMapsUrl = `https://www.google.com/maps?q=${lat},${lng}`;
        
        const dateTime = clickTime.toLocaleString('fr-FR', {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
        });
        
        // Formater l'adresse selon la source
        let formattedAddress;
        if (useOSM) {
            // Affichage complet pour OSM
            formattedAddress = address ? `<p>${address}</p>` : '<p class="no-address">Adresse non trouvée</p>';
        } else {
            // Affichage simplifié pour data.gouv.fr
            formattedAddress = this.formatSimpleAddress(address);
        }
        
        const content = `
            <div class="location-info">
                <div class="info-section">
                    <h4>📅 Date et heure</h4>
                    <p>${dateTime}</p>
                </div>
                
                <div class="info-section">
                    <h4>📍 Coordonnées GPS</h4>
                    <p><strong>Coordonnées :</strong> ${lat}, ${lng}</p>
                    <p><a href="${googleMapsUrl}" target="_blank" class="google-maps-link">🗺️ Voir sur Google Maps</a></p>
                </div>
                
                <div class="info-section">
                    <h4>🏠 Lieu et adresse</h4>
                    ${formattedAddress}
                </div>
                
                <div class="form-actions">
                    <button id="copyCoordinates" class="btn-primary">📋 Copier les coordonnées</button>
                    <button id="closeLocationInfo" class="btn-secondary">Fermer</button>
                </div>
            </div>
        `;
        
        const modal = this.createModal('Informations du lieu', content);
        
        // Gestionnaire pour copier les coordonnées
        document.getElementById('copyCoordinates').addEventListener('click', () => {
            navigator.clipboard.writeText(`${lat}, ${lng}`).then(() => {
                this.showMessage('Coordonnées copiées !', 'success');
            }).catch(() => {
                this.showMessage('Erreur lors de la copie', 'error');
            });
        });
        
        // Gestionnaire pour fermer
        document.getElementById('closeLocationInfo').addEventListener('click', () => {
            this.closeModal();
        });
    }

    formatAddressDisplay(address) {
        // Séparer le nom du lieu de l'adresse si il y a un séparateur " - "
        if (address.includes(' - ')) {
            const parts = address.split(' - ');
            const placeName = parts[0];
            const fullAddress = parts.slice(1).join(' - ');
            
            return `
                <p class="place-name"><strong>${placeName}</strong></p>
                <p class="address-details">${fullAddress}</p>
            `;
        } else {
            return `<p>${address}</p>`;
        }
    }

    isPlaceOfInterest(text) {
        // Mots-clés de lieux remarquables (priorité haute)
        const highPriorityKeywords = [
            'stade', 'château', 'chateau', 'musée', 'musee', 'théâtre', 'theatre',
            'église', 'eglise', 'cathédrale', 'cathedrale', 'basilique', 'chapelle',
            'monument', 'mémorial', 'memorial', 'statue', 'fontaine', 'parc',
            'jardin', 'zoo', 'aquarium', 'planétarium', 'planetarium', 'observatoire',
            'université', 'universite', 'école', 'ecole', 'lycée', 'lycee', 'collège',
            'college', 'hôpital', 'hopital', 'clinique', 'pharmacie', 'gare',
            'aéroport', 'aeroport', 'port', 'marché', 'marche', 'centre commercial',
            'galerie', 'bibliothèque', 'bibliotheque', 'médiathèque', 'mediatheque',
            'cinéma', 'cinema', 'salle', 'palais', 'hôtel', 'hotel', 'restaurant',
            'café', 'cafe', 'bar', 'brasserie', 'boulangerie', 'pâtisserie',
            'patisserie', 'boucherie', 'charcuterie', 'fromagerie', 'épicerie',
            'epicerie', 'supermarché', 'supermarche', 'hypermarché', 'hypermarché',
            'banque', 'poste', 'mairie', 'préfecture', 'prefecture', 'sous-préfecture',
            'sous-prefecture', 'tribunal', 'cour', 'police', 'gendarmerie', 'pompiers',
            'caserne', 'commissariat', 'prison', 'cimetière', 'cimetiere', 'crématorium',
            'crematorium', 'funérarium', 'funerarium', 'cercle', 'club', 'association',
            'fondation', 'institut', 'laboratoire', 'centre', 'complexe', 'site'
        ];
        
        // Mots-clés de lieux génériques (priorité basse - à éviter)
        const lowPriorityKeywords = [
            'avenue', 'rue', 'boulevard', 'place', 'allée', 'chemin', 'route',
            'impasse', 'passage', 'quai', 'pont', 'tunnel', 'viaduc', 'zone',
            'quartier', 'secteur', 'région', 'region', 'département', 'departement',
            'arrondissement', 'canton', 'commune', 'ville', 'village', 'bourg',
            'hameau', 'lieu-dit', 'lieu', 'endroit', 'espace'
        ];
        
        const lowerText = text.toLowerCase();
        
        // Vérifier d'abord les mots-clés de haute priorité
        const hasHighPriority = highPriorityKeywords.some(keyword => lowerText.includes(keyword));
        
        // Si on a un mot-clé de haute priorité, c'est un lieu remarquable
        if (hasHighPriority) {
            return true;
        }
        
        // Vérifier les mots-clés de basse priorité seulement s'il n'y a pas de mots génériques
        const hasLowPriority = lowPriorityKeywords.some(keyword => lowerText.includes(keyword));
        const hasGenericWords = ['avenue', 'rue', 'boulevard', 'place', 'allée', 'chemin', 'route'].some(word => lowerText.includes(word));
        
        // Si on a des mots-clés de basse priorité mais pas de mots génériques, c'est OK
        return hasLowPriority && !hasGenericWords;
    }

    containsPlaceOfInterest(address) {
        if (!address) return false;
        
        // Vérifier si l'adresse contient un lieu remarquable
        const parts = address.split(' - ');
        for (const part of parts) {
            if (this.isPlaceOfInterest(part)) {
                return true;
            }
        }
        return false;
    }

    formatSimpleAddress(address) {
        if (!address) {
            return '<p class="no-address">Adresse non trouvée</p>';
        }

        let placeName = '';
        let simpleAddress = '';

        // Séparer le lieu remarquable de l'adresse
        if (address.includes(' - ')) {
            const parts = address.split(' - ');
            placeName = parts[0];
            simpleAddress = parts.slice(1).join(' - ');
        } else {
            simpleAddress = address;
        }

        // Extraire les éléments de l'adresse simple
        const addressParts = simpleAddress.split(',');
        let street = '';
        let city = '';
        let postalCode = '';

        // Chercher la rue (première partie qui contient un numéro)
        for (const part of addressParts) {
            const trimmed = part.trim();
            if (/\d/.test(trimmed) && (trimmed.includes('rue') || trimmed.includes('avenue') || trimmed.includes('boulevard') || trimmed.includes('place') || trimmed.includes('allée') || trimmed.includes('chemin'))) {
                street = trimmed;
                break;

            }
        }

        // Chercher le code postal et la ville
        for (const part of addressParts) {
            const trimmed = part.trim();
            if (/^\d{5}$/.test(trimmed)) {
                postalCode = trimmed;
            } else if (trimmed && !trimmed.includes('France') && !trimmed.includes('Île-de-France') && !trimmed.includes('Seine-Saint-Denis')) {
                if (!city) city = trimmed;
            }
        }

        // Construire l'adresse simplifiée
        let formattedAddress = '';
        if (street) {
            formattedAddress += street;
        }
        if (postalCode && city) {
            formattedAddress += (formattedAddress ? ', ' : '') + postalCode + ' ' + city;
        } else if (city) {
            formattedAddress += (formattedAddress ? ', ' : '') + city;
        }

        // Si on n'a pas pu extraire une adresse simple, utiliser l'adresse complète
        if (!formattedAddress) {
            formattedAddress = simpleAddress;
        }

        // Construire l'affichage final
        let result = '';
        if (placeName && this.isPlaceOfInterest(placeName)) {
            result += `<p class="place-name"><strong>${placeName}</strong></p>`;
        }
        if (formattedAddress) {
            result += `<p class="address-details">${formattedAddress}</p>`;
        }

        return result || '<p class="no-address">Adresse non trouvée</p>';
    }


}

// Styles CSS supplémentaires pour les modales
const additionalStyles = `
<style>
.vector-modal .form-group {
    margin-bottom: 20px;
}

.vector-modal label {
    display: block;
    margin-bottom: 5px;
    font-weight: 600;
    color: #333;
}

.vector-modal input,
.vector-modal select,
.vector-modal textarea {
    width: 100%;
    padding: 10px;
    border: 1px solid #ccc;
    border-radius: 5px;
    font-size: 14px;
    font-family: 'Open Sans', sans-serif;
}

.vector-modal .form-actions {
    display: flex;
    gap: 10px;
    justify-content: center;
    margin-top: 30px;
}

.vector-modal .btn-primary,
.vector-modal .btn-secondary {
    padding: 12px 24px;
    border: none;
    border-radius: 5px;
    cursor: pointer;
    font-size: 14px;
    font-weight: 600;
    font-family: 'Open Sans', sans-serif;
}

.vector-modal .btn-primary {
    background: #4CAF50;
    color: white;
}

.vector-modal .btn-secondary {
    background: #f44336;
    color: white;
}

.vector-modal .btn-primary:hover {
    background: #45a049;
}

.vector-modal .btn-secondary:hover {
    background: #da190b;
}

/* Styles pour les informations de lieu */
.location-info {
    max-width: 500px;
}

.info-section {
    margin-bottom: 20px;
    padding: 15px;
    background: #f8f9fa;
    border-radius: 8px;
    border-left: 4px solid #4CAF50;
}

.info-section h4 {
    margin: 0 0 10px 0;
    color: #333;
    font-size: 16px;
    font-weight: 600;
}

.info-section p {
    margin: 5px 0;
    color: #666;
    line-height: 1.4;
}

.google-maps-link {
    color: #2196F3;
    text-decoration: none;
    font-weight: 500;
}

.google-maps-link:hover {
    text-decoration: underline;
}

.no-address {
    color: #999;
    font-style: italic;
}

.place-name {
    color: #2E7D32;
    font-size: 18px;
    font-weight: 600;
    margin-bottom: 8px;
}

.address-details {
    color: #666;
    font-size: 14px;
    margin-top: 0;
}

.grid-generator-form {
    max-width: 400px;
    margin: 0 auto;
}

.location-info h3 {
    color: #4CAF50;
    margin-top: 20px;
    margin-bottom: 10px;
}

.location-info p {
    margin: 5px 0;
    color: #666;
}

.measurement-tooltip {
    background: rgba(255, 87, 34, 0.9) !important;
    color: white !important;
    border: none !important;
    border-radius: 4px !important;
    font-weight: bold !important;
}

.text-marker {
    background: transparent !important;
    border: none !important;
}

/* Styles pour le bouton de désélection de grille */
.deselect-group {
    text-align: center;
    margin-top: 15px;
}

.deselect-group .btn-secondary {
    margin: 0 auto;
}
</style>
`;

// Ajouter les styles supplémentaires
document.head.insertAdjacentHTML('beforeend', additionalStyles);

// ===== INITIALISATION AUTOMATIQUE =====

// Initialisation simple
let vectorToolbar = null;
let vectorToolbox = null;

// Fonction pour initialiser les outils
function initializeVectorTools() {
    // Vérifier les dépendances
    if (typeof L === 'undefined') {
        return;
    }
    
    if (typeof window.map === 'undefined') {
        return;
    }

    // Charger le contenu des fichiers HTML
    loadToolbarContent();
    loadToolboxContent();

    // Attendre que le contenu soit chargé avant d'initialiser
    setTimeout(() => {
        // Initialiser les classes
        if (!vectorToolbar) {
            vectorToolbar = new VectorToolbar();
            window.vectorToolbar = vectorToolbar; // Exposer globalement
        }

        if (!vectorToolbox) {
            vectorToolbox = new VectorToolbox();
            window.vectorToolbox = vectorToolbox; // Exposer globalement
            
            // Attendre un peu plus pour que le HTML soit complètement injecté
            setTimeout(() => {
                if (window.vectorToolbox) {
                    window.vectorToolbox.initializeDefaultParameters();
                }
            }, 200);
        }
    }, 100);
}

// Charger le contenu de la toolbar
function loadToolbarContent() {
    let toolbarContainer = document.getElementById('vectorToolbar');
    
    // Créer l'élément s'il n'existe pas
    if (!toolbarContainer) {
        toolbarContainer = document.createElement('div');
        toolbarContainer.id = 'vectorToolbar';
        toolbarContainer.style.display = 'none';
        document.body.appendChild(toolbarContainer);
    }
    
    // Créer le bouton d'activation principal UNIQUEMENT s'il n'existe pas
    const openBtn = document.getElementById('openVectorToolbar');
    if (!openBtn) {
        const button = document.createElement('button');
        button.id = 'openVectorToolbar';
        button.className = 'vector-toolbar-btn';
        button.innerHTML = '<span>🎨</span><span>Formes</span>'; 
        document.body.appendChild(button);
    }
    
    if (toolbarContainer) {
        // Vider complètement le conteneur pour éviter les conflits
        toolbarContainer.innerHTML = '';
        // Créer le contenu HTML directement
        toolbarContainer.innerHTML = `
            <div class="vector-toolbar">
                <button id="toggleAllSections" class="toolbar-toggle-all" title="Tout est replié">
                    <span class="toggle-icon">▲</span>
                </button>
                <div class="toolbar-content">
                <div class="toolbar-section collapsed">
                    <div class="section-header tool-btn" data-tool="grid" title="Générateur de carroyages">
                        <span class="section-icon">⊞</span>
                        <span class="section-title">Grilles</span>
                    </div>
                    <div class="section-content">
                        <!-- Section vide - le bouton principal est maintenant l'en-tête -->
                    </div>
                </div>
                <div class="toolbar-section collapsed">
                    <div class="section-header">
                        <span class="section-icon">📝</span>
                        <span class="section-title">Texte</span>
                    </div>
                    <div class="section-content">
                        <button class="tool-btn" data-tool="text" title="Insérer du texte">
                            <span class="btn-icon">📝</span>
                            <span class="btn-text">Texte</span>
                        </button>
                    </div>
                </div>
                <div class="toolbar-section collapsed">
                    <div class="section-header">
                        <span class="section-icon">⏱️</span>
                        <span class="section-title">Isochrones</span>
                    </div>
                    <div class="section-content">
                        <button class="tool-btn" data-tool="isochrone" title="Isochrones">
                            <span class="btn-icon">⏱️</span>
                            <span class="btn-text">Temps</span>
                        </button>
                        <button class="tool-btn" data-tool="isodistance" title="Isodistances">
                            <span class="btn-icon">📏</span>
                            <span class="btn-text">Distance</span>
                        </button>
                        <button class="tool-btn" data-tool="zoning" title="Zoning">
                            <span class="btn-icon">🗺️</span>
                            <span class="btn-text">Zones</span>
                        </button>
                    </div>
                </div>
                <div class="toolbar-section collapsed">
                    <div class="section-header">
                        <span class="section-icon">📏</span>
                        <span class="section-title">Lignes</span>
                    </div>
                    <div class="section-content">
                        <button class="tool-btn" data-tool="line" title="Ligne simple">
                            <span class="btn-icon">📏</span>
                            <span class="btn-text">Ligne</span>
                        </button>
                        <button class="tool-btn" data-tool="polyline" title="Polyligne">
                            <span class="btn-icon">📐</span>
                            <span class="btn-text">Polyligne</span>
                        </button>
                        <button class="tool-btn" data-tool="curve" title="Courbe">
                            <span class="btn-icon">〰️</span>
                            <span class="btn-text">Courbe</span>
                        </button>
                    </div>
                </div>
                <div class="toolbar-section collapsed">
                    <div class="section-header">
                        <span class="section-icon">🔷</span>
                        <span class="section-title">Polygones</span>
                    </div>
                    <div class="section-content">
                        <button class="tool-btn" data-tool="polygon" title="Polygone libre">
                            <span class="btn-icon">🔷</span>
                            <span class="btn-text">Libre</span>
                        </button>
                    </div>
                </div>
                <div class="toolbar-section collapsed">
                    <div class="section-header">
                        <span class="section-icon">⬜</span>
                        <span class="section-title">Formes</span>
                    </div>
                    <div class="section-content">
                        <button class="tool-btn" data-tool="rectangle" title="Rectangle">
                            <span class="btn-icon">⬜</span>
                            <span class="btn-text">Rectangle</span>
                        </button>
                        <button class="tool-btn" data-tool="circle" title="Cercle">
                            <span class="btn-icon">⭕</span>
                            <span class="btn-text">Cercle</span>
                        </button>
                        <button class="tool-btn" data-tool="polygon-shape" title="Polygone régulier">
                            <span class="btn-icon">⬢</span>
                            <span class="btn-text">Régulier</span>
                        </button>
                    </div>
                </div>
                <div class="toolbar-section collapsed">
                    <div class="section-header">
                        <span class="section-icon">🏷️</span>
                        <span class="section-title">Stamps</span>
                    </div>
                    <div class="section-content">
                        <button class="tool-btn" data-tool="stamp" title="Insérer un stamp">
                            <span class="btn-icon">🏷️</span>
                            <span class="btn-text">Stamp</span>
                        </button>
                    </div>
                </div>
            </div>
        `;
    }
}

// Charger le contenu de la toolbox
function loadToolboxContent() {
    let toolboxContainer = document.getElementById('vectorToolbox');
    
    // Créer l'élément s'il n'existe pas
    if (!toolboxContainer) {
        toolboxContainer = document.createElement('div');
        toolboxContainer.id = 'vectorToolbox';
        toolboxContainer.style.display = 'none';
        document.body.appendChild(toolboxContainer);
    }
    
    if (toolboxContainer) {
        // Créer le contenu HTML directement
        toolboxContainer.innerHTML = `
            <div class="vector-toolbox">
            <div class="toolbox-header">
                <div class="toolbox-title">
                    <span class="toolbox-icon">🔧</span>
                    <span class="toolbox-text">Outils Vectoriels</span>
                </div>
                <div class="toolbox-controls">
                        <button class="control-btn" id="minimizeToolbox" title="Réduire">
                            <span>−</span>
                        </button>
                    <button class="control-btn" id="closeToolbox" title="Fermer">
                        <span>×</span>
                    </button>
                </div>
            </div>
            <div class="toolbox-content" id="toolboxContent">
                <div class="toolbox-section collapsed">
                    <div class="section-header">
                        <span class="section-icon">📐</span>
                        <span class="section-title">Éléments Vectoriels</span>
                        <span class="element-count" id="elementCount">0</span>
                    </div>
                    <div class="section-content">
                        <div class="element-list" id="elementList">
                                <p class="empty-message">Aucun élément vectoriel créé</p>
                        </div>
                    </div>
                </div>
                    <div class="toolbox-section" id="toolParametersSection">
                    <div class="section-header">
                            <span class="section-icon">🎨</span>
                        <span class="section-title">Paramètres</span>
                    </div>
                    <div class="section-content" id="toolParametersContent" style="display: block;">
                        <!-- Le contenu sera généré dynamiquement selon l'outil sélectionné -->
                        <div class="no-tool-selected">
                            <p>Sélectionnez un outil pour voir ses paramètres</p>
                        </div>
                    </div>
                </div>
                </div>
            </div>
        `;
    }
}

// Initialiser au chargement du DOM
document.addEventListener('DOMContentLoaded', initializeVectorTools);

// Exposer la toolbar globalement pour la communication avec la toolbox
window.vectorToolbar = null;


