/**
 * Генератор официального тома расчетно-пояснительной записки в формате Word (.docx)
 * по стандарту ГОСТ 2.105-95, ГОСТ 28249-93 и ПУЭ-7 (п. 1.7.79).
 * 100% Client-Side. Формирует документ в оперативной памяти браузера без бэкенда.
 */

import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  Table,
  TableRow,
  TableCell,
  WidthType,
  AlignmentType,
  HeadingLevel,
  BorderStyle,
  Header,
  Footer,
  PageNumber,
  PageBreak,
  type ITableCellOptions,
} from 'docx';

import type {
  PowerSourceInput,
  ConductorMaterial,
  BreakerCurveType,
  CalculationResult,
  LineRemediationRecord,
} from './types.ts';
import { calculatePhaseZeroLoop } from './calculator.ts';
import { calculateSourceImpedance } from './transformers.ts';

export interface DocxReportLineItem {
  lineNumber: string;
  consumerName: string;
  cableMark: string;
  material: ConductorMaterial;
  phaseSectionMm2: number;
  zeroSectionMm2: number;
  lengthM: number;
  breakerModel: string;
  breakerRatedA: number;
  breakerCurve: BreakerCurveType;
  calculation?: CalculationResult;
  remediation?: LineRemediationRecord;
}

export interface DocxReportInput {
  projectTitle?: string; // Наименование объекта строительства
  projectCode?: string; // Шифр проекта (например "2026-ЭОМ.РР")
  panelName?: string; // Наименование распределительного щита (например "ВРУ-1", "ЩР-1")
  companyName?: string; // Проектная организация
  authorName?: string; // Разработал (инженер)
  checkerName?: string; // Проверил (ГИП / Главный специалист)
  dateStr?: string; // Дата составления (например "Октябрь 2026 г.")
  powerSource: PowerSourceInput;
  lines: DocxReportLineItem[];
  remediations?: LineRemediationRecord[]; // Ведомость проектных решений для экспертизы
}

// Константы стилизации ГОСТ
const FONT_FAMILY = 'Times New Roman';
const COLOR_PRIMARY = '0F172A';
const COLOR_MUTED = '475569';
const COLOR_OK = '15803D';
const COLOR_FAIL = 'B91C1C';
const BG_HEADER_CELL = 'F1F5F9';

const THIN_BORDER = {
  style: BorderStyle.SINGLE,
  size: 4,
  color: 'CBD5E1',
};

const TABLE_BORDERS = {
  top: THIN_BORDER,
  bottom: THIN_BORDER,
  left: THIN_BORDER,
  right: THIN_BORDER,
  insideHorizontal: THIN_BORDER,
  insideVertical: THIN_BORDER,
};

/**
 * Создает официальный документ Word (.docx) в виде объекта docx.Document
 */
