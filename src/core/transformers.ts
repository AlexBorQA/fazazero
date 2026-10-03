/**
 * Справочник параметров силовых трансформаторов 6-10 / 0.4 кВ
 * и расчет эквивалентного сопротивления источника питания (ГОСТ 28249-93).
 */

import type {
  TransformerCatalogItem,
  TransformerConnection,
  PowerSourceInput,
} from './types.ts';
import { VAULT_TRANSFORMERS_CATALOG } from './vault.ts';

/**
 * Нормативная таблица параметров трансформаторов ТМ / ТМГ / ТСЗ
 * по ГОСТ 28249-93 (Приложение 3, Таблицы П3.1 и П3.2)
 * при U_ном = 400 В (0.4 кВ).
 * (Инициализируется из защищенного крипто-анклава)
 */
export const TRANSFORMERS_CATALOG: TransformerCatalogItem[] = VAULT_TRANSFORMERS_CATALOG;

/**
 * Находит трансформатор в каталоге или рассчитывает параметры по паспортным данным
 */
export function getTransformerParameters(
  powerKva: number,
  connection: TransformerConnection = 'D/Yn-11'
): TransformerCatalogItem {
  const found = TRANSFORMERS_CATALOG.find(
    (t) => t.powerKva === powerKva && t.connection === connection
  );
  if (found) return found;

  // Автоматический расчет по стандартным формулам ГОСТ 28249-93
  const uNomV = 400; // 0.4 кВ
  const ukPercent = powerKva >= 1000 ? 5.5 : 4.5;
  // Приблизительные потери КЗ для типовых трансформаторов
  const pkKw = 0.015 * Math.pow(powerKva, 0.95);

  const z1 = (ukPercent / 100) * (Math.pow(uNomV, 2) / (powerKva * 1000));
  const r1 = (pkKw * 1000 * Math.pow(uNomV, 2)) / Math.pow(powerKva * 1000, 2);
  const x1 = Math.sqrt(Math.max(0, Math.pow(z1, 2) - Math.pow(r1, 2)));

  const isStarStar = connection === 'Y/Yn-0';
  const r0 = isStarStar ? r1 * 10 : r1;
  const x0 = isStarStar ? x1 * 25 : x1;

  return {
    powerKva,
    connection,
    voltageHighKv: 10,
    voltageLowKv: 0.4,
    ukPercent,
    pkKw,
    r1Ohm: r1,
    x1Ohm: x1,
    r0Ohm: r0,
    x0Ohm: x0,
  };
}

export interface SourceEquivalenceResult {
  sourceDescription: string;
  rSourceOhm: number;
  xSourceOhm: number;
  zSourceOhm: number;
}

/**
 * Расчет эквивалентного сопротивления источника питания для петли «фаза-ноль»
 * по ГОСТ 28249-93:
 * Z_ист(п-н) = (2 * Z_(1) + Z_(0)) / 3
 */
export function calculateSourceImpedance(input: PowerSourceInput): SourceEquivalenceResult {
  if (input.type === 'vru_tu') {
    // РЕЖИМ Б: Расчет от вводных клемм ВРУ по ТУ (ток 3-фазного КЗ на шинах ВРУ)
    const ik3kA = input.vruIk3kA ?? 10.0;
    const xrRatio = input.vruXrRatio ?? 3.5;
    const uNomV = 400; // Линейное напряжение

    // Полное сопротивление системы до шин ВРУ (Ом)
    // Z_сист = U_ном / (sqrt(3) * I_кз(3))
    const zSyst = uNomV / (Math.sqrt(3) * ik3kA * 1000);

    // Разложение на активную и реактивную составляющие
    const xSyst = zSyst * (xrRatio / Math.sqrt(1 + Math.pow(xrRatio, 2)));
    const rSyst = xSyst / xrRatio;

    return {
      sourceDescription: `ВРУ здания (по ТУ сетевой организации: Iкз(3) = ${ik3kA} кА, X/R = ${xrRatio})`,
      rSourceOhm: rSyst,
      xSourceOhm: xSyst,
      zSourceOhm: zSyst,
    };
  }

  // РЕЖИМ А: Расчет от силового трансформатора ТП
  const powerKva = input.transformerPowerKva ?? 630;
  const connection = input.transformerConnection ?? 'D/Yn-11';
  const trans = input.customTransformer
    ? ({ ...getTransformerParameters(powerKva, connection), ...input.customTransformer } as TransformerCatalogItem)
    : getTransformerParameters(powerKva, connection);

  // ГОСТ 28249-93 формула (15):
  // Вклад трансформатора в контур петли фаза-ноль:
  // R_ист = (2 * R_(1) + R_(0)) / 3
  // X_ист = (2 * X_(1) + X_(0)) / 3
  const rSource = (2 * trans.r1Ohm + trans.r0Ohm) / 3;
  const xSource = (2 * trans.x1Ohm + trans.x0Ohm) / 3;
  const zSource = Math.hypot(rSource, xSource);

  return {
    sourceDescription: `Трансформатор ТП ${trans.powerKva} кВА (${trans.connection}, u_к=${trans.ukPercent}%, P_к=${trans.pkKw} кВт)`,
    rSourceOhm: rSource,
    xSourceOhm: xSource,
    zSourceOhm: zSource,
  };
}
