/**
 * Главный модуль расчета петли «фаза-ноль» и токов однофазного КЗ
 * по ГОСТ 28249-93 и ПУЭ-7 (п. 1.7.79).
 */

import type {
  PowerSourceInput,
  CableSectionInput,
  CircuitBreakerInput,
  CalculationSettings,
  CalculationResult,
  CascadeCalculationInput,
  CascadeCalculationResult,
  CascadeTierResult,
} from './types.ts';
import { calculateSourceImpedance } from './transformers.ts';
import { calculateCableSection } from './cables.ts';
import { evaluateBreakerTripping } from './circuitBreakers.ts';

export interface SingleLineCalculationInput {
  powerSource: PowerSourceInput;
  sections: CableSectionInput[];
  circuitBreaker: CircuitBreakerInput;
  settings?: CalculationSettings;
}

/**
 * Выполняет сквозной расчет одной распределительной или групповой линии
 */
export function calculatePhaseZeroLoop(input: SingleLineCalculationInput): CalculationResult {
  const { powerSource, sections, circuitBreaker, settings } = input;

  // 1. Расчет эквивалентного сопротивления источника (ТП или ВРУ)
  const source = calculateSourceImpedance(powerSource);

  // 2. Расчет многозвенной кабельной цепи
  const calculatedSections = sections.map((sec, idx) => calculateCableSection(sec, idx + 1));

  let cablesR = 0;
  let cablesX = 0;
  for (const sec of calculatedSections) {
    cablesR += sec.rTotalSectionOhm;
    cablesX += sec.xTotalSectionOhm;
  }

  // 3. Переходные сопротивления контактов и дуги
  const contactR = settings?.contactResistanceOhm ?? 0.015; // По ГОСТ 28249-93
  const arcR = settings?.arcResistanceOhm ?? 0.0; // 0 для металлического КЗ по ПУЭ

  // 4. Суммарное сопротивление петли «фаза-ноль»
  const totalR = source.rSourceOhm + cablesR + contactR + arcR;
  const totalX = source.xSourceOhm + cablesX;
  const loopZ = Math.hypot(totalR, totalX);

  // 5. Минимальный ток однофазного короткого замыкания (ГОСТ 28249-93)
  const uPhase = settings?.nominalPhaseVoltageV ?? 230; // В по ГОСТ 29322-2014
  const factorC = settings?.voltageFactorC ?? 1.0;
  const ik1A = loopZ > 0 ? (factorC * uPhase) / loopZ : 0;
  const ik1kA = ik1A / 1000;

  // 6. Проверка условий срабатывания защитного аппарата (ПУЭ-7 п. 1.7.79)
  const breakerEval = evaluateBreakerTripping(circuitBreaker, ik1A);

  return {
    sourceType: powerSource.type,
    sourceDescription: source.sourceDescription,
    sourceR_Ohm: source.rSourceOhm,
    sourceX_Ohm: source.xSourceOhm,
    sourceZ_Ohm: source.zSourceOhm,

    sections: calculatedSections,
    cablesR_Ohm: cablesR,
    cablesX_Ohm: cablesX,

    contactR_Ohm: contactR,
    arcR_Ohm: arcR,

    totalR_Ohm: totalR,
    totalX_Ohm: totalX,
    loopImpedanceZ_Ohm: loopZ,
    ik1A,
    ik1kA,

    breakerRatedA: breakerEval.ratedCurrentA,
    breakerCurve: breakerEval.curve,
    requiredTripCurrentA: breakerEval.requiredTripCurrentA,
    actualTripRatio: breakerEval.actualTripRatio,
    marginPercent: breakerEval.marginPercent,
    isPueCompliant: breakerEval.isCompliant,
    status: breakerEval.isCompliant ? 'SUCCESS' : 'FAILURE',
    statusMessage: breakerEval.statusText,
    recommendation: breakerEval.recommendation,
  };
}

/**
 * Выполняет сквозной каскадный расчет многозвенной магистрали (до 10 звеньев)
 * с независимой проверкой аппаратов защиты на каждом участке
 */
