# QVK Beta Portal — API для приложения QVK (v1)

Базовый URL: `https://qvk-moderator.qmurzik7.workers.dev/api/app/v1`

- Формат: JSON (UTF-8). Загрузка файлов — `multipart/form-data`.
- Авторизация: `Authorization: Bearer qat_<48 hex>` — личный токен, получаемый привязкой по коду (см. «Привязка»). Cookie не используются, CSRF не нужен.
- Даты — ISO 8601 UTC (`2026-11-12T09:15:00.000Z`).
- Ошибки всегда в одном формате, сообщение — по-русски, его можно показывать пользователю:

```json
{ "error": { "code": "validation", "message": "Поле «Название» слишком короткое (минимум 4 симв.)" } }
```

При 429 дополнительно: заголовок `Retry-After: <сек>` и `error.retry_after`.

| HTTP | error.code | Когда |
|---|---|---|
| 400 | `validation`, `bad_json`, `too_many_files`, `attachment_not_found` | неверные поля/JSON, >5 файлов, чужое или незагруженное вложение |
| 401 | `unauthorized` | нет/неверный формат токена |
| 401 | `token_revoked` | токен отозван в профиле, через `/logout` или не использовался 180 дней — нужна новая привязка |
| 403 | `forbidden`, `account_disabled` | действие недоступно (напр. проверка чужого бага), аккаунт заблокирован |
| 404 | `not_found`, `link_not_found` | нет обращения/метода; код привязки не найден |
| 409 | `own_ticket`, `attachment_used`, `conflict` | «У меня тоже» на своё обращение; вложение уже прикреплено; обращение не в нужном статусе |
| 413 | `file_too_large`, `payload_too_large` | файл > 5 МБ; тело запроса слишком большое |
| 415 | `unsupported_file` | тип файла не разрешён (проверяется по содержимому, не по расширению) |
| 429 | `rate_limited` | превышен лимит |
| 500 | `internal` | ошибка сервера — можно повторить |

## Привязка приложения (без пароля)

1. Приложение: `POST /link/start` → получает `code` (`ABCD-EFGH`), `poll_token`, `confirm_url`, `telegram_url`.
2. Пользователь видит код и две кнопки:
   - «Подтвердить в Telegram» → открыть `telegram_url` (бот QVK). Бот спрашивает: «Подключить „<device_name>“ к аккаунту <ник>? Код: ABCD-EFGH» → «✅ Подключить». Работает, если Telegram привязан к аккаунту портала (Профиль → «Подключить Telegram»); иначе бот предложит подтвердить на сайте.
   - «Подтвердить на сайте» → открыть `confirm_url` в браузере. Пользователь входит на портал (ник + пароль, если ещё не вошёл), видит устройство и код → «Подключить». Код можно ввести и вручную: Профиль → «Приложение QVK» → «Ввести код» (страница `/link`).
3. Приложение каждые `poll_interval` (3 с) вызывает `POST /link/poll` до статуса `approved` (получает `token`), `denied`, `expired` или `used`.
4. Токен сохраняется в защищённом хранилище (EncryptedSharedPreferences/Keystore) и отправляется в `Authorization: Bearer`.

Сроки: код живёт **10 минут** и одноразовый. Токен **бессрочный**, пока используется: отзывается в профиле портала («Отключить»), через `POST /logout`, при удалении профиля или после **180 дней** без запросов. На сервере хранится только SHA-256 токена.

## Эндпоинты

