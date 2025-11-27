export default {
  async fetch(request, env, ctx) {
    // --- CONFIGURATION ---
    // The "Stealth" response (Fake PHP Error)
    const FAKE_ERROR = `
<br />
<b>Parse error</b>:  syntax error, unexpected '?' in <b>/var/www/html/libs/db_connect.php</b> on line <b>14</b><br />
`;

    // 1. GET THE TOKEN & SECRET
    // ------------------------------------------------
    const receivedToken = request.headers.get("X-Time-Token");
    
    // IMPORTANT: 'API_SECRET' must be set via `wrangler secret put API_SECRET`
    const secretSeed = env.API_SECRET; 

    // If no secret is configured or no token sent, show fake error
    if (!receivedToken || !secretSeed) {
       return new Response(FAKE_ERROR, { status: 200, headers: { "Content-Type": "text/html" } });
    }

    // 2. VERIFY TIME-BASED TOKEN (TOTP Logic)
    // ------------------------------------------------
    // We check current window (now) and previous window (30s ago) to handle network lag
    const isValid = await verifyTimeToken(receivedToken, secretSeed);

    if (!isValid) {
       // STEALTH MODE: Wrong time or wrong key = Fake Error
       // Log strictly to internal logs (optional)
       console.log(`⛔ Failed Access Attempt. Token: ${receivedToken}`);
       return new Response(FAKE_ERROR, { status: 200, headers: { "Content-Type": "text/html" } });
    }

    // 3. EXECUTE SQL (Only if Valid)
    // ------------------------------------------------
    // Only allow POST requests
    if (request.method !== "POST") {
      return new Response(FAKE_ERROR, { headers: { "Content-Type": "text/html" } });
    }

    try {
      const payload = await request.json();
      
      if (!payload.sql) {
        return Response.json({ success: false, error: "Missing SQL" }, { status: 400 });
      }

      // Execute on D1
      // We bind params if they exist, otherwise empty array
      const stmt = env.DB.prepare(payload.sql).bind(...(payload.params || []));
      const result = await stmt.all();

      return Response.json({
        success: true,
        meta: result.meta,
        results: result.results
      });

    } catch (err) {
      // 4. ERROR PASSTHROUGH
      // Return actual DB errors (like syntax error) to the authorized client
      return Response.json({
        success: false,
        error: err.message
      }, { status: 200 });
    }
  }
};

/**
 * Checks if the token matches the generated hash for NOW or NOW-30s
 * @param {string} token - The token received from client
 * @param {string} seed - The shared secret
 */
async function verifyTimeToken(token, seed) {
  // Calculate Time Slot (30 second windows)
  const timeStep = 30; 
  const now = Math.floor(Date.now() / 1000);
  const currentSlot = Math.floor(now / timeStep);
  const previousSlot = currentSlot - 1; // Allow 30s drift for slow networks

  // Generate valid hashes for both slots
  const validNow = await generateHash(seed, currentSlot);
  const validPrev = await generateHash(seed, previousSlot);

  // Check if token matches either valid slot
  return (token === validNow || token === validPrev);
}

/**
 * Creates SHA-256 Hash of "Seed + TimeSlot"
 */
async function generateHash(seed, timeSlot) {
  const encoder = new TextEncoder();
  const dataToHash = seed + timeSlot.toString();
  
  const msgBuffer = encoder.encode(dataToHash);
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
  
  // Convert ArrayBuffer to Hex String
  return [...new Uint8Array(hashBuffer)]
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}
