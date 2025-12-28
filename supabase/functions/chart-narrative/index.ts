// Supabase Edge Function (Deno) — chart-narrative
// Generates a professional narrative per chart for a selected customer
// Inputs (POST JSON):
//   { customer_id: string|number, report_type: 'holdings'|'comp_value'|'comp_roi'|'comp_agr' }
// Output:
//   { text: string }   // clean paragraph; ready to render under chart and to export into PDF
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
// ---------- CORS ----------
const ALLOWED_ORIGIN = Deno.env.get("ALLOWED_ORIGIN") || "*";
function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "authorization, x-client-info, content-type",
    "Vary": "Origin",
    "Content-Type": "application/json"
  };
}
function json(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: corsHeaders()
  });
}
// ---------- ENV ----------
const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SERVICE_ROLE_KEY = Deno.env.get("SECRET_KEY");
const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
const OPENAI_MODEL = Deno.env.get("OPENAI_MODEL") || "gpt-4o-mini"; // pick your preferred model
if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error("Missing SUPABASE_URL or SERVICE_ROLE_KEY");
}
if (!OPENAI_API_KEY) {
  console.error("Missing OPENAI_API_KEY");
}
function iso(date) {
  if (!date) return null;
  try {
    return new Date(date).toISOString().slice(0, 10);
  } catch  {
    return null;
  }
}
function pct(n, digits = 0) {
  if (n == null || Number.isNaN(n)) return null;
  return `${Number(n).toFixed(digits)}%`;
}
function usd(n, digits = 0) {
  if (n == null || Number.isNaN(n)) return null;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: digits
  }).format(n);
}
function safeNum(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}
function strip(s) {
  return (s ?? "").toString().trim();
}
async function openAIChat(system, user) {
  const resp = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      temperature: 0.4,
      max_tokens: 450,
      messages: [
        {
          role: "system",
          content: system
        },
        {
          role: "user",
          content: user
        }
      ]
    })
  });
  if (!resp.ok) {
    const txt = await resp.text().catch(()=>String(resp.status));
    throw new Error(`OpenAI error ${resp.status}: ${txt}`);
  }
  const data = await resp.json();
  const text = data?.choices?.[0]?.message?.content?.toString()?.trim() || "";
  return text;
}
// ---------- Main ----------
Deno.serve(async (req)=>{
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: corsHeaders()
    });
  }
  if (req.method !== "POST") {
    return json({
      error: "Method not allowed"
    }, 405);
  }
  let body = {};
  try {
    body = await req.json();
  } catch  {
    return json({
      error: "Invalid JSON body"
    }, 400);
  }
  const customerId = strip(String(body.customer_id ?? ""));
  const reportType = strip(String(body.report_type ?? ""));
  if (!customerId) return json({
    error: "customer_id is required"
  }, 400);
  if (![
    "holdings",
    "comp_value",
    "comp_roi",
    "comp_agr"
  ].includes(reportType)) {
    return json({
      error: "report_type must be one of holdings|comp_value|comp_roi|comp_agr"
    }, 400);
  }
  if (!OPENAI_API_KEY) {
    return json({
      error: "OPENAI_API_KEY not configured on server"
    }, 500);
  }
  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: {
      persistSession: false
    },
    global: {
      headers: {
        "x-fn": "chart-narrative"
      }
    }
  });
  try {
    // ---------- Pull customer name (optional for tone/context) ----------
    const { data: cust, error: custErr } = await supabase.from("customer_details").select("first_names, last_name").eq("customer_id", customerId).maybeSingle();
    if (custErr) console.warn("customer_details err", custErr);
    const custName = [
      strip(cust?.first_names),
      strip(cust?.last_name)
    ].filter(Boolean).join(" ");
    // ---------- Fetch latest transactional scope (dates) ----------
    // We'll use the ADV series to anchor the period; for comp charts also look at STD.
    const advFirst = await supabase.from("adv_dca_customer_transactions").select("transaction_date").eq("customer_id", customerId).order("transaction_date", {
      ascending: true
    }).limit(1).maybeSingle();
    const advLast = await supabase.from("adv_dca_customer_transactions").select("transaction_date,total_dca_invested_usd,portfolio_value_usd,total_roi_percent,cagr_percent").eq("customer_id", customerId).order("transaction_date", {
      ascending: false
    }).limit(1).maybeSingle();
    let startDate = iso(advFirst.data?.transaction_date) || null;
    let endDate = iso(advLast.data?.transaction_date) || null;
    let stdLast = null;
    if (reportType !== "holdings") {
      const res = await supabase.from("std_dca_customer_transactions").select("transaction_date,portfolio_value_usd,total_roi_percent,cagr_percent").eq("customer_id", customerId).order("transaction_date", {
        ascending: false
      }).limit(1).maybeSingle();
      stdLast = res.data || null;
      // widen the window if STD has a later end
      const stdEnd = iso(res.data?.transaction_date);
      if (stdEnd && (!endDate || stdEnd > endDate)) endDate = stdEnd;
      if (!startDate) {
        // If adv has no data but std does, backfill start with std's first
        const stdFirst = await supabase.from("std_dca_customer_transactions").select("transaction_date").eq("customer_id", customerId).order("transaction_date", {
          ascending: true
        }).limit(1).maybeSingle();
        startDate = iso(stdFirst.data?.transaction_date);
      }
    }
    // Safety guard
    if (!startDate || !endDate) {
      return json({
        text: "No transaction history available to generate a narrative."
      });
    }
    // ---------- Pull last-per-trading_year snapshots for concise KPIs ----------
    const { data: advSnaps } = await supabase.from("adv_yearly_snapshots").select("trading_year,transaction_date,btc_closing_price_usd,total_dca_invested_usd,portfolio_value_usd,closing_balance_usd,closing_balance_btc,total_roi_percent,cagr_percent").eq("customer_id", customerId).order("trading_year", {
      ascending: true
    });
    const { data: stdSnaps } = reportType === "holdings" ? {
      data: []
    } : await supabase.from("std_yearly_snapshots").select("trading_year,transaction_date,portfolio_value_usd,total_roi_percent,cagr_percent").eq("customer_id", customerId).order("trading_year", {
      ascending: true
    });
    // last ADV figures (overall)
    const advLastPV = safeNum(advLast.data?.portfolio_value_usd);
    const advLastROI = safeNum(advLast.data?.total_roi_percent);
    const advLastCAGR = safeNum(advLast.data?.cagr_percent);
    const advLastInvested = safeNum(advLast.data?.total_dca_invested_usd);
    // last STD figures where relevant
    const stdLastPV = reportType !== "holdings" ? safeNum(stdLast?.portfolio_value_usd) : null;
    const stdLastROI = reportType !== "holdings" ? safeNum(stdLast?.total_roi_percent) : null;
    const stdLastCAGR = reportType !== "holdings" ? safeNum(stdLast?.cagr_percent) : null;
    // ---------- Market context: BTC move over portfolio period ----------
    let btcStart = null;
    let btcEnd = null;
    {
      // Use daily_data table across [startDate, endDate]
      const firstDD = await supabase.from("daily_data").select("date_closing, btc_closing_price_usd").gte("date_closing", startDate).lte("date_closing", endDate).order("date_closing", {
        ascending: true
      }).limit(1).maybeSingle();
      const lastDD = await supabase.from("daily_data").select("date_closing, btc_closing_price_usd").gte("date_closing", startDate).lte("date_closing", endDate).order("date_closing", {
        ascending: false
      }).limit(1).maybeSingle();
      btcStart = safeNum(firstDD.data?.btc_closing_price_usd);
      btcEnd = safeNum(lastDD.data?.btc_closing_price_usd);
    }
    let btcChangePct = null;
    if (btcStart != null && btcEnd != null && btcStart !== 0) {
      btcChangePct = (btcEnd - btcStart) / btcStart * 100;
    }
    // ---------- Prompt prep ----------
    const kpis = {
      customer: custName || "the client",
      startDate,
      endDate,
      advLastPV: usd(advLastPV),
      advLastROI: pct(advLastROI),
      advLastCAGR: pct(advLastCAGR),
      advLastInvested: usd(advLastInvested),
      stdLastPV: stdLastPV != null ? usd(stdLastPV) : null,
      stdLastROI: stdLastROI != null ? pct(stdLastROI) : null,
      stdLastCAGR: stdLastCAGR != null ? pct(stdLastCAGR) : null,
      btcChangePct: btcChangePct != null ? `${btcChangePct.toFixed(0)}%` : null,
      tradingYears: (advSnaps || []).length
    };
    const system = `
You are a professional investment reporting assistant for a wealth management firm.
Write concise, client-friendly narratives (120–180 words), neutral and factual, with a supportive tone for long-term wealth building.
Do NOT give financial advice or recommendations. Avoid hype. Avoid jargon; explain terms in plain language if needed.
Tie portfolio results to broad market context (e.g., general BTC movement over the client's portfolio period).
When comparing Advanced vs Standard DCA, highlight differences fairly without superlatives.
Never invent numbers—only refer to figures passed in the prompt.
Return a single clean paragraph (no bullets, no markdown).
`.trim();
    const user = `
Client: ${kpis.customer}
Report type: ${reportType}
Portfolio period: ${kpis.startDate ?? "N/A"} to ${kpis.endDate ?? "N/A"}
Years in portfolio (trading_year count): ${kpis.tradingYears}

Advanced DCA latest KPIs:
- Portfolio Value: ${kpis.advLastPV ?? "N/A"}
- Total ROI: ${kpis.advLastROI ?? "N/A"}
- Annualised CAGR: ${kpis.advLastCAGR ?? "N/A"}
- Total Contributions: ${kpis.advLastInvested ?? "N/A"}

Standard DCA latest KPIs (if applicable):
- Portfolio Value: ${kpis.stdLastPV ?? "N/A"}
- Total ROI: ${kpis.stdLastROI ?? "N/A"}
- Annualised CAGR: ${kpis.stdLastCAGR ?? "N/A"}

Market context (BTC over same period): ${kpis.btcChangePct ?? "N/A"} change.

Guidance for the specific chart:
- holdings: Summarise how contributions, BTC price, balances and value evolved; connect to market context.
- comp_value: Compare ending portfolio values (Advanced vs Standard) and fairly note the gap.
- comp_roi: Compare total ROI figures; briefly note pattern and gap without overclaiming.
- comp_agr: Compare annualised growth (CAGR); explain what CAGR represents in plain language.

Write 120–180 words, professional, supportive, no advice.
`.trim();
    // ---------- Call OpenAI ----------
    const text = await openAIChat(system, user);
    // ---------- Return ----------
    return json({
      text
    });
  } catch (err) {
    console.error("chart-narrative failed:", err);
    return json({
      error: err.message || "Internal error"
    }, 500);
  }
});
