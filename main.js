import './style.css';

// ===== Configuration =====
// Using Open-Meteo API — completely free, no API key required
const WEATHER_BASE = 'https://api.open-meteo.com/v1/forecast';
const GEOCODE_BASE = 'https://nominatim.openstreetmap.org/reverse';

// ===== State =====
const state = {
  mode: 'location',       // 'location' | 'custom'
  temperature: null,
  humidity: null,
  weatherCondition: '',
  cityName: '',
  fanSpeed: 0,            // 0-5
  fanSpeedPercent: 0,     // 0-100
  tempHistory: [],        // { time, temp }
  readingCount: 0,
  startTime: Date.now(),
  locationWatchId: null,
  serialPort: null,
  serialWriter: null,
  isHardwareConnected: false,
  connectionMode: null,      // 'serial' | 'webusb'
  usbDevice: null,
  usbEndpoint: null,
  lastSentSpeed: -1,
  lastSerialTime: 0,
};

let mapInstance = null;
let mapMarker = null;

// ===== DOM Elements =====
const dom = {
  headerTime: document.getElementById('headerTime'),
  headerLocation: document.getElementById('headerLocation'),
  fanSvg: document.getElementById('fanSvg'),
  fanBlades: document.getElementById('fanBlades'),
  fanGlow: document.getElementById('fanGlow'),
  fanSpeedLabel: document.getElementById('fanSpeedLabel'),
  fanSpeedValue: document.getElementById('fanSpeedValue'),
  rpmValue: document.getElementById('rpmValue'),
  speedText: document.getElementById('speedText'),
  speedBarFill: document.getElementById('speedBarFill'),
  tempValue: document.getElementById('tempValue'),
  tempSource: document.getElementById('tempSource'),
  humidityValue: document.getElementById('humidityValue'),
  weatherCondition: document.getElementById('weatherCondition'),
  mapPlaceholder: document.getElementById('mapPlaceholder'),
  mapFrame: document.getElementById('mapFrame'),
  btnLocation: document.getElementById('btnLocation'),
  btnCustom: document.getElementById('btnCustom'),
  customSliderContainer: document.getElementById('customSliderContainer'),
  tempSlider: document.getElementById('tempSlider'),
  sliderTempDisplay: document.getElementById('sliderTempDisplay'),
  predTrend: document.getElementById('predTrend'),
  trendIcon: document.getElementById('trendIcon'),
  predTemp: document.getElementById('predTemp'),
  predConfidence: document.getElementById('predConfidence'),
  confidenceFill: document.getElementById('confidenceFill'),
  predictionChart: document.getElementById('predictionChart'),
  statPower: document.getElementById('statPower'),
  statReadings: document.getElementById('statReadings'),
  statUptime: document.getElementById('statUptime'),
  toast: document.getElementById('toast'),
  toastMessage: document.getElementById('toastMessage'),
  bgParticles: document.getElementById('bgParticles'),
  btnSerialConnect: document.getElementById('btnSerialConnect'),
  btnDisconnect: document.getElementById('btnDisconnect'),
  hwStatus: document.getElementById('hwStatus'),
  feelsLikeValue: document.getElementById('feelsLikeValue'),
};

// ===== Initialize =====
function init() {
  createParticles();
  updateClock();
  setInterval(updateClock, 1000);
  setInterval(updateUptime, 60000);
  setupEventListeners();
  fetchLocationTemperature();
  setInterval(() => {
    if (state.mode === 'location') fetchLocationTemperature();
  }, 60000); // refresh every minute

  // Stop physical fan when page is closed
  window.addEventListener('beforeunload', () => {
    if (state.isHardwareConnected) {
      writeToHardware('0\n').catch(() => {});
    }
  });

  // Render initial icons
  lucide.createIcons();
}

// ===== Background Particles =====
function createParticles() {
  for (let i = 0; i < 30; i++) {
    const particle = document.createElement('div');
    particle.classList.add('particle');
    particle.style.left = Math.random() * 100 + '%';
    particle.style.top = (60 + Math.random() * 40) + '%';
    particle.style.animationDelay = Math.random() * 8 + 's';
    particle.style.animationDuration = (6 + Math.random() * 6) + 's';
    const colors = ['#6366f1', '#06b6d4', '#8b5cf6', '#10b981'];
    particle.style.background = colors[Math.floor(Math.random() * colors.length)];
    dom.bgParticles.appendChild(particle);
  }
}

