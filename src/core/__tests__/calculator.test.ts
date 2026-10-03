import test from 'node:test';
import assert from 'node:assert';

import {
  calculateConductorResistance,
  getTemperatureFactor,
  calculateCableSection,
} from '../cables.ts';
import {
  calculateSourceImpedance,
  getTransformerParameters,
} from '../transformers.ts';
import {
  evaluateBreakerTripping,
} from '../circuitBreakers.ts';
import {
  calculatePhaseZeroLoop,
  calculateCascade,
} from '../calculator.ts';

test('cables: расчет сопротивления медной жилы при 20°C и 65°C', () => {
  // Для Cu 2.5 мм² по ГОСТ 22483-2021: R20 = 7.41 Ом/км
  // При длине 100 м: R20 = 0.741 Ом
  const r20 = calculateConductorResistance('cu', 2.5, 100, 20);
  assert.strictEqual(Math.round(r20 * 1000) / 1000, 0.741);

  // Температурный коэффициент при +65°C: 1 + 0.00393 * 45 ≈ 1.17685
  const factor65 = getTemperatureFactor('cu', 65);
  assert.ok(factor65 > 1.17 && factor65 < 1.18);

  const r65 = calculateConductorResistance('cu', 2.5, 100, 65);
  assert.ok(r65 > r20);
  assert.strictEqual(Math.round((r65 / r20) * 1000) / 1000, Math.round(factor65 * 1000) / 1000);
});

test('cables: расчет одного звена цепи (фаза + ноль + индуктивность)', () => {
  const section = calculateCableSection({
    name: 'Групповая линия розетки',
    material: 'cu',
    phaseCrossSectionMm2: 2.5,
    zeroCrossSectionMm2: 2.5,
    lengthMeters: 50,
  });

  assert.strictEqual(section.lengthM, 50);
  assert.ok(section.rPhaseOhm > 0);
  assert.strictEqual(section.rPhaseOhm, section.rZeroOhm); // Одинаковые сечения
  assert.ok(section.rTotalSectionOhm > section.rPhaseOhm);
  assert.ok(section.xTotalSectionOhm > 0);
  assert.ok(section.zTotalSectionOhm > section.rTotalSectionOhm);
});

test('transformers: параметры силового трансформатора 630 кВА', () => {
  const dy11 = getTransformerParameters(630, 'D/Yn-11');
  assert.strictEqual(dy11.powerKva, 630);
  assert.strictEqual(dy11.connection, 'D/Yn-11');
  assert.ok(dy11.r1Ohm > 0);
  assert.ok(dy11.x1Ohm > 0);

  // Для D/Yn-11 нулевая последовательность примерно равна прямой
  assert.strictEqual(dy11.r0Ohm, dy11.r1Ohm);
  assert.strictEqual(dy11.x0Ohm, dy11.x1Ohm);

  // Для Y/Yn-0 сопротивление нулевой последовательности резко выше
  const yy0 = getTransformerParameters(630, 'Y/Yn-0');
  assert.ok(yy0.x0Ohm > dy11.x0Ohm * 10);
});

test('transformers: расчет эквивалента ВРУ по ТУ (ток 3-фазного КЗ)', () => {
  const vruSource = calculateSourceImpedance({
    type: 'vru_tu',
    vruIk3kA: 12.5, // 12.5 кА
    vruXrRatio: 3.5,
  });

  assert.ok(vruSource.zSourceOhm > 0);
  assert.ok(vruSource.xSourceOhm > vruSource.rSourceOhm);
  // Проверка закона Ома: Uном / (sqrt(3) * Z) ≈ 12500 A
  const calculatedIk3 = 400 / (Math.sqrt(3) * vruSource.zSourceOhm);
  assert.ok(Math.abs(calculatedIk3 - 12500) < 5);
});

