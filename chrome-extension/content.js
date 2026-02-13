(function () {
    'use strict';

    const host = window.location.hostname;
    const isChatGptHost = host.includes('chatgpt.com') || host.includes('openai.com');
    const isNotebookLmHost = host.includes('notebooklm.google.com');
    const platformName = isNotebookLmHost ? 'NotebookLM' : (isChatGptHost ? 'ChatGPT' : 'Gemini');

    // Helper: Get config from storage
    async function getConfig() {
        return new Promise((resolve) => {
            chrome.storage.local.get(
                ['notionKey', 'notionParentId', 'notionParentType', 'obsidianUrl', 'obsidianKey'],
                (items) => {
                resolve(items);
                }
            );
        });
    }

    /**
     * Advanced Post-processing for Obsidian
     */
    function postProcessForObsidian(md) {
        // 1. Unescape backslashes before markdown symbols
        md = md.replace(/\\([$_\*#])/g, '$1');

        // 2. [WHITESPACE LINE CLEANUP] Convert lines with only spaces/tabs to empty lines
        md = md.replace(/\n[ \t]+\n/g, '\n\n');

        // 3. [NEWLINE COMPRESSION] Normalize excessive newlines (3+ -> 2)
        md = md.replace(/\n{3,}/g, '\n\n');

        // 3.2. [HEADER SPACING FIX] Reduce newlines AFTER headers (2 -> 1)
        md = md.replace(/^(#+ .*)\n\n/gm, '$1\n');

        // 3.5. [BLOCK MATH SPACING] Remove blank lines around block math $$
        md = md.replace(/\n\n(\$\$\n)/g, '\n$1');   // blank line before opening $$
        md = md.replace(/(\n\$\$)\n\n/g, '$1\n');   // blank line after closing $$

        // 4. [LIST SPACING FIX] Remove blank lines between consecutive list items
        md = md.replace(/^(\d+\..+)\n\n(?=\d+\.)/gm, '$1\n');
        md = md.replace(/^(-.+)\n\n(?=-\s)/gm, '$1\n');

        // 5. [HORIZONTAL RULE FIX] Force blank lines around standalone ---
        md = md.replace(/^(.*\S.*)(\n)(---)\s*$/gm, '$1\n\n$3');  // text\n--- -> text\n\n---
        md = md.replace(/^(---)\s*\n(\S)/gm, '$1\n$2');           // ---\ntext -> ---\ntext

        // 5.5. [MATH-HR GUARD] Ensure blank line between closing $$ and ---
        md = md.replace(/^(\$\$)\s*\n(---)/gm, '$1\n\n$2');

        // 6. [BOLD FALLBACK] Convert any remaining ** to __
        md = md.replace(/\*\*/g, '__');

        // 7. [BOLD SPACING FALLBACK] Ensure closing __ has space before special chars
        md = md.replace(/(\S)__([^\s\w])/g, '$1__ $2');

        // 8. Cleanup: Consolidate multiple spaces (but not newlines)
        md = md.replace(/ {2,}/g, ' ');

        const now = new Date().toISOString();
        return `---\ndate: ${now}\nsource: ${platformName}\n---\n\n${md}`;
    }

    function getMessageBlocks() {
        if (host.includes('gemini.google.com')) {
            return Array.from(document.querySelectorAll('message-content'));
        }

        if (isNotebookLmHost) {
            const selectors = [
                'main [data-testid*="response"]',
                'main [class*="response"]',
                'main [class*="answer"]',
                'main article'
            ];

            const blockSet = new Set();
            selectors.forEach((selector) => {
                document.querySelectorAll(selector).forEach((el) => blockSet.add(el));
            });

            const candidates = Array.from(blockSet).filter((node) => {
                const textLength = (node.innerText || '').trim().length;
                return textLength > 80;
            });
            return candidates.filter((node) => !candidates.some((other) => other !== node && node.contains(other)));
        }

        const selectors = [
            'div[data-message-author-role="assistant"]',
            'article[data-testid^="conversation-turn-"][data-testid$="-assistant"]',
            'main article[data-testid*="assistant"]'
        ];

        const blockSet = new Set();
        selectors.forEach((selector) => {
            document.querySelectorAll(selector).forEach((el) => blockSet.add(el));
        });

        const candidates = Array.from(blockSet);
        return candidates.filter((node) => !candidates.some((other) => other !== node && node.contains(other)));
    }

    function isEligibleBlock(block) {
        if (!block) return false;
        if (block.querySelector('.kb-btn-wrapper')) return false;
        if (block.closest('form')) return false;

        const text = (block.innerText || '').trim();
        return text.length > 0;
    }

    function getConfiguredMarkdown(block, target) {
        const isObsidian = target === 'Obsidian';
        // TurndownService is globally available from turndown.js
        const ts = new TurndownService({
            headingStyle: 'atx',
            codeBlockStyle: 'fenced',
            hr: '---',
            bulletListMarker: '-',
            strongDelimiter: isObsidian ? '__' : '**'
        });

        // turndownPluginGfm is globally available
        if (typeof turndownPluginGfm !== 'undefined') ts.use(turndownPluginGfm.gfm);
        ts.escape = (s) => s;

        ts.addRule('math', {
            filter: (n) => n.classList.contains('math-block') || n.classList.contains('math-inline') || n.tagName === 'MATHEMATICS',
            replacement: (c, n) => {
                const math = n.getAttribute('data-math') || n.textContent;
                const isBlock = n.classList.contains('math-block') || n.tagName === 'DIV';
                return isBlock ? `\n$$\n${math.trim()}\n$$\n` : `$${math.trim()}$`;
            }
        });

        if (isObsidian) {
            ts.addRule('obsidianBold', {
                filter: ['strong', 'b'],
                replacement: (content, node) => {
                    if (!content.trim()) return content;
                    const trimmed = content.trim();
                    let prefix = '';
                    let suffix = '';
                    const prev = node.previousSibling;
                    const next = node.nextSibling;
                    if (prev) {
                        const t = prev.textContent || '';
                        if (/[\p{L}\p{N}]$/u.test(t)) prefix = ' ';
                    }
                    if (next) {
                        const t = next.textContent || '';
                        if (/^[^\s\w]/.test(t)) suffix = ' ';
                    }
                    return `${prefix}__${trimmed}__${suffix}`;
                }
            });
        }

        const clone = block.cloneNode(true);
        const btns = clone.querySelector('.kb-btn-wrapper');
        if (btns) btns.remove();

        let md = ts.turndown(clone);
        if (isObsidian) md = postProcessForObsidian(md);

        return md;
    }

    function injectButtons() {
        const blocks = getMessageBlocks();
        blocks.forEach(block => {
            if (!isEligibleBlock(block)) return;
            const wrapper = document.createElement('div');
            wrapper.className = 'kb-btn-wrapper';
            wrapper.style = 'display: flex; gap: 8px; margin-top: 15px; padding-top: 10px; border-top: 1px solid #eee;';
            const nBtn = createBtn('Send to Notion', '#000');
            const oBtn = createBtn('Send to Obsidian', '#483699');
            nBtn.onclick = () => handleTransfer(block, 'Notion');
            oBtn.onclick = () => handleTransfer(block, 'Obsidian');
            wrapper.append(nBtn, oBtn);
            block.append(wrapper);
        });
    }

    function createBtn(txt, bg) {
        const b = document.createElement('button');
        b.innerText = txt;
        b.style = `padding: 6px 14px; cursor: pointer; background: ${bg}; color: #fff; border: none; border-radius: 6px; font-weight: bold; font-size: 11px;`;
        return b;
    }

    async function handleTransfer(block, target) {
        const title = window.prompt(`Title for ${target}:`, `${platformName} Response`);
        if (!title) return;

        const config = await getConfig();
        const configUrl = target === 'Obsidian' ? config.obsidianUrl : '';
        const configKey = target === 'Obsidian' ? config.obsidianKey : config.notionKey;

        if (target === 'Obsidian' && !configUrl) {
            alert('Please configure Obsidian URL in extension settings.');
            return;
        }
        if (target === 'Notion' && !config.notionKey) {
            alert('Please configure Notion Integration Token in extension settings.');
            return;
        }
        if (target === 'Notion' && !config.notionParentId) {
            alert('Please configure Notion Parent ID in extension settings.');
            return;
        }

        const md = getConfiguredMarkdown(block, target);
        const isObs = target === 'Obsidian';

        // Prepare request data
        const requestData = {
            action: isObs ? 'proxyRequest' : 'sendToNotion',
            method: isObs ? "PUT" : "POST",
            url: isObs ? `${configUrl}/${encodeURIComponent(title)}.md` : configUrl,
            data: isObs ? md : { title, content: md },
            headers: {
                "Content-Type": isObs ? "text/markdown; charset=utf-8" : "application/json",
                [isObs ? "Authorization" : "X-API-Key"]: isObs ? `Bearer ${configKey}` : configKey
            },
            // Metadata for specific handlers
            title: title,
            content: md,
            config: {
                notionKey: configKey,
                notionParentId: config.notionParentId,
                notionParentType: config.notionParentType || 'auto'
            }
        };

        chrome.runtime.sendMessage(requestData, (response) => {
            if (response && response.success) {
                alert(`✅ Sent to ${target}`);
            } else {
                alert(`❌ Error: ${response ? response.error : 'Unknown error'}`);
            }
        });
    }

    setInterval(injectButtons, 2000);
})();
