/**
 * Типы данных инженерного ядра Fazazero (ГОСТ 28249-93 и ПУЭ-7)
 */

export type ConductorMaterial = 'cu' | 'al';

export type TransformerConnection = 'D/Yn-11' | 'Y/Yn-0';

export interface TransformerCatalogItem {
  powerKva: number; // Номинальная мощность, кВА (63...2500)
  connection: TransformerConnection; // Схема соединения обмоток
  voltageHighKv: number; // 10 или 6 кВ
  voltageLowKv: number; // 0.4 кВ
  ukPercent: number; // Напряжение короткого замыкания u_к, %
  pkKw: number; // Потери короткого замыкания P_к, кВт
  r1Ohm: number; // Активное сопротивление прямой последовательности, Ом
  x1Ohm: number; // Индуктивное сопротивление прямой последовательности, Ом
  r0Ohm: number; // Активное сопротивление нулевой последовательности, Ом
  x0Ohm: number; // Индуктивное сопротивление нулевой последовательности, Ом
}

export type PowerSourceType = 'transformer' | 'vru_tu';

export interface PowerSourceInput {
  type: PowerSourceType;
  // Для режима ТП:
  transformerPowerKva?: number;
  transformerConnection?: TransformerConnection;
  customTransformer?: Partial<TransformerCatalogItem>;
  // Для режима ВРУ (по ТУ сетевой организации):
  vruIk3kA?: number; // Ток 3-фазного КЗ на вводных клеммах ВРУ, кА (например 10.0, 15.0)
  vruXrRatio?: number; // Отношение X/R (по умолчанию 3.5)
}

export interface CableSectionInput {
  name?: string; // Наименование участка (например "ВРУ - ЩЭ-5", "Групповая линия розетки")
  material: ConductorMaterial; // 'cu' | 'al'
  phaseCrossSectionMm2: number; // Сечение фазной жилы, мм²
  zeroCrossSectionMm2: number; // Сечение нулевой (PE / PEN) жилы, мм²
  lengthMeters: number; // Длина участка цепи, м
  conductorTempC?: number; // Температура жилы (по ГОСТ 28249-93 принимается +65 °C, по умолчанию 65)
  inductivePerKmOhm?: number; // Индуктивное сопротивление петли фаза-ноль на 1 км (по умолчанию 0.07 Ом/км)
}

export type BreakerCurveType = 'B' | 'C' | 'D' | 'custom';

export interface CircuitBreakerInput {
  model?: string; // Модель выключателя (например "ВА47-29", "ВА88-32", "iC60N")
  ratedCurrentA: number; // Номинальный ток I_n, А (6, 10, 16, 20, 25, 32, 40, 50, 63, ...)
  curve?: BreakerCurveType; // Характеристика расцепителя B (5*In), C (10*In), D (20*In)
  customTripCurrentA?: number; // Прямой ввод тока мгновенного расцепителя I_inst / I_sd
  safetyFactor?: number; // Коэффициент надежности по ПУЭ (по умолчанию 1.1)
}

export interface CalculationSettings {
  nominalPhaseVoltageV?: number; // Фазное напряжение (по ГОСТ 29322-2014 = 230 В)
  nominalLineVoltageV?: number; // Линейное напряжение (400 В)
  voltageFactorC?: number; // Коэффициент напряжения по ГОСТ 28249-93 (c = 1.0)
  contactResistanceOhm?: number; // Суммарное сопротивление переходных контактов (по ГОСТ 0.015 Ом)
  arcResistanceOhm?: number; // Сопротивление электрической дуги (0 при металлическом КЗ по ПУЭ 1.7.79)
}

export interface CableSectionCalculation {
  index: number;
  name: string;
  lengthM: number;
  material: ConductorMaterial;
  phaseCrossSectionMm2: number;
  zeroCrossSectionMm2: number;
  rPhaseOhm: number;
  rZeroOhm: number;
  rTotalSectionOhm: number;
  xTotalSectionOhm: number;
  zTotalSectionOhm: number;
}

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

export interface CalculationResult {
  // Источник питания:
  sourceType: PowerSourceType;
  sourceDescription: string;
  sourceR_Ohm: number; // Эквивалентное R_ист в петле фаза-ноль
  sourceX_Ohm: number; // Эквивалентное X_ист в петле фаза-ноль
  sourceZ_Ohm: number;

  // Кабельные звенья:
  sections: CableSectionCalculation[];
  cablesR_Ohm: number; // Суммарное активное кабелей
  cablesX_Ohm: number; // Суммарное индуктивное кабелей