export function buildDocxDocument(input: DocxReportInput): Document {
  const projectTitle = input.projectTitle || 'Объект капитального строительства';
  const projectCode = input.projectCode || 'ЭОМ.РР-2026';
  const panelName = input.panelName || 'Распределительный щит 0.4 кВ';
  const companyName = input.companyName || 'ООО «Проектно-инжиниринговая мастерская»';
  const authorName = input.authorName || 'Инженер-проектировщик ЭОМ';
  const checkerName = input.checkerName || 'Главный инженер проекта (ГИП)';
  const dateStr = input.dateStr || '2026 г.';

  // Дорассчитываем линии, если у них нет готового расчета
  const processedLines = input.lines.map((line) => {
    if (line.calculation) return line;
    const calc = calculatePhaseZeroLoop({
      powerSource: input.powerSource,
      sections: [
        {
          name: line.lineNumber,
          material: line.material,
          phaseCrossSectionMm2: line.phaseSectionMm2,
          zeroCrossSectionMm2: line.zeroSectionMm2,
          lengthMeters: line.lengthM,
          conductorTempC: 65,
        },
      ],
      circuitBreaker: {
        model: line.breakerModel,
        ratedCurrentA: line.breakerRatedA,
        curve: line.breakerCurve,
        safetyFactor: 1.1,
      },
    });

    if (line.remediation?.appliedType === 'rcd_30ma') {
      calc.isPueCompliant = true;
      calc.status = 'SUCCESS';
      calc.statusMessage = 'СООТВЕТСТВУЕТ ПУЭ-7 (по дифференциальной защите АВДТ 30 мА)';
      calc.marginPercent = Math.max(calc.marginPercent, 100);
    }

    return { ...line, calculation: calc };
  });

  const sourceCalc = calculateSourceImpedance(input.powerSource);
  const totalCount = processedLines.length;
  const passedCount = processedLines.filter((l) => l.calculation?.isPueCompliant).length;
  const failedCount = totalCount - passedCount;

  // ---------------------------------------------------------------------------
  // Сборка элементов документа
  // ---------------------------------------------------------------------------
  const children: (Paragraph | Table)[] = [];

  // 1. ТИТУЛЬНЫЙ ЛИСТ
  children.push(...createTitlePageElements({
    projectTitle,
    projectCode,
    panelName,
    companyName,
    authorName,
    checkerName,
    dateStr,
  }));

  children.push(new Paragraph({ children: [new PageBreak()] }));

  // 2. РАЗДЕЛ 1. НОРМАТИВНО-ТЕХНИЧЕСКАЯ БАЗА
  children.push(
    createHeading('1. НОРМАТИВНО-ТЕХНИЧЕСКАЯ БАЗА РАСЧЕТА', HeadingLevel.HEADING_1),
    createParagraph(
      'Настоящий том расчетов петли «фаза-ноль» и токов однофазного короткого замыкания выполнен в строгом соответствии со следующими обязательными нормативными документами РФ:'
    ),
    createBulletItem('ГОСТ 28249-93 «Короткие замыкания в электроустановках. Методы расчета в электроустановках переменного тока напряжением до 1 кВ».'),
    createBulletItem('Правила устройства электроустановок (ПУЭ), 7-е издание, раздел 1.7 (в частности, п. 1.7.79 — требование автоматического отключения питания с временем t ≤ 0.4 с в сетях 230/400 В системы TN с обеспечением условия надежной мгновенной электромагнитной отсечки защитных аппаратов с коэффициентом запаса k_над = 1.1).'),
    createBulletItem('ГОСТ Р 50571.4.41-2012 / МЭК 60364-4-41:2005 «Электроустановки низковольтные. Требования по обеспечению безопасности. Защита от поражения электрическим током».'),
    createBulletItem('СП 256.1325800.2016 «Электроустановки жилых и общественных зданий. Правила проектирования и монтажа».'),
    createBulletItem('ГОСТ 22483-2021 «Жилы токопроводящие для кабелей, проводов и шнуров. Нормируемые электрические сопротивления постоянному току».')
  );

  // 3. РАЗДЕЛ 2. ПАРАМЕТРЫ ГОЛОВНОГО ИСТОЧНИКА ПИТАНИЯ
  children.push(
    createHeading('2. ПАРАМЕТРЫ ГОЛОВНОГО ИСТОЧНИКА ПИТАНИЯ', HeadingLevel.HEADING_1),
    createParagraph(
      `В качестве головного узла электроснабжения для проектируемого щита «${panelName}» принят: ${sourceCalc.sourceDescription}.`
    ),
    createSourceSummaryTable(input.powerSource, sourceCalc),
    createParagraph(
      'Примечание: В контур петли «фаза-ноль» согласно табл. 1 и разд. 3 ГОСТ 28249-93 включено суммарное сопротивление переходных контактных соединений коммутационных аппаратов и контактных выводов R_конт = 0.0150 Ом.'
    )
  );

  // 4. РАЗДЕЛ 3. МЕТОДИКА И РАСЧЕТНЫЕ ФОРМУЛЫ
  children.push(
    createHeading('3. МЕТОДИКА РАСЧЕТА И РАСЧЕТНЫЕ ФОРМУЛЫ', HeadingLevel.HEADING_1),
    createParagraph(
      '1. Активное сопротивление фазных и нулевых жил кабельных линий рассчитывается с учетом нормативного температурного пересчета на максимально допустимый длительный нагрев проводников под нагрузкой (+65 °C по п. 2.2 ГОСТ 28249-93):'
    ),
    createFormulaParagraph('R_жил = R_20 · [1 + α · (θ - 20)] · (L / 1000)'),
    createParagraph(
      'где: R_20 — погонное сопротивление жилы при +20 °C (по ГОСТ 22483-2021), Ом/км; α — температурный коэффициент сопротивления (0.00393 1/°C для меди, 0.00403 1/°C для алюминия); θ = +65 °C — расчетная температура жил в рабочем режиме; L — длина трассы, м.'
    ),
    createParagraph('2. Индуктивное сопротивление кабельной цепи:'),
    createFormulaParagraph('X_каб = x_0 · (L / 1000)'),
    createParagraph('где x_0 — среднее погонное индуктивное сопротивление петли (0.065–0.080 Ом/км в зависимости от сечения).'),
    createParagraph('3. Полное сопротивление петли «фаза-ноль»:'),
    createFormulaParagraph('Z_п-н = √ ( (R_ист + R_каб + R_конт)² + (X_ист + X_каб)² )'),
    createParagraph('4. Минимальный ток однофазного короткого замыкания на землю:'),
    createFormulaParagraph('I_кз(1) = (c · U_ном.ф) / Z_п-н'),
    createParagraph('где: U_ном.ф = 230 В — номинальное фазное напряжение сети; c = 1.0 — коэффициент напряжения по ГОСТ 28249-93.'),
    createParagraph('5. Критерий надежного срабатывания защиты по п. 1.7.79 ПУЭ-7:'),
    createFormulaParagraph('I_кз(1) ≥ I_отс.треб = k_над · I_сраб.макс'),
    createParagraph(
      'где k_над = 1.1 — коэффициент надежности; I_сраб.макс — верхний предел срабатывания электромагнитного расцепителя автоматического выключателя: 5·In для кривой «B», 10·In для кривой «C», 14·In для кривой «D». При выполнении данного условия гарантируется мгновенное время отключения t ≤ 0.1 с, что полностью удовлетворяет ПУЭ-7 (допустимо t ≤ 0.4 с).'
    )
  );

  // 5. РАЗДЕЛ 4. СВОДНАЯ ВЕДОМОСТЬ СООТВЕТСТВИЯ АВТОМАТОВ ТРЕБОВАНИЯМ ПУЭ-7
  children.push(
    createHeading('4. СВОДНАЯ ВЕДОМОСТЬ ОТСЕЧКИ АВТОМАТОВ И ТОКОВ КЗ', HeadingLevel.HEADING_1),
    createParagraph(
      `Сводные результаты проверки отключающей способности защитных аппаратов для распределительного щита «${panelName}» (всего отходящих линий: ${totalCount}, соответствуют ПУЭ: ${passedCount}, выявлено замечаний: ${failedCount}):`
    ),
    createSummaryTable(processedLines)
  );

  // 6. РАЗДЕЛ 5. ДЕТАЛЬНЫЕ АНАЛИТИЧЕСКИЕ РАСЧЕТЫ ПО КАЖДОЙ ЛИНИИ
  children.push(
    createHeading('5. ПОСТРОЧНЫЕ РАСЧЕТЫ КАБЕЛЬНЫХ ЦЕПЕЙ С ПОДСТАНОВКОЙ ЧИСЕЛ', HeadingLevel.HEADING_1)
  );

  processedLines.forEach((item, index) => {
    children.push(...createLineDetailElements(item, index + 1));
  });

  // 7. РАЗДЕЛ 6. ЗАКЛЮЧЕНИЕ И ОТВЕТ НА ЗАМЕЧАНИЕ ГОСУДАРСТВЕННОЙ ЭКСПЕРТИЗЫ
  const hasRemediations = Boolean(input.remediations && input.remediations.length > 0);
  const remediationsCount = input.remediations?.length || 0;

  children.push(
    createHeading('6. ЗАКЛЮЧЕНИЕ И ОТВЕТ НА ЗАМЕЧАНИЕ ЭКСПЕРТИЗЫ', HeadingLevel.HEADING_1),
    createCalloutBox([
      'ОФИЦИАЛЬНЫЙ ОТВЕТ НА ЗАМЕЧАНИЕ ГОСУДАРСТВЕННОЙ ЭКСПЕРТИЗЫ',
      'В ответ на замечание Государственной (негосударственной) экспертизы проектной документации в части подтверждения эффективности мер защиты при косвенном прикосновении и условий автоматического отключения питания по п. 1.7.79 ПУЭ-7:',
      `1. Проектной организацией ${companyName} выполнен сплошной комплексный поверочный расчет полного сопротивления петли «фаза-ноль» и токов однофазного короткого замыкания в наиболее удаленных точках всех кабельных линий щита «${panelName}» по строгой нормативной методике ГОСТ 28249-93.`,
      '2. При расчете учтен максимальный рабочий нагрев жил кабелей до +65 °C (с введением температурного коэффициента k_θ = 1.18 по п. 2.2 ГОСТ 28249-93), индуктивные сопротивления трасс прокладки, а также нормативные переходные сопротивления контактных соединений коммутационных аппаратов (R_конт = 0.015 Ом).',
      `3. По результатам проверки: ${
        failedCount === 0
          ? hasRemediations
            ? `для всех ${totalCount} кабельных линий щита гарантировано выполнение требований п. 1.7.79 ПУЭ-7 и ГОСТ Р 50571.4.41-2022. Для ${remediationsCount} отходящих линий, параметры которых не обеспечивали нормируемое время отключения в исходном варианте, приняты корректирующие инженерные решения (см. Ведомость корректировки п. 6.1). Замечание экспертизы снято в полном объеме.`
            : `для 100% кабельных линий (${passedCount} из ${totalCount}) расчетный ток однофазного КЗ гарантированно превышает порог срабатывания мгновенной электромагнитной отсечки автоматических выключателей с нормативным запасом не менее 1.1. Обеспечивается мгновенное аварийное отключение (t ≤ 0.1 с) при нормативном пределе t ≤ 0.4 с по п. 1.7.79 ПУЭ-7. Замечание экспертизы снято в полном объеме.`
          : `для ${failedCount} линий сформированы конкретные инженерные мероприятия по замене характеристик расцепителей (перевод с кривой C на B) либо установке дифференциальной защиты (УЗО/АВДТ) с уставкой 30 мА в полном соответствии с требованиями п. 1.7.79 ПУЭ-7.`
      }`,
    ])
  );

  if (hasRemediations && input.remediations) {
    children.push(
      createHeading(
        '6.1. ВЕДОМОСТЬ КОРРЕКТИРОВКИ ПРОЕКТНЫХ РЕШЕНИЙ ЩИТА (к комплекту ЭОМ.Р)',
        HeadingLevel.HEADING_2
      ),
      createParagraph(
        `Для устранения выявленных коллизий по п. 1.7.79 ПУЭ-7 и снятия замечаний экспертизы проектной организацией приняты следующие решения, подлежащие внесению в основной комплект рабочих чертежей ЭОМ:`
      ),
      createRemediationTable(input.remediations),
      createParagraph(
        'Указание главному инженеру проекта (ГИП) и разработчикам марки ЭОМ: Внести соответствующие изменения в принципиальную однолинейную схему щита и спецификацию оборудования, изделий и материалов (форма 1 по ГОСТ 21.110-2013).'
      )
    );
  }

  // Формирование итогового документа Word
  return new Document({
    creator: 'Fazazero (КЗ-Эксперт)',
    title: `Том расчета токов КЗ и петли фаза-ноль: ${panelName}`,
    description: 'Официальный том пояснительной записки по ГОСТ 2.105-95 и ПУЭ-7',
    sections: [
      {
        properties: {
          page: {
            margin: {
              top: 1134, // 20 мм
              bottom: 1134, // 20 мм
              left: 1701, // 30 мм (под переплет ГОСТ)
              right: 850, // 15 мм
            },
          },
        },
        headers: {
          default: new Header({
            children: [
              new Paragraph({
                alignment: AlignmentType.RIGHT,
                children: [
                  new TextRun({
                    text: `Шифр: ${projectCode} · ${panelName} · ГОСТ 28249-93`,
                    size: 18, // 9pt
                    color: COLOR_MUTED,
                    font: FONT_FAMILY,
                  }),
                ],
              }),
            ],
          }),
        },
        footers: {
          default: new Footer({
            children: [
              new Paragraph({
                alignment: AlignmentType.RIGHT,
                children: [
                  new TextRun({
                    text: 'Лист ',
                    size: 18,
                    font: FONT_FAMILY,
                  }),
                  new TextRun({
                    children: [PageNumber.CURRENT],
                    size: 18,
                    font: FONT_FAMILY,
                  }),
                ],
              }),
            ],
          }),
        },
        children,
      },
    ],
  });
}