### `GET /meta` — справочник (без авторизации)
```json
{
  "api_version": 1,
  "current_version": "3.0 alpha22",
  "categories": [{ "code": "music", "label": "Музыка" }, "…"],
  "frequencies": [{ "code": "always", "label": "Всегда" }, "…"],
  "bug_statuses": [{ "code": "new", "label": "Новый", "emoji": "🔴", "color": "#ff5d73", "description": "…" }, "…"],
  "idea_statuses": ["…"],
  "priorities": [{ "code": "normal", "label": "Обычный" }, "…"],
  "limits": {
    "attachment_max_bytes": 5242880, "attachments_per_request": 5,
    "attachment_types": ["image/jpeg", "image/png", "image/webp", "text/plain", "application/zip"],
    "tickets_per_hour": 10, "comments_per_hour": 30,
    "title": { "min": 4, "max": 140 }, "description": { "min": 10, "max": 6000 }, "steps": { "min": 5, "max": 6000 },
    "expected_actual_purpose_max": 2000, "how_it_works_max": 6000, "comment_max": 4000
  }
}
```

### `POST /link/start` (без авторизации)
Запрос: `{ "device_name": "Poco F9 Ultra · QVK 3.0 alpha22" }` (необязательно, до 80 симв.; показывается пользователю при подтверждении и в профиле).
Ответ `201`:
```json
{ "code": "K7M2-X9QP", "poll_token": "qlp_…", "expires_in": 600, "poll_interval": 3,
  "confirm_url": "https://…/link?code=K7M2X9QP", "telegram_url": "https://t.me/<бот>?start=app_K7M2X9QP" }
```
Ошибки: 429 (не больше 10 запросов кода за 10 минут с одного IP).

### `POST /link/poll` (без авторизации)
Запрос: `{ "poll_token": "qlp_…" }`. Ответ `200`, одно из:
```json
{ "status": "pending", "expires_in": 412 }
{ "status": "approved", "token": "qat_…", "token_type": "Bearer", "user": { "name": "Shasoko" } }
{ "status": "denied" } | { "status": "expired" } | { "status": "used" }
```
`approved` приходит **один раз**; повторный опрос вернёт `used`. Ошибки: 400 `validation`, 404 `link_not_found`, 429.

### `GET /me`
```json
{ "user": { "name": "Shasoko", "telegram_linked": true, "joined": "2026-11-10T18:01:00.000Z" },
  "counts": { "bugs": 8, "ideas": 2, "needs_verify": 3, "needs_info": 1, "unread_notifications": 4 } }
```

### `POST /logout`
Отзывает текущий токен. Ответ `{ "ok": true }`.

### `POST /attachments` — загрузка вложений
`multipart/form-data`, одно или несколько полей **`file`** (до 5 за раз). Разрешены: скриншоты JPG/PNG/WEBP, логи TXT/LOG (`text/plain`) и ZIP; до 5 МБ каждый. Тип определяется по содержимому файла.
Ответ `201`:
```json
{ "attachments": [ { "id": "k3n9…(20 симв.)", "name": "Screenshot.png", "mime": "image/png", "size": 183270 } ] }
```
Затем `id` передаются в `attachments` при создании обращения, комментария, «У меня тоже» или проверке. Неприкреплённые загрузки удаляются через сутки. Если хотя бы один файл не подходит — не сохраняется ни один.
Ошибки: 400 `too_many_files`/`validation`, 413 `file_too_large`, 415 `unsupported_file`, 429 (60 загрузок в час).

### `GET /attachments/{id}`
Скачивание вложения (бинарный ответ, поддерживается `Range`). Доступно для вложений обращений, которые пользователь может видеть. Ссылки в карточках уже имеют вид `/api/app/v1/attachments/{id}`.

### `POST /similar` — поиск похожих
Запрос: `{ "kind": "bug", "title": "Плеер падает при смене трека", "description": "…", "category": "music" }` (`title` обязателен).
Ответ: `{ "items": [ { "code": "BUG-0013", "title": "…", "category": "music", "status": { "code": "verify", "label": "Требуется проверка", "emoji": "🔵", "color": "#4cc9f0" }, "counts": { "confirms": 1, "votes": 0 }, "score": 0.74, "created": "…" } ] }` — до 5 записей, по убыванию сходства. Показывать перед отправкой: «Открыть», «У меня тоже», «Отправить всё равно» — отправку не блокировать.