export function calculateCascade(input: CascadeCalculationInput): CascadeCalculationResult {
  const { powerSource, tiers, settings } = input;
  const source = calculateSourceImpedance(powerSource);

  const uPhase = settings?.nominalPhaseVoltageV ?? 230;
  const factorC = settings?.voltageFactorC ?? 1.0;
  const baseContactR = settings?.contactResistanceOhm ?? 0.015;
  const arcR = settings?.arcResistanceOhm ?? 0.0;

  let cumulativeLengthM = 0;
  let cumulativeCableR = 0;
  let cumulativeCableX = 0;

  let totalBreakersCount = 0;
  let passedBreakersCount = 0;
  let failedBreakersCount = 0;

  const tiersResults: CascadeTierResult[] = [];

  tiers.forEach((tier, idx) => {
    const calculatedSection = calculateCableSection(tier.cable, idx + 1);

    cumulativeLengthM += calculatedSection.lengthM;
    cumulativeCableR += calculatedSection.rTotalSectionOhm;
    cumulativeCableX += calculatedSection.xTotalSectionOhm;

    // Переходные контакты: базовые 0.015 Ом + 0.005 Ом на каждый последующий коммутационный узел
    const stageContactR = baseContactR + (idx > 0 ? idx * 0.005 : 0);

    const totalRAtTier = source.rSourceOhm + cumulativeCableR + stageContactR + arcR;
    const totalXAtTier = source.xSourceOhm + cumulativeCableX;
    const loopZAtTier = Math.hypot(totalRAtTier, totalXAtTier);

    const ik1A = loopZAtTier > 0 ? (factorC * uPhase) / loopZAtTier : 0;
    const ik1kA = ik1A / 1000;

    let evalResult;
    if (tier.circuitBreaker) {
      totalBreakersCount++;
      evalResult = evaluateBreakerTripping(tier.circuitBreaker, ik1A);
      if (evalResult.isCompliant) {
        passedBreakersCount++;
      } else {
        failedBreakersCount++;
      }
    }

    tiersResults.push({
      index: idx + 1,
      name: tier.name || `Участок ${idx + 1}`,
      section: calculatedSection,
      cumulativeLengthM,
      cumulativeR_Ohm: cumulativeCableR,
      cumulativeX_Ohm: cumulativeCableX,
      loopImpedanceZ_Ohm: loopZAtTier,
      ik1A,
      ik1kA,
      circuitBreaker: tier.circuitBreaker,
      breakerEvaluation: evalResult,
    });
  });

  const lastTier = tiersResults[tiersResults.length - 1];
  const lastTotalR = lastTier
    ? source.rSourceOhm +
      lastTier.cumulativeR_Ohm +
      (baseContactR + (tiersResults.length > 1 ? (tiersResults.length - 1) * 0.005 : 0)) +
      arcR
    : source.rSourceOhm;
  const lastTotalX = lastTier ? source.xSourceOhm + lastTier.cumulativeX_Ohm : source.xSourceOhm;
  const lastLoopZ = lastTier ? lastTier.loopImpedanceZ_Ohm : source.zSourceOhm;
  const lastIk1A = lastTier ? lastTier.ik1A : 0;
  const lastIk1kA = lastTier ? lastTier.ik1kA : 0;

  return {
    sourceType: powerSource.type,
    sourceDescription: source.sourceDescription,
    sourceR_Ohm: source.rSourceOhm,
    sourceX_Ohm: source.xSourceOhm,
    sourceZ_Ohm: source.zSourceOhm,

    tiers: tiersResults,
    totalLengthM: cumulativeLengthM,
    totalR_Ohm: lastTotalR,
    totalX_Ohm: lastTotalX,
    totalLoopImpedanceZ_Ohm: lastLoopZ,
    endIk1A: lastIk1A,
    endIk1kA: lastIk1kA,

    overallIsPueCompliant: totalBreakersCount > 0 ? failedBreakersCount === 0 : true,
    totalBreakersCount,
    passedBreakersCount,
    failedBreakersCount,
  };
}
