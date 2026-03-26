/**
 * CONFIGURATION BARRE D'OUTILS VECTORIELLE - CRISIS MAPPER
 * Fichier de configuration pour personnaliser la barre d'outils
 */

const VectorToolbarConfig = {
    
    // Configuration générale
    general: {
        // Position par défaut de la barre d'outils
        position: {
            side: 'right', // 'left' ou 'right'
            top: '50%',
            transform: 'translateY(-50%)'
        },
        
        // Position par défaut de la toolbox
        toolboxPosition: {
            side: 'left', // 'left' ou 'right'
            top: '20px',
            left: '20px'
        },
        
        // Taille de la barre d'outils
        size: {
            width: '80px',
            maxHeight: '80vh'
        },
        
        // Taille de la toolbox
        toolboxSize: {
            width: '300px',
            maxHeight: '80vh'
        }
    },
    
    // Configuration des outils
    tools: {
        // Générateur de carroyages
        gridGenerator: {
            enabled: true,
            defaultScale: 10, // mètres par case
            defaultSize: 'medium', // 'small', 'medium', 'large', 'custom'
            customSize: {
                width: 20,
                height: 20
            },
            scales: [1, 5, 10, 25, 50, 100, 250, 500, 1000],
            cornerColors: ['#4CAF50', '#FFEB3B', '#2196F3', '#F44336']
        },
        
        // Outils de dessin
        drawingTools: {
            line: {
                enabled: true,
                defaultColor: '#4CAF50',
                defaultWeight: 3,
                defaultOpacity: 0.8
            },
            polyline: {
                enabled: true,
                defaultColor: '#4CAF50',
                defaultWeight: 3,
                defaultOpacity: 0.8
            },
            polygon: {
                enabled: true,
                defaultColor: '#4CAF50',
                defaultWeight: 3,
                defaultOpacity: 0.8,
                defaultFillOpacity: 0.2
            },
            rectangle: {
                enabled: true,
                defaultColor: '#4CAF50',
                defaultWeight: 3,
                defaultOpacity: 0.8,
                defaultFillOpacity: 0.2
            },
            circle: {
                enabled: true,
                defaultColor: '#4CAF50',
                defaultWeight: 3,
                defaultOpacity: 0.8,
                defaultFillOpacity: 0.2
            }
        },
        
        // Outils de texte
        textTool: {
            enabled: true,
            defaultFontSize: 16,
            defaultColor: '#333333',
            defaultBackground: 'rgba(255,255,255,0.9)',
            maxLength: 500
        },
        
        // Outils de mesure
        measurementTool: {
            enabled: true,
            defaultColor: '#FF5722',
            defaultWeight: 3,
            defaultOpacity: 0.8,
            dashArray: '5, 5'
        },
        
        // Outils d'information
        infoTool: {
            enabled: true,
            showUTM: true,
            showAltitude: false,
            showZoom: true
        }
    },
    
    // Configuration des couleurs
    colors: {
        primary: '#4CAF50',
        secondary: '#2196F3',
        success: '#4CAF50',
        warning: '#FF9800',
        error: '#f44336',
        info: '#2196F3',
        
        // Couleurs par défaut des éléments
        defaultElementColor: '#4CAF50',
        defaultTextColor: '#333333',
        defaultMeasurementColor: '#FF5722',
        
        // Couleurs de la grille
        gridColor: '#333333',
        gridOpacity: 0.7,
        gridThickOpacity: 0.9
    },
    
    // Configuration des styles
    styles: {
        // Police
        fontFamily: 'Open Sans, sans-serif',
        
        // Tailles de police
        fontSize: {
            small: '10px',
            medium: '12px',
            large: '14px',
            xlarge: '16px'
        },
        
        // Bordures et ombres
        borderRadius: '10px',
        boxShadow: '0 8px 32px rgba(0, 0, 0, 0.1)',
        
        // Transparence
        backgroundOpacity: 0.95,
        backdropFilter: 'blur(10px)'
    },
    
    // Configuration des animations
    animations: {
        enabled: true,
        duration: 300, // ms
        easing: 'ease-out',
        
        // Animations spécifiques
        slideIn: true,
        fadeIn: true,
        hover: true,
        pulse: true
    },
    
    // Configuration des raccourcis clavier
    shortcuts: {
        enabled: true,
        keys: {
            toggleToolbar: 'F2',
            toggleToolbox: 'F3',
            clearAll: 'Ctrl+Delete',
            saveAll: 'Ctrl+S',
            export: 'Ctrl+E',
            import: 'Ctrl+I'
        }
    },
    
    // Configuration de la sauvegarde
    storage: {
        enabled: true,
        autoSave: true,
        autoSaveInterval: 30000, // ms
        localStorageKey: 'vectorToolbarData',
        maxElements: 1000
    },
    
    // Configuration des modales
    modals: {
        enabled: true,
        closeOnEscape: true,
        closeOnClickOutside: false,
        animation: true
    },
    
    // Configuration des tooltips
    tooltips: {
        enabled: true,
        delay: 500, // ms
        duration: 200, // ms
        position: 'right'
    },
    
    // Configuration des sections
    sections: {
        // Sections pliables
        collapsible: true,
        defaultCollapsed: false,
        
        // Ordre des sections
        order: [
            'grid',
            'isochrones',
            'text',
            'lines',
            'polygons',
            'shapes',
            'stamps',
            'info'
        ]
    },
    
    // Configuration des fonctionnalités avancées
    advanced: {
        // Verrouillage de position
        lockPosition: true,
        defaultLocked: true,
        
        // Déplacement
        draggable: true,
        snapToGrid: false,
        
        // Zoom et pan
        zoomToFit: true,
        panToElement: true,
        
        // Sélection multiple
        multiSelect: false,
        
        // Historique des actions
        history: {
            enabled: true,
            maxSteps: 50
        }
    },
    
    // Configuration des fonctionnalités en développement
    experimental: {
        // Isochrones
        isochrones: {
            enabled: false,
            apiKey: null,
            maxRadius: 50000, // mètres
            defaultRadius: 5000
        },
        
        // Isodistances
        isodistances: {
            enabled: false,
            maxRadius: 50000,
            defaultRadius: 5000
        },
        
        // Zoning
        zoning: {
            enabled: false,
            criteria: ['population', 'accessibility', 'risk']
        },
        
        // Courbes vectorielles
        curves: {
            enabled: false,
            precision: 0.1,
            maxPoints: 100
        },
        
        // Stamps
        stamps: {
            enabled: false,
            library: [],
            customStamps: true
        }
    },
    
    // Configuration des messages
    messages: {
        enabled: true,
        language: 'fr',
        showSuccess: true,
        showWarnings: true,
        showErrors: true,
        duration: 3000 // ms
    },
    
    // Configuration du débogage
    debug: {
        enabled: false,
        logLevel: 'info', // 'error', 'warn', 'info', 'debug'
        showPerformance: false,
        showMemoryUsage: false
    }
};

// Exposer la configuration globalement
window.VectorToolbarConfig = VectorToolbarConfig;

// Fonction pour obtenir une valeur de configuration
function getConfig(path, defaultValue = null) {
    const keys = path.split('.');
    let value = VectorToolbarConfig;
    
    for (const key of keys) {
        if (value && typeof value === 'object' && key in value) {
            value = value[key];
        } else {
            return defaultValue;
        }
    }
    
    return value;
}

// Fonction pour définir une valeur de configuration
function setConfig(path, value) {
    const keys = path.split('.');
    const lastKey = keys.pop();
    let target = VectorToolbarConfig;
    
    for (const key of keys) {
        if (!target[key] || typeof target[key] !== 'object') {
            target[key] = {};
        }
        target = target[key];
    }
    
    target[lastKey] = value;
}

// Exposer les fonctions globalement
window.getConfig = getConfig;
window.setConfig = setConfig;
