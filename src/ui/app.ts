/**
 * Fazazero (КЗ-Эксперт) — Интерактивный клиентский контроллер v2.0
 * 100% Client-Side. Никакие данные не отправляются на сервер.
 */

import {
  calculatePhaseZeroLoop,
  TRANSFORMERS_CATALOG,
  STANDARD_CROSS_SECTIONS,
  STANDARD_BREAKER_RATINGS,
  getTransformerParameters,
  parseExcelWorkbook,
  calculateBatchLines,
  generateSampleExcelWorkbook,
  type ParsedCableLine,
  type BatchCalculationSummary,
} from '../core/index.ts';

// Состояние формы одиночной линии
interface SectionState {
  id: string;
  name: string;
  material: 'cu' | 'al';
  phaseCrossSectionMm2: number;
  zeroCrossSectionMm2: number;
  lengthMeters: number;
  tempC: number;
}

const state = {
  powerSourceType: 'transformer' as 'transformer' | 'vru_tu',
  transformerPowerKva: 630,
  transformerConnection: 'D/Yn-11' as 'D/Yn-11' | 'Y/Yn-0',
  vruIk3kA: 12.5,
  vruXrRatio: 3.5,

  sections: [
    {
      id: 'sec-1',
      name: 'Групповая линия (розетки)',
      material: 'cu',
      phaseCrossSectionMm2: 2.5,
      zeroCrossSectionMm2: 2.5,
      lengthMeters: 35,
      tempC: 65,
    },
  ] as SectionState[],

  breakerRatedA: 16,
  breakerCurve: 'C' as 'B' | 'C' | 'D',
  safetyFactor: 1.1,

  // Состояние пакетной обработки Excel
  batchSummary: null as BatchCalculationSummary | null,
  batchFilter: 'all' as 'all' | 'fails' | 'passed',
  batchSearchQuery: '',
};

// Инициализация интерфейса
function initApp() {
  initTabs();
  initSecurityModal();
  populateDropdowns();
  bindEvents();
  renderSections();
  initBatchExcel();
  recalculate();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initApp);
} else {
  initApp();
}

// Переключение табов
function initTabs() {
  const tabButtons = document.querySelectorAll<HTMLButtonElement>('.tab-btn');
  const tabPanes = document.querySelectorAll<HTMLElement>('.tab-pane');

  tabButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      const targetId = btn.getAttribute('data-tab');
      if (!targetId) return;

      tabButtons.forEach((b) => b.classList.remove('active'));
      tabPanes.forEach((p) => p.classList.remove('active'));

      btn.classList.add('active');
      const pane = document.getElementById(targetId);
      if (pane) pane.classList.add('active');
    });
  });
}

// Модальное окно аудита для СБ
function initSecurityModal() {
  const modal = document.getElementById('security-modal');
  const openButtons = document.querySelectorAll('.open-security-modal');
  const closeButton = document.getElementById('close-security-modal');

  openButtons.forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      modal?.classList.add('open');
    });
  });

  closeButton?.addEventListener('click', () => {
    modal?.classList.remove('open');
  });

  modal?.addEventListener('click', (e) => {
    if (e.target === modal) modal.classList.remove('open');
  });
}

// Заполнение выпадающих списков
function populateDropdowns() {
  // Трансформаторы мощности
  const tpSelect = document.getElementById('tp-power') as HTMLSelectElement | null;
  if (tpSelect) {
    const powers = Array.from(new Set(TRANSFORMERS_CATALOG.map((t) => t.powerKva))).sort((a, b) => a - b);
    tpSelect.innerHTML = powers
      .map((p) => `<option value="${p}" ${p === state.transformerPowerKva ? 'selected' : ''}>${p} кВА</option>`)
      .join('');
  }

  // Номиналы автоматов
  const breakerSelect = document.getElementById('breaker-rating') as HTMLSelectElement | null;
  if (breakerSelect) {
    breakerSelect.innerHTML = STANDARD_BREAKER_RATINGS.map(
      (r) => `<option value="${r}" ${r === state.breakerRatedA ? 'selected' : ''}>${r} А</option>`
    ).join('');
  }
}