// ===== Clock =====
function updateClock() {
  const now = new Date();
  dom.headerTime.textContent = now.toLocaleTimeString('en-IN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
  });
}

// ===== Uptime =====
function updateUptime() {
  const mins = Math.floor((Date.now() - state.startTime) / 60000);
  if (mins < 60) {
    dom.statUptime.textContent = mins + 'm';
  } else {
    dom.statUptime.textContent = Math.floor(mins / 60) + 'h ' + (mins % 60) + 'm';
  }
}

// ===== Event Listeners =====
function setupEventListeners() {
  dom.btnLocation.addEventListener('click', () => switchMode('location'));
  dom.btnCustom.addEventListener('click', () => switchMode('custom'));

  dom.tempSlider.addEventListener('input', (e) => {
    const temp = parseInt(e.target.value);
    dom.sliderTempDisplay.textContent = temp + '°C';
    updateTemperature(temp, null, 'Custom Input');
  });

  dom.btnSerialConnect.addEventListener('click', connectHardware);
  dom.btnDisconnect.addEventListener('click', disconnectHardware);
}

// ===== Hardware Communication (Auto-detect: WebUSB for Mobile, Web Serial for PC) =====
function isMobileDevice() {
  return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
}

async function connectHardware() {
  if (isMobileDevice()) {
    await connectViaWebUSB();
  } else {
    await connectViaWebSerial();
  }
}

// Mobile: WebUSB with FTDI protocol
async function connectViaWebUSB() {
  if (!('usb' in navigator)) {
    showToast('⚠️ Browser does not support WebUSB');
    return;
  }

  try {
    const device = await navigator.usb.requestDevice({
      filters: [
        { vendorId: 0x0403 },  // FTDI
        { vendorId: 0x1A86 },  // CH340
        { vendorId: 0x2341 },  // Arduino
        { vendorId: 0x10C4 },  // CP2102
      ]
    });

    await device.open();

    if (device.configuration === null) {
      await device.selectConfiguration(1);
    }

    const iface = device.configuration.interfaces[0];
    const ifaceNum = iface.interfaceNumber;
    await device.claimInterface(ifaceNum);

    let outEndpoint = null;
    for (const ep of iface.alternate.endpoints) {
      if (ep.direction === 'out') {
        outEndpoint = ep.endpointNumber;
        break;
      }
    }
    if (!outEndpoint) throw new Error('No OUT endpoint found');

    // FTDI initialization
    await device.controlTransferOut({ requestType: 'vendor', recipient: 'device', request: 0x00, value: 0x0000, index: ifaceNum + 1 });
    await device.controlTransferOut({ requestType: 'vendor', recipient: 'device', request: 0x03, value: 0x4138, index: ifaceNum + 1 });
    await device.controlTransferOut({ requestType: 'vendor', recipient: 'device', request: 0x04, value: 0x0008, index: ifaceNum + 1 });
    await device.controlTransferOut({ requestType: 'vendor', recipient: 'device', request: 0x02, value: 0x0000, index: ifaceNum + 1 });

    state.usbDevice = device;
    state.usbEndpoint = outEndpoint;
    state.connectionMode = 'webusb';
    onHardwareConnected();
  } catch (err) {
    console.error('WebUSB Error:', err);
    showToast('Hardware connection failed', 'warning');
  }
}

// PC: Web Serial
async function connectViaWebSerial() {
  if (!('serial' in navigator)) {
    showToast('Browser does not support Web Serial', 'warning');
    return;
  }

  try {
    state.serialPort = await navigator.serial.requestPort({
      filters: [
        { usbVendorId: 0x0403 },
        { usbVendorId: 0x1A86 },
        { usbVendorId: 0x2341 },
        { usbVendorId: 0x10C4 },
      ]
    });
    await state.serialPort.open({ baudRate: 9600 });

    const encoder = new TextEncoderStream();
    encoder.readable.pipeTo(state.serialPort.writable);
    state.serialWriter = encoder.writable.getWriter();
    state.connectionMode = 'serial';
    onHardwareConnected();
  } catch (err) {
    console.error('Serial Error:', err);
    showToast('Hardware connection failed', 'warning');
  }
}

