/**
 * Модуль инженерного анализа, генерации альтернатив и устранения коллизий ПУЭ-7 (п. 1.7.79).
 * Предоставляет Smart Auto-Fix и ручной выбор корректирующих проектных решений.
 */

import type {
  PowerSourceInput,
  ParsedCableLine,
  LineCorrectionType,
  CorrectionOption,
  LineRemediationRecord,
  BreakerCurveType,
  CalculationResult,
} from './types.ts';
import { STANDARD_CROSS_SECTIONS } from './cables.ts';
import { calculatePhaseZeroLoop } from './calculator.ts';
import { VAULT_MOTOR_STEMS } from './vault.ts';

/**
 * Словарь корней слов, однозначно идентифицирующих технологическую двигательную нагрузку
 * (вентиляторы, насосы, дымоудаление, лифты, компрессоры, приводы ворот).
 * Для таких нагрузок применение расцепителей кривой «B» недопустимо из-за пусковых токов!
 * (Загружается из защищенного хранилища)
 */
const MOTOR_STEMS: readonly string[] = VAULT_MOTOR_STEMS;

/**
 * Регулярное выражение для проектных шифров систем с двигателями (П-1, В-2, ДУ-1, ТЗ-1),
 * исключающее ложные срабатывания внутри слов (например "ЩК1", "Комп1", "Корпус 1").
 */
const SYSTEM_CODE_REGEX = /(?:^|[\s_.,/\\№"()«»-])(п|в|ду|пд|кнс|тз)[-_ ]?\d+(?:$|[\s_.,/\\№"()«»-])/i;

/**
 * Определяет, является ли нагрузка двигательной (с высокими пусковыми токами)
 */
export function isMotorLoad(consumerName: string): boolean {
  if (!consumerName) return false;
  const lower = consumerName.toLowerCase();
  if (MOTOR_STEMS.some((stem) => lower.includes(stem))) {
    return true;
  }
  return SYSTEM_CODE_REGEX.test(consumerName);
}

/**
 * Возвращает следующее стандартное сечение кабеля по ГОСТ 22483-2021
 */
export function getNextStandardSection(currentSectionMm2: number): number {
  for (const s of STANDARD_CROSS_SECTIONS) {
    if (s > currentSectionMm2) {
      return s;
    }
  }
  return currentSectionMm2;
}

/**
 * Рассчитывает контрольную петлю для одиночной линии
 */
function calcLineLoop(
  line: ParsedCableLine,
  powerSource: PowerSourceInput,
  overrides?: {
    curve?: BreakerCurveType;
    phaseSectionMm2?: number;
    zeroSectionMm2?: number;
  }
): CalculationResult {
  const curve = overrides?.curve ?? line.breakerCurve;
  const phaseSection = overrides?.phaseSectionMm2 ?? line.phaseSectionMm2;
  const zeroSection = overrides?.zeroSectionMm2 ?? line.zeroSectionMm2;

  return calculatePhaseZeroLoop({
    powerSource,
    sections: [
      {
        name: line.lineNumber,
        material: line.material,
        phaseCrossSectionMm2: phaseSection,
        zeroCrossSectionMm2: zeroSection,
        lengthMeters: line.lengthM,
        conductorTempC: 65,
      },
    ],
    circuitBreaker: {
      model: line.breakerModel,
      ratedCurrentA: line.breakerRatedA,
      curve,
      safetyFactor: 1.1,
    },
  });
}

/**
 * Определяет целевое сечение жил при выборе стратегии увеличения сечения.
 * Если 1 ступени недостаточно для выполнения п. 1.7.79, подбирает 2-ю ступень.
 * Расчет всегда ведется с исходной характеристикой расцепителя (origCurve).
 */