// Привязка обработчиков событий
function bindEvents() {
  // Тумблер источника (ТП / ВРУ)
  const btnSrcTp = document.getElementById('btn-src-tp');
  const btnSrcVru = document.getElementById('btn-src-vru');
  const blockTp = document.getElementById('block-source-tp');
  const blockVru = document.getElementById('block-source-vru');

  btnSrcTp?.addEventListener('click', () => {
    state.powerSourceType = 'transformer';
    btnSrcTp.classList.add('active');
    btnSrcVru?.classList.remove('active');
    blockTp?.style.setProperty('display', 'block');
    blockVru?.style.setProperty('display', 'none');
    recalculate();
  });

  btnSrcVru?.addEventListener('click', () => {
    state.powerSourceType = 'vru_tu';
    btnSrcVru.classList.add('active');
    btnSrcTp?.classList.remove('active');
    blockVru?.style.setProperty('display', 'block');
    blockTp?.style.setProperty('display', 'none');
    recalculate();
  });

  // Параметры ТП
  document.getElementById('tp-power')?.addEventListener('change', (e) => {
    state.transformerPowerKva = Number((e.target as HTMLSelectElement).value);
    updateTpSpecsLabel();
    recalculate();
  });

  document.getElementById('tp-connection')?.addEventListener('change', (e) => {
    state.transformerConnection = (e.target as HTMLSelectElement).value as any;
    updateTpSpecsLabel();
    recalculate();
  });

  // Параметры ВРУ
  document.getElementById('vru-ik3')?.addEventListener('input', (e) => {
    state.vruIk3kA = Number((e.target as HTMLInputElement).value) || 10;
    recalculate();
  });

  document.getElementById('vru-xr')?.addEventListener('input', (e) => {
    state.vruXrRatio = Number((e.target as HTMLInputElement).value) || 3.5;
    recalculate();
  });

  // Автомат
  document.getElementById('breaker-rating')?.addEventListener('change', (e) => {
    state.breakerRatedA = Number((e.target as HTMLSelectElement).value);
    recalculate();
  });

  document.getElementById('breaker-curve')?.addEventListener('change', (e) => {
    state.breakerCurve = (e.target as HTMLSelectElement).value as any;
    recalculate();
  });

  // Кнопка добавления звена
  document.getElementById('btn-add-section')?.addEventListener('click', () => {
    if (state.sections.length >= 5) {
      alert('Максимальное число каскадных звеньев — 5.');
      return;
    }
    const idx = state.sections.length + 1;
    state.sections.push({
      id: `sec-${Date.now()}`,
      name: `Участок ${idx} (кабель)`,
      material: 'cu',
      phaseCrossSectionMm2: 2.5,
      zeroCrossSectionMm2: 2.5,
      lengthMeters: 20,
      tempC: 65,
    });
    renderSections();
    recalculate();
  });

  updateTpSpecsLabel();
}

function updateTpSpecsLabel() {
  const label = document.getElementById('tp-specs-label');
  if (!label) return;
  const trans = getTransformerParameters(state.transformerPowerKva, state.transformerConnection);
  label.textContent = `Паспорт: u_к = ${trans.ukPercent}%, P_к = ${trans.pkKw} кВт, R1 = ${trans.r1Ohm.toFixed(4)} Ом, X1 = ${trans.x1Ohm.toFixed(4)} Ом`;
}

