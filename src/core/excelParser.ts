/**
 * Модуль умного парсинга кабельного журнала Excel (.xlsx / .xls / .csv)
 * 100% Client-Side на базе SheetJS (Zero-Server).
 */

import * as XLSX from 'xlsx';
import type {
  ConductorMaterial,
  CableSectionInput,
  CircuitBreakerInput,
  BreakerCurveType,
  PowerSourceInput,
  CalculationResult,
} from './types.ts';
import { calculatePhaseZeroLoop } from './calculator.ts';

export interface ParsedCableLine {
  rowNumber: number;
  lineNumber: string; // "ЩО-1", "Линия 1", "Гр. 3"
  consumerName: string; // "Освещение коридора", "Розетки кухни"
  cableMark: string; // "ВВГнг(А)-LS 3х2.5"
  material: ConductorMaterial;
  phaseSectionMm2: number;
  zeroSectionMm2: number;
  lengthM: number;
  breakerModel: string;
  breakerRatedA: number;
  breakerCurve: BreakerCurveType;
  rawRow: Record<string, any>;
  calculation?: CalculationResult;
}

export interface BatchCalculationSummary {
  totalLines: number;
  successCount: number;
  failureCount: number;
  lines: ParsedCableLine[];
}

/**
 * Определение материала проводника по марке кабеля или строке материала
 */
export function detectConductorMaterial(cableMark: string, materialStr?: string): ConductorMaterial {
  const combined = `${cableMark} ${materialStr ?? ''}`.trim().toLowerCase();
  // Алюминиевые кабели начинаются с 'а' (АВВГ, АСБ, АПвВ, Алюминий), кроме слова «кабель»
  if (/^(а|al)[а-яa-z]/i.test(cableMark.trim()) || combined.includes('алюм') || combined.includes('al')) {
    return 'al';
  }
  return 'cu';
}

/**
 * Парсинг строки сечения или марки кабеля: "3х2.5", "3x2,5", "4х70+1х35", "5х16", "ВВГ 3х1.5"
 */
export function parseCrossSections(str: string): { phaseSection: number; zeroSection: number } {
  if (!str) return { phaseSection: 2.5, zeroSection: 2.5 };

  const normalized = String(str).replace(/,/g, '.').replace(/[хxXХ]/g, 'x').toLowerCase();

  // Случай типа: 4x70+1x35 или 3x120+1x70
  const plusMatch = normalized.match(/(\d+)?x?(\d+(\.\d+)?)\s*\+\s*(\d+)?x?(\d+(\.\d+)?)/);
  if (plusMatch) {
    const s1 = parseFloat(plusMatch[2]);
    const s2 = parseFloat(plusMatch[5]);
    if (!isNaN(s1) && !isNaN(s2)) {
      return { phaseSection: s1, zeroSection: s2 };
    }
  }

  // Случай типа: 3x2.5, 5x16, 1x240
  const stdMatch = normalized.match(/(\d+)\s*x\s*(\d+(\.\d+)?)/);
  if (stdMatch) {
    const s = parseFloat(stdMatch[2]);
    if (!isNaN(s) && s > 0) {
      return { phaseSection: s, zeroSection: s };
    }
  }

  // Одиночное число: "2.5", "16", "2,5 мм2"
  const singleMatch = normalized.match(/(\d+(\.\d+)?)/);
  if (singleMatch) {
    const s = parseFloat(singleMatch[1]);
    if (!isNaN(s) && s > 0) {
      return { phaseSection: s, zeroSection: s };
    }
  }

  return { phaseSection: 2.5, zeroSection: 2.5 };
}

/**
 * Парсинг строки автомата: "C16", "ВА47-29 C 16", "B25", "16A", "D 32"
 */
export function parseCircuitBreaker(str: string): { ratedA: number; curve: BreakerCurveType; model: string } {
  if (!str) return { ratedA: 16, curve: 'C', model: 'C16' };

  const raw = String(str).trim();
  const normalized = raw.replace(/\s+/g, ' ');

  let curve: BreakerCurveType = 'C';
  let ratedA = 16;

  // Поиск кривой: B, C или D (латиница или кириллица В, С, D)
  const curveMatch = normalized.match(/\b([BCDВСвс])\s*(\d+)/i) || normalized.match(/([BCDВСвс])(\d+)/i);
  if (curveMatch) {
    const letter = curveMatch[1].toUpperCase();
    if (letter === 'B' || letter === 'В') curve = 'B';
    else if (letter === 'D') curve = 'D';
    else curve = 'C';

    ratedA = parseInt(curveMatch[2], 10);
  } else {
    // Если только число (например "16", "16А", "16 A")
    const numMatch = normalized.match(/(\d+)/);
    if (numMatch) {
      ratedA = parseInt(numMatch[1], 10);
    }
  }

  return {
    ratedA: ratedA > 0 ? ratedA : 16,
    curve,
    model: raw,
  };
}