export function determineTargetSectionUp(
  line: ParsedCableLine,
  powerSource: PowerSourceInput
): number {
  const origCurve = line.originalBreakerCurve ?? line.breakerCurve;
  const origSection = line.originalPhaseSectionMm2 ?? line.phaseSectionMm2;
  let nextSection = getNextStandardSection(origSection);
  const calc1 = calcLineLoop(line, powerSource, {
    curve: origCurve,
    phaseSectionMm2: nextSection,
    zeroSectionMm2: nextSection,
  });

  if (!calc1.isPueCompliant && nextSection < 240) {
    const secondStep = getNextStandardSection(nextSection);
    const calc2 = calcLineLoop(line, powerSource, {
      curve: origCurve,
      phaseSectionMm2: secondStep,
      zeroSectionMm2: secondStep,
    });
    if (calc2.isPueCompliant) {
      return secondStep;
    }
  }
  return nextSection;
}

/**
 * Генерирует инженерные варианты решений для линии:
 * Оценивает варианты ВСЕГДА относительно базового (исходного) состояния линии,
 * чтобы при выборе любого решения альтернативы НЕ исчезали из интерфейса!
 */
export function generateLineCorrections(
  line: ParsedCableLine,
  powerSource: PowerSourceInput
): CorrectionOption[] {
  const origCurve = line.originalBreakerCurve ?? line.breakerCurve;
  const origPhase = line.originalPhaseSectionMm2 ?? line.phaseSectionMm2;
  const origZero = line.originalZeroSectionMm2 ?? line.zeroSectionMm2;

  // Базовый расчет исходного состояния линии
  const baseCalc = calcLineLoop(line, powerSource, {
    curve: origCurve,
    phaseSectionMm2: origPhase,
    zeroSectionMm2: origZero,
  });

  const options: CorrectionOption[] = [];
  const isMotor = isMotorLoad(line.consumerName);

  // 0. Вариант «none» (Исходный проектный вид)
  options.push({
    type: 'none',
    title: `Исходный: ${origCurve}${line.breakerRatedA}`,
    badgeText: baseCalc.isPueCompliant ? '✅ Соответствует' : '❌ Отказ',
    description: baseCalc.isPueCompliant
      ? `Запас по отсечке: +${baseCalc.marginPercent.toFixed(1)}%`
      : `Дефицит тока КЗ: ${Math.abs(baseCalc.marginPercent).toFixed(1)}% (I_кз = ${baseCalc.ik1A.toFixed(1)} А < ${baseCalc.requiredTripCurrentA.toFixed(1)} А)`,
    targetBreakerCurve: origCurve,
    targetPhaseSectionMm2: origPhase,
    targetZeroSectionMm2: origZero,
    projectedIk1A: baseCalc.ik1A,
    projectedMarginPercent: baseCalc.marginPercent,
    isPueCompliant: baseCalc.isPueCompliant,
    rationale: baseCalc.isPueCompliant
      ? 'Проектные решения полностью удовлетворяют требованиям п. 1.7.79 ПУЭ-7.'
      : 'Отказ по п. 1.7.79 ПУЭ-7: расчетный ток КЗ недостаточен для срабатывания мгновенной электромагнитной отсечки.',
  });

  // Если исходная линия УЖЕ удовлетворяла нормам без каких-либо коррекций, альтернативы не требуются
  if (baseCalc.isPueCompliant) {
    return options;
  }

  // 1. ВАРИАНТ А: Перевод автомата на характеристику «B» (отсечка 5·In)
  if (origCurve !== 'B') {
    const calcB = calcLineLoop(line, powerSource, {
      curve: 'B',
      phaseSectionMm2: origPhase,
      zeroSectionMm2: origZero,
    });
    const optB: CorrectionOption = {
      type: 'curve_b',
      title: `Замена на кривую B (B${line.breakerRatedA})`,
      badgeText: `Кривая B${line.breakerRatedA}`,
      description: `Порог отсечки снижен до 5·In (${calcB.requiredTripCurrentA.toFixed(1)} А). Запас: +${calcB.marginPercent.toFixed(1)}%`,
      targetBreakerCurve: 'B',
      targetPhaseSectionMm2: origPhase,
      targetZeroSectionMm2: origZero,
      projectedIk1A: calcB.ik1A,
      projectedMarginPercent: calcB.marginPercent,
      isPueCompliant: calcB.isPueCompliant,
      rationale: `п. 1.7.79 ПУЭ-7 (обеспечение автоматического отключения t ≤ 0.1 с при длине трассы L = ${line.lengthM} м за счет применения расцепителя с уставкой 5·In).`,
    };

    if (isMotor) {
      optB.isWarning = true;
      optB.warningText =
        '⚠️ Нагрузка содержит электродвигатель: возможен ложный срыв автомата кривой «B» при пусковых токах. Рекомендуется увеличение сечения кабеля.';
    }

    options.push(optB);
  }

  // 2. ВАРИАНТ Б: Увеличение сечения жил кабеля (с исходной кривой origCurve)
  const targetSection = determineTargetSectionUp(line, powerSource);
  const calcSection = calcLineLoop(line, powerSource, {
    curve: origCurve,
    phaseSectionMm2: targetSection,
    zeroSectionMm2: targetSection,
  });

  options.push({
    type: 'section_up',
    title: `Увеличение сечения жил до ${targetSection} мм²`,
    badgeText: `Сечение ${targetSection} мм²`,
    description: `Снижение сопротивления петли. Ток КЗ: ${calcSection.ik1A.toFixed(1)} А. Запас: +${calcSection.marginPercent.toFixed(1)}%`,
    targetBreakerCurve: origCurve,
    targetPhaseSectionMm2: targetSection,
    targetZeroSectionMm2: targetSection,
    projectedIk1A: calcSection.ik1A,
    projectedMarginPercent: calcSection.marginPercent,
    isPueCompliant: calcSection.isPueCompliant,
    rationale: `ГОСТ 28249-93 (снижение сопротивления цепи петли «фаза-ноль» с сохранением проектного типа расцепителя ${origCurve}${line.breakerRatedA}).`,
  });

  // 3. ВАРИАНТ В: Дифференциальная защита (АВДТ / УЗО с уставкой 30 мА)
  options.push({
    type: 'rcd_30ma',
    title: `Установка дифзащиты (АВДТ ${line.breakerRatedA} А / 30 мА)`,
    badgeText: 'АВДТ 30 мА (дифзащита)',
    description:
      'Гарантированное отключение поврежденного участка при токах утечки на землю за время t ≤ 0.04 с (п. 1.7.79 абз. 5 ПУЭ-7).',
    targetBreakerCurve: origCurve,
    targetPhaseSectionMm2: origPhase,
    targetZeroSectionMm2: origZero,
    projectedIk1A: baseCalc.ik1A,
    projectedMarginPercent: 100, // Условие п. 1.7.79 выполняется по дифференциальному току
    isPueCompliant: true,
    rationale:
      'п. 1.7.79 (абзац 5) ПУЭ-7: применение дифференциальной защиты (УЗО/АВДТ с IΔn ≤ 30 мА) в сетях TN при невозможности обеспечения нормируемого времени отключения автоматическим выключателем.',
  });

  // Отмечаем рекомендованный вариант
  const recommendedType = recommendSmartCorrection(line, options);
  for (const opt of options) {
    if (opt.type === recommendedType) {
      opt.isRecommended = true;
    }
  }

  return options;
}

