import type { Page } from 'patchright'
import type { MicrosoftRewardsBot } from '../index'
import { errMsg } from '../util/Utils'

/**
 * ModernUIWorkers handles the new Microsoft Rewards UI (April 2026+)
 *
 * Dashboard (/dashboard) sections:
 *   - "Your progress": expand (green) → shows streak/bonus info
 *   - "Daily set": expand → click each card to earn points
 *   - "Your activity": do NOT expand (no earnable points)
 *   - "Achievements": do NOT expand (no earnable points)
 *
 * Earn (/earn) sections:
 *   - "Keep earning": click each card WITH points badge (+5, +10, etc.)
 *   - Skip cards with "Silver level required" or no points badge
 *   - MUST click the card element (not visit URL) to trigger tracking
 *
 * DOM structure (April 2026):
 *   - Card title: <p class="text-globalBody2Strong">
 *   - Points badge: <p class="text-statusInformativeTintFg"> containing "+5", "+10"
 *   - Locked indicator: text "Silver level required" or lock icon
 *   - Expand button: button[slot="trigger"] or button[aria-expanded]
 */

interface CardInfo {
    index: number
    title: string
    points: string
    completed?: boolean
    href?: string
}

interface MissionInfo {
    index: number
    title: string
    points: string
    totalTasks: number
    completedTasks: number
    href: string
}

export class ModernUIWorkers {
    private bot: MicrosoftRewardsBot

    constructor(bot: MicrosoftRewardsBot) {
        this.bot = bot
    }

    private async closeAllExtraTabs(page: Page): Promise<void> {
        try {
            const context = page.context()
            const pages = context.pages()

            if (pages.length <= 1) return

            for (const p of pages) {
                if (p !== page) {
                    await p.close().catch(() => {})
                }
            }

            if (pages.length > 1) {
                this.bot.logger.debug(this.bot.isMobile, 'MODERN-UI', `Closed ${pages.length - 1} extra tab(s)`)
            }
        } catch (error) {
            this.bot.logger.debug(this.bot.isMobile, 'MODERN-UI', `Error closing extra tabs: ${errMsg(error)}`)
        }
    }

    async expandDashboardSection(page: Page, sectionHeading: string): Promise<boolean> {
        try {
            const expanded = await page.evaluate((heading: string) => {
                const headings = document.querySelectorAll('h2, h3')
                for (const h of headings) {
                    if (h.textContent?.trim()?.startsWith(heading)) {
                        const section = h.closest('section') || h.parentElement?.parentElement
                        if (!section) continue

                        const btn =
                            section.querySelector('button[aria-expanded]') ||
                            section.querySelector('button[slot="trigger"]') ||
                            section.querySelector(`button[aria-label="${heading}"]`)

                        if (btn) {
                            const state = btn.getAttribute('aria-expanded')
                            if (state === 'false') {
                                ;(btn as HTMLElement).click()
                                return 'expanded'
                            }
                            return 'already-expanded'
                        }
                    }
                }
                return 'not-found'
            }, sectionHeading)

            if (expanded === 'expanded') {
                this.bot.logger.info(this.bot.isMobile, 'MODERN-UI', `Expanded section: "${sectionHeading}"`)
                await this.bot.utils.wait(1500)
                return true
            } else if (expanded === 'already-expanded') {
                this.bot.logger.debug(this.bot.isMobile, 'MODERN-UI', `Section already expanded: "${sectionHeading}"`)
                return true
            }

            this.bot.logger.warn(this.bot.isMobile, 'MODERN-UI', `Section not found: "${sectionHeading}"`)
            return false
        } catch (error) {
            this.bot.logger.error(
                this.bot.isMobile,
                'MODERN-UI',
                `Error expanding "${sectionHeading}": ${errMsg(error)}`
            )
            return false
        }
    }

