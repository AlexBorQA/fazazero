/**
 * Проверка условий срабатывания защитных аппаратов по ПУЭ-7 (п. 1.7.79)
 * и ГОСТ Р 50345-2010 / ГОСТ Р 50571.4.41.
 */

import type { BreakerCurveType, CircuitBreakerInput } from './types.ts';

export const STANDARD_BREAKER_RATINGS: readonly number[] = [
  6, 10, 16, 20, 25, 32, 40, 50, 63, 80, 100, 125, 160, 200, 250, 315, 400, 500, 630,
] as const;

/**
 * Кратность верхнего порога диапазона мгновенного срабатывания k_отс
 * по ГОСТ Р 50345-2010 (IEC 60898-1):
 * - B: 3...5 In (гарантированное срабатывание при 5 In)
 * - C: 5...10 In (гарантированное срабатывание при 10 In)
 * - D: 10...14 In (по ГОСТ Р 50345 / 10...20 In по ГОСТ Р 50030.2, принимаем 14 In)
 */
export const BREAKER_CURVE_MULTIPLIER: Record<Exclude<BreakerCurveType, 'custom'>, number> = {
  B: 5,
  C: 10,
  D: 14,
};

export interface BreakerEvaluationResult {
  ratedCurrentA: number;
  curve: string;
  instantaneousMultiplier: number;
  maxTripThresholdA: number; // Верхняя граница электромагнитного расцепителя I_отс
  safetyFactor: number; // Коэффициент надежности по ПУЭ (по умолчанию 1.1)
  requiredTripCurrentA: number; // Минимально необходимый расчетный ток КЗ: I_треб = k_над * I_отс
  actualTripRatio: number; // Кратность фактического тока: I_кз / I_n
  marginPercent: number; // Запас (+%) или дефицит (-%)
  isCompliant: boolean; // Выполняется ли ПУЭ п. 1.7.79
  tripTimeSeconds: number; // Время отключения при срабатывании отсечки (<= 0.1 c)
  statusText: string;
  recommendation?: string;
}

/**
 * Проверяет условие отключения выключателя по току однофазного КЗ
 */
export function evaluateBreakerTripping(
  breaker: CircuitBreakerInput,
  ik1A: number
): BreakerEvaluationResult {
  const safetyFactor = breaker.safetyFactor ?? 1.1;
  const ratedA = breaker.ratedCurrentA;
  const curve = breaker.curve ?? 'C';

  let multiplier: number;
  let maxTripThresholdA: number;

  if (breaker.customTripCurrentA !== undefined && breaker.customTripCurrentA > 0) {
    maxTripThresholdA = breaker.customTripCurrentA;
    multiplier = maxTripThresholdA / ratedA;
  } else if (curve === 'custom') {
    multiplier = 10;
    maxTripThresholdA = ratedA * multiplier;
  } else {
    multiplier = BREAKER_CURVE_MULTIPLIER[curve];
    maxTripThresholdA = ratedA * multiplier;
  }

  // Требуемый ток надежного отключения по п. 1.7.79 ПУЭ-7:
  // I_кз >= 1.1 * I_отс
  const requiredTripCurrentA = safetyFactor * maxTripThresholdA;
  const actualTripRatio = ratedA > 0 ? ik1A / ratedA : 0;
  const marginPercent = ((ik1A / requiredTripCurrentA) - 1) * 100;
  const isCompliant = ik1A >= requiredTripCurrentA;

  let statusText: string;
  let recommendation: string | undefined;

  if (isCompliant) {
    statusText = `Условие ПУЭ п. 1.7.79 выполнено (t ≤ 0.1 с). Запас по току отсечки: +${marginPercent.toFixed(1)}%`;
  } else {
    statusText = `ОТКАЗ: Ток КЗ (${ik1A.toFixed(1)} А) меньше требуемого (${requiredTripCurrentA.toFixed(1)} А). Дефицит: ${marginPercent.toFixed(1)}%`;

    if (curve === 'C' && ik1A >= safetyFactor * 5 * ratedA) {
      recommendation = `Замените кривую автомата с 'C' на 'B'. При характеристике B требуемый ток составит ${(safetyFactor * 5 * ratedA).toFixed(0)} А, условие ПУЭ будет выполнено.`;
    } else if (curve === 'D') {
      recommendation = `Характеристика 'D' требует слишком высокий ток (${requiredTripCurrentA.toFixed(0)} А). Перейдите на кривую 'C' или 'B'.`;
    } else {
      recommendation = `Увеличьте сечение нулевой/фазной жилы, сократите длину трассы либо установите УЗО / дифференциальный автомат в соответствии с п. 1.7.79 ПУЭ-7.`;
    }
  }

  return {
    ratedCurrentA: ratedA,
    curve: breaker.model ? `${breaker.model} (${curve}${ratedA})` : `${curve}${ratedA}`,
    instantaneousMultiplier: multiplier,
    maxTripThresholdA,
    safetyFactor,
    requiredTripCurrentA,
    actualTripRatio,
    marginPercent,
    isCompliant,
    tripTimeSeconds: isCompliant ? 0.1 : 5.0,
    statusText,
    recommendation,
  };
}
