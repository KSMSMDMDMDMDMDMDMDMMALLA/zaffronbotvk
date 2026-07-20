const { Keyboard } = require('vk-io');

const janitor = require('./janitor');
const roadWorker = require('./road-worker');
const seller = require('./seller');
const pcClubAdministrator = require('./pc-club-administrator');
const secretary = require('./secretary');
const deputyFactoryChief = require('./deputy-factory-chief');
const factoryChief = require('./factory-chief');
const airlineChief = require('./airline-chief');
const deputy = require('./deputy');
const primeMinister = require('./prime-minister');
const advancedJobs = require('./advanced');

const {
  formatMoney,
  JOB_MAX_LEVEL,
  getJobExperienceRequired,
  getJobProfile,
  getActiveJob,
  getActiveJobs,
  beginJob,
  completeJob
} = require('../database');

const jobDefinitions = [
  janitor,
  roadWorker,
  seller,
  pcClubAdministrator,
  secretary,
  deputyFactoryChief,
  factoryChief,
  airlineChief,
  deputy,
  primeMinister,
  ...advancedJobs
];

const jobs = jobDefinitions.map(
  (job, index) => {
    const nextJob =
      jobDefinitions[index + 1];
    const maxLevel = nextJob
      ? nextJob.requiredLevel - 1
      : JOB_MAX_LEVEL;

    return {
      ...job,
      maxLevel: Math.max(
        job.requiredLevel,
        maxLevel
      )
    };
  }
);

const jobsByKey = new Map(
  jobs.map(job => [
    job.key,
    job
  ])
);

const jobsByAlias = new Map();

for (const job of jobs) {
  for (const alias of job.aliases) {
    jobsByAlias.set(
      normalizeJobName(alias),
      job
    );
  }
}

const scheduledJobs = new Map();