  // Переходные сопротивления:
  contactR_Ohm: number;
  arcR_Ohm: number;

  // Итог петли «фаза-ноль»:
  totalR_Ohm: number; // R_сум
  totalX_Ohm: number; // X_сум
  loopImpedanceZ_Ohm: number; // Z_п-н = sqrt(R^2 + X^2)
  ik1A: number; // Минимальный ток однофазного КЗ, А
  ik1kA: number; // Ток КЗ в кА

  // Проверка по ПУЭ-7 (п. 1.7.79):
  breakerRatedA: number; // I_n
  breakerCurve: string;
  requiredTripCurrentA: number; // I_отс_треб = k_над * I_сраб_макс (например 1.1 * 10 * 16 = 176 А)
  actualTripRatio: number; // Кратность I_кз(1) / I_n
  marginPercent: number; // Запас / дефицит: ((I_кз / I_отс_треб) - 1) * 100%
  isPueCompliant: boolean; // Выполняется ли ПУЭ (t <= 0.4 с при мгновенной отсечке t <= 0.1 c)
  status: 'SUCCESS' | 'FAILURE';
  statusMessage: string;
  recommendation?: string;
}

// -----------------------------------------------------------------------------
// Каскадный расчет многозвенной магистрали (Экран 2: "Каскадная магистраль")
// -----------------------------------------------------------------------------

export interface CascadeTierInput {
  name?: string; // Наименование звена ("Магистраль ВРУ - ГРЩ", "Стояк 1-5 этаж", "Групповой щит ЩО")
  cable: CableSectionInput; // Параметры кабельной линии участка
  circuitBreaker?: CircuitBreakerInput; // Аппарат защиты в начале данного участка
}

export interface CascadeCalculationInput {
  powerSource: PowerSourceInput;
  tiers: CascadeTierInput[];
  settings?: CalculationSettings;
}

export interface CascadeTierResult {
  index: number;
  name: string;
  section: CableSectionCalculation;
  cumulativeLengthM: number;
  cumulativeR_Ohm: number;
  cumulativeX_Ohm: number;
  loopImpedanceZ_Ohm: number;
  ik1A: number;
  ik1kA: number;
  circuitBreaker?: CircuitBreakerInput;
  breakerEvaluation?: BreakerEvaluationResult;
}

export interface CascadeCalculationResult {
  sourceType: PowerSourceType;
  sourceDescription: string;
  sourceR_Ohm: number;
  sourceX_Ohm: number;
  sourceZ_Ohm: number;

  tiers: CascadeTierResult[];
  totalLengthM: number;
  totalR_Ohm: number;
  totalX_Ohm: number;
  totalLoopImpedanceZ_Ohm: number;
  endIk1A: number; // Ток КЗ в самом конце всей магистрали
  endIk1kA: number;

  overallIsPueCompliant: boolean;
  totalBreakersCount: number;
  passedBreakersCount: number;
  failedBreakersCount: number;
}

// -----------------------------------------------------------------------------
// Стратегии устранения замечаний и проектных коллизий (п. 1.7.79 ПУЭ-7)
// -----------------------------------------------------------------------------

export type LineCorrectionType = 'none' | 'curve_b' | 'section_up' | 'rcd_30ma';

export interface CorrectionOption {
  type: LineCorrectionType;
  title: string;
  badgeText: string;
  description: string;
  isRecommended?: boolean;
  isWarning?: boolean;
  warningText?: string;
  targetBreakerCurve?: BreakerCurveType;
  targetPhaseSectionMm2?: number;
  targetZeroSectionMm2?: number;
  projectedIk1A: number;
  projectedMarginPercent: number;
  isPueCompliant: boolean;
  rationale: string; // Нормативное обоснование для экспертизы
}

export interface LineRemediationRecord {
  lineNumber: string; // Обозначение линии (например "ЩР-1. Гр. 5")
  consumerName: string; // "Розетки бытовой техники кухни"
  originalBreaker: string; // "C16 (16 А, кривая C)"
  originalCable: string; // "ВВГнг(А)-LS 3х2.5 мм²"
  appliedType: LineCorrectionType;
  adoptedSolution: string; // "Замена ВА на кривую B (B16)" / "Увеличение сечения до 3х4.0 мм²" / "Установка АВДТ 16А/30мА"
  rationale: string; // Ссылка на ГОСТ 28249-93 / п. 1.7.79 ПУЭ-7
  drawingSheetRef: string; // Рекомендация для графической части (например "Лист схемы ЭОМ")
}