function onHardwareConnected() {
  state.isHardwareConnected = true;
  
  dom.btnSerialConnect.classList.add('hidden');
  dom.btnDisconnect.classList.remove('hidden');
  
  dom.hwStatus.textContent = 'Connected';
  dom.hwStatus.classList.add('connected');
  showToast('Physical Fan Connected!', 'success');

  sendSpeedToHardware(state.fanSpeedPercent);

  // Keepalive: re-send speed every 5 seconds
  state.keepaliveTimer = setInterval(() => {
    if (state.isHardwareConnected) {
      const pwmValue = Math.round((state.fanSpeedPercent / 100) * 255);
      writeToHardware(pwmValue + '\n').catch(() => {});
    }
  }, 5000);
}

// Low-level write: auto-selects WebUSB or Web Serial
async function writeToHardware(data) {
  if (state.connectionMode === 'webusb' && state.usbDevice) {
    const encoder = new TextEncoder();
    await state.usbDevice.transferOut(state.usbEndpoint, encoder.encode(data));
  } else if (state.connectionMode === 'serial' && state.serialWriter) {
    await state.serialWriter.write(data);
  }
}

async function disconnectHardware() {
  if (state.keepaliveTimer) {
    clearInterval(state.keepaliveTimer);
  }
  
  // Power off the physical fan before dropping connection
  if (state.isHardwareConnected) {
    try {
      await writeToHardware('0\n');
      // Give the hardware a tiny moment to process the turn-off command
      await new Promise(resolve => setTimeout(resolve, 50));
    } catch (e) {}
  }
  
  if (state.serialPort) {
    try { await state.serialPort.close(); } catch(e) {}
    state.serialPort = null;
    state.serialWriter = null;
  }
  
  if (state.usbDevice) {
    try { await state.usbDevice.close(); } catch(e) {}
    state.usbDevice = null;
  }
  
  state.isHardwareConnected = false;
  state.connectionMode = null;
  
  dom.btnDisconnect.classList.add('hidden');
  dom.btnSerialConnect.classList.remove('hidden', 'connected');
  
  dom.hwStatus.textContent = 'Disconnected';
  dom.hwStatus.classList.remove('connected');
  showToast('Hardware disconnected');
}

async function sendSpeedToHardware(percent) {
  if (!state.isHardwareConnected) return;

  // Throttle: Only send every 100ms
  const now = Date.now();
  if (now - state.lastSerialTime < 100) return;

  // Convert to 0-255 PWM
  const pwmValue = Math.round((percent / 100) * 255);

  // Only send if the value actually changed
  if (pwmValue === state.lastSentSpeed) return;

  try {
    await writeToHardware(pwmValue + '\n');
    state.lastSentSpeed = pwmValue;
    state.lastSerialTime = now;
  } catch (err) {
    console.error('Write Error:', err);
    state.isHardwareConnected = false;
    dom.btnSerialConnect.querySelector('span').textContent = 'Reconnect Fan';
    dom.btnSerialConnect.classList.remove('connected');
    dom.hwStatus.textContent = 'Disconnected';
    dom.hwStatus.classList.remove('connected');
  }
}


// ===== Mode Switch =====
function switchMode(mode) {
  state.mode = mode;

  dom.btnLocation.classList.toggle('active', mode === 'location');
  dom.btnCustom.classList.toggle('active', mode === 'custom');

  if (mode === 'custom') {
    dom.customSliderContainer.classList.remove('hidden');
    dom.tempSource.textContent = 'Custom';
    const temp = parseInt(dom.tempSlider.value);
    updateTemperature(temp, null, 'Custom Input');
    showToast('Custom mode activated', 'settings');
    dom.mapFrame.classList.add('hidden');
    dom.mapPlaceholder.querySelector('span').textContent = 'Map Disabled';
  } else {
    dom.customSliderContainer.classList.add('hidden');
    dom.tempSource.textContent = 'Location';
    fetchLocationTemperature();
    showToast('Location mode activated', 'location');
    if (state.lastLat && state.lastLon) {
      dom.mapFrame.classList.remove('hidden');
    }
  }
}