    /**
     * Scroll to and click a card inside a section, handle new tab, close extras.
     * Shared by doDailySet, doKeepEarning, and their verification retries.
     */
    private async clickCardInSection(page: Page, sectionHeading: string, card: CardInfo, tag: string): Promise<void> {
        await this.closeAllExtraTabs(page)

        // Scroll to card
        await page.evaluate(
            ({ heading, cardIndex }: { heading: string; cardIndex: number }) => {
                const headings = document.querySelectorAll('h2, h3')
                for (const h of headings) {
                    if (h.textContent?.trim()?.startsWith(heading)) {
                        const section = h.closest('section') || h.parentElement?.parentElement
                        if (section) {
                            const target = section.querySelectorAll('a[target="_blank"]')[cardIndex] as HTMLElement
                            if (target) target.scrollIntoView({ behavior: 'smooth', block: 'center' })
                        }
                        break
                    }
                }
            },
            { heading: sectionHeading, cardIndex: card.index }
        )

        await this.bot.utils.wait(1000)

        // Click card
        await page.evaluate(
            ({ heading, cardIndex }: { heading: string; cardIndex: number }) => {
                const headings = document.querySelectorAll('h2, h3')
                for (const h of headings) {
                    if (h.textContent?.trim()?.startsWith(heading)) {
                        const section = h.closest('section') || h.parentElement?.parentElement
                        if (section) {
                            const target = section.querySelectorAll('a[target="_blank"]')[
                                cardIndex
                            ] as HTMLAnchorElement
                            if (target) target.click()
                        }
                        break
                    }
                }
            },
            { heading: sectionHeading, cardIndex: card.index }
        )

        this.bot.logger.info(this.bot.isMobile, tag, `✔ Clicked: "${card.title}" (${card.points})`, 'green')

        await this.bot.utils.wait(3000)

        const newTab = await this.bot.browser.utils.getLatestTab(page)
        if (newTab !== page) {
            await newTab.waitForLoadState('domcontentloaded').catch(() => {})
            await this.bot.utils.wait(this.bot.utils.randomDelay(3000, 6000))
        }

        await this.closeAllExtraTabs(page)
        await this.bot.utils.wait(this.bot.utils.randomDelay(2000, 5000))
    }

    /**
     * Process a list of cards: click each, handle errors, close tabs on failure.
     */
    private async processCards(page: Page, cards: CardInfo[], sectionHeading: string, tag: string): Promise<void> {
        for (const card of cards) {
            try {
                await this.clickCardInSection(page, sectionHeading, card, tag)
            } catch (error) {
                this.bot.logger.error(this.bot.isMobile, tag, `Error on "${card.title}": ${errMsg(error)}`)
                await this.closeAllExtraTabs(page)
            }
        }
    }

