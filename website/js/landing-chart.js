// Landing Page Performance Chart
// Hardcoded historical data (2020-2025) to avoid database queries on landing page

// Sample data - will need to be replaced with actual back-test results
const historicalData = {
  // LTH PVR strategy results
  lthPvr: {
    labels: ['2020-01', '2020-07', '2021-01', '2021-07', '2022-01', '2022-07', '2023-01', '2023-07', '2024-01', '2024-07', '2025-01', '2025-07', '2025-12'],
    nav: [10000, 18500, 42000, 38000, 22000, 24000, 35000, 42000, 68000, 85000, 95000, 105000, 120000],  // Placeholder values
    roi: [0, 85, 320, 280, 120, 140, 250, 320, 480, 625, 712, 812, 950]  // Percentage values
  },
  // Standard DCA benchmark
  stdDca: {
    nav: [10000, 16000, 28000, 26000, 18000, 20000, 27000, 32000, 48000, 58000, 64000, 68000, 75000],  // Placeholder values
    roi: [0, 60, 180, 160, 80, 100, 170, 220, 340, 422, 477, 525, 587]  // Percentage values
  },
  // Final statistics (for stat cards)
  final: {
    lthPvrNAV: 120000,
    stdDcaNAV: 75000,
    lthPvrROI: 950,
    stdDcaROI: 587,
    outperformance: 363  // percentage points
  }
};

function initLandingChart() {
  const ctx = document.getElementById('performanceChart');
  if (!ctx) return;

  new Chart(ctx, {
    type: 'line',
    data: {
      labels: historicalData.lthPvr.labels,
      datasets: [
        {
          label: 'LTH PVR Strategy',
          data: historicalData.lthPvr.nav,
          borderColor: '#003B73',  // Navy
          backgroundColor: 'rgba(0, 59, 115, 0.1)',
          borderWidth: 3,
          pointRadius: 4,
          pointHoverRadius: 6,
          tension: 0.4,
          fill: true
        },
        {
          label: 'Standard DCA',
          data: historicalData.stdDca.nav,
          borderColor: '#CCCCCC',  // Gray
          backgroundColor: 'rgba(204, 204, 204, 0.1)',
          borderWidth: 2,
          pointRadius: 3,
          pointHoverRadius: 5,
          tension: 0.4,
          fill: true
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: {
        mode: 'index',
        intersect: false
      },
      plugins: {
        legend: {
          display: true,
          position: 'top',
          labels: {
            usePointStyle: true,
            padding: 20,
            font: {
              size: 14,
              weight: '600'
            }
          }
        },
        tooltip: {
          backgroundColor: 'rgba(0, 0, 0, 0.8)',
          padding: 12,
          titleFont: {
            size: 14,
            weight: '600'
          },
          bodyFont: {
            size: 13
          },
          callbacks: {
            label: function(context) {
              let label = context.dataset.label || '';
              if (label) {
                label += ': ';
              }
              if (context.parsed.y !== null) {
                label += '$' + context.parsed.y.toLocaleString();
              }
              return label;
            }
          }
        }
      },
      scales: {
        x: {
          grid: {
            display: false
          },
          ticks: {
            font: {
              size: 12
            }
          }
        },
        y: {
          beginAtZero: false,
          grid: {
            color: 'rgba(0, 0, 0, 0.05)'
          },
          ticks: {
            callback: function(value) {
              return '$' + (value / 1000).toFixed(0) + 'k';
            },
            font: {
              size: 12
            }
          }
        }
      }
    }
  });
}

// Initialize chart when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initLandingChart);
} else {
  initLandingChart();
}

// Populate stat cards with data
function populateStats() {
  const stats = historicalData.final;
  
  // Update stat card values if they exist
  const lthRoiEl = document.getElementById('lthRoi');
  const stdRoiEl = document.getElementById('stdRoi');
  const outperformEl = document.getElementById('outperform');
  
  if (lthRoiEl) lthRoiEl.textContent = '+' + stats.lthPvrROI + '%';
  if (stdRoiEl) stdRoiEl.textContent = '+' + stats.stdDcaROI + '%';
  if (outperformEl) outperformEl.textContent = '+' + stats.outperformance + ' pp';
}

// Call on load
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', populateStats);
} else {
  populateStats();
}