/**
 * Генерирует готовый бинарный буфер Uint8Array (работает и в Node.js, и в браузере)
 */
export async function generateDocxBuffer(input: DocxReportInput): Promise<Uint8Array> {
  const doc = buildDocxDocument(input);
  if (typeof (Packer as any).toBuffer === 'function') {
    const buf = await (Packer as any).toBuffer(doc);
    return new Uint8Array(buf);
  }
  const blob = await Packer.toBlob(doc);
  return new Uint8Array(await blob.arrayBuffer());
}

/**
 * Генерирует готовый Blob для мгновенного скачивания в браузере
 */
export async function generateDocxBlob(input: DocxReportInput): Promise<Blob> {
  const doc = buildDocxDocument(input);
  return await Packer.toBlob(doc);
}

// -----------------------------------------------------------------------------
// Вспомогательные функции генерации элементов документа
// -----------------------------------------------------------------------------

function createHeading(text: string, level: (typeof HeadingLevel)[keyof typeof HeadingLevel]): Paragraph {
  return new Paragraph({
    heading: level,
    spacing: { before: 280, after: 140 },
    children: [
      new TextRun({
        text,
        bold: true,
        font: FONT_FAMILY,
        size: level === HeadingLevel.HEADING_1 ? 26 : 22, // 13pt / 11pt
        color: COLOR_PRIMARY,
      }),
    ],
  });
}

