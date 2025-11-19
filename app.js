// Configuration - optimized for performance
const CONFIG = {
    smoothProfile: true,
    windowSize: 5,
    minSpacing: 10,
    maxEdges: 4
};

const FN_RX = /^(?:End)?Step(\d+)_(\d+)_(\d+)_B(\d+)_1\.png$/i;
let selectedFolder = null;
let selectedFiles = [];
let processedResults = [];
let currentPreviewIndex = 0;

// Initialize
document.addEventListener('DOMContentLoaded', function() {
    initializeEventListeners();
    showStatus('Select a folder containing PNG images', 'info');
});

function initializeEventListeners() {
    const folderInput = document.getElementById('folderInput');

    folderInput.addEventListener('change', handleFolderSelection);

    // Update config from UI
    ['smoothProfile', 'windowSize', 'minSpacing', 'maxEdges'].forEach(id => {
        document.getElementById(id).addEventListener('change', updateConfigFromUI);
    });

    // Preview slider event
    document.getElementById('previewSlider').addEventListener('input', function() {
        currentPreviewIndex = parseInt(this.value);
        updatePreview();
    });
}

function updateConfigFromUI() {
    CONFIG.smoothProfile = document.getElementById('smoothProfile').checked;
    CONFIG.windowSize = parseInt(document.getElementById('windowSize').value) || 5;
    CONFIG.minSpacing = parseInt(document.getElementById('minSpacing').value) || 10;
    CONFIG.maxEdges = parseInt(document.getElementById('maxEdges').value) || 4;
}

function showStatus(message, type = 'info') {
    const statusEl = document.getElementById('status');
    statusEl.textContent = message;
    statusEl.className = `status ${type}`;
    statusEl.style.display = 'block';
    if (type === 'success') setTimeout(() => statusEl.style.display = 'none', 5000);
}

function handleFolderSelection(event) {
    const files = Array.from(event.target.files).filter(file => 
        file.name.toLowerCase().endsWith('.png')
    );
    
    selectedFiles = files.sort((a, b) => a.name.localeCompare(b.name));
    
    // Extract full folder path
    if (files.length > 0 && files[0].webkitRelativePath) {
        const pathParts = files[0].webkitRelativePath.split('/');
        pathParts.pop(); // Remove filename
        selectedFolder = pathParts.join('/');
    } else {
        selectedFolder = 'Unknown Folder';
    }
    
    if (selectedFiles.length > 0) {
        document.getElementById('processBtn').disabled = false;
        document.getElementById('folderInfo').textContent = 
            `Folder: ${selectedFolder} (${selectedFiles.length} PNG files)`;
        showStatus(`Found ${selectedFiles.length} PNG files`, 'success');
    } else {
        document.getElementById('processBtn').disabled = true;
        document.getElementById('folderInfo').textContent = 'No PNG files found in folder';
        showStatus('No PNG files found in selected folder', 'error');
    }
}

// FAST: Your optimized moving average
function movingAverage(data, windowSize) {
    if (windowSize < 1) return data;
    
    const ws = windowSize % 2 === 1 ? windowSize : windowSize + 1;
    const halfWindow = (ws - 1) >> 1;
    const n = data.length;
    const smoothed = new Float64Array(n);
    
    // Copy boundaries
    for (let i = 0; i < halfWindow; i++) {
        smoothed[i] = data[i];
        smoothed[n - 1 - i] = data[n - 1 - i];
    }
    
    // Precompute window inverse for multiplication instead of division
    const windowInv = 1.0 / ws;
    
    // Use sliding window sum for better performance
    let windowSum = 0;
    for (let i = 0; i < ws; i++) {
        windowSum += data[i];
    }
    
    smoothed[halfWindow] = windowSum * windowInv;
    
    for (let i = halfWindow + 1; i < n - halfWindow; i++) {
        windowSum = windowSum - data[i - halfWindow - 1] + data[i + halfWindow];
        smoothed[i] = windowSum * windowInv;
    }
    
    return smoothed;
}