// ===== Location & Weather Fetch =====
function fetchLocationTemperature() {
  if (!navigator.geolocation) {
    showToast('Geolocation not supported', 'warning');
    switchMode('custom');
    return;
  }

  dom.headerLocation.innerHTML = `
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/>
      <circle cx="12" cy="10" r="3"/>
    </svg>
    Detecting...
  `;

  navigator.geolocation.getCurrentPosition(
    async (position) => {
      const { latitude, longitude, accuracy } = position.coords;
      console.log(`Geolocation: lat=${latitude}, lon=${longitude}, accuracy=${Math.round(accuracy)}m`);
      
      // Store coords and update Map Iframe
      state.lastLat = latitude;
      state.lastLon = longitude;
      
      if (state.mode === 'location') {
        dom.mapFrame.classList.remove('hidden');
        dom.mapPlaceholder.querySelector('span').textContent = 'Location Found';
        
        if (!mapInstance) {
          // Initialize Leaflet map
          mapInstance = L.map('mapFrame', { zoomControl: false }).setView([latitude, longitude], 14);
          
          // Light theme OSM tiles
          L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            maxZoom: 19,
          }).addTo(mapInstance);
          
          // Add custom styled zoom control
          L.control.zoom({ position: 'bottomright' }).addTo(mapInstance);
          
          mapMarker = L.marker([latitude, longitude]).addTo(mapInstance);
        } else {
          mapInstance.setView([latitude, longitude], 14);
          mapMarker.setLatLng([latitude, longitude]);
        }
      }

      try {
        // Fetch weather from Open-Meteo (free, no API key)
        const weatherUrl = `${WEATHER_BASE}?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,relative_humidity_2m,weather_code&timezone=auto`;
        const weatherRes = await fetch(weatherUrl);
        if (!weatherRes.ok) throw new Error(`Weather API error: ${weatherRes.status}`);
        const weatherData = await weatherRes.json();

        const temp = Math.round(weatherData.current.temperature_2m);
        const humidity = weatherData.current.relative_humidity_2m;
        const weatherCode = weatherData.current.weather_code;
        const condition = getWeatherCondition(weatherCode);

        // Fetch city name from coordinates (reverse geocoding)
        let city = `${latitude.toFixed(1)}°, ${longitude.toFixed(1)}°`;
        try {
          const geoUrl = `${GEOCODE_BASE}?lat=${latitude}&lon=${longitude}&format=json&accept-language=en&zoom=18`;
          const geoRes = await fetch(geoUrl);
          if (geoRes.ok) {
            const geoData = await geoRes.json();
            const addr = geoData.address || {};
            console.log('Full address from Nominatim:', JSON.stringify(addr, null, 2));
            // Pick name detail based on geolocation accuracy
            if (accuracy < 5000) {
              // Good accuracy (<5km): show road + local area + city
              const road = addr.road || '';
              const localArea = addr.suburb || addr.neighbourhood || addr.village || addr.city_district;
              const cityName = addr.city || addr.town || addr.state_district || addr.county;
              
              const parts = [];
              if (road) parts.push(road);
              if (localArea && localArea !== road) parts.push(localArea);
              if (cityName && cityName !== localArea && cityName !== road) parts.push(cityName);
              
              if (parts.length > 0) {
                // Limit to 2 most specific parts + city if possible, or just first 2-3
                city = parts.slice(0, 3).join(', ');
              }
            } else {
              // Poor accuracy (IP-based): show broader area
              city = addr.city || addr.state_district || addr.county || addr.state || city;
            }
          }
        } catch (e) {
          // Keep coordinate-based fallback
        }

        state.cityName = city;
        dom.headerLocation.innerHTML = `
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/>
            <circle cx="12" cy="10" r="3"/>
          </svg>
          ${city}
        `;

        if (state.mode === 'location') {
          updateTemperature(temp, humidity, condition);
          showToast(`${temp}°C in ${city} (±${Math.round(accuracy)}m)`, 'temp');
        }
      } catch (err) {
        console.error('Weather API error:', err);
        showToast('Could not fetch weather data. Try custom mode.', 'warning');
      }
    },
    (err) => {
      console.error('Geolocation error:', err);
      dom.headerLocation.innerHTML = `
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/>
          <circle cx="12" cy="10" r="3"/>
        </svg>
        Location denied
      `;
      showToast('Location denied — switching to custom mode', 'warning');
      switchMode('custom');
    },
    { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
  );
}

