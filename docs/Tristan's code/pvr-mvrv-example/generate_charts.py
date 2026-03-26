#!/usr/bin/env python3

import json
import numpy as np
import matplotlib.pyplot as plt
from matplotlib.dates import DateFormatter
from datetime import datetime

def load_results():
    with open('pvr_results.json', 'r') as f:
        pvr_data = json.load(f)
    with open('mvrv_results.json', 'r') as f:
        mvrv_data = json.load(f)
    return pvr_data, mvrv_data

def create_pvr_chart(pvr_data):
    dates = [datetime.strptime(p['date'], '%Y-%m-%d') for p in pvr_data]
    btc_prices = [p['btc_price'] for p in pvr_data]
    pvr_values = [p['pvr_value'] for p in pvr_data]
    pvr_plus_2sigma = [p['pvr_plus_2sigma'] for p in pvr_data]
    pvr_plus_1sigma = [p['pvr_plus_1sigma'] for p in pvr_data]
    pvr_mean = [p['pvr_mean'] for p in pvr_data]
    pvr_minus_1sigma = [p['pvr_minus_1sigma'] for p in pvr_data]
    price_at_plus_2sigma = [p['price_at_pvr_plus_2sigma'] for p in pvr_data]
    price_at_plus_1sigma = [p['price_at_pvr_plus_1sigma'] for p in pvr_data]
    price_at_mean = [p['price_at_pvr_mean'] for p in pvr_data]
    price_at_minus_1sigma = [p['price_at_pvr_minus_1sigma'] for p in pvr_data]

    fig, (ax1, ax2) = plt.subplots(2, 1, figsize=(14, 10), sharex=True)

    ax1.semilogy(dates, btc_prices, linewidth=2.5, color='#000000', label='BTC Price', zorder=10)
    ax1.semilogy(dates, price_at_plus_2sigma, linewidth=1.5, color='#dc3545', linestyle='--', label='+2σ Price', alpha=0.8)
    ax1.semilogy(dates, price_at_plus_1sigma, linewidth=1.5, color='#ff8800', linestyle='--', label='+1σ Price', alpha=0.8)
    ax1.semilogy(dates, price_at_mean, linewidth=1.5, color='#6c757d', linestyle='-', label='Mean Price', alpha=0.8)
    ax1.semilogy(dates, price_at_minus_1sigma, linewidth=1.5, color='#28a745', linestyle='--', label='-1σ Price', alpha=0.8)

    ax1.fill_between(dates, price_at_plus_1sigma, price_at_plus_2sigma, color='#dc3545', alpha=0.1)
    ax1.fill_between(dates, price_at_mean, price_at_plus_1sigma, color='#ff8800', alpha=0.1)
    ax1.fill_between(dates, price_at_minus_1sigma, price_at_mean, color='#28a745', alpha=0.1)

    ax1.set_ylabel('Bitcoin Price (USD, log scale)', fontsize=11, fontweight='bold')
    ax1.grid(True, alpha=0.3, linestyle='--')
    ax1.legend(loc='upper left', fontsize=10)
    ax1.set_title('Bitcoin Price & LTH PVR Statistical Bands', fontsize=14, fontweight='bold', pad=15)

    ax2.plot(dates, pvr_values, linewidth=2, color='#000000', label='LTH PVR', zorder=5)
    ax2.plot(dates, pvr_plus_2sigma, linewidth=1.5, color='#dc3545', linestyle='--', label='+2σ', alpha=0.8)
    ax2.plot(dates, pvr_plus_1sigma, linewidth=1.5, color='#ff8800', linestyle='--', label='+1σ', alpha=0.8)
    ax2.plot(dates, pvr_mean, linewidth=1.5, color='#6c757d', linestyle='-', label='Mean', alpha=0.8)
    ax2.plot(dates, pvr_minus_1sigma, linewidth=1.5, color='#28a745', linestyle='--', label='-1σ', alpha=0.8)

    ax2.fill_between(dates, pvr_plus_1sigma, pvr_plus_2sigma, color='#dc3545', alpha=0.1)
    ax2.fill_between(dates, pvr_mean, pvr_plus_1sigma, color='#ff8800', alpha=0.1)
    ax2.fill_between(dates, pvr_minus_1sigma, pvr_mean, color='#28a745', alpha=0.1)

    ax2.axhline(y=0, color='black', linestyle='-', linewidth=0.5, alpha=0.5)
    ax2.set_ylabel('LTH PVR Value', fontsize=11, fontweight='bold')
    ax2.set_xlabel('Date', fontsize=11, fontweight='bold')
    ax2.grid(True, alpha=0.3, linestyle='--')
    ax2.legend(loc='upper left', fontsize=10, ncol=5)

    ax2.xaxis.set_major_formatter(DateFormatter('%Y'))

    plt.tight_layout()
    plt.savefig('lth_pvr_chart.png', dpi=150, bbox_inches='tight')
    print("Saved lth_pvr_chart.png")
    plt.close()

