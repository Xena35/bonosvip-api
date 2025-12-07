// server-cookies.js - Servidor simplificado usando cookies directas
const express = require('express');
const axios = require('axios');

const app = express();
app.use(express.json());

// Cookies de sesión (configuradas como variables de entorno)
// Limpiamos la cookie eliminando espacios al inicio/final y saltos de línea
const COOKIES_RAW = process.env.BONOSVIP_COOKIES || '';
// Aseguramos que haya espacio después de cada ; (formato correcto de cookies HTTP)
const COOKIES = COOKIES_RAW.trim()
  .replace(/\n/g, '')
  .replace(/\r/g, '')
  .replace(/;\s*/g, '; ');  // Reemplaza ; o ;[espacios] con "; " (formato correcto)
const VALIDADOR_NAME = process.env.VALIDADOR_NAME || 'Lido San Telmo';

// Función para obtener cookies actualizadas
function getCookies() {
  const raw = process.env.BONOSVIP_COOKIES || '';
  return raw.trim()
    .replace(/\n/g, '')
    .replace(/\r/g, '')
    .replace(/;\s*/g, '; ');
}

// Función para verificar si está listo
function isSystemReady() {
  const cookies = getCookies();
  return cookies && cookies.length > 100;
}

/**
 * Función para validar un bono
 */
async function validateVoucher(voucherCode) {
  const COOKIES = getCookies();
  
  if (!COOKIES || COOKIES.length < 100) {
    return {
      success: false,
      error: 'Servidor no configurado correctamente. Falta BONOSVIP_COOKIES.'
    };
  }

  try {
    // Parsear el código del bono
    // Formato esperado: 1332-8584OGDTFXURK-1
    const parts = voucherCode.split('-');
    
    if (parts.length !== 3) {
      return {
        success: false,
        error: 'Formato de código inválido. Debe ser: XXXX-CODIGO-X'
      };
    }

    const h = parts[0]; // Primera parte (ej: 1332)
    const q = parts[1]; // Código central (ej: 8584OGDTFXURK)

    console.log(`🔍 Validando bono: h=${h}, q=${q}`);

    // Hacer la petición de validación con las cookies
    const response = await axios.post(
      'https://empresas.bonosvip.com/php/proc.php',
      new URLSearchParams({
        'q': q,
        'h': h,
        'validador': VALIDADOR_NAME
      }),
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Referer': 'https://empresas.bonosvip.com/validar-bonosvip.html',
          'Cookie': COOKIES,
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      }
    );

    // Parsear la respuesta HTML
    const htmlResponse = response.data;
    
    // Detectar si es válido o inválido
    const isInvalid = htmlResponse.includes('No es posible validar');
    const isValid = !isInvalid;

    // Extraer información del bono
    let service = '';
    let customer = '';

    // Extraer servicio (primera línea de texto)
    const lines = htmlResponse.split('\n').map(l => l.trim()).filter(l => l);
    if (lines.length > 0) {
      service = lines[0].replace(/<[^>]*>/g, '').trim();
    }

    // Extraer titular
    const titleMatch = htmlResponse.match(/Titular del BonoVIP:\s*([^<\n]+)/);
    if (titleMatch) {
      customer = titleMatch[1].trim();
    }

    // Extraer mensaje de error si existe
    let errorMessage = '';
    if (isInvalid) {
      const errorMatch = htmlResponse.match(/No es posible validar.*?\.([^<]*)/s);
      if (errorMatch) {
        errorMessage = errorMatch[0].trim();
      } else {
        errorMessage = 'No es posible validar este BonoVip.';
      }
    }

    console.log(`✅ Validación completada: ${isValid ? 'VÁLIDO' : 'INVÁLIDO'}`);

    return {
      success: true,
      valid: isValid,
      voucher: {
        code: voucherCode,
        service: service,
        customer: customer,
        raw_response: htmlResponse
      },
      error: isInvalid ? errorMessage : null
    };

  } catch (error) {
    console.error('❌ Error validando bono:', error.message);
    
    return {
      success: false,
      error: error.message
    };
  }
}

// ============================================
// ENDPOINTS DE LA API
// ============================================

/**
 * Endpoint de salud
 */
app.get('/health', (req, res) => {
  const cookies = getCookies();
  res.json({
    status: 'ok',
    ready: isSystemReady(),
    uptime: process.uptime(),
    debug: {
      cookies_length: cookies.length,
      cookies_preview: cookies.substring(0, 100),
      has_cookies_env: !!process.env.BONOSVIP_COOKIES,
      cookies_env_length: (process.env.BONOSVIP_COOKIES || '').length
    }
  });
});

/**
 * Endpoint para validar un bono
 * POST /api/validate
 * Body: { "voucher_code": "1332-8584OGDTFXURK-1" }
 */
app.post('/api/validate', async (req, res) => {
  const { voucher_code } = req.body;

  if (!voucher_code) {
    return res.status(400).json({
      success: false,
      error: 'Missing voucher_code parameter'
    });
  }

  console.log(`📥 Recibida petición de validación: ${voucher_code}`);

  const result = await validateVoucher(voucher_code);
  
  res.json(result);
});

// ============================================
// INICIALIZACIÓN
// ============================================

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`🚀 Servidor corriendo en puerto ${PORT}`);
  console.log(`✅ Sistema listo: ${isSystemReady()}`);
});

// Manejar errores no capturados
process.on('unhandledRejection', (error) => {
  console.error('❌ Unhandled rejection:', error);
});

module.exports = app;
