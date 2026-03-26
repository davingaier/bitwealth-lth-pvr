#!/usr/bin/env python3

import json
import numpy as np
from datetime import datetime
from typing import List, Dict, Tuple
import urllib.request


def fetch_data_from_api() -> Tuple[List[Dict], List[Dict]]:
    print("Fetching LTH data...")
    lth_url = "https://chartinspect.com/api/charts/onchain/lth-mvrv?timeframe=all"
    with urllib.request.urlopen(lth_url) as response:
        lth_result = json.loads(response.read().decode())

    print("Fetching MVRV data...")
    mvrv_url = "https://chartinspect.com/api/charts/onchain/detailed-mvrv?timeframe=all"
    with urllib.request.urlopen(mvrv_url) as response:
        mvrv_result = json.loads(response.read().decode())

    lth_data = lth_result['data']
    mvrv_data = mvrv_result['data']

    print(f"Loaded {len(lth_data)} LTH points, {len(mvrv_data)} MVRV points\n")

    return lth_data, mvrv_data


def calculate_lth_pvr_cumulative(data: List[Dict]) -> List[Dict]:
    results = []

    lth_market_cap_values = []
    for item in data:
        lth_supply = item.get('lth_supply_btc', item.get('lth_supply', 0))
        btc_price = item.get('btc_price', 0)
        mc = lth_supply * btc_price
        if mc > 0:
            lth_market_cap_values.append(mc)

    for i, point in enumerate(data):
        lth_supply = point.get('lth_supply_btc', point.get('lth_supply', 0))
        btc_price = point.get('btc_price', 0)
        lth_realized_price = point.get('lth_realized_price', 0)

        lth_market_cap = lth_supply * btc_price
        lth_realized_cap = lth_supply * lth_realized_price

        cumulative_lth_market_caps = lth_market_cap_values[0:i+1]

        if len(cumulative_lth_market_caps) > 1:
            cumulative_mean = np.mean(cumulative_lth_market_caps)
            cumulative_variance = np.sum((np.array(cumulative_lth_market_caps) - cumulative_mean) ** 2) / (len(cumulative_lth_market_caps) - 1)
            cumulative_std_dev = np.sqrt(cumulative_variance)

            if cumulative_std_dev > 0:
                pvr_value = (lth_market_cap - lth_realized_cap) / cumulative_std_dev
            else:
                pvr_value = 0
        else:
            pvr_value = 0
            cumulative_std_dev = 0

        result = {
            **point,
            'lth_market_cap': lth_market_cap,
            'lth_realized_cap': lth_realized_cap,
            'unrealized_profit': lth_market_cap - lth_realized_cap,
            'cumulative_std_dev': cumulative_std_dev,
            'pvr_value': pvr_value,
        }
        results.append(result)

    return results


def calculate_pvr_bands_cumulative(pvr_data: List[Dict]) -> List[Dict]:
    results = []
    pvr_values = []

    for i, point in enumerate(pvr_data):
        pvr_values.append(point['pvr_value'])

        if i == 0:
            result = {
                **point,
                'pvr_mean': point['pvr_value'],
                'pvr_plus_1sigma': point['pvr_value'],
                'pvr_plus_2sigma': point['pvr_value'],
                'pvr_minus_1sigma': point['pvr_value'],
            }
        else:
            pvr_mean = np.mean(pvr_values)
            pvr_variance = np.sum((np.array(pvr_values) - pvr_mean) ** 2) / i
            pvr_std = np.sqrt(pvr_variance)

            result = {
                **point,
                'pvr_mean': pvr_mean,
                'pvr_plus_1sigma': pvr_mean + pvr_std,
                'pvr_plus_2sigma': pvr_mean + 2 * pvr_std,
                'pvr_minus_1sigma': pvr_mean - pvr_std,
                'pvr_std_dev': pvr_std,
            }

        results.append(result)

    return results


def calculate_pvr_bands_static(pvr_data: List[Dict]) -> Tuple[float, float, Dict[str, float]]:
    pvr_values = [p['pvr_value'] for p in pvr_data]

    pvr_mean = np.mean(pvr_values)
    pvr_variance = np.sum((np.array(pvr_values) - pvr_mean) ** 2) / len(pvr_values)
    pvr_std = np.sqrt(pvr_variance)

    bands = {
        'mean': pvr_mean,
        'plus_1sigma': pvr_mean + pvr_std,
        'plus_2sigma': pvr_mean + 2 * pvr_std,
        'minus_1sigma': pvr_mean - pvr_std,
    }

    return pvr_mean, pvr_std, bands


def calculate_mvrv_ratio(data: List[Dict]) -> List[Dict]:
    results = []

    for point in data:
        market_cap = point.get('market_cap_usd', point.get('market_cap', 0))
        realized_cap = point.get('realized_cap_usd', point.get('realized_cap', 0))
        mvrv_ratio = point.get('mvrv_ratio', 0)
        btc_price = point.get('btc_price', 0)

        if realized_cap > 0 and mvrv_ratio == 0:
            mvrv_ratio = market_cap / realized_cap

        result = {
            **point,
            'mvrv_ratio': mvrv_ratio,
            'btc_price': btc_price,
            'market_cap': market_cap,
            'realized_cap': realized_cap,
        }
        results.append(result)

    return results