function createParagraph(text: string): Paragraph {
  return new Paragraph({
    alignment: AlignmentType.JUSTIFIED,
    spacing: { before: 80, after: 80, line: 276 }, // 1.15 интервал
    children: [
      new TextRun({
        text,
        font: FONT_FAMILY,
        size: 22, // 11pt
        color: COLOR_PRIMARY,
      }),
    ],
  });
}

function createFormulaParagraph(formula: string): Paragraph {
  return new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { before: 120, after: 120 },
    children: [
      new TextRun({
        text: formula,
        bold: true,
        italics: true,
        font: FONT_FAMILY,
        size: 22,
        color: '0369A1', // Accent blue
      }),
    ],
  });
}

function createBulletItem(text: string): Paragraph {
  return new Paragraph({
    bullet: { level: 0 },
    alignment: AlignmentType.JUSTIFIED,
    spacing: { before: 40, after: 40 },
    children: [
      new TextRun({
        text,
        font: FONT_FAMILY,
        size: 22,
        color: COLOR_PRIMARY,
      }),
    ],
  });
}

function createTitlePageElements(meta: {
  projectTitle: string;
  projectCode: string;
  panelName: string;
  companyName: string;
  authorName: string;
  checkerName: string;
  dateStr: string;
}): Paragraph[] {
  return [
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 200, after: 100 },
      children: [
        new TextRun({
          text: meta.companyName.toUpperCase(),
          bold: true,
          font: FONT_FAMILY,
          size: 24, // 12pt
          color: COLOR_MUTED,
        }),
      ],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 80, after: 600 },
      children: [
        new TextRun({
          text: 'ОТДЕЛ СИЛОВОГО ЭЛЕКТРООБОРУДОВАНИЯ И ЭЛЕКТРООСВЕЩЕНИЯ (ЭОМ)',
          font: FONT_FAMILY,
          size: 20,
          color: COLOR_MUTED,
        }),
      ],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 600, after: 140 },
      children: [
        new TextRun({
          text: `Шифр: ${meta.projectCode}`,
          bold: true,
          font: FONT_FAMILY,
          size: 28, // 14pt
          color: '0369A1',
        }),
      ],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 140, after: 300 },
      children: [
        new TextRun({
          text: meta.projectTitle,
          bold: true,
          font: FONT_FAMILY,
          size: 32, // 16pt
          color: COLOR_PRIMARY,
        }),
      ],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 300, after: 80 },
      children: [
        new TextRun({
          text: 'РАСЧЕТ ТОКОВ ОДНОФАЗНОГО КОРОТКОГО ЗАМЫКАНИЯ И ПЕТЛИ «ФАЗА-НОЛЬ»',
          bold: true,
          font: FONT_FAMILY,
          size: 26,
          color: COLOR_PRIMARY,
        }),
      ],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 80, after: 800 },
      children: [
        new TextRun({
          text: `Проверка времени срабатывания защитных аппаратов по п. 1.7.79 ПУЭ-7 для щита «${meta.panelName}»`,
          italics: true,
          font: FONT_FAMILY,
          size: 22,
          color: COLOR_MUTED,
        }),
      ],
    }),
    // Подписи
    new Paragraph({
      alignment: AlignmentType.RIGHT,
      spacing: { before: 600, after: 60 },
      children: [
        new TextRun({ text: `Разработал:  __________________ / ${meta.authorName} /`, font: FONT_FAMILY, size: 22 }),
      ],
    }),
    new Paragraph({
      alignment: AlignmentType.RIGHT,
      spacing: { before: 60, after: 800 },
      children: [
        new TextRun({ text: `Проверил:    __________________ / ${meta.checkerName} /`, font: FONT_FAMILY, size: 22 }),
      ],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 400, after: 0 },
      children: [
        new TextRun({ text: meta.dateStr, bold: true, font: FONT_FAMILY, size: 22, color: COLOR_PRIMARY }),
      ],
    }),
  ];
}

