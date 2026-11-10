// QVK Beta Portal — shared dictionaries (served to the client via /api/p/me).

export const BUG_STATUSES = [
  { id: "new", label: "Новый", emoji: "🔴", color: "#ff5d73", desc: "Отчёт получен и ждёт рассмотрения командой." },
  { id: "confirmed", label: "Подтверждён", emoji: "🟠", color: "#ff9f43", desc: "Команда воспроизвела ошибку и добавила её в план." },
  { id: "in_progress", label: "В работе", emoji: "🟡", color: "#f7c948", desc: "Разработчик уже исправляет ошибку." },
  { id: "verify", label: "Требуется проверка", emoji: "🔵", color: "#4cc9f0", desc: "Исправление готово — автору нужно проверить его на своём устройстве." },
  { id: "fixed", label: "Исправлено", emoji: "🟢", color: "#3ddc97", desc: "Исправление вошло в сборку." },
  { id: "closed", label: "Закрыто", emoji: "✅", color: "#7fd18b", desc: "Работа по отчёту завершена." },
  { id: "need_info", label: "Недостаточно данных", emoji: "⚪", color: "#c9c4d9", desc: "Нужны дополнительные сведения от автора." },
  { id: "cannot_reproduce", label: "Не воспроизводится", emoji: "⛔", color: "#9a8fb8", desc: "Команде не удалось повторить ошибку." },
  { id: "duplicate", label: "Дубликат", emoji: "🔗", color: "#a78bfa", desc: "Такая ошибка уже зарегистрирована — обсуждение продолжается в основном отчёте." },
];

export const IDEA_STATUSES = [
  { id: "new", label: "Новое", emoji: "✨", color: "#b794ff", desc: "Предложение опубликовано и ждёт рассмотрения." },
  { id: "review", label: "Рассматривается", emoji: "🔍", color: "#4cc9f0", desc: "Команда обсуждает идею." },
  { id: "planned", label: "Запланировано", emoji: "🗓", color: "#ff9f43", desc: "Идея включена в план разработки." },
  { id: "in_progress", label: "В разработке", emoji: "🛠", color: "#f7c948", desc: "Идея уже реализуется." },
  { id: "done", label: "Реализовано", emoji: "🎉", color: "#3ddc97", desc: "Идея реализована в приложении." },
  { id: "rejected", label: "Отклонено", emoji: "✖", color: "#ff5d73", desc: "Команда решила не реализовывать идею." },
  { id: "postponed", label: "Отложено", emoji: "⏸", color: "#9a8fb8", desc: "Идея перенесена на будущее." },
];

export const CATEGORIES = [
  { id: "music", label: "Музыка", icon: "music" },
  { id: "messages", label: "Сообщения", icon: "message" },
  { id: "notifications", label: "Уведомления", icon: "bell" },
  { id: "settings", label: "Настройки", icon: "settings" },
  { id: "ui", label: "Интерфейс", icon: "layout" },
  { id: "video", label: "Видео", icon: "video" },
  { id: "photos", label: "Фотографии", icon: "image" },
  { id: "auth", label: "Авторизация", icon: "key" },
  { id: "performance", label: "Производительность", icon: "zap" },
  { id: "other", label: "Другое", icon: "dots" },
];

export const FREQUENCIES = [
  { id: "always", label: "Всегда" },
  { id: "often", label: "Часто" },
  { id: "sometimes", label: "Иногда" },
  { id: "rare", label: "Редко" },
  { id: "once", label: "Один раз" },
];

export const PRIORITIES = [
  { id: "low", label: "Низкий", color: "#9a8fb8", weight: 1 },
  { id: "normal", label: "Обычный", color: "#b794ff", weight: 2 },
  { id: "high", label: "Высокий", color: "#ff9f43", weight: 3 },
  { id: "critical", label: "Критический", color: "#ff5d73", weight: 4 },
];

export const ids = (list) => list.map((x) => x.id);
export const BUG_STATUS_IDS = ids(BUG_STATUSES);
export const IDEA_STATUS_IDS = ids(IDEA_STATUSES);
export const CATEGORY_IDS = ids(CATEGORIES);
export const FREQUENCY_IDS = ids(FREQUENCIES);
export const PRIORITY_IDS = ids(PRIORITIES);

// Bug states that count as a "known issue" of the current build.
export const OPEN_BUG_STATUSES = ["new", "confirmed", "in_progress", "verify", "need_info"];
export const KNOWN_ISSUE_STATUSES = ["confirmed", "in_progress", "verify"];
// Bug states that mean the report was useful (used by the testers rating).
export const ACCEPTED_BUG_STATUSES = ["confirmed", "in_progress", "verify", "fixed", "closed"];

export const statusLabel = (kind, id) =>
  (kind === "bug" ? BUG_STATUSES : IDEA_STATUSES).find((s) => s.id === id)?.label || id;

export const LIMITS = {
  title: 140,
  text: 6000,
  short: 2000,
  comment: 4000,
  attachmentsPerTicket: 10,
  imageBytes: 10 * 1024 * 1024,
  videoBytes: 40 * 1024 * 1024,
  otherBytes: 10 * 1024 * 1024,
  devicesPerUser: 8,
  postBody: 8000,
};

export const META = {
  bugStatuses: BUG_STATUSES,
  ideaStatuses: IDEA_STATUSES,
  categories: CATEGORIES,
  frequencies: FREQUENCIES,
  priorities: PRIORITIES,
  limits: LIMITS,
};
