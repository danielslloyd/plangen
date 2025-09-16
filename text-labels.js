// Text Labels System for 3D Planet - Three.js r125 Compatible
// Creates canvas-based sprites with text that follow 3D positions

var textSprites = []; // Global array to track all text sprites

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
    
    // Optional: Add background
    context.fillStyle = 'rgba(0, 0, 0, 0.3)';
    context.fillRect(0, 0, canvas.width, canvas.height);
    
    // Draw text
    context.fillStyle = color;
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
    
    // Position the sprite slightly above the target position
    var labelPosition = position.clone();
    labelPosition.normalize().multiplyScalar(labelPosition.length() + elevationOffset);
    sprite.position.copy(labelPosition);
    
    // Add to scene
    if (typeof scene !== 'undefined' && scene) {
        scene.add(sprite);
        textSprites.push(sprite);
    }
    
    return sprite;
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
            'red',
            48,
            80 // Higher offset for mountain peaks
        );
    }
}