function createSourceSummaryTable(source: PowerSourceInput, calc: ReturnType<typeof calculateSourceImpedance>): Table {
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: TABLE_BORDERS,
    rows: [
      new TableRow({
        tableHeader: true,
        children: [
          createTableCell('Параметр источника питания', { isHeader: true, widthPct: 60 }),
          createTableCell('Значение', { isHeader: true, widthPct: 40 }),
        ],
      }),
      new TableRow({
        children: [
          createTableCell('Тип узла'),
          createTableCell(source.type === 'transformer' ? 'Трансформатор ТП (Раздел ЭС)' : 'Ввод ВРУ здания (по ТУ)'),
        ],
      }),
      new TableRow({
        children: [
          createTableCell('Характеристики источника'),
          createTableCell(calc.sourceDescription),
        ],
      }),
      new TableRow({
        children: [
          createTableCell('Эквивалентное активное сопротивление R_ист'),
          createTableCell(`${calc.rSourceOhm.toFixed(4)} Ом`),
        ],
      }),
      new TableRow({
        children: [
          createTableCell('Эквивалентное индуктивное сопротивление X_ист'),
          createTableCell(`${calc.xSourceOhm.toFixed(4)} Ом`),
        ],
      }),
      new TableRow({
        children: [
          createTableCell('Полное эквивалентное сопротивление источника Z_ист'),
          createTableCell(`${calc.zSourceOhm.toFixed(4)} Ом`, { isBold: true }),
        ],
      }),
    ],
  });
}

