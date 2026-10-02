import test from 'node:test';
import assert from 'node:assert';

import {
  detectConductorMaterial,
  parseCrossSections,
  parseCircuitBreaker,
  detectColumns,
  generateSampleExcelWorkbook,
  parseExcelWorkbook,
  calculateBatchLines,
} from '../excelParser.ts';

test('excelParser: определение материала жилы (Cu / Al)', () => {
  assert.strictEqual(detectConductorMaterial('ВВГнг-LS'), 'cu');
  assert.strictEqual(detectConductorMaterial('NYM-J 3x2.5'), 'cu');
  assert.strictEqual(detectConductorMaterial('АВВГ 4x16'), 'al');
  assert.strictEqual(detectConductorMaterial('АПвБШп 4x120'), 'al');
  assert.strictEqual(detectConductorMaterial('Кабель силовой', 'Алюминий'), 'al');
  assert.strictEqual(detectConductorMaterial('Кабель ВБШвнг'), 'cu');
});

test('excelParser: парсинг сечений фазы и нуля', () => {
  // 3x2.5
  const s1 = parseCrossSections('3x2.5');
  assert.strictEqual(s1.phaseSection, 2.5);
  assert.strictEqual(s1.zeroSection, 2.5);

  // 3х2,5 (русская х и запятая)
  const s2 = parseCrossSections('ВВГнг 3х2,5');
  assert.strictEqual(s2.phaseSection, 2.5);
  assert.strictEqual(s2.zeroSection, 2.5);

  // 4х70+1х35 (неполнофазный ноль)
  const s3 = parseCrossSections('ВБШвнг 4х70+1х35');
  assert.strictEqual(s3.phaseSection, 70);
  assert.strictEqual(s3.zeroSection, 35);

  // Одиночное число "16 мм2"
  const s4 = parseCrossSections('16 мм2');
  assert.strictEqual(s4.phaseSection, 16);
  assert.strictEqual(s4.zeroSection, 16);
});

test('excelParser: парсинг автоматов защиты', () => {
  const b1 = parseCircuitBreaker('C16');
  assert.strictEqual(b1.ratedA, 16);
  assert.strictEqual(b1.curve, 'C');

  const b2 = parseCircuitBreaker('ВА47-29 B 25');
  assert.strictEqual(b2.ratedA, 25);
  assert.strictEqual(b2.curve, 'B');

  const b3 = parseCircuitBreaker('D 32A');
  assert.strictEqual(b3.ratedA, 32);
  assert.strictEqual(b3.curve, 'D');

  // Русская буква С
  const b4 = parseCircuitBreaker('С10');
  assert.strictEqual(b4.ratedA, 10);
  assert.strictEqual(b4.curve, 'C');
});

test('excelParser: автоопределение колонок кабельного журнала', () => {
  const headers = ['№ линии', 'Потребитель', 'Марка провода', 'Сечение, мм2', 'Длина, м', 'Аппарат защиты QF'];
  const mapping = detectColumns(headers);

  assert.strictEqual(mapping.lineCol, 0);
  assert.strictEqual(mapping.consumerCol, 1);
  assert.strictEqual(mapping.cableMarkCol, 2);
  assert.strictEqual(mapping.sectionCol, 3);
  assert.strictEqual(mapping.lengthCol, 4);
  assert.strictEqual(mapping.breakerCol, 5);
});

test('excelParser: генерация шаблона Excel и обратный парсинг', () => {
  const u8 = generateSampleExcelWorkbook();
  assert.ok(u8.length > 100);

  const lines = parseExcelWorkbook(u8.buffer);
  assert.strictEqual(lines.length, 8); // 8 строк данных в шаблоне

  const line1 = lines[0];
  assert.strictEqual(line1.lineNumber, 'ЩО-1. Гр. 1');
  assert.strictEqual(line1.consumerName, 'Рабочее освещение 1 этажа');
  assert.strictEqual(line1.phaseSectionMm2, 1.5);
  assert.strictEqual(line1.lengthM, 35);
  assert.strictEqual(line1.breakerRatedA, 10);
  assert.strictEqual(line1.breakerCurve, 'C');
});

test('excelParser: пакетный расчет массива линий и статистика', () => {
  const u8 = generateSampleExcelWorkbook();
  const lines = parseExcelWorkbook(u8.buffer);

  const summary = calculateBatchLines(lines, {
    type: 'transformer',
    transformerPowerKva: 630,
    transformerConnection: 'D/Yn-11',
  });

  assert.strictEqual(summary.totalLines, 8);
  assert.ok(summary.successCount > 0);
  // Длинная линия 82 м 3x2.5 под C16 должна выдать замечание
  const longLine = summary.lines.find((l) => l.lengthM === 82);
  assert.ok(longLine);
  assert.strictEqual(longLine?.calculation?.isPueCompliant, false);
  assert.ok(summary.failureCount >= 1);
});