// FAST: Your optimized edge detection
function detectEdges(imageData, width, height, minSpacing, maxEdges, smoothProfile, windowSize) {
    const data = imageData.data;
    const profile = new Float64Array(width);
    
    // Process image data efficiently
    for (let col = 0; col < width; col++) {
        let sum = 0;
        for (let row = 0; row < height; row++) {
            const idx = (row * width + col) << 2;
            sum += data[idx]; // Use red channel only
        }
        profile[col] = sum;
    }
    
    // Normalize
    let maxVal = 0;
    for (let i = 0; i < width; i++) {
        if (profile[i] > maxVal) maxVal = profile[i];
    }
    
    const maxValInv = 1.0 / maxVal;
    for (let i = 0; i < width; i++) {
        profile[i] *= maxValInv;
    }
    
    // Apply smoothing
    let processedProfile = profile;
    if (smoothProfile && windowSize > 1) {
        processedProfile = movingAverage(profile, windowSize);
    }
    
    // Compute derivative
    const d1 = new Float64Array(width);
    d1[0] = processedProfile[1] - processedProfile[0];
    
    for (let i = 1; i < width - 1; i++) {
        d1[i] = (processedProfile[i + 1] - processedProfile[i - 1]) * 0.5;
    }
    d1[width - 1] = processedProfile[width - 1] - processedProfile[width - 2];
    
    // Find edges efficiently
    const absD1 = new Float64Array(width);
    for (let i = 0; i < width; i++) {
        absD1[i] = Math.abs(d1[i]);
    }
    
    // Use insertion sort for top K elements
    const edges = [];
    for (let i = 0; i < width && edges.length < maxEdges; i++) {
        let maxIdx = i;
        for (let j = i + 1; j < width; j++) {
            if (absD1[j] > absD1[maxIdx]) maxIdx = j;
        }
        
        // Swap
        if (maxIdx !== i) {
            [absD1[i], absD1[maxIdx]] = [absD1[maxIdx], absD1[i]];
        }
        
        const candidate = maxIdx;
        let valid = true;
        for (const edge of edges) {
            if (Math.abs(candidate - edge) < minSpacing) {
                valid = false;
                break;
            }
        }
        
        if (valid) {
            edges.push(candidate);
        }
    }
    
    edges.sort((a, b) => a - b);
    return edges;
}

// FAST: Image processing with canvas reuse
const tempCanvas = document.createElement('canvas');
const tempCtx = tempCanvas.getContext('2d', { willReadFrequently: true });

function processImage(file) {
    return new Promise((resolve) => {
        const img = new Image();
        const url = URL.createObjectURL(file);
        
        img.onload = function() {
            const match = file.name.match(FN_RX);
            if (!match) {
                URL.revokeObjectURL(url);
                resolve(null);
                return;
            }
            
            const [, step, imgNo, speed, bucket] = match;
            
            // Reuse canvas
            tempCanvas.width = img.width;
            tempCanvas.height = img.height;
            tempCtx.drawImage(img, 0, 0);
            
            const imageData = tempCtx.getImageData(0, 0, img.width, img.height);
            
            const edges = detectEdges(
                imageData,
                img.width,
                img.height,
                CONFIG.minSpacing,
                CONFIG.maxEdges,
                CONFIG.smoothProfile,
                CONFIG.windowSize
            );
            
            const edgeValues = new Array(CONFIG.maxEdges);
            for (let i = 0; i < CONFIG.maxEdges; i++) {
                edgeValues[i] = i < edges.length ? edges[i] : -1;
            }
            
            resolve({
                step: parseInt(step),
                imageNo: parseInt(imgNo),
                speed: parseInt(speed),
                bucket: parseInt(bucket),
                modifiedTime: file.lastModified,
                modifiedString: new Date(file.lastModified).toLocaleString(),
                edges: edgeValues,
                imageUrl: url, // Keep URL for preview
                width: img.width,
                height: img.height,
                filename: file.name
            });
        };
        
        img.onerror = () => {
            URL.revokeObjectURL(url);
            resolve(null);
        };
        
        img.src = url;
    });
}

