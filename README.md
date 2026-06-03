# МедЮрист AI — Инструкция по деплою на Vercel

## Что внутри проекта
```
medjurist-vercel/
├── index.html        — фронтенд (интерфейс чата)
├── api/
│   └── chat.js       — бэкенд (прокси к Anthropic API)
└── vercel.json       — конфигурация Vercel
```

---

## Шаг 1 — Получи API-ключ Anthropic

1. Зайди на https://console.anthropic.com
2. Зарегистрируйся или войди
3. Перейди в раздел **API Keys**
4. Нажми **Create Key** — скопируй ключ (начинается с `sk-ant-...`)
5. Пополни баланс на $5–10 (карта Visa/Mastercard или крипта)

---

## Шаг 2 — Загрузи проект на GitHub

1. Зайди на https://github.com
2. Нажми **New repository** (зелёная кнопка)
3. Название: `medjurist` — нажми **Create repository**
4. На странице репозитория нажми **uploading an existing file**
5. Перетащи ВСЕ файлы из папки `medjurist-vercel` (включая папку `api`)
6. Нажми **Commit changes**

---

## Шаг 3 — Задеплой на Vercel

1. Зайди на https://vercel.com
2. Нажми **Add New → Project**
3. Выбери свой репозиторий `medjurist` — нажми **Import**
4. В разделе **Environment Variables** добавь:
   - Name: `ANTHROPIC_API_KEY`
   - Value: твой ключ `sk-ant-...`
5. Нажми **Deploy**
6. Через 1–2 минуты получишь ссылку вида `medjurist.vercel.app` ✅

---

## Готово! Продукт работает по ссылке без VPN.

---

## Следующие шаги (когда пойдут клиенты)

- Подключить свой домен `.ru` в настройках Vercel
- Перенести на российский VPS (Timeweb, Reg.ru) для надёжности
- Добавить авторизацию и базу данных
