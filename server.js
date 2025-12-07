// server.js - Servidor Intermedio para BonosVip
// Este servidor mantiene las cookies de sesión con BonosVip
// y expone una API simple para Make.com

const express = require('express');
const axios = require('axios');
const tough = require('tough-cookie');
const { wrapper } = require('axios-cookiejar-support');

const app = express();
app.use(express.json());

// Configurar axios con soporte de cookies
const cookieJar = new tough.CookieJar();
const client = wrapper(axios.create({ jar: cookieJar }));

// Credenciales de BonosVip (configura estas en variables de entorno)
const BONOSVIP_EMAIL = process.env.BONOSVIP_EMAIL;
const BONOSVIP_PASSWORD = process.env.BONOSVIP_PASSWORD;
const VALIDADOR_NAME = process.env.VALIDADOR_NAME || 'Lido San Telmo';

// Variable para mantener el estado de login
let isLoggedIn = false;
let lastLoginTime = null;
const LOGIN_TIMEOUT = 3600000; // 1 hora en milisegundos

/**
 * Función para hacer login en BonosVip
 */
async function login() {
  try {
    console.log('🔐 Intentando login en BonosVip...');
    
    const response = await client.post(
      'https://empresas.bonosvip.com/component/users/?task=user.login',
      new URLSearchParams({
        'username': BONOSVIP_EMAIL,
        'password': BONOSVIP_PASSWORD,
        'option': 'com_users',
        'task': 'user.login',
        'return': 'aHR0cHM6Ly9lbXByZXNhcy5ib25vc3ZpcC5jb20v'
      }),
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Referer': 'https://empresas.bonosvip.com/',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      }
    );

    // Verificar si el login fue exitoso
    // (En Joomla, un login exitoso suele ser un redirect 303 o 200)
    if (response.status === 200 || response.status === 303) {
      isLoggedIn = true;
      lastLoginTime = Date.now();
      console.log('✅ Login exitoso en BonosVip');
      return true;
    } else {
      console.error('❌ Login fallido:', response.status);
      return false;
    }
  } catch (error) {
    console.error('❌ Error en login:', error.message);
    isLoggedIn = false;
    return false;
  }
}

/**
 * Verificar y renovar sesión si es necesario
 */
async function ensureLoggedIn() {
  const now = Date.now();
  
  // Si no está logueado o la sesión expiró
  if (!isLoggedIn || (now - lastLoginTime) > LOGIN_TIMEOUT) {
    console.log('⚠️ Sesión expirada o no iniciada, haciendo login...');
    await login();
  }
}

/**
 * Función para validar un bono
 */
async function validateVoucher(voucherCode) {
  // Asegurar que estamos logueados
  await ensureLoggedIn();

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
    // parts[2] es la letra final, no se envía

    console.log(`🔍 Validando bono: h=${h}, q=${q}`);

    // Hacer la petición de validación
    const response = await client.post(
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
    const serviceMatch = htmlResponse.match(/<div[^>]*>(.*?)<\/div>/s);
    const titleMatch = htmlResponse.match(/Titular del BonoVIP:\s*([^<]+)/);
    
    let service = '';
    let customer = '';

    // Extraer servicio (primera línea de texto)
    const lines = htmlResponse.split('\n').map(l => l.trim()).filter(l => l);
    if (lines.length > 0) {
      service = lines[0].replace(/<[^>]*>/g, '').trim();
    }

    // Extraer titular
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
    
    // Si hay error de autenticación, reintentar login
    if (error.response && error.response.status === 401) {
      isLoggedIn = false;
      return {
        success: false,
        error: 'Error de autenticación. Reintentando...'
      };
    }

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
  res.json({
    status: 'ok',
    logged_in: isLoggedIn,
    uptime: process.uptime()
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

/**
 * Endpoint para forzar re-login (útil para debugging)
 * POST /api/login
 */
app.post('/api/login', async (req, res) => {
  const success = await login();
  
  res.json({
    success: success,
    logged_in: isLoggedIn
  });
});

// ============================================
// INICIALIZACIÓN
// ============================================

const PORT = process.env.PORT || 3000;

app.listen(PORT, async () => {
  console.log(`🚀 Servidor corriendo en puerto ${PORT}`);
  
  // Hacer login inicial
  if (BONOSVIP_EMAIL && BONOSVIP_PASSWORD) {
    await login();
  } else {
    console.warn('⚠️ BONOSVIP_EMAIL y BONOSVIP_PASSWORD no configurados');
    console.warn('⚠️ Configura las variables de entorno antes de usar la API');
  }
});

// Manejar errores no capturados
process.on('unhandledRejection', (error) => {
  console.error('❌ Unhandled rejection:', error);
});

module.exports = app;