// ===== WMO Weather Code to Condition =====
function getWeatherCondition(code) {
  if (code === 0) return 'Clear';
  if (code <= 3) return 'Cloudy';
  if (code <= 49) return 'Foggy';
  if (code <= 59) return 'Drizzle';
  if (code <= 69) return 'Rain';
  if (code <= 79) return 'Snow';
  if (code <= 84) return 'Showers';
  if (code <= 94) return 'Thunderstorm';
  return 'Storm';
}

// ===== Core: Update Temperature =====
function updateTemperature(temp, humidity, condition) {
  state.temperature = temp;
  if (humidity !== null) state.humidity = humidity;
  if (condition) state.weatherCondition = condition;

  // Update DOM
  dom.tempValue.textContent = temp;
  dom.humidityValue.textContent = state.humidity !== null ? state.humidity + '%' : '--%';
  dom.weatherCondition.textContent = state.weatherCondition || '--';

  // Record reading
  state.readingCount++;
  dom.statReadings.textContent = state.readingCount;
  state.tempHistory.push({ time: Date.now(), temp });
  if (state.tempHistory.length > 30) state.tempHistory.shift();

  // Calculate fan speed (Now uses both Temp and Humidity)
  calculateFanSpeed(temp, humidity);

  // Run AI prediction
  runPrediction();

  // Draw chart
  drawChart();
}

// ===== Fan Speed Algorithm (Temp + Humidity) =====
function calculateFanSpeed(temp, humidity) {
  // Use Australian Apparent Temperature (Feels Like) formula 
  // AT = Ta + 0.33 * e - 4.00, where e = water vapour pressure
  let effectiveTemp = temp;
  if (humidity != null) {
    const e = (humidity / 100) * 6.105 * Math.exp((17.27 * temp) / (237.7 + temp));
    // Provide a small boost for high humidity
    effectiveTemp = temp + 0.33 * e - 4.00;
    
    // Only use effective temp if it's hotter than the actual dry temp
    if (effectiveTemp < temp) {
      effectiveTemp = temp;
    }
  }
  
  if (dom.feelsLikeValue) {
    dom.feelsLikeValue.textContent = Math.round(effectiveTemp * 10) / 10;
  }

  // Continuous speed curve: 0% at <=15°C, 100% at >=40°C
  const MIN_TEMP = 15;
  const MAX_TEMP = 40;
  
  let percent = 0;
  if (effectiveTemp > MIN_TEMP) {
    if (effectiveTemp >= MAX_TEMP) {
      percent = 100;
    } else {
      percent = ((effectiveTemp - MIN_TEMP) / (MAX_TEMP - MIN_TEMP)) * 100;
    }
  }
  percent = Math.round(percent);

  // Realistic Ceiling Fan RPM (max ~350 RPM)
  const MAX_RPM = 350;
  let rpm = Math.round((percent / 100) * MAX_RPM);
  
  // Cutoff point so fan doesn't spin infinitely slow
  if (rpm < 15) {
    rpm = 0;
    percent = 0;
  }

  // Determine Level Label for UI
  let label = 'OFF';
  if (percent > 0 && percent <= 20) label = 'LOW';
  else if (percent > 20 && percent <= 50) label = 'MED';
  else if (percent > 50 && percent <= 85) label = 'HIGH';
  else if (percent > 85) label = 'MAX';

  state.fanSpeedPercent = percent;

  // Update DOM Display
  dom.rpmValue.textContent = rpm;
  dom.fanSpeedValue.textContent = percent + '%';
  if (dom.speedText) dom.speedText.textContent = label;
  
  // Update fan animation
  if (rpm === 0) {
    dom.fanSvg.classList.remove('fan-spinning');
    document.documentElement.style.setProperty('--fan-opacity', '0.05');
  } else {
    // CSS animation expects duration in seconds per full rotation (360deg)
    // RPM = Rotations Per Minute -> RPS = RPM / 60
    // Duration (s) = 1 / RPS = 60 / RPM
    const durationSec = 60 / rpm;
    
    dom.fanSvg.classList.add('fan-spinning');
    document.documentElement.style.setProperty('--fan-speed', durationSec.toFixed(3) + 's');
    
    // Make glow stronger as it spins faster
    const opacity = 0.1 + (percent / 100) * 0.5;
    document.documentElement.style.setProperty('--fan-opacity', opacity.toFixed(2));
  }
  
  document.documentElement.style.setProperty('--speed-percent', percent + '%');

  // Power estimate (simulated non-linear power curve up to 85W)
  const power = Math.round(85 * Math.pow(percent / 100, 1.5));
  dom.statPower.textContent = power + 'W';

  // Send to physical hardware if connected
  sendSpeedToHardware(percent);
}

