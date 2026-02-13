// Edge Function: ef_sync_valr_transactions
// Purpose: Sync VALR transaction history to detect deposits/withdrawals with ACTUAL amounts
// Replaces: ef_balance_reconciliation (which used cumulative balance differences - inaccurate)
// Flow: Query VALR transaction history → Create funding events → Trigger ledger posting
// Schedule: Every 30 minutes via pg_cron
// Deployed with: --no-verify-jwt (called by pg_cron)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { logAlert } from "../_shared/alerting.ts";

const supabaseUrl = Deno.env.get("SUPABASE_URL") || Deno.env.get("SB_URL");
const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const orgId = Deno.env.get("ORG_ID");
const valrApiKey = Deno.env.get("VALR_API_KEY");
const valrApiSecret = Deno.env.get("VALR_API_SECRET");

if (!supabaseUrl || !supabaseKey || !orgId || !valrApiKey || !valrApiSecret) {
  throw new Error("Missing required environment variables");
}

const supabase = createClient(supabaseUrl, supabaseKey, {
  db: { schema: "lth_pvr" }
});

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
  const hashArray = Array.from(new Uint8Array(signature));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Query VALR transaction history for subaccount
// Returns: deposits, withdrawals, fees, etc. with actual amounts and timestamps
async function getTransactionHistory(subaccountId: string, skip = 0, limit = 200) {
  const timestamp = Date.now().toString();
  const method = "GET";
  const path = `/v1/account/transactionhistory?skip=${skip}&limit=${limit}`;
  const signature = await signVALR(timestamp, method, path, "", subaccountId);

  const response = await fetch(`https://api.valr.com${path}`, {
    method: "GET",
    headers: {
      "X-VALR-API-KEY": valrApiKey,
      "X-VALR-SIGNATURE": signature,
      "X-VALR-TIMESTAMP": timestamp,
      "X-VALR-SUB-ACCOUNT-ID": subaccountId,
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`VALR API error: ${response.status} - ${errorText}`);
  }

  return await response.json();
}

Deno.serve(async (req) => {
  // CORS headers
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
      },
    });
  }

  const results = {
    scanned: 0,
    synced: 0,
    new_transactions: 0,
    errors: 0,
    details: [] as any[],
  };

  try {
    console.log("Starting VALR transaction sync...");
    console.log("Org ID:", orgId);

    // Get all active customers with exchange accounts
    const { data: customers, error: customerError } = await supabase.schema("public")
      .from("customer_details")
      .select("customer_id, first_names, last_name, email, customer_status")
      .eq("org_id", orgId)
      .eq("registration_status", "active");

    if (customerError) {
      console.error("Error loading customers:", customerError);
      throw new Error(`Customer query failed: ${customerError.message}`);
    }
    
    console.log(`Found ${customers?.length || 0} active customers`);

    if (!customers || customers.length === 0) {
      return new Response(
        JSON.stringify({ message: "No active customers to sync", results }),
        {
          headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
          },
        }
      );
    }

    const customerIds = customers.map(c => c.customer_id);

    // Get customer strategies and exchange accounts
    const { data: strategies, error: strategyError } = await supabase.schema("public")
      .from("customer_strategies")
      .select("customer_id, customer_strategy_id, exchange_account_id")
      .in("customer_id", customerIds)
      .not("exchange_account_id", "is", null);

    if (strategyError) {
      throw new Error(`Strategy query failed: ${strategyError.message}`);
    }

    const exchangeAccountIds = (strategies || []).map(s => s.exchange_account_id);
    const { data: accounts, error: accountError } = await supabase.schema("public")
      .from("exchange_accounts")
      .select("exchange_account_id, subaccount_id, label")
      .eq("exchange", "VALR")
      .in("exchange_account_id", exchangeAccountIds)
      .not("subaccount_id", "is", null);

    if (accountError) {
      throw new Error(`Account query failed: ${accountError.message}`);
    }

    console.log(`Found ${accounts?.length || 0} VALR accounts to sync`);

    // BUG FIX #4: Per-customer sinceDatetime with safety buffer
    // Build a map of last sync time per customer (instead of global)
    const customerLastSync = new Map<number, Date>();
    
    for (const account of accounts || []) {
      const strategy = strategies?.find(s => s.exchange_account_id === account.exchange_account_id);
      if (!strategy) continue;
      
      const customerId = strategy.customer_id;
      
      // Get last sync for THIS customer
      const { data: lastSync } = await supabase
        .from("exchange_funding_events")
        .select("occurred_at")
        .eq("customer_id", customerId)
        .like("idempotency_key", "VALR_TX_%")
        .order("occurred_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      
      // Add 1-hour safety buffer to catch late-reporting transactions
      const sinceDatetime = lastSync?.occurred_at
        ? new Date(new Date(lastSync.occurred_at).getTime() - 60 * 60 * 1000) // 1 hour before last sync
        : new Date(Date.now() - 72 * 60 * 60 * 1000); // 72 hours ago for first run
      
      customerLastSync.set(customerId, sinceDatetime);
    }

    console.log(`Per-customer sync windows configured for ${customerLastSync.size} customers`);

    // Process each account
    for (const account of accounts || []) {
      try {
        results.scanned++;

        // Find customer for this account
        const strategy = strategies?.find(s => s.exchange_account_id === account.exchange_account_id);
        if (!strategy) continue;

        const customer = customers.find(c => c.customer_id === strategy.customer_id);
        if (!customer) continue;
        
        const customerId = customer.customer_id;
        const customerName = `${customer.first_names} ${customer.last_name}`;
        const sinceDatetime = customerLastSync.get(customerId) || new Date(Date.now() - 72 * 60 * 60 * 1000);

        console.log(`Syncing ${customerName} (${account.label})`);
        console.log(`  Sync window: ${sinceDatetime.toISOString()} to ${new Date().toISOString()}`);

        // Query VALR transaction history
        const transactionsResponse = await getTransactionHistory(account.subaccount_id);
        
        // VALR API might return { transactions: [...] } or just [...]
        const transactions = Array.isArray(transactionsResponse) 
          ? transactionsResponse 
          : transactionsResponse.transactions || [];

        if (!transactions || transactions.length === 0) {
          console.log(`  No transactions found`);
          continue;
        }

        console.log(`  Found ${transactions.length} transactions`);

        // DEBUG: Log all transaction types we see (for understanding VALR's transaction taxonomy)
        const transactionTypeCounts = new Map<string, number>();
        const uniqueTransactionTypes = new Set<string>();
        for (const tx of transactions) {
          const txType = tx.transactionType?.type || "UNKNOWN";
          const txDesc = tx.transactionType?.description || "";
          const txKey = `${txType} (${txDesc})`;
          transactionTypeCounts.set(txKey, (transactionTypeCounts.get(txKey) || 0) + 1);
          
          // Log first occurrence of each transaction type with full details
          if (!uniqueTransactionTypes.has(txType)) {
            uniqueTransactionTypes.add(txType);
            console.log(`\n  📋 New Transaction Type: ${txType}`);
            console.log(`    Description: ${txDesc}`);
            console.log(`    Sample: debit=${tx.debitCurrency}/${tx.debitValue}, credit=${tx.creditCurrency}/${tx.creditValue}`);
            console.log(`    Additional: ${JSON.stringify(tx.additionalInfo || {})}`);
          }
        }
        console.log(`\n  Transaction type summary:`, Object.fromEntries(transactionTypeCounts));

        // Filter for funding-related transactions (deposits, withdrawals, conversions)
        // AND only include transactions after sinceDatetime
        // Transaction types handled:
        // - INTERNAL_TRANSFER: Main ↔ subaccount transfers (deposits/withdrawals)
        // - LIMIT_BUY/MARKET_BUY: ZAR → crypto conversions (deposits - charge platform fee)
        // - LIMIT_SELL/MARKET_SELL: Crypto → ZAR conversions (withdrawals - no fee)
        // - BLOCKCHAIN_RECEIVE: External crypto deposits (charge platform fee)
        // - BLOCKCHAIN_SEND: External crypto withdrawals (no fee)
        // - FIAT_DEPOSIT: ZAR deposits
        // - FIAT_WITHDRAWAL: ZAR withdrawals to bank account
        
        const fundingTransactions = transactions.filter((tx: any) => {
          const txTimestamp = new Date(tx.eventAt);
          const txType = tx.transactionType?.type;
          
          // Must be after last sync
          if (txTimestamp <= sinceDatetime) return false;
          
          // Include these transaction types:
          return [
            "INTERNAL_TRANSFER",    // Main ↔ subaccount
            "SIMPLE_BUY",          // ZAR deposit (before conversion)
            "LIMIT_BUY",           // ZAR → crypto conversion
            "MARKET_BUY",          // ZAR → crypto conversion
            "LIMIT_SELL",          // Crypto → ZAR conversion
            "MARKET_SELL",         // Crypto → ZAR conversion
            "SIMPLE_SELL",         // ZAR withdrawal (to bank) - legacy
            "FIAT_WITHDRAWAL",     // ZAR withdrawal (to bank) - current
            "FIAT_DEPOSIT",        // ZAR deposit (bank to subaccount)
            "BLOCKCHAIN_RECEIVE",  // External crypto deposit
            "BLOCKCHAIN_SEND"      // External crypto withdrawal
          ].includes(txType);
        });

        console.log(`  Filtered to ${fundingTransactions.length} funding transactions since ${sinceDatetime.toISOString()}`);
        console.log(`  Total from VALR: ${transactions.length}, After date filter: ${fundingTransactions.length}`);

        // DEBUG: For Davin's personal subaccount, log ALL transaction details to understand taxonomy
        if (account.subaccount_id === "1419286489401798656") {
          console.log(`\n=== DEBUG: Davin's subaccount - ALL ${transactions.length} transactions ===`);
          console.log(`Last sync time: ${sinceDatetime.toISOString()}`);
          for (const tx of transactions) {
            const txTime = new Date(tx.eventAt);
            const isAfterSync = txTime > sinceDatetime;
            console.log(`\nTransaction ${tx.id}:`);
            console.log(`  Type: ${tx.transactionType?.type} (${tx.transactionType?.description})`);
            console.log(`  Timestamp: ${tx.eventAt} | After sync: ${isAfterSync}`);
            console.log(`  Credit: ${tx.creditValue} ${tx.creditCurrency}`);
            console.log(`  Debit: ${tx.debitValue} ${tx.debitCurrency}`);
            console.log(`  Additional Info: ${JSON.stringify(tx.additionalInfo || {})}`);
          }
          console.log(`=== END DEBUG ===\n`);
        }

        let newTransactions = 0;

        for (const tx of fundingTransactions) {
          try {
            const transactionId = tx.id;
            const timestamp = tx.eventAt;
            const txType = tx.transactionType?.type;

            if (!transactionId || !timestamp) {
              console.warn(`  Skipping incomplete transaction:`, tx);
              continue;
            }

            // Convenience variables for cleaner code
            const customerId = customer.customer_id;
            const customerName = `${customer.first_names} ${customer.last_name}`;
            const transactedAt = new Date(timestamp);

            // Parse transaction amounts and currencies
            const creditValue = parseFloat(tx.creditValue || 0);
            const creditCurrency = tx.creditCurrency;
            const debitValue = parseFloat(tx.debitValue || 0);
            const debitCurrency = tx.debitCurrency;

            // Classify transaction and determine currency/amount
            let currency, amount, isDeposit, fundingKind, metadata = {};
            
            // ================================================================
            // ZAR DEPOSIT - FIAT_DEPOSIT or SIMPLE_BUY with creditCurrency="ZAR"
            // BUG FIX #1: Added FIAT_DEPOSIT detection (EFT deposits from bank)
            // ================================================================
            if ((txType === "FIAT_DEPOSIT" || txType === "SIMPLE_BUY") && creditCurrency === "ZAR") {
              // ZAR deposited into subaccount (before conversion to USDT)
              currency = "ZAR";
              amount = creditValue;
              isDeposit = true;
              fundingKind = "zar_deposit";
              console.log(`  💰 ZAR DEPOSIT (${txType}): R${amount} (awaiting conversion to USDT)`);
              
              // Log alert for admin notification
              await logAlert(
                supabase,
                "ef_sync_valr_transactions",
                "info",
                `ZAR deposit detected: R${amount.toFixed(2)} from ${customerName}`,
                {
                  customer_id: customerId,
                  customer_name: customerName,
                  zar_amount: amount,
                  transaction_id: transactionId,
                  transaction_type: txType,
                  occurred_at: transactedAt,
                },
                orgId,
                customerId
              );
            }
            // ================================================================
            // INTERNAL_TRANSFER - Main ↔ Subaccount
            // ================================================================
            else if (txType === "INTERNAL_TRANSFER") {
              // INTERNAL_TRANSFER can be bidirectional:
              // - INTO subaccount (creditValue > 0) = customer deposit (e.g., test deposits from main account)
              // - OUT OF subaccount (debitValue > 0) = could be either:
              //   a) Automated platform fee transfer (tracked in valr_transfer_log)
              //   b) Manual customer withdrawal (should record as withdrawal)
              if (creditValue > 0 && (creditCurrency === "BTC" || creditCurrency === "USDT")) {
                // Money coming INTO subaccount = DEPOSIT
                currency = creditCurrency;
                amount = creditValue;
                isDeposit = true;
                fundingKind = "deposit";
                console.log(`  💰 INTERNAL_TRANSFER IN (deposit): ${amount} ${currency}`);
              } else if (debitValue > 0 && (debitCurrency === "BTC" || debitCurrency === "USDT")) {
                // Money going OUT of subaccount - check if it's automated or manual
                // Query valr_transfer_log to see if this is an automated platform fee transfer
                const { data: transferLog, error: transferLogError } = await supabase
                  .from("valr_transfer_log")
                  .select("transfer_id")
                  .eq("customer_id", customerId)
                  .eq("currency", debitCurrency)
                  .eq("amount", debitValue.toFixed(8))
                  .gte("created_at", new Date(transactedAt.getTime() - 60000).toISOString()) // Within 1 minute
                  .lte("created_at", new Date(transactedAt.getTime() + 60000).toISOString())
                  .maybeSingle();
                
                if (transferLogError) {
                  console.error(`  Error querying valr_transfer_log:`, transferLogError);
                  throw transferLogError;
                }
                
                if (transferLog) {
                  // This is an automated platform fee transfer - skip (already tracked)
                  console.log(`  ⏭️  Skipping INTERNAL_TRANSFER OUT (automated fee transfer ${transferLog.transfer_id}): ${transactionId}`);
                  continue;
                } else {
                  // This is a manual customer withdrawal - record it
                  currency = debitCurrency;
                  amount = debitValue;
                  isDeposit = false; // No platform fee on withdrawals
                  fundingKind = "withdrawal";
                  console.log(`  💸 INTERNAL_TRANSFER OUT (customer withdrawal): ${amount} ${currency}`);
                  
                  // Log alert for admin notification
                  await logAlert(
                    supabase,
                    "ef_sync_valr_transactions",
                    "info",
                    `${currency} withdrawal: ${customerName} withdrew ${amount} ${currency}`,
                    {
                      customer_id: customerId,
                      customer_name: customerName,
                      amount: amount,
                      currency: currency,
                      transaction_id: transactionId,
                      occurred_at: transactedAt,
                    },
                    orgId,
                    customerId
                  );
                }
              } else {
                console.warn(`  Skipping unexpected INTERNAL_TRANSFER:`, tx);
                continue;
              }
            }
            // ================================================================
            // ZAR→USDT CONVERSION - LIMIT_BUY/MARKET_BUY/SIMPLE_BUY with debitCurrency="ZAR"
            // BUG FIX #2: Added SIMPLE_BUY detection (instant buy transactions)
            // ================================================================
            else if (txType === "LIMIT_BUY" || txType === "MARKET_BUY" || txType === "SIMPLE_BUY") {
              // ZAR → crypto conversion (customer adding capital)
              if (debitCurrency === "ZAR" && (creditCurrency === "BTC" || creditCurrency === "USDT")) {
                // Received crypto by spending ZAR = DEPOSIT (charge platform fee)
                currency = creditCurrency;
                amount = creditValue;
                isDeposit = true;
                fundingKind = "deposit";
                
                // Look up matching ZAR deposit from today to link
                const startOfDay = new Date(transactedAt);
                startOfDay.setHours(0, 0, 0, 0);
                
                const { data: zarDeposit } = await supabase
                  .from("exchange_funding_events")
                  .select("funding_id, amount")
                  .eq("customer_id", customerId)
                  .eq("kind", "zar_deposit")
                  .gte("occurred_at", startOfDay.toISOString())
                  .order("occurred_at", { ascending: false })
                  .limit(1)
                  .maybeSingle();
                
                // Store conversion metadata
                metadata = {
                  zar_amount: debitValue,
                  conversion_rate: debitValue / creditValue,
                  conversion_fee_zar: parseFloat(tx.feeValue || 0),
                  conversion_fee_asset: tx.feeCurrency || "",
                };
                
                if (zarDeposit) {
                  metadata.zar_deposit_id = zarDeposit.funding_id;
                  console.log(`  🔄 ZAR→${currency} CONVERSION: R${debitValue} → ${amount} ${currency} (linked to zar_deposit ${zarDeposit.funding_id})`);
                } else {
                  console.log(`  🔄 ZAR→${currency} CONVERSION: R${debitValue} → ${amount} ${currency} (no zar_deposit found to link)`);
                }
              } else if ((debitCurrency === "BTC" || debitCurrency === "USDT") && 
                         (creditCurrency === "BTC" || creditCurrency === "USDT")) {
                // BTC ↔ USDT trade - SKIP (already tracked in exchange_orders)
                console.log(`  Skipping BTC↔USDT trade (already tracked): ${transactionId}`);
                continue;
              } else {
                console.warn(`  Skipping unexpected BUY transaction:`, tx);
                continue;
              }
            }
            // ================================================================
            // USDT→ZAR CONVERSION - LIMIT_SELL/MARKET_SELL with debitCurrency="USDT", creditCurrency="ZAR"
            // ================================================================
            else if (txType === "LIMIT_SELL" || txType === "MARKET_SELL") {
              if ((debitCurrency === "BTC" || debitCurrency === "USDT") && creditCurrency === "ZAR") {
                // Sold crypto for ZAR - Create TWO funding events:
                // 1. Crypto withdrawal (to reduce crypto balance)
                // 2. ZAR balance (to track ZAR ready for bank withdrawal)
                
                console.log(`  🔄 ${debitCurrency}→ZAR CONVERSION: ${debitValue} ${debitCurrency} → R${creditValue}`);
                
                // FIRST: Record the crypto withdrawal (USDT/BTC out)
                const cryptoIdempotencyKey = `VALR_TX_${transactionId}_CRYPTO_OUT`;
                const { data: existingCrypto, error: cryptoCheckErr } = await supabase
                  .from("exchange_funding_events")
                  .select("funding_id")
                  .eq("idempotency_key", cryptoIdempotencyKey)
                  .maybeSingle();
                
                if (cryptoCheckErr) {
                  console.error(`  Error checking idempotency for crypto withdrawal:`, cryptoCheckErr);
                  throw cryptoCheckErr;
                }
                
                if (!existingCrypto) {
                  const { error: cryptoInsertErr } = await supabase
                    .from("exchange_funding_events")
                    .insert({
                      org_id: orgId,
                      customer_id: customerId,
                      exchange_account_id: account.exchange_account_id,
                      kind: "withdrawal",
                      asset: debitCurrency,
                      amount: -debitValue,  // Negative = withdrawal
                      ext_ref: transactionId,
                      occurred_at: new Date(timestamp).toISOString(),
                      idempotency_key: cryptoIdempotencyKey,
                      metadata: {
                        conversion_to: "ZAR",
                        zar_amount: creditValue,
                        conversion_rate: creditValue / debitValue,
                        conversion_fee_value: parseFloat(tx.feeValue || 0),
                        conversion_fee_asset: tx.feeCurrency || "",
                      },
                    });
                  
                  if (cryptoInsertErr) {
                    console.error(`  Error creating crypto withdrawal for conversion:`, cryptoInsertErr);
                    results.errors++;
                  } else {
                    console.log(`  ✅ Created ${debitCurrency} withdrawal: -${debitValue} ${debitCurrency}`);
                    newTransactions++;
                  }
                }
                
                // SECOND: Record the ZAR balance (ZAR in) - using existing flow below
                currency = "ZAR";
                amount = creditValue;
                isDeposit = true;  // ZAR coming INTO subaccount
                fundingKind = "zar_balance";
                
                // Store conversion metadata
                metadata = {
                  conversion_from: debitCurrency,
                  crypto_amount: debitValue,
                  conversion_rate: creditValue / debitValue,
                  conversion_fee_value: parseFloat(tx.feeValue || 0),
                  conversion_fee_asset: tx.feeCurrency || "",
                };
                
                // Log alert for admin notification
                await logAlert(
                  supabase,
                  "ef_sync_valr_transactions",
                  "info",
                  `${debitCurrency}→ZAR conversion: ${customerName} converted ${debitValue} ${debitCurrency} to R${amount.toFixed(2)}`,
                  {
                    customer_id: customerId,
                    customer_name: customerName,
                    crypto_amount: debitValue,
                    crypto_asset: debitCurrency,
                    zar_amount: amount,
                    transaction_id: transactionId,
                    occurred_at: transactedAt,
                  },
                  orgId,
                  customerId
                );
              } else if ((debitCurrency === "BTC" || debitCurrency === "USDT") && 
                         (creditCurrency === "BTC" || creditCurrency === "USDT")) {
                // BTC ↔ USDT trade - SKIP (already tracked in exchange_orders)
                console.log(`  Skipping BTC↔USDT trade (already tracked): ${transactionId}`);
                continue;
              } else {
                console.warn(`  Skipping unexpected SELL transaction:`, tx);
                continue;
              }
            }
            // ================================================================
            // ZAR WITHDRAWAL - FIAT_WITHDRAWAL or SIMPLE_SELL with debitCurrency="ZAR"
            // ================================================================
            else if ((txType === "FIAT_WITHDRAWAL" || txType === "SIMPLE_SELL") && debitCurrency === "ZAR") {
              // ZAR withdrawn from subaccount to bank account
              currency = "ZAR";
              amount = debitValue;
              isDeposit = false;
              fundingKind = "zar_withdrawal";
              console.log(`  💸 ZAR WITHDRAWAL: R${amount} (to bank account)`);
              
              // Log alert for admin notification
              await logAlert(
                supabase,
                "ef_sync_valr_transactions",
                "info",
                `ZAR withdrawal: R${amount.toFixed(2)} sent to ${customerName}'s bank account`,
                {
                  customer_id: customerId,
                  customer_name: customerName,
                  zar_amount: amount,
                  transaction_id: transactionId,
                  occurred_at: transactedAt,
                  bank_name: tx.additionalInfo?.bankName,
                  withdrawal_id: tx.additionalInfo?.withdrawalId,
                },
                orgId,
                customerId
              );
            }
            // ================================================================
            // BLOCKCHAIN_RECEIVE - External crypto deposits
            // ================================================================
            else if (txType === "BLOCKCHAIN_RECEIVE") {
              // External crypto deposit from customer's wallet
              if (creditValue > 0 && (creditCurrency === "BTC" || creditCurrency === "USDT")) {
                currency = creditCurrency;
                amount = creditValue;
                isDeposit = true; // Charge platform fee
              } else {
                console.warn(`  Skipping BLOCKCHAIN_RECEIVE with no BTC/USDT:`, tx);
                continue;
              }
            }
            else if (txType === "BLOCKCHAIN_SEND") {
              // External crypto withdrawal to customer's wallet
              if (debitValue > 0 && (debitCurrency === "BTC" || debitCurrency === "USDT")) {
                currency = debitCurrency;
                amount = debitValue;
                isDeposit = false; // No platform fee, just track
              } else {
                console.warn(`  Skipping BLOCKCHAIN_SEND with no BTC/USDT:`, tx);
                continue;
              }
            }
            else {
              console.warn(`  Skipping unknown transaction type: ${txType}`);
              continue;
            }

            // Check if we've already processed this transaction
            const idempotencyKey = `VALR_TX_${transactionId}`;
            const { data: existing, error: idempError } = await supabase
              .from("exchange_funding_events")
              .select("funding_id")
              .eq("idempotency_key", idempotencyKey)
              .maybeSingle();

            if (idempError) {
              console.error(`  Error checking idempotency for tx ${transactionId}:`, idempError);
              throw idempError;
            }

            if (existing) {
              // Already processed
              console.log(`  ⏭️  Skipping already processed tx: ${transactionId}`);
              continue;
            }

            // Determine kind (deposit or withdrawal) and ensure amount has correct sign
            // VALR API: creditAmount = positive (deposit), debitAmount = positive (withdrawal)
            // Use explicit fundingKind if set (zar_deposit, zar_balance, zar_withdrawal), otherwise infer
            if (!fundingKind) {
              fundingKind = isDeposit ? "deposit" : "withdrawal";
            }
            const signedAmount = isDeposit ? Math.abs(amount) : -Math.abs(amount);

            // Create funding event
            const { error: insertError } = await supabase
              .from("exchange_funding_events")
              .insert({
                org_id: orgId,
                customer_id: customer.customer_id,
                exchange_account_id: account.exchange_account_id,
                kind: fundingKind,
                asset: currency,
                amount: signedAmount,
                ext_ref: transactionId,
                occurred_at: new Date(timestamp).toISOString(),
                idempotency_key: idempotencyKey,
                metadata: Object.keys(metadata).length > 0 ? metadata : {},
              });

            if (insertError) {
              console.error(`  Error creating funding event for tx ${transactionId}:`, insertError);
              results.errors++;
            } else {
              console.log(`  ✅ Created funding event: ${fundingKind} ${amount} ${currency}`);
              newTransactions++;

              // Send email notification for deposits (only for ACTIVE customers, not first deposit)
              if (isDeposit && customer.customer_status === "Active" && customer.email) {
                try {
                  const depositDate = new Date(timestamp).toLocaleDateString("en-ZA", { 
                    year: "numeric", 
                    month: "long", 
                    day: "numeric" 
                  });

                  const emailResponse = await fetch(`${supabaseUrl}/functions/v1/ef_send_email`, {
                    method: "POST",
                    headers: {
                      "Content-Type": "application/json",
                      "Authorization": `Bearer ${supabaseKey}`,
                    },
                    body: JSON.stringify({
                      template_key: "subsequent_deposit_notification",
                      to_email: customer.email,
                      data: {
                        first_name: customer.first_names,
                        amount: Math.abs(amount).toFixed(8),
                        asset: currency,
                        deposit_date: depositDate,
                        portal_url: "https://bitwealth.co.za/customer-portal.html",
                        website_url: "https://bitwealth.co.za",
                        to_email: customer.email,
                      },
                    }),
                  });

                  if (emailResponse.ok) {
                    console.log(`  📧 Sent deposit notification email to ${customer.email}`);
                  } else {
                    console.error(`  Failed to send deposit email: ${await emailResponse.text()}`);
                  }
                } catch (emailError) {
                  console.error(`  Error sending deposit email:`, emailError);
                }
              }
            }

          } catch (txError) {
            console.error(`  Error processing transaction:`, txError);
            results.errors++;
          }
        }

        results.synced++;
        results.new_transactions += newTransactions;

        results.details.push({
          customer_id: customer.customer_id,
          customer_name: `${customer.first_names} ${customer.last_name}`,
          transactions_found: transactions.length,
          funding_transactions: fundingTransactions.length,
          new_transactions: newTransactions,
        });

      } catch (error) {
        console.error(`Error processing account ${account.label}:`, error);
        results.errors++;
        results.details.push({
          account_id: account.exchange_account_id,
          account_label: account.label,
          error: String(error),
        });
      }
    }

    console.log("VALR transaction sync complete:", results);

    // If any new transactions were synced, trigger ledger posting
    if (results.new_transactions > 0) {
      console.log(`Triggering ef_post_ledger_and_balances to process ${results.new_transactions} new transaction(s)...`);
      try {
        const ledgerResponse = await fetch(`${supabaseUrl}/functions/v1/ef_post_ledger_and_balances`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${supabaseKey}`,
          },
          body: JSON.stringify({}),
        });

        if (ledgerResponse.ok) {
          const ledgerResult = await ledgerResponse.json();
          console.log("Ledger posting completed:", ledgerResult);
        } else {
          console.error("Ledger posting failed:", await ledgerResponse.text());
        }
      } catch (ledgerError) {
        console.error("Error triggering ledger posting:", ledgerError);
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: "VALR transaction sync complete",
        results
      }),
      {
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
        },
      }
    );

  } catch (error) {
    console.error("Fatal error in VALR transaction sync:", error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    return new Response(
      JSON.stringify({
        success: false,
        error: errorMessage,
        stack: error instanceof Error ? error.stack : undefined,
        results
      }),
      {
        status: 500,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
        },
      }
    );
  }
});