// FAST: Batch processing with controlled concurrency
async function processFolder() {
    if (!selectedFiles.length) {
        showStatus('Please select a folder first', 'error');
        return;
    }
    
    const processBtn = document.getElementById('processBtn');
    const progress = document.getElementById('progress');
    const progressBar = document.getElementById('progressBar');
    const progressText = document.getElementById('progressText');
    
    processBtn.disabled = true;
    progress.style.display = 'block';
    progressBar.value = 0;
    
    const results = [];
    const totalFiles = selectedFiles.length;
    
    try {
        showStatus('Starting batch processing...', 'info');
        const startTime = performance.now();
        
        // Use optimal batch size
        const BATCH_SIZE = 4;
        for (let batchStart = 0; batchStart < totalFiles; batchStart += BATCH_SIZE) {
            const batchEnd = Math.min(batchStart + BATCH_SIZE, totalFiles);
            const batchPromises = [];
            
            for (let i = batchStart; i < batchEnd; i++) {
                batchPromises.push(processImage(selectedFiles[i]));
            }
            
            const batchResults = await Promise.all(batchPromises);
            
            for (const result of batchResults) {
                if (result) results.push(result);
            }
            
            // Update progress
            const progressPercent = ((batchEnd / totalFiles) * 100).toFixed(1);
            progressBar.value = progressPercent;
            progressText.textContent = `${progressPercent}% (${batchEnd}/${totalFiles})`;
        }
        
        const endTime = performance.now();
        const processingTime = ((endTime - startTime) / 1000).toFixed(2);
        
        if (results.length > 0) {
            processedResults = results;
            processAndExportResults(results);
            setupPreview();
            showStatus(`Processed ${results.length} images in ${processingTime}s`, 'success');
        } else {
            showStatus('No valid images processed', 'error');
        }
        
    } catch (error) {
        console.error('Processing error:', error);
        showStatus('Error: ' + error.message, 'error');
    } finally {
        processBtn.disabled = false;
        setTimeout(() => progress.style.display = 'none', 2000);
    }
}

// FAST: Result processing and export
function processAndExportResults(results) {
    if (results.length === 0) return;
    
    // Sort by modification time
    results.sort((a, b) => a.modifiedTime - b.modifiedTime);
    
    // Compute cumulative times
    const t0 = results[0].modifiedTime;
    results.forEach(result => {
        result.cumulative_s = Math.round((result.modifiedTime - t0) / 1000);
    });
    
    // Compute incremental times (renamed from time_restart)
    let prevCum = 0;
    results.forEach((result, i) => {
        if (i > 0 && result.step !== results[i - 1].step) {
            prevCum = results[i - 1].cumulative_s;
        }
        result.incremental_s = result.cumulative_s - prevCum;
    });
    
    // Export to Excel
    exportToExcel(results);
}

function exportToExcel(results) {
    if (!results.length) return;
    
    try {
        // Prepare data - full folder path on first row, parameters on subsequent rows
        const wsData = [
            ['Folder Path:', selectedFolder || 'Unknown'],
            ['Processing Parameters:', '', '', '', '', '', ''],
            ['Smooth Profile:', CONFIG.smoothProfile ? 'Yes' : 'No'],
            ['Window Size:', CONFIG.windowSize],
            ['Min Edge Spacing:', CONFIG.minSpacing],
            ['Max Edges:', CONFIG.maxEdges],
            [], // Empty row
            ['Step', 'ImageNo', 'Speed', 'Bucket', 'ModifiedTime', 'Cumulative_s', 'Incremental_s']
        ];
        
        // Add edge columns
        for (let i = 1; i <= CONFIG.maxEdges; i++) {
            wsData[7].push(`Edge${i}`);
        }
        
        // Add data rows
        for (const result of results) {
            const row = [
                result.step,
                result.imageNo,
                result.speed,
                result.bucket,
                result.modifiedString,
                result.cumulative_s,
                result.incremental_s
            ];
            
            // Add edge values
            for (let i = 0; i < CONFIG.maxEdges; i++) {
                row.push(result.edges[i] !== -1 ? result.edges[i] : '');
            }
            
            wsData.push(row);
        }
        
        // Create and export workbook
        const ws = XLSX.utils.aoa_to_sheet(wsData);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'ImageData');
        
        // Create filename from folder name only (no dates, no timestamps)
        let fileName = 'edge_results.xlsx';
        if (selectedFolder && selectedFolder !== 'Unknown Folder') {
            // Extract just the folder name (last part of the path)
            const pathParts = selectedFolder.split('/');
            const folderName = pathParts[pathParts.length - 1] || selectedFolder;
            
            // Clean the folder name for filename use
            const cleanFolderName = folderName.replace(/[^a-zA-Z0-9-_]/g, '_');
            if (cleanFolderName) {
                fileName = `${cleanFolderName}.xlsx`;
            }
        }
        
        XLSX.writeFile(wb, fileName);
        
    } catch (error) {
        console.error('Export error:', error);
        showStatus('Export failed: ' + error.message, 'error');
    }
}

// Preview functionality
function setupPreview() {
    if (processedResults.length === 0) return;
    
    const previewSection = document.getElementById('previewSection');
    const slider = document.getElementById('previewSlider');
    
    previewSection.style.display = 'block';
    slider.max = processedResults.length - 1;
    slider.value = 0;
    
    currentPreviewIndex = 0;
    updatePreview();
}

function updatePreview() {
    if (processedResults.length === 0 || currentPreviewIndex >= processedResults.length) return;
    
    const result = processedResults[currentPreviewIndex];
    const canvas = document.getElementById('previewCanvas');
    const ctx = canvas.getContext('2d');
    const previewInfo = document.getElementById('previewInfo');
    const edgeInfo = document.getElementById('edgeInfo');
    
    // Set canvas size to match image
    canvas.width = result.width;
    canvas.height = result.height;
    
    // Draw image
    const img = new Image();
    img.onload = function() {
        // Clear canvas and draw original image
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0);
        
        // Draw edges as red vertical lines
        ctx.strokeStyle = 'red';
        ctx.lineWidth = 2;
        
        const validEdges = [];
        for (const edge of result.edges) {
            if (edge !== -1) {
                ctx.beginPath();
                ctx.moveTo(edge, 0);
                ctx.lineTo(edge, result.height);
                ctx.stroke();
                validEdges.push(edge);
            }
        }
        
        // Draw metadata overlay
        ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
        ctx.fillRect(10, 10, 300, 120);
        
        ctx.fillStyle = 'white';
        ctx.font = '14px Arial';
        ctx.fillText(`Step: ${result.step} | Image: ${result.imageNo}`, 20, 30);
        ctx.fillText(`Bucket: ${result.bucket} | Speed: ${result.speed}`, 20, 50);
        ctx.fillText(`Cumulative: ${result.cumulative_s}s`, 20, 70);
        ctx.fillText(`Incremental: ${result.incremental_s}s`, 20, 90);
        ctx.fillText(`Edges: ${validEdges.join(', ')}`, 20, 110);
        
        // Update info text
        previewInfo.textContent = 
            `Image ${currentPreviewIndex + 1} of ${processedResults.length} | ` +
            `Step: ${result.step} | Bucket: ${result.bucket} | ` +
            `Cumulative: ${result.cumulative_s}s | Incremental: ${result.incremental_s}s`;
        
        // Update edge info
        if (validEdges.length > 0) {
            edgeInfo.textContent = `Detected Edges: ${validEdges.join(', ')} (X-coordinates)`;
        } else {
            edgeInfo.textContent = 'No edges detected';
        }
    };
    
    img.onerror = function() {
        console.error('Failed to load image for preview:', result.imageUrl);
        previewInfo.textContent = 'Error loading image for preview';
    };
    
    img.src = result.imageUrl;
}

function previousImage() {
    if (currentPreviewIndex > 0) {
        currentPreviewIndex--;
        document.getElementById('previewSlider').value = currentPreviewIndex;
        updatePreview();
    }
}

function nextImage() {
    if (currentPreviewIndex < processedResults.length - 1) {
        currentPreviewIndex++;
        document.getElementById('previewSlider').value = currentPreviewIndex;
        updatePreview();
    }
}