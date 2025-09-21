// Text Labels System for 3D Planet - Three.js r125 Compatible
// Creates canvas-based sprites with text that follow 3D positions

var textSprites = []; // Global array to track all text sprites
var textSpriteData = []; // Store original positions and text data for each sprite

/**
 * Creates a canvas-based text sprite for 3D display (r125 compatible)
 * @param {string} text - The text to display
 * @param {string} color - Text color (CSS format, e.g., 'red', '#ff0000')
 * @param {number} fontSize - Font size in pixels
 * @param {string} fontFamily - Font family name
 * @returns {THREE.Sprite} - Text sprite ready to add to scene
 */
function createTextSprite(text, color, fontSize, fontFamily) {
    color = color || 'white';
    fontSize = fontSize || 64;
    fontFamily = fontFamily || 'Arial, sans-serif';
    
    // Create canvas
    var canvas = document.createElement('canvas');
    var context = canvas.getContext('2d');
    
    // Set font and measure text
    context.font = fontSize + 'px ' + fontFamily;
    var textMetrics = context.measureText(text);
    var textWidth = textMetrics.width;
    var textHeight = fontSize;
    
    // Size canvas to fit text with padding
    var padding = 20;
    canvas.width = textWidth + padding * 2;
    canvas.height = textHeight + padding * 2;
    
    // Re-set font after canvas resize (canvas reset)
    context.font = fontSize + 'px ' + fontFamily;
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    
    // Add white background for better readability
    context.fillStyle = 'rgba(255, 255, 255, 0.9)';
    context.fillRect(0, 0, canvas.width, canvas.height);

    // Draw black text
    context.fillStyle = 'black';
    context.fillText(text, canvas.width / 2, canvas.height / 2);
    
    // Create texture from canvas (r125 compatible)
    var texture = new THREE.CanvasTexture(canvas);
    texture.needsUpdate = true;
    
    // Create sprite material (r125 compatible)
    var spriteMaterial = new THREE.SpriteMaterial({
        map: texture,
        transparent: true,
        alphaTest: 0.1
    });
    
    // Create sprite
    var sprite = new THREE.Sprite(spriteMaterial);
    
    // Scale sprite appropriately (adjust as needed)
    var scale = 100; // Base scale
    sprite.scale.set(scale, scale * (canvas.height / canvas.width), 1);
    
    return sprite;
}

/**
 * Adds a text label at a specific 3D position
 * @param {THREE.Vector3} position - World position for the label
 * @param {string} text - Text to display
 * @param {string} color - Text color
 * @param {number} fontSize - Font size
 * @param {number} elevationOffset - Additional height above position
 * @returns {THREE.Sprite} - The created sprite
 */
function addTextLabelAtPosition(position, text, color, fontSize, elevationOffset) {
    elevationOffset = elevationOffset || 50;

    var sprite = createTextSprite(text, color, fontSize);

    // Position the sprite based on current projection mode
    var labelPosition = calculateLabelPosition(position, elevationOffset);
    sprite.position.copy(labelPosition);

    // Scale sprite based on projection mode
    var scale = calculateLabelScale();
    sprite.scale.set(scale, scale * (sprite.scale.y / sprite.scale.x), 1);

    // Store original position data for updates
    var spriteData = {
        sprite: sprite,
        originalPosition: position.clone(),
        text: text,
        color: color,
        fontSize: fontSize,
        elevationOffset: elevationOffset
    };
    textSpriteData.push(spriteData);

    // Add to scene
    if (typeof scene !== 'undefined' && scene) {
        scene.add(sprite);
        textSprites.push(sprite);
    }

    return sprite;
}

/**
 * Calculate appropriate label position based on current projection mode
 * @param {THREE.Vector3} position - Original 3D position
 * @param {number} elevationOffset - Height offset
 * @returns {THREE.Vector3} - Adjusted position
 */