function createSummaryTable(lines: DocxReportLineItem[]): Table {
  const rows: TableRow[] = [
    new TableRow({
      tableHeader: true,
      children: [
        createTableCell('№', { isHeader: true, widthPct: 5 }),
        createTableCell('Линия', { isHeader: true, widthPct: 15 }),
        createTableCell('Нагрузка', { isHeader: true, widthPct: 20 }),
        createTableCell('Кабель, L', { isHeader: true, widthPct: 18 }),
        createTableCell('Автомат', { isHeader: true, widthPct: 10 }),
        createTableCell('Zп-н, Ом', { isHeader: true, widthPct: 10 }),
        createTableCell('Iкз(1), А', { isHeader: true, widthPct: 10 }),
        createTableCell('Статус ПУЭ-7', { isHeader: true, widthPct: 12 }),
      ],
    }),
  ];

  lines.forEach((line, idx) => {
    const calc = line.calculation;
    const isOk = calc?.isPueCompliant ?? false;
    const ik1Str = calc ? `${calc.ik1A.toFixed(0)} А` : '—';
    const zStr = calc ? `${calc.loopImpedanceZ_Ohm.toFixed(3)}` : '—';
    
    let statusText = '';
    if (line.remediation?.appliedType === 'rcd_30ma') {
      statusText = '✅ АВДТ 30мА';
    } else if (line.remediation?.appliedType === 'curve_b') {
      const marginStr = calc ? ` (${calc.marginPercent >= 0 ? '+' : ''}${calc.marginPercent.toFixed(0)}%)` : '';
      statusText = `✅ Кривая B${marginStr}`;
    } else if (line.remediation?.appliedType === 'section_up') {
      const marginStr = calc ? ` (${calc.marginPercent >= 0 ? '+' : ''}${calc.marginPercent.toFixed(0)}%)` : '';
      statusText = `✅ ${line.phaseSectionMm2} мм²${marginStr}`;
    } else if (isOk) {
      const marginStr = calc ? ` (${calc.marginPercent >= 0 ? '+' : ''}${calc.marginPercent.toFixed(0)}%)` : '';
      statusText = `✅ Допущено${marginStr}`;
    } else {
      const marginStr = calc ? ` (${calc.marginPercent >= 0 ? '+' : ''}${calc.marginPercent.toFixed(0)}%)` : '';
      statusText = `❌ Отказ${marginStr}`;
    }

    rows.push(
      new TableRow({
        children: [
          createTableCell(String(idx + 1)),
          createTableCell(line.lineNumber, { isBold: true }),
          createTableCell(line.consumerName || '—'),
          createTableCell(`${line.cableMark} ${line.phaseSectionMm2} мм², ${line.lengthM} м`),
          createTableCell(`${line.breakerCurve}${line.breakerRatedA}`),
          createTableCell(zStr),
          createTableCell(ik1Str, { isBold: true }),
          createTableCell(statusText, {
            isBold: true,
            color: isOk ? COLOR_OK : COLOR_FAIL,
          }),
        ],
      })
    );
  });

  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: TABLE_BORDERS,
    rows,
  });
}

function createRemediationTable(remediations: LineRemediationRecord[]): Table {
  const rows: TableRow[] = [
    new TableRow({
      tableHeader: true,
      children: [
        createTableCell('№', { isHeader: true, widthPct: 5 }),
        createTableCell('Линия (Гр.)', { isHeader: true, widthPct: 12 }),
        createTableCell('Потребитель', { isHeader: true, widthPct: 18 }),
        createTableCell('Проектное решение (до расчета)', { isHeader: true, widthPct: 20 }),
        createTableCell('Принятое решение (для Экспертизы)', { isHeader: true, widthPct: 23 }),
        createTableCell('Нормативное основание', { isHeader: true, widthPct: 22 }),
      ],
    }),
  ];

  remediations.forEach((item, idx) => {
    const origInfo = `${item.originalCable}, Авт. ${item.originalBreaker}`;
    rows.push(
      new TableRow({
        children: [
          createTableCell(String(idx + 1)),
          createTableCell(item.lineNumber, { isBold: true }),
          createTableCell(item.consumerName || '—'),
          createTableCell(origInfo),
          createTableCell(item.adoptedSolution, { isBold: true, color: '0369A1' }),
          createTableCell(item.rationale),
        ],
      })
    );
  });

  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: TABLE_BORDERS,
    rows,
  });
}

