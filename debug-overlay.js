// Debug Overlay System for Planet Generator
// Provides histogram visualization and statistical analysis of elevation data

var debugOverlay = {
    enabled: false,
    canvas: null,
    ctx: null,
    tileInfoOverlay: null,
    selectedTileData: null,
    data: {
        originalElevations: [],
        finalElevations: [],
        landTiles: [],
        statistics: {}
    },
    
    // Initialize the debug overlay system
    init: function() {
        this.createCanvas();
        this.createTileInfoOverlay();
        this.setupEventListeners();
        console.log("Debug overlay system initialized");
    },
    
    // Create and setup the canvas overlay
    createCanvas: function() {
        // Create canvas element
        this.canvas = document.createElement('canvas');
        this.canvas.id = 'debug-overlay-canvas';
        this.canvas.style.cssText = 'position: fixed; top: 0; left: 0; pointer-events: none; z-index: 1000; display: none;';
        document.body.appendChild(this.canvas);
        
        // Get context
        this.ctx = this.canvas.getContext('2d');
        
        // Setup canvas sizing
        this.resizeCanvas();
        window.addEventListener('resize', () => this.resizeCanvas());
    },
    
    // Resize canvas to match window
    resizeCanvas: function() {
        this.canvas.width = window.innerWidth;
        this.canvas.height = window.innerHeight;
    },
    
    // Create tile info overlay element
    createTileInfoOverlay: function() {
        this.tileInfoOverlay = document.createElement('div');
        this.tileInfoOverlay.id = 'tile-info-overlay';
        this.tileInfoOverlay.className = 'tile-info-panel';
        this.tileInfoOverlay.style.cssText = `
            position: fixed;
            bottom: 20px;
            right: 20px;
            background: rgba(0, 0, 0, 0.8);
            color: #00ff00;
            font-family: 'Courier New', monospace;
            font-size: 12px;
            padding: 10px;
            border: 1px solid #00ff00;
            border-radius: 4px;
            z-index: 1001;
            pointer-events: none;
            display: none;
            min-width: 200px;
        `;
        document.body.appendChild(this.tileInfoOverlay);
    },
    
    // Setup keyboard event listeners
    setupEventListeners: function() {
        // Toggle with H key is handled in ui-handlers.js
        // This is just for any internal event handling
    },
    
    // Toggle debug overlay visibility
    toggle: function() {
        this.enabled = !this.enabled;
        this.canvas.style.display = this.enabled ? 'block' : 'none';
        
        if (this.enabled && this.data.landTiles.length > 0) {
            this.render();
        }
        
        console.log("Debug overlay:", this.enabled ? "enabled" : "disabled");
    },
    
    // Update selected tile info
    updateSelectedTile: function(tile) {
        this.selectedTileData = tile;
        if (tile && this.tileInfoOverlay) {
            this.showTileInfo();
        } else {
            this.hideTileInfo();
        }
    },
    
    // Show tile info overlay
    showTileInfo: function() {
        if (!this.selectedTileData || !this.tileInfoOverlay) return;
        
        var tile = this.selectedTileData;
        var info = [];
        
        info.push('<div style="color: #00ff00; font-weight: bold; margin-bottom: 5px;">SELECTED TILE</div>');
        info.push('<div style="border-bottom: 1px solid #333; margin-bottom: 5px;"></div>');
        info.push('<div><span style="color: #888;">ID:</span> <span style="color: #fff;">' + tile.id + '</span></div>');
        info.push('<div><span style="color: #888;">Elevation:</span> <span style="color: #fff;">' + tile.elevation.toFixed(4) + '</span></div>');
        
        // Add additional useful info
        if (typeof tile.biome !== 'undefined') {
            info.push('<div><span style="color: #888;">Biome:</span> <span style="color: #fff;">' + tile.biome + '</span></div>');
        }
        if (typeof tile.temperature !== 'undefined') {
            info.push('<div><span style="color: #888;">Temperature:</span> <span style="color: #fff;">' + tile.temperature.toFixed(3) + '</span></div>');
        }
        if (typeof tile.moisture !== 'undefined') {
            info.push('<div><span style="color: #888;">Moisture:</span> <span style="color: #fff;">' + tile.moisture.toFixed(3) + '</span></div>');
        }
        if (typeof tile.river !== 'undefined' && tile.river) {
            info.push('<div><span style="color: #888;">River:</span> <span style="color: #4488ff;">Yes</span></div>');
        }
        if (typeof tile.lake !== 'undefined' && tile.lake) {
            info.push('<div><span style="color: #888;">Lake:</span> <span style="color: #4488ff;">Yes</span></div>');
        }
        
        this.tileInfoOverlay.innerHTML = info.join('');
        this.tileInfoOverlay.style.display = 'block';
    },
    
    // Hide tile info overlay
    hideTileInfo: function() {
        if (this.tileInfoOverlay) {
            this.tileInfoOverlay.style.display = 'none';
        }
        this.selectedTileData = null;
    },
    
    // Collect elevation data for analysis
    collectData: function(tiles, originalElevations = null) {
        // Clear previous data
        this.data.landTiles = [];
        this.data.finalElevations = [];
        this.data.originalElevations = originalElevations || [];
        
        // Collect land tiles and their elevations
        for (var i = 0; i < tiles.length; i++) {
            if (tiles[i].elevation > 0) {
                this.data.landTiles.push(tiles[i]);
                this.data.finalElevations.push(tiles[i].elevation);
            }
        }
        
        // Calculate statistics
        this.calculateStatistics();
        
        // Render if overlay is enabled
        if (this.enabled) {
            this.render();
        }
        
        console.log("Debug data collected:", this.data.landTiles.length, "land tiles");
    },
    
    // Calculate statistical summary
    calculateStatistics: function() {
        var elevations = this.data.finalElevations.slice().sort(function(a, b) { return a - b; });
        var count = elevations.length;
        
        if (count === 0) {
            this.data.statistics = {};
            return;
        }
        
        // Basic statistics
        var sum = elevations.reduce(function(a, b) { return a + b; }, 0);
        var mean = sum / count;
        var min = elevations[0];
        var max = elevations[count - 1];
        
        // Percentiles
        var p10 = elevations[Math.floor(count * 0.1)];
        var p25 = elevations[Math.floor(count * 0.25)];
        var median = count % 2 === 0 ? 
            (elevations[count/2 - 1] + elevations[count/2]) / 2 : 
            elevations[Math.floor(count/2)];
        var p75 = elevations[Math.floor(count * 0.75)];
        var p90 = elevations[Math.floor(count * 0.9)];
        
        // Distribution analysis
        var highTiles = elevations.filter(function(e) { return e > 0.7; }).length;
        var mediumTiles = elevations.filter(function(e) { return e > 0.3 && e <= 0.7; }).length;
        var lowTiles = elevations.filter(function(e) { return e <= 0.3; }).length;
        
        this.data.statistics = {
            count: count,
            min: min,
            max: max,
            mean: mean,
            median: median,
            p10: p10,
            p25: p25,
            p75: p75,
            p90: p90,
            highTiles: highTiles,
            mediumTiles: mediumTiles,
            lowTiles: lowTiles
        };
    },
    
    // Main render function
    render: function() {
        if (!this.enabled || !this.ctx) return;
        
        // Clear canvas
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        
        // Draw semi-transparent background
        this.ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
        this.ctx.fillRect(20, 20, 600, 400);
        
        // Draw border
        this.ctx.strokeStyle = '#00ff00';
        this.ctx.lineWidth = 2;
        this.ctx.strokeRect(20, 20, 600, 400);
        
        // Draw title
        this.ctx.fillStyle = '#00ff00';
        this.ctx.font = '16px monospace';
        this.ctx.fillText('ELEVATION DEBUG OVERLAY', 30, 45);
        
        // Draw histogram
        this.drawHistogram();
        
        // Draw statistics
        this.drawStatistics();
        
        // Draw legend
        this.drawLegend();
    },
    
    // Draw elevation histogram
    drawHistogram: function() {
        if (this.data.finalElevations.length === 0) return;
        
        var histX = 40;
        var histY = 80;
        var histWidth = 400;
        var histHeight = 200;
        var binCount = 50;
        
        // Create bins
        var bins = new Array(binCount).fill(0);
        var binWidth = 1.0 / binCount; // Elevation range 0-1
        
        // Fill bins
        for (var i = 0; i < this.data.finalElevations.length; i++) {
            var elevation = this.data.finalElevations[i];
            var binIndex = Math.floor(elevation / binWidth);
            if (binIndex >= binCount) binIndex = binCount - 1;
            bins[binIndex]++;
        }
        
        // Find max bin for scaling
        var maxBin = Math.max.apply(null, bins);
        
        // Draw histogram bars
        var barWidth = histWidth / binCount;
        for (var i = 0; i < binCount; i++) {
            var barHeight = (bins[i] / maxBin) * histHeight;
            var x = histX + i * barWidth;
            var y = histY + histHeight - barHeight;
            
            // Color code by elevation range
            if (i / binCount < 0.3) {
                this.ctx.fillStyle = '#00ff00'; // Low elevation - green
            } else if (i / binCount < 0.7) {
                this.ctx.fillStyle = '#ffff00'; // Medium elevation - yellow
            } else {
                this.ctx.fillStyle = '#ff0000'; // High elevation - red
            }
            
            this.ctx.fillRect(x, y, barWidth - 1, barHeight);
        }
        
        // Draw axes
        this.ctx.strokeStyle = '#ffffff';
        this.ctx.lineWidth = 1;
        this.ctx.beginPath();
        this.ctx.moveTo(histX, histY + histHeight);
        this.ctx.lineTo(histX + histWidth, histY + histHeight);
        this.ctx.moveTo(histX, histY);
        this.ctx.lineTo(histX, histY + histHeight);
        this.ctx.stroke();
        
        // Draw axis labels
        this.ctx.fillStyle = '#ffffff';
        this.ctx.font = '12px monospace';
        this.ctx.fillText('0.0', histX - 10, histY + histHeight + 15);
        this.ctx.fillText('1.0', histX + histWidth - 10, histY + histHeight + 15);
        this.ctx.fillText('Elevation', histX + histWidth/2 - 30, histY + histHeight + 30);
        
        // Y-axis label (rotated)
        this.ctx.save();
        this.ctx.translate(histX - 30, histY + histHeight/2);
        this.ctx.rotate(-Math.PI/2);
        this.ctx.fillText('Count', -20, 5);
        this.ctx.restore();
    },
    
    // Draw statistics panel
    drawStatistics: function() {
        var stats = this.data.statistics;
        if (!stats.count) return;
        
        var startX = 460;
        var startY = 80;
        var lineHeight = 16;
        
        this.ctx.fillStyle = '#ffffff';
        this.ctx.font = '12px monospace';
        
        var lines = [
            'STATISTICS',
            '─────────────',
            'Total Land: ' + stats.count,
            'Min:  ' + stats.min.toFixed(3),
            'Max:  ' + stats.max.toFixed(3),
            'Mean: ' + stats.mean.toFixed(3),
            'Med:  ' + stats.median.toFixed(3),
            '',
            'PERCENTILES',
            '─────────────',
            '10th: ' + stats.p10.toFixed(3),
            '25th: ' + stats.p25.toFixed(3),
            '75th: ' + stats.p75.toFixed(3),
            '90th: ' + stats.p90.toFixed(3),
            '',
            'DISTRIBUTION',
            '─────────────',
            'Low (<0.3):  ' + stats.lowTiles + ' (' + (stats.lowTiles/stats.count*100).toFixed(1) + '%)',
            'Med (0.3-0.7): ' + stats.mediumTiles + ' (' + (stats.mediumTiles/stats.count*100).toFixed(1) + '%)',
            'High (>0.7): ' + stats.highTiles + ' (' + (stats.highTiles/stats.count*100).toFixed(1) + '%)'
        ];
        
        for (var i = 0; i < lines.length; i++) {
            this.ctx.fillText(lines[i], startX, startY + i * lineHeight);
        }
    },
    
    // Draw legend and controls
    drawLegend: function() {
        var legendY = 320;
        
        this.ctx.fillStyle = '#ffffff';
        this.ctx.font = '12px monospace';
        this.ctx.fillText('LEGEND:', 40, legendY);
        
        // Color legend
        var colors = [
            {color: '#00ff00', label: 'Low (0.0-0.3)'},
            {color: '#ffff00', label: 'Medium (0.3-0.7)'},
            {color: '#ff0000', label: 'High (0.7-1.0)'}
        ];
        
        for (var i = 0; i < colors.length; i++) {
            var y = legendY + 20 + i * 20;
            
            // Draw color swatch
            this.ctx.fillStyle = colors[i].color;
            this.ctx.fillRect(40, y - 10, 15, 12);
            
            // Draw label
            this.ctx.fillStyle = '#ffffff';
            this.ctx.fillText(colors[i].label, 65, y);
        }
        
        // Controls
        this.ctx.fillStyle = '#888888';
        this.ctx.font = '11px monospace';
        this.ctx.fillText('Press H to toggle this overlay', 40, 390);
        
        // Current parameters
        this.ctx.fillText('elevationExponent: ' + elevationExponent, 300, 350);
        this.ctx.fillText('enableElevationDistributionReshaping: ' + enableElevationDistributionReshaping, 300, 365);
    }
};

// Initialize when page loads
if (typeof window !== 'undefined') {
    window.addEventListener('load', function() {
        debugOverlay.init();
    });
}