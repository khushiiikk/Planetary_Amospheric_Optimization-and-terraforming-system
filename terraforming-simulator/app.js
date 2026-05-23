/**
 * Planet Terraforming Simulator - Main UI & Renderer
 * Controls the game loop, Canvas 3D planetary renderer, custom SVG charts, and interactive HUD.
 */

document.addEventListener('DOMContentLoaded', () => {
  // --- INITS ---
  const simulator = new TerraformSimulator();
  const aiOptimizer = new AIOptimizer(simulator);

  let isSimulationRunning = true;
  let simulationSpeed = 5; // Year-ticks per frame tick
  let lastFrameTime = performance.now();
  let yearsElapsed = 0;

  // History tracking for charts
  const historyData = [];
  const maxHistoryPoints = 120; // Number of points to keep in the SVG chart

  // Canvas elements
  const planetCanvas = document.getElementById('planet-canvas');
  const planetCtx = planetCanvas.getContext('2d');
  const starsCanvas = document.getElementById('stars-background');
  const starsCtx = starsCanvas.getContext('2d');

  // We render the planet to an offscreen buffer at lower resolution for retro-hologram look & 60fps performance
  const renderRes = 240; 
  const sphereCanvas = document.createElement('canvas');
  sphereCanvas.width = renderRes;
  sphereCanvas.height = renderRes;
  const sphereCtx = sphereCanvas.getContext('2d');
  const sphereImageData = sphereCtx.createImageData(renderRes, renderRes);

  // Pre-calculated sphere mapping lookup table (LUT)
  let sphereLUT = [];
  let heightmapCanvas = document.createElement('canvas');
  let heightmapCtx = heightmapCanvas.getContext('2d');
  let heightmapWidth = 0;
  let heightmapHeight = 0;
  let heightmapPixels = null;
  let heightmapLoaded = false;
  let planetRotation = 0.0;

  // Load the MOLA heightmap dataset
  const marsImage = new Image();
  // Relative path to downloaded dataset
  marsImage.src = 'assets/mars_topography.jpg';
  
  marsImage.onload = () => {
    // Write heightmap to hidden canvas to get pixel access
    heightmapWidth = 512;
    heightmapHeight = 256;
    heightmapCanvas.width = heightmapWidth;
    heightmapCanvas.height = heightmapHeight;
    heightmapCtx.drawImage(marsImage, 0, 0, heightmapWidth, heightmapHeight);
    
    const imgData = heightmapCtx.getImageData(0, 0, heightmapWidth, heightmapHeight);
    heightmapPixels = imgData.data;
    heightmapLoaded = true;
    
    // Build sphere projection LUT
    buildSphereLUT();
    document.getElementById('planet-status-text').textContent = 'PLANETARY HUD ONLINE';
    logConsole('MOLA planetary dataset loaded successfully. 512x256 elevation mapping active.', 'success');
  };

  marsImage.onerror = () => {
    document.getElementById('planet-status-text').textContent = 'ERROR LOADING DATASET';
    logConsole('CRITICAL: Failed to load MOLA dataset. Falling back to synthetic procedural grid.', 'warn');
    // Fallback: create procedural noise data
    generateSyntheticHeightmap();
    buildSphereLUT();
  };

  // --- PRE-COMPUTATIONS (SPHERE LUT) ---
  function buildSphereLUT() {
    const cx = renderRes / 2;
    const cy = renderRes / 2;
    const r = renderRes / 2 - 4; // Sphere radius with margin
    const r2 = r * r;

    // Light source vector (normalized)
    const lx = 0.57;
    const ly = -0.57;
    const lz = 0.57;

    sphereLUT = [];

    for (let y = 0; y < renderRes; y++) {
      const dy = y - cy;
      const dy2 = dy * dy;
      for (let x = 0; x < renderRes; x++) {
        const dx = x - cx;
        const dist2 = dx * dx + dy2;

        if (dist2 <= r2) {
          // Inside sphere
          const z = Math.sqrt(r2 - dist2);
          
          // Normals
          const nx = dx / r;
          const ny = dy / r;
          const nz = z / r;

          // Lambertian lighting intensity
          const dot = nx * lx + ny * ly + nz * lz;
          const lighting = Math.max(0.12, dot);

          // Orthographic projection mapping to spherical angles
          // Lat: -pi/2 to pi/2, Lon: -pi to pi
          const lat = Math.asin(ny);
          const lon = Math.atan2(dx, z);

          // Map to UV heightmap coordinates [0, 1]
          const u = (lon + Math.PI) / (2 * Math.PI);
          const v = (lat + Math.PI / 2) / Math.PI;

          // Save coordinates in LUT
          const pixelIndex = (y * renderRes + x) * 4;
          sphereLUT.push({
            idx: pixelIndex,
            u: u,
            v: v,
            lighting: lighting,
            lat: lat
          });
        }
      }
    }
  }

  function generateSyntheticHeightmap() {
    // Generates a mock grid in case MOLA file fails to download
    heightmapWidth = 256;
    heightmapHeight = 128;
    heightmapCanvas.width = heightmapWidth;
    heightmapCanvas.height = heightmapHeight;
    
    // Draw procedural grid circles
    heightmapCtx.fillStyle = '#ff5533';
    heightmapCtx.fillRect(0, 0, heightmapWidth, heightmapHeight);
    
    // Draw some crater basins
    for (let i = 0; i < 80; i++) {
      const cx = Math.random() * heightmapWidth;
      const cy = Math.random() * heightmapHeight;
      const rad = Math.random() * 30 + 5;
      const grad = heightmapCtx.createRadialGradient(cx, cy, 0, cx, cy, rad);
      grad.addColorStop(0, 'purple');
      grad.addColorStop(0.5, 'green');
      grad.addColorStop(1, 'transparent');
      heightmapCtx.fillStyle = grad;
      heightmapCtx.beginPath();
      heightmapCtx.arc(cx, cy, rad, 0, Math.PI * 2);
      heightmapCtx.fill();
    }
    
    const imgData = heightmapCtx.getImageData(0, 0, heightmapWidth, heightmapHeight);
    heightmapPixels = imgData.data;
    heightmapLoaded = true;
  }

  // --- STARS BACKGROUND ---
  let stars = [];
  function resizeStars() {
    starsCanvas.width = window.innerWidth;
    starsCanvas.height = window.innerHeight;
    
    // Generate stars
    stars = [];
    const count = Math.floor((starsCanvas.width * starsCanvas.height) / 6000);
    for (let i = 0; i < count; i++) {
      stars.push({
        x: Math.random() * starsCanvas.width,
        y: Math.random() * starsCanvas.height,
        size: Math.random() * 1.5 + 0.5,
        twinkle: Math.random() * 0.02 + 0.005,
        alpha: Math.random(),
        dir: Math.random() > 0.5 ? 1 : -1
      });
    }
  }
  
  function drawStars() {
    starsCtx.fillStyle = 'rgba(6, 8, 20, 0.4)'; // trails
    starsCtx.fillRect(0, 0, starsCanvas.width, starsCanvas.height);
    
    starsCtx.fillStyle = '#ffffff';
    for (let star of stars) {
      star.alpha += star.twinkle * star.dir;
      if (star.alpha > 1) {
        star.alpha = 1;
        star.dir = -1;
      } else if (star.alpha < 0.2) {
        star.alpha = 0.2;
        star.dir = 1;
      }
      starsCtx.globalAlpha = star.alpha;
      starsCtx.beginPath();
      starsCtx.arc(star.x, star.y, star.size, 0, Math.PI * 2);
      starsCtx.fill();
    }
    starsCtx.globalAlpha = 1.0;
  }

  window.addEventListener('resize', resizeStars);
  resizeStars();

  // --- SIMULATION TICKER LOOP ---
  function gameLoop(now) {
    drawStars();

    // Calculate delta time
    const dtReal = (now - lastFrameTime) / 1000;
    lastFrameTime = now;

    if (isSimulationRunning) {
      // Years elapsed depends on speed selection
      const yearsPerTick = 0.05 * simulationSpeed;
      
      // Update simulator
      simulator.update(yearsPerTick);

      // AI Decision Step
      if (aiOptimizer.isRunning) {
        const aiDecision = aiOptimizer.step(yearsPerTick);
        if (aiDecision) {
          // Apply decision rates to simulator controls and update UI sliders
          simulator.rate_co2 = aiDecision.rate_co2;
          simulator.rate_comets = aiDecision.rate_comets;
          simulator.rate_algae = aiDecision.rate_algae;
          simulator.rate_scrubbers = aiDecision.rate_scrubbers;
          
          updateSlidersUI();
        }
      }

      // Record history for charts periodically
      yearsElapsed += yearsPerTick;
      if (Math.floor(simulator.years * 5) > historyData.length) {
        recordHistory();
      }

      // Update HUD indicators
      updateHUD();
    }

    // Render 3D Planet
    renderPlanet();

    requestAnimationFrame(gameLoop);
  }

  // --- RENDERING PROCEDURAL PLANET SPHERE ---
  function renderPlanet() {
    if (!heightmapLoaded) {
      // Draw standard loading sphere
      planetCtx.clearRect(0, 0, planetCanvas.width, planetCanvas.height);
      planetCtx.fillStyle = 'rgba(255,255,255,0.03)';
      planetCtx.beginPath();
      planetCtx.arc(planetCanvas.width/2, planetCanvas.height/2, 210, 0, Math.PI*2);
      planetCtx.fill();
      return;
    }

    // Shift rotation offset
    planetRotation = (planetRotation + 0.002) % 1.0;

    const data = sphereImageData.data;
    
    // Grab simulator physical limits
    const currentWaterLevel = simulator.water_liquid; // 0% to 80%
    const currentIceLevel = simulator.water_ice;     // 0% to 80%
    const currentVegLevel = simulator.vegetation;     // 0% to 100%
    
    // Water elevation threshold level
    const waterThreshold = 0.22 + 0.38 * (currentWaterLevel / 80.0);
    // Ice latitude boundary (near poles)
    // At low temp, ice expands towards equator. Standard boundary: lat > 45°
    // At high temp, ice retracts to poles (lat > 80°)
    const maxLatIce = 1.48; // Max lat (near poles)
    const minLatIce = 0.35; // Equatorward reach
    
    // Scale ice threshold based on temperature and ice cover
    // If cold (-60°C), ice threshold latitude index is small (large caps). If hot (20°C), large index.
    const tempFactor = Math.max(0.0, Math.min(1.0, (simulator.temperature + 50) / 75)); 
    const iceCapEdge = minLatIce + (maxLatIce - minLatIce) * tempFactor;

    // Loop through pixels in LUT
    for (let i = 0; i < sphereLUT.length; i++) {
      const p = sphereLUT[i];
      const pixelIdx = p.idx;

      // Adjust U mapping with rotation offset
      const uRotated = (p.u + planetRotation) % 1.0;
      
      // Look up source heightmap pixel
      const hX = Math.floor(uRotated * heightmapWidth);
      const hY = Math.floor(p.v * heightmapHeight);
      const hIdx = (hY * heightmapWidth + hX) * 4;

      // Read heightmap color channels
      const r = heightmapPixels[hIdx];
      const g = heightmapPixels[hIdx + 1];
      const b = heightmapPixels[hIdx + 2];

      // Convert MOLA false-color to elevation h [0, 1] using our heuristic
      let h = 0.5;
      const rn = r / 255, gn = g / 255, bn = b / 255;
      
      if (bn > rn && bn > gn) {
        h = 0.2 + 0.15 * bn - 0.15 * rn;
      } else if (gn > rn && gn > bn) {
        h = 0.35 + 0.2 * gn;
      } else if (rn > bn && rn > gn) {
        if (gn > 0.48) {
          h = 0.55 + 0.15 * rn;
        } else {
          h = 0.72 + 0.28 * rn;
        }
      } else {
        h = (rn + gn + bn) / 3;
      }
      h = Math.max(0, Math.min(1, h));

      // Determine pixel coloration based on climate physical criteria
      let pr = 205; // Default barren mars sand
      let pg = 100;
      let pb = 75;

      const isPolarRegion = Math.abs(p.lat) > iceCapEdge;
      const isHighMountainIce = h > 0.88 && simulator.temperature < -10.0;

      if ((isPolarRegion && currentIceLevel > 2.0) || isHighMountainIce) {
        // Polar Glacier / Ice caps (White)
        pr = 230;
        pg = 240;
        pb = 255;
      } else if (h < waterThreshold) {
        // Ocean (Blue)
        // Deepen water based on depth
        const depth = (waterThreshold - h) / waterThreshold;
        pr = Math.floor(10 - 8 * depth);
        pg = Math.floor(55 - 35 * depth);
        pb = Math.floor(210 - 80 * depth);
      } else {
        // Land
        if (currentVegLevel > 0.0) {
          // Vegetation fertility: low altitude plains near water are greenest
          const altitudeFertility = (1.0 - h) * 1.5;
          const proximityToWater = (h - waterThreshold < 0.08) ? 1.8 : 0.8;
          const localGreenOdds = (currentVegLevel / 100.0) * altitudeFertility * proximityToWater;

          if (localGreenOdds > 0.28) {
            // High vegetation density (Mossy deep green)
            pr = 25;
            pg = 155;
            pb = 55;
          } else if (localGreenOdds > 0.1) {
            // Light vegetation (Grassland / Algae patch)
            pr = 90;
            pg = 140;
            pb = 70;
          } else {
            // Barren desert land with small organic trace tint
            pr = 190 - Math.floor(currentVegLevel * 0.3);
            pg = 95 + Math.floor(currentVegLevel * 0.2);
            pb = 70;
          }
        } else {
          // Mars Sand / Rock (MOLA relief coloring overlay)
          // Adjust base colors by elevation shaded relief
          const relief = h * 0.7 + 0.35;
          pr = Math.floor(205 * relief);
          pg = Math.floor(100 * relief);
          pb = Math.floor(75 * relief);
        }
      }

      // Apply 3D Spherical Lambertian shading
      const lighting = p.lighting;
      
      data[pixelIdx] = Math.floor(pr * lighting);
      data[pixelIdx + 1] = Math.floor(pg * lighting);
      data[pixelIdx + 2] = Math.floor(pb * lighting);
      data[pixelIdx + 3] = 255; // Alpha
    }

    // Write rendered image back to sphere canvas
    sphereCtx.putImageData(sphereImageData, 0, 0);

    // Render base screen viewport
    planetCtx.clearRect(0, 0, planetCanvas.width, planetCanvas.height);
    
    // Draw atmospheric glow limb scattering around sphere
    const cx = planetCanvas.width / 2;
    const cy = planetCanvas.height / 2;
    const r = 210;

    // Atmospheric halo color depends on gas mix
    let haloColor = 'rgba(0, 210, 255, 0.4)'; // Electric blue
    if (simulator.p_co2 > 0.4) {
      haloColor = 'rgba(255, 77, 77, 0.4)'; // Hot glowing greenhouse red/orange
    } else if (simulator.p_o2 > 0.15) {
      haloColor = 'rgba(0, 255, 162, 0.45)'; // Oxygen rich green/teal
    }

    const glowGrad = planetCtx.createRadialGradient(cx, cy, r - 5, cx, cy, r + 22);
    glowGrad.addColorStop(0, 'rgba(0, 0, 0, 0)');
    glowGrad.addColorStop(0.2, haloColor);
    glowGrad.addColorStop(0.8, 'rgba(189, 94, 255, 0.05)');
    glowGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
    
    planetCtx.fillStyle = glowGrad;
    planetCtx.beginPath();
    planetCtx.arc(cx, cy, r + 25, 0, Math.PI * 2);
    planetCtx.fill();

    // Draw the sphere scaled up (retro pixelated hologram effect)
    planetCtx.imageSmoothingEnabled = false;
    planetCtx.drawImage(sphereCanvas, cx - r, cy - r, r * 2, r * 2);

    // Draw faint grid overlays (lattices)
    planetCtx.strokeStyle = 'rgba(189, 94, 255, 0.08)';
    planetCtx.lineWidth = 1;
    planetCtx.beginPath();
    // Equator line
    planetCtx.arc(cx, cy, r, 0, Math.PI * 2);
    planetCtx.stroke();
    planetCtx.beginPath();
    planetCtx.ellipse(cx, cy, r, r * 0.3, 0, 0, Math.PI * 2);
    planetCtx.stroke();
  }

  // --- RECORD HISTORY & CHARTS ---
  function recordHistory() {
    historyData.push({
      year: Math.floor(simulator.years),
      oxygen: simulator.p_o2 * 100.0, // Convert to %
      temp: simulator.temperature,
      water: simulator.water_liquid,
      survival: simulator.survival_index
    });

    if (historyData.length > maxHistoryPoints) {
      historyData.shift();
    }

    drawSVGChart();
  }

  function drawSVGChart() {
    const svg = document.getElementById('history-chart');
    const container = document.getElementById('chart-parent');
    
    const width = container.clientWidth;
    const height = 180;
    svg.setAttribute('width', width);
    
    const paddingLeft = 35;
    const paddingRight = 15;
    const paddingTop = 15;
    const paddingBottom = 20;

    const graphWidth = width - paddingLeft - paddingRight;
    const graphHeight = height - paddingTop - paddingBottom;

    // Draw grid
    const gridGroup = document.getElementById('chart-grid');
    gridGroup.innerHTML = '';

    // Draw target lines for context
    const targetsGroup = document.getElementById('chart-targets');
    targetsGroup.innerHTML = '';

    if (historyData.length === 0) return;

    // Find bounds
    const minYear = historyData[0].year;
    const maxYear = Math.max(minYear + 30, historyData[historyData.length - 1].year);

    // Y Axis represents standard values (0% to 100% or Temp -100 to 100)
    // We map Temperature range [-100, 100] and percentages [0, 100] to the same vertical scale
    const mapY = (val, isTemp = false) => {
      let pct = 0;
      if (isTemp) {
        // Map -100°C to +100°C -> 0% to 100%
        pct = (val + 100) / 200;
      } else {
        // Map percentage 0-100
        pct = val / 100;
      }
      pct = Math.max(0, Math.min(1.0, pct));
      return height - paddingBottom - (pct * graphHeight);
    };

    const mapX = (year) => {
      const pct = (year - minYear) / (maxYear - minYear);
      return paddingLeft + (pct * graphWidth);
    };

    // Horizontal grid ticks
    const ticks = [0, 25, 50, 75, 100];
    for (let tick of ticks) {
      const y = mapY(tick);
      
      // Grid line
      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      line.setAttribute('x1', paddingLeft);
      line.setAttribute('y1', y);
      line.setAttribute('x2', width - paddingRight);
      line.setAttribute('y2', y);
      line.setAttribute('class', 'grid-line');
      gridGroup.appendChild(line);

      // Label
      const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      text.setAttribute('x', paddingLeft - 8);
      text.setAttribute('y', y + 3);
      text.setAttribute('text-anchor', 'end');
      text.setAttribute('class', 'grid-label');
      text.textContent = `${tick}%`;
      gridGroup.appendChild(text);
    }

    // Draw horizontal target line for Temperature (15°C -> maps to 115 on -100 to 100 scale, i.e. 57.5%)
    const yTempTarget = mapY(15, true);
    const lineTempTarget = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    lineTempTarget.setAttribute('x1', paddingLeft);
    lineTempTarget.setAttribute('y1', yTempTarget);
    lineTempTarget.setAttribute('x2', width - paddingRight);
    lineTempTarget.setAttribute('y2', yTempTarget);
    lineTempTarget.setAttribute('class', 'target-line');
    targetsGroup.appendChild(lineTempTarget);

    // Build path coordinates
    let pathO2 = '';
    let pathTemp = '';
    let pathWater = '';
    let pathSurvival = '';

    for (let i = 0; i < historyData.length; i++) {
      const pt = historyData[i];
      const x = mapX(pt.year);
      const yO2 = mapY(pt.oxygen);
      const yTemp = mapY(pt.temp, true);
      const yWater = mapY(pt.water);
      const ySurv = mapY(pt.survival);

      const prefix = (i === 0) ? 'M' : 'L';
      pathO2 += `${prefix} ${x} ${yO2} `;
      pathTemp += `${prefix} ${x} ${yTemp} `;
      pathWater += `${prefix} ${x} ${yWater} `;
      pathSurvival += `${prefix} ${x} ${ySurv} `;
    }

    document.getElementById('path-oxygen').setAttribute('d', pathO2);
    document.getElementById('path-temp').setAttribute('d', pathTemp);
    document.getElementById('path-water').setAttribute('d', pathWater);
    document.getElementById('path-survival').setAttribute('d', pathSurvival);
  }

  // --- HUD AND SLIDERS INTERACTS ---
  function updateHUD() {
    document.getElementById('time-display').textContent = `${Math.floor(simulator.years)} Years`;
    document.getElementById('budget-display').textContent = `M$ ${Math.floor(simulator.budget).toLocaleString()}`;
    
    // Survival Index Radial Ring
    const offset = 251.2 - (251.2 * simulator.survival_index) / 100.0;
    document.getElementById('ring-survival').style.strokeDashoffset = offset;
    document.getElementById('val-survival').textContent = `${Math.floor(simulator.survival_index)}%`;

    if (simulator.is_habitable) {
      document.getElementById('ring-survival').style.stroke = 'var(--color-success)';
      document.getElementById('val-survival').style.color = 'var(--color-success)';
    }

    // Oxygen
    document.getElementById('val-oxygen').textContent = `${(simulator.p_o2 * 100).toFixed(2)}%`;
    document.getElementById('val-oxygen-partial').textContent = simulator.p_o2.toFixed(3);
    document.getElementById('bar-oxygen').style.width = `${Math.min(100, (simulator.p_o2 / 0.21) * 100)}%`;

    // Temperature
    document.getElementById('val-temp').textContent = `${simulator.temperature.toFixed(1)}°C`;
    document.getElementById('val-albedo').textContent = simulator.albedo.toFixed(2);
    // Temp progress bar maps -100°C (0%) to +30°C (100%)
    const tempPercent = Math.max(0, Math.min(100, ((simulator.temperature + 100) / 130) * 100));
    document.getElementById('bar-temp').style.width = `${tempPercent}%`;

    // Water
    document.getElementById('val-water').textContent = `${simulator.water_liquid.toFixed(1)}%`;
    document.getElementById('val-ice').textContent = simulator.water_ice.toFixed(1);
    document.getElementById('val-vapor').textContent = (simulator.p_water_vapor * 100).toFixed(2);
    document.getElementById('bar-water').style.width = `${Math.min(100, (simulator.water_liquid / 60.0) * 100)}%`;

    // Pressure
    document.getElementById('val-pressure').textContent = `${simulator.p_total.toFixed(3)} atm`;
    document.getElementById('val-co2').textContent = ((simulator.p_co2 / simulator.p_total) * 100).toFixed(1);
    document.getElementById('val-nitrogen').textContent = ((simulator.p_n2 / simulator.p_total) * 100).toFixed(1);
    document.getElementById('bar-pressure').style.width = `${Math.min(100, (simulator.p_total / 1.0) * 100)}%`;

    // Check system status
    let statusText = 'HUD SECURE';
    if (aiOptimizer.isRunning) {
      statusText = `AI RUNNING (${aiOptimizer.strategy.toUpperCase()})`;
    } else if (simulator.budget <= 0) {
      statusText = 'FUNDS DEPLETED - CONTROLS LOCKED';
    } else if (simulator.is_habitable) {
      statusText = 'PLANET HABITABILITY ACHIEVED 🌍';
    }
    document.getElementById('planet-status-text').textContent = statusText;
  }

  function updateSlidersUI() {
    // CO2 slider
    document.getElementById('ctrl-co2').value = simulator.rate_co2;
    document.getElementById('lbl-ctrl-co2').textContent = `${(simulator.rate_co2 * 0.45).toFixed(1)} kg/s`;

    // Comets slider
    document.getElementById('ctrl-comets').value = simulator.rate_comets;
    document.getElementById('lbl-ctrl-comets').textContent = `${simulator.rate_comets.toFixed(1)} / yr`;

    // Algae slider
    document.getElementById('ctrl-algae').value = simulator.rate_algae;
    document.getElementById('lbl-ctrl-algae').textContent = `${simulator.rate_algae.toFixed(0)}% target`;

    // Scrubbers slider
    document.getElementById('ctrl-scrubbers').value = simulator.rate_scrubbers;
    document.getElementById('lbl-ctrl-scrubbers').textContent = `${simulator.rate_scrubbers.toFixed(0)} units`;
  }

  // --- EVENT HANDLERS ---
  
  // Play / Pause / Reset
  document.getElementById('btn-play').addEventListener('click', () => {
    isSimulationRunning = true;
    document.getElementById('btn-play').classList.add('active');
    document.getElementById('btn-pause').classList.remove('active');
    document.getElementById('rate-display').textContent = 'ACTIVE';
  });

  document.getElementById('btn-pause').addEventListener('click', () => {
    isSimulationRunning = false;
    document.getElementById('btn-play').classList.remove('active');
    document.getElementById('btn-pause').classList.add('active');
    document.getElementById('rate-display').textContent = 'PAUSED';
  });

  document.getElementById('btn-reset').addEventListener('click', () => {
    simulator.reset();
    yearsElapsed = 0;
    historyData.length = 0;
    if (aiOptimizer.isRunning) {
      stopAI();
    }
    updateHUD();
    updateSlidersUI();
    logConsole('Simulator reset to initial raw Martian values.', 'info');
  });

  document.getElementById('select-speed').addEventListener('change', (e) => {
    simulationSpeed = parseInt(e.target.value);
    logConsole(`Simulation speed adjusted to ${simulationSpeed}x.`, 'info');
  });

  // Slider Event Listeners (User manual input overrides)
  document.getElementById('ctrl-co2').addEventListener('input', (e) => {
    if (aiOptimizer.isRunning) stopAI();
    simulator.rate_co2 = parseFloat(e.target.value);
    updateSlidersUI();
  });

  document.getElementById('ctrl-comets').addEventListener('input', (e) => {
    if (aiOptimizer.isRunning) stopAI();
    simulator.rate_comets = parseFloat(e.target.value);
    updateSlidersUI();
  });

  document.getElementById('ctrl-algae').addEventListener('input', (e) => {
    if (aiOptimizer.isRunning) stopAI();
    simulator.rate_algae = parseFloat(e.target.value);
    updateSlidersUI();
  });

  document.getElementById('ctrl-scrubbers').addEventListener('input', (e) => {
    if (aiOptimizer.isRunning) stopAI();
    simulator.rate_scrubbers = parseFloat(e.target.value);
    updateSlidersUI();
  });

  // Emergency triggers
  document.getElementById('btn-comet-strike').addEventListener('click', () => {
    if (simulator.triggerCometStrike()) {
      logConsole('WARNING: comet impact sequence initiated. Heavy thermodynamic energy injection.', 'warn');
      updateHUD();
    } else {
      logConsole('ERROR: Insufficient funds (M$ 250 required) to orbital steer comets.', 'warn');
    }
  });

  document.getElementById('btn-algae-bomb').addEventListener('click', () => {
    if (simulator.triggerAlgaeBomb()) {
      logConsole('SUCCESS: Nitrogen-enriched algae bomb deployed. Instant surface coverage expansion.', 'success');
      updateHUD();
    } else {
      logConsole('ERROR: Algae bomb requires liquid water > 2% and M$ 400 credits.', 'warn');
    }
  });

  // Tab switching (Manual vs AI Panel)
  document.getElementById('tab-manual').addEventListener('click', () => {
    document.getElementById('tab-manual').classList.add('active');
    document.getElementById('tab-ai').classList.remove('active');
    document.getElementById('content-manual').classList.add('active');
    document.getElementById('content-ai').classList.remove('active');
  });

  document.getElementById('tab-ai').addEventListener('click', () => {
    document.getElementById('tab-ai').classList.add('active');
    document.getElementById('tab-manual').classList.remove('active');
    document.getElementById('content-ai').classList.add('active');
    document.getElementById('content-manual').classList.remove('active');
  });

  // AI Optimizer triggers
  const btnRunAI = document.getElementById('btn-run-ai');
  
  btnRunAI.addEventListener('click', () => {
    if (aiOptimizer.isRunning) {
      stopAI();
    } else {
      startAI();
    }
  });

  function startAI() {
    aiOptimizer.isRunning = true;
    aiOptimizer.strategy = document.getElementById('ai-strategy').value;
    
    // Read objectives
    const speedW = parseInt(document.getElementById('weight-speed').value);
    const costW = parseInt(document.getElementById('weight-cost').value);
    const safetyW = parseInt(document.getElementById('weight-safety').value);
    aiOptimizer.setWeights(speedW, costW, safetyW);

    btnRunAI.textContent = 'HALT AI OPTIMIZER AGENT';
    btnRunAI.classList.add('running');
    document.getElementById('console-status-text').textContent = 'RUNNING';
    document.getElementById('console-status-text').classList.add('active');

    logConsole(`AI Agent initialized. Strategy: ${aiOptimizer.strategy.toUpperCase()}`, 'success');

    if (aiOptimizer.strategy === 'reinforcement-learning') {
      // RL requires quick background model training rollout
      logConsole("Training policy grid in background. Please wait...", "warn");
      setTimeout(() => {
        // Run train
        aiOptimizer.trainRLAgent(0.1);
      }, 50);
    }
  }

  function stopAI() {
    aiOptimizer.isRunning = false;
    btnRunAI.textContent = 'INITIALIZE AI OPTIMIZATION AGENT';
    btnRunAI.classList.remove('running');
    document.getElementById('console-status-text').textContent = 'OFFLINE';
    document.getElementById('console-status-text').classList.remove('active');
    logConsole('AI Optimization Agent halted. Releasing system control.', 'warn');
  }

  // AI Logging to console elements
  aiOptimizer.onLog = (msg, type) => {
    logConsole(msg, type);
  };

  function logConsole(text, type = 'info') {
    const logsContainer = document.getElementById('console-logs');
    const logLine = document.createElement('div');
    logLine.classList.add('log-line');
    
    if (type === 'success') logLine.classList.add('text-success');
    else if (type === 'warn') logLine.classList.add('text-warn');
    else if (type === 'dim') logLine.classList.add('text-dim');

    // Prepend timestamp simulation years
    const timestamp = `[Yr ${Math.floor(simulator.years)}]`;
    logLine.textContent = `${timestamp} ${text}`;

    logsContainer.appendChild(logLine);
    
    // Prune logs if too long
    while (logsContainer.children.length > 50) {
      logsContainer.removeChild(logsContainer.firstChild);
    }
    
    // Scroll to bottom
    logsContainer.scrollTop = logsContainer.scrollHeight;
  }

  // --- INITIAL STATED SETUP ---
  updateHUD();
  updateSlidersUI();
  recordHistory();

  // Run loops
  requestAnimationFrame(gameLoop);
});
