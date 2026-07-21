const COMMANDS = Object.freeze([
  { command: '!команды', usage: '!команды' },
  { command: '!п', usage: '!п' },
  { command: '!баланс', usage: '!баланс' },
  {
    command: '!передать',
    usage: '!передать [сумма] [username/реплай]',
    acceptsArguments: true
  },
  { command: '!топ баланс', usage: '!топ баланс' },
  {
    command: '!promo',
    usage: '!promo [код]',
    acceptsArguments: true
  },
  {
    command: '!магазин',
    usage: '!магазин [раздел]',
    acceptsArguments: true
  },
  { command: '!имущество', usage: '!имущество' },
  { command: '!телефон', usage: '!телефон' },
  { command: '!номер', usage: '!номер' },
  {
    command: '!позвонить',
    usage: '!позвонить [номер]',
    acceptsArguments: true
  },
  {
    command: '!аренда',
    usage: '!аренда [название жилья]',
    acceptsArguments: true
  },
  {
    command: '!сдать',
    usage: '!сдать [название жилья]',
    acceptsArguments: true
  },
  { command: '!бизнес', usage: '!бизнес' },
  { command: '!банк', usage: '!банк' },
  {
    command: '!перелёт',
    usage: '!перелёт [страна]',
    acceptsArguments: true
  },
  {
    command: '!переезд',
    usage: '!переезд [страна]',
    acceptsArguments: true
  },
  { command: '!коробка', usage: '!коробка' },
  { command: '!кейсы', usage: '!кейсы' },
  { command: '!перки', usage: '!перки' },
  {
    command: '!кейс',
    usage: '!кейс [бронзовый/серебряный/алмазный/Platinum]',
    acceptsArguments: true
  },
  {
    command: '!склад лута',
    usage: '!склад лута'
  },
  { command: '!рыбачить', usage: '!рыбачить' },
  { command: '!улов', usage: '!улов' },
  { command: '!ферма', usage: '!ферма' },
  {
    command: '!семена',
    usage: '!ферма семена'
  },
  {
    command: '!склад',
    usage: '!ферма склад'
  },
  { command: '!квесты', usage: '!квесты' },
  { command: '!работы', usage: '!работы' },
  {
    command: '!работать',
    usage: '!работать [работа]',
    acceptsArguments: true
  },
  {
    command: '!zaff стоит ли',
    usage: '!zaff стоит ли [вопрос]',
    acceptsArguments: true
  },
  {
    command: '!скажи',
    usage: '!скажи [текст]',
    acceptsArguments: true
  },
  {
    command: '!кто',
    usage: '!кто [текст]',
    acceptsArguments: true
  },
  { command: '!мем', usage: '!мем' },
  {
    command: '+аура',
    usage: '+аура [реплай]',
    acceptsArguments: true
  },
  { command: '!топ ауры', usage: '!топ ауры' },
  {
    command: '!мемдуэль',
    usage: '!мемдуэль [username/реплай]',
    acceptsArguments: true
  },
  { command: '!картошка', usage: '!картошка' },
  { command: '!бомба', usage: '!бомба' },
  { command: '!реакция', usage: '!реакция' },
  {
    command: '!казино',
    usage: '!казино [ставка/всё]',
    acceptsArguments: true
  },
  {
    command: '!шансы казино',
    usage: '!шансы казино'
  },
  {
    command: '!ракета',
    usage: '!ракета [ставка/всё]',
    acceptsArguments: true
  },
  {
    command: '!шансы ракеты',
    usage: '!шансы ракеты'
  },
  {
    command: '!гонка',
    usage: '!гонка [username] [ставка]',
    acceptsArguments: true
  },
  {
    command: '!тюнинг',
    usage: '!тюнинг [название машины]',
    acceptsArguments: true
  },
  { command: '!гараж', usage: '!гараж' },
  {
    command: '!обнять',
    usage: '!обнять [username/реплай]',
    acceptsArguments: true
  },
  {
    command: '!поцеловать',
    usage: '!поцеловать [username/реплай]',
    acceptsArguments: true
  },
  {
    command: '!погладить',
    usage: '!погладить [username/реплай]',
    acceptsArguments: true
  },
  {
    command: '!дать пять',
    usage: '!дать пять [username/реплай]',
    acceptsArguments: true
  },
  {
    command: '!подмигнуть',
    usage: '!подмигнуть [username/реплай]',
    acceptsArguments: true
  },
  {
    command: '!пожать руку',
    usage: '!пожать руку [username/реплай]',
    acceptsArguments: true
  },
  {
    command: '!похвалить',
    usage: '!похвалить [username/реплай]',
    acceptsArguments: true
  },
  {
    command: '!поддержать',
    usage: '!поддержать [username/реплай]',
    acceptsArguments: true
  },
  {
    command: '!рассмешить',
    usage: '!рассмешить [username/реплай]',
    acceptsArguments: true
  },
  {
    command: '!угостить',
    usage: '!угостить [username/реплай]',
    acceptsArguments: true
  },
  {
    command: '!подарить цветы',
    usage: '!подарить цветы [username/реплай]',
    acceptsArguments: true
  },
  {
    command: '!потанцевать',
    usage: '!потанцевать [username/реплай]',
    acceptsArguments: true
  },
  {
    command: '!напугать',
    usage: '!напугать [username/реплай]',
    acceptsArguments: true
  },
  {
    command: '!сфотографироваться',
    usage: '!сфотографироваться [username/реплай]',
    acceptsArguments: true
  },
  {
    command: '!пожелать удачи',
    usage: '!пожелать удачи [username/реплай]',
    acceptsArguments: true
  },
  { command: '!угадай', usage: '!угадай' },
  {
    command: '!анализ',
    usage: '!анализ [ссылка/username]',
    acceptsArguments: true
  },
  {
    command: '!вики',
    usage: '!вики [запрос]',
    acceptsArguments: true
  },
  {
    command: '!qr',
    usage: '!qr [текст/ссылка]',
    acceptsArguments: true
  }
]);

