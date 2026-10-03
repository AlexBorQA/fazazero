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
  LineCorrectionType,
  CorrectionOption,
  LineRemediationRecord,
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
  // Поля инженерного устранения коллизий ПУЭ-7:
  originalBreakerCurve?: BreakerCurveType;
  originalBreakerModel?: string;
  originalPhaseSectionMm2?: number;
  originalZeroSectionMm2?: number;
  originalCableMark?: string;
  selectedCorrection?: LineCorrectionType;
  correctionOptions?: CorrectionOption[];
  remediationRecord?: LineRemediationRecord;
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

    if (line.selectedCorrection === 'rcd_30ma') {
      calc.isPueCompliant = true;
      calc.status = 'SUCCESS';
      calc.statusMessage = 'СООТВЕТСТВУЕТ ПУЭ-7 (по дифференциальной защите АВДТ 30 мА)';
      calc.marginPercent = Math.max(calc.marginPercent, 100);
    }

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

/**
 * Генерация развернутого боевого журнала ГРЩ (70 линий) для демонстрации
 * и нагрузочного тестирования проектов
 */
export function generateLargeSampleExcelWorkbook(): Uint8Array {
  const data = [
    ['Номер линии', 'Наименование потребителя', 'Марка кабеля', 'Сечение жил, мм2', 'Длина, м', 'Аппарат защиты'],
    // 1-5: Вводные и межсекционные силовые кабели
    ['Ввод №1 ТП', 'Основной ввод ГРЩ от ТП 630 кВА', 'ВБШвнг(А)', '4х150+1х70', 45, 'ВА88-37 400А'],
    ['Ввод №2 ДГУ', 'Резервный ввод от дизель-генератора 320 кВт', 'ВБШвнг(А)', '4х120+1х70', 35, 'ВА88-37 320А'],
    ['Секц. 1-2', 'Межсекционная перемычка ГРЩ (Секция 1 - Секция 2)', 'ВВГнг(А)-LS', '4х120+1х70', 8, 'ВА88-37 320А'],
    ['Ввод ИБП', 'Питание централизованного ИБП ЦОД 80 кВА', 'ВВГнг(А)-LS', '5х50', 25, 'ВА88-33 160А'],
    ['Выход ИБП', 'Распределительный щит гарантированного питания ЩГП', 'ВВГнг(А)-LS', '5х50', 18, 'ВА88-33 160А'],

    // 6-17: Распределительные стояки здания (ЩР, ЩЭ)
    ['Стояк ЩЭ-1', 'Питание этажного распределительного щита 1 этажа', 'ВВГнг(А)-LS', '5х25', 22, 'C63'],
    ['Стояк ЩЭ-2', 'Питание этажного распределительного щита 2 этажа', 'ВВГнг(А)-LS', '5х25', 28, 'C63'],
    ['Стояк ЩЭ-3', 'Питание этажного распределительного щита 3 этажа', 'ВВГнг(А)-LS', '5х25', 34, 'C63'],
    ['Стояк ЩЭ-4', 'Питание этажного распределительного щита 4 этажа', 'ВВГнг(А)-LS', '5х25', 40, 'C63'],
    ['Стояк ЩЭ-5', 'Питание этажного распределительного щита 5 этажа', 'ВВГнг(А)-LS', '5х25', 46, 'C63'],
    ['Стояк ЩЭ-6', 'Питание этажного распределительного щита 6 этажа', 'ВВГнг(А)-LS', '5х25', 52, 'C63'],
    ['Стояк ЩЭ-7', 'Питание этажного распределительного щита 7 этажа', 'ВВГнг(А)-LS', '5х35', 58, 'C80'],
    ['Стояк ЩЭ-8', 'Питание этажного распределительного щита 8 этажа', 'ВВГнг(А)-LS', '5х35', 64, 'C80'],
    ['Стояк ЩЭ-9', 'Питание этажного распределительного щита 9 этажа', 'ВВГнг(А)-LS', '5х35', 70, 'C80'],
    ['Стояк ЩЭ-10', 'Питание этажного распределительного щита 10 этажа', 'ВВГнг(А)-LS', '5х35', 76, 'C80'],
    ['ЩР-Аренда 1', 'Щит распределительный супермаркета 1 этаж', 'ВБШвнг(А)', '4х50+1х25', 38, 'ВА88-32 100А'],
    ['ЩР-Аренда 2', 'Щит распределительный ресторана 2 этаж', 'ВБШвнг(А)', '4х50+1х25', 45, 'ВА88-32 100А'],

    // 18-28: Противопожарная защита СПЗ (огнестойкие линии FRLS)
    ['ЩСПЗ-ДУ1', 'Вентилятор дымоудаления паркинга ВД1 (11 кВт)', 'ВВГнг(А)-FRLS', '5х6', 42, 'D25'],
    ['ЩСПЗ-ДУ2', 'Вентилятор дымоудаления атриума ВД2 (15 кВт)', 'ВВГнг(А)-FRLS', '5х10', 55, 'D32'],
    ['ЩСПЗ-ПД1', 'Вентилятор подпора воздуха лестничной клетки Н2 (7.5 кВт)', 'ВВГнг(А)-FRLS', '5х4', 48, 'D20'],
    ['ЩСПЗ-ПД2', 'Вентилятор подпора в лифтовые шахты (5.5 кВт)', 'ВВГнг(А)-FRLS', '5х4', 52, 'D16'],
    ['ЩСПЗ-ПН1', 'Рабочий насос пожаротушения Спринклер (22 кВт)', 'ВВГнг(А)-FRLS', '5х16', 30, 'D50'],
    ['ЩСПЗ-ПН2', 'Резервный насос пожаротушения Спринклер (22 кВт)', 'ВВГнг(А)-FRLS', '5х16', 32, 'D50'],
    ['ЩСПЗ-Жокей', 'Жокей-насос поддержания давления (2.2 кВт)', 'ВВГнг(А)-FRLS', '3х2.5', 28, 'C10'],
    ['ЩСПЗ-ОЗК1', 'Огнезадерживающие клапаны 1-5 этажи (привод)', 'ВВГнг(А)-FRLS', '3х1.5', 65, 'B10'],
    ['ЩСПЗ-ОЗК2', 'Огнезадерживающие клапаны 6-10 этажи (привод)', 'ВВГнг(А)-FRLS', '3х1.5', 85, 'B10'],
    ['ЩСПЗ-СОУЭ', 'Система оповещения и управления эвакуацией', 'ВВГнг(А)-FRLS', '3х2.5', 35, 'C10'],
    ['ЩСПЗ-Пож.лифт', 'Щит питания лифта для пожарных подразделений', 'ВВГнг(А)-FRLS', '5х16', 60, 'C40'],

    // 29-50: Групповые розеточные сети и силовые электроприемники
    ['ЩР-1. Гр. 1', 'Рабочие места опенспейс офис 101', 'ВВГнг(А)-LS', '3х2.5', 25, 'C16'],
    ['ЩР-1. Гр. 2', 'Компьютерная группа приемная директора', 'ВВГнг(А)-LS', '3х2.5', 32, 'C16'],
    ['ЩР-1. Гр. 3', 'Бытовые розетки коридора 1 этаж', 'ВВГнг(А)-LS', '3х2.5', 45, 'C16'],
    ['ЩР-1. Гр. 4', 'Копировальная техника и принтеры офис 105', 'ВВГнг(А)-LS', '3х2.5', 28, 'C16'],
    ['ЩР-1. Гр. 5', 'Бытовая техника кухни персонала (дальнее крыло)', 'ВВГнг(А)-LS', '3х2.5', 85, 'C16'],
    ['ЩР-1. Гр. 6', 'Пост охраны и видеонаблюдение КПП-1', 'ВВГнг(А)-LS', '3х2.5', 38, 'C16'],
    ['ЩР-2. Гр. 1', 'Розетки переговорная №1', 'ВВГнг(А)-LS', '3х2.5', 22, 'C16'],
    ['ЩР-2. Гр. 2', 'Розетки бухгалтерия каб. 204', 'ВВГнг(А)-LS', '3х2.5', 30, 'C16'],
    ['ЩР-2. Гр. 3', 'Серверные шкафы СКС этажа', 'ВВГнг(А)-LS', '3х2.5', 15, 'B16'],
    ['ЩР-2. Гр. 4', 'Кулер и вендинговые автоматы холл 2 этажа', 'ВВГнг(А)-LS', '3х2.5', 42, 'C16'],
    ['ЩР-3. Гр. 1', 'Рабочие места IT-отдел каб. 301', 'ВВГнг(А)-LS', '3х2.5', 26, 'C16'],
    ['ЩР-3. Гр. 2', 'Розетки уборочной техники (клининг) 3 этаж', 'ВВГнг(А)-LS', '3х2.5', 55, 'C16'],
    ['ЩР-3. Гр. 3', 'Конференц-зал мультимедиа стойка', 'ВВГнг(А)-LS', '3х2.5', 34, 'C16'],
    ['ЩР-4. Гр. 1', 'Рабочие места юридический отдел каб. 402', 'ВВГнг(А)-LS', '3х2.5', 29, 'C16'],
    ['ЩР-4. Гр. 2', 'Бытовые розетки зона ожидания 4 этаж', 'ВВГнг(А)-LS', '3х2.5', 48, 'C16'],
    ['ЩР-Цоколь. Гр. 1', 'Слесарная мастерская служба эксплуатации', 'ВВГнг(А)-LS', '3х2.5', 24, 'C16'],
    ['ЩР-Цоколь. Гр. 2', 'Розетки склад архивных документов цоколь', 'ВВГнг(А)-LS', '3х2.5', 82, 'C16'],
    ['ЩР-Цоколь. Гр. 3', 'Зарядная станция поломоечных машин', 'ВВГнг(А)-LS', '3х4', 28, 'C25'],
    ['ЩР-Паркинг. Гр. 1', 'Пост дежурного парковщика и шлагбаум', 'ВВГнг(А)-LS', '3х2.5', 40, 'C16'],
    ['ЩР-Паркинг. Гр. 2', 'Пылесос и подкачка шин паркинг -1 уровень', 'ВВГнг(А)-LS', '3х2.5', 50, 'C16'],
    ['ЩР-Паркинг. Гр. 3', 'Дренажные приямки паркинга (насос ГНОМ)', 'ВВГнг(А)-LS', '3х2.5', 32, 'C16'],
    ['ЩР-Паркинг. Гр. 4', 'Тепловая завеса въездных ворот паркинга ТЗ-1', 'ВВГнг(А)-LS', '5х2.5', 95, 'C20'],

    // 51-62: Рабочее, аварийное и наружное освещение
    ['ЩО-1. Гр. 1', 'Рабочее освещение офисы 1 этаж (LED)', 'ВВГнг(А)-LS', '3х1.5', 30, 'C10'],
    ['ЩО-1. Гр. 2', 'Аварийное эвакуационное освещение коридоров 1 этаж', 'ВВГнг(А)-FRLS', '3х1.5', 45, 'B10'],
    ['ЩО-2. Гр. 1', 'Рабочее освещение офисы 2 этаж (LED)', 'ВВГнг(А)-LS', '3х1.5', 32, 'C10'],
    ['ЩО-2. Гр. 2', 'Аварийное освещение лестницы Л1 и Л2', 'ВВГнг(А)-FRLS', '3х1.5', 50, 'B10'],
    ['ЩО-3. Гр. 1', 'Рабочее освещение офисы 3 этаж (LED)', 'ВВГнг(А)-LS', '3х1.5', 35, 'C10'],
    ['ЩО-4. Гр. 1', 'Рабочее освещение офисы 4 этаж (LED)', 'ВВГнг(А)-LS', '3х1.5', 38, 'C10'],
    ['ЩО-Паркинг 1', 'Освещение проездов паркинга уровень -1', 'ВВГнг(А)-LS', '3х1.5', 55, 'C10'],
    ['ЩО-Паркинг 2', 'Освещение парковочных мест сектор А и Б', 'ВВГнг(А)-LS', '3х1.5', 60, 'C10'],
    ['ЩО-Техподполье', 'Дежурное освещение технических коридоров подвала', 'ВВГнг(А)-LS', '3х1.5', 68, 'B10'],
    ['ЩО-Фасад 1', 'Архитектурная подсветка главного фасада здания', 'ВВГнг(А)-LS', '3х2.5', 65, 'C16'],
    ['ЩО-Фасад 2', 'Световые рекламные короба и вывески входа', 'ВВГнг(А)-LS', '3х2.5', 40, 'C16'],
    ['ЩО-Наружн. 1', 'Освещение гостевой автостоянки (мачты освещения)', 'ВВГнг(А)-LS', '3х1.5', 115, 'C10'],

    // 63-70: Инженерное и технологическое оборудование
    ['ЩС-ИТП. Ввод', 'Индивидуальный тепловой пункт здания (Ввод)', 'ВБШвнг(А)', '4х16+1х10', 35, 'ВА88-32 63А'],
    ['ЩС-ИТП. Насос 1', 'Сетевой циркуляционный насос отопления №1 (5.5 кВт)', 'ВВГнг(А)-LS', '5х4', 18, 'C20'],
    ['ЩС-ИТП. ГВС', 'Циркуляционный насос горячего водоснабжения (2.2 кВт)', 'ВВГнг(А)-LS', '3х2.5', 15, 'C16'],
    ['ЩС-Лифт 1', 'Главный пассажирский лифт №1 (Г/п 1000 кг)', 'ВВГнг(А)-LS', '5х10', 50, 'C32'],
    ['ЩС-Лифт 2', 'Грузопассажирский лифт №2 (Г/п 1600 кг)', 'ВВГнг(А)-LS', '5х16', 55, 'C40'],
    ['ЩС-Вент. П1', 'Приточная установка центрального кондиционирования П1', 'ВВГнг(А)-LS', '5х6', 32, 'C25'],
    ['ЩС-Вент. П3', 'Приточная вентиляционная камера кровли П3 (дальняя)', 'ВВГнг(А)-LS', '5х4', 75, 'C32'],
    ['ЩС-Сервер', 'Прецизионный кондиционер серверной ЦОД (12 кВт)', 'ВВГнг(А)-LS', '5х6', 22, 'C25'],
  ];

  const ws = XLSX.utils.aoa_to_sheet(data);

  // Настройка ширины колонок
  ws['!cols'] = [
    { wch: 18 }, // Номер линии
    { wch: 55 }, // Наименование потребителя
    { wch: 18 }, // Марка кабеля
    { wch: 18 }, // Сечение жил
    { wch: 12 }, // Длина, м
    { wch: 18 }, // Аппарат защиты
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Кабельный журнал ГРЩ');

  const u8out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  return new Uint8Array(u8out);
}

