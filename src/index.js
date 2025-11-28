export default {
  async fetch(request, env, ctx) {
    // --- CORS HEADERS (So Localhost works) ---
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, X-Timestamp, X-Signature"
    };

    if (request.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

    // --- CONFIGURATION ---
    // The "Stealth" Fake PHP Error
    const FAKE_ERROR = `<br /><b>Parse error</b>:  syntax error, unexpected '?' in <b>/var/www/html/libs/db_connect.php</b> on line <b>14</b><br />`;
    
    const returnStealth = () => new Response(FAKE_ERROR, { 
      status: 200, 
      headers: { "Content-Type": "text/html", ...corsHeaders } 
    });

    // 1. GET HEADERS
    const clientTimestamp = request.headers.get("X-Timestamp"); 
    const clientSignature = request.headers.get("X-Signature"); 
    const secret = env.API_SECRET;

    // 2. VALIDATE HEADERS EXIST
    if (!clientTimestamp || !clientSignature || !secret) {
        return returnStealth();
    }

    // 3. CHECK TIME DRIFT (The "Timezone" Fix)
    // We allow a massive +/- 2 minute difference (120,000ms)
    const serverTime = Date.now();
    const clientTime = parseInt(clientTimestamp, 10);
    const diff = Math.abs(serverTime - clientTime);

    // If your clock is more than 2 minutes wrong, block it.
    if (isNaN(clientTime) || diff > 120000) { 
        console.log(`⛔ Blocked: Time difference is ${diff}ms (Too large)`);
        return returnStealth();
    }

    // 4. VERIFY SIGNATURE
    // We calculate hash using THE CLIENT'S TIMESTAMP. 
    // This ensures the math always matches, regardless of server time.
    const expectedSignature = await generateHash(secret, clientTimestamp);

    if (clientSignature !== expectedSignature) {
        console.log("⛔ Blocked: Invalid Signature (Wrong Secret?)");
        return returnStealth();
    }

    // 5. EXECUTE SQL
    if (request.method !== "POST") return returnStealth();

    try {
      const payload = await request.json();
      const stmt = env.DB.prepare(payload.sql).bind(...(payload.params || []));
      const result = await stmt.all();

      return Response.json({ success: true, meta: result.meta, results: result.results }, { headers: corsHeaders });
    } catch (err) {
      return Response.json({ success: false, error: err.message }, { status: 200, headers: corsHeaders });
    }
  }
};

// Hash Function (SHA256)
async function generateHash(secret, timestamp) {
  const encoder = new TextEncoder();
  const dataToHash = secret + timestamp; 
  const msgBuffer = encoder.encode(dataToHash);
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
  return [...new Uint8Array(hashBuffer)].map(b => b.toString(16).padStart(2, '0')).join('');
}
