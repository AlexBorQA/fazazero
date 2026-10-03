/**
 * Fazazero (КЗ-Эксперт) — Интерактивный клиентский контроллер v2.0
 * 100% Client-Side SaaS.
 * 3 независимых инженерных экрана:
 * 1. Экспресс-линия (1 кабель + 1 автомат)
 * 2. Каскадная магистраль (до 10 звеньев со своими автоматами)
 * 3. Кабельный журнал щита (Excel с реактивным пересчетом на лету)
 */

import {
  calculatePhaseZeroLoop,
  calculateCascade,
  TRANSFORMERS_CATALOG,
  STANDARD_CROSS_SECTIONS,
  STANDARD_BREAKER_RATINGS,
  getTransformerParameters,
  parseExcelWorkbook,
  calculateBatchLines,
  generateSampleExcelWorkbook,
  generateLargeSampleExcelWorkbook,
  generateDocxBlob,
  generateLineCorrections,
  applyCorrectionToLine,
  autoRemediateAllLines,
  isMotorLoad,
  type ParsedCableLine,
  type BatchCalculationSummary,
  type DocxReportInput,
  type DocxReportLineItem,
  type CalculationResult,
  type CascadeCalculationResult,
  type ConductorMaterial,
  type BreakerCurveType,
  type PowerSourceInput,
  type LineCorrectionType,
  type LineRemediationRecord,
} from '../core/index.ts';

// -----------------------------------------------------------------------------
// Состояние приложения
// -----------------------------------------------------------------------------

interface CascadeTierState {
  id: string;
  name: string;
  material: ConductorMaterial;
  phaseCrossSectionMm2: number;
  zeroCrossSectionMm2: number;
  lengthMeters: number;
  tempC: number;
  breakerRatedA: number;
  breakerCurve: BreakerCurveType;
}

const state = {
  // ЭКРАН 1: Экспресс-линия
  single: {
    powerSourceType: 'transformer' as 'transformer' | 'vru_tu',
    transformerPowerKva: 630,
    transformerConnection: 'D/Yn-11' as 'D/Yn-11' | 'Y/Yn-0',
    vruIk3kA: 12.5,
    vruXrRatio: 3.5,

    material: 'cu' as ConductorMaterial,
    phaseCrossSectionMm2: 2.5,
    zeroCrossSectionMm2: 2.5,
    lengthMeters: 35,
    tempC: 65,

    breakerRatedA: 16,
    breakerCurve: 'C' as BreakerCurveType,
    safetyFactor: 1.1,

    lastResult: null as CalculationResult | null,
  },

  // ЭКРАН 2: Каскадная магистраль (до 10 ступеней)
  cascade: {
    powerSourceType: 'transformer' as 'transformer' | 'vru_tu',
    transformerPowerKva: 630,
    transformerConnection: 'D/Yn-11' as 'D/Yn-11' | 'Y/Yn-0',
    vruIk3kA: 12.5,
    vruXrRatio: 3.5,

    tiers: [
      {
        id: 'tier-1',
        name: 'Ступень 1: Магистраль от ТП до ВРУ',
        material: 'al',
        phaseCrossSectionMm2: 120,
        zeroCrossSectionMm2: 70,
        lengthMeters: 60,
        tempC: 65,
        breakerRatedA: 200,
        breakerCurve: 'C',
      },
      {
        id: 'tier-2',
        name: 'Ступень 2: Распределительный стояк (ВРУ — ЩЭ)',
        material: 'cu',
        phaseCrossSectionMm2: 16,
        zeroCrossSectionMm2: 16,
        lengthMeters: 25,
        tempC: 65,
        breakerRatedA: 50,
        breakerCurve: 'C',
      },
      {
        id: 'tier-3',
        name: 'Ступень 3: Групповая линия (ЩЭ — розетки кухни)',
        material: 'cu',
        phaseCrossSectionMm2: 2.5,
        zeroCrossSectionMm2: 2.5,
        lengthMeters: 35,
        tempC: 65,
        breakerRatedA: 16,
        breakerCurve: 'C',
      },
    ] as CascadeTierState[],

    lastResult: null as CascadeCalculationResult | null,
  },

  // ЭКРАН 3: Кабельный журнал щита (Excel)
  batch: {
    powerSourceType: 'transformer' as 'transformer' | 'vru_tu',
    transformerPowerKva: 630,
    transformerConnection: 'D/Yn-11' as 'D/Yn-11' | 'Y/Yn-0',
    vruIk3kA: 12.5,
    vruXrRatio: 3.5,

    rawLines: [] as ParsedCableLine[],
    summary: null as BatchCalculationSummary | null,
    filter: 'all' as 'all' | 'fails' | 'passed',
    searchQuery: '',
    lastElapsedMs: 0,
    expandedCorrectionRows: new Set<number>(),
  },

  // Модальное окно выгрузки тома Word
  docxExportMode: 'single' as 'single' | 'cascade' | 'batch',
};

// -----------------------------------------------------------------------------
// Инициализация
// -----------------------------------------------------------------------------
function initApp() {
  initTabs();
  initSecurityModal();
  initServiceWorkerAndPwa();
  initDocxModal();

  initScreenSingle();
  initScreenCascade();
  initScreenBatch();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initApp);
} else {
  initApp();
}

// -----------------------------------------------------------------------------
// Вкладки верхнего уровня (3 экрана)
// -----------------------------------------------------------------------------
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

// -----------------------------------------------------------------------------
// Модальное окно аудита для СБ
// -----------------------------------------------------------------------------
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

// -----------------------------------------------------------------------------
// Регистрация Service Worker и тихое PWA-управление (B2B Pro)
// -----------------------------------------------------------------------------
let deferredInstallPrompt: any = null;

function initServiceWorkerAndPwa() {
  // 1. Регистрация Service Worker в изолированном фоновом потоке
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker
        .register('./sw.js')
        .then((reg) => {
          console.log('[SW] Service Worker успешно зарегистрирован, scope:', reg.scope);
        })
        .catch((err) => {
          console.warn('[SW] Ошибка регистрации Service Worker:', err);
        });
    });
  }

  const btnInstall = document.getElementById('btn-install-pwa') as HTMLButtonElement | null;
  const statusEl = document.getElementById('pwa-install-status');

  const isStandalone =
    window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as any).standalone === true;

  if (isStandalone && btnInstall) {
    btnInstall.disabled = true;
    btnInstall.innerHTML = '✅ Приложение установлено';
    btnInstall.style.opacity = '0.7';
    if (statusEl) {
      statusEl.style.display = 'block';
      statusEl.textContent = 'Приложение запущено в изолированном окне рабочего стола.';
    }
  }

  // 2. Перехват и глушение автоматического навязчивого баннера браузера
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredInstallPrompt = e;
    console.log('[PWA] Событие beforeinstallprompt перехвачено (тихий режим)');
    if (btnInstall && !isStandalone) {
      btnInstall.style.display = 'inline-block';
    }
  });

  window.addEventListener('appinstalled', () => {
    deferredInstallPrompt = null;
    console.log('[PWA] Fazazero установлено на рабочий стол');
    if (btnInstall) {
      btnInstall.disabled = true;
      btnInstall.innerHTML = '✅ Успешно установлено';
    }
    if (statusEl) {
      statusEl.style.display = 'block';
      statusEl.textContent = 'Приложение добавлено на рабочий стол / в программы.';
    }
  });

  // 3. Обработчик клика по кнопке в модальном окне СБ / Корпоративной лицензии
  btnInstall?.addEventListener('click', async () => {
    if (isStandalone) {
      alert('Fazazero уже работает как отдельное автономное приложение на вашем компьютере.');
      return;
    }

    if (deferredInstallPrompt) {
      deferredInstallPrompt.prompt();
      const choice = await deferredInstallPrompt.userChoice;
      console.log('[PWA] Выбор установки:', choice.outcome);
      if (choice.outcome === 'accepted') {
        deferredInstallPrompt = null;
      }
    } else {
      alert(
        'Инструкция по установке автономного приложения:\n\n' +
        '• Яндекс.Браузер / Chrome / Edge:\n' +
        '  Нажмите на значок «Установить» в правой части адресной строки браузера.\n\n' +
        '• Safari на macOS:\n' +
        '  В верхнем меню выберите: «Файл» ➔ «Добавить в Dock...».\n\n' +
        'Приложение появится в Launchpad/Программах и сможет работать в закрытом контуре без интернета.'
      );
    }
  });
}

