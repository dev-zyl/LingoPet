declare module "lunar-javascript" {
  interface JieQi {
    getName(): string;
    isJie(): boolean;
    isQi(): boolean;
    getSolar(): Solar;
  }

  class Solar {
    static fromDate(date: Date): Solar;
    static fromYmd(year: number, month: number, day: number): Solar;
    static fromYmdHms(year: number, month: number, day: number, hour: number, minute: number, second: number): Solar;
    getYear(): number;
    getMonth(): number;
    getDay(): number;
    getLunar(): Lunar;
    toYmd(): string;
    next(days: number): Solar;
  }

  class Lunar {
    static fromDate(date: Date): Lunar;
    static fromSolar(solar: Solar): Lunar;
    getYear(): number;
    getMonth(): number;
    getDay(): number;
    getMonthInChinese(): string;
    getDayInChinese(): string;
    getJieQi(): string;
    getCurrentJieQi(): JieQi | null;
    getFestivals(): string[];
    getSolar(): Solar;
  }
}