def calculate_mvrv_bands_cumulative(mvrv_data: List[Dict]) -> List[Dict]:
    results = []
    mvrv_values = []

    for i, point in enumerate(mvrv_data):
        mvrv_values.append(point['mvrv_ratio'])

        if i == 0:
            result = {
                **point,
                'mvrv_mean': point['mvrv_ratio'],
                'mvrv_plus_1sigma': point['mvrv_ratio'],
                'mvrv_plus_2sigma': point['mvrv_ratio'],
                'mvrv_minus_1sigma': point['mvrv_ratio'],
            }
        else:
            mvrv_mean = np.mean(mvrv_values)
            mvrv_variance = np.sum((np.array(mvrv_values) - mvrv_mean) ** 2) / i
            mvrv_std = np.sqrt(mvrv_variance)

            result = {
                **point,
                'mvrv_mean': mvrv_mean,
                'mvrv_plus_1sigma': mvrv_mean + mvrv_std,
                'mvrv_plus_2sigma': mvrv_mean + 2 * mvrv_std,
                'mvrv_minus_1sigma': max(0, mvrv_mean - mvrv_std),
                'mvrv_std_dev': mvrv_std,
            }

        results.append(result)

    return results


def calculate_mvrv_bands_static(mvrv_data: List[Dict]) -> Tuple[float, float, Dict[str, float]]:
    mvrv_values = [p['mvrv_ratio'] for p in mvrv_data if p['mvrv_ratio'] > 0]

    mvrv_mean = np.mean(mvrv_values)
    mvrv_variance = np.sum((np.array(mvrv_values) - mvrv_mean) ** 2) / len(mvrv_values)
    mvrv_std = np.sqrt(mvrv_variance)

    bands = {
        'mean': mvrv_mean,
        'plus_1sigma': mvrv_mean + mvrv_std,
        'plus_2sigma': mvrv_mean + 2 * mvrv_std,
        'minus_1sigma': max(0, mvrv_mean - mvrv_std),
    }

    return mvrv_mean, mvrv_std, bands


def convert_pvr_bands_to_price(pvr_data_with_bands: List[Dict]) -> List[Dict]:
    results = []

    for point in pvr_data_with_bands:
        lth_supply = point.get('lth_supply_btc', point.get('lth_supply', 0))
        lth_realized_cap = point.get('lth_realized_cap', 0)
        cumulative_std_dev = point.get('cumulative_std_dev', 0)

        def pvr_to_price(pvr_value):
            if lth_supply == 0 or cumulative_std_dev == 0:
                return 0
            market_cap = (pvr_value * cumulative_std_dev) + lth_realized_cap
            return market_cap / lth_supply

        result = {
            **point,
            'price_at_pvr_mean': pvr_to_price(point['pvr_mean']),
            'price_at_pvr_plus_1sigma': pvr_to_price(point['pvr_plus_1sigma']),
            'price_at_pvr_plus_2sigma': pvr_to_price(point['pvr_plus_2sigma']),
            'price_at_pvr_minus_1sigma': pvr_to_price(point['pvr_minus_1sigma']),
        }
        results.append(result)

    return results


def convert_mvrv_bands_to_price(mvrv_data_with_bands: List[Dict]) -> List[Dict]:
    results = []

    for point in mvrv_data_with_bands:
        realized_cap = point.get('realized_cap', 0)
        btc_price = point.get('btc_price', 0)
        market_cap = point.get('market_cap', 0)

        circulating_supply = market_cap / btc_price if btc_price > 0 else 0

        def mvrv_to_price(mvrv_value):
            if circulating_supply == 0 or realized_cap == 0:
                return 0
            market_cap = mvrv_value * realized_cap
            return market_cap / circulating_supply

        result = {
            **point,
            'price_at_mvrv_mean': mvrv_to_price(point['mvrv_mean']),
            'price_at_mvrv_plus_1sigma': mvrv_to_price(point['mvrv_plus_1sigma']),
            'price_at_mvrv_plus_2sigma': mvrv_to_price(point['mvrv_plus_2sigma']),
            'price_at_mvrv_minus_1sigma': mvrv_to_price(point['mvrv_minus_1sigma']),
        }
        results.append(result)

    return results


def main():
    print("LTH PVR and MVRV Calculator")
    print("chartinspect.com\n")

    lth_data, mvrv_api_data = fetch_data_from_api()

    print("Calculating LTH PVR...")
    pvr_data = calculate_lth_pvr_cumulative(lth_data)
    pvr_with_bands = calculate_pvr_bands_cumulative(pvr_data)
    pvr_with_price_bands = convert_pvr_bands_to_price(pvr_with_bands)

    print("Calculating MVRV...")
    mvrv_data = calculate_mvrv_ratio(mvrv_api_data)
    mvrv_with_bands = calculate_mvrv_bands_cumulative(mvrv_data)
    mvrv_with_price_bands = convert_mvrv_bands_to_price(mvrv_with_bands)

    print("\nSaving results...")
    with open('pvr_results.json', 'w') as f:
        json.dump(pvr_with_price_bands, f, indent=2)

    with open('mvrv_results.json', 'w') as f:
        json.dump(mvrv_with_price_bands, f, indent=2)

    print("Done.\n")


if __name__ == "__main__":
    main()