function normalizeJobName(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function formatDuration(milliseconds) {
  const seconds = Math.max(
    1,
    Math.ceil(milliseconds / 1000)
  );

  if (seconds >= 60) {
    const minutes = Math.floor(
      seconds / 60
    );
    const remainingSeconds =
      seconds % 60;

    return remainingSeconds > 0
      ? `${minutes} мин. ${remainingSeconds} сек.`
      : `${minutes} мин.`;
  }

  return `${seconds} сек.`;
}

function formatExperience(level, experience) {
  const experienceRequired =
    getJobExperienceRequired(level);

  if (experienceRequired === null) {
    return `📊 EXP в статистике: ${experience}`;
  }

  return `📈 EXP: ${experience}/${experienceRequired}`;
}

function getJobLevelRange(job) {
  return job.requiredLevel === job.maxLevel
    ? `${job.requiredLevel}`
    : `${job.requiredLevel}–${job.maxLevel}`;
}

function getCurrentCareerJob(level) {
  return jobs.find(job =>
    level >= job.requiredLevel &&
    level <= job.maxLevel
  ) ?? jobs.at(-1);
}

async function getUserName(vk, userId) {
  try {
    const users = await vk.api.users.get({
      user_ids: userId
    });

    const user = users?.[0];

    if (user) {
      return [
        user.first_name,
        user.last_name
      ]
        .filter(Boolean)
        .join(' ');
    }
  } catch (error) {
    console.error(
      'Не удалось получить имя работника:',
      error
    );
  }

  return `id${userId}`;
}

function buildCompletionMessage(
  activeJob,
  job,
  result,
  userName
) {
  const levelText = result.leveledUp
    ? `🎉 Новый уровень: ${result.level}!\n`
    : result.isMaxLevel
      ? `⭐ Уровень: ${result.level} (максимальный)\n`
      : `⭐ Уровень: ${result.level}\n`;

  const boostText = result.boostUsed
    ? '⚡ Буст смены x2 применён! Зарплата и EXP удвоены.\n'
    : '';

  return (
    `✅ @id${activeJob.vkId} (${userName}), смена окончена!\n\n` +
    `${job.emoji} Работа: ${job.title}\n` +
    boostText +
    `💵 Зарплата: +${formatMoney(result.salary)} ₽\n` +
    levelText +
    `${formatExperience(result.level, result.experience)} ` +
    `(+${result.experienceEarned} за смену)\n` +
    `🏦 Баланс: ${formatMoney(result.balance)} ₽`
  );
}

function createContinueJobKeyboard(
  completedJob,
  level,
  userId
) {
  const currentJob = getCurrentCareerJob(level);

  return Keyboard.builder()
    .textButton({
      label: currentJob.key === completedJob.key
        ? 'Продолжить работу'
        : `⬆ Новая работа: ${currentJob.title}`,
      payload: {
        command: 'job_continue',
        jobKey: currentJob.key,
        userId
      },
      color: Keyboard.POSITIVE_COLOR
    })
    .inline();
}

async function finishJob(vk, activeJob) {
  const job =
    jobsByKey.get(activeJob.jobKey);

  if (!job) {
    console.error(
      `Неизвестная активная работа: ${activeJob.jobKey}`
    );

    return;
  }

  try {
    const result = completeJob({
      vkId: activeJob.vkId,
      jobKey: activeJob.jobKey,
      salary: job.salary
    });

    if (result.status === 'too_early') {
      scheduleJob(
        vk,
        getActiveJob(activeJob.vkId)
      );

      return;
    }

    if (result.status !== 'completed') {
      return;
    }

    const userName = await getUserName(
      vk,
      activeJob.vkId
    );

    await vk.api.messages.send({
      peer_id: activeJob.peerId,
      random_id: 0,
      message: buildCompletionMessage(
        activeJob,
        job,
        result,
        userName
      ),
      keyboard: createContinueJobKeyboard(
        job,
        result.level,
        activeJob.vkId
      )
    });
  } catch (error) {
    console.error(
      'Ошибка завершения рабочей смены:',
      error
    );
  }
}

function scheduleJob(vk, activeJob) {
  if (!activeJob) {
    return;
  }

  if (scheduledJobs.has(activeJob.vkId)) {
    return;
  }

  const delay = Math.max(
    0,
    activeJob.endsAt - Date.now()
  );

  const timer = setTimeout(
    async () => {
      scheduledJobs.delete(activeJob.vkId);

      await finishJob(
        vk,
        activeJob
      );
    },
    delay
  );

  scheduledJobs.set(
    activeJob.vkId,
    timer
  );
}

function initialize(vk) {
  const activeJobs = getActiveJobs();

  for (const activeJob of activeJobs) {
    scheduleJob(vk, activeJob);
  }
}

async function sendJobsList(context) {
  const profile = getJobProfile(
    Number(context.senderId)
  );

  const lines = jobs.map(job => {
    const access = profile.level < job.requiredLevel
      ? `🔒 С ${job.requiredLevel} уровня`
      : profile.level > job.maxLevel
        ? '⛔ Уже пройдена'
        : '✅ Доступно сейчас';

    const experienceRequired =
      getJobExperienceRequired(job.requiredLevel);

    const experienceLine =
      experienceRequired === null
        ? '├ Следующий уровень: максимальный\n'
        : `├ До следующего уровня: ${experienceRequired} EXP\n`;

    return (
      `${job.emoji} ${job.title}\n` +
      `├ Уровни: ${getJobLevelRange(job)}\n` +
      `├ Смена: ${formatDuration(job.durationMs)}\n` +
      `├ Зарплата: ${formatMoney(job.salary)} ₽\n` +
      experienceLine +
      `└ ${access}`
    );
  });

  await context.send(
    '💼 Работы Zaffron\n\n' +
    `⭐ Твой уровень: ${profile.level}` +
    `${profile.level >= JOB_MAX_LEVEL ? ' (максимальный)' : ''}\n` +
    `${formatExperience(profile.level, profile.experience)}\n\n` +
    `${lines.join('\n\n')}\n\n` +
    'За каждую завершённую смену начисляется 1 EXP.\n' +
    'После открытия новой профессии предыдущие работы закрываются.\n' +
    'Новые должности открываются вплоть до 50 уровня.\n' +
    'Максимальный уровень игрока — 50.'
  );

  return true;
}

async function startJob(
  context,
  vk,
  rawJobName
) {
  const normalizedJobName =
    normalizeJobName(rawJobName);
  const job =
    jobsByKey.get(normalizedJobName) ??
    jobsByAlias.get(normalizedJobName);

  if (!job) {
    await context.reply(
      '❌ Такой работы нет.\n\n' +
      'Посмотреть список: !работы'
    );

    return true;
  }

  const userId =
    Number(context.senderId);

  const profile =
    getJobProfile(userId);

  if (profile.level < job.requiredLevel) {
    await context.reply(
      `🔒 Работа «${job.title}» доступна ` +
      `с ${job.requiredLevel} уровня.\n\n` +
      `⭐ Твой уровень: ${profile.level}`
    );

    return true;
  }

  if (profile.level > job.maxLevel) {
    const currentJob = getCurrentCareerJob(
      profile.level
    );

    await context.reply(
      `⛔ Работа «${job.title}» уже слишком низкая для твоего уровня.\n\n` +
      `📊 Она доступна на уровнях: ${getJobLevelRange(job)}\n` +
      `⭐ Твой уровень: ${profile.level}\n\n` +
      `💼 Текущая профессия: ${currentJob.emoji} ${currentJob.title}\n` +
      `Команда: !работать ${currentJob.aliases[0]}`
    );

    return true;
  }

  const currentActiveJob =
    getActiveJob(userId);

  if (currentActiveJob) {
    scheduleJob(vk, currentActiveJob);

    const currentJob =
      jobsByKey.get(currentActiveJob.jobKey);

    const remaining = Math.max(
      0,
      currentActiveJob.endsAt - Date.now()
    );

    await context.reply(
      '⏳ Ты уже работаешь.\n\n' +
      `💼 Текущая работа: ${currentJob?.title ?? 'Неизвестно'}\n` +
      `⌛ До конца смены: ${formatDuration(remaining)}`
    );

    return true;
  }

  const startResult = beginJob({
    vkId: userId,
    peerId: Number(context.peerId),
    jobKey: job.key,
    durationMs: job.durationMs
  });

  if (startResult.status !== 'started') {
    scheduleJob(vk, startResult.job);

    await context.reply(
      '⏳ Ты уже находишься на смене.'
    );

    return true;
  }

  scheduleJob(vk, startResult.job);

  const userName = await getUserName(
    vk,
    userId
  );

  await context.send(
    `👷 @id${userId} (${userName}), ` +
    `ты начал работу ${job.workTitle}!\n\n` +
    `⏳ Смена закончится через ${formatDuration(job.durationMs)}\n` +
    `💵 Зарплата: ${formatMoney(job.salary)} ₽\n\n` +
    'Дождись окончания смены.'
  );

  return true;
}

async function handle(context, vk) {
  const originalText =
    String(context.text ?? '')
      .trim();
  const payload = context.messagePayload;

  if (payload?.command === 'job_continue') {
    const ownerId = Number(payload.userId);

    if (
      Number.isInteger(ownerId) &&
      ownerId > 0 &&
      ownerId !== Number(context.senderId)
    ) {
      await context.reply(
        '❌ Эта кнопка продолжения принадлежит другому игроку.'
      );

      return true;
    }

    return startJob(
      context,
      vk,
      payload.jobKey
    );
  }

  if (/^!работы$/i.test(originalText)) {
    return sendJobsList(context);
  }

  if (/^!работать\s*$/i.test(originalText)) {
    await context.reply(
      '❌ Укажи работу.\n\n' +
      'Пример:\n' +
      '!работать дворник\n\n' +
      'Список работ: !работы'
    );

    return true;
  }

  const match = originalText.match(
    /^!работать\s+(.+)$/i
  );

  if (!match) {
    return false;
  }

  return startJob(
    context,
    vk,
    match[1]
  );
}

module.exports = {
  initialize,
  handle
};
