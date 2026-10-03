import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  generateDocxBuffer,
  generateDocxBlob,
  type DocxReportInput,
} from '../docxGenerator.ts';

describe('docxGenerator: официальный том по ГОСТ 2.105-95 и ПУЭ-7', () => {
  it('формирует корректный буфер .docx для распределительного щита', async () => {
    const reportInput: DocxReportInput = {
      projectTitle: 'Жилой комплекс «Северная Звезда»',
      projectCode: '2026-ЭОМ-РР',
      panelName: 'ГРЩ-1 (Секция 1)',
      companyName: 'ООО «ГлавПроектИнжиниринг»',
      authorName: 'Петров И.С.',
      checkerName: 'Сидоров В.А.',
      dateStr: 'Октябрь 2026 г.',
      powerSource: {
        type: 'transformer',
        transformerPowerKva: 630,
        transformerConnection: 'D/Yn-11',
      },
      lines: [
        {
          lineNumber: 'ЩО-1. Гр. 1',
          consumerName: 'Рабочее освещение коридора',
          cableMark: 'ВВГнг(А)-LS',
          material: 'cu',
          phaseSectionMm2: 1.5,
          zeroSectionMm2: 1.5,
          lengthM: 35,
          breakerModel: 'ВА47-29',
          breakerRatedA: 10,
          breakerCurve: 'C',
        },
        {
          lineNumber: 'ЩР-1. Гр. 5',
          consumerName: 'Розетки бытовой техники кухни',
          cableMark: 'ВВГнг(А)-LS',
          material: 'cu',
          phaseSectionMm2: 2.5,
          zeroSectionMm2: 2.5,
          lengthM: 82,
          breakerModel: 'ВА47-29',
          breakerRatedA: 16,
          breakerCurve: 'C',
        },
      ],
    };

    const buffer = await generateDocxBuffer(reportInput);
    assert.ok(buffer instanceof Uint8Array, 'Результат должен быть Uint8Array');
    assert.ok(buffer.length > 5000, `Размер буфера должен быть весомым, получено ${buffer.length} байт`);

    // Проверка сигнатуры ZIP (PK\x03\x04), так как .docx — это zip-архив
    assert.strictEqual(buffer[0], 0x50, 'Сигнатура ZIP (P)');
    assert.strictEqual(buffer[1], 0x4b, 'Сигнатура ZIP (K)');
  });

  it('формирует валидный Blob для скачивания в браузере', async () => {
    const reportInput: DocxReportInput = {
      panelName: 'ЩЭ-4',
      powerSource: {
        type: 'vru_tu',
        vruIk3kA: 10.0,
        vruXrRatio: 3.5,
      },
      lines: [
        {
          lineNumber: 'Линия 1',
          consumerName: 'Ввод в квартиру',
          cableMark: 'ВВГнг(А)-FRLS',
          material: 'cu',
          phaseSectionMm2: 10,
          zeroSectionMm2: 10,
          lengthM: 25,
          breakerModel: 'C50',
          breakerRatedA: 50,
          breakerCurve: 'C',
        },
      ],
    };

    const blob = await generateDocxBlob(reportInput);
    assert.ok(blob, 'Blob должен быть успешно создан');
    assert.ok(blob.size > 5000, `Размер blob должен быть больше 5000 байт, получено ${blob.size}`);
  });

  it('формирует том с ведомостью корректировок проектных решений для Госэкспертизы', async () => {
    const reportInput: DocxReportInput = {
      projectTitle: 'Детский сад на 250 мест',
      projectCode: '2026-ДОУ-ЭОМ',
      panelName: 'ВРУ-1',
      powerSource: {
        type: 'transformer',
        transformerPowerKva: 400,
        transformerConnection: 'Y/Yn-0',
      },
      lines: [
        {
          lineNumber: 'ЩР-1. Гр. 3',
          consumerName: 'Розетки пищеблока',
          cableMark: 'ВВГнг(А)-LS',
          material: 'cu',
          phaseSectionMm2: 2.5,
          zeroSectionMm2: 2.5,
          lengthM: 85,
          breakerModel: 'ВА47-29 (B16)',
          breakerRatedA: 16,
          breakerCurve: 'B',
          remediation: {
            lineNumber: 'ЩР-1. Гр. 3',
            consumerName: 'Розетки пищеблока',
            originalBreaker: 'C16',
            originalCable: 'ВВГнг(А)-LS (2.5 мм²)',
            appliedType: 'curve_b',
            adoptedSolution: 'Замена автомата на характеристику «B» (B16)',
            rationale: 'п. 1.7.79 ПУЭ-7 (мгновенная отсечка при L = 85 м)',
            drawingSheetRef: 'Лист 7 (однолинейная схема ВРУ)',
          },
        },
        {
          lineNumber: 'ЩС-Вент. 1',
          consumerName: 'Вентилятор приточный П1',
          cableMark: 'ВВГнг(А)-LS',
          material: 'cu',
          phaseSectionMm2: 4,
          zeroSectionMm2: 4,
          lengthM: 65,
          breakerModel: 'ВА47-29 (C16)',
          breakerRatedA: 16,
          breakerCurve: 'C',
          remediation: {
            lineNumber: 'ЩС-Вент. 1',
            consumerName: 'Вентилятор приточный П1',
            originalBreaker: 'C16',
            originalCable: 'ВВГнг(А)-LS (2.5 мм²)',
            appliedType: 'section_up',
            adoptedSolution: 'Увеличение сечения жил кабеля до 4 мм²',
            rationale: 'ГОСТ 28249-93 (защита двигателя от пускового тока)',
            drawingSheetRef: 'Лист 8 и кабельный журнал',
          },
        },
      ],
      remediations: [
        {
          lineNumber: 'ЩР-1. Гр. 3',
          consumerName: 'Розетки пищеблока',
          originalBreaker: 'C16',
          originalCable: 'ВВГнг(А)-LS (2.5 мм²)',
          appliedType: 'curve_b',
          adoptedSolution: 'Замена автомата на характеристику «B» (B16)',
          rationale: 'п. 1.7.79 ПУЭ-7 (мгновенная отсечка при L = 85 м)',
          drawingSheetRef: 'Лист 7 (однолинейная схема ВРУ)',
        },
        {
          lineNumber: 'ЩС-Вент. 1',
          consumerName: 'Вентилятор приточный П1',
          originalBreaker: 'C16',
          originalCable: 'ВВГнг(А)-LS (2.5 мм²)',
          appliedType: 'section_up',
          adoptedSolution: 'Увеличение сечения жил кабеля до 4 мм²',
          rationale: 'ГОСТ 28249-93 (защита двигателя от пускового тока)',
          drawingSheetRef: 'Лист 8 и кабельный журнал',
        },
      ],
    };

    const buffer = await generateDocxBuffer(reportInput);
    assert.ok(buffer instanceof Uint8Array);
    assert.ok(buffer.length > 5000);
  });
});