// ===== AI/ML: Linear Regression Prediction =====
function runPrediction() {
  const data = state.tempHistory;
  if (data.length < 3) {
    dom.predTrend.innerHTML = '<span class="trend-icon">⏳</span> Collecting data...';
    dom.predTemp.textContent = '--°C';
    dom.predConfidence.textContent = '--%';
    dom.confidenceFill.style.width = '0%';
    return;
  }

  // Normalize time to minutes from first reading
  const t0 = data[0].time;
  const points = data.map((d, i) => ({
    x: (d.time - t0) / 60000, // minutes
    y: d.temp,
  }));

  // Simple Linear Regression: y = mx + b
  const n = points.length;
  let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0, sumY2 = 0;

  for (const p of points) {
    sumX += p.x;
    sumY += p.y;
    sumXY += p.x * p.y;
    sumX2 += p.x * p.x;
    sumY2 += p.y * p.y;
  }

  const denom = n * sumX2 - sumX * sumX;
  let m = denom !== 0 ? (n * sumXY - sumX * sumY) / denom : 0;
  const b = (sumY - m * sumX) / n;

  // Cap slope to prevent wild extrapolation from rapid slider changes
  const MAX_SLOPE = 0.5; // max 0.5°C per minute = 30°C per hour
  m = Math.max(-MAX_SLOPE, Math.min(MAX_SLOPE, m));

  // Predict 60 minutes from last reading, clamped to realistic range
  const lastX = points[points.length - 1].x;
  const rawPrediction = m * (lastX + 60) + b;
  const predictedTemp = Math.round(Math.max(-20, Math.min(60, rawPrediction)) * 10) / 10;

  // R² (coefficient of determination) — confidence
  const yMean = sumY / n;
  let ssTot = 0, ssRes = 0;
  for (const p of points) {
    const yPred = m * p.x + b;
    ssTot += (p.y - yMean) * (p.y - yMean);
    ssRes += (p.y - yPred) * (p.y - yPred);
  }
  let rSquared = ssTot !== 0 ? 1 - (ssRes / ssTot) : 0;
  rSquared = Math.max(0, Math.min(1, rSquared));
  const confidence = Math.round(rSquared * 100);

  // Trend
  let trendText, trendIcon;
  if (m > 0.1) {
    trendText = 'Rising';
    trendIcon = '<i data-lucide="trending-up" style="color: #ef4444; width: 16px; height: 16px;"></i>';
  } else if (m < -0.1) {
    trendText = 'Falling';
    trendIcon = '<i data-lucide="trending-down" style="color: #3b82f6; width: 16px; height: 16px;"></i>';
  } else {
    trendText = 'Stable';
    trendIcon = '<i data-lucide="minus" style="color: #64748b; width: 16px; height: 16px;"></i>';
  }

  // Update DOM
  dom.predTrend.innerHTML = `<span class="trend-icon" style="display:inline-flex;align-items:center;">${trendIcon}</span> ${trendText}`;
  dom.predTemp.textContent = predictedTemp + '°C';
  dom.predConfidence.textContent = confidence + '%';
  dom.confidenceFill.style.width = confidence + '%';
  lucide.createIcons();
}

