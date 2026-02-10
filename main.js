// ==UserScript==
// @name         Gemini to Note (Notion & Obsidian Integrated)
// @namespace    http://tampermonkey.net/
// @version      7.1
// @description  V7.1: Multi-layer bold handling (DOM rule + delimiter fallback + regex catch-all)
// @author       Junseok Lee
// @match        https://gemini.google.com/*
// @grant        GM_xmlhttpRequest
// @connect      YOUR_NOTION_DOMAIN
// @connect      YOUR_OBSIDIAN_DOMAIN
// @require      https://unpkg.com/turndown/dist/turndown.js
// @require      https://unpkg.com/turndown-plugin-gfm/dist/turndown-plugin-gfm.js
// @run-at       document-idle
// ==/UserScript==

(function () {
    'use strict';

    const NOTION_CONF = { URL: "YOUR_NOTION_API_URL", KEY: "YOUR_NOTION_API_KEY" };
    const OBSIDIAN_CONF = { URL: "YOUR_OBSIDIAN_API_URL", KEY: "YOUR_OBSIDIAN_API_KEY" };

    /**
     * Advanced Post-processing for Obsidian
     */
    function postProcessForObsidian(md) {
        // 1. Unescape backslashes before markdown symbols
        md = md.replace(/\\([$_\*#])/g, '$1');

        // 2. [WHITESPACE LINE CLEANUP] Convert lines with only spaces/tabs to empty lines
        //    Prevents whitespace-only lines from bypassing newline compression
        md = md.replace(/\n[ \t]+\n/g, '\n\n');

        // 3. [NEWLINE COMPRESSION] Normalize excessive newlines (3+ → 2)
        //    MUST happen BEFORE horizontal rule fix so it doesn't undo the fix
        md = md.replace(/\n{3,}/g, '\n\n');

        // 3.5. [BLOCK MATH SPACING] Remove blank lines around block math $$
        //      Obsidian renders $$ correctly without surrounding blank lines
        md = md.replace(/\n\n(\$\$\n)/g, '\n$1');   // blank line before opening $$
        md = md.replace(/(\n\$\$)\n\n/g, '$1\n');   // blank line after closing $$

        // 4. [LIST SPACING FIX] Remove blank lines between consecutive list items
        //    Numbered lists: 1. item\n\n2. item → 1. item\n2. item
        //    Bulleted lists: - item\n\n- item → - item\n- item
        md = md.replace(/^(\d+\..+)\n\n(?=\d+\.)/gm, '$1\n');
        md = md.replace(/^(-.+)\n\n(?=-\s)/gm, '$1\n');

        // 5. [HORIZONTAL RULE FIX] Force blank lines around standalone ---
        //    Prevents --- from being interpreted as a Setext H2 heading
        //    Only targets lines that are exactly --- (not inside frontmatter or code)
        md = md.replace(/^(.*\S.*)(\n)(---)\s*$/gm, '$1\n\n$3');  // text\n--- → text\n\n---
        md = md.replace(/^(---)\s*\n(\S)/gm, '$1\n$2');           // ---\ntext → ---\ntext

        // 5.5. [MATH-HR GUARD] Ensure blank line between closing $$ and ---
        //      Without this, reducing math newlines would cause $$ \n --- → Setext heading
        md = md.replace(/^(\$\$)\s*\n(---)/gm, '$1\n\n$2');

        // 6. [BOLD FALLBACK] Convert any remaining ** to __
        //    Primary handling is by Turndown obsidianBold custom rule (DOM-based).
        //    This catches: literal ** in HTML text, or <strong> elements the custom rule missed.
        md = md.replace(/\*\*/g, '__');

        // 7. [BOLD SPACING FALLBACK] Ensure closing __ has space before special chars
        //    Only needed for ** → __ fallback cases; DOM-based cases already have proper spacing.
        //    e.g., word__) → word__ ), word__$ → word__ $
        md = md.replace(/(\S)__([^\s\w])/g, '$1__ $2');

        // 8. Cleanup: Consolidate multiple spaces (but not newlines)
        md = md.replace(/ {2,}/g, ' ');

        const now = new Date().toISOString();
        return `---\ndate: ${now}\nsource: Gemini\n---\n\n${md}`;
    }

    function getConfiguredMarkdown(block, target) {
        const isObsidian = target === 'Obsidian';
        const ts = new TurndownService({
            headingStyle: 'atx',
            codeBlockStyle: 'fenced',
            hr: '---',
            bulletListMarker: '-',
            strongDelimiter: isObsidian ? '__' : '**'
        });

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

        // For Obsidian: handle bold (__) with DOM context instead of fragile regex post-processing
        // Inspects sibling nodes to determine if spacing is needed around __ delimiters
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
                    // Space before opening __ if preceded by letter/digit (incl. CJK/Korean)
                    // e.g., 한국어<strong>bold</strong> → 한국어 __bold__
                    if (prev) {
                        const t = prev.textContent || '';
                        if (/[\p{L}\p{N}]$/u.test(t)) prefix = ' ';
                    }
                    // Space after closing __ if followed by punctuation/special char
                    // e.g., <strong>bold</strong>) → __bold__ )
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
        const blocks = document.querySelectorAll('message-content');
        blocks.forEach(block => {
            if (block.querySelector('.kb-btn-wrapper')) return;
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

    function handleTransfer(block, target) {
        const title = window.prompt(`Title for ${target}:`, "Gemini Response");
        if (!title) return;
        const md = getConfiguredMarkdown(block, target);
        const isObs = target === 'Obsidian';
        GM_xmlhttpRequest({
            method: isObs ? "PUT" : "POST",
            url: isObs ? `${OBSIDIAN_CONF.URL}/${encodeURIComponent(title)}.md` : NOTION_CONF.URL,
            data: isObs ? md : JSON.stringify({ title, content: md }),
            headers: { "Content-Type": isObs ? "text/markdown; charset=utf-8" : "application/json", [isObs ? "Authorization" : "X-API-Key"]: isObs ? `Bearer ${OBSIDIAN_CONF.KEY}` : NOTION_CONF.KEY },
            onload: (res) => alert(res.status < 300 ? `✅ Sent to ${target}` : `❌ Error: ${res.status}`)
        });
    }

    setInterval(injectButtons, 2000);
})();