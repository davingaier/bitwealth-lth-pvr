// Temporary edge function to debug personal subaccount transaction types
// Query VALR transaction history for subaccount 1419286489401798656

const valrApiKey = Deno.env.get("VALR_API_KEY");
const valrApiSecret = Deno.env.get("VALR_API_SECRET");

// VALR API: Sign request with HMAC SHA-512
async function signVALR(
  timestamp: string,
  method: string,
  path: string,
  body: string = "",
  subaccountId: string = ""
): Promise<string> {
  const payload = timestamp + method.toUpperCase() + path + body + subaccountId;
  const encoder = new TextEncoder();
  const keyData = encoder.encode(valrApiSecret);
  const messageData = encoder.encode(payload);
  
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    keyData,
    { name: "HMAC", hash: "SHA-512" },
    false,
    ["sign"]
  );
  
  const signature = await crypto.subtle.sign("HMAC", cryptoKey, messageData);
  return Array.from(new Uint8Array(signature))
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");
}

// Query VALR transaction history
async function getTransactionHistory(subaccountId: string, skip: number = 0, limit: number = 100): Promise<any[]> {
  const path = `/v1/account/transactionhistory?skip=${skip}&limit=${limit}`;
  const timestamp = Date.now().toString();
  const signature = await signVALR(timestamp, "GET", path, "", subaccountId);
  
  const response = await fetch(`https://api.valr.com${path}`, {
    method: "GET",
    headers: {
      "X-VALR-API-KEY": valrApiKey!,
      "X-VALR-SIGNATURE": signature,
      "X-VALR-TIMESTAMP": timestamp,
      "X-VALR-SUB-ACCOUNT-ID": subaccountId
    }
  });
  
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`VALR API error: ${response.status} ${errorText}`);
  }
  
  return await response.json();
}

Deno.serve(async () => {
  const subaccountId = "1419286489401798656";
  
  try {
    console.log(`Querying VALR transaction history for subaccount ${subaccountId}...`);
    const transactions = await getTransactionHistory(subaccountId);
    
    // Group by transaction type
    const typeGroups = new Map<string, number>();
    const samplesByType = new Map<string, any>();
    
    for (const tx of transactions) {
      const txType = tx.transactionType?.type || "UNKNOWN";
      typeGroups.set(txType, (typeGroups.get(txType) || 0) + 1);
      
      // Keep first sample of each type
      if (!samplesByType.has(txType)) {
        samplesByType.set(txType, {
          id: tx.id,
          type: tx.transactionType?.type,
          description: tx.transactionType?.description,
          eventAt: tx.eventAt,
          creditValue: tx.creditValue,
          creditCurrency: tx.creditCurrency,
          debitValue: tx.debitValue,
          debitCurrency: tx.debitCurrency,
          additionalInfo: tx.additionalInfo
        });
      }
    }
    
    return new Response(JSON.stringify({
      success: true,
      subaccountId,
      transactionCount: transactions.length,
      transactionTypeSummary: Object.fromEntries(typeGroups),
      samplesByType: Object.fromEntries(samplesByType),
      allTransactions: transactions
    }, null, 2), {
      headers: { "Content-Type": "application/json" }
    });
    
  } catch (e) {
    console.error("Error:", e);
    return new Response(JSON.stringify({
      success: false,
      error: e.message
    }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }
});