// ===== Chart Drawing =====
function drawChart() {
  const canvas = dom.predictionChart;
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;

  canvas.width = canvas.offsetWidth * dpr;
  canvas.height = canvas.offsetHeight * dpr;
  ctx.scale(dpr, dpr);

  const w = canvas.offsetWidth;
  const h = canvas.offsetHeight;
  const pad = { top: 20, right: 15, bottom: 25, left: 40 };

  ctx.clearRect(0, 0, w, h);

  const data = state.tempHistory;
  if (data.length < 2) {
    ctx.fillStyle = '#64748b';
    ctx.font = '12px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Waiting for more data points...', w / 2, h / 2);
    return;
  }

  const temps = data.map(d => d.temp);
  const minT = Math.min(...temps) - 2;
  const maxT = Math.max(...temps) + 2;
  const rangeT = maxT - minT || 1;

  const chartW = w - pad.left - pad.right;
  const chartH = h - pad.top - pad.bottom;

  // Grid lines
  ctx.strokeStyle = 'rgba(148, 163, 184, 0.1)';
  ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const y = pad.top + (chartH / 4) * i;
    ctx.beginPath();
    ctx.moveTo(pad.left, y);
    ctx.lineTo(w - pad.right, y);
    ctx.stroke();

    // Y-axis labels
    const tempLabel = Math.round(maxT - (rangeT / 4) * i);
    ctx.fillStyle = '#64748b';
    ctx.font = '10px Inter, sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(tempLabel + '°', pad.left - 8, y + 4);
  }

  // Data points mapping
  const points = data.map((d, i) => ({
    x: pad.left + (i / (data.length - 1)) * chartW,
    y: pad.top + ((maxT - d.temp) / rangeT) * chartH,
  }));

  // Area fill
  const gradient = ctx.createLinearGradient(0, pad.top, 0, h - pad.bottom);
  gradient.addColorStop(0, 'rgba(99, 102, 241, 0.3)');
  gradient.addColorStop(1, 'rgba(99, 102, 241, 0.02)');

  ctx.beginPath();
  ctx.moveTo(points[0].x, h - pad.bottom);
  for (const p of points) {
    ctx.lineTo(p.x, p.y);
  }
  ctx.lineTo(points[points.length - 1].x, h - pad.bottom);
  ctx.closePath();
  ctx.fillStyle = gradient;
  ctx.fill();

  // Line
  const lineGradient = ctx.createLinearGradient(pad.left, 0, w - pad.right, 0);
  lineGradient.addColorStop(0, '#6366f1');
  lineGradient.addColorStop(1, '#06b6d4');

  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) {
    const xc = (points[i].x + points[i - 1].x) / 2;
    const yc = (points[i].y + points[i - 1].y) / 2;
    ctx.quadraticCurveTo(points[i - 1].x, points[i - 1].y, xc, yc);
  }
  ctx.lineTo(points[points.length - 1].x, points[points.length - 1].y);
  ctx.strokeStyle = lineGradient;
  ctx.lineWidth = 2.5;
  ctx.stroke();

  // Data dots
  for (let i = 0; i < points.length; i++) {
    ctx.beginPath();
    ctx.arc(points[i].x, points[i].y, 3, 0, Math.PI * 2);
    ctx.fillStyle = i === points.length - 1 ? '#06b6d4' : '#6366f1';
    ctx.fill();
    ctx.strokeStyle = '#0a0e1a';
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }

  // Last point glow
  const lastP = points[points.length - 1];
  ctx.beginPath();
  ctx.arc(lastP.x, lastP.y, 6, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(6, 182, 212, 0.3)';
  ctx.fill();

  // X-axis label
  ctx.fillStyle = '#64748b';
  ctx.font = '10px Inter, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('Temperature History', w / 2, h - 4);
}

// ===== Toast Notification =====
let toastTimer = null;
function showToast(message, type = 'info') {
  let iconHtml = '';
  switch (type) {
    case 'warning':
      iconHtml = `<i data-lucide="alert-triangle" style="color: #f59e0b; width: 18px; height: 18px;"></i>`;
      break;
    case 'location':
      iconHtml = `<i data-lucide="map-pin" style="color: #3b82f6; width: 18px; height: 18px;"></i>`;
      break;
    case 'temp':
      iconHtml = `<i data-lucide="thermometer" style="color: #ef4444; width: 18px; height: 18px;"></i>`;
      break;
    case 'settings':
      iconHtml = `<i data-lucide="sliders-horizontal" style="color: #8b5cf6; width: 18px; height: 18px;"></i>`;
      break;
    case 'success':
      iconHtml = `<i data-lucide="check-circle" style="color: #10b981; width: 18px; height: 18px;"></i>`;
      break;
    default:
      iconHtml = `<i data-lucide="info" style="color: #3b82f6; width: 18px; height: 18px;"></i>`;
  }
  dom.toast.querySelector('.toast-icon').innerHTML = iconHtml;
  dom.toastMessage.textContent = message;
  dom.toast.classList.add('show');
  lucide.createIcons();
  
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    dom.toast.classList.remove('show');
  }, 3000);
}

// ===== Start =====
init();