test('circuitBreakers: проверка условий срабатывания автомата C16 и B16', () => {
  // Для C16: I_отс = 10 * 16 = 160 A. С учетом k_над=1.1 требуемый ток = 176 А
  const evalC16_Pass = evaluateBreakerTripping({ ratedCurrentA: 16, curve: 'C' }, 220);
  assert.strictEqual(evalC16_Pass.isCompliant, true);
  assert.strictEqual(evalC16_Pass.requiredTripCurrentA, 176);
  assert.ok(evalC16_Pass.marginPercent > 0);

  // Ток КЗ = 140 А: автомат C16 не проходит
  const evalC16_Fail = evaluateBreakerTripping({ ratedCurrentA: 16, curve: 'C' }, 140);
  assert.strictEqual(evalC16_Fail.isCompliant, false);
  assert.ok(evalC16_Fail.marginPercent < 0);
  // Должна быть рекомендация заменить C на B (т.к. 140 А > 88 А для B16)
  assert.ok(evalC16_Fail.recommendation?.includes("кривую автомата с 'C' на 'B'"));

  // Для B16: I_отс = 5 * 16 = 80 A. Требуемый ток = 88 А -> 140 А проходит с запасом
  const evalB16_Pass = evaluateBreakerTripping({ ratedCurrentA: 16, curve: 'B' }, 140);
  assert.strictEqual(evalB16_Pass.isCompliant, true);
});

test('calculator: сквозной расчет петли «фаза-ноль» от ТП', () => {
  const result = calculatePhaseZeroLoop({
    powerSource: {
      type: 'transformer',
      transformerPowerKva: 630,
      transformerConnection: 'D/Yn-11',
    },
    sections: [
      {
        name: 'Питающая линия от ТП до ВРУ',
        material: 'al',
        phaseCrossSectionMm2: 120,
        zeroCrossSectionMm2: 70,
        lengthMeters: 80,
      },
      {
        name: 'Групповая линия розетки',
        material: 'cu',
        phaseCrossSectionMm2: 2.5,
        zeroCrossSectionMm2: 2.5,
        lengthMeters: 30,
      },
    ],
    circuitBreaker: {
      model: 'ВА47-29',
      ratedCurrentA: 16,
      curve: 'C',
    },
  });

  assert.strictEqual(result.sourceType, 'transformer');
  assert.strictEqual(result.sections.length, 2);
  assert.ok(result.totalR_Ohm > 0);
  assert.ok(result.totalX_Ohm > 0);
  assert.ok(result.loopImpedanceZ_Ohm > 0);
  assert.ok(result.ik1A > 0);
  assert.strictEqual(result.breakerRatedA, 16);
  assert.strictEqual(result.status, 'SUCCESS');
  assert.strictEqual(result.isPueCompliant, true);
  assert.ok(result.ik1A >= result.requiredTripCurrentA);
});

test('calculator: линия с большим сопротивлением вызывает отказ по ПУЭ', () => {
  const result = calculatePhaseZeroLoop({
    powerSource: {
      type: 'vru_tu',
      vruIk3kA: 8.0,
    },
    sections: [
      {
        name: 'Очень длинная линия освещения',
        material: 'cu',
        phaseCrossSectionMm2: 1.5,
        zeroCrossSectionMm2: 1.5,
        lengthMeters: 130, // 130 м 1.5 мм2 -> высокое сопротивление
      },
    ],
    circuitBreaker: {
      ratedCurrentA: 16,
      curve: 'C',
    },
  });

  // Ток КЗ должен быть ниже 176 А (уставка C16 с k_над=1.1)
  assert.ok(result.ik1A < 176);
  assert.strictEqual(result.status, 'FAILURE');
  assert.strictEqual(result.isPueCompliant, false);
  assert.ok(result.recommendation !== undefined);
});