// Отрисовка списка звеньев цепи
function renderSections() {
  const container = document.getElementById('sections-container');
  if (!container) return;

  container.innerHTML = state.sections
    .map((sec, i) => {
      const crossSectionsOptions = STANDARD_CROSS_SECTIONS.map(
        (s) => `<option value="${s}" ${s === sec.phaseCrossSectionMm2 ? 'selected' : ''}>${s} мм²</option>`
      ).join('');

      return `
      <div class="section-item" data-id="${sec.id}">
        <div class="section-item-header">
          <div class="section-item-title">#${i + 1}. ${sec.name}</div>
          ${
            state.sections.length > 1
              ? `<button type="button" class="btn-remove-section" data-remove="${sec.id}">✕ Удалить</button>`
              : ''
          }
        </div>
        <div class="form-row form-row-4">
          <div class="form-group">
            <label class="form-label">Материал</label>
            <select class="form-select sec-material" data-id="${sec.id}">
              <option value="cu" ${sec.material === 'cu' ? 'selected' : ''}>Медь (Cu)</option>
              <option value="al" ${sec.material === 'al' ? 'selected' : ''}>Алюминий (Al)</option>
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">Сечение фазы (мм²)</label>
            <select class="form-select sec-phase" data-id="${sec.id}">
              ${crossSectionsOptions}
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">Сечение нуля/PE (мм²)</label>
            <select class="form-select sec-zero" data-id="${sec.id}">
              ${crossSectionsOptions}
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">Длина линии (м)</label>
            <input type="number" min="1" max="2000" step="1" class="form-input sec-length" data-id="${sec.id}" value="${sec.lengthMeters}">
          </div>
        </div>
      </div>
    `;
    })
    .join('');

  // Привязка обработчиков для динамических полей звеньев
  container.querySelectorAll('.sec-material').forEach((el) => {
    el.addEventListener('change', (e) => {
      const id = (e.target as HTMLElement).getAttribute('data-id');
      const sec = state.sections.find((s) => s.id === id);
      if (sec) sec.material = (e.target as HTMLSelectElement).value as any;
      recalculate();
    });
  });

  container.querySelectorAll('.sec-phase').forEach((el) => {
    el.addEventListener('change', (e) => {
      const id = (e.target as HTMLElement).getAttribute('data-id');
      const sec = state.sections.find((s) => s.id === id);
      if (sec) {
        sec.phaseCrossSectionMm2 = Number((e.target as HTMLSelectElement).value);
        // Синхронизируем сечение нуля по умолчанию
        const zeroEl = container.querySelector(`.sec-zero[data-id="${id}"]`) as HTMLSelectElement | null;
        if (zeroEl) {
          sec.zeroCrossSectionMm2 = sec.phaseCrossSectionMm2;
          zeroEl.value = String(sec.phaseCrossSectionMm2);
        }
      }
      recalculate();
    });
  });

  container.querySelectorAll('.sec-zero').forEach((el) => {
    el.addEventListener('change', (e) => {
      const id = (e.target as HTMLElement).getAttribute('data-id');
      const sec = state.sections.find((s) => s.id === id);
      if (sec) sec.zeroCrossSectionMm2 = Number((e.target as HTMLSelectElement).value);
      recalculate();
    });
  });

  container.querySelectorAll('.sec-length').forEach((el) => {
    el.addEventListener('input', (e) => {
      const id = (e.target as HTMLElement).getAttribute('data-id');
      const sec = state.sections.find((s) => s.id === id);
      if (sec) sec.lengthMeters = Number((e.target as HTMLInputElement).value) || 1;
      recalculate();
    });
  });

  container.querySelectorAll('.btn-remove-section').forEach((el) => {
    el.addEventListener('click', (e) => {
      const id = (e.target as HTMLElement).getAttribute('data-remove');
      state.sections = state.sections.filter((s) => s.id !== id);
      renderSections();
      recalculate();
    });
  });
}

