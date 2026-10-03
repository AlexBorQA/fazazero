import test from 'node:test';
import assert from 'node:assert';

import {
  isMotorLoad,
  getNextStandardSection,
  generateLineCorrections,
  recommendSmartCorrection,
  applyCorrectionToLine,
  autoRemediateAllLines,
} from '../remediation.ts';
import {
  generateLargeSampleExcelWorkbook,
  parseExcelWorkbook,
} from '../excelParser.ts';
import type { ParsedCableLine, PowerSourceInput } from '../types.ts';

const testPowerSource: PowerSourceInput = {
  type: 'transformer',
  transformerPowerKva: 630,
  transformerConnection: 'D/Yn-11',
};

test('remediation: детекция двигательной нагрузки (isMotorLoad)', () => {
  // Двигатели (пусковые токи)
  assert.strictEqual(isMotorLoad('Приточная венткамера П-1'), true);
  assert.strictEqual(isMotorLoad('Дымоудаление ДУ-2 автостоянки'), true);
  assert.strictEqual(isMotorLoad('Лифт пассажирский №1'), true);
  assert.strictEqual(isMotorLoad('Циркуляционный насос ЦН-1 ИТП'), true);
  assert.strictEqual(isMotorLoad('Тепловая завеса ворот ТЗ-1'), true);

  // Статическая / бытовая нагрузка
  assert.strictEqual(isMotorLoad('Освещение коридора 1 этажа'), false);
  assert.strictEqual(isMotorLoad('Розетки бытовой техники кухни'), false);
  assert.strictEqual(isMotorLoad('Серверная стойка ИБП'), false);
  assert.strictEqual(isMotorLoad('Мачты наружного освещения'), false);
});

test('remediation: переход на следующий типономинал сечения жил', () => {
  assert.strictEqual(getNextStandardSection(1.5), 2.5);
  assert.strictEqual(getNextStandardSection(2.5), 4);
  assert.strictEqual(getNextStandardSection(4), 6);
  assert.strictEqual(getNextStandardSection(6), 10);
  assert.strictEqual(getNextStandardSection(16), 25);
  assert.strictEqual(getNextStandardSection(240), 300);
});

test('remediation: генерация вариантов для бытовой розеточной линии (кухня 85 м, C16)', () => {
  const line: ParsedCableLine = {
    rowNumber: 5,
    lineNumber: 'ЩР-1. Гр. 5',
    consumerName: 'Розетки бытовой техники кухни',
    cableMark: 'ВВГнг(А)-LS 3х2.5',
    material: 'cu',
    phaseSectionMm2: 2.5,
    zeroSectionMm2: 2.5,
    lengthM: 85,
    breakerModel: 'ВА47-29',
    breakerRatedA: 16,
    breakerCurve: 'C',
    rawRow: {},
  };

  const options = generateLineCorrections(line, testPowerSource);
  assert.strictEqual(options.length, 4); // none, curve_b, section_up, rcd_30ma

  const optNone = options.find((o) => o.type === 'none')!;
  assert.strictEqual(optNone.isPueCompliant, false);
  assert.ok(optNone.projectedMarginPercent < 0);

  const optB = options.find((o) => o.type === 'curve_b')!;
  assert.strictEqual(optB.isPueCompliant, true);
  assert.ok(optB.projectedMarginPercent > 50); // Значительный запас
  assert.strictEqual(optB.isWarning, undefined); // Нет предупреждения, т.к. не двигатель

  const optSection = options.find((o) => o.type === 'section_up')!;
  assert.strictEqual(optSection.isPueCompliant, true);
  assert.strictEqual(optSection.targetPhaseSectionMm2, 4);

  const optRcd = options.find((o) => o.type === 'rcd_30ma')!;
  assert.strictEqual(optRcd.isPueCompliant, true);

  // Для бытовых розеток умный алгоритм должен предпочесть замену C -> B
  const recommended = recommendSmartCorrection(line, options);
  assert.strictEqual(recommended, 'curve_b');
});

test('remediation: защита от пусковых токов для двигателя вентилятора (ЩС-Вент. П3)', () => {
  const line: ParsedCableLine = {
    rowNumber: 25,
    lineNumber: 'ЩС-Вент. П3',
    consumerName: 'Приточная вентиляционная установка кровли П-3',
    cableMark: 'ВВГнг(А)-FRLS 5х4',
    material: 'cu',
    phaseSectionMm2: 4,
    zeroSectionMm2: 4,
    lengthM: 75,
    breakerModel: 'ВА47-29',
    breakerRatedA: 32,
    breakerCurve: 'C',
    rawRow: {},
  };

  const options = generateLineCorrections(line, testPowerSource);
  const optB = options.find((o) => o.type === 'curve_b')!;
  assert.strictEqual(optB.isWarning, true); // Должно быть предупреждение о ложном пуске!

  const optSection = options.find((o) => o.type === 'section_up')!;
  assert.strictEqual(optSection.targetPhaseSectionMm2, 6);
  assert.strictEqual(optSection.isPueCompliant, true);

  // Для двигателя умный алгоритм обязан выбрать увеличение сечения, а НЕ кривую B!
  const recommended = recommendSmartCorrection(line, options);
  assert.strictEqual(recommended, 'section_up');
});

test('remediation: пакетный Smart Auto-Fix на боевом щите ГРЩ (70 линий)', () => {
  const wbBuf = generateLargeSampleExcelWorkbook();
  const parsedLines = parseExcelWorkbook(wbBuf.buffer);

  assert.strictEqual(parsedLines.length, 70);

  // До исправления: проверяем наличие коллизий
  const resultBefore = autoRemediateAllLines(
    parsedLines.map((l) => ({ ...l, selectedCorrection: 'none' })),
    testPowerSource
  );

  // Проверяем работу авто-ремедиации
  const autoResult = autoRemediateAllLines(parsedLines, testPowerSource);

  assert.strictEqual(autoResult.remediatedCount, 5); // Ровно 5 проектных коллизий устранено
  assert.strictEqual(autoResult.remediations.length, 5);

  // Все 70 линий после авто-исправления должны стать 100% соответствующими ПУЭ
  const allCompliant = autoResult.lines.every((l) => l.calculation?.isPueCompliant === true);
  assert.strictEqual(allCompliant, true);

  // Проверяем, что двигатель вентиляции получил увеличение сечения, а не кривую B
  const ventLine = autoResult.lines.find((l) => l.lineNumber === 'ЩС-Вент. П3')!;
  assert.strictEqual(ventLine.selectedCorrection, 'section_up');
  assert.strictEqual(ventLine.phaseSectionMm2, 6);
  assert.strictEqual(ventLine.breakerCurve, 'C'); // Кривая C сохранена!

  // Проверяем, что бытовые розетки получили кривую B
  const kitchenLine = autoResult.lines.find((l) => l.lineNumber === 'ЩР-1. Гр. 5')!;
  assert.strictEqual(kitchenLine.selectedCorrection, 'curve_b');
  assert.strictEqual(kitchenLine.breakerCurve, 'B');
});