test('calculateCascade: расчет каскадной магистрали с проверкой автоматов по ступеням', () => {
  const cascade = calculateCascade({
    powerSource: {
      type: 'transformer',
      transformerPowerKva: 630,
      transformerConnection: 'D/Yn-11',
    },
    tiers: [
      {
        name: 'Ступень 1: Магистраль ТП - ГРЩ',
        cable: {
          material: 'al',
          phaseCrossSectionMm2: 150,
          zeroCrossSectionMm2: 95,
          lengthMeters: 60,
        },
        circuitBreaker: {
          model: 'ВА88-37',
          ratedCurrentA: 250,
          curve: 'custom',
          customTripCurrentA: 2500, // Отсечка 10 In
        },
      },
      {
        name: 'Ступень 2: Стояк ГРЩ - ЩЭ',
        cable: {
          material: 'cu',
          phaseCrossSectionMm2: 16,
          zeroCrossSectionMm2: 16,
          lengthMeters: 30,
        },
        circuitBreaker: {
          model: 'ВА47-100',
          ratedCurrentA: 50,
          curve: 'C', // 10 In = 500 А, с k=1.1 => 550 А
        },
      },
      {
        name: 'Ступень 3: Групповая линия ЩЭ - Розетки',
        cable: {
          material: 'cu',
          phaseCrossSectionMm2: 2.5,
          zeroCrossSectionMm2: 2.5,
          lengthMeters: 25,
        },
        circuitBreaker: {
          model: 'ВА47-29',
          ratedCurrentA: 16,
          curve: 'C', // 10 In = 160 А, с k=1.1 => 176 А
        },
      },
    ],
  });

  assert.strictEqual(cascade.tiers.length, 3);
  assert.strictEqual(cascade.totalLengthM, 115); // 60 + 30 + 25
  assert.strictEqual(cascade.totalBreakersCount, 3);

  // Токи КЗ по ступеням строго убывают по мере удаления от источника
  const ik1 = cascade.tiers[0].ik1A;
  const ik2 = cascade.tiers[1].ik1A;
  const ik3 = cascade.tiers[2].ik1A;
  assert.ok(ik1 > ik2, `Ток на ступени 1 (${ik1} А) должен быть больше ступени 2 (${ik2} А)`);
  assert.ok(ik2 > ik3, `Ток на ступени 2 (${ik2} А) должен быть больше ступени 3 (${ik3} А)`);

  // Проверка срабатывания автоматов
  assert.strictEqual(cascade.tiers[0].breakerEvaluation?.isCompliant, true);
  assert.strictEqual(cascade.tiers[1].breakerEvaluation?.isCompliant, true);
  assert.strictEqual(cascade.tiers[2].breakerEvaluation?.isCompliant, true);
  assert.strictEqual(cascade.overallIsPueCompliant, true);
  assert.strictEqual(cascade.passedBreakersCount, 3);
  assert.strictEqual(cascade.failedBreakersCount, 0);
});

test('calculateCascade: фиксация отказа на проблемной ступени каскада', () => {
  const cascade = calculateCascade({
    powerSource: {
      type: 'vru_tu',
      vruIk3kA: 10.0,
    },
    tiers: [
      {
        name: 'Ступень 1: Вводной кабель',
        cable: { material: 'cu', phaseCrossSectionMm2: 25, zeroCrossSectionMm2: 25, lengthMeters: 20 },
        circuitBreaker: { ratedCurrentA: 63, curve: 'C' }, // 630 * 1.1 = 693 A
      },
      {
        name: 'Ступень 2: Заведомо длинная линия с завышенным автоматом',
        cable: { material: 'cu', phaseCrossSectionMm2: 2.5, zeroCrossSectionMm2: 2.5, lengthMeters: 90 },
        circuitBreaker: { ratedCurrentA: 25, curve: 'C' }, // 250 * 1.1 = 275 A
      },
    ],
  });

  // Ступень 1 проходит
  assert.strictEqual(cascade.tiers[0].breakerEvaluation?.isCompliant, true);
  // Ступень 2 не проходит (длина 90 м при сечении 2.5 дает ток КЗ около 150 А, что меньше 275 А)
  assert.strictEqual(cascade.tiers[1].breakerEvaluation?.isCompliant, false);
  assert.strictEqual(cascade.overallIsPueCompliant, false);
  assert.strictEqual(cascade.passedBreakersCount, 1);
  assert.strictEqual(cascade.failedBreakersCount, 1);
});
