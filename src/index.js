export default {
  async fetch(request, env, ctx) {
    // --- CORS HEADERS (Required for Localhost) ---
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, X-Time-Token"
    };

    // 1. HANDLE PRE-FLIGHT (OPTIONS)
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    // --- CONFIGURATION ---
    const FAKE_ERROR = `
<br />
<b>Parse error</b>:  syntax error, unexpected '?' in <b>/var/www/html/libs/db_connect.php</b> on line <b>14</b><br />
`;

    // 2. GET CREDENTIALS
    const receivedToken = request.headers.get("X-Time-Token");
    const secretSeed = env.API_SECRET; 

    // --- 🔍 DEBUG LOGS (View in 'wrangler tail') ---
    // WARNING: Remove these lines before going to Production!
    console.log("================ DEBUG START ================");
    console.log("1. Secret from Env:", secretSeed ? `'${secretSeed}'` : "NULL (Check Secrets!)");
    console.log("2. Token from Client:", receivedToken);
    
    // Calculate Server Time
    const timeStep = 30; 
    const now = Math.floor(Date.now() / 1000);
    const currentSlot = Math.floor(now / timeStep);
    console.log("3. Server Time Slot:", currentSlot);

    // Calculate Expected Tokens
    const expectedNow = await generateHash(secretSeed || "", currentSlot);
    const expectedPrev = await generateHash(secretSeed || "", currentSlot - 1);
    
    console.log("4. Expected Token (Now):", expectedNow);
    console.log("5. Expected Token (Prev):", expectedPrev);

    if (receivedToken === expectedNow) console.log("✅ MATCH: Matched Current Time");
    else if (receivedToken === expectedPrev) console.log("✅ MATCH: Matched Previous Time (Lag)");
    else console.log("❌ FAIL: No Match found.");
    console.log("================ DEBUG END ================");
    // --------------------------------------------------

    // Helper for Stealth Response
    const returnStealth = () => new Response(FAKE_ERROR, { 
      status: 200, 
      headers: { "Content-Type": "text/html", ...corsHeaders } 
    });

    // 3. VALIDATION CHECKS
    if (!receivedToken || !secretSeed) {
       console.log("⛔ Blocked: Missing Token or Secret");
       return returnStealth();
    }

    // Check if token matches either slot
    if (receivedToken !== expectedNow && receivedToken !== expectedPrev) {
       console.log("⛔ Blocked: Invalid Token");
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
      }, { headers: corsHeaders });

    } catch (err) {
      console.log("⚠️ SQL Error:", err.message);
      return Response.json({
        success: false,
        error: err.message
      }, { status: 200, headers: corsHeaders });
    }
  }
};

/**
 * Creates SHA-256 Hash of "Seed + TimeSlot"
 */
async function generateHash(seed, timeSlot) {
  const encoder = new TextEncoder();
  const dataToHash = seed + timeSlot.toString();
  const msgBuffer = encoder.encode(dataToHash);
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
  return [...new Uint8Array(hashBuffer)].map(b => b.toString(16).padStart(2, '0')).join('');
}