### `POST /tickets` — создать баг или идею
Общие поля: `kind` (`bug`|`idea`), `category`, `title`, `description`, `device` (обязательно), `attachments` (массив id, до 5).
Баг: `steps` (обязательно), `expected`, `actual`, `frequency` (обязательно: `always|often|sometimes|rare|once`).
Идея: `how_it_works`, `purpose`.
`device`: `{ "model": "Poco F9 Ultra", "android": "16", "app_version": "8.100-qvk-3.0.0-alpha22", "firmware": "HyperOS 3.0.310" }` — `firmware` необязательна. Устройство также сохраняется в профиль на сайте.
```json
{ "kind": "bug", "category": "music", "title": "Плеер падает при смене трека",
  "description": "При свайпе на следующий трек приложение закрывается.",
  "steps": "1. Открыть плеер\n2. Свайпнуть влево", "expected": "Следующий трек", "actual": "Вылет",
  "frequency": "often", "device": { "…": "…" }, "attachments": ["k3n9…"] }
```
Ответ `201`: `{ "ticket": <Карточка> }` (номер `BUG-0018` / `IDEA-0007`, `source: "app"`). Администраторы получают уведомление в Telegram с пометкой «📱 из приложения».
Ошибки: 400 `validation`/`attachment_not_found`/`too_many_files`, 409 `attachment_used`, 429 `rate_limited` (10 обращений в час).

### `GET /tickets` — списки
Параметры: `scope` = `mine` (по умолчанию, «Мои обращения») | `all`; `kind` = `bug` (по умолчанию) | `idea`; `status` (код или несколько через запятую; `open` — все незакрытые); `q` (поиск); `category`; `updated_since` (ISO-дата — только изменённые позже, удобно для синхронизации); `page` (с 0), `limit` (1–50, по умолчанию 20). Для `scope=all` — `sort` = `new|activity|votes|updated`; для `mine` сортировка по последнему обновлению.
```json
{ "items": [ {
    "code": "BUG-0016", "kind": "bug", "category": "ui", "title": "Темы, стили и прочее",
    "status": { "code": "verify", "label": "Требуется проверка", "emoji": "🔵", "color": "#4cc9f0" },
    "priority": "normal", "source": "app", "fixed_version": "3.0 alpha22",
    "team_note": "Исправлено, проверьте", "last_team_comment": "Спасибо!",
    "needs_action": "verify", "is_mine": true, "me_too": false,
    "counts": { "confirms": 0, "votes": 0, "comments": 2 }, "duplicate_of": null,
    "created": "…", "updated": "…" } ],
  "total": 8, "page": 0, "has_more": false }
```
`needs_action`: `verify` (ждём проверку автора), `need_info` (команда просит данные) или `null`. `last_team_comment` есть только в `scope=mine`.

### `GET /tickets/{code}` — карточка
```json
{ "ticket": {
  "…поля из списка…": "",
  "description": "…", "steps": "…", "expected": "…", "actual": "…", "frequency": "often",
  "how_it_works": null, "purpose": null,
  "device": { "model": "Poco F9 Ultra", "android": "16", "app_version": "…", "firmware": "…" },
  "author": { "name": "Shasoko", "is_me": true, "is_team": false },
  "attachments": [ { "id": "…", "name": "shot.png", "mime": "image/png", "size": 183270, "url": "/api/app/v1/attachments/…" } ],
  "comments": [ { "id": 12, "kind": "comment", "text": "Спасибо, исправляем",
                  "author": { "name": "Команда QVK", "is_team": true, "is_author": false, "is_me": false },
                  "attachments": [], "created": "…" } ],
  "history": [ { "field": "status", "from": "new", "to": "verify", "note": "Проверьте в alpha23", "by": "Команда QVK", "by_team": true, "at": "…" } ],
  "can": { "comment": true, "verify": true, "me_too": false },
  "web_url": "https://…/bugs/BUG-0016" } }
```
`comments[].kind`: `comment`, `addendum` (дополнение автора), `verify` (результат проверки). `history[].field`: `created`, `status`, `priority`, `fixed_version`, `note`, `edited`, `merged`, `pinned`, `hidden`. Ошибки: 404 `not_found` (нет или скрыто администрацией).

