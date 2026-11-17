import { findNumber, parseNumberAt, tokenize, wordsToNumber } from './number-words';

describe('number-words', () => {
  describe('tokenize', () => {
    it('приводит к нижнему регистру и убирает «ё»', () => {
      expect(tokenize('Пятьсот Ёлок')).toEqual(['пятьсот', 'елок']);
    });

    it('сохраняет десятичную запятую внутри числа', () => {
      expect(tokenize('2,5 тысячи')).toEqual(['2.5', 'тысячи']);
    });

    it('отбрасывает знаки препинания', () => {
      expect(tokenize('купил, продукты! (500 р.)')).toEqual(['купил', 'продукты', '500', 'р']);
    });
  });

  describe('wordsToNumber', () => {
    const cases: Array<[string, number]> = [
      ['пятьсот', 500],
      ['двадцать пять', 25],
      ['сто пятьдесят', 150],
      ['две тысячи пятьсот', 2500],
      ['тысяча двести', 1200],
      ['сто пятьдесят тысяч', 150000],
      ['миллион двести тысяч', 1_200_000],
      ['полторы тысячи', 1500],
      ['120 тысяч', 120000],
      ['2,5 тысячи', 2500],
      ['1.5к', 1500],
      ['пять косарей', 5000],
      ['две сотни', 200],
      ['ноль', 0],
    ];

    for (const [text, expected] of cases) {
      it(`«${text}» → ${expected}`, () => {
        expect(wordsToNumber(text)).toBe(expected);
      });
    }

    it('не разбирает число, если во фразе есть лишние слова', () => {
      expect(wordsToNumber('пятьсот рублей сорок копеек')).toBeNull();
    });

    it('возвращает null для текста без чисел', () => {
      expect(wordsToNumber('продукты на неделю')).toBeNull();
    });
  });

  describe('findNumber', () => {
    it('находит число в середине фразы', () => {
      const match = findNumber(tokenize('купил продукты на 1500 рублей'));
      expect(match?.value).toBe(1500);
      expect(match?.start).toBe(3);
    });

    it('находит число словами', () => {
      expect(findNumber(tokenize('на заправку две тысячи пятьсот'))?.value).toBe(2500);
    });

    it('пропускает ноль — суммы 0 не бывает', () => {
      expect(findNumber(tokenize('потратил ноль рублей'))).toBeNull();
    });

    it('возвращает null, если чисел нет', () => {
      expect(findNumber(tokenize('потратил на продукты'))).toBeNull();
    });
  });

  describe('parseNumberAt', () => {
    it('возвращает границы числа в токенах', () => {
      const tokens = tokenize('купил пятьсот рублей');
      expect(parseNumberAt(tokens, 1)).toEqual({ value: 500, start: 1, end: 2 });
    });

    it('не склеивает два числа подряд', () => {
      const tokens = tokenize('пять 500');
      expect(parseNumberAt(tokens, 0)?.value).toBe(5);
    });

    it('понимает «миллион двести тысяч» как 1 200 000', () => {
      expect(wordsToNumber('миллион двести тысяч')).toBe(1_200_000);
    });
  });
});