    /**
     * Navigate to a page, wait for content, dismiss messages.
     */
    private async navigateAndPrepare(page: Page, url: string): Promise<void> {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 })
        await this.bot.utils.wait(3000)
        await this.bot.browser.utils.tryDismissAllMessages(page)
    }

    /**
     * Complete Daily Set tasks on /dashboard
     */
    async doDailySet(page: Page): Promise<void> {
        this.bot.logger.info(this.bot.isMobile, 'MODERN-DAILY-SET', 'Starting Daily Set (Modern UI)')

        try {
            await this.navigateAndPrepare(page, 'https://rewards.bing.com/dashboard')

            await this.expandDashboardSection(page, 'Your progress')

            const expanded = await this.expandDashboardSection(page, 'Daily set')
            if (!expanded) {
                this.bot.logger.warn(this.bot.isMobile, 'MODERN-DAILY-SET', 'Could not expand Daily Set section')
                return
            }

            await this.bot.utils.wait(2000)

            const cards = await this.findDailySetCards(page)
            const uncompletedCards = cards.filter(c => !c.completed && c.points)

            this.bot.logger.info(
                this.bot.isMobile,
                'MODERN-DAILY-SET',
                `Found ${cards.length} cards, ${uncompletedCards.length} uncompleted with points`
            )

            if (!uncompletedCards.length) {
                this.bot.logger.info(this.bot.isMobile, 'MODERN-DAILY-SET', 'All Daily Set items already completed')
                return
            }

            await this.processCards(page, uncompletedCards, 'Daily set', 'MODERN-DAILY-SET')

            await this.verifyAndRetry(page, 'Daily set', 'MODERN-DAILY-SET', 'https://rewards.bing.com/dashboard', () =>
                this.findDailySetCards(page).then(c => c.filter(x => !x.completed && x.points))
            )

            this.bot.logger.info(this.bot.isMobile, 'MODERN-DAILY-SET', 'Daily Set completed')
        } catch (error) {
            this.bot.logger.error(this.bot.isMobile, 'MODERN-DAILY-SET', `Error: ${errMsg(error)}`)
            await this.closeAllExtraTabs(page)
        }
    }

    private async findDailySetCards(page: Page): Promise<CardInfo[]> {
        return await page.evaluate(() => {
            const result: { index: number; title: string; points: string; completed: boolean }[] = []
            const headings = document.querySelectorAll('h2, h3')

            for (const h of headings) {
                if (h.textContent?.trim()?.startsWith('Daily set')) {
                    const section = h.closest('section') || h.parentElement?.parentElement
                    if (!section) continue

                    const cardLinks = section.querySelectorAll('a[target="_blank"]')
                    cardLinks.forEach((card, i) => {
                        const anchor = card as HTMLAnchorElement
                        const fullText = anchor.textContent?.trim() || ''

                        const titleEl = anchor.querySelector('p[class*="Body2Strong"], p[class*="body2Strong"]')
                        const title = titleEl?.textContent?.trim() || fullText.substring(0, 60)

                        let points = ''
                        anchor.querySelectorAll('span, div, p').forEach(el => {
                            const text = el.textContent?.trim() || ''
                            if (/^\+\d+$/.test(text)) points = text
                        })

                        const isCompleted =
                            fullText.includes('Completed') ||
                            !!anchor.querySelector('[class*="statusSuccessRewards"], [class*="StatusSuccess"]')

                        result.push({ index: i, title, points, completed: isCompleted })
                    })
                    break
                }
            }
            return result
        })
    }

    /**
     * Generic verify-and-retry: reload page, re-expand section, find remaining cards, retry.
     */
    private async verifyAndRetry(
        page: Page,
        sectionHeading: string,
        tag: string,
        url: string,
        findRemaining: () => Promise<CardInfo[]>
    ): Promise<void> {
        try {
            this.bot.logger.info(this.bot.isMobile, tag, `Verifying ${sectionHeading} completion...`)

            await this.closeAllExtraTabs(page)
            await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 })
            await this.bot.utils.wait(3000)

            if (sectionHeading === 'Daily set') {
                await this.expandDashboardSection(page, sectionHeading)
                await this.bot.utils.wait(2000)
            } else {
                await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
                await this.bot.utils.wait(2000)
                await page.evaluate(() => window.scrollTo(0, 0))
                await this.bot.utils.wait(1000)
            }

            const remaining = await findRemaining()

            if (remaining.length === 0) {
                this.bot.logger.info(
                    this.bot.isMobile,
                    tag,
                    `✔ Verification passed: All ${sectionHeading} tasks completed`,
                    'green'
                )
            } else {
                this.bot.logger.warn(
                    this.bot.isMobile,
                    tag,
                    `Verification: ${remaining.length} task(s) still remaining: ${remaining.map(c => `${c.title}(${c.points})`).join(', ')}`
                )

                for (const card of remaining) {
                    try {
                        await this.clickCardInSection(page, sectionHeading, card, tag)
                        this.bot.logger.info(
                            this.bot.isMobile,
                            tag,
                            `✔ Retry clicked: "${card.title}" (${card.points})`,
                            'green'
                        )
                    } catch (error) {
                        this.bot.logger.error(
                            this.bot.isMobile,
                            tag,
                            `Retry error on "${card.title}": ${errMsg(error)}`
                        )
                        await this.closeAllExtraTabs(page)
                    }
                }
            }
        } catch (error) {
            this.bot.logger.error(this.bot.isMobile, tag, `Verification error: ${errMsg(error)}`)
        }
    }

    /**
     * Complete "Keep earning" tasks on /earn
     */
    async doKeepEarning(page: Page): Promise<void> {
        this.bot.logger.info(this.bot.isMobile, 'MODERN-KEEP-EARNING', 'Starting Keep Earning (Modern UI)')

        try {
            await this.navigateAndPrepare(page, 'https://rewards.bing.com/earn')

            // Scroll to load lazy content
            await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
            await this.bot.utils.wait(2000)
            await page.evaluate(() => window.scrollTo(0, 0))
            await this.bot.utils.wait(1000)

            const earnableCards = await this.findKeepEarningCards(page)

            this.bot.logger.info(
                this.bot.isMobile,
                'MODERN-KEEP-EARNING',
                `Found ${earnableCards.length} earnable card(s)`
            )

            if (!earnableCards.length) {
                this.bot.logger.info(this.bot.isMobile, 'MODERN-KEEP-EARNING', 'No earnable cards found')
                return
            }

            await this.processCards(page, earnableCards, 'Keep earning', 'MODERN-KEEP-EARNING')

            await this.verifyAndRetry(
                page,
                'Keep earning',
                'MODERN-KEEP-EARNING',
                'https://rewards.bing.com/earn',
                () => this.findKeepEarningCards(page)
            )

            this.bot.logger.info(this.bot.isMobile, 'MODERN-KEEP-EARNING', 'Keep Earning completed')
        } catch (error) {
            this.bot.logger.error(this.bot.isMobile, 'MODERN-KEEP-EARNING', `Error: ${errMsg(error)}`)
            await this.closeAllExtraTabs(page)
        }
    }

    private async findKeepEarningCards(page: Page): Promise<CardInfo[]> {
        return await page.evaluate(() => {
            const result: { index: number; title: string; points: string; href: string }[] = []

            const headings = document.querySelectorAll('h2, h3')
            let keepEarningSection: Element | null = null

            for (const h of headings) {
                if (h.textContent?.trim()?.startsWith('Keep earning')) {
                    keepEarningSection = h.closest('section') || h.parentElement?.parentElement || null
                    break
                }
            }

            if (!keepEarningSection) return result

            const allCards = keepEarningSection.querySelectorAll('a[target="_blank"]')

            allCards.forEach((card, i) => {
                const anchor = card as HTMLAnchorElement
                const fullText = anchor.textContent?.trim() || ''

                if (fullText.includes('Completed')) return
                if (anchor.querySelector('[class*="statusSuccessRewards"], [class*="StatusSuccess"]')) return
                if (fullText.includes('level required') || fullText.includes('locked')) return

                // Skip mission cards (handled by doMissions)
                if (/\d+\/\d+\s+tasks?/i.test(fullText)) return

                // Method 1: Badge-style points (+5, +10, +15, +20)
                let pointsText = ''
                anchor.querySelectorAll('span, div, p').forEach(el => {
                    const text = el.textContent?.trim() || ''
                    if (/^\+\d+$/.test(text)) pointsText = text
                })

                // Method 2: Description-style points ("earn 30 points", "pick up 20 points")
                if (!pointsText) {
                    const descEl = anchor.querySelector('p[class*="Secondary"], p[class*="secondary"]')
                    const descText = descEl?.textContent?.trim() || fullText
                    const descMatch = descText.match(
                        /(?:earn|pick\s*up|get|collect)\s+(\d+)\s+(?:bonus\s+)?(?:Rewards\s+)?points?/i
                    )
                    if (descMatch) {
                        pointsText = `+${descMatch[1]}`
                    }
                }

                // Method 3: Fallback - any "N points" pattern
                if (!pointsText) {
                    const match = fullText.match(/(\d+)\s+points?\b/i)
                    if (match && match[1] && parseInt(match[1]) > 0 && parseInt(match[1]) <= 500) {
                        if (!fullText.includes('lifetime points')) {
                            pointsText = `+${match[1]}`
                        }
                    }
                }

                if (!pointsText) return

                const titleEl = anchor.querySelector('p[class*="Body2Strong"], p[class*="body2Strong"]')
                const title = titleEl?.textContent?.trim()?.substring(0, 60) || ''
                const fallbackTitle = title || fullText.replace(pointsText, '').trim().substring(0, 60)

                result.push({
                    index: i,
                    title: fallbackTitle,
                    points: pointsText,
                    href: anchor.href
                })
            })

            return result
        })
    }

    /**
     * Complete mission/challenge cards on /earn page.
     * These are cards with sub-tasks (e.g., "0/4 tasks") that require
     * clicking into the mission detail page to complete each task.
     * Missions change periodically (every few days).
     */
    async doMissions(page: Page): Promise<void> {
        this.bot.logger.info(this.bot.isMobile, 'MODERN-MISSIONS', 'Starting Missions (Modern UI)')

        try {
            await this.navigateAndPrepare(page, 'https://rewards.bing.com/earn')

            await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
            await this.bot.utils.wait(2000)
            await page.evaluate(() => window.scrollTo(0, 0))
            await this.bot.utils.wait(1000)

            const missions = await this.findMissionCards(page)

            this.bot.logger.info(this.bot.isMobile, 'MODERN-MISSIONS', `Found ${missions.length} mission card(s)`)

            if (!missions.length) {
                this.bot.logger.info(this.bot.isMobile, 'MODERN-MISSIONS', 'No incomplete missions found')
                return
            }

            for (const mission of missions) {
                try {
                    this.bot.logger.info(
                        this.bot.isMobile,
                        'MODERN-MISSIONS',
                        `Processing mission: "${mission.title}" (${mission.points}) - ${mission.completedTasks}/${mission.totalTasks} tasks`
                    )

                    await this.completeMission(page, mission)
                } catch (error) {
                    this.bot.logger.error(
                        this.bot.isMobile,
                        'MODERN-MISSIONS',
                        `Error on mission "${mission.title}": ${errMsg(error)}`
                    )
                    await this.closeAllExtraTabs(page)
                }
            }

            // Verify: reload /earn page and check for remaining missions
            await this.verifyMissions(page)

            this.bot.logger.info(this.bot.isMobile, 'MODERN-MISSIONS', 'Missions completed')
        } catch (error) {
            this.bot.logger.error(this.bot.isMobile, 'MODERN-MISSIONS', `Error: ${errMsg(error)}`)
            await this.closeAllExtraTabs(page)
        }
    }

    private async findMissionCards(page: Page): Promise<MissionInfo[]> {
        return await page.evaluate(() => {
            const result: {
                index: number
                title: string
                points: string
                totalTasks: number
                completedTasks: number
                href: string
            }[] = []

            // Scan all sections on /earn page
            const allCards = document.querySelectorAll('a[target="_blank"]')

            allCards.forEach((card, i) => {
                const anchor = card as HTMLAnchorElement
                const fullText = anchor.textContent?.trim() || ''

                // Already fully completed
                if (anchor.querySelector('[class*="statusSuccessRewards"], [class*="StatusSuccess"]')) return

                // Detect mission cards by "X/Y tasks" pattern
                const taskMatch = fullText.match(/(\d+)\/(\d+)\s+tasks?/i)
                if (!taskMatch) return

                const completedTasks = parseInt(taskMatch[1] ?? '0')
                const totalTasks = parseInt(taskMatch[2] ?? '0')

                // Skip already completed missions
                if (completedTasks >= totalTasks) return

                // Extract points
                let pointsText = ''
                anchor.querySelectorAll('span, div, p').forEach(el => {
                    const text = el.textContent?.trim() || ''
                    if (/^\+\d+$/.test(text)) pointsText = text
                })

                if (!pointsText) {
                    const match = fullText.match(/(\d+)\s+points?\b/i)
                    if (match && match[1] && parseInt(match[1]) > 0) {
                        pointsText = `+${match[1]}`
                    }
                }

                // Extract title
                const titleEl = anchor.querySelector('p[class*="Body2Strong"], p[class*="body2Strong"]')
                const title =
                    titleEl?.textContent?.trim()?.substring(0, 60) ||
                    fullText
                        .replace(/\d+\/\d+\s+tasks?/i, '')
                        .replace(/\+\d+/, '')
                        .trim()
                        .substring(0, 60)

                result.push({
                    index: i,
                    title: title || 'Unknown Mission',
                    points: pointsText || '+0',
                    totalTasks,
                    completedTasks,
                    href: anchor.href
                })
            })

            return result
        })
    }

    private async completeMission(page: Page, mission: MissionInfo): Promise<void> {
        await this.closeAllExtraTabs(page)

        // Click the mission card to open mission detail page
        const clicked = await page.evaluate((missionHref: string) => {
            const links = document.querySelectorAll('a[target="_blank"]')
            for (const link of links) {
                if ((link as HTMLAnchorElement).href === missionHref) {
                    ;(link as HTMLElement).click()
                    return true
                }
            }
            return false
        }, mission.href)

        if (!clicked) {
            // Fallback: click by index on all cards
            await page.evaluate((idx: number) => {
                const cards = document.querySelectorAll('a[target="_blank"]')
                const target = cards[idx] as HTMLElement
                if (target) target.click()
            }, mission.index)
        }

        await this.bot.utils.wait(3000)

        // Get the mission detail page (new tab)
        const missionPage = await this.bot.browser.utils.getLatestTab(page)

        if (missionPage !== page) {
            await missionPage.waitForLoadState('domcontentloaded').catch(() => {})
            await this.bot.utils.wait(3000)

            await this.completeMissionTasks(missionPage, mission.title)

            await this.closeAllExtraTabs(page)
        } else {
            // Mission opened in same tab - check if URL changed
            await this.bot.utils.wait(2000)
            const currentUrl = page.url()

            if (
                currentUrl.includes('/missions') ||
                currentUrl.includes('/challenges') ||
                currentUrl !== 'https://rewards.bing.com/earn'
            ) {
                await this.completeMissionTasks(page, mission.title)

                // Navigate back to /earn
                await page.goto('https://rewards.bing.com/earn', {
                    waitUntil: 'domcontentloaded',
                    timeout: 30000
                })
                await this.bot.utils.wait(2000)
            } else {
                this.bot.logger.warn(
                    this.bot.isMobile,
                    'MODERN-MISSIONS',
                    `Mission "${mission.title}" did not navigate to detail page`
                )
            }
        }

        await this.bot.utils.wait(this.bot.utils.randomDelay(2000, 5000))
    }

    private async completeMissionTasks(missionPage: Page, missionTitle: string): Promise<void> {
        this.bot.logger.info(
            this.bot.isMobile,
            'MODERN-MISSIONS',
            `On mission detail page for "${missionTitle}": ${missionPage.url()}`
        )

        // Dismiss any popups on mission page
        await this.bot.browser.utils.tryDismissAllMessages(missionPage)
        await this.bot.utils.wait(1000)

        // Scroll to load all content
        await missionPage.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
        await this.bot.utils.wait(1500)
        await missionPage.evaluate(() => window.scrollTo(0, 0))
        await this.bot.utils.wait(1000)

        const maxAttempts = 3
        for (let attempt = 0; attempt < maxAttempts; attempt++) {
            const tasks = await this.findMissionSubTasks(missionPage)

            if (!tasks.length) {
                if (attempt === 0) {
                    this.bot.logger.info(
                        this.bot.isMobile,
                        'MODERN-MISSIONS',
                        `All tasks already completed for "${missionTitle}"`
                    )
                }
                break
            }

            this.bot.logger.info(
                this.bot.isMobile,
                'MODERN-MISSIONS',
                `Found ${tasks.length} incomplete task(s) for "${missionTitle}" (attempt ${attempt + 1})`
            )

            for (const task of tasks) {
                try {
                    await this.clickMissionSubTask(missionPage, task)
                } catch (error) {
                    this.bot.logger.error(
                        this.bot.isMobile,
                        'MODERN-MISSIONS',
                        `Error on sub-task "${task.title}": ${errMsg(error)}`
                    )
                    await this.closeAllExtraTabs(missionPage)
                }
            }

            // Reload mission page to check progress
            await missionPage.reload({ waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {})
            await this.bot.utils.wait(3000)
        }
    }

    private async findMissionSubTasks(page: Page): Promise<CardInfo[]> {
        return await page.evaluate(() => {
            const result: { index: number; title: string; points: string; completed: boolean }[] = []

            // Mission detail pages can have various layouts:
            // 1. Card links (a[target="_blank"]) - similar to keep earning
            // 2. Task list items with clickable elements
            // 3. Button-based tasks

            // Strategy 1: Find clickable task cards (anchors)
            const taskLinks = document.querySelectorAll(
                'a[target="_blank"], a[href*="bing.com"], a[href*="microsoft.com"]'
            )
            const seen = new Set<string>()

            taskLinks.forEach((link, i) => {
                const anchor = link as HTMLAnchorElement
                const fullText = anchor.textContent?.trim() || ''

                // Skip if already completed
                const isCompleted =
                    fullText.includes('Completed') ||
                    !!anchor.querySelector('[class*="statusSuccess"], [class*="StatusSuccess"], [class*="checkmark"]')

                if (isCompleted) return

                // Skip navigation links and non-task elements
                if (anchor.href.includes('/earn') && !anchor.href.includes('offerId')) return
                if (anchor.href.includes('/dashboard') && !anchor.href.includes('offerId')) return
                if (fullText.length < 3) return

                // Deduplicate by href
                if (seen.has(anchor.href)) return
                seen.add(anchor.href)

                const titleEl = anchor.querySelector('p[class*="Body2Strong"], p[class*="body2Strong"], h3, h4')
                const title = titleEl?.textContent?.trim()?.substring(0, 60) || fullText.substring(0, 60)

                let points = ''
                anchor.querySelectorAll('span, div, p').forEach(el => {
                    const text = el.textContent?.trim() || ''
                    if (/^\+\d+$/.test(text)) points = text
                })

                result.push({
                    index: i,
                    title,
                    points: points || '',
                    completed: false
                })
            })

            // Strategy 2: Find clickable task buttons/items if no links found
            if (result.length === 0) {
                const taskItems = document.querySelectorAll(
                    'button:not([aria-expanded]), [role="button"], [class*="task"], [class*="card"]'
                )

                taskItems.forEach((item, i) => {
                    const el = item as HTMLElement
                    const fullText = el.textContent?.trim() || ''

                    if (fullText.includes('Completed')) return
                    if (el.querySelector('[class*="statusSuccess"], [class*="checkmark"]')) return
                    if (fullText.length < 3 || fullText.length > 200) return

                    // Only include elements that look like tasks
                    const hasPointsIndicator = /\+\d+|\d+\s+points?/i.test(fullText)
                    const hasTaskIndicator = el.closest('[class*="task"], [class*="card"], [class*="promo"]')

                    if (!hasPointsIndicator && !hasTaskIndicator) return

                    let points = ''
                    el.querySelectorAll('span, div, p').forEach(child => {
                        const text = child.textContent?.trim() || ''
                        if (/^\+\d+$/.test(text)) points = text
                    })

                    result.push({
                        index: i,
                        title: fullText.substring(0, 60),
                        points: points || '',
                        completed: false
                    })
                })
            }

            return result
        })
    }

    private async clickMissionSubTask(page: Page, task: CardInfo): Promise<void> {
        await this.closeAllExtraTabs(page)

        // Try clicking the task element
        await page.evaluate((taskIndex: number) => {
            // First try anchor links
            const links = document.querySelectorAll('a[target="_blank"], a[href*="bing.com"], a[href*="microsoft.com"]')
            const seen = new Set<string>()
            let clickIdx = 0

            for (const link of links) {
                const anchor = link as HTMLAnchorElement
                const fullText = anchor.textContent?.trim() || ''

                if (fullText.includes('Completed')) continue
                if (anchor.querySelector('[class*="statusSuccess"], [class*="StatusSuccess"], [class*="checkmark"]'))
                    continue
                if (anchor.href.includes('/earn') && !anchor.href.includes('offerId')) continue
                if (anchor.href.includes('/dashboard') && !anchor.href.includes('offerId')) continue
                if (fullText.length < 3) continue
                if (seen.has(anchor.href)) continue
                seen.add(anchor.href)

                if (clickIdx === taskIndex) {
                    anchor.scrollIntoView({ behavior: 'smooth', block: 'center' })
                    anchor.click()
                    return
                }
                clickIdx++
            }

            // Fallback: try button/task elements
            const taskItems = document.querySelectorAll(
                'button:not([aria-expanded]), [role="button"], [class*="task"], [class*="card"]'
            )
            clickIdx = 0
            for (const item of taskItems) {
                const el = item as HTMLElement
                const fullText = el.textContent?.trim() || ''

                if (fullText.includes('Completed')) continue
                if (el.querySelector('[class*="statusSuccess"], [class*="checkmark"]')) continue
                if (fullText.length < 3 || fullText.length > 200) continue

                const hasPointsIndicator = /\+\d+|\d+\s+points?/i.test(fullText)
                const hasTaskIndicator = el.closest('[class*="task"], [class*="card"], [class*="promo"]')
                if (!hasPointsIndicator && !hasTaskIndicator) continue

                if (clickIdx === taskIndex) {
                    el.scrollIntoView({ behavior: 'smooth', block: 'center' })
                    el.click()
                    return
                }
                clickIdx++
            }
        }, task.index)

        this.bot.logger.info(
            this.bot.isMobile,
            'MODERN-MISSIONS',
            `✔ Clicked sub-task: "${task.title}" ${task.points ? `(${task.points})` : ''}`,
            'green'
        )

        await this.bot.utils.wait(3000)

        // Handle new tab that might have opened
        const newTab = await this.bot.browser.utils.getLatestTab(page)
        if (newTab !== page) {
            await newTab.waitForLoadState('domcontentloaded').catch(() => {})
            await this.bot.utils.wait(this.bot.utils.randomDelay(3000, 6000))
        }

        await this.closeAllExtraTabs(page)
        await this.bot.utils.wait(this.bot.utils.randomDelay(2000, 5000))
    }

    private async verifyMissions(page: Page): Promise<void> {
        try {
            this.bot.logger.info(this.bot.isMobile, 'MODERN-MISSIONS', 'Verifying mission completion...')

            await this.closeAllExtraTabs(page)
            await page.goto('https://rewards.bing.com/earn', {
                waitUntil: 'domcontentloaded',
                timeout: 30000
            })
            await this.bot.utils.wait(3000)

            await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
            await this.bot.utils.wait(2000)
            await page.evaluate(() => window.scrollTo(0, 0))
            await this.bot.utils.wait(1000)

            const remaining = await this.findMissionCards(page)

            if (remaining.length === 0) {
                this.bot.logger.info(
                    this.bot.isMobile,
                    'MODERN-MISSIONS',
                    '✔ Verification passed: All missions completed',
                    'green'
                )
            } else {
                this.bot.logger.warn(
                    this.bot.isMobile,
                    'MODERN-MISSIONS',
                    `Verification: ${remaining.length} mission(s) still remaining: ${remaining.map(m => `${m.title}(${m.completedTasks}/${m.totalTasks})`).join(', ')}`
                )

                // One more attempt on remaining missions
                for (const mission of remaining) {
                    try {
                        await this.completeMission(page, mission)
                    } catch (error) {
                        this.bot.logger.error(
                            this.bot.isMobile,
                            'MODERN-MISSIONS',
                            `Retry error on "${mission.title}": ${errMsg(error)}`
                        )
                        await this.closeAllExtraTabs(page)
                    }
                }
            }
        } catch (error) {
            this.bot.logger.error(this.bot.isMobile, 'MODERN-MISSIONS', `Verification error: ${errMsg(error)}`)
        }
    }
}
