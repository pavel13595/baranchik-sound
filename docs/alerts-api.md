# alerts.in.ua API

Официальная документация: <https://devs.alerts.in.ua/>. Приложение использует `GET https://api.alerts.in.ua/v1/alerts/active.json`.

## Авторизация

API принимает токен либо в query-параметре `token`, либо в HTTP-заголовке `Authorization: Bearer <token>`. Выбор direct-режима задаётся в `venue.json` через `alerts.auth`: `query` по умолчанию или `bearer` для альтернативной проверки. В браузере query не вызывает CORS preflight для Authorization header. Если настроен `proxyUrl`, приложение обращается к Worker без токена; Worker добавляет свой Bearer secret upstream.

## Ответ

Active endpoint документирует объект `{ "alerts": [...] }`. В документации нет обязательного `meta.last_updated_at`; код не должен требовать его. Если поле `meta.last_updated_at` присутствует в ответе, его можно использовать как дополнительную информацию о свежести.

Поля Alert:

| Поле                                                       | Тип / значения                                                                       |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `id`                                                       | Идентификатор записи                                                                 |
| `location_title`                                           | Название локации                                                                     |
| `location_title_en`                                        | Название локации на английском                                                       |
| `location_type`                                            | `oblast`, `raion`, `city`, `hromada`, `unknown`                                      |
| `started_at`, `finished_at`, `updated_at`                  | Временные метки                                                                      |
| `alert_type`                                               | `air_raid`, `artillery_shelling`, `urban_fights`, `chemical`, `nuclear`              |
| `location_uid`                                             | UID локации; нормализовать через `String()`                                          |
| `location_oblast`, `location_oblast_uid`, `location_raion` | Названия и UID родительских локаций                                                  |
| `notes`                                                    | Примечание                                                                           |
| `alert_level`                                              | `red` или `yellow`                                                                   |
| `threats`                                                  | Необязательный массив угроз с `threat_type`, `level`, `started_at`, `source_message` |

Приложение реагирует только на `alert_type === "air_raid"`. Уровень берётся из `alert_level`; если его нет, используется максимальный `threats[].level`; если уровней нет, применяется `red`.

## HTTP-коды и ограничения

- `200`: запрос выполнен.
- `304`: данные не изменились; считать успешным ответом без нового payload и не менять состояние тревоги.
- `401`: токен отсутствует, неверен, отозван или просрочен.
- `403`: IP заблокирован либо API недоступно в стране.
- `429`: превышен лимит запросов.

Soft limit — 8–10 запросов в минуту с одного IP, hard limit — 12. При `429` сервис может блокировать нарушителей. Несколько устройств в одной Wi-Fi сети делят один публичный IP. Для публичного сервиса официальная документация требует собственный proxy; не помещайте секрет в код клиентской страницы.

API не предназначено для критической инфраструктуры; возможны задержки и временная недоступность. Использование API — на риск пользователя.

## Локации

Официальная документация публикует список UID в Google Sheet: <https://docs.google.com/spreadsheets/d/1XnTOzcPHd1LZUrarR1Fk43FUyl8Ae6a6M7pcwDRjNdA/edit?usp=sharing>. Генератор приложения читает CSV export этого sheet и строит локальный справочник `public/locations.json`.