function calculateLabelPosition(position, elevationOffset) {
    var labelPosition = position.clone();

    if (typeof projectionMode !== 'undefined' && projectionMode === "mercator") {
        // In Mercator mode, project to 2D coordinates
        if (typeof cartesianToMercator !== 'undefined' && typeof mercatorCenterLat !== 'undefined') {
            var mercatorCoords = cartesianToMercator(position, mercatorCenterLat, mercatorCenterLon);
            // Scale coordinates to match the map scaling, flat Z positioning in layering system
            labelPosition = new THREE.Vector3(
                mercatorCoords.x * 2.0,
                mercatorCoords.y * 2.0,
                0.3 // Labels on top: Map(0) → Rivers(0.1) → Air Currents(0.2) → Labels(0.3)
            );
        }
    } else {
        // 3D globe mode - position slightly above the surface
        labelPosition.normalize().multiplyScalar(labelPosition.length() + elevationOffset);
    }

    return labelPosition;
}

/**
 * Calculate appropriate label scale based on current projection mode
 * @returns {number} - Scale factor
 */
function calculateLabelScale() {
    if (typeof projectionMode !== 'undefined' && projectionMode === "mercator") {
        // Small scale for 2D map mode - readable but not covering the map
        return 0.4;
    } else {
        // Standard scale for 3D globe mode
        return 100;
    }
}

/**
 * Removes all text sprites from scene
 */
function clearAllTextLabels() {
    for (var i = 0; i < textSprites.length; i++) {
        if (scene && textSprites[i].parent) {
            scene.remove(textSprites[i]);
        }
        // Clean up texture and material
        if (textSprites[i].material && textSprites[i].material.map) {
            textSprites[i].material.map.dispose();
        }
        if (textSprites[i].material) {
            textSprites[i].material.dispose();
        }
    }
    textSprites = [];
    textSpriteData = [];
}

/**
 * Adds "Mount Everest" label to the highest elevation tile
 * @param {Array} tiles - Array of planet tiles
 */
function addMountEverestLabel(tiles) {
    if (!tiles || tiles.length === 0) return;

    // Find tile with highest elevation
    var highestTile = tiles[0];
    for (var i = 1; i < tiles.length; i++) {
        if (tiles[i].elevation > highestTile.elevation) {
            highestTile = tiles[i];
        }
    }

    if (highestTile && highestTile.averagePosition) {
        addTextLabelAtPosition(
            highestTile.averagePosition,
            'Mount Everest',
            'black',
            48,
            80 // Higher offset for mountain peaks
        );
    }
}

/**
 * Adds city labels for all tiles marked as cities
 * @param {Array} tiles - Array of planet tiles
 */
function addCityLabels(tiles) {
    if (!tiles || tiles.length === 0) return;

    var cityCount = 0;
    for (var i = 0; i < tiles.length; i++) {
        var tile = tiles[i];
        if (tile.isCity === true && tile.averagePosition) {
            cityCount++;

            // Simple naming for now - just "City #"
            var cityName = 'City ' + cityCount;

            addTextLabelAtPosition(
                tile.averagePosition,
                cityName,
                'black',
                48,
                80 // Same offset as Mount Everest for consistent sizing
            );
        }
    }

    console.log(`Added ${cityCount} city labels`);
}

/**
 * Updates positions of all existing labels for current projection/camera state
 * Call this when mercator center changes (panning) or camera moves
 */
function updateAllLabelPositions() {
    for (var i = 0; i < textSpriteData.length; i++) {
        var spriteData = textSpriteData[i];
        if (spriteData && spriteData.sprite) {
            // Recalculate position based on current projection state
            var newPosition = calculateLabelPosition(spriteData.originalPosition, spriteData.elevationOffset);
            spriteData.sprite.position.copy(newPosition);

            // Update scale in case projection mode changed
            var scale = calculateLabelScale();
            spriteData.sprite.scale.set(scale, scale * (spriteData.sprite.scale.y / spriteData.sprite.scale.x), 1);
        }
    }
}

/**
 * Rebuilds all labels for the current projection mode
 * Call this when switching between 3D globe and Mercator projection
 * @param {Array} tiles - Array of planet tiles
 */
function rebuildAllLabelsForProjection(tiles) {
    if (!tiles || tiles.length === 0) return;

    console.log("Rebuilding labels for projection mode:", typeof projectionMode !== 'undefined' ? projectionMode : '3d');

    // Clear existing labels and tracking data completely
    clearAllTextLabels();

    // Rebuild Mount Everest label
    addMountEverestLabel(tiles);

    // Rebuild city labels
    addCityLabels(tiles);

    console.log("Labels rebuilt - tracking", textSpriteData.length, "labels");
}