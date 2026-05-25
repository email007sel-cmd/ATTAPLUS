# AutoRewardPlus

> Based on [Microsoft-Rewards-Script](https://github.com/TheNetsky/Microsoft-Rewards-Script) — extended with Modern UI support (April 2026+)

> [!NOTE]
> This fork adds support for the new Microsoft Rewards card-based UI (April 2026 rollout).
> Both legacy and modern UI are auto-detected and handled automatically.

> [!WARNING]
> Modern UI tasks (Daily Set, Keep Earning) currently run on **desktop browser only**.
> Mobile support for the new UI is not yet implemented.

---

## ✨ What's New (vs upstream v3)

### Modern UI Support
- **Auto-detection**: Automatically detects whether the account uses legacy or modern Rewards UI
- **Daily Set** (`/dashboard`): Expands collapsible sections, clicks task cards to earn points
- **Keep Earning** (`/earn`): Detects earnable cards (badge `+N`, description "earn N points"), clicks to complete
- **Missions** (`/earn`): Auto-detects mission/challenge cards with sub-tasks (e.g., "0/4 tasks"), clicks into each mission, completes all sub-tasks, and verifies completion. Handles dynamic missions that change every few days.
- **Smart filtering**: Skips completed tasks, locked tasks ("Silver level required"), and non-earnable cards
- **Desktop-only execution**: Modern UI tasks run on desktop browser (mobile detection not reliable)
- **Tab management**: Closes ALL extra tabs after each task (prevents tab accumulation)
- **Verification**: Reloads page after completion to check/retry any remaining tasks

### Quick Launch
- **`start.bat`**: Double-click to auto-build and run on Windows (no terminal needed)

---

## Table of Contents

- [Quick Setup](#quick-setup)
- [Configuration Options](#configuration-options)
- [Account Setup](#account-setup)
- [Troubleshooting](#troubleshooting)
- [Disclaimer](#disclaimer)

---

## Quick Setup

### Windows (Easiest)

**Requirements:** Node.js >= 24 and Git

```bash
git clone https://github.com/nam091/AutoRewardPlus.git
cd AutoRewardPlus
npm run pre-build
```

1. Copy `src/accounts.example.json` → `src/accounts.json` and add your credentials
2. Copy `src/config.example.json` → `src/config.json` and customize
3. **Double-click `start.bat`** to build and run

### Manual (All platforms)

```bash
git clone https://github.com/nam091/AutoRewardPlus.git
cd AutoRewardPlus
npm run pre-build
npm run build
npm run start
```

### Docker

- Copy the sample [`compose.yaml`](compose.yaml)
- Copy and rename [`env.example`](env.example) to `.env` and add your account credentials:

```env
ACCOUNT_1_EMAIL=you@example.com
ACCOUNT_1_PASSWORD=your_password
```

> [!NOTE]
> A valid `accounts.json` is automatically created based on these values, and saved locally to `./config/`

- Review `compose.yaml` to adjust scheduling, timezone, and config options.
- Start the container: `docker compose up -d`

> [!TIP]
> Monitor logs with `docker logs microsoft-rewards-script`

---

## Configuration Options

Edit `config.json` to customize behavior, or set `CONFIG_*` environment variables in `compose.yaml` (Docker).

> [!WARNING]
> Rebuild the script (bare metal), or recreate the container (Docker) after all config changes.

### Core

| Setting                    | Type    | Default                      | Description                           |
| -------------------------- | ------- | ---------------------------- | ------------------------------------- |
| `baseURL`                  | string  | `"https://rewards.bing.com"` | Microsoft Rewards base URL            |
| `sessionPath`              | string  | `"sessions"`                 | Directory to store browser sessions   |
| `headless`                 | boolean | `false`                      | Run browser invisibly                 |
| `clusters`                 | number  | `1`                          | Number of concurrent account clusters |
| `errorDiagnostics`         | boolean | `false`                      | Enable error diagnostics              |
| `searchOnBingLocalQueries` | boolean | `false`                      | Use local query list                  |
| `globalTimeout`            | string  | `"30sec"`                    | Timeout for all actions               |

### Workers

| Setting                       | Type    | Default | Description                 |
| ----------------------------- | ------- | ------- | --------------------------- |
| `workers.doDailySet`          | boolean | `true`  | Complete daily set          |
| `workers.doSpecialPromotions` | boolean | `true`  | Complete special promotions |
| `workers.doMorePromotions`    | boolean | `true`  | Complete more promotions / Keep Earning |
| `workers.doPunchCards`        | boolean | `true`  | Complete punchcards         |
| `workers.doAppPromotions`     | boolean | `true`  | Complete app promotions     |
| `workers.doDesktopSearch`     | boolean | `true`  | Perform desktop searches    |
| `workers.doMobileSearch`      | boolean | `true`  | Perform mobile searches     |
| `workers.doDailyCheckIn`      | boolean | `true`  | Complete daily check-in     |
| `workers.doReadToEarn`        | boolean | `true`  | Complete Read-to-Earn       |
| `workers.doMissions`          | boolean | `true`  | Complete mission/challenge cards (Modern UI) |

### Search Settings

| Setting                                | Type     | Default                                      | Description                         |
| -------------------------------------- | -------- | -------------------------------------------- | ----------------------------------- |
| `searchSettings.scrollRandomResults`   | boolean  | `false`                                      | Scroll randomly on results          |
| `searchSettings.clickRandomResults`    | boolean  | `false`                                      | Click random links                  |
| `searchSettings.parallelSearching`     | boolean  | `true`                                       | Run searches in parallel            |
| `searchSettings.queryEngines`          | string[] | `["google", "wikipedia", "reddit", "local"]` | Query engines to use                |
| `searchSettings.searchResultVisitTime` | string   | `"10sec"`                                    | Time to spend on each search result |
| `searchSettings.searchDelay.min`       | string   | `"30sec"`                                    | Minimum delay between searches      |
| `searchSettings.searchDelay.max`       | string   | `"1min"`                                     | Maximum delay between searches      |

### Logging

| Setting                          | Type     | Default                | Description                       |
| -------------------------------- | -------- | ---------------------- | --------------------------------- |
| `debugLogs`                      | boolean  | `false`                | Enable debug logging              |
| `consoleLogFilter.enabled`       | boolean  | `false`                | Enable console log filtering      |
| `consoleLogFilter.mode`          | string   | `"whitelist"`          | Filter mode (whitelist/blacklist) |
| `consoleLogFilter.levels`        | string[] | `["error", "warn"]`    | Log levels to filter              |
| `consoleLogFilter.keywords`      | string[] | `["starting account"]` | Keywords to filter                |

### Proxy

| Setting             | Type    | Default | Description                 |
| ------------------- | ------- | ------- | --------------------------- |
| `proxy.queryEngine` | boolean | `true`  | Proxy query engine requests |

### Webhooks

| Setting                                  | Type     | Default                                              | Description                       |
| ---------------------------------------- | -------- | ---------------------------------------------------- | --------------------------------- |
| `webhook.discord.enabled`                | boolean  | `false`                                              | Enable Discord webhook            |
| `webhook.discord.url`                    | string   | `""`                                                 | Discord webhook URL               |
| `webhook.ntfy.enabled`                   | boolean  | `false`                                              | Enable ntfy notifications         |
| `webhook.ntfy.url`                       | string   | `""`                                                 | ntfy server URL                   |
| `webhook.ntfy.topic`                     | string   | `""`                                                 | ntfy topic                        |
| `webhook.ntfy.token`                     | string   | `""`                                                 | ntfy authentication token         |
| `webhook.ntfy.title`                     | string   | `"Microsoft-Rewards-Script"`                         | Notification title                |
| `webhook.ntfy.tags`                      | string[] | `["bot", "notify"]`                                  | Notification tags                 |
| `webhook.ntfy.priority`                  | number   | `3`                                                  | Notification priority (1-5)       |

---

## Account Setup

Edit `src/accounts.json`:

```json
[
    {
        "email": "your_email@hotmail.com",
        "password": "your_password",
        "totpSecret": "",
        "recoveryEmail": "",
        "geoLocale": "auto",
        "langCode": "en",
        "proxy": {
            "proxyAxios": false,
            "url": "",
            "port": 0,
            "username": "",
            "password": ""
        },
        "saveFingerprint": {
            "mobile": false,
            "desktop": false
        }
    }
]
```

> [!NOTE]
> `geoLocale` uses the default locale of your Microsoft profile. You can overwrite it with a custom locale.

> [!TIP]
> For 2FA login, add your `totpSecret` to auto-generate the 6-digit code. Get it from Microsoft Security > Manage sign-in > Add Authenticator app > "Enter code manually".

---

## How Modern UI Detection Works

```
Bot Start
├── Mobile Login
├── Detect UI Version (modern / legacy)
│
├── Legacy UI → Run Daily Set + Promotions in mobile phase
├── Modern UI → Skip in mobile phase
│
├── Desktop Login
│   └── Modern UI → Run Daily Set (/dashboard) + Keep Earning (/earn) + Missions (/earn)
│       ├── Expand sections (Your progress, Daily set)
│       ├── Click each task card (triggers Microsoft tracking)
│       ├── Detect mission cards ("X/Y tasks"), click into detail page, complete sub-tasks
│       ├── Close ALL extra tabs after each click
│       └── Verify: reload page, retry remaining tasks/missions
│
└── Search (Mobile + Desktop)
```

---

## Troubleshooting

> [!TIP]
> Most login issues can be fixed by deleting your `/sessions` folder and redeploying the script.

> [!TIP]
> If Modern UI tasks aren't being detected, ensure `headless: false` for debugging, then switch back to `true` for production.

---

## Disclaimer

Use at your own risk.  
Automation of Microsoft Rewards may lead to account suspension or bans.  
This software is provided for educational purposes only.  
The authors are not responsible for any actions taken by Microsoft.