// Главная функция пересчета и обновления табло
function recalculate() {
  const result = calculatePhaseZeroLoop({
    powerSource: {
      type: state.powerSourceType,
      transformerPowerKva: state.transformerPowerKva,
      transformerConnection: state.transformerConnection,
      vruIk3kA: state.vruIk3kA,
      vruXrRatio: state.vruXrRatio,
    },
    sections: state.sections.map((s) => ({
      name: s.name,
      material: s.material,
      phaseCrossSectionMm2: s.phaseCrossSectionMm2,
      zeroCrossSectionMm2: s.zeroCrossSectionMm2,
      lengthMeters: s.lengthMeters,
      conductorTempC: s.tempC,
    })),
    circuitBreaker: {
      ratedCurrentA: state.breakerRatedA,
      curve: state.breakerCurve,
      safetyFactor: state.safetyFactor,
    },
  });

  // 1. Карточка вердикта
  const verdictCard = document.getElementById('verdict-card');
  const verdictBadge = document.getElementById('verdict-badge');
  const verdictTitle = document.getElementById('verdict-title');
  const verdictDesc = document.getElementById('verdict-desc');
  const recommendationBox = document.getElementById('recommendation-box');

  if (verdictCard && verdictBadge && verdictTitle && verdictDesc) {
    if (result.isPueCompliant) {
      verdictCard.className = 'verdict-card success';
      verdictBadge.textContent = 'ПУЭ-7 п. 1.7.79 выполнено';
      verdictTitle.textContent = `✅ Допущено к эксплуатации (t ≤ 0.1 с)`;
      verdictDesc.textContent = `Ток однофазного КЗ (${result.ik1A.toFixed(0)} А) превышает порог гарантированной отсечки автомата (${result.requiredTripCurrentA.toFixed(0)} А) с запасом +${result.marginPercent.toFixed(1)}%.`;
      if (recommendationBox) recommendationBox.style.display = 'none';
    } else {
      verdictCard.className = 'verdict-card failure';
      verdictBadge.textContent = 'Отказ по п. 1.7.79 ПУЭ-7';
      verdictTitle.textContent = `❌ Замечание экспертизы: недостаточный ток КЗ`;
      verdictDesc.textContent = `Ток КЗ (${result.ik1A.toFixed(0)} А) ниже требуемого тока мгновенной отсечки (${result.requiredTripCurrentA.toFixed(0)} А). Дефицит: ${Math.abs(result.marginPercent).toFixed(1)}%. При КЗ автомат не отключится мгновенно.`;
      if (recommendationBox) {
        recommendationBox.style.display = 'block';
        recommendationBox.innerHTML = `<strong>💡 Рекомендация для проекта:</strong> ${result.recommendation ?? 'Увеличьте сечение кабеля или измените тип автомата.'}`;
      }
    }
  }

  // 2. Метрики в числовом табло
  const elIk1 = document.getElementById('val-ik1');
  const elZloop = document.getElementById('val-zloop');
  const elItrip = document.getElementById('val-itrip');
  const elMargin = document.getElementById('val-margin');

  if (elIk1) elIk1.textContent = result.ik1A >= 1000 ? `${(result.ik1A / 1000).toFixed(2)} кА` : `${result.ik1A.toFixed(0)} А`;
  if (elZloop) elZloop.textContent = `${result.loopImpedanceZ_Ohm.toFixed(3)} Ом`;
  if (elItrip) elItrip.textContent = `${result.requiredTripCurrentA.toFixed(0)} А`;
  if (elMargin) {
    const sign = result.marginPercent >= 0 ? '+' : '';
    elMargin.textContent = `${sign}${result.marginPercent.toFixed(1)}%`;
    elMargin.className = `metric-value ${result.marginPercent >= 0 ? 'green' : 'red'}`;
  }

  // 3. Детализация формулы и сопротивлений
  const elTable = document.getElementById('breakdown-tbody');
  if (elTable) {
    elTable.innerHTML = `
      <tr>
        <td>Источник (${result.sourceDescription})</td>
        <td class="mono">${result.sourceR_Ohm.toFixed(4)}</td>
        <td class="mono">${result.sourceX_Ohm.toFixed(4)}</td>
        <td class="mono">${result.sourceZ_Ohm.toFixed(4)}</td>
      </tr>
      ${result.sections
        .map(
          (s) => `
        <tr>
          <td>#${s.index} ${s.name}</td>
          <td class="mono">${s.rTotalSectionOhm.toFixed(4)}</td>
          <td class="mono">${s.xTotalSectionOhm.toFixed(4)}</td>
          <td class="mono">${s.zTotalSectionOhm.toFixed(4)}</td>
        </tr>
      `
        )
        .join('')}
      <tr>
        <td>Переходные контакты аппаратов (Rконт)</td>
        <td class="mono">${result.contactR_Ohm.toFixed(4)}</td>
        <td class="mono">0.0000</td>
        <td class="mono">${result.contactR_Ohm.toFixed(4)}</td>
      </tr>
      <tr style="font-weight: 700; border-top: 1px solid var(--border);">
        <td>Суммарная петля фаза-ноль (Zп-н)</td>
        <td class="mono">${result.totalR_Ohm.toFixed(4)}</td>
        <td class="mono">${result.totalX_Ohm.toFixed(4)}</td>
        <td class="mono" style="color: var(--accent-cyan);">${result.loopImpedanceZ_Ohm.toFixed(4)} Ом</td>
      </tr>
    `;
  }
}

