// ef_generate_statement/index.ts
// Purpose: Generate monthly statement PDF for customer
// Input: { customer_id: number, year: number, month: number }
// Output: PDF blob

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { jsPDF } from "npm:jspdf@2.5.1";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? Deno.env.get("SB_URL");
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS });
  }

  try {
    const { customer_id, year, month } = await req.json();

    if (!customer_id || !year || !month) {
      return new Response(
        JSON.stringify({ error: "Missing required parameters: customer_id, year, month" }),
        { status: 400, headers: { ...CORS, "Content-Type": "application/json" } }
      );
    }

    // Initialize Supabase client
    const supabase = createClient(SUPABASE_URL!, SERVICE_ROLE_KEY!, {
      db: { schema: "lth_pvr" },
    });

    // Get customer details
    const { data: customer, error: customerError } = await supabase
      .schema("public")
      .from("customer_details")
      .select("*")
      .eq("customer_id", customer_id)
      .single();

    if (customerError || !customer) {
      return new Response(
        JSON.stringify({ error: "Customer not found" }),
        { status: 404, headers: { ...CORS, "Content-Type": "application/json" } }
      );
    }

    // Get portfolio details
    const { data: portfolios, error: portfolioError } = await supabase
      .schema("public")
      .from("customer_portfolios")
      .select("*")
      .eq("customer_id", customer_id);

    if (portfolioError || !portfolios || portfolios.length === 0) {
      return new Response(
        JSON.stringify({ error: "Portfolio not found" }),
        { status: 404, headers: { ...CORS, "Content-Type": "application/json" } }
      );
    }

    const portfolio = portfolios[0];

    // Calculate date range for the month
    const startDate = new Date(year, month - 1, 1);
    const endDate = new Date(year, month, 0); // Last day of month
    const startDateStr = startDate.toISOString().split("T")[0];
    const endDateStr = endDate.toISOString().split("T")[0];

    // Get opening balance (last day of previous month)
    const prevMonthEnd = new Date(year, month - 1, 0).toISOString().split("T")[0];
    const { data: openingBalance } = await supabase
      .from("balances_daily")
      .select("*")
      .eq("customer_id", customer_id)
      .eq("date", prevMonthEnd)
      .single();

    // Get closing balance (last day of current month)
    const { data: closingBalance } = await supabase
      .from("balances_daily")
      .select("*")
      .eq("customer_id", customer_id)
      .eq("date", endDateStr)
      .single();

    // Get transactions for the month
    const { data: transactions } = await supabase
      .from("ledger_lines")
      .select("*")
      .eq("customer_id", customer_id)
      .gte("trade_date", startDateStr)
      .lte("trade_date", endDateStr)
      .order("trade_date", { ascending: true });

    // Get benchmark data (Standard DCA)
    const { data: stdDcaBalances } = await supabase
      .schema("lth_pvr")
      .from("std_dca_balances_daily")
      .select("*")
      .eq("customer_id", customer_id)
      .gte("date", startDateStr)
      .lte("date", endDateStr)
      .order("date", { ascending: true });

    // Generate PDF
    const doc = new jsPDF();
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    let yPosition = 20;

    // Header
    doc.setFontSize(20);
    doc.setFont(undefined, "bold");
    doc.text("BitWealth", 15, yPosition);
    doc.setFontSize(10);
    doc.setFont(undefined, "normal");
    doc.text("Investment Dashboard", 15, yPosition + 5);

    // Customer info (right-aligned)
    doc.setFontSize(10);
    const customerName = `${customer.first_names} ${customer.last_name}`;
    doc.text(customerName, pageWidth - 15, yPosition, { align: "right" });
    doc.text(`Customer ID: ${customer_id}`, pageWidth - 15, yPosition + 5, { align: "right" });
    doc.text(`Statement Period: ${month}/${year}`, pageWidth - 15, yPosition + 10, { align: "right" });

    yPosition += 25;

    // Horizontal line
    doc.setLineWidth(0.5);
    doc.line(15, yPosition, pageWidth - 15, yPosition);
    yPosition += 10;

    // Performance Summary Section
    doc.setFontSize(14);
    doc.setFont(undefined, "bold");
    doc.text("Performance Summary", 15, yPosition);
    yPosition += 8;

    doc.setFontSize(10);
    doc.setFont(undefined, "normal");

    const openingNav = openingBalance ? parseFloat(openingBalance.nav_usd) : 0;
    const closingNav = closingBalance ? parseFloat(closingBalance.nav_usd) : 0;
    const netChange = closingNav - openingNav;
    const percentChange = openingNav > 0 ? ((netChange / openingNav) * 100) : 0;

    // Calculate total contributions for the month
    const totalContributions = transactions
      ? transactions.filter((tx: any) => tx.kind === "deposit" || tx.kind === "topup")
          .reduce((sum: number, tx: any) => sum + parseFloat(tx.amount_usdt || 0), 0)
      : 0;

    doc.text(`Opening Balance (${prevMonthEnd}): $${openingNav.toFixed(2)}`, 20, yPosition);
    yPosition += 6;
    doc.text(`Closing Balance (${endDateStr}): $${closingNav.toFixed(2)}`, 20, yPosition);
    yPosition += 6;
    doc.text(`Contributions this month: $${totalContributions.toFixed(2)}`, 20, yPosition);
    yPosition += 6;
    doc.text(`Net Change: ${netChange >= 0 ? "+" : ""}$${netChange.toFixed(2)} (${percentChange >= 0 ? "+" : ""}${percentChange.toFixed(2)}%)`, 20, yPosition);
    yPosition += 6;

    if (closingBalance) {
      doc.text(`BTC Balance: ${parseFloat(closingBalance.btc_balance).toFixed(8)} BTC`, 20, yPosition);
      yPosition += 6;
      doc.text(`USDT Balance: $${parseFloat(closingBalance.usdt_balance).toFixed(2)}`, 20, yPosition);
      yPosition += 10;
    }

    // Transactions Section
    doc.setFontSize(14);
    doc.setFont(undefined, "bold");
    doc.text("Transaction History", 15, yPosition);
    yPosition += 8;

    doc.setFontSize(9);
    doc.setFont(undefined, "normal");

    if (!transactions || transactions.length === 0) {
      doc.text("No transactions this month", 20, yPosition);
      yPosition += 10;
    } else {
      // Table headers
      doc.setFont(undefined, "bold");
      doc.text("Date", 20, yPosition);
      doc.text("Type", 50, yPosition);
      doc.text("BTC", 80, yPosition);
      doc.text("USDT", 110, yPosition);
      doc.text("Fee", 140, yPosition);
      yPosition += 6;
      doc.setFont(undefined, "normal");

      // Table rows
      for (const tx of transactions) {
        if (yPosition > pageHeight - 30) {
          doc.addPage();
          yPosition = 20;
        }

        doc.text(tx.trade_date, 20, yPosition);
        doc.text(tx.kind, 50, yPosition);
        doc.text(parseFloat(tx.amount_btc || 0).toFixed(8), 80, yPosition);
        doc.text(`$${parseFloat(tx.amount_usdt || 0).toFixed(2)}`, 110, yPosition);
        doc.text(`${parseFloat(tx.fee_btc || 0).toFixed(8)} BTC`, 140, yPosition);
        yPosition += 5;
      }
      yPosition += 5;
    }

    // Strategy Details
    doc.setFontSize(14);
    doc.setFont(undefined, "bold");
    doc.text("Strategy Details", 15, yPosition);
    yPosition += 8;

    doc.setFontSize(10);
    doc.setFont(undefined, "normal");
    doc.text(`Strategy: ${portfolio.strategy_code}`, 20, yPosition);
    yPosition += 6;
    doc.text(`Status: ${portfolio.status.toUpperCase()}`, 20, yPosition);
    yPosition += 6;
    doc.text(`Exchange: VALR`, 20, yPosition);
    yPosition += 10;

    // Footer
    const footerY = pageHeight - 15;
    doc.setFontSize(8);
    doc.setTextColor(128, 128, 128);
    doc.text("BitWealth - Automated Bitcoin Investment", 15, footerY);
    doc.text(`Generated: ${new Date().toISOString().split("T")[0]}`, pageWidth - 15, footerY, { align: "right" });
    doc.text("Page 1", pageWidth / 2, footerY, { align: "center" });

    // Return PDF as blob
    const pdfOutput = doc.output("arraybuffer");

    return new Response(pdfOutput, {
      status: 200,
      headers: {
        ...CORS,
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="statement_${customer_id}_${year}_${month}.pdf"`,
      },
    });
  } catch (error) {
    console.error("Error generating statement:", error);
    return new Response(
      JSON.stringify({ error: error.message || "Failed to generate statement" }),
      { status: 500, headers: { ...CORS, "Content-Type": "application/json" } }
    );
  }
});
