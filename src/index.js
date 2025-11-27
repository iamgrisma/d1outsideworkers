// File: src/index.js

export default {
  async fetch(request, env, ctx) {
    // --- CORS HEADERS (Required for Localhost/Browser Access) ---
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*", // Allows access from any domain/localhost
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, X-Time-Token"
    };

    // 1. HANDLE BROWSER PRE-FLIGHT (OPTIONS request)
    // Browsers always send this first to check permissions
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    // --- CONFIGURATION ---
    const FAKE_ERROR = `
<br />
<b>Parse error</b>:  syntax error, unexpected '?' in <b>/var/www/html/libs/db_connect.php</b> on line <b>14</b><br />
`;

    // 2. GET THE TOKEN & SECRET
    const receivedToken = request.headers.get("X-Time-Token");
    const secretSeed = env.API_SECRET; 

    // Helper to return Stealth Response with CORS (so browser doesn't block the error message)
    const returnStealth = () => new Response(FAKE_ERROR, { 
      status: 200, 
      headers: { 
        "Content-Type": "text/html",
        ...corsHeaders 
      } 
    });

    if (!receivedToken || !secretSeed) {
       return returnStealth();
    }

    // 3. VERIFY TIME-BASED TOKEN
    const isValid = await verifyTimeToken(receivedToken, secretSeed);

    if (!isValid) {
       return returnStealth();
    }

    // 4. EXECUTE SQL
    if (request.method !== "POST") return returnStealth();

    try {
      const payload = await request.json();
      
      const stmt = env.DB.prepare(payload.sql).bind(...(payload.params || []));
      const result = await stmt.all();

      return Response.json({
        success: true,
        meta: result.meta,
        results: result.results
      }, { 
        headers: corsHeaders // <--- Crucial: Add headers to success response too
      });

    } catch (err) {
      return Response.json({
        success: false,
        error: err.message
      }, { 
        status: 200, 
        headers: corsHeaders 
      });
    }
  }
};

/**
 * Checks if the token matches the generated hash for NOW or NOW-30s
 */
async function verifyTimeToken(token, seed) {
  const encoder = new TextEncoder();
  const timeStep = 30; 
  const now = Math.floor(Date.now() / 1000);
  const currentSlot = Math.floor(now / timeStep);
  const previousSlot = currentSlot - 1; 

  const validNow = await generateHash(seed, currentSlot);
  const validPrev = await generateHash(seed, previousSlot);

  return (token === validNow || token === validPrev);
}

async function generateHash(seed, timeSlot) {
  const encoder = new TextEncoder();
  const dataToHash = seed + timeSlot.toString();
  const msgBuffer = encoder.encode(dataToHash);
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
  return [...new Uint8Array(hashBuffer)].map(b => b.toString(16).padStart(2, '0')).join('');
}