function normalize(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/\s+/g, ' ')
    .replace(/[.,?]+$/g, '');
}

function getEditDistance(left, right) {
  const first = normalize(left);
  const second = normalize(right);
  let previous = Array.from(
    { length: second.length + 1 },
    (_, index) => index
  );

  for (let row = 1; row <= first.length; row += 1) {
    const current = [row];

    for (
      let column = 1;
      column <= second.length;
      column += 1
    ) {
      const substitutionCost =
        first[row - 1] === second[column - 1]
          ? 0
          : 1;

      current[column] = Math.min(
        current[column - 1] + 1,
        previous[column] + 1,
        previous[column - 1] + substitutionCost
      );
    }

    previous = current;
  }

  return previous[second.length];
}

function getMaximumDistance(length) {
  if (length <= 3) {
    return 0;
  }

  if (length <= 6) {
    return 1;
  }

  if (length <= 10) {
    return 2;
  }

  if (length <= 16) {
    return 3;
  }

  return 4;
}

function getCommandSuggestion(value) {
  const input = normalize(value);

  if (!input) {
    return null;
  }

  const inputWords = input.split(' ');
  const hasCommandPrefix =
    input.startsWith('!') ||
    input.startsWith('+');

  if (!hasCommandPrefix) {
    for (const definition of COMMANDS) {
      const commandWithoutPrefix =
        definition.command.slice(1);
      const commandWordCount =
        commandWithoutPrefix.split(' ').length;
      const inputPrefix = inputWords
        .slice(0, commandWordCount)
        .join(' ');

      if (inputPrefix === commandWithoutPrefix) {
        return definition.usage;
      }
    }

    return null;
  }

  let bestMatch = null;

  for (const definition of COMMANDS) {
    const command = normalize(
      definition.command
    );
    const commandWordCount =
      command.split(' ').length;
    const inputPrefix = inputWords
      .slice(0, commandWordCount)
      .join(' ');
    const distance = getEditDistance(
      inputPrefix,
      command
    );
    const maximumDistance =
      getMaximumDistance(command.length);
    const relativeDistance =
      distance / command.length;

    if (
      distance > maximumDistance ||
      relativeDistance > 0.35
    ) {
      continue;
    }

    const hasExtraWords =
      inputWords.length > commandWordCount;
    const argumentPenalty =
      hasExtraWords &&
      !definition.acceptsArguments
        ? 2
        : 0;
    const score = distance + argumentPenalty;

    if (
      !bestMatch ||
      score < bestMatch.score ||
      (
        score === bestMatch.score &&
        distance < bestMatch.distance
      )
    ) {
      bestMatch = {
        usage: definition.usage,
        score,
        distance
      };
    }
  }

  return bestMatch?.usage ?? null;
}

module.exports = {
  getCommandSuggestion
};
