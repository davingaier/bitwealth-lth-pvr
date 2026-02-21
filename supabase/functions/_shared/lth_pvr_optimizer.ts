/**
 * LTH PVR Strategy Parameter Optimizer
 * 
 * Grid search optimizer for finding optimal B1-B11 order sizes and momentum parameters.
 * Uses exhaustive search within specified ranges to maximize chosen objective function.
 * 
 * Optimization Objectives:
 * - nav: Maximize final Net Asset Value (absolute returns)
 * - cagr: Maximize Compound Annual Growth Rate (default)
 * - roi: Maximize Return on Investment percentage
 * - sharpe: Maximize Sharpe ratio (CAGR / MaxDD - risk-adjusted returns)
 * 
 * Constraints:
 * - B1-B11 must maintain monotonicity (B1 >= B2 >= B3 >= ... >= B11)
 * - Invalid combinations are skipped
 * 
 * Bear Pause Triggers:
 * - NOT optimized (fixed per variation design)
 * - Progressive: Enter +2.0σ, Exit -1.0σ
 * - Balanced: Enter +2.0σ, Exit -0.75σ
 * - Conservative: Enter +2.0σ, Exit 0σ (mean)
 * 
 * @module lth_pvr_optimizer
 * @version 1.0.0
 * @created 2026-02-21
 */

import { runSimulation, SimulationResult, CIBandData, SimulationParams } from "./lth_pvr_simulator.ts";
import { StrategyConfig } from "./lth_pvr_strategy_logic.ts";

// =============================================================================
// Type Definitions
// =============================================================================

/**
 * Parameter range for a single dimension (e.g., B1 values to test)
 */
export interface ParameterRange {
  /** Minimum value */
  min: number;
  
  /** Maximum value */
  max: number;
  
  /** Step size (increment) */
  step: number;
}

/**
 * Optimization configuration
 */
export interface OptimizationConfig {
  /** Base strategy config (bear pause thresholds, retrace settings) */
  baseConfig: StrategyConfig;
  
  /** B1-B11 parameter ranges (optional - only optimize specified ranges) */
  b_ranges?: {
    b1?: ParameterRange;
    b2?: ParameterRange;
    b3?: ParameterRange;
    b4?: ParameterRange;
    b5?: ParameterRange;
    b6?: ParameterRange;
    b7?: ParameterRange;
    b8?: ParameterRange;
    b9?: ParameterRange;
    b10?: ParameterRange;
    b11?: ParameterRange;
  };
  
  /** Momentum length range (optional) */
  momo_length_range?: ParameterRange;
  
  /** Momentum threshold range (optional) */
  momo_threshold_range?: ParameterRange;
  
  /** Optimization objective: 'nav' | 'cagr' | 'roi' | 'sharpe' (default: 'cagr') */
  objective?: 'nav' | 'cagr' | 'roi' | 'sharpe';
  
  /** Maximum number of results to return (default: 10) */
  max_results?: number;
  
  /** Progress callback (called every N combinations, optional) */
  onProgress?: (current: number, total: number, percent: number) => void;
  
  /** Progress report interval (default: 10% increments) */
  progress_interval?: number;
}

/**
 * Optimization result (single combination)
 */
export interface OptimizationResult {
  /** Parameter combination */
  config: StrategyConfig;
  
  /** Simulation results */
  simulation: SimulationResult;
  
  /** Objective value (what was optimized) */
  objective_value: number;
  
  /** Rank (1 = best) */
  rank?: number;
}

/**
 * Complete optimization results
 */
export interface OptimizationOutput {
  /** Best configuration found */
  best: OptimizationResult;
  
  /** Top N results (sorted by objective, descending) */
  top_results: OptimizationResult[];
  
  /** Total combinations tested */
  combinations_tested: number;
  
  /** Combinations skipped (constraint violations) */
  combinations_skipped: number;
  
  /** Optimization objective used */
  objective: string;
  
