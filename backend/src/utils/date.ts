// 按中国时区（UTC+8）计算“本地日历日”，保证打卡以天为单位去重。
// 不依赖 Intl 的时区数据库，统一使用固定 +8 偏移即可。

const CHINA_OFFSET_MS = 8 * 60 * 60 * 1000;

const pad2 = (n: number): string => String(n).padStart(2, '0');

/** 将任意时间转换为 UTC+8 当天 00:00 的 Date（其 UTC 分量即本地日期）。 */
export const toChinaDay = (date: Date = new Date()): Date => {
  const shifted = new Date(date.getTime() + CHINA_OFFSET_MS);
  return new Date(Date.UTC(
    shifted.getUTCFullYear(),
    shifted.getUTCMonth(),
    shifted.getUTCDate()
  ));
};

/** 返回 UTC+8 日历日的 YYYY-MM-DD 字符串，用于去重判断与比较。 */
export const getChinaDateKey = (date: Date = new Date()): string => {
  const shifted = new Date(date.getTime() + CHINA_OFFSET_MS);
  return `${shifted.getUTCFullYear()}-${pad2(shifted.getUTCMonth() + 1)}-${pad2(shifted.getUTCDate())}`;
};

/** 从 YYYY-MM-DD（或 Date）还原为 UTC 午夜的日历日。 */
export const dayToKey = (day: Date): string => {
  return `${day.getUTCFullYear()}-${pad2(day.getUTCMonth() + 1)}-${pad2(day.getUTCDate())}`;
};

/** 返回最近 n 天（含今天，按 UTC+8）的日历日 Date，顺序从旧到新。 */
export const getLastNDays = (n: number, end: Date = new Date()): Date[] => {
  const today = toChinaDay(end);
  const days: Date[] = [];
  for (let i = n - 1; i >= 0; i--) {
    days.push(new Date(today.getTime() - i * 24 * 60 * 60 * 1000));
  }
  return days;
};

/**
 * 根据打卡日期集合（YYYY-MM-DD）计算截至今天的连续完成天数。
 * 今天还没打卡时，连续记录从昨天往回数，不中断已有的连续。
 */
export const calculateStreak = (dateKeys: Set<string>, now: Date = new Date()): number => {
  let streak = 0;
  let cursor = toChinaDay(now);

  if (!dateKeys.has(dayToKey(cursor))) {
    // 今天尚未打卡，从昨天开始回看
    cursor = new Date(cursor.getTime() - 24 * 60 * 60 * 1000);
  }

  while (dateKeys.has(dayToKey(cursor))) {
    streak += 1;
    cursor = new Date(cursor.getTime() - 24 * 60 * 60 * 1000);
  }

  return streak;
};