// -----------------------------------------------------------------------------
// ЭКРАН 1: ОДИНОЧНАЯ ЛИНИЯ-ЭКСПРЕСС
// -----------------------------------------------------------------------------
function initScreenSingle() {
  // Селекты источника
  populateTransformerSelect('single-tp-power', state.single.transformerPowerKva);
  populateBreakerSelect('single-breaker-rating', state.single.breakerRatedA);
  populateCrossSectionSelect('single-cable-phase', state.single.phaseCrossSectionMm2);
  populateCrossSectionSelect('single-cable-zero', state.single.zeroCrossSectionMm2);

  const btnSrcTp = document.getElementById('single-btn-src-tp');
  const btnSrcVru = document.getElementById('single-btn-src-vru');
  const blockTp = document.getElementById('single-block-source-tp');
  const blockVru = document.getElementById('single-block-source-vru');

  btnSrcTp?.addEventListener('click', () => {
    state.single.powerSourceType = 'transformer';
    btnSrcTp.classList.add('active');
    btnSrcVru?.classList.remove('active');
    blockTp?.style.setProperty('display', 'block');
    blockVru?.style.setProperty('display', 'none');
    recalculateSingle();
  });

  btnSrcVru?.addEventListener('click', () => {
    state.single.powerSourceType = 'vru_tu';
    btnSrcVru.classList.add('active');
    btnSrcTp?.classList.remove('active');
    blockVru?.style.setProperty('display', 'block');
    blockTp?.style.setProperty('display', 'none');
    recalculateSingle();
  });

  document.getElementById('single-tp-power')?.addEventListener('change', (e) => {
    state.single.transformerPowerKva = Number((e.target as HTMLSelectElement).value);
    updateTpSpecsLabel('single-tp-specs-label', state.single.transformerPowerKva, state.single.transformerConnection);
    recalculateSingle();
  });

  document.getElementById('single-tp-connection')?.addEventListener('change', (e) => {
    state.single.transformerConnection = (e.target as HTMLSelectElement).value as any;
    updateTpSpecsLabel('single-tp-specs-label', state.single.transformerPowerKva, state.single.transformerConnection);
    recalculateSingle();
  });

  document.getElementById('single-vru-ik3')?.addEventListener('input', (e) => {
    state.single.vruIk3kA = Number((e.target as HTMLInputElement).value) || 10;
    recalculateSingle();
  });

  document.getElementById('single-vru-xr')?.addEventListener('input', (e) => {
    state.single.vruXrRatio = Number((e.target as HTMLInputElement).value) || 3.5;
    recalculateSingle();
  });

  document.getElementById('single-cable-material')?.addEventListener('change', (e) => {
    state.single.material = (e.target as HTMLSelectElement).value as ConductorMaterial;
    recalculateSingle();
  });

  document.getElementById('single-cable-length')?.addEventListener('input', (e) => {
    state.single.lengthMeters = Number((e.target as HTMLInputElement).value) || 1;
    recalculateSingle();
  });

  document.getElementById('single-cable-phase')?.addEventListener('change', (e) => {
    state.single.phaseCrossSectionMm2 = Number((e.target as HTMLSelectElement).value);
    recalculateSingle();
  });

  document.getElementById('single-cable-zero')?.addEventListener('change', (e) => {
    state.single.zeroCrossSectionMm2 = Number((e.target as HTMLSelectElement).value);
    recalculateSingle();
  });

  document.getElementById('single-breaker-rating')?.addEventListener('change', (e) => {
    state.single.breakerRatedA = Number((e.target as HTMLSelectElement).value);
    recalculateSingle();
  });

  document.getElementById('single-breaker-curve')?.addEventListener('change', (e) => {
    state.single.breakerCurve = (e.target as HTMLSelectElement).value as BreakerCurveType;
    recalculateSingle();
  });

  updateTpSpecsLabel('single-tp-specs-label', state.single.transformerPowerKva, state.single.transformerConnection);
  recalculateSingle();
}