  /** Execution time (seconds) */
  execution_time_seconds: number;
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Generate array of values from range
 */
function rangeToArray(range: ParameterRange): number[] {
  const values: number[] = [];
  let current = range.min;
  
  while (current <= range.max + 1e-9) { // Add epsilon for floating point comparison
    values.push(current);
    current += range.step;
  }
  
  return values;
}

/**
 * Validate B1-B11 monotonicity constraint
 * B1 >= B2 >= B3 >= ... >= B11
 */
/**
 * Validate B1-B11 monotonicity constraints
 * Buy side (B1-B5): Order sizes should decrease as price approaches mean (B1 >= B2 >= B3 >= B4 >= B5)
 * Sell side (B6-B11): Order sizes should increase as price moves away from mean (B6 <= B7 <= B8 <= B9 <= B10 <= B11)
 * No constraint between B5 and B6 (opposite sides of mean)
 */
function validateBMonotonicity(b: { [key: string]: number }): boolean {
  // Buy side validation (B1 >= B2 >= B3 >= B4 >= B5)
  const buyKeys = ['B1', 'B2', 'B3', 'B4', 'B5'];
  for (let i = 0; i < buyKeys.length - 1; i++) {
    const current = Number(b[buyKeys[i]]);
    const next = Number(b[buyKeys[i + 1]]);
    
    if (current < next) {
      console.warn(`Buy monotonicity violation: ${buyKeys[i]}=${current} < ${buyKeys[i+1]}=${next}`);
      return false;
    }
  }
  
  // Sell side validation (B6 <= B7 <= B8 <= B9 <= B10 <= B11)
  const sellKeys = ['B6', 'B7', 'B8', 'B9', 'B10', 'B11'];
  for (let i = 0; i < sellKeys.length - 1; i++) {
    const current = Number(b[sellKeys[i]]);
    const next = Number(b[sellKeys[i + 1]]);
    
    if (current > next) {
      console.warn(`Sell monotonicity violation: ${sellKeys[i]}=${current} > ${sellKeys[i+1]}=${next}`);
      return false;
    }
  }
  
  return true;
}

/**
 * Extract objective value from simulation result
 */
function getObjectiveValue(result: SimulationResult, objective: string): number {
  switch (objective) {
    case 'nav':
      return result.final_nav_usd;
    case 'cagr':
      return result.final_cagr_percent;
    case 'roi':
      return result.final_roi_percent;
    case 'sharpe':
      return result.sharpe_ratio;
    default:
      return result.final_cagr_percent; // Default to CAGR
  }
}

// =============================================================================
// Main Optimization Function
// =============================================================================

/**
 * Run grid search optimization
 * 
 * @param config - Optimization configuration
 * @param ciData - CI band daily data (sorted by close_date ascending)
 * @param params - Simulation parameters (upfront, monthly, fees)
 * @returns Optimization results with top N configurations
 */
export function optimizeParameters(
  config: OptimizationConfig,
  ciData: CIBandData[],
  params: SimulationParams
): OptimizationOutput {
  const startTime = Date.now();
  const objective = config.objective ?? 'cagr';
  const maxResults = config.max_results ?? 10;
  const progressInterval = config.progress_interval ?? 0.1; // 10% by default
  
  // Generate value arrays for each parameter to optimize
  const b_values: { [key: string]: number[] } = {};
  const b_keys = ['b1', 'b2', 'b3', 'b4', 'b5', 'b6', 'b7', 'b8', 'b9', 'b10', 'b11'];
  
  console.info(`baseConfig.B values: B1=${config.baseConfig.B.B1}, B2=${config.baseConfig.B.B2}, B3=${config.baseConfig.B.B3}, B6=${config.baseConfig.B.B6}, B7=${config.baseConfig.B.B7}`);
  
  for (const key of b_keys) {
    if (config.b_ranges && config.b_ranges[key as keyof typeof config.b_ranges]) {
      b_values[key] = rangeToArray(config.b_ranges[key as keyof typeof config.b_ranges]!);
      console.info(`${key}: Using range -> [${b_values[key].join(', ')}]`);
    } else {
      // Use base config value if not optimizing this parameter
      const bKey = key.toUpperCase() as keyof typeof config.baseConfig.B;
      b_values[key] = [config.baseConfig.B[bKey]];
      console.info(`${key}: Using base value -> [${b_values[key][0]}]`);
    }
  }
  
  // Generate momentum values
  const momo_lengths = config.momo_length_range
    ? rangeToArray(config.momo_length_range)
    : [config.baseConfig.momentumLength];
  
  const momo_thresholds = config.momo_threshold_range
    ? rangeToArray(config.momo_threshold_range)
    : [config.baseConfig.momentumThreshold];
  
  // Calculate total combinations
  let totalCombinations = 1;
  for (const key of b_keys) {
    totalCombinations *= b_values[key].length;
  }
  totalCombinations *= momo_lengths.length * momo_thresholds.length;
  
  console.info(`optimizeParameters: Testing ${totalCombinations} combinations for ${objective} optimization`);
  
  // Results storage
  const allResults: OptimizationResult[] = [];
  let combinationsTested = 0;
  let combinationsSkipped = 0;
  let lastProgressReport = 0;
  
  // Nested loops for grid search (B1-B11)
  for (const b1 of b_values.b1) {
    for (const b2 of b_values.b2) {
      for (const b3 of b_values.b3) {
        for (const b4 of b_values.b4) {
          for (const b5 of b_values.b5) {
            for (const b6 of b_values.b6) {
              for (const b7 of b_values.b7) {
                for (const b8 of b_values.b8) {
                  for (const b9 of b_values.b9) {
                    for (const b10 of b_values.b10) {
                      for (const b11 of b_values.b11) {
                        // Nested loops for momentum
                        for (const momoLen of momo_lengths) {
                          for (const momoThr of momo_thresholds) {
                            // Build config
                            const testConfig: StrategyConfig = {
                              B: { B1: b1, B2: b2, B3: b3, B4: b4, B5: b5, B6: b6, B7: b7, B8: b8, B9: b9, B10: b10, B11: b11 },
                              bearPauseEnterSigma: config.baseConfig.bearPauseEnterSigma,
                              bearPauseExitSigma: config.baseConfig.bearPauseExitSigma,
                              momentumLength: momoLen,
                              momentumThreshold: momoThr,
                              enableRetrace: config.baseConfig.enableRetrace,
                              retraceBase: config.baseConfig.retraceBase
                            };
                            
                            // Validate monotonicity constraint
                            if (!validateBMonotonicity(testConfig.B)) {
                              combinationsSkipped++;
                              continue;
                            }
                            
                            // Run simulation
                            try {
                              const simResult = runSimulation(testConfig, ciData, params);
                              const objectiveValue = getObjectiveValue(simResult, objective);
                              
                              // Debug first result
                              if (allResults.length === 0) {
                                console.info(`First simulation result: NAV=${simResult.final_nav_usd}, CAGR=${simResult.final_cagr_percent}, ROI=${simResult.final_roi_percent}`);
                                console.info(`Daily results count: ${simResult.daily_results?.length ?? 0}`);
                              }
                              
                              allResults.push({
                                config: testConfig,
                                simulation: simResult,
                                objective_value: objectiveValue
                              });
                            } catch (e) {
                              console.error(`Simulation failed for B1=${b1}, B2=${b2}: ${e.message}`);
                              combinationsSkipped++;
                              continue;
                            }
                            
                            combinationsTested++;
                            
                            // Progress reporting
                            if (config.onProgress) {
                              const progress = (combinationsTested + combinationsSkipped) / totalCombinations;
                              if (progress - lastProgressReport >= progressInterval) {
                                config.onProgress(
                                  combinationsTested + combinationsSkipped,
                                  totalCombinations,
                                  progress * 100
                                );
                                lastProgressReport = progress;
                              }
                            }
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  }
  
  // Sort results by objective (descending)
  allResults.sort((a, b) => b.objective_value - a.objective_value);
  
  // Assign ranks
  for (let i = 0; i < allResults.length; i++) {
    allResults[i].rank = i + 1;
  }
  
  // Get top N results
  const topResults = allResults.slice(0, maxResults);
  
  const executionTime = (Date.now() - startTime) / 1000;
  
  console.info(`optimizeParameters: Complete. Best ${objective}=${allResults[0]?.objective_value.toFixed(2) ?? 'N/A'}, tested=${combinationsTested}, skipped=${combinationsSkipped}, time=${executionTime.toFixed(1)}s`);
  
  return {
    best: allResults[0],
    top_results: topResults,
    combinations_tested: combinationsTested,
    combinations_skipped: combinationsSkipped,
    objective,
    execution_time_seconds: executionTime
  };
}

/**
 * Generate smart default ranges based on current config
 * Returns ranges centered around current values with ±20% variation
 * 
 * @param currentConfig - Current strategy configuration
 * @param gridSize - Number of points to test per parameter (default: 3)
 * @returns OptimizationConfig with smart default ranges
 */
export function generateSmartRanges(
  currentConfig: StrategyConfig,
  gridSize: number = 3
): Pick<OptimizationConfig, 'b_ranges' | 'momo_length_range' | 'momo_threshold_range'> {
  const variance = 0.2; // ±20%
  
  const createRange = (value: number): ParameterRange => {
    const min = value * (1 - variance);
    const max = value * (1 + variance);
    const step = (max - min) / (gridSize - 1);
    return { min, max, step };
  };
  
  return {
    b_ranges: {
      b1: createRange(currentConfig.B.B1),
      b2: createRange(currentConfig.B.B2),
      b3: createRange(currentConfig.B.B3),
      b4: createRange(currentConfig.B.B4),
      b5: createRange(currentConfig.B.B5),
      b6: createRange(currentConfig.B.B6),
      b7: createRange(currentConfig.B.B7),
      b8: createRange(currentConfig.B.B8),
      b9: createRange(currentConfig.B.B9),
      b10: createRange(currentConfig.B.B10),
      b11: createRange(currentConfig.B.B11)
    },
    momo_length_range: {
      min: Math.max(1, currentConfig.momentumLength - 2),
      max: currentConfig.momentumLength + 2,
      step: 1
    },
    momo_threshold_range: {
      min: Math.max(-0.05, currentConfig.momentumThreshold - 0.02),
      max: currentConfig.momentumThreshold + 0.02,
      step: 0.01
    }
  };
}

/**
 * Validate optimization configuration
 * Returns array of error messages (empty if valid)
 */
export function validateOptimizationConfig(config: OptimizationConfig): string[] {
  const errors: string[] = [];
  
  // Check that at least one parameter is being optimized
  const hasRanges = config.b_ranges || config.momo_length_range || config.momo_threshold_range;
  if (!hasRanges) {
    errors.push("No parameter ranges specified for optimization");
  }
  
  // Validate objective
  const validObjectives = ['nav', 'cagr', 'roi', 'sharpe'];
  if (config.objective && !validObjectives.includes(config.objective)) {
    errors.push(`Invalid objective: ${config.objective}. Must be one of: ${validObjectives.join(', ')}`);
  }
  
  // Validate ranges
  if (config.b_ranges) {
    for (const [key, range] of Object.entries(config.b_ranges)) {
      if (range) {
        if (range.min > range.max) {
          errors.push(`${key}: min (${range.min}) > max (${range.max})`);
        }
        if (range.step <= 0) {
          errors.push(`${key}: step must be > 0`);
        }
        if (range.min < 0 || range.max > 1) {
          errors.push(`${key}: values must be between 0 and 1 (percentages)`);
        }
      }
    }
  }
  
  if (config.momo_length_range) {
    if (config.momo_length_range.min < 1) {
      errors.push("momo_length_range: min must be >= 1");
    }
  }
  
  return errors;
}