/**
 * Интеллектуальный подбор оптимального решения (Smart Auto-Fix):
 * - Двигательная нагрузка -> приоритет: увеличение сечения (кривая B блокируется);
 * - Бытовые розетки и свет -> приоритет: перевод на кривую B (минимальная себестоимость);
 * - Длинные трассы (> 90 м), где сечение уже велико -> приоритет: АВДТ 30 мА.
 */
export function recommendSmartCorrection(
  line: ParsedCableLine,
  options: CorrectionOption[]
): LineCorrectionType {
  const isMotor = isMotorLoad(line.consumerName);

  const optB = options.find((o) => o.type === 'curve_b');
  const optSection = options.find((o) => o.type === 'section_up');
  const optRcd = options.find((o) => o.type === 'rcd_30ma');

  // Если нагрузка двигательная (вентиляция, насосы, лифты, дымоудаление)
  if (isMotor) {
    if (optSection && optSection.isPueCompliant) {
      return 'section_up';
    }
    if (optRcd) {
      return 'rcd_30ma';
    }
  }

  // Для статической нагрузки (освещение, розетки, компьютеры)
  if (optB && optB.isPueCompliant && !optB.isWarning) {
    return 'curve_b';
  }

  // Если кривой B не хватило или она не применима, пробуем увеличение сечения
  if (optSection && optSection.isPueCompliant) {
    return 'section_up';
  }

  // Универсальное резервное решение для длинных трасс
  return 'rcd_30ma';
}