// -----------------------------------------------------------------------------
// Инициализация модуля пакетного расчета Excel
// -----------------------------------------------------------------------------
function initBatchExcel() {
  const btnDownloadSample = document.getElementById('btn-download-sample-excel');
  const dropzone = document.getElementById('excel-dropzone');
  const fileInput = document.getElementById('excel-file-input') as HTMLInputElement | null;
  const btnBrowse = document.getElementById('btn-browse-excel');
  const btnReupload = document.getElementById('btn-reupload-excel');
  const searchInput = document.getElementById('batch-search-input') as HTMLInputElement | null;
  const filterButtons = document.querySelectorAll<HTMLButtonElement>('.filter-btn');

  // Скачивание образца журнала Excel
  btnDownloadSample?.addEventListener('click', () => {
    const u8 = generateSampleExcelWorkbook();
    const blob = new Blob([u8.buffer], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'Кабельный_журнал_шаблон_ГОСТ.xlsx';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  });

  // Выбор файла через кнопку
  btnBrowse?.addEventListener('click', (e) => {
    e.stopPropagation();
    fileInput?.click();
  });

  dropzone?.addEventListener('click', () => {
    fileInput?.click();
  });

  // Drag & drop события
  dropzone?.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropzone.classList.add('dragover');
  });

  dropzone?.addEventListener('dragleave', () => {
    dropzone.classList.remove('dragover');
  });

  dropzone?.addEventListener('drop', (e) => {
    e.preventDefault();
    dropzone.classList.remove('dragover');
    const files = e.dataTransfer?.files;
    if (files && files.length > 0) {
      processSelectedExcelFile(files[0]);
    }
  });

  fileInput?.addEventListener('change', () => {
    const files = fileInput.files;
    if (files && files.length > 0) {
      processSelectedExcelFile(files[0]);
    }
  });

  // Кнопка перезагрузки
  btnReupload?.addEventListener('click', () => {
    state.batchSummary = null;
    const uploadCard = document.getElementById('batch-upload-card');
    const resultsContainer = document.getElementById('batch-results-container');
    if (uploadCard) uploadCard.style.display = 'block';
    if (resultsContainer) resultsContainer.style.display = 'none';
    if (fileInput) fileInput.value = '';
  });

  // Фильтры
  filterButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      filterButtons.forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      state.batchFilter = (btn.getAttribute('data-filter') as any) || 'all';
      renderBatchTable();
    });
  });

  // Поиск
  searchInput?.addEventListener('input', (e) => {
    state.batchSearchQuery = (e.target as HTMLInputElement).value.trim().toLowerCase();
    renderBatchTable();
  });
}

function processSelectedExcelFile(file: File) {
  const reader = new FileReader();

  reader.onload = (e) => {
    const buffer = e.target?.result as ArrayBuffer;
    if (!buffer) return;

    const startTime = performance.now();

    // 1. Парсинг Excel в оперативной памяти (Zero-Server)
    const lines = parseExcelWorkbook(buffer);

    if (lines.length === 0) {
      alert('Не удалось прочитать строки кабельного журнала. Проверьте формат файла Excel или скачайте наш образец.');
      return;
    }

    // 2. Расчет всех линий по текущим параметрам источника
    const summary = calculateBatchLines(lines, {
      type: state.powerSourceType,
      transformerPowerKva: state.transformerPowerKva,
      transformerConnection: state.transformerConnection,
      vruIk3kA: state.vruIk3kA,
      vruXrRatio: state.vruXrRatio,
    });

    const elapsedMs = Math.round(performance.now() - startTime);

    state.batchSummary = summary;

    // 3. Обновление интерфейса
    const uploadCard = document.getElementById('batch-upload-card');
    const resultsContainer = document.getElementById('batch-results-container');
    if (uploadCard) uploadCard.style.display = 'none';
    if (resultsContainer) resultsContainer.style.display = 'block';

    // Обновление карточек статистики
    const statTotal = document.getElementById('batch-stat-total');
    const statOk = document.getElementById('batch-stat-ok');
    const statFail = document.getElementById('batch-stat-fail');
    const statSpeed = document.getElementById('batch-stat-speed');

    if (statTotal) statTotal.textContent = String(summary.totalLines);
    if (statOk) statOk.textContent = String(summary.successCount);
    if (statFail) statFail.textContent = String(summary.failureCount);
    if (statSpeed) statSpeed.textContent = `${elapsedMs} мс`;

    // Счетчики на кнопках фильтров
    const countAll = document.getElementById('count-filter-all');
    const countFails = document.getElementById('count-filter-fails');
    const countPassed = document.getElementById('count-filter-passed');

    if (countAll) countAll.textContent = String(summary.totalLines);
    if (countFails) countFails.textContent = String(summary.failureCount);
    if (countPassed) countPassed.textContent = String(summary.successCount);

    renderBatchTable();
  };

  reader.readAsArrayBuffer(file);
}