function recalculateSingle() {
  const result = calculatePhaseZeroLoop({
    powerSource: {
      type: state.single.powerSourceType,
      transformerPowerKva: state.single.transformerPowerKva,
      transformerConnection: state.single.transformerConnection,
      vruIk3kA: state.single.vruIk3kA,
      vruXrRatio: state.single.vruXrRatio,
    },
    sections: [
      {
        name: 'Линия потребителя',
        material: state.single.material,
        phaseCrossSectionMm2: state.single.phaseCrossSectionMm2,
        zeroCrossSectionMm2: state.single.zeroCrossSectionMm2,
        lengthMeters: state.single.lengthMeters,
        conductorTempC: state.single.tempC,
      },
    ],
    circuitBreaker: {
      ratedCurrentA: state.single.breakerRatedA,
      curve: state.single.breakerCurve,
      safetyFactor: state.single.safetyFactor,
    },
  });

  state.single.lastResult = result;

  const card = document.getElementById('single-verdict-card');
  const badge = document.getElementById('single-verdict-badge');
  const title = document.getElementById('single-verdict-title');
  const desc = document.getElementById('single-verdict-desc');
  const recBox = document.getElementById('single-recommendation-box');

  if (card && badge && title && desc) {
    if (result.isPueCompliant) {
      card.className = 'verdict-card success';
      badge.textContent = 'ПУЭ-7 п. 1.7.79 выполнено';
      title.textContent = '✅ Допущено к эксплуатации (t ≤ 0.1 с)';
      desc.textContent = `Ток однофазного КЗ (${result.ik1A.toFixed(0)} А) превышает порог гарантированной отсечки автомата (${result.requiredTripCurrentA.toFixed(0)} А) с запасом +${result.marginPercent.toFixed(1)}%.`;
      if (recBox) recBox.style.display = 'none';
    } else {
      card.className = 'verdict-card failure';
      badge.textContent = 'Отказ по п. 1.7.79 ПУЭ-7';
      title.textContent = '❌ Замечание экспертизы: недостаточный ток КЗ';
      desc.textContent = `Ток КЗ (${result.ik1A.toFixed(0)} А) ниже требуемого тока мгновенной отсечки (${result.requiredTripCurrentA.toFixed(0)} А). Дефицит: ${Math.abs(result.marginPercent).toFixed(1)}%.`;
      if (recBox) {
        recBox.style.display = 'block';
        recBox.innerHTML = `<strong>💡 Рекомендация для проекта:</strong> ${result.recommendation ?? 'Увеличьте сечение кабеля или измените тип автомата.'}`;
      }
    }
  }

  const elIk1 = document.getElementById('single-val-ik1');
  const elItrip = document.getElementById('single-val-itrip');
  const elZloop = document.getElementById('single-val-zloop');
  const elMargin = document.getElementById('single-val-margin');

  if (elIk1) elIk1.textContent = result.ik1A >= 1000 ? `${(result.ik1A / 1000).toFixed(2)} кА` : `${result.ik1A.toFixed(0)} А`;
  if (elItrip) elItrip.textContent = `${result.requiredTripCurrentA.toFixed(0)} А`;
  if (elZloop) elZloop.textContent = `${result.loopImpedanceZ_Ohm.toFixed(3)} Ом`;
  if (elMargin) {
    const sign = result.marginPercent >= 0 ? '+' : '';
    elMargin.textContent = `${sign}${result.marginPercent.toFixed(1)}%`;
    elMargin.className = `metric-value ${result.marginPercent >= 0 ? 'green' : 'red'}`;
  }

  const elTbody = document.getElementById('single-breakdown-tbody');
  if (elTbody) {
    elTbody.innerHTML = `
      <tr>
        <td>Источник (${result.sourceDescription})</td>
        <td class="mono">${result.sourceR_Ohm.toFixed(4)}</td>
        <td class="mono">${result.sourceX_Ohm.toFixed(4)}</td>
        <td class="mono">${result.sourceZ_Ohm.toFixed(4)}</td>
      </tr>
      <tr>
        <td>Кабельная линия (L = ${state.single.lengthMeters} м, +65 °C)</td>
        <td class="mono">${result.cablesR_Ohm.toFixed(4)}</td>
        <td class="mono">${result.cablesX_Ohm.toFixed(4)}</td>
        <td class="mono">${Math.hypot(result.cablesR_Ohm, result.cablesX_Ohm).toFixed(4)}</td>
      </tr>
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
// ЭКРАН 2: КАСКАДНАЯ МАГИСТРАЛЬ (ДО 10 СТУПЕНЕЙ СО СВОИМИ АВТОМАТАМИ)
// -----------------------------------------------------------------------------
function initScreenCascade() {
  populateTransformerSelect('cascade-tp-power', state.cascade.transformerPowerKva);

  const btnSrcTp = document.getElementById('cascade-btn-src-tp');
  const btnSrcVru = document.getElementById('cascade-btn-src-vru');
  const blockTp = document.getElementById('cascade-block-source-tp');
  const blockVru = document.getElementById('cascade-block-source-vru');

  btnSrcTp?.addEventListener('click', () => {
    state.cascade.powerSourceType = 'transformer';
    btnSrcTp.classList.add('active');
    btnSrcVru?.classList.remove('active');
    blockTp?.style.setProperty('display', 'block');
    blockVru?.style.setProperty('display', 'none');
    recalculateCascade();
  });

  btnSrcVru?.addEventListener('click', () => {
    state.cascade.powerSourceType = 'vru_tu';
    btnSrcVru.classList.add('active');
    btnSrcTp?.classList.remove('active');
    blockVru?.style.setProperty('display', 'block');
    blockTp?.style.setProperty('display', 'none');
    recalculateCascade();
  });

  document.getElementById('cascade-tp-power')?.addEventListener('change', (e) => {
    state.cascade.transformerPowerKva = Number((e.target as HTMLSelectElement).value);
    updateTpSpecsLabel('cascade-tp-specs-label', state.cascade.transformerPowerKva, state.cascade.transformerConnection);
    recalculateCascade();
  });

  document.getElementById('cascade-tp-connection')?.addEventListener('change', (e) => {
    state.cascade.transformerConnection = (e.target as HTMLSelectElement).value as any;
    updateTpSpecsLabel('cascade-tp-specs-label', state.cascade.transformerPowerKva, state.cascade.transformerConnection);
    recalculateCascade();
  });

  document.getElementById('cascade-vru-ik3')?.addEventListener('input', (e) => {
    state.cascade.vruIk3kA = Number((e.target as HTMLInputElement).value) || 10;
    recalculateCascade();
  });

  document.getElementById('cascade-vru-xr')?.addEventListener('input', (e) => {
    state.cascade.vruXrRatio = Number((e.target as HTMLInputElement).value) || 3.5;
    recalculateCascade();
  });

  // Кнопка добавления звена (до 10 звеньев)
  document.getElementById('btn-add-cascade-tier')?.addEventListener('click', () => {
    if (state.cascade.tiers.length >= 10) {
      alert('Максимальное число ступеней магистрали — 10.');
      return;
    }
    const idx = state.cascade.tiers.length + 1;
    state.cascade.tiers.push({
      id: `tier-${Date.now()}`,
      name: `Ступень ${idx}: Линия цепи`,
      material: 'cu',
      phaseCrossSectionMm2: 2.5,
      zeroCrossSectionMm2: 2.5,
      lengthMeters: 20,
      tempC: 65,
      breakerRatedA: 16,
      breakerCurve: 'C',
    });
    renderCascadeTiers();
    recalculateCascade();
  });

  updateTpSpecsLabel('cascade-tp-specs-label', state.cascade.transformerPowerKva, state.cascade.transformerConnection);
  renderCascadeTiers();
  recalculateCascade();
}

function renderCascadeTiers() {
  const container = document.getElementById('cascade-tiers-container');
  if (!container) return;

  container.innerHTML = state.cascade.tiers
    .map((tier, idx) => {
      const phaseOptions = STANDARD_CROSS_SECTIONS.map(
        (s) => `<option value="${s}" ${s === tier.phaseCrossSectionMm2 ? 'selected' : ''}>${s} мм²</option>`
      ).join('');
      const zeroOptions = STANDARD_CROSS_SECTIONS.map(
        (s) => `<option value="${s}" ${s === tier.zeroCrossSectionMm2 ? 'selected' : ''}>${s} мм²</option>`
      ).join('');
      const breakerOptions = STANDARD_BREAKER_RATINGS.map(
        (r) => `<option value="${r}" ${r === tier.breakerRatedA ? 'selected' : ''}>${r} А</option>`
      ).join('');

      return `
      <div class="section-item" data-tier-id="${tier.id}">
        <div class="section-item-header">
          <div style="display: flex; align-items: center; gap: 8px;">
            <span class="tier-badge">Ступень ${idx + 1}</span>
            <input type="text" class="form-input tier-name" data-id="${tier.id}" value="${escapeHtml(tier.name)}" style="font-weight: 700; width: auto; max-width: 320px; padding: 4px 8px; font-size: 13px;" />
          </div>
          ${
            state.cascade.tiers.length > 1
              ? `<button type="button" class="btn-remove-section btn-remove-tier" data-id="${tier.id}">✕ Удалить</button>`
              : ''
          }
        </div>

        <!-- Параметры кабеля -->
        <div class="form-row form-row-4" style="margin-bottom: 10px;">
          <div class="form-group" style="margin: 0;">
            <label class="form-label" style="font-size: 11px;">Материал</label>
            <select class="form-select tier-material" data-id="${tier.id}" style="padding: 6px 10px; font-size: 13px;">
              <option value="cu" ${tier.material === 'cu' ? 'selected' : ''}>Медь (Cu)</option>
              <option value="al" ${tier.material === 'al' ? 'selected' : ''}>Алюминий (Al)</option>
            </select>
          </div>
          <div class="form-group" style="margin: 0;">
            <label class="form-label" style="font-size: 11px;">Сечение фазы</label>
            <select class="form-select tier-phase" data-id="${tier.id}" style="padding: 6px 10px; font-size: 13px;">
              ${phaseOptions}
            </select>
          </div>
          <div class="form-group" style="margin: 0;">
            <label class="form-label" style="font-size: 11px;">Сечение нуля</label>
            <select class="form-select tier-zero" data-id="${tier.id}" style="padding: 6px 10px; font-size: 13px;">
              ${zeroOptions}
            </select>
          </div>
          <div class="form-group" style="margin: 0;">
            <label class="form-label" style="font-size: 11px;">Длина участка, м</label>
            <input type="number" class="form-input tier-length" data-id="${tier.id}" value="${tier.lengthMeters}" min="1" max="2000" style="padding: 6px 10px; font-size: 13px;" />
          </div>
        </div>

        <!-- Защитный аппарат ступени -->
        <div style="background: rgba(15, 23, 42, 0.4); padding: 8px 12px; border-radius: 6px; border: 1px solid rgba(255, 255, 255, 0.05); display: flex; align-items: center; gap: 12px; flex-wrap: wrap;">
          <span style="font-size: 12px; font-weight: 600; color: var(--accent-cyan);">🛡️ Автомат ступени:</span>
          <div style="display: flex; gap: 8px; align-items: center;">
            <span style="font-size: 12px; color: var(--text-dim);">Номинал In:</span>
            <select class="form-select tier-breaker-rating" data-id="${tier.id}" style="width: auto; padding: 4px 8px; font-size: 12px;">
              ${breakerOptions}
            </select>
          </div>
          <div style="display: flex; gap: 8px; align-items: center;">
            <span style="font-size: 12px; color: var(--text-dim);">Кривая:</span>
            <select class="form-select tier-breaker-curve" data-id="${tier.id}" style="width: auto; padding: 4px 8px; font-size: 12px;">
              <option value="B" ${tier.breakerCurve === 'B' ? 'selected' : ''}>B (3–5 In)</option>
              <option value="C" ${tier.breakerCurve === 'C' ? 'selected' : ''}>C (5–10 In)</option>
              <option value="D" ${tier.breakerCurve === 'D' ? 'selected' : ''}>D (10–14 In)</option>
            </select>
          </div>
        </div>
      </div>
      `;
    })
    .join('');

  // Привязка обработчиков внутри звеньев
  container.querySelectorAll('.tier-name').forEach((el) => {
    el.addEventListener('input', (e) => {
      const id = (e.target as HTMLElement).getAttribute('data-id');
      const item = state.cascade.tiers.find((t) => t.id === id);
      if (item) item.name = (e.target as HTMLInputElement).value;
      recalculateCascade();
    });
  });

  container.querySelectorAll('.tier-material').forEach((el) => {
    el.addEventListener('change', (e) => {
      const id = (e.target as HTMLElement).getAttribute('data-id');
      const item = state.cascade.tiers.find((t) => t.id === id);
      if (item) item.material = (e.target as HTMLSelectElement).value as ConductorMaterial;
      recalculateCascade();
    });
  });

  container.querySelectorAll('.tier-phase').forEach((el) => {
    el.addEventListener('change', (e) => {
      const id = (e.target as HTMLElement).getAttribute('data-id');
      const item = state.cascade.tiers.find((t) => t.id === id);
      if (item) item.phaseCrossSectionMm2 = Number((e.target as HTMLSelectElement).value);
      recalculateCascade();
    });
  });

  container.querySelectorAll('.tier-zero').forEach((el) => {
    el.addEventListener('change', (e) => {
      const id = (e.target as HTMLElement).getAttribute('data-id');
      const item = state.cascade.tiers.find((t) => t.id === id);
      if (item) item.zeroCrossSectionMm2 = Number((e.target as HTMLSelectElement).value);
      recalculateCascade();
    });
  });

  container.querySelectorAll('.tier-length').forEach((el) => {
    el.addEventListener('input', (e) => {
      const id = (e.target as HTMLElement).getAttribute('data-id');
      const item = state.cascade.tiers.find((t) => t.id === id);
      if (item) item.lengthMeters = Number((e.target as HTMLInputElement).value) || 1;
      recalculateCascade();
    });
  });

  container.querySelectorAll('.tier-breaker-rating').forEach((el) => {
    el.addEventListener('change', (e) => {
      const id = (e.target as HTMLElement).getAttribute('data-id');
      const item = state.cascade.tiers.find((t) => t.id === id);
      if (item) item.breakerRatedA = Number((e.target as HTMLSelectElement).value);
      recalculateCascade();
    });
  });

  container.querySelectorAll('.tier-breaker-curve').forEach((el) => {
    el.addEventListener('change', (e) => {
      const id = (e.target as HTMLElement).getAttribute('data-id');
      const item = state.cascade.tiers.find((t) => t.id === id);
      if (item) item.breakerCurve = (e.target as HTMLSelectElement).value as BreakerCurveType;
      recalculateCascade();
    });
  });

  container.querySelectorAll('.btn-remove-tier').forEach((el) => {
    el.addEventListener('click', (e) => {
      const id = (e.target as HTMLElement).getAttribute('data-id');
      state.cascade.tiers = state.cascade.tiers.filter((t) => t.id !== id);
      renderCascadeTiers();
      recalculateCascade();
    });
  });
}

function recalculateCascade() {
  const result = calculateCascade({
    powerSource: {
      type: state.cascade.powerSourceType,
      transformerPowerKva: state.cascade.transformerPowerKva,
      transformerConnection: state.cascade.transformerConnection,
      vruIk3kA: state.cascade.vruIk3kA,
      vruXrRatio: state.cascade.vruXrRatio,
    },
    tiers: state.cascade.tiers.map((t) => ({
      name: t.name,
      cable: {
        material: t.material,
        phaseCrossSectionMm2: t.phaseCrossSectionMm2,
        zeroCrossSectionMm2: t.zeroCrossSectionMm2,
        lengthMeters: t.lengthMeters,
        conductorTempC: t.tempC,
      },
      circuitBreaker: {
        ratedCurrentA: t.breakerRatedA,
        curve: t.breakerCurve,
        safetyFactor: 1.1,
      },
    })),
  });

  state.cascade.lastResult = result;

  const card = document.getElementById('cascade-verdict-card');
  const badge = document.getElementById('cascade-verdict-badge');
  const title = document.getElementById('cascade-verdict-title');
  const desc = document.getElementById('cascade-verdict-desc');

  if (card && badge && title && desc) {
    if (result.overallIsPueCompliant) {
      card.className = 'verdict-card success';
      badge.textContent = 'Все ступени соответствуют ПУЭ-7';
      title.textContent = `✅ Магистраль надежно защищена (${result.passedBreakersCount} из ${result.totalBreakersCount})`;
      desc.textContent = `Ток однофазного КЗ на каждом участке цепи достаточен для мгновенного отключения своего аппарата защиты (t ≤ 0.1 с).`;
    } else {
      card.className = 'verdict-card failure';
      badge.textContent = 'Отказ на ступенях магистрали';
      title.textContent = `❌ Замечание ПУЭ: ${result.failedBreakersCount} из ${result.totalBreakersCount} автоматов не сработают`;
      desc.textContent = `Внимание! На некоторых участках ток КЗ ниже порога отсечки установленного автомата. Проверьте ведомость ступеней ниже.`;
    }
  }

  const elEndIk1 = document.getElementById('cascade-val-end-ik1');
  const elTotalLen = document.getElementById('cascade-val-total-length');
  const elTotalZ = document.getElementById('cascade-val-total-z');
  const elBreakersStat = document.getElementById('cascade-val-breakers-stat');

  if (elEndIk1) elEndIk1.textContent = result.endIk1A >= 1000 ? `${(result.endIk1A / 1000).toFixed(2)} кА` : `${result.endIk1A.toFixed(0)} А`;
  if (elTotalLen) elTotalLen.textContent = `${result.totalLengthM} м`;
  if (elTotalZ) elTotalZ.textContent = `${result.totalLoopImpedanceZ_Ohm.toFixed(3)} Ом`;
  if (elBreakersStat) {
    elBreakersStat.textContent = `${result.passedBreakersCount} из ${result.totalBreakersCount} ✅`;
    elBreakersStat.className = `metric-value ${result.overallIsPueCompliant ? 'green' : 'red'}`;
  }

  const elTbody = document.getElementById('cascade-breakdown-tbody');
  if (elTbody) {
    elTbody.innerHTML = result.tiers
      .map((tier) => {
        const ev = tier.breakerEvaluation;
        const isOk = ev?.isCompliant ?? false;
        const ik1Formatted = tier.ik1A >= 1000 ? `${(tier.ik1A / 1000).toFixed(2)} кА` : `${tier.ik1A.toFixed(0)} А`;
        const itripFormatted = ev ? `${ev.requiredTripCurrentA.toFixed(0)} А` : '—';
        const marginFormatted = ev ? `${ev.marginPercent >= 0 ? '+' : ''}${ev.marginPercent.toFixed(1)}%` : '';

        return `
        <tr>
          <td>
            <div style="font-weight: 700; color: var(--text-main); font-size: 13px;">#${tier.index}. ${escapeHtml(tier.name)}</div>
            <div class="info-tip" style="margin: 0;">${tier.section.material === 'cu' ? 'Cu' : 'Al'} ${tier.section.phaseCrossSectionMm2}/${tier.section.zeroCrossSectionMm2} мм², L = ${tier.section.lengthM} м</div>
          </td>
          <td class="mono">${tier.cumulativeLengthM} м</td>
          <td class="mono">${tier.loopImpedanceZ_Ohm.toFixed(3)} Ом</td>
          <td class="mono" style="font-weight: 700; color: var(--accent-cyan);">${ik1Formatted}</td>
          <td><span class="code-badge">${tier.circuitBreaker?.curve}${tier.circuitBreaker?.ratedCurrentA}</span></td>
          <td class="mono">${itripFormatted}</td>
          <td>
            <span class="status-badge ${isOk ? 'ok' : 'fail'}">
              ${isOk ? '✅ ОК' : '❌ ОТКАЗ'}
            </span>
            <div class="info-tip" style="margin: 2px 0 0; color: ${isOk ? 'var(--accent-green)' : 'var(--accent-red)'}; font-weight: 600;">
              ${marginFormatted}
            </div>
          </td>
        </tr>
      `;
      })
      .join('');
  }
}

// -----------------------------------------------------------------------------
// ЭКРАН 3: ПАКЕТНЫЙ РАСЧЕТ ИЗ EXCEL (С РЕАКТИВНЫМ ПЕРЕСЧЕТОМ НА ЛЕТУ)
// -----------------------------------------------------------------------------
function initScreenBatch() {
  populateTransformerSelect('batch-tp-power', state.batch.transformerPowerKva);

  const btnSrcTp = document.getElementById('batch-btn-src-tp');
  const btnSrcVru = document.getElementById('batch-btn-src-vru');
  const blockTp = document.getElementById('batch-block-source-tp');
  const blockVru = document.getElementById('batch-block-source-vru');

  // Переключение тумблера источника для Excel
  btnSrcTp?.addEventListener('click', () => {
    state.batch.powerSourceType = 'transformer';
    btnSrcTp.classList.add('active');
    btnSrcVru?.classList.remove('active');
    blockTp?.style.setProperty('display', 'block');
    blockVru?.style.setProperty('display', 'none');
    reactiveRecalculateBatch();
  });

  btnSrcVru?.addEventListener('click', () => {
    state.batch.powerSourceType = 'vru_tu';
    btnSrcVru.classList.add('active');
    btnSrcTp?.classList.remove('active');
    blockVru?.style.setProperty('display', 'block');
    blockTp?.style.setProperty('display', 'none');
    reactiveRecalculateBatch();
  });

  document.getElementById('batch-tp-power')?.addEventListener('change', (e) => {
    state.batch.transformerPowerKva = Number((e.target as HTMLSelectElement).value);
    updateTpSpecsLabel('batch-tp-specs-label', state.batch.transformerPowerKva, state.batch.transformerConnection);
    reactiveRecalculateBatch();
  });

  document.getElementById('batch-tp-connection')?.addEventListener('change', (e) => {
    state.batch.transformerConnection = (e.target as HTMLSelectElement).value as any;
    updateTpSpecsLabel('batch-tp-specs-label', state.batch.transformerPowerKva, state.batch.transformerConnection);
    reactiveRecalculateBatch();
  });

  document.getElementById('batch-vru-ik3')?.addEventListener('input', (e) => {
    state.batch.vruIk3kA = Number((e.target as HTMLInputElement).value) || 10;
    reactiveRecalculateBatch();
  });

  document.getElementById('batch-vru-xr')?.addEventListener('input', (e) => {
    state.batch.vruXrRatio = Number((e.target as HTMLInputElement).value) || 3.5;
    reactiveRecalculateBatch();
  });

  updateTpSpecsLabel('batch-tp-specs-label', state.batch.transformerPowerKva, state.batch.transformerConnection);

  // Скачивание образца Excel (8 линий)
  document.getElementById('btn-download-sample-excel')?.addEventListener('click', () => {
    const bytes = generateSampleExcelWorkbook();
    const blob = new Blob([bytes], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    downloadBlob(blob, 'Кабельный_журнал_шаблон_ГОСТ.xlsx');
  });

  // Скачивание боевого журнала ГРЩ (70 линий)
  document.getElementById('btn-download-large-sample-excel')?.addEventListener('click', () => {
    const bytes = generateLargeSampleExcelWorkbook();
    const blob = new Blob([bytes], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    downloadBlob(blob, 'Кабельный_журнал_ГРЩ_70_линий_ГОСТ.xlsx');
  });

  // Загрузка файла Excel
  const dropzone = document.getElementById('excel-dropzone');
  const fileInput = document.getElementById('excel-file-input') as HTMLInputElement | null;
  const btnBrowse = document.getElementById('btn-browse-excel');
  const btnReupload = document.getElementById('btn-reupload-excel');
  const searchInput = document.getElementById('batch-search-input') as HTMLInputElement | null;
  const filterButtons = document.querySelectorAll<HTMLButtonElement>('.filter-btn');

  btnBrowse?.addEventListener('click', () => fileInput?.click());
  dropzone?.addEventListener('click', (e) => {
    if (e.target !== btnBrowse) fileInput?.click();
  });

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
    if (fileInput.files && fileInput.files.length > 0) {
      processSelectedExcelFile(fileInput.files[0]);
    }
  });

  btnReupload?.addEventListener('click', () => {
    const uploadCard = document.getElementById('batch-upload-card');
    const resultsContainer = document.getElementById('batch-results-container');
    if (uploadCard) uploadCard.style.display = 'block';
    if (resultsContainer) resultsContainer.style.display = 'none';
    if (fileInput) fileInput.value = '';
  });

  filterButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      filterButtons.forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      state.batch.filter = (btn.getAttribute('data-filter') as any) || 'all';
      renderBatchTable();
    });
  });

  searchInput?.addEventListener('input', (e) => {
    state.batch.searchQuery = (e.target as HTMLInputElement).value.trim().toLowerCase();
    renderBatchTable();
  });

  // Кнопка: Автоматическое устранение коллизий (Smart Auto-Fix 100% ПУЭ-7)
  document.getElementById('btn-smart-autofix')?.addEventListener('click', () => {
    if (!state.batch.rawLines || state.batch.rawLines.length === 0) return;
    const powerSource: PowerSourceInput = {
      type: state.batch.powerSourceType,
      transformerPowerKva: state.batch.transformerPowerKva,
      transformerConnection: state.batch.transformerConnection,
      vruIk3kA: state.batch.vruIk3kA,
      vruXrRatio: state.batch.vruXrRatio,
    };
    const res = autoRemediateAllLines(state.batch.rawLines, powerSource);
    state.batch.rawLines = res.lines;
    state.batch.expandedCorrectionRows.clear();
    reactiveRecalculateBatch();
  });

  // Кнопка: Сброс корректировок к исходному кабельному журналу
  document.getElementById('btn-reset-corrections')?.addEventListener('click', () => {
    if (!state.batch.rawLines || state.batch.rawLines.length === 0) return;
    const powerSource: PowerSourceInput = {
      type: state.batch.powerSourceType,
      transformerPowerKva: state.batch.transformerPowerKva,
      transformerConnection: state.batch.transformerConnection,
      vruIk3kA: state.batch.vruIk3kA,
      vruXrRatio: state.batch.vruXrRatio,
    };
    state.batch.rawLines = state.batch.rawLines.map((line) => {
      return applyCorrectionToLine(line, 'none', powerSource);
    });
    state.batch.expandedCorrectionRows.clear();
    reactiveRecalculateBatch();
  });

  // Делегирование кликов по карточкам альтернатив внутри таблицы
  document.getElementById('batch-table-body')?.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;

    // Кнопка разворачивания карточек решения для изменения
    const expandBtn = target.closest('[data-action="expand-correction"]') as HTMLElement | null;
    if (expandBtn) {
      const rowNum = parseInt(expandBtn.getAttribute('data-row-number') || '', 10);
      if (rowNum) {
        state.batch.expandedCorrectionRows.add(rowNum);
        renderBatchTable();
      }
      return;
    }

    // Кнопка сворачивания вариантов обратно
    const collapseBtn = target.closest('[data-action="collapse-correction"]') as HTMLElement | null;
    if (collapseBtn) {
      const rowNum = parseInt(collapseBtn.getAttribute('data-row-number') || '', 10);
      if (rowNum) {
        state.batch.expandedCorrectionRows.delete(rowNum);
        renderBatchTable();
      }
      return;
    }

    const card = target.closest('[data-action="select-correction"]') as HTMLElement | null;
    if (!card) return;

    const rowNumStr = card.getAttribute('data-row-number');
    const corrType = card.getAttribute('data-correction-type') as LineCorrectionType;
    if (!rowNumStr || !corrType) return;
    const rowNum = parseInt(rowNumStr, 10);

    const targetLine = state.batch.rawLines.find((l) => l.rowNumber === rowNum);
    if (!targetLine) return;

    // Если кликнули на уже выбранную опцию — просто сворачиваем карточку
    if ((targetLine.selectedCorrection || 'none') === corrType) {
      state.batch.expandedCorrectionRows.delete(rowNum);
      renderBatchTable();
      return;
    }

    // ВИЗУАЛЬНАЯ АНИМАЦИЯ ВЫБОРА: кругляшек сразу зеленеет, карточка мягко подсвечивается
    card.classList.add('selecting');
    const radio = card.querySelector('input[type="radio"]') as HTMLInputElement | null;
    if (radio) radio.checked = true;

    // Через 180 мс фиксируем пересчет и аккуратно сворачиваем в зеленую плашку
    setTimeout(() => {
      const powerSource: PowerSourceInput = {
        type: state.batch.powerSourceType,
        transformerPowerKva: state.batch.transformerPowerKva,
        transformerConnection: state.batch.transformerConnection,
        vruIk3kA: state.batch.vruIk3kA,
        vruXrRatio: state.batch.vruXrRatio,
      };

      const updated = applyCorrectionToLine(targetLine, corrType, powerSource);
      Object.assign(targetLine, updated);
      state.batch.expandedCorrectionRows.delete(rowNum);
      reactiveRecalculateBatch();
    }, 180);
  });
}

function processSelectedExcelFile(file: File) {
  const reader = new FileReader();

  reader.onload = (e) => {
    const buffer = e.target?.result as ArrayBuffer;
    if (!buffer) return;

    // Парсинг Excel в оперативной памяти (Zero-Server)
    const lines = parseExcelWorkbook(buffer);

    if (lines.length === 0) {
      alert('Не удалось прочитать строки кабельного журнала. Проверьте формат файла Excel или скачайте наш образец.');
      return;
    }

    state.batch.rawLines = lines;
    reactiveRecalculateBatch();

    // Показываем контейнер результатов
    const uploadCard = document.getElementById('batch-upload-card');
    const resultsContainer = document.getElementById('batch-results-container');
    if (uploadCard) uploadCard.style.display = 'none';
    if (resultsContainer) resultsContainer.style.display = 'block';
  };

  reader.readAsArrayBuffer(file);
}

/**
 * Реактивный мгновенный пересчет таблицы Excel на лету
 * Вызывается при смене ТП/ВРУ, схемы обмоток или загрузке нового файла
 */
function reactiveRecalculateBatch() {
  if (!state.batch.rawLines || state.batch.rawLines.length === 0) return;

  const startTime = performance.now();

  const powerSource: PowerSourceInput = {
    type: state.batch.powerSourceType,
    transformerPowerKva: state.batch.transformerPowerKva,
    transformerConnection: state.batch.transformerConnection,
    vruIk3kA: state.batch.vruIk3kA,
    vruXrRatio: state.batch.vruXrRatio,
  };

  const summary = calculateBatchLines(state.batch.rawLines, powerSource);

  const elapsedMs = Math.round(performance.now() - startTime);

  state.batch.summary = summary;
  state.batch.lastElapsedMs = elapsedMs;

  const statTotal = document.getElementById('batch-stat-total');
  const statOk = document.getElementById('batch-stat-ok');
  const statFail = document.getElementById('batch-stat-fail');
  const statSpeed = document.getElementById('batch-stat-speed');

  if (statTotal) statTotal.textContent = String(summary.totalLines);
  if (statOk) statOk.textContent = String(summary.successCount);
  if (statFail) statFail.textContent = String(summary.failureCount);
  if (statSpeed) statSpeed.textContent = `${elapsedMs} мс`;

  const countAll = document.getElementById('count-filter-all');
  const countFails = document.getElementById('count-filter-fails');
  const countPassed = document.getElementById('count-filter-passed');

  if (countAll) countAll.textContent = String(summary.totalLines);
  if (countFails) countFails.textContent = String(summary.failureCount);
  if (countPassed) countPassed.textContent = String(summary.successCount);

  updateRemediationBanner(summary);
  renderBatchTable();
}

function updateRemediationBanner(summary: BatchCalculationSummary) {
  const banner = document.getElementById('batch-remediation-banner');
  const icon = document.getElementById('remediation-banner-icon');
  const title = document.getElementById('remediation-banner-title');
  const desc = document.getElementById('remediation-banner-desc');
  const btnAutofix = document.getElementById('btn-smart-autofix') as HTMLButtonElement | null;
  const btnReset = document.getElementById('btn-reset-corrections') as HTMLButtonElement | null;

  if (!banner) return;

  const correctedCount = state.batch.rawLines.filter(
    (l) => l.selectedCorrection && l.selectedCorrection !== 'none'
  ).length;

  if (summary.failureCount > 0) {
    banner.style.display = 'flex';
    banner.className = 'remediation-banner';
    if (icon) icon.textContent = '⚠️';
    if (title) {
      title.textContent = `Обнаружено коллизий ПУЭ-7 (п. 1.7.79): ${summary.failureCount} из ${summary.totalLines} линий`;
    }
    if (desc) {
      desc.textContent =
        'Ток однофазного КЗ недостаточен для надежной электромагнитной отсечки. Экспертиза отклонит такой расчет. Выберите решение для каждой линии ниже вручную или примените умный алгоритм.';
    }
    if (btnAutofix) {
      btnAutofix.style.display = 'inline-block';
      btnAutofix.textContent = `⚡ Устранить коллизии автоматически (${summary.failureCount} линий)`;
    }
    if (btnReset) {
      btnReset.style.display = correctedCount > 0 ? 'inline-block' : 'none';
    }
  } else if (correctedCount > 0) {
    banner.style.display = 'flex';
    banner.className = 'remediation-banner success';
    if (icon) icon.textContent = '✅';
    if (title) {
      title.textContent = `Все ${summary.totalLines} линий соответствуют ПУЭ-7 (внесено ${correctedCount} проектных решений)`;
    }
    if (desc) {
      desc.textContent =
        'Замечания сняты. Для Государственной экспертизы сформирован 100% соответствующий расчет и ведомость корректировки однолинейных схем ЭОМ.';
    }
    if (btnAutofix) {
      btnAutofix.style.display = 'none';
    }
    if (btnReset) {
      btnReset.style.display = 'inline-block';
    }
  } else {
    // 0 замечаний и 0 корректировок: идеально чистый исходный файл
    banner.style.display = 'none';
  }
}

function renderBatchTable() {
  const tbody = document.getElementById('batch-table-body');
  if (!tbody || !state.batch.summary) return;

  const powerSource: PowerSourceInput = {
    type: state.batch.powerSourceType,
    transformerPowerKva: state.batch.transformerPowerKva,
    transformerConnection: state.batch.transformerConnection,
    vruIk3kA: state.batch.vruIk3kA,
    vruXrRatio: state.batch.vruXrRatio,
  };

  const { lines } = state.batch.summary;
  const filter = state.batch.filter;
  const search = state.batch.searchQuery;

  const filtered = lines.filter((line) => {
    const isRemediated = Boolean(line.selectedCorrection && line.selectedCorrection !== 'none');
    const hasIssue = !line.calculation?.isPueCompliant || isRemediated;

    // В фильтре «Только замечания» оставляем как нерешенные строки, так и снятые (чтобы экран не скакал)
    if (filter === 'fails' && !hasIssue) return false;
    if (filter === 'passed' && !line.calculation?.isPueCompliant) return false;

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

      const isRemediated = Boolean(line.selectedCorrection && line.selectedCorrection !== 'none');
      const hasIssue = !isOk || isRemediated;

      // Отображение марки и сечения
      let sectionDisplay = `
        <span style="font-weight: 600;">${escapeHtml(line.cableMark)}</span>
        <div class="info-tip" style="margin: 0;">${line.material === 'cu' ? 'Cu' : 'Al'} ${line.phaseSectionMm2}/${line.zeroSectionMm2} мм²</div>
      `;
      if (line.originalPhaseSectionMm2 && line.phaseSectionMm2 !== line.originalPhaseSectionMm2) {
        sectionDisplay = `
          <span class="correction-tag">⚡ ${line.phaseSectionMm2}/${line.zeroSectionMm2} мм²</span>
          <span class="orig-struck">${line.originalPhaseSectionMm2} мм²</span>
          <div class="info-tip" style="margin: 0;">${escapeHtml(line.cableMark)}</div>
        `;
      }

      // Отображение автомата
      let breakerDisplay = `<span class="code-badge">${escapeHtml(line.breakerModel)}</span>`;
      if (line.selectedCorrection === 'curve_b') {
        breakerDisplay = `
          <span class="code-badge" style="background: var(--accent-green); color: #fff;">B${line.breakerRatedA}</span>
          <span class="orig-struck">${line.originalBreakerCurve}${line.breakerRatedA}</span>
        `;
      } else if (line.selectedCorrection === 'rcd_30ma') {
        breakerDisplay = `
          <span class="code-badge">${escapeHtml(line.breakerModel)}</span>
          <div style="margin-top: 2px;"><span class="correction-tag">+ АВДТ 30мА</span></div>
        `;
      }

      // Статус ПУЭ
      let statusBadgeHtml = '';
      if (isRemediated) {
        const typeBadge =
          line.selectedCorrection === 'curve_b'
            ? 'кривая B'
            : line.selectedCorrection === 'section_up'
            ? `${line.phaseSectionMm2} мм²`
            : 'АВДТ 30мА';
        const subTip =
          line.selectedCorrection === 'rcd_30ma'
            ? 't ≤ 0.04 с (дифзащита 30 мА)'
            : marginFormatted;
        statusBadgeHtml = `
          <span class="status-badge ok">✅ Снято (${typeBadge})</span>
          <div class="info-tip" style="margin-top: 2px; color: var(--accent-green); font-weight: 600;">
            ${subTip}
          </div>
        `;
      } else if (isOk) {
        statusBadgeHtml = `
          <span class="status-badge ok">✅ ОК (t ≤ 0.1 с)</span>
          <div class="info-tip" style="margin-top: 2px; color: var(--accent-green); font-weight: 600;">
            ${marginFormatted}
          </div>
        `;
      } else {
        statusBadgeHtml = `
          <span class="status-badge fail">❌ ОТКАЗ</span>
          <div class="info-tip" style="margin-top: 2px; color: var(--accent-red); font-weight: 600;">
            ${marginFormatted}
          </div>
        `;
      }

      const mainRow = `
        <tr class="${hasIssue ? 'has-issue-row' : ''}">
          <td style="color: var(--text-dim); font-mono;">${idx + 1}</td>
          <td style="font-weight: 700; color: var(--text-main);">${escapeHtml(line.lineNumber)}</td>
          <td>${escapeHtml(line.consumerName || '—')}</td>
          <td>${sectionDisplay}</td>
          <td class="mono">${line.lengthM} м</td>
          <td>${breakerDisplay}</td>
          <td class="mono" style="font-weight: 700; color: var(--accent-cyan);">${ik1Formatted}</td>
          <td class="mono">${itripFormatted}</td>
          <td>${statusBadgeHtml}</td>
        </tr>
      `;

      // Блок интерактивного выбора проектного решения
      let optionsRow = '';
      if (hasIssue) {
        if (isRemediated && !state.batch.expandedCorrectionRows.has(line.rowNumber)) {
          // Вариант 1: Компактная плашка принятого решения (экран стабилен, без прыжков)
          const solutionText =
            line.remediationRecord?.adoptedSolution ||
            (line.selectedCorrection === 'curve_b'
              ? `Замена на кривую B (B${line.breakerRatedA})`
              : line.selectedCorrection === 'section_up'
              ? `Увеличение сечения жил до ${line.phaseSectionMm2} мм²`
              : `Установка дифзащиты (АВДТ ${line.breakerRatedA} А / 30 мА)`);

          const subTip =
            line.selectedCorrection === 'rcd_30ma'
              ? 't ≤ 0.04 с (дифзащита 30 мА)'
              : marginFormatted;

          optionsRow = `
            <tr class="remediation-subrow remediated-collapsed">
              <td></td>
              <td colspan="8">
                <div class="remediation-resolved-bar">
                  <div class="remediation-resolved-left">
                    <span class="resolved-badge">✅ Замечание снято:</span>
                    <span class="resolved-solution">${escapeHtml(solutionText)}</span>
                    <span class="resolved-margin">${escapeHtml(subTip)}</span>
                  </div>
                  <button type="button" class="btn-change-solution" data-action="expand-correction" data-row-number="${line.rowNumber}">
                    Изменить решение ⚙️
                  </button>
                </div>
              </td>
            </tr>
          `;
        } else {
          // Раскрытый режим: 4 карточки альтернатив
          const options = generateLineCorrections(line, powerSource);
          if (options.length > 1) {
            const isMotor = isMotorLoad(line.consumerName);
            const optionsHtml = options
              .map((opt) => {
                const isSelected = (line.selectedCorrection || 'none') === opt.type;
                const isFailCard = !opt.isPueCompliant;
                return `
                  <div class="remediation-opt-card ${isSelected ? 'active' : ''} ${isFailCard ? 'fail-option' : ''}"
                       data-action="select-correction"
                       data-row-number="${line.rowNumber}"
                       data-correction-type="${opt.type}">
                    <div class="remediation-opt-top">
                      <label class="remediation-opt-label" style="cursor: pointer;">
                        <input type="radio" name="corr-row-${line.rowNumber}" value="${opt.type}" ${isSelected ? 'checked' : ''} style="accent-color: var(--accent-green); cursor: pointer;" />
                        <span>${escapeHtml(opt.title)}</span>
                      </label>
                      ${opt.isRecommended ? '<span class="badge-recommended">⭐ Рекомендуется</span>' : ''}
                    </div>
                    <div class="remediation-opt-desc">${escapeHtml(opt.description)}</div>
                    ${opt.isWarning && opt.warningText ? `<div class="remediation-opt-warn">${escapeHtml(opt.warningText)}</div>` : ''}
                  </div>
                `;
              })
              .join('');

            optionsRow = `
              <tr class="remediation-subrow">
                <td></td>
                <td colspan="8">
                  <div class="remediation-picker">
                    <div class="remediation-picker-header">
                      <span class="remediation-picker-title">
                        <span>🔧</span> <span>${isRemediated ? 'Принятое проектное решение (замечание экспертизы снято):' : 'Замечание экспертизы: выберите способ устранения коллизии:'}</span>
                      </span>
                      <div style="display: flex; align-items: center; gap: 8px;">
                        ${isMotor ? '<span class="motor-warning-badge">⚙️ Электродвигатель (пусковой ток: кривая B не рекомендуется)</span>' : ''}
                        ${isRemediated ? `<button type="button" class="btn-collapse-solution" data-action="collapse-correction" data-row-number="${line.rowNumber}">Свернуть ▲</button>` : ''}
                      </div>
                    </div>
                    <div class="remediation-options-grid">
                      ${optionsHtml}
                    </div>
                  </div>
                </td>
              </tr>
            `;
          }
        }
      }

      return mainRow + optionsRow;
    })
    .join('');
}

// -----------------------------------------------------------------------------
// ВЫГРУЗКА ТОМА WORD ПО ГОСТ 2.105-95 ДЛЯ ВСЕХ 3-Х ЭКРАНОВ
// -----------------------------------------------------------------------------
function initDocxModal() {
  const modal = document.getElementById('docx-modal');
  const btnClose = document.getElementById('close-docx-modal');
  const btnCancel = document.getElementById('btn-cancel-docx-modal');
  const btnSubmit = document.getElementById('btn-submit-docx-export') as HTMLButtonElement | null;
  const modalTitle = document.getElementById('docx-modal-title');
  const panelInput = document.getElementById('docx-input-panel') as HTMLInputElement | null;

  const btnSingle = document.getElementById('btn-export-single-docx');
  const btnCascade = document.getElementById('btn-export-cascade-docx');
  const btnBatch = document.getElementById('btn-export-batch-docx');

  const openDocxModal = (mode: 'single' | 'cascade' | 'batch') => {
    state.docxExportMode = mode;
    if (modalTitle) {
      if (mode === 'single') modalTitle.textContent = 'Параметры тома: Экспресс-расчет линии';
      else if (mode === 'cascade') modalTitle.textContent = 'Параметры тома: Каскадная магистраль';
      else modalTitle.textContent = 'Параметры тома: Кабельный журнал щита';
    }
    if (panelInput) {
      if (mode === 'single') panelInput.value = 'ЩР-1';
      else if (mode === 'cascade') panelInput.value = 'ГРЩ / Стояк ВРУ';
      else panelInput.value = 'ВРУ-1 / ГРЩ';
    }
    modal?.classList.add('open');
  };

  btnSingle?.addEventListener('click', () => openDocxModal('single'));
  btnCascade?.addEventListener('click', () => openDocxModal('cascade'));
  btnBatch?.addEventListener('click', () => {
    if (!state.batch.summary || state.batch.summary.lines.length === 0) {
      alert('Сначала загрузите кабельный журнал Excel для расчета щита.');
      return;
    }
    openDocxModal('batch');
  });

  const closeDocxModal = () => {
    modal?.classList.remove('open');
  };

  btnClose?.addEventListener('click', closeDocxModal);
  btnCancel?.addEventListener('click', closeDocxModal);
  modal?.addEventListener('click', (e) => {
    if (e.target === modal) closeDocxModal();
  });

  btnSubmit?.addEventListener('click', async () => {
    await handleDocxExport();
  });
}

async function handleDocxExport() {
  const btnSubmit = document.getElementById('btn-submit-docx-export') as HTMLButtonElement | null;
  const modal = document.getElementById('docx-modal');

  const projectTitle =
    (document.getElementById('docx-input-title') as HTMLInputElement)?.value.trim() ||
    'Объект капитального строительства';
  const projectCode =
    (document.getElementById('docx-input-code') as HTMLInputElement)?.value.trim() || '2026-ЭОМ.РР';
  const panelName =
    (document.getElementById('docx-input-panel') as HTMLInputElement)?.value.trim() || 'ВРУ-1';
  const companyName =
    (document.getElementById('docx-input-company') as HTMLInputElement)?.value.trim() ||
    'ООО «Проектно-инжиниринговая мастерская»';
  const authorName =
    (document.getElementById('docx-input-author') as HTMLInputElement)?.value.trim() ||
    'Инженер-проектировщик ЭОМ';
  const checkerName =
    (document.getElementById('docx-input-checker') as HTMLInputElement)?.value.trim() ||
    'Главный инженер проекта (ГИП)';

  const now = new Date();
  const months = [
    'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
    'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь',
  ];
  const dateStr = `${months[now.getMonth()]} ${now.getFullYear()} г.`;

  let powerSource: PowerSourceInput;
  let lines: DocxReportLineItem[] = [];
  let reportRemediations: LineRemediationRecord[] = [];

  if (state.docxExportMode === 'single') {
    powerSource = {
      type: state.single.powerSourceType,
      transformerPowerKva: state.single.transformerPowerKva,
      transformerConnection: state.single.transformerConnection,
      vruIk3kA: state.single.vruIk3kA,
      vruXrRatio: state.single.vruXrRatio,
    };
    lines = [
      {
        lineNumber: 'Гр. 1',
        consumerName: 'Линия питания потребителя',
        cableMark: `${state.single.material === 'cu' ? 'ВВГнг(А)-LS' : 'АВВГ'} ${state.single.phaseCrossSectionMm2}/${state.single.zeroCrossSectionMm2} мм²`,
        material: state.single.material,
        phaseSectionMm2: state.single.phaseCrossSectionMm2,
        zeroSectionMm2: state.single.zeroCrossSectionMm2,
        lengthM: state.single.lengthMeters,
        breakerModel: `ВА47-29 (${state.single.breakerCurve}${state.single.breakerRatedA})`,
        breakerRatedA: state.single.breakerRatedA,
        breakerCurve: state.single.breakerCurve,
        calculation: state.single.lastResult || undefined,
      },
    ];
  } else if (state.docxExportMode === 'cascade') {
    powerSource = {
      type: state.cascade.powerSourceType,
      transformerPowerKva: state.cascade.transformerPowerKva,
      transformerConnection: state.cascade.transformerConnection,
      vruIk3kA: state.cascade.vruIk3kA,
      vruXrRatio: state.cascade.vruXrRatio,
    };
    const cRes = state.cascade.lastResult;
    lines = state.cascade.tiers.map((t, idx) => {
      const tierRes = cRes?.tiers[idx];
      return {
        lineNumber: `Ступень ${idx + 1}`,
        consumerName: t.name,
        cableMark: `${t.material === 'cu' ? 'ВВГнг(А)-LS' : 'АВВГ'} ${t.phaseCrossSectionMm2}/${t.zeroCrossSectionMm2} мм²`,
        material: t.material,
        phaseSectionMm2: t.phaseCrossSectionMm2,
        zeroSectionMm2: t.zeroCrossSectionMm2,
        lengthM: t.lengthMeters,
        breakerModel: `Авт. ${t.breakerCurve}${t.breakerRatedA}`,
        breakerRatedA: t.breakerRatedA,
        breakerCurve: t.breakerCurve,
        calculation: tierRes
          ? {
              sourceType: powerSource.type,
              sourceDescription: cRes.sourceDescription,
              sourceR_Ohm: cRes.sourceR_Ohm,
              sourceX_Ohm: cRes.sourceX_Ohm,
              sourceZ_Ohm: cRes.sourceZ_Ohm,
              sections: [tierRes.section],
              cablesR_Ohm: tierRes.cumulativeR_Ohm,
              cablesX_Ohm: tierRes.cumulativeX_Ohm,
              contactR_Ohm: 0.015,
              arcR_Ohm: 0,
              totalR_Ohm: cRes.sourceR_Ohm + tierRes.cumulativeR_Ohm + 0.015,
              totalX_Ohm: cRes.sourceX_Ohm + tierRes.cumulativeX_Ohm,
              loopImpedanceZ_Ohm: tierRes.loopImpedanceZ_Ohm,
              ik1A: tierRes.ik1A,
              ik1kA: tierRes.ik1kA,
              breakerRatedA: t.breakerRatedA,
              breakerCurve: t.breakerCurve,
              requiredTripCurrentA: tierRes.breakerEvaluation?.requiredTripCurrentA ?? 0,
              actualTripRatio: tierRes.breakerEvaluation?.actualTripRatio ?? 0,
              marginPercent: tierRes.breakerEvaluation?.marginPercent ?? 0,
              isPueCompliant: tierRes.breakerEvaluation?.isCompliant ?? false,
              status: tierRes.breakerEvaluation?.isCompliant ? 'SUCCESS' : 'FAILURE',
              statusMessage: tierRes.breakerEvaluation?.statusText ?? '',
              recommendation: tierRes.breakerEvaluation?.recommendation,
            }
          : undefined,
      };
    });
  } else {
    powerSource = {
      type: state.batch.powerSourceType,
      transformerPowerKva: state.batch.transformerPowerKva,
      transformerConnection: state.batch.transformerConnection,
      vruIk3kA: state.batch.vruIk3kA,
      vruXrRatio: state.batch.vruXrRatio,
    };
    if (!state.batch.summary || state.batch.summary.lines.length === 0) {
      alert('Нет рассчитанных линий для формирования тома.');
      return;
    }

    const remediationsList: LineRemediationRecord[] = [];
    lines = state.batch.summary.lines.map((l) => {
      if (l.remediationRecord) {
        remediationsList.push(l.remediationRecord);
      }
      return {
        lineNumber: l.lineNumber,
        consumerName: l.consumerName,
        cableMark: l.cableMark,
        material: l.material,
        phaseSectionMm2: l.phaseSectionMm2,
        zeroSectionMm2: l.zeroSectionMm2,
        lengthM: l.lengthM,
        breakerModel: l.breakerModel,
        breakerRatedA: l.breakerRatedA,
        breakerCurve: l.breakerCurve,
        calculation: l.calculation,
        remediation: l.remediationRecord,
      };
    });

    reportRemediations = remediationsList;
  }

  const reportInput: DocxReportInput = {
    projectTitle,
    projectCode,
    panelName,
    companyName,
    authorName,
    checkerName,
    dateStr,
    powerSource,
    lines,
    remediations: reportRemediations.length > 0 ? reportRemediations : undefined,
  };

  const originalText = btnSubmit?.innerHTML || '';
  if (btnSubmit) {
    btnSubmit.disabled = true;
    btnSubmit.innerHTML = '⏳ Формирование тома ГОСТ...';
  }

  try {
    const blob = await generateDocxBlob(reportInput);
    const safePanel = panelName.replace(/[\s/\\:]+/g, '_');
    const filename = `Том_расчета_КЗ_${safePanel}_ГОСТ_2.105-95.docx`;
    downloadBlob(blob, filename);
    modal?.classList.remove('open');
  } catch (err) {
    console.error('Ошибка генерации DOCX:', err);
    alert('Произошла ошибка при формировании документа Word. Подробности в консоли браузера.');
  } finally {
    if (btnSubmit) {
      btnSubmit.disabled = false;
      btnSubmit.innerHTML = originalText;
    }
  }
}

// -----------------------------------------------------------------------------
// Вспомогательные функции
// -----------------------------------------------------------------------------
function populateTransformerSelect(selectId: string, selectedValue: number) {
  const el = document.getElementById(selectId) as HTMLSelectElement | null;
  if (!el) return;
  const powers = Array.from(new Set(TRANSFORMERS_CATALOG.map((t) => t.powerKva))).sort((a, b) => a - b);
  el.innerHTML = powers
    .map((p) => `<option value="${p}" ${p === selectedValue ? 'selected' : ''}>${p} кВА</option>`)
    .join('');
}

function populateBreakerSelect(selectId: string, selectedValue: number) {
  const el = document.getElementById(selectId) as HTMLSelectElement | null;
  if (!el) return;
  el.innerHTML = STANDARD_BREAKER_RATINGS.map(
    (r) => `<option value="${r}" ${r === selectedValue ? 'selected' : ''}>${r} А</option>`
  ).join('');
}

function populateCrossSectionSelect(selectId: string, selectedValue: number) {
  const el = document.getElementById(selectId) as HTMLSelectElement | null;
  if (!el) return;
  el.innerHTML = STANDARD_CROSS_SECTIONS.map(
    (s) => `<option value="${s}" ${s === selectedValue ? 'selected' : ''}>${s} мм²</option>`
  ).join('');
}

function updateTpSpecsLabel(labelId: string, powerKva: number, connection: any) {
  const label = document.getElementById(labelId);
  if (!label) return;
  const trans = getTransformerParameters(powerKva, connection);
  label.textContent = `Паспорт: u_к = ${trans.ukPercent}%, P_к = ${trans.pkKw} кВт, R1 = ${trans.r1Ohm.toFixed(4)} Ом, X1 = ${trans.x1Ohm.toFixed(4)} Ом`;
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function escapeHtml(str: string): string {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
