const components = Object.freeze([
  {
    key: 'stage',
    title: 'ECU / Stage',
    emoji: '💻',
    stockTitle: 'Стоковая прошивка',
    upgrades: [
      {
        title: 'Stage 1',
        price: 250000,
        powerGain: 40,
        raceGain: 55
      },
      {
        title: 'Stage 2',
        price: 5000000,
        powerGain: 140,
        raceGain: 190
      },
      {
        title: 'Stage 3',
        price: 50000000,
        powerGain: 450,
        raceGain: 650
      }
    ]
  },
  {
    key: 'engine',
    title: 'Двигатель',
    emoji: '⚙',
    stockTitle: 'Стоковый двигатель',
    upgrades: [
      {
        title: 'Спортивный впуск и охлаждение',
        price: 1000000,
        powerGain: 70,
        raceGain: 80
      },
      {
        title: 'Кованая поршневая',
        price: 10000000,
        powerGain: 220,
        raceGain: 260
      },
      {
        title: 'Гоночный блок',
        price: 100000000,
        powerGain: 700,
        raceGain: 850
      },
      {
        title: 'V8 Performance Swap',
        price: 500000000,
        powerGain: 2500,
        raceGain: 3000
      },
      {
        title: 'Drag Engine X',
        price: 1500000000,
        powerGain: 7000,
        raceGain: 8500
      }
    ]
  },
  {
    key: 'turbo',
    title: 'Турбонаддув',
    emoji: '🌪',
    stockTitle: 'Без турбины',
    upgrades: [
      {
        title: 'Single Turbo Kit',
        price: 500000,
        powerGain: 100,
        raceGain: 110
      },
      {
        title: 'Twin Turbo',
        price: 7500000,
        powerGain: 280,
        raceGain: 330
      },
      {
        title: 'Race Twin Turbo',
        price: 75000000,
        powerGain: 900,
        raceGain: 1100
      },
      {
        title: 'Triple Boost System',
        price: 350000000,
        powerGain: 2500,
        raceGain: 3100
      },
      {
        title: 'Quad Turbo Drag',
        price: 1000000000,
        powerGain: 6000,
        raceGain: 7500
      }
    ]
  },
  {
    key: 'transmission',
    title: 'Трансмиссия',
    emoji: '🕹',
    stockTitle: 'Стоковая коробка',
    upgrades: [
      {
        title: 'Спортивное сцепление',
        price: 250000,
        powerGain: 0,
        raceGain: 40
      },
      {
        title: 'Усиленная коробка',
        price: 3000000,
        powerGain: 0,
        raceGain: 140
      },
      {
        title: 'Секвентальная КПП',
        price: 30000000,
        powerGain: 0,
        raceGain: 500
      },
      {
        title: 'Гоночный полный привод',
        price: 150000000,
        powerGain: 0,
        raceGain: 1700
      },
      {
        title: 'Drag Transmission Pro',
        price: 600000000,
        powerGain: 0,
        raceGain: 5000
      }
    ]
  },
  {
    key: 'chassis',
    title: 'Ходовая и зацеп',
    emoji: '🏎',
    stockTitle: 'Стоковая ходовая',
    upgrades: [
      {
        title: 'Спортивная подвеска',
        price: 100000,
        powerGain: 0,
        raceGain: 30
      },
      {
        title: 'Полуслики',
        price: 1000000,
        powerGain: 0,
        raceGain: 100
      },
      {
        title: 'Гоночные слики',
        price: 10000000,
        powerGain: 0,
        raceGain: 400
      },
      {
        title: 'Активная аэродинамика',
        price: 80000000,
        powerGain: 0,
        raceGain: 1400
      },
      {
        title: 'Карбоновое шасси',
        price: 300000000,
        powerGain: 0,
        raceGain: 4000
      }
    ]
  },
  {
    key: 'exhaust',
    title: 'Выхлоп',
    emoji: '🔥',
    stockTitle: 'Стоковый выхлоп',
    upgrades: [
      {
        title: 'Cat-back Exhaust',
        price: 150000,
        powerGain: 20,
        raceGain: 25
      },
      {
        title: 'Спортивный Downpipe',
        price: 1500000,
        powerGain: 55,
        raceGain: 65
      },
      {
        title: 'Полный спортивный выхлоп',
        price: 15000000,
        powerGain: 140,
        raceGain: 180
      },
      {
        title: 'Титановая трасса',
        price: 75000000,
        powerGain: 400,
        raceGain: 500
      },
      {
        title: 'Drag Straight Pipe',
        price: 250000000,
        powerGain: 900,
        raceGain: 1100
      }
    ]
  }
]);

const componentsByKey = new Map(
  components.map(component => [
    component.key,
    component
  ])
);

function normalizeLevel(value, maximum) {
  return Math.min(
    maximum,
    Math.max(
      0,
      Math.trunc(Number(value) || 0)
    )
  );
}

function getTuningComponent(value) {
  return componentsByKey.get(
    String(value ?? '').trim()
  ) ?? null;
}

function getInstalledUpgrade(
  component,
  level
) {
  const safeLevel = normalizeLevel(
    level,
    component.upgrades.length
  );

  return safeLevel > 0
    ? component.upgrades[safeLevel - 1]
    : null;
}

function getNextUpgrade(component, level) {
  const safeLevel = normalizeLevel(
    level,
    component.upgrades.length
  );

  return component.upgrades[safeLevel] ?? null;
}

function calculateCarTuning(car, levels = {}) {
  let power = Math.max(
    1,
    Math.trunc(Number(car?.basePower) || 1)
  );
  let raceRating = Math.max(
    1,
    Math.trunc(
      Number(car?.baseRaceRating) || power
    )
  );
  let totalSpent = 0;
  let installedCount = 0;

  const componentStates = components.map(
    component => {
      const level = normalizeLevel(
        levels[component.key],
        component.upgrades.length
      );
      const installed =
        component.upgrades.slice(0, level);
      const componentSpent = installed.reduce(
        (sum, upgrade) => sum + upgrade.price,
        0
      );
      const powerGain = installed.reduce(
        (sum, upgrade) =>
          sum + upgrade.powerGain,
        0
      );
      const raceGain = installed.reduce(
        (sum, upgrade) =>
          sum + upgrade.raceGain,
        0
      );

      power += powerGain;
      raceRating += raceGain;
      totalSpent += componentSpent;
      installedCount += level;

      return {
        component,
        level,
        installedUpgrade:
          getInstalledUpgrade(component, level),
        nextUpgrade:
          getNextUpgrade(component, level),
        componentSpent,
        powerGain,
        raceGain
      };
    }
  );

  return {
    power,
    raceRating,
    totalSpent,
    installedCount,
    isStock: installedCount === 0,
    componentStates
  };
}

module.exports = {
  components,
  getTuningComponent,
  getInstalledUpgrade,
  getNextUpgrade,
  calculateCarTuning
};
