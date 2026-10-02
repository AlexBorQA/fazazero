/**
 * Справочник параметров кабелей и проводов по ГОСТ 22483-2021 и ГОСТ 28249-93.
 * Расчет активных и индуктивных сопротивлений жил с учетом рабочей температуры (+65 °C).
 */

import type { ConductorMaterial, CableSectionCalculation, CableSectionInput } from './types.ts';

/**
 * Удельное электрическое сопротивление металлов при 20 °C, Ом·мм²/м
 * (ГОСТ 28249-93 разд. 2, ГОСТ 22483-2021)
 */
export const RHO_20: Record<ConductorMaterial, number> = {
  cu: 0.0175, // Медь
  al: 0.0282, // Алюминий
};

/**
 * Температурный коэффициент сопротивления alpha, 1/°C
 */
export const ALPHA_TEMP: Record<ConductorMaterial, number> = {
  cu: 0.00393,
  al: 0.00403,
};

/**
 * Стандартный ряд сечений кабелей и проводов по ГОСТ 22483-2021, мм²
 */
export const STANDARD_CROSS_SECTIONS: readonly number[] = [
  1.5, 2.5, 4, 6, 10, 16, 25, 35, 50, 70, 95, 120, 150, 185, 240, 300, 400,
] as const;

/**
 * Таблица максимального электрического сопротивления постоянному току 1 км жилы при 20 °C (Ом/км)
 * по ГОСТ 22483-2021 (Класс 1 и 2)
 */
export const DC_RESISTANCE_20_OHM_KM: Record<ConductorMaterial, Record<number, number>> = {
  cu: {
    1.5: 12.1,
    2.5: 7.41,
    4: 4.61,
    6: 3.08,
    10: 1.83,
    16: 1.15,
    25: 0.727,
    35: 0.524,
    50: 0.387,
    70: 0.268,
    95: 0.193,
    120: 0.153,
    150: 0.124,
    185: 0.0991,
    240: 0.0754,
    300: 0.0601,
    400: 0.047,
  },
  al: {
    2.5: 12.1,
    4: 7.41,
    6: 4.61,
    10: 3.08,
    16: 1.91,
    25: 1.20,
    35: 0.868,
    50: 0.641,
    70: 0.443,
    95: 0.320,
    120: 0.253,
    150: 0.206,
    185: 0.164,
    240: 0.125,
    300: 0.100,
    400: 0.0778,
  },
};

/**
 * Коэффициент температурного пересчета сопротивления
 * ГОСТ 28249-93 (п. 2.2): при расчетах минимальных токов КЗ температура жил
 * принимается равной допустимой температуре при нормальной нагрузке (+65 °C).
 */
export function getTemperatureFactor(material: ConductorMaterial, tempC: number = 65): number {
  const alpha = ALPHA_TEMP[material];
  return 1 + alpha * (tempC - 20);
}

/**
 * Погонное индуктивное сопротивление петли фаза-ноль x_0 (Ом/км)
 * по ГОСТ 28249-93 (Приложение 2, Таблица 1 для 3-х и 4-х жильных кабелей 0.4 кВ)
 */
export function getDefaultInductiveReactancePerKm(crossSectionMm2: number): number {
  if (crossSectionMm2 <= 16) return 0.080;
  if (crossSectionMm2 <= 50) return 0.075;
  if (crossSectionMm2 <= 120) return 0.070;
  return 0.065;
}

/**
 * Расчет активного сопротивления жилы (Ом) с учетом длины, сечения и температуры
 */
export function calculateConductorResistance(
  material: ConductorMaterial,
  crossSectionMm2: number,
  lengthMeters: number,
  tempC: number = 65
): number {
  if (crossSectionMm2 <= 0 || lengthMeters <= 0) return 0;

  const tempFactor = getTemperatureFactor(material, tempC);

  // Сначала проверяем точную таблицу ГОСТ 22483-2021
  const tableR20 = DC_RESISTANCE_20_OHM_KM[material][crossSectionMm2];
  if (tableR20 !== undefined) {
    // R = R_табл(20°C) * k_темп * (L / 1000)
    return (tableR20 * tempFactor * lengthMeters) / 1000;
  }

  // Если сечение нестандартное, расчет по удельному сопротивлению
  const rho20 = RHO_20[material];
  return ((rho20 * tempFactor) * lengthMeters) / crossSectionMm2;
}

/**
 * Расчет параметров одного кабельного звена для петли «фаза-ноль»
 */
export function calculateCableSection(
  section: CableSectionInput,
  index: number = 1
): CableSectionCalculation {
  const tempC = section.conductorTempC ?? 65;
  const lengthM = section.lengthMeters;

  // Активное сопротивление фазной жилы при рабочей температуре
  const rPhase = calculateConductorResistance(
    section.material,
    section.phaseCrossSectionMm2,
    lengthM,
    tempC
  );

  // Активное сопротивление нулевой (PE / PEN) жилы при рабочей температуре
  const rZero = calculateConductorResistance(
    section.material,
    section.zeroCrossSectionMm2,
    lengthM,
    tempC
  );

  // Суммарное активное сопротивление проводников звена
  const rTotalSection = rPhase + rZero;

  // Индуктивное сопротивление петли участка
  const xPerKm = section.inductivePerKmOhm ?? getDefaultInductiveReactancePerKm(section.phaseCrossSectionMm2);
  const xTotalSection = (xPerKm * lengthM) / 1000;

  // Полное сопротивление участка
  const zTotalSection = Math.hypot(rTotalSection, xTotalSection);

  return {
    index,
    name: section.name ?? `Участок ${index} (${lengthM} м, ${section.phaseCrossSectionMm2}/${section.zeroCrossSectionMm2} мм²)`,
    lengthM,
    material: section.material,
    phaseCrossSectionMm2: section.phaseCrossSectionMm2,
    zeroCrossSectionMm2: section.zeroCrossSectionMm2,
    rPhaseOhm: rPhase,
    rZeroOhm: rZero,
    rTotalSectionOhm: rTotalSection,
    xTotalSectionOhm: xTotalSection,
    zTotalSectionOhm: zTotalSection,
  };
}