function renderBatchTable() {
  const tbody = document.getElementById('batch-table-body');
  if (!tbody || !state.batchSummary) return;

  const { lines } = state.batchSummary;
  const filter = state.batchFilter;
  const search = state.batchSearchQuery;

  const filtered = lines.filter((line) => {
    // Фильтр по статусу
    if (filter === 'fails' && line.calculation?.isPueCompliant) return false;
    if (filter === 'passed' && !line.calculation?.isPueCompliant) return false;

    // Поиск
    if (search) {
      const matchLine = line.lineNumber.toLowerCase().includes(search);
      const matchConsumer = line.consumerName.toLowerCase().includes(search);
      const matchCable = line.cableMark.toLowerCase().includes(search);
      const matchBreaker = line.breakerModel.toLowerCase().includes(search);
      if (!matchLine && !matchConsumer && !matchCable && !matchBreaker) return false;
    }

    return true;
  });

  if (filtered.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="9" style="text-align: center; padding: 32px; color: var(--text-dim);">
          Нет линий, соответствующих выбранному фильтру или поисковому запросу.
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = filtered
    .map((line, idx) => {
      const calc = line.calculation;
      const isOk = calc?.isPueCompliant ?? false;
      const ik1Formatted = calc ? (calc.ik1A >= 1000 ? `${(calc.ik1A / 1000).toFixed(2)} кА` : `${calc.ik1A.toFixed(0)} А`) : '—';
      const itripFormatted = calc ? `${calc.requiredTripCurrentA.toFixed(0)} А` : '—';
      const marginFormatted = calc ? `${calc.marginPercent >= 0 ? '+' : ''}${calc.marginPercent.toFixed(1)}%` : '';

      const mainRow = `
        <tr>
          <td style="color: var(--text-dim); font-mono;">${idx + 1}</td>
          <td style="font-weight: 700; color: var(--text-main);">${escapeHtml(line.lineNumber)}</td>
          <td>${escapeHtml(line.consumerName || '—')}</td>
          <td>
            <span style="font-weight: 600;">${escapeHtml(line.cableMark)}</span>
            <div class="info-tip" style="margin: 0;">${line.material === 'cu' ? 'Cu' : 'Al'} ${line.phaseSectionMm2}/${line.zeroSectionMm2} мм²</div>
          </td>
          <td class="mono">${line.lengthM} м</td>
          <td><span class="code-badge">${escapeHtml(line.breakerModel)}</span></td>
          <td class="mono" style="font-weight: 700; color: var(--accent-cyan);">${ik1Formatted}</td>
          <td class="mono">${itripFormatted}</td>
          <td>
            <span class="status-badge ${isOk ? 'ok' : 'fail'}">
              ${isOk ? '✅ ОК (t ≤ 0.1 с)' : '❌ ОТКАЗ'}
            </span>
            <div class="info-tip" style="margin-top: 2px; color: ${isOk ? 'var(--accent-green)' : 'var(--accent-red)'}; font-weight: 600;">
              ${marginFormatted}
            </div>
          </td>
        </tr>
      `;

      // Если замечание, добавляем подстроку с рекомендацией
      const recRow = !isOk && calc?.recommendation
        ? `
        <tr class="recommendation-subrow">
          <td></td>
          <td colspan="8">
            ⚠️ <strong>Замечание экспертизы:</strong> Ток КЗ (${ik1Formatted}) меньше порога срабатывания автомата (${itripFormatted}).<br>
            💡 <strong>Рекомендация:</strong> ${escapeHtml(calc.recommendation)}
          </td>
        </tr>
      `
        : '';

      return mainRow + recRow;
    })
    .join('');
}

function escapeHtml(str: string): string {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
