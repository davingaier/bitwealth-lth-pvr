// ef_generate_statement/index.ts
// Purpose: Generate monthly statement PDF for customer with Supabase Storage upload
// Input: { customer_id: number, year: number, month: number }
// Output: PDF uploaded to storage bucket, returns download URL

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { jsPDF } from "npm:jspdf@2.5.1";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? Deno.env.get("SB_URL");
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const ORG_ID = Deno.env.get("ORG_ID");

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// BitWealth logo as base64 data URL (embedded for use in PDF)
const LOGO_BASE64 = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAt8AAAH8CAYAAAAJ2sPBAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAJcEhZcwAADsMAAA7DAcdvqGQAAD8pSURBVHhe7Z0HnBRF+sc3kElI..."; // Truncated for brevity - will load full version

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

    // Get benchmark data (Standard DCA) - opening and closing
    const { data: stdDcaOpening } = await supabase
      .schema("lth_pvr")
      .from("std_dca_balances_daily")
      .select("*")
      .eq("customer_id", customer_id)
      .eq("date", prevMonthEnd)
      .single();

    const { data: stdDcaClosing } = await supabase
      .schema("lth_pvr")
      .from("std_dca_balances_daily")
      .select("*")
      .eq("customer_id", customer_id)
      .eq("date", endDateStr)
      .single();

    // Calculate metrics
    const openingNav = openingBalance ? parseFloat(openingBalance.nav_usd) : 0;
    const closingNav = closingBalance ? parseFloat(closingBalance.nav_usd) : 0;
    const netChange = closingNav - openingNav;
    const percentChange = openingNav > 0 ? ((netChange / openingNav) * 100) : 0;

    // Calculate total contributions and fees for the month
    const totalContributions = transactions
      ? transactions.filter((tx: any) => tx.kind === "deposit" || tx.kind === "topup")
          .reduce((sum: number, tx: any) => sum + parseFloat(tx.amount_usdt || 0), 0)
      : 0;

    const totalFeesBtc = transactions
      ? transactions.reduce((sum: number, tx: any) => sum + parseFloat(tx.fee_btc || 0), 0)
      : 0;

    const totalFeesUsdt = transactions
      ? transactions.reduce((sum: number, tx: any) => sum + parseFloat(tx.fee_usdt || 0), 0)
      : 0;

    const totalFeesUsd = totalFeesUsdt + (totalFeesBtc * (closingBalance?.btc_price || 0));

    // Calculate ROI and CAGR (requires inception date from customer_portfolios)
    const inceptionDate = portfolio.created_at ? new Date(portfolio.created_at) : startDate;
    const daysSinceInception = (new Date(endDateStr).getTime() - inceptionDate.getTime()) / (1000 * 60 * 60 * 24);
    const yearsSinceInception = daysSinceInception / 365.25;
    
    // ROI = (Current NAV - Total Contributions) / Total Contributions * 100
    const totalContribsCum = closingBalance ? parseFloat(closingBalance.contrib_gross_cum || 0) : 0;
    const roi = totalContribsCum > 0 ? ((closingNav - totalContribsCum) / totalContribsCum * 100) : 0;
    
    // CAGR = ((Final NAV / Initial NAV)^(1/years)) - 1) * 100
    const cagr = yearsSinceInception > 0 && openingNav > 0 
      ? (Math.pow(closingNav / openingNav, 1 / yearsSinceInception) - 1) * 100 
      : 0;

    // Standard DCA benchmark metrics
    const stdDcaOpeningNav = stdDcaOpening ? parseFloat(stdDcaOpening.nav_usd) : 0;
    const stdDcaClosingNav = stdDcaClosing ? parseFloat(stdDcaClosing.nav_usd) : 0;
    const stdDcaRoi = totalContribsCum > 0 ? ((stdDcaClosingNav - totalContribsCum) / totalContribsCum * 100) : 0;
    const stdDcaCagr = yearsSinceInception > 0 && stdDcaOpeningNav > 0 
      ? (Math.pow(stdDcaClosingNav / stdDcaOpeningNav, 1 / yearsSinceInception) - 1) * 100 
      : 0;

    // Generate PDF
    const doc = new jsPDF();
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    let yPosition = 20;

    // Set default text color to #032C48
    doc.setTextColor(3, 44, 72);

    // Header with Logo (embedded 20x20 sized logo)
    try {
      // Using a smaller, optimized version of the logo (will be added separately)
      const logoData = "data:image/png;base64,iVBORw0KGgo..."; // Placeholder - will compress separately
      // Uncomment when logo is optimized:
      // doc.addImage(logoData, 'PNG', 15, yPosition - 2, 20, 20);
    } catch (e) {
      console.error("Logo load error:", e);
    }

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
    doc.setDrawColor(3, 44, 72);
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

    // Left-aligned labels, right-aligned values
    const valueX = 120; // X position for right-aligned values
    
    doc.text(`Opening Net Asset Value (${prevMonthEnd}):`, 20, yPosition);
    doc.text(`$${openingNav.toFixed(2)}`, valueX, yPosition, { align: "right" });
    yPosition += 6;
    
    doc.text(`Closing Net Asset Value (${endDateStr}):`, 20, yPosition);
    doc.text(`$${closingNav.toFixed(2)}`, valueX, yPosition, { align: "right" });
    yPosition += 6;
    
    doc.text(`Contributions this month:`, 20, yPosition);
    doc.text(`$${totalContributions.toFixed(2)}`, valueX, yPosition, { align: "right" });
    yPosition += 6;
    
    doc.text(`Net Change:`, 20, yPosition);
    doc.text(`${netChange >= 0 ? "+" : ""}$${netChange.toFixed(2)} (${percentChange >= 0 ? "+" : ""}${percentChange.toFixed(2)}%)`, valueX, yPosition, { align: "right" });
    yPosition += 8; // Extra spacing before new metrics

    // New performance metrics
    doc.text(`ROI:`, 20, yPosition);
    doc.text(`${roi >= 0 ? "+" : ""}${roi.toFixed(2)}%`, valueX, yPosition, { align: "right" });
    yPosition += 6;
    
    doc.text(`CAGR:`, 20, yPosition);
    doc.text(`${cagr >= 0 ? "+" : ""}${cagr.toFixed(2)}%`, valueX, yPosition, { align: "right" });
    yPosition += 8;
    
    // Fee breakdown (all current fees are exchange fees from VALR)
    doc.text(`Platform Fees:`, 20, yPosition);
    doc.text(`$0.00`, valueX, yPosition, { align: "right" });
    yPosition += 6;
    
    doc.text(`Performance Fees:`, 20, yPosition);
    doc.text(`$0.00`, valueX, yPosition, { align: "right" });
    yPosition += 6;
    
    doc.text(`Exchange Fees:`, 20, yPosition);
    doc.text(`$${totalFeesUsd.toFixed(2)}`, valueX, yPosition, { align: "right" });
    yPosition += 6;
    
    doc.setFont(undefined, "bold");
    doc.text(`Total Fees Paid:`, 20, yPosition);
    doc.text(`$${totalFeesUsd.toFixed(2)}`, valueX, yPosition, { align: "right" });
    doc.setFont(undefined, "normal");
    yPosition += 8;

    if (closingBalance) {
      doc.text(`BTC Balance:`, 20, yPosition);
      doc.text(`${parseFloat(closingBalance.btc_balance).toFixed(8)} BTC`, valueX, yPosition, { align: "right" });
      yPosition += 6;
      
      doc.text(`USDT Balance:`, 20, yPosition);
      doc.text(`$${parseFloat(closingBalance.usdt_balance).toFixed(2)}`, valueX, yPosition, { align: "right" });
      yPosition += 12; // Extra spacing before Benchmark
    }

    // Benchmark Comparison Section (Table Format)
    doc.setFontSize(14);
    doc.setFont(undefined, "bold");
    doc.text("Benchmark Comparison", 15, yPosition);
    yPosition += 8;

    doc.setFontSize(9);
    
    // Table setup
    const col1X = 20;
    const col2X = 95;
    const col3X = 155;
    const tableWidth = 175;
    
    // Header row
    doc.setFont(undefined, "bold");
    doc.setFillColor(3, 44, 72);
    doc.setTextColor(255, 255, 255);
    doc.rect(col1X, yPosition - 4, tableWidth, 7, "F");
    
    doc.text("Metric", col1X + 2, yPosition);
    doc.text("LTH PVR Bitcoin DCA", col2X + 2, yPosition);
    doc.text("Standard DCA", col3X + 2, yPosition);
    yPosition += 7;
    
    // Reset text color
    doc.setTextColor(3, 44, 72);
    doc.setFont(undefined, "normal");
    
    // NAV row
    doc.text("NAV", col1X + 2, yPosition);
    doc.text(`$${closingNav.toFixed(2)}`, col2X + 55, yPosition, { align: "right" });
    doc.text(`$${stdDcaClosingNav.toFixed(2)}`, col3X + 40, yPosition, { align: "right" });
    yPosition += 6;
    
    // ROI row
    doc.text("ROI", col1X + 2, yPosition);
    doc.text(`${roi >= 0 ? "+" : ""}${roi.toFixed(2)}%`, col2X + 55, yPosition, { align: "right" });
    doc.text(`${stdDcaRoi >= 0 ? "+" : ""}${stdDcaRoi.toFixed(2)}%`, col3X + 40, yPosition, { align: "right" });
    yPosition += 6;
    
    // CAGR row
    doc.text("CAGR", col1X + 2, yPosition);
    doc.text(`${cagr >= 0 ? "+" : ""}${cagr.toFixed(2)}%`, col2X + 55, yPosition, { align: "right" });
    doc.text(`${stdDcaCagr >= 0 ? "+" : ""}${stdDcaCagr.toFixed(2)}%`, col3X + 40, yPosition, { align: "right" });
    yPosition += 8;

    // Outperformance summary
    const outperformance = roi - stdDcaRoi;
    doc.setFont(undefined, "bold");
    doc.setFontSize(10);
    doc.text(`Outperformance: ${outperformance >= 0 ? "+" : ""}${outperformance.toFixed(2)}%`, col1X, yPosition);
    doc.setFont(undefined, "normal");
    doc.setFontSize(9);
    yPosition += 12; // Extra spacing before Transaction History

    // Transaction History Section
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
      // Table headers with column positions
      const dateCol = 15;
      const typeCol = 40;
      const btcCol = 88; // Right-align position
      const usdtCol = 113; // Right-align position
      const feeBtcCol = 138; // Right-align position
      const feeUsdtCol = 163; // Right-align position
      const btcBalCol = 188; // Right-align position
      const usdtBalCol = pageWidth - 15; // Right-align position
      
      doc.setFont(undefined, "bold");
      doc.text("Date", dateCol, yPosition);
      doc.text("Type", typeCol, yPosition);
      doc.text("BTC", btcCol, yPosition, { align: "right" });
      doc.text("USDT", usdtCol, yPosition, { align: "right" });
      doc.text("Fee (BTC)", feeBtcCol, yPosition, { align: "right" });
      doc.text("Fee (USDT)", feeUsdtCol, yPosition, { align: "right" });
      doc.text("BTC Bal", btcBalCol, yPosition, { align: "right" });
      doc.text("USDT Bal", usdtBalCol, yPosition, { align: "right" });
      yPosition += 6;
      doc.setFont(undefined, "normal");

      // Running balances
      let runningBtc = openingBalance ? parseFloat(openingBalance.btc_balance) : 0;
      let runningUsdt = openingBalance ? parseFloat(openingBalance.usdt_balance) : 0;

      // Totals accumulators
      let totalBtc = 0;
      let totalUsdt = 0;
      let totalFeeBtcSum = 0;
      let totalFeeUsdtSum = 0;

      // Table rows
      for (const tx of transactions) {
        if (yPosition > pageHeight - 30) {
          doc.addPage();
          yPosition = 20;
        }

        const amountBtc = parseFloat(tx.amount_btc || 0);
        const amountUsdt = parseFloat(tx.amount_usdt || 0);
        const feeBtc = parseFloat(tx.fee_btc || 0);
        const feeUsdt = parseFloat(tx.fee_usdt || 0);

        // Update running balances
        runningBtc += amountBtc;
        runningUsdt += amountUsdt;

        // Accumulate totals
        totalBtc += amountBtc;
        totalUsdt += amountUsdt;
        totalFeeBtcSum += feeBtc;
        totalFeeUsdtSum += feeUsdt;

        // Replace "topup" with "deposit"
        const txType = tx.kind === "topup" ? "deposit" : tx.kind;

        doc.text(tx.trade_date, dateCol, yPosition);
        doc.text(txType, typeCol, yPosition);
        doc.text(amountBtc.toFixed(8), btcCol, yPosition, { align: "right" });
        doc.text(amountUsdt.toFixed(2), usdtCol, yPosition, { align: "right" });
        doc.text(feeBtc.toFixed(8), feeBtcCol, yPosition, { align: "right" });
        doc.text(feeUsdt.toFixed(2), feeUsdtCol, yPosition, { align: "right" });
        doc.text(runningBtc.toFixed(8), btcBalCol, yPosition, { align: "right" });
        doc.text(runningUsdt.toFixed(2), usdtBalCol, yPosition, { align: "right" });
        yPosition += 5;
      }

      // Totals row
      yPosition += 2;
      doc.setLineWidth(0.3);
      doc.line(15, yPosition, pageWidth - 15, yPosition);
      yPosition += 5;
      doc.setFont(undefined, "bold");
      doc.text("TOTAL", dateCol, yPosition);
      doc.text(totalBtc.toFixed(8), btcCol, yPosition, { align: "right" });
      doc.text(totalUsdt.toFixed(2), usdtCol, yPosition, { align: "right" });
      doc.text(totalFeeBtcSum.toFixed(8), feeBtcCol, yPosition, { align: "right" });
      doc.text(totalFeeUsdtSum.toFixed(2), feeUsdtCol, yPosition, { align: "right" });
      doc.setFont(undefined, "normal");
      yPosition += 8;
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

    // Footer (increased margin to prevent overflow)
    const footerY = pageHeight - 12; // Changed from 15 to 12
    doc.setFontSize(8);
    doc.setTextColor(128, 128, 128);
    
    // SDD File Naming Convention: CCYY-MM-DD_LastName_FirstNames_statement_M##_CCYY.pdf
    const lastName = customer.last_name.replace(/\s+/g, "_");
    const firstNames = customer.first_names.replace(/\s+/g, "_");
    const monthPadded = month.toString().padStart(2, "0");
    const filename = `${endDateStr}_${lastName}_${firstNames}_statement_M${monthPadded}_${year}.pdf`;
    
    doc.text(filename, 15, footerY);
    doc.text(`Generated: ${new Date().toISOString().split("T")[0]}`, pageWidth - 15, footerY, { align: "right" });
    doc.text("Page 1", pageWidth / 2, footerY, { align: "center" });

    // Generate PDF as blob
    const pdfOutput = doc.output("arraybuffer");

    // Upload to Supabase Storage bucket: customer-statements
    const storagePath = `${ORG_ID}/customer-${customer_id}/${filename}`;
    
    const { data: uploadData, error: uploadError } = await supabase
      .storage
      .from("customer-statements")
      .upload(storagePath, pdfOutput, {
        contentType: "application/pdf",
        upsert: true, // Allow overwriting if re-generated
      });

    if (uploadError) {
      console.error("Storage upload error:", uploadError);
      // Fallback: Return PDF directly if storage fails
      return new Response(pdfOutput, {
        status: 200,
        headers: {
          ...CORS,
          "Content-Type": "application/pdf",
          "Content-Disposition": `attachment; filename="${filename}"`,
        },
      });
    }

    // Get public URL (for private bucket, use signed URL)
    const { data: signedData } = await supabase
      .storage
      .from("customer-statements")
      .createSignedUrl(storagePath, 60 * 60 * 24 * 30); // 30-day expiry

    const downloadUrl = signedData?.signedUrl || "";

    // Return success with download URL
    return new Response(
      JSON.stringify({
        success: true,
        filename,
        downloadUrl,
        message: "Statement generated and uploaded successfully",
      }),
      {
        status: 200,
        headers: { ...CORS, "Content-Type": "application/json" },
      }
    );

  } catch (error) {
    console.error("Error generating statement:", error);
    return new Response(
      JSON.stringify({ error: error.message || "Failed to generate statement" }),
      { status: 500, headers: { ...CORS, "Content-Type": "application/json" } }
    );
  }
});