### `POST /tickets/{code}/comments`
Запрос: `{ "text": "…", "attachments": ["…"], "addendum": false }` — `addendum: true` (только автор) помечает комментарий как дополнение к отчёту. Нужен текст или хотя бы одно вложение. Можно комментировать своё и чужое обращение (если администрация не ограничила комментарии автором).
Ответ `201`: `{ "ok": true, "comment_id": 15, "ticket": <Карточка> }`. Автор/команда получают уведомление.
Ошибки: 400, 403 (комментарии только для автора и команды), 404, 429 (30 комментариев в час).

### `POST /tickets/{code}/me-too` и `DELETE /tickets/{code}/me-too`
«У меня тоже»: для бага — подтверждение, для идеи — голос. `POST` с необязательными `{ "comment": "Тоже падает на Pixel", "attachments": ["<id лога>"] }` — комментарий публикуется в обращении (если есть только вложения — с текстом «Встречается и у меня.»). `DELETE` снимает отметку.
Ответ: `{ "ok": true, "me_too": true, "counts": { "confirms": 2, "votes": 0 } }`. Ошибки: 409 `own_ticket`, 404, 429 (если есть комментарий).

### `POST /tickets/{code}/verify` — ответ на «Требуется проверка»
Только автор бага в статусе `verify` (`can.verify == true`). Запрос: `{ "result": "fixed" | "not_fixed", "comment": "…", "attachments": ["…"] }`.
`fixed` → статус `closed`; `not_fixed` → `confirmed` (возвращается команде). Комментарий сохраняется в обсуждении, администраторы получают уведомление в Telegram.
Ответ: `{ "ok": true, "ticket": <Карточка> }`. Ошибки: 400 `validation`, 403 `forbidden` (не автор), 409 `conflict` (не в статусе проверки), 429.

### `GET /notifications?unread=1` и `POST /notifications/read`
```json
{ "items": [ { "id": 41, "type": "verify", "text": "🔵 Проверьте исправление BUG-0016 в версии alpha23…", "ticket": "BUG-0016", "read": false, "created": "…" } ] }
```
`type`: `status`, `comment`, `need_info`, `verify`, `fixed`, `implemented`, `news`. `POST /notifications/read` с `{ "ids": [41, 42] }` или `{}` (все).

## Коды

Категории: `music` Музыка, `messages` Сообщения, `notifications` Уведомления, `settings` Настройки, `ui` Интерфейс, `video` Видео, `photos` Фотографии, `auth` Авторизация, `performance` Производительность, `other` Другое.

Статусы багов: `new` Новый, `confirmed` Подтверждён, `in_progress` В работе, `verify` Требуется проверка, `fixed` Исправлено, `closed` Закрыто, `need_info` Недостаточно данных, `cannot_reproduce` Не воспроизводится, `duplicate` Дубликат.

Статусы идей: `new` Новое, `review` Рассматривается, `planned` Запланировано, `in_progress` В разработке, `done` Реализовано, `rejected` Отклонено, `postponed` Отложено.

Частота: `always`, `often`, `sometimes`, `rare`, `once`. Приоритет (только чтение): `low`, `normal`, `high`, `critical`.

## Лимиты

| Что | Значение |
|---|---|
| Новых обращений | 10 в час на аккаунт |
| Комментариев (вкл. комментарии к «У меня тоже» и проверке) | 30 в час на аккаунт |
| Вложение | до 5 МБ; JPG/PNG/WEBP, TXT/LOG, ZIP |
| Файлов за запрос | 5 |
| Загрузок | 60 в час |
| Запросов кода привязки | 10 за 10 минут с IP |
| Опросов `/link/poll` | 300 за 10 минут с IP |
| Код привязки | 10 минут, одноразовый |
| Токен | до отзыва; истекает после 180 дней без использования |
