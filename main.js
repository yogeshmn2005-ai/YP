import './style.css';

/**
 * ===== Configuration & Environment =====
 * High-precision weather and geocoding services.
 */
const WEATHER_BASE = 'https://api.open-meteo.com/v1/forecast';
const GEOCODE_BASE = 'https://nominatim.openstreetmap.org/reverse';

/**
 * ===== Application State =====
 * Reactive state tracking for UI and hardware synchronization.
 */
const state = {
  mode: 'location',
  temperature: null,
  humidity: null,
  weatherCondition: '',
  cityName: '',
  fanSpeedPercent: 0,
  tempHistory: [],
  readingCount: 0,
  startTime: Date.now(),
  serialPort: null,
  serialWriter: null,
  isHardwareConnected: false,
  connectionMode: null, // 'serial' | 'webusb'
  usbDevice: null,
  usbEndpoint: null,
  lastSentSpeed: -1,
  lastSerialTime: 0,
  gpsSource: 'browser'
};

let mapInstance = null;
let mapMarker = null;

/**
 * ===== UI Components & DOM Map =====
 */
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
  btnSerialConnect: document.getElementById('btnSerialConnect'),
  btnDisconnect: document.getElementById('btnDisconnect'),
  hwStatus: document.getElementById('hwStatus'),
  hwLed: document.getElementById('hwLed'),
  feelsLikeValue: document.getElementById('feelsLikeValue'),
  themeToggle: document.getElementById('themeToggle'),
  themeIconSun: document.getElementById('themeIconSun'),
  themeIconMoon: document.getElementById('themeIconMoon'),
};

/**
 * ===== Lifecycle & Initialization =====
 */

/**
 * Initializes the application, starts timers, and fetches initial data.
 */
function init() {
  initTheme();
  updateClock();
  setInterval(updateClock, 1000);
  setInterval(updateUptime, 60000);
  setupEventListeners();
  fetchLocationTemperature();
  
  // Auto-refresh environmental data every minute
  setInterval(() => {
    if (state.mode === 'location') fetchLocationTemperature();
  }, 60000);

  // Safety: Shutdown hardware connection on close
  window.addEventListener('beforeunload', () => {
    if (state.isHardwareConnected) {
      writeToHardware('0\n').catch(() => {});
    }
  });

  lucide.createIcons();

  // Handle responsive chart redraw
  let resizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (state.tempHistory.length >= 2) drawChart();
    }, 250);
  });
}

/**
 * Binds UI events to logic handlers.
 */
function setupEventListeners() {
  dom.btnLocation.addEventListener('click', () => switchMode('location'));
  dom.btnCustom.addEventListener('click', () => switchMode('custom'));
  dom.themeToggle.addEventListener('click', toggleTheme);

  dom.tempSlider.addEventListener('input', (e) => {
    const temp = parseInt(e.target.value);
    dom.sliderTempDisplay.textContent = temp + '°C';
    updateTemperature(temp, state.humidity, 'Custom Input');
  });

  dom.btnSerialConnect.addEventListener('click', connectHardware);
  dom.btnDisconnect.addEventListener('click', disconnectHardware);
}

/**
 * ===== Environment & Navigation Logic =====
 */

/**
 * Toggles between Location-based and Custom temperature input.
 * @param {string} mode - 'location' | 'custom'
 */