function createLineDetailElements(line: DocxReportLineItem, index: number): (Paragraph | Table)[] {
  const calc = line.calculation;
  if (!calc) return [];

  const isOk = calc.isPueCompliant;
  const statusColor = isOk ? COLOR_OK : COLOR_FAIL;
  const statusIcon = isOk ? '✅' : '❌';

  const items: (Paragraph | Table)[] = [
    new Paragraph({
      spacing: { before: 180, after: 60 },
      children: [
        new TextRun({
          text: `5.${index}. Расчет линии «${line.lineNumber}» — ${line.consumerName || 'Потребитель'}`,
          bold: true,
          size: 22,
          font: FONT_FAMILY,
          color: COLOR_PRIMARY,
        }),
      ],
    }),
    createParagraph(
      `Параметры цепи: кабель ${line.cableMark} (${line.material === 'cu' ? 'медь' : 'алюминий'}, сечение жил: ${line.phaseSectionMm2}/${line.zeroSectionMm2} мм²), длина трассы L = ${line.lengthM} м. Защитный аппарат: автоматический выключатель ${line.breakerModel || 'ВА'} с номиналом In = ${line.breakerRatedA} А (характеристика ${line.breakerCurve}).`
    ),
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      borders: TABLE_BORDERS,
      rows: [
        new TableRow({
          tableHeader: true,
          children: [
            createTableCell('Участок / Сопротивление', { isHeader: true, widthPct: 55 }),
            createTableCell('R (активное), Ом', { isHeader: true, widthPct: 15 }),
            createTableCell('X (индуктивное), Ом', { isHeader: true, widthPct: 15 }),
            createTableCell('Z (полное), Ом', { isHeader: true, widthPct: 15 }),
          ],
        }),
        new TableRow({
          children: [
            createTableCell('Головной источник питания'),
            createTableCell(calc.sourceR_Ohm.toFixed(4)),
            createTableCell(calc.sourceX_Ohm.toFixed(4)),
            createTableCell(calc.sourceZ_Ohm.toFixed(4)),
          ],
        }),
        new TableRow({
          children: [
            createTableCell(`Кабельная линия (L = ${line.lengthM} м, нагрев +65 °C)`),
            createTableCell(calc.cablesR_Ohm.toFixed(4)),
            createTableCell(calc.cablesX_Ohm.toFixed(4)),
            createTableCell(Math.hypot(calc.cablesR_Ohm, calc.cablesX_Ohm).toFixed(4)),
          ],
        }),
        new TableRow({
          children: [
            createTableCell('Переходные контакты коммутации (R_конт)'),
            createTableCell(calc.contactR_Ohm.toFixed(4)),
            createTableCell('0.0000'),
            createTableCell(calc.contactR_Ohm.toFixed(4)),
          ],
        }),
        new TableRow({
          children: [
            createTableCell('ИТОГО по петле «фаза-ноль»', { isBold: true }),
            createTableCell(calc.totalR_Ohm.toFixed(4), { isBold: true }),
            createTableCell(calc.totalX_Ohm.toFixed(4), { isBold: true }),
            createTableCell(`${calc.loopImpedanceZ_Ohm.toFixed(4)} Ом`, { isBold: true, color: '0369A1' }),
          ],
        }),
      ],
    }),
    createParagraph(
      `Подстановка в формулу тока КЗ:  I_кз(1) = 230 В / ${calc.loopImpedanceZ_Ohm.toFixed(4)} Ом = ${calc.ik1A.toFixed(1)} А.`
    ),
    createParagraph(
      `Требуемый ток надежного срабатывания электромагнитной отсечки:  I_отс.треб = 1.1 · ${calc.requiredTripCurrentA / 1.1} А = ${calc.requiredTripCurrentA.toFixed(1)} А.`
    ),
    new Paragraph({
      spacing: { before: 60, after: 120 },
      children: [
        new TextRun({
          text: `ВЫВОД: ${statusIcon} `,
          bold: true,
          font: FONT_FAMILY,
          size: 22,
        }),
        new TextRun({
          text: isOk
            ? (line.remediation?.appliedType === 'rcd_30ma'
                ? 'Условие автоматического отключения питания по п. 1.7.79 (абз. 5) ПУЭ-7 ВЫПОЛНЕНО. Предусмотрена дифференциальная защита (АВДТ/УЗО с током уставки IΔn ≤ 30 мА), обеспечивающая гарантированное отключение поврежденного участка при замыкании на землю за время t ≤ 0.04 с (ГОСТ Р 50571.4.41-2022).'
                : (line.remediation?.appliedType === 'curve_b'
                    ? `Условие надежного автоматического отключения питания по п. 1.7.79 ПУЭ-7 ВЫПОЛНЕНО (t ≤ 0.1 с). Принята характеристика электромагнитного расцепителя «B» (кратность 5·In). Запас по току отсечки составляет +${calc.marginPercent.toFixed(1)}%.`
                    : (line.remediation?.appliedType === 'section_up'
                        ? `Условие надежного автоматического отключения питания по п. 1.7.79 ПУЭ-7 ВЫПОЛНЕНО (t ≤ 0.1 с). Сечение фазных и нулевых жил увеличено до ${line.phaseSectionMm2} мм² (сохранена проектная уставка расцепителя «${line.breakerCurve}» для защиты от пусковых токов). Запас по току отсечки составляет +${calc.marginPercent.toFixed(1)}%.`
                        : `Условие надежного автоматического отключения питания по п. 1.7.79 ПУЭ-7 ВЫПОЛНЕНО (t ≤ 0.1 с). Запас по току отсечки составляет +${calc.marginPercent.toFixed(1)}%.`)))
            : `ОТКАЗ ПО П. 1.7.79 ПУЭ-7: Ток однофазного КЗ (${calc.ik1A.toFixed(1)} А) меньше требуемого тока срабатывания расцепителя (${calc.requiredTripCurrentA.toFixed(1)} А). Дефицит: ${Math.abs(calc.marginPercent).toFixed(1)}%. ${calc.recommendation || ''}`,
          bold: true,
          font: FONT_FAMILY,
          size: 22,
          color: statusColor,
        }),
      ],
    }),
  ];

  return items;
}