/**
 * Формирует официальную запись для ведомости Экспертизы
 */
export function buildRemediationRecord(
  line: ParsedCableLine,
  type: LineCorrectionType,
  powerSource?: PowerSourceInput,
  sheetRef?: string
): LineRemediationRecord | undefined {
  if (type === 'none') {
    return undefined;
  }

  const origCurve = line.originalBreakerCurve ?? line.breakerCurve;
  const origPhase = line.originalPhaseSectionMm2 ?? line.phaseSectionMm2;
  const origCableMark = line.originalCableMark ?? line.cableMark;

  const origBreaker = `${origCurve}${line.breakerRatedA}`;
  const origCable = `${origCableMark} (${origPhase} мм²)`;

  let adoptedSolution = '';
  let rationale = '';
  let sheetNote = sheetRef || 'Лист схемы ЭОМ (корректировка проектного решения)';

  if (type === 'curve_b') {
    adoptedSolution = `Замена автоматического выключателя на характеристику «B» (B${line.breakerRatedA})`;
    rationale = `п. 1.7.79 ПУЭ-7 (обеспечение мгновенной отсечки t ≤ 0.1 с при длине L = ${line.lengthM} м)`;
    sheetNote = 'Лист однолинейной схемы щита (заменить характеристику расцепителя C на B)';
  } else if (type === 'section_up') {
    const targetSection =
      line.phaseSectionMm2 > origPhase
        ? line.phaseSectionMm2
        : powerSource
        ? determineTargetSectionUp(line, powerSource)
        : getNextStandardSection(origPhase);
    adoptedSolution = `Увеличение сечения жил кабеля до ${targetSection} мм²`;
    rationale = `ГОСТ 28249-93 (снижение сопротивления петли с сохранением проектной уставки ${origCurve}${line.breakerRatedA})`;
    sheetNote = 'Лист схемы щита и кабельный журнал (увеличить сечение кабельной линии)';
  } else if (type === 'rcd_30ma') {
    adoptedSolution = `Установка дифференциальной защиты (АВДТ ${line.breakerRatedA} А с током утечки IΔn ≤ 30 мА)`;
    rationale =
      'п. 1.7.79 (абз. 5) ПУЭ-7 (автоматическое отключение питания при повреждении изоляции посредством УЗО)';
    sheetNote = 'Лист схемы щита (добавление дифференциального модуля защиты 30 мА)';
  }

  return {
    lineNumber: line.lineNumber,
    consumerName: line.consumerName,
    originalBreaker: origBreaker,
    originalCable: origCable,
    appliedType: type,
    adoptedSolution,
    rationale,
    drawingSheetRef: sheetNote,
  };
}

/**
 * Применяет выбранное корректирующее решение к линии и обновляет расчет.
 * Корректно синхронизирует строки модели автомата (C16 -> B16) и марки кабеля (3х2.5 -> 3х4).
 */