function switchMode(mode) {
  state.mode = mode;
  dom.btnLocation.classList.toggle('active', mode === 'location');
  dom.btnCustom.classList.toggle('active', mode === 'custom');

  if (mode === 'custom') {
    dom.customSliderContainer.classList.remove('hidden');
    dom.tempSource.textContent = 'Custom';
    const temp = parseInt(dom.tempSlider.value);
    updateTemperature(temp, state.humidity, 'Custom Input');
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

/**
 * Triggers a GPS poll and fetches weather for the detected location.
 */
async function fetchLocationTemperature() {
  dom.headerLocation.innerHTML = `
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/>
      <circle cx="12" cy="10" r="3"/>
    </svg>
    Scanning GPS...
  `;

  if (!navigator.geolocation) {
    showToast('Geolocation not supported', 'warning');
    switchMode('custom');
    return;
  }

  navigator.geolocation.getCurrentPosition(
    async (position) => {
      const { latitude, longitude, accuracy } = position.coords;
      await updateLocationFromCoords(latitude, longitude, accuracy, 'browser');
    },
    (err) => {
      console.error('Geolocation error:', err);
      dom.headerLocation.innerHTML = `Scanning Failed`;
      showToast('Location denied — using custom mode', 'warning');
      switchMode('custom');
    },
    { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
  );
}

/**
 * Processes GPS coordinates to update Map, Weather, and Address.
 */
async function updateLocationFromCoords(latitude, longitude, accuracy, source) {
  state.gpsSource = source;
  console.log(`Processing location: lat=${latitude}, lon=${longitude}, acc=${Math.round(accuracy)}m`);
  
  state.lastLat = latitude;
  state.lastLon = longitude;
  
  if (state.mode === 'location') {
    dom.mapFrame.classList.remove('hidden');
    dom.mapPlaceholder.querySelector('span').textContent = 'Location Found';
    
    if (!mapInstance) {
      mapInstance = L.map('mapFrame', { zoomControl: false }).setView([latitude, longitude], 14);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(mapInstance);
      L.control.zoom({ position: 'bottomright' }).addTo(mapInstance);
      mapMarker = L.marker([latitude, longitude]).addTo(mapInstance);
    } else {
      mapInstance.setView([latitude, longitude], 14);
      mapMarker.setLatLng([latitude, longitude]);
    }
  }

  try {
    const weatherUrl = `${WEATHER_BASE}?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,relative_humidity_2m,weather_code&timezone=auto`;
    const weatherRes = await fetch(weatherUrl);
    const weatherData = await weatherRes.json();

    const temp = Math.round(weatherData.current.temperature_2m);
    const humidity = weatherData.current.relative_humidity_2m;
    const condition = getWeatherCondition(weatherData.current.weather_code);

    let city = `${latitude.toFixed(2)}°, ${longitude.toFixed(2)}°`;
    try {
      const geoUrl = `${GEOCODE_BASE}?lat=${latitude}&lon=${longitude}&format=json&accept-language=en&zoom=18`;
      const geoRes = await fetch(geoUrl);
      if (geoRes.ok) {
        const geoData = await geoRes.json();
        const addr = geoData.address || {};
        if (accuracy < 5000) {
          const road = addr.road || '';
          const localArea = addr.suburb || addr.neighbourhood || addr.village || addr.city_district;
          const cityName = addr.city || addr.town || addr.state_district || addr.county;
          const parts = [];
          if (road) parts.push(road);
          if (localArea && localArea !== road) parts.push(localArea);
          if (cityName && cityName !== localArea && cityName !== road) parts.push(cityName);
          if (parts.length > 0) city = parts.slice(0, 3).join(', ');
        } else {
          city = addr.city || addr.state_district || addr.county || city;
        }
      }
    } catch (e) {}

    state.cityName = city;
    const sourceIcon = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>`;
    dom.headerLocation.innerHTML = `${sourceIcon} ${city}`;

    if (state.mode === 'location') {
      updateTemperature(temp, humidity, condition);
      showToast(`${temp}°C in ${city}`, 'temp');
    }
  } catch (err) {
    console.error('Environment fetch failed:', err);
  }
}

/**
 * Map weather codes to human-readable conditions.
 */
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

/**
 * ===== Core Processing =====
 */

/**
 * Logic kernel: Updates internal state and triggers UI/Hardware reactions.
 */
function updateTemperature(temp, humidity, condition) {
  state.temperature = temp;
  state.humidity = humidity;
  state.weatherCondition = condition;

  dom.tempValue.textContent = temp;
  dom.humidityValue.textContent = humidity !== null ? humidity + '%' : '--%';
  dom.weatherCondition.textContent = condition || '--';

  state.readingCount++;
  dom.statReadings.textContent = state.readingCount;
  state.tempHistory.push({ time: Date.now(), temp });
  if (state.tempHistory.length > 30) state.tempHistory.shift();

  calculateFanSpeed(temp, humidity);
  runPrediction();
  drawChart();
}

/**
 * Calculates required fan speed based on effective temperature (Humidity-aware).
 */
function calculateFanSpeed(temp, humidity) {
  let effectiveTemp = temp;
  if (humidity != null) {
    const e = (humidity / 100) * 6.105 * Math.exp((17.27 * temp) / (237.7 + temp));
    effectiveTemp = temp + 0.33 * e - 4.00; // Australian Apparent Temp formula
    if (effectiveTemp < temp) effectiveTemp = temp;
  }
  
  if (dom.feelsLikeValue) dom.feelsLikeValue.textContent = Math.round(effectiveTemp * 10) / 10;

  const MIN_T = 15;
  const MAX_T = 40;
  let percent = 0;
  if (effectiveTemp > MIN_T) {
    percent = Math.min(100, ((effectiveTemp - MIN_T) / (MAX_T - MIN_T)) * 100);
  }
  percent = Math.round(percent);

  const MAX_RPM = 350;
  let rpm = Math.round((percent / 100) * MAX_RPM);
  if (rpm < 15) { rpm = 0; percent = 0; }

  let label = 'OFF';
  if (percent > 0 && percent <= 20) label = 'LOW';
  else if (percent > 20 && percent <= 50) label = 'MED';
  else if (percent > 50 && percent <= 85) label = 'HIGH';
  else if (percent > 85) label = 'MAX';

  state.fanSpeedPercent = percent;
  dom.rpmValue.textContent = rpm;
  dom.fanSpeedValue.textContent = percent + '%';
  if (dom.speedText) dom.speedText.textContent = label;
  
  if (rpm === 0) {
    dom.fanSvg.classList.remove('fan-spinning');
    document.documentElement.style.setProperty('--fan-opacity', '0.05');
  } else {
    const durationSec = 60 / rpm;
    dom.fanSvg.classList.add('fan-spinning');
    document.documentElement.style.setProperty('--fan-speed', durationSec.toFixed(3) + 's');
    const opacity = 0.1 + (percent / 100) * 0.5;
    document.documentElement.style.setProperty('--fan-opacity', opacity.toFixed(2));
  }
  
  document.documentElement.style.setProperty('--speed-percent', percent + '%');
  const power = Math.round(85 * Math.pow(percent / 100, 1.5));
  dom.statPower.textContent = power + 'W';

  sendSpeedToHardware(percent);
}

/**
 * ===== Hardware Communication Bridge =====
 */

/**
 * Detects device type and initiates appropriate hardware connection.
 */
async function connectHardware() {
  const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  if (isMobile) {
    await connectViaWebUSBUniversal();
  } else {
    await connectViaWebSerial();
  }
}

/**
 * Robust CH340 Handshake to initialize the USB-to-Serial chip.
 */
async function wakeUpCH340(device) {
  const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
  try {
    addDebugLog("Starting CH340 Handshake...");
    await device.controlTransferOut({ requestType: 'vendor', recipient: 'device', request: 0xa1, value: 0x0000, index: 0x0000 });
    await sleep(50);
    await device.controlTransferOut({ requestType: 'vendor', recipient: 'device', request: 0x9a, value: 0x1312, index: 0xb202 });
    await sleep(50);
    await device.controlTransferOut({ requestType: 'vendor', recipient: 'device', request: 0x9a, value: 0x0f2c, index: 0x0013 });
    await sleep(50);
    await device.controlTransferOut({ requestType: 'vendor', recipient: 'device', request: 0xa4, value: 0x0003, index: 0x0000 });
    await sleep(50);
    addDebugLog("Handshake Complete.");
  } catch (e) {
    addDebugLog("Handshake failed: " + e);
  }
}

/**
 * FTDI Handshake to initialize genuine Arduino Nano boards (FT232R).
 */
async function wakeUpFTDI(device) {
  const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
  try {
    addDebugLog("Starting FTDI Handshake...");
    // 1. Reset device
    await device.controlTransferOut({ requestType: 'vendor', recipient: 'device', request: 0x00, value: 0x0000, index: 0x0000 });
    await sleep(50);
    // 2. Set Baud Rate to 9600
    await device.controlTransferOut({ requestType: 'vendor', recipient: 'device', request: 0x03, value: 0x4138, index: 0x0000 });
    await sleep(50);
    // 3. Set Data Format (8N1)
    await device.controlTransferOut({ requestType: 'vendor', recipient: 'device', request: 0x04, value: 0x0008, index: 0x0000 });
    await sleep(50);
    // 4. Set Flow Control (None)
    await device.controlTransferOut({ requestType: 'vendor', recipient: 'device', request: 0x02, value: 0x0000, index: 0x0000 });
    await sleep(50);
    addDebugLog("FTDI Handshake Complete.");
  } catch (e) {
    addDebugLog("FTDI Handshake failed: " + e);
  }
}

/**
 * Establish connection via WebUSB (Optimized for Mobile OTG).
 */
async function connectViaWebUSBUniversal() {
  if (!('usb' in navigator)) {
    showToast('Browser does not support WebUSB', 'warning');
    return;
  }
  try {
    const device = await navigator.usb.requestDevice({ filters: [] });
    await device.open();
    if (device.configuration === null) await device.selectConfiguration(1);

    let ifaceNum = null, outEndpoint = null;
    for (const iface of device.configuration.interfaces) {
      for (const alt of iface.alternates) {
        if (alt.endpoints && alt.endpoints.length) {
          ifaceNum = iface.interfaceNumber;
          await device.claimInterface(ifaceNum);

          // Apply specific handshake based on the chip brand
          if (device.vendorId === 0x1A86) {
            await wakeUpCH340(device);
          } else if (device.vendorId === 0x0403) {
            await wakeUpFTDI(device);
          } else {
            addDebugLog("Unknown chipset, skipping handshake");
          }

          for (const ep of alt.endpoints) {
            if (ep.direction === 'out') outEndpoint = ep.endpointNumber;
          }
          break;
        }
      }
      if (ifaceNum !== null) break;
    }
    if (!outEndpoint) throw new Error('No OUT endpoint found');
    state.usbDevice = device;
    state.usbEndpoint = outEndpoint;
    state.connectionMode = 'webusb';
    await writeToHardware('0\n');
    onHardwareConnected();
  } catch (err) {
    showToast('Connection failed', 'warning');
  }
}

/**
 * Establish connection via Web Serial (Optimized for Desktop/PC).
 */
async function connectViaWebSerial() {
  if (!('serial' in navigator)) {
    showToast('Browser does not support Web Serial', 'warning');
    return;
  }
  try {
    state.serialPort = await navigator.serial.requestPort({});
    await state.serialPort.open({ baudRate: 9600 });
    const encoder = new TextEncoderStream();
    encoder.readable.pipeTo(state.serialPort.writable);
    state.serialWriter = encoder.writable.getWriter();
    state.connectionMode = 'serial';
    onHardwareConnected();
  } catch (err) {
    showToast('Connection failed', 'warning');
  }
}

/**
 * Low-level write utility for both USB and Serial modes.
 */
async function writeToHardware(data) {
  let sendData = data;
  if (!/\n$/.test(sendData)) sendData += '\n';
  if (state.connectionMode === 'webusb' && state.usbDevice) {
    const encoder = new TextEncoder();
    await state.usbDevice.transferOut(state.usbEndpoint, encoder.encode(sendData));
  } else if (state.connectionMode === 'serial' && state.serialWriter) {
    await state.serialWriter.write(sendData);
  }
}

/**
 * Sends current speed percent to hardware with throttling.
 */
async function sendSpeedToHardware(percent) {
  if (!state.isHardwareConnected) return;
  const now = Date.now();
  if (now - state.lastSerialTime < 100) return;

  const pwmValue = Math.round((percent / 100) * 255);
  if (pwmValue === state.lastSentSpeed) return;

  try {
    await writeToHardware(pwmValue + '\n');
    state.lastSentSpeed = pwmValue;
    state.lastSerialTime = now;
  } catch (err) {
    disconnectHardware();
  }
}

/**
 * Gracefully shuts down the hardware link.
 */
async function disconnectHardware() {
  if (state.keepaliveTimer) clearInterval(state.keepaliveTimer);
  if (state.isHardwareConnected) {
    try {
      await writeToHardware('0\n');
      await new Promise(res => setTimeout(res, 50));
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
  state.lastSentSpeed = -1;
  dom.btnDisconnect.classList.add('hidden');
  dom.btnSerialConnect.classList.remove('hidden');
  dom.hwStatus.textContent = 'OFFLINE';
  dom.hwStatus.classList.remove('connected');
  dom.hwLed.classList.remove('connected');
  showToast('Hardware disconnected');
}

/**
 * Finalizes connection state and starts keepalive pulses.
 */
function onHardwareConnected() {
  state.isHardwareConnected = true;
  dom.btnSerialConnect.classList.add('hidden');
  dom.btnDisconnect.classList.remove('hidden');
  dom.hwStatus.textContent = 'ONLINE';
  dom.hwStatus.classList.add('connected');
  dom.hwLed.classList.add('connected');
  showToast('Physical Fan Connected!', 'success');
  sendSpeedToHardware(state.fanSpeedPercent);

  state.keepaliveTimer = setInterval(() => {
    if (state.isHardwareConnected) {
      writeToHardware(Math.round((state.fanSpeedPercent / 100) * 255) + '\n').catch(() => {});
    }
  }, 5000);
}

/**
 * ===== Intelligence & AI Visualization =====
 */

/**
 * Simple Linear Regression for temperature trend prediction.
 */
function runPrediction() {
  const data = state.tempHistory;
  if (data.length < 3) return;

  const t0 = data[0].time;
  const points = data.map(d => ({ x: (d.time - t0) / 60000, y: d.temp }));
  const n = points.length;
  let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
  for (const p of points) {
    sumX += p.x; sumY += p.y; sumXY += p.x * p.y; sumX2 += p.x * p.x;
  }
  const denom = (n * sumX2 - sumX * sumX);
  const m = denom !== 0 ? (n * sumXY - sumX * sumY) / denom : 0;
  const b = (sumY - m * sumX) / n;

  const lastX = points[points.length - 1].x;
  const predictedTemp = Math.round((m * (lastX + 60) + b) * 10) / 10;
  
  let trendIcon = '<i data-lucide="minus"></i>';
  let trendText = 'Stable';
  if (m > 0.1) { trendText = 'Rising'; trendIcon = '<i data-lucide="trending-up" style="color:var(--accent)"></i>'; }
  else if (m < -0.1) { trendText = 'Falling'; trendIcon = '<i data-lucide="trending-down" style="color:var(--success)"></i>'; }

  dom.predTrend.innerHTML = `<span class="trend-icon">${trendIcon}</span> ${trendText}`;
  dom.predTemp.textContent = predictedTemp + '°C';
  lucide.createIcons();
}

/**
 * Renders the temperature history chart using Canvas API.
 */
function drawChart() {
  const canvas = dom.predictionChart;
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  canvas.width = canvas.offsetWidth * dpr;
  canvas.height = canvas.offsetHeight * dpr;
  ctx.scale(dpr, dpr);
  const w = canvas.offsetWidth, h = canvas.offsetHeight, pad = { top: 20, right: 15, bottom: 25, left: 40 };

  const data = state.tempHistory;
  if (data.length < 2) return;

  const temps = data.map(d => d.temp);
  const minT = Math.min(...temps) - 2, maxT = Math.max(...temps) + 2, rangeT = maxT - minT || 1;
  const chartW = w - pad.left - pad.right, chartH = h - pad.top - pad.bottom;

  const points = data.map((d, i) => ({
    x: pad.left + (i / (data.length - 1)) * chartW,
    y: pad.top + ((maxT - d.temp) / rangeT) * chartH,
  }));

  ctx.strokeStyle = '#ff4757'; ctx.lineWidth = 2.5; ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
  ctx.stroke();
}

/**
 * ===== UI & Appearance Helpers =====
 */

/**
 * Toggles and saves the Light/Dark theme.
 */
function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme') || 'light';
  applyTheme(current === 'dark' ? 'light' : 'dark');
}

/**
 * Applies a specific theme to the document.
 */
function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  const isDark = theme === 'dark';
  dom.themeIconSun.classList.toggle('hidden', isDark);
  dom.themeIconMoon.classList.toggle('hidden', !isDark);
  localStorage.setItem('smartbreeze-theme', theme);
  if (state.tempHistory.length >= 2) drawChart();
}

/**
 * Load theme from persistence or system preference.
 */
function initTheme() {
  const saved = localStorage.getItem('smartbreeze-theme');
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  applyTheme(saved || (prefersDark ? 'dark' : 'light'));
}

/**
 * Updates the digital clock display.
 */
function updateClock() {
  const now = new Date();
  dom.headerTime.textContent = now.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

/**
 * Updates the system uptime display.
 */
function updateUptime() {
  const mins = Math.floor((Date.now() - state.startTime) / 60000);
  dom.statUptime.textContent = mins < 60 ? mins + 'm' : Math.floor(mins / 60) + 'h ' + (mins % 60) + 'm';
}

/**
 * Displays a non-intrusive toast notification.
 */
function showToast(message, type = 'info') {
  const icons = { warning: 'alert-triangle', location: 'map-pin', temp: 'thermometer', settings: 'sliders-horizontal', success: 'check-circle' };
  const icon = icons[type] || 'info';
  dom.toast.querySelector('.toast-icon').innerHTML = `<i data-lucide="${icon}"></i>`;
  dom.toastMessage.textContent = message;
  dom.toast.classList.add('show');
  lucide.createIcons();
  setTimeout(() => dom.toast.classList.remove('show'), 3000);
}

/**
 * Log helper for hardware troubleshooting.
 */
function addDebugLog(msg) {
  console.log(`[DEBUG] ${msg}`);
}

/**
 * Boot the application.
 */
init();