function createCalloutBox(lines: string[]): Table {
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: {
      top: { style: BorderStyle.SINGLE, size: 12, color: '0284C7' },
      bottom: { style: BorderStyle.SINGLE, size: 12, color: '0284C7' },
      left: { style: BorderStyle.SINGLE, size: 24, color: '0284C7' }, // Жирный левый акцент
      right: { style: BorderStyle.SINGLE, size: 12, color: '0284C7' },
      insideHorizontal: { style: BorderStyle.NONE },
      insideVertical: { style: BorderStyle.NONE },
    },
    rows: [
      new TableRow({
        children: [
          new TableCell({
            shading: { fill: 'F0F9FF' },
            margins: { top: 160, bottom: 160, left: 240, right: 240 },
            children: lines.map(
              (text, i) =>
                new Paragraph({
                  spacing: { before: i === 0 ? 0 : 80, after: 80 },
                  children: [
                    new TextRun({
                      text,
                      bold: i === 0,
                      font: FONT_FAMILY,
                      size: i === 0 ? 24 : 22,
                      color: i === 0 ? '0369A1' : COLOR_PRIMARY,
                    }),
                  ],
                })
            ),
          }),
        ],
      }),
    ],
  });
}

function createTableCell(
  text: string,
  options?: {
    isHeader?: boolean;
    isBold?: boolean;
    widthPct?: number;
    color?: string;
  }
): TableCell {
  const isHeader = options?.isHeader ?? false;
  const isBold = options?.isBold ?? isHeader;
  const widthPct = options?.widthPct;
  const color = options?.color || (isHeader ? COLOR_PRIMARY : COLOR_PRIMARY);

  const cellOpts: ITableCellOptions = {
    shading: isHeader ? { fill: BG_HEADER_CELL } : undefined,
    margins: { top: 100, bottom: 100, left: 120, right: 120 },
    children: [
      new Paragraph({
        alignment: isHeader ? AlignmentType.CENTER : AlignmentType.LEFT,
        spacing: { before: 20, after: 20 },
        children: [
          new TextRun({
            text,
            bold: isBold,
            font: FONT_FAMILY,
            size: isHeader ? 20 : 20, // 10pt в таблицах
            color,
          }),
        ],
      }),
    ],
  };

  if (widthPct) {
    cellOpts.width = { size: widthPct, type: WidthType.PERCENTAGE };
  }

  return new TableCell(cellOpts);
}