export function applyCorrectionToLine(
  line: ParsedCableLine,
  type: LineCorrectionType,
  powerSource: PowerSourceInput
): ParsedCableLine {
  // Сохраняем исходные параметры, если они еще не были зафиксированы
  const originalBreakerCurve = line.originalBreakerCurve ?? line.breakerCurve;
  const originalBreakerModel = line.originalBreakerModel ?? line.breakerModel;
  const originalPhaseSectionMm2 = line.originalPhaseSectionMm2 ?? line.phaseSectionMm2;
  const originalZeroSectionMm2 = line.originalZeroSectionMm2 ?? line.zeroSectionMm2;
  const originalCableMark = line.originalCableMark ?? line.cableMark;

  let activeCurve: BreakerCurveType = originalBreakerCurve;
  let activeModel: string = originalBreakerModel;
  let activePhaseSection = originalPhaseSectionMm2;
  let activeZeroSection = originalZeroSectionMm2;
  let activeCableMark = originalCableMark;

  if (type === 'curve_b') {
    activeCurve = 'B';
    // Обновляем строку модели: заменяем C16 на B16, ВА47-29 C16 на ВА47-29 B16
    activeModel = originalBreakerModel.replace(/\bC(\d+)/i, 'B$1');
    if (!activeModel.includes('B')) {
      activeModel = `B${line.breakerRatedA}`;
    }
  } else if (type === 'section_up') {
    activePhaseSection = determineTargetSectionUp(line, powerSource);
    activeZeroSection = activePhaseSection;
    // Обновляем марку кабеля, если в ней зашито сечение: 3х2.5 -> 3х4, 5х4 -> 5х6
    activeCableMark = originalCableMark.replace(
      /(\d+)\s*[xXхХ]\s*(\d+(\.\d+)?)/,
      `$1х${activePhaseSection}`
    );
  }

  const updatedLine: ParsedCableLine = {
    ...line,
    originalBreakerCurve,
    originalBreakerModel,
    originalPhaseSectionMm2,
    originalZeroSectionMm2,
    originalCableMark,
    breakerCurve: activeCurve,
    breakerModel: activeModel,
    phaseSectionMm2: activePhaseSection,
    zeroSectionMm2: activeZeroSection,
    cableMark: activeCableMark,
    selectedCorrection: type,
  };

  // Пересчитываем линию
  const newCalc = calcLineLoop(updatedLine, powerSource, {
    curve: activeCurve,
    phaseSectionMm2: activePhaseSection,
    zeroSectionMm2: activeZeroSection,
  });

  // Для режима дифзащиты 30 мА фиксируем выполнение п. 1.7.79 по дифтоку
  if (type === 'rcd_30ma') {
    newCalc.isPueCompliant = true;
    newCalc.status = 'SUCCESS';
    newCalc.statusMessage = 'СООТВЕТСТВУЕТ ПУЭ-7 (по дифференциальной защите АВДТ 30 мА)';
    newCalc.marginPercent = Math.max(newCalc.marginPercent, 100);
  }

  updatedLine.calculation = newCalc;
  updatedLine.remediationRecord = buildRemediationRecord(updatedLine, type, powerSource);

  return updatedLine;
}

/**
 * Пакетное автоматическое устранение коллизий (Smart Auto-Fix на 100% ПУЭ-7)
 */
export function autoRemediateAllLines(
  lines: ParsedCableLine[],
  powerSource: PowerSourceInput
): {
  lines: ParsedCableLine[];
  remediatedCount: number;
  remediations: LineRemediationRecord[];
} {
  let remediatedCount = 0;
  const remediations: LineRemediationRecord[] = [];

  const updatedLines = lines.map((line) => {
    const origCurve = line.originalBreakerCurve ?? line.breakerCurve;
    const origPhase = line.originalPhaseSectionMm2 ?? line.phaseSectionMm2;
    const origZero = line.originalZeroSectionMm2 ?? line.zeroSectionMm2;

    const baseCalc = calcLineLoop(line, powerSource, {
      curve: origCurve,
      phaseSectionMm2: origPhase,
      zeroSectionMm2: origZero,
    });

    // Если исходная линия удовлетворяет нормам без правок
    if (baseCalc.isPueCompliant) {
      return {
        ...line,
        calculation: baseCalc,
        selectedCorrection: 'none' as LineCorrectionType,
        remediationRecord: undefined,
      };
    }

    // Если линия проблемная, генерируем варианты и подбираем лучший
    const options = generateLineCorrections(line, powerSource);
    const bestType = recommendSmartCorrection(line, options);

    const remediated = applyCorrectionToLine(line, bestType, powerSource);
    if (bestType !== 'none') {
      remediatedCount++;
      if (remediated.remediationRecord) {
        remediations.push(remediated.remediationRecord);
      }
    }
    return remediated;
  });

  return {
    lines: updatedLines,
    remediatedCount,
    remediations,
  };
}
