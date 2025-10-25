# Mejoras en el Sistema de Geolocalización

## Problema Identificado
El dashboard mostraba "Unknown" en muchas ubicaciones debido a:
- Límites de tasa estrictos en ipapi.co (1000 requests/día sin API key)
- Falta de fallback cuando la API primaria falla
- GPS no se priorizaba correctamente

## Soluciones Implementadas

### 1. API Alternativa con Fallback (ip-api.com)
**Archivo:** `app.js` - líneas 189-306

- **Nueva función:** `getLocationFromIPAPI()`
- Usa `ip-api.com` (sin límites para uso no comercial)
- Sistema de fallback automático:
  1. Intenta primero con `ipapi.co`
  2. Si falla (rate limit, error), usa `ip-api.com`
  3. Guarda en caché resultados exitosos

**Ventajas:**
- Mayor disponibilidad (2 APIs en lugar de 1)
- Sin límites estrictos en la API de fallback
- Mejora significativa en tasa de éxito

### 2. Priorización de GPS sobre IP
**Archivo:** `app.js` - líneas 459-494

**Cambios:**
- GPS se usa PRIMERO si está disponible (más preciso)
- Reverse geocoding desde coordenadas GPS
- Fallback a IP solo si GPS falla o no está disponible

**Flujo mejorado:**
```
1. ¿Hay GPS?
   ✅ Sí → Usar reverse geocoding + IP para ISP/timezone
   ❌ No → Usar IP (ipapi.co → ip-api.com)
```

### 3. Endpoint de Re-procesamiento
**Archivo:** `app.js` - líneas 809-932

**Nueva ruta:** `POST /api/reprocess-locations`

**Funcionalidad:**
- Encuentra víctimas con ubicación "Unknown"
- Intenta obtener ubicación nuevamente:
  1. GPS (si disponible)
  2. IP con las nuevas APIs
- Actualiza registros exitosos
- Pausa de 1 segundo entre requests (evitar saturar APIs)

**Estadísticas retornadas:**
- Total de víctimas procesadas
- Actualizadas exitosamente
- Omitidas (sin datos)
- Errores

### 4. Botón en Dashboard
**Archivo:** `dashboard.html` - líneas 368, 1110-1148

**Características:**
- Muestra contador de víctimas con "Unknown"
- Confirmación antes de ejecutar
- Indicador de progreso
- Reporte de resultados al finalizar
- Recarga automática de datos

## Mejoras en Manejo de Datos

### Valores null en lugar de "Unknown"
**Archivo:** `app.js` - líneas 259-268, 562-571

**Antes:**
```javascript
city: data.city || 'Unknown'
```

**Ahora:**
```javascript
city: data.city || null  // En API
city: geo?.city || 'Unknown'  // Solo al guardar
```

**Ventaja:** Permite distinguir entre "no obtenido" (null) y "obtenido pero vacío"

### Caché Mejorado
- Solo guarda en caché si hay datos válidos
- Evita cachear fallos de API
- TTL de 1 hora (configurable)

## Uso

### Para Nuevas Víctimas
Automático - el sistema usa el nuevo flujo mejorado

### Para Víctimas Existentes con "Unknown"
1. Abrir dashboard
2. Click en "Reprocesar Ubicaciones"
3. Confirmar
4. Esperar (puede tardar varios minutos)
5. Ver resultados

## Resultados Esperados

### Tasa de Éxito Mejorada
- **Antes:** ~50% (dependiendo de límites de ipapi.co)
- **Ahora:** ~90%+ (con fallback y GPS)

### Fuentes de Ubicación
- `gps`: Reverse geocoding desde coordenadas GPS (más preciso)
- `ipapi`: ipapi.co exitoso
- `ip-api`: ip-api.com (fallback)
- `local`: IP local/localhost
- `failed`: Ambas APIs fallaron

### Prioridad de Precisión
1. GPS (±10-50m)
2. IP API (±5-50km dependiendo de la ciudad)
3. Fallback API (similar precisión)

## Notas Técnicas

### Rate Limits
- **ipapi.co:** 1000/día sin key (30,000/mes con key gratuita)
- **ip-api.com:** 45 requests/minuto (ilimitado para uso no comercial)
- **Nominatim (GPS):** 1 request/segundo

### Caché
- Reduce llamadas repetidas a APIs
- TTL: 1 hora
- Limpieza automática cada hora

### Optimizaciones Futuras Sugeridas
1. Obtener API key gratuita de ipapi.co (30k/mes)
2. Implementar rate limiting propio
3. Guardar ubicaciones en base de datos de caché permanente
4. Batch processing para re-procesamiento más eficiente