/**
 * Умный поиск индексов колонок в заголовке таблицы
 */
interface ColumnMapping {
  lineCol: number;
  consumerCol: number;
  cableMarkCol: number;
  sectionCol: number;
  lengthCol: number;
  breakerCol: number;
}

export function detectColumns(headerRow: any[]): ColumnMapping {
  const mapping: ColumnMapping = {
    lineCol: -1,
    consumerCol: -1,
    cableMarkCol: -1,
    sectionCol: -1,
    lengthCol: -1,
    breakerCol: -1,
  };

  headerRow.forEach((cell, idx) => {
    if (cell === null || cell === undefined) return;
    const val = String(cell).toLowerCase().trim();

    // Номер линии / Обозначение
    if (mapping.lineCol === -1 && (val.includes('лини') || val.includes('номер') || val.includes('групп') || val.includes('№') || val.includes('маркировк') || val.includes('п/п') || val === 'пп')) {
      mapping.lineCol = idx;
    }
    // Потребитель
    if (mapping.consumerCol === -1 && (val.includes('наименован') || val.includes('потребител') || val.includes('электроприем') || val.includes('назначен') || val.includes('нагрузк'))) {
      mapping.consumerCol = idx;
    }
    // Марка кабеля
    if (mapping.cableMarkCol === -1 && (val.includes('марк') || val.includes('кабел') || val.includes('провод'))) {
      mapping.cableMarkCol = idx;
    }
    // Сечение
    if (mapping.sectionCol === -1 && (val.includes('сечен') || val.includes('жил') || val.includes('мм2') || val.includes('размер'))) {
      mapping.sectionCol = idx;
    }
    // Длина
    if (mapping.lengthCol === -1 && (val.includes('длин') || val === 'l' || val.includes('длина, м') || val.includes('l, м') || val.includes('l (м)'))) {
      mapping.lengthCol = idx;
    }
    // Автомат / Аппарат защиты
    if (mapping.breakerCol === -1 && (val.includes('автомат') || val.includes('выключател') || val.includes('аппарат') || val.includes('qf') || val.includes('номинал') || val.includes('защит'))) {
      mapping.breakerCol = idx;
    }
  });

  return mapping;
}

/**
 * Парсинг бинарного буфера Excel (ArrayBuffer)
 */
export function parseExcelWorkbook(buffer: ArrayBuffer): ParsedCableLine[] {
  const workbook = XLSX.read(buffer, { type: 'array' });
  const firstSheetName = workbook.SheetNames[0];
  if (!firstSheetName) return [];

  const worksheet = workbook.Sheets[firstSheetName];
  const rows: any[][] = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: '' });

  if (rows.length < 2) return [];

  // Поиск строки заголовка среди первых 5 строк
  let headerIndex = -1;
  let mapping: ColumnMapping = { lineCol: -1, consumerCol: -1, cableMarkCol: -1, sectionCol: -1, lengthCol: -1, breakerCol: -1 };

  for (let r = 0; r < Math.min(5, rows.length); r++) {
    const candidateMapping = detectColumns(rows[r]);
    // Если найдено хотя бы 2 ключевых столбца (например длина и сечение или автомат)
    const matchesCount = Object.values(candidateMapping).filter((idx) => idx !== -1).length;
    if (matchesCount >= 2) {
      headerIndex = r;
      mapping = candidateMapping;
      break;
    }
  }

  // Если заголовки не распознаны по именам, используем позиционную эвристику (колонка 0: линия, 1: марка, 2: длина, 3: автомат)
  if (headerIndex === -1) {
    headerIndex = 0;
    mapping = {
      lineCol: 0,
      consumerCol: 1,
      cableMarkCol: 2,
      sectionCol: 3,
      lengthCol: 4,
      breakerCol: 5,
    };
  }

  const result: ParsedCableLine[] = [];

  for (let r = headerIndex + 1; r < rows.length; r++) {
    const row = rows[r];
    if (!row || row.length === 0) continue;

    // Проверяем, есть ли хоть какие-то осмысленные данные
    const hasData = row.some((c) => c !== '' && c !== null && c !== undefined);
    if (!hasData) continue;

    const lineVal = mapping.lineCol !== -1 ? String(row[mapping.lineCol] ?? '').trim() : `Линия ${r}`;
    const consumerVal = mapping.consumerCol !== -1 ? String(row[mapping.consumerCol] ?? '').trim() : '';
    const cableMarkVal = mapping.cableMarkCol !== -1 ? String(row[mapping.cableMarkCol] ?? '').trim() : 'ВВГнг-LS';
    const sectionVal = mapping.sectionCol !== -1 ? String(row[mapping.sectionCol] ?? '').trim() : '';
    const lengthRaw = mapping.lengthCol !== -1 ? row[mapping.lengthCol] : 20;
    const breakerVal = mapping.breakerCol !== -1 ? String(row[mapping.breakerCol] ?? '').trim() : 'C16';

    // Длина линии в метрах
    let lengthM = typeof lengthRaw === 'number' ? lengthRaw : parseFloat(String(lengthRaw).replace(',', '.'));
    if (isNaN(lengthM) || lengthM <= 0) lengthM = 20;

    // Определение сечений: если в колонке сечения пусто, ищем в марке кабеля
    const combinedSectionStr = sectionVal || cableMarkVal;
    const { phaseSection, zeroSection } = parseCrossSections(combinedSectionStr);

    const material = detectConductorMaterial(cableMarkVal);
    const breaker = parseCircuitBreaker(breakerVal);

    result.push({
      rowNumber: r + 1,
      lineNumber: lineVal || `№ ${result.length + 1}`,
      consumerName: consumerVal,
      cableMark: cableMarkVal,
      material,
      phaseSectionMm2: phaseSection,
      zeroSectionMm2: zeroSection,
      lengthM,
      breakerModel: breaker.model,
      breakerRatedA: breaker.ratedA,
      breakerCurve: breaker.curve,
      rawRow: row,
    });
  }

  return result;
}