def create_mvrv_chart(mvrv_data):
    dates = [datetime.strptime(p['date'], '%Y-%m-%d') for p in mvrv_data]
    btc_prices = [p['btc_price'] for p in mvrv_data]
    mvrv_values = [p['mvrv_ratio'] for p in mvrv_data]
    mvrv_plus_2sigma = [p['mvrv_plus_2sigma'] for p in mvrv_data]
    mvrv_plus_1sigma = [p['mvrv_plus_1sigma'] for p in mvrv_data]
    mvrv_mean = [p['mvrv_mean'] for p in mvrv_data]
    mvrv_minus_1sigma = [p['mvrv_minus_1sigma'] for p in mvrv_data]
    price_at_plus_2sigma = [p['price_at_mvrv_plus_2sigma'] for p in mvrv_data]
    price_at_plus_1sigma = [p['price_at_mvrv_plus_1sigma'] for p in mvrv_data]
    price_at_mean = [p['price_at_mvrv_mean'] for p in mvrv_data]
    price_at_minus_1sigma = [p['price_at_mvrv_minus_1sigma'] for p in mvrv_data]

    fig, (ax1, ax2) = plt.subplots(2, 1, figsize=(14, 10), sharex=True)

    ax1.semilogy(dates, btc_prices, linewidth=2.5, color='#000000', label='BTC Price', zorder=10)
    ax1.semilogy(dates, price_at_plus_2sigma, linewidth=1.5, color='#dc3545', linestyle='--', label='+2σ Price', alpha=0.8)
    ax1.semilogy(dates, price_at_plus_1sigma, linewidth=1.5, color='#ff8800', linestyle='--', label='+1σ Price', alpha=0.8)
    ax1.semilogy(dates, price_at_mean, linewidth=1.5, color='#6c757d', linestyle='-', label='Mean Price', alpha=0.8)
    ax1.semilogy(dates, price_at_minus_1sigma, linewidth=1.5, color='#28a745', linestyle='--', label='-1σ Price', alpha=0.8)

    ax1.fill_between(dates, price_at_plus_1sigma, price_at_plus_2sigma, color='#dc3545', alpha=0.1)
    ax1.fill_between(dates, price_at_mean, price_at_plus_1sigma, color='#ff8800', alpha=0.1)
    ax1.fill_between(dates, price_at_minus_1sigma, price_at_mean, color='#28a745', alpha=0.1)

    ax1.set_ylabel('Bitcoin Price (USD, log scale)', fontsize=11, fontweight='bold')
    ax1.grid(True, alpha=0.3, linestyle='--')
    ax1.legend(loc='upper left', fontsize=10)
    ax1.set_title('Bitcoin Price & MVRV Ratio Statistical Bands', fontsize=14, fontweight='bold', pad=15)

    ax2.plot(dates, mvrv_values, linewidth=2, color='#000000', label='MVRV Ratio', zorder=5)
    ax2.plot(dates, mvrv_plus_2sigma, linewidth=1.5, color='#dc3545', linestyle='--', label='+2σ', alpha=0.8)
    ax2.plot(dates, mvrv_plus_1sigma, linewidth=1.5, color='#ff8800', linestyle='--', label='+1σ', alpha=0.8)
    ax2.plot(dates, mvrv_mean, linewidth=1.5, color='#6c757d', linestyle='-', label='Mean', alpha=0.8)
    ax2.plot(dates, mvrv_minus_1sigma, linewidth=1.5, color='#28a745', linestyle='--', label='-1σ', alpha=0.8)

    ax2.fill_between(dates, mvrv_plus_1sigma, mvrv_plus_2sigma, color='#dc3545', alpha=0.1)
    ax2.fill_between(dates, mvrv_mean, mvrv_plus_1sigma, color='#ff8800', alpha=0.1)
    ax2.fill_between(dates, mvrv_minus_1sigma, mvrv_mean, color='#28a745', alpha=0.1)

    ax2.axhline(y=1, color='black', linestyle='-', linewidth=0.5, alpha=0.5)
    ax2.set_ylabel('MVRV Ratio', fontsize=11, fontweight='bold')
    ax2.set_xlabel('Date', fontsize=11, fontweight='bold')
    ax2.grid(True, alpha=0.3, linestyle='--')
    ax2.legend(loc='upper left', fontsize=10, ncol=5)

    ax2.xaxis.set_major_formatter(DateFormatter('%Y'))

    plt.tight_layout()
    plt.savefig('mvrv_chart.png', dpi=150, bbox_inches='tight')
    print("Saved mvrv_chart.png")
    plt.close()

def main():
    print("Generating charts...\n")

    pvr_data, mvrv_data = load_results()

    create_pvr_chart(pvr_data)
    create_mvrv_chart(mvrv_data)

    print("\nDone.")

if __name__ == "__main__":
    main()