/**
 * Пакетный расчет массива линий по ГОСТ 28249-93 и ПУЭ-7
 */
export function calculateBatchLines(
  lines: ParsedCableLine[],
  powerSource: PowerSourceInput
): BatchCalculationSummary {
  let successCount = 0;
  let failureCount = 0;

  const calculatedLines = lines.map((line) => {
    const calc = calculatePhaseZeroLoop({
      powerSource,
      sections: [
        {
          name: line.consumerName ? `${line.lineNumber} (${line.consumerName})` : line.lineNumber,
          material: line.material,
          phaseCrossSectionMm2: line.phaseSectionMm2,
          zeroCrossSectionMm2: line.zeroSectionMm2,
          lengthMeters: line.lengthM,
        },
      ],
      circuitBreaker: {
        model: line.breakerModel,
        ratedCurrentA: line.breakerRatedA,
        curve: line.breakerCurve,
      },
    });

    if (calc.isPueCompliant) {
      successCount++;
    } else {
      failureCount++;
    }

    return {
      ...line,
      calculation: calc,
    };
  });

  return {
    totalLines: calculatedLines.length,
    successCount,
    failureCount,
    lines: calculatedLines,
  };
}

/**
 * Генерация эталонного шаблона Excel (.xlsx) для инженеров
 */
export function generateSampleExcelWorkbook(): Uint8Array {
  const data = [
    ['Номер линии', 'Наименование потребителя', 'Марка кабеля', 'Сечение жил, мм2', 'Длина, м', 'Аппарат защиты'],
    ['ЩО-1. Гр. 1', 'Рабочее освещение 1 этажа', 'ВВГнг(А)-LS', '3х1.5', 35, 'C10'],
    ['ЩО-1. Гр. 2', 'Аварийное освещение лестниц', 'ВВГнг(А)-FRLS', '3х1.5', 48, 'B10'],
    ['ЩР-1. Гр. 1', 'Компьютерные розетки офис 101', 'ВВГнг(А)-LS', '3х2.5', 28, 'C16'],
    ['ЩР-1. Гр. 2', 'Розетки бытовые коридор', 'ВВГнг(А)-LS', '3х2.5', 65, 'C16'],
    ['ЩР-1. Гр. 3', 'Бытовая техника кухни (длинная трасса)', 'ВВГнг(А)-LS', '3х2.5', 82, 'C16'],
    ['Ввод ЩС-1', 'Питание щита силовой вентиляции', 'ВБШвнг(А)', '4х35+1х16', 75, 'ВА88-32 100А'],
    ['ЩС-1. Гр. 1', 'Приточная установка П1', 'ВВГнг(А)-LS', '5х6', 22, 'C32'],
    ['ЩС-1. Гр. 2', 'Кондиционер серверной', 'ВВГнг(А)-LS', '3х4', 18, 'C25'],
  ];

  const ws = XLSX.utils.aoa_to_sheet(data);

  // Настройка ширины колонок
  ws['!cols'] = [
    { wch: 15 }, // Номер линии
    { wch: 38 }, // Наименование потребителя
    { wch: 18 }, // Марка кабеля
    { wch: 18 }, // Сечение жил
    { wch: 12 }, // Длина, м
    { wch: 18 }, // Аппарат защиты
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Кабельный журнал');

  const u8out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  return new Uint8Array(u8out);
}
