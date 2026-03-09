// ==UserScript==
// @name         Scholar Show BibTeX + Copy
// @namespace    https://tampermonkey.net/
// @version      1.5.2
// @description  Add a Show Bib button on Google Scholar results, then copy BibTeX quickly.
// @author       likai
// @license      Apache-2.0
// @match        *://scholar.google.com/*
// @include      /^https?:\/\/scholar\.google\.[^/]+\/.*/
// @connect      scholar.google.com
// @connect      scholar.googleusercontent.com
// @grant        GM_setClipboard
// @grant        GM_xmlhttpRequest
// @run-at       document-end
// ==/UserScript==

(function () {
  "use strict";

  const STYLE_ID = "tm-scholar-bib-style";
  const BTN_CLASS = "tm-scholar-show-bib-btn";
  const PANEL_CLASS = "tm-scholar-bib-panel";
  const HIDDEN_CLASS = "tm-scholar-hidden";
  const MAX_VERSION_CANDIDATES = 12;

  let popupLock = false;

  injectStyles();
  attachButtons();
  setTimeout(() => attachButtons(document), 900);
  window.addEventListener("load", () => attachButtons(document));
  observeDomChanges();

  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;

    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      .${BTN_CLASS} {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        margin-left: 8px;
        padding: 4px 12px;
        border: 1px solid #dadce0;
        border-radius: 4px;
        background: #f8f9fa;
        color: #1a73e8 !important;
        font-size: 13px;
        line-height: 1.3;
        text-decoration: none !important;
        cursor: pointer;
      }

      .${BTN_CLASS}:hover {
        background: #eef3fd;
      }

      .${BTN_CLASS}.tm-disabled {
        opacity: 0.6;
        pointer-events: none;
      }

      .${PANEL_CLASS} {
        margin-top: 10px;
        border: 1px solid #dadce0;
        border-radius: 6px;
        background: #f8f9fa;
        padding: 10px;
      }

      .${PANEL_CLASS} .tm-scholar-bib-box {
        position: relative;
      }

      .${PANEL_CLASS} .tm-scholar-copy-btn {
        position: absolute;
        top: 8px;
        right: 8px;
        z-index: 2;
        border: 1px solid #dadce0;
        border-radius: 4px;
        background: #fff;
        color: #3c4043;
        padding: 4px 12px;
        font-size: 13px;
        cursor: pointer;
      }

      .${PANEL_CLASS} .tm-scholar-copy-btn.tm-copied {
        color: #188038;
        border-color: #188038;
      }

      .${PANEL_CLASS} .tm-scholar-bib-text {
        width: 100%;
        min-height: 170px;
        padding: 44px 10px 10px;
        box-sizing: border-box;
        border: 1px solid #e0e0e0;
        border-radius: 4px;
        resize: vertical;
        font-size: 12px;
        line-height: 1.45;
        color: #202124;
        background: #f8f9fa;
        font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
      }

      .${HIDDEN_CLASS} {
        display: none !important;
      }
    `;

    document.head.appendChild(style);
  }

  function attachButtons(root = document) {
    const footers = root.querySelectorAll(".gs_fl");
    footers.forEach((footer) => {
      if (footer.querySelector(`.${BTN_CLASS}`)) return;

      const importBibLink = findImportBibLink(footer);
      const citeButton = findCiteButton(footer);
      const versionsLink = findVersionsLink(footer);
      if (!importBibLink && !citeButton) return;

      const result = findResultContainer(footer);
      if (!result) return;

      const showBibButton = document.createElement("a");
      showBibButton.href = "javascript:void(0)";
      showBibButton.className = `${BTN_CLASS} gs_nph`;
      showBibButton.textContent = "Show Bib";

      if (importBibLink) {
        const href = importBibLink.getAttribute("href") || "";
        if (href && href !== "javascript:void(0)") {
          showBibButton.dataset.tmBibUrl = new URL(href, location.origin).toString();
        }
      }

      showBibButton.addEventListener("click", async (event) => {
        event.preventDefault();
        await onShowBibClicked(result, showBibButton, citeButton, importBibLink, versionsLink);
      });

      if (importBibLink) {
        importBibLink.insertAdjacentElement("afterend", showBibButton);
      } else if (citeButton) {
        citeButton.insertAdjacentElement("afterend", showBibButton);
      }
    });
  }

  function findImportBibLink(footer) {
    const links = footer.querySelectorAll("a");
    for (const link of links) {
      const text = normalizeText(link.textContent).toLowerCase();
      const href = link.getAttribute("href") || "";
      const byText = /bibtex/.test(text) && (/import/.test(text) || /导入/.test(text));
      const byHref = /scholar\.bib|ct=citation|output=citation/i.test(href);
      if (byText || byHref) return link;
    }
    return null;
  }

  function findVersionsLink(footer) {
    const links = footer.querySelectorAll("a");
    for (const link of links) {
      const text = normalizeText(link.textContent).toLowerCase();
      const href = link.getAttribute("href") || "";
      const byText = /versions/.test(text) || /版本/.test(text);
      const byHref = /[?&]cluster=/.test(href);
      if (byText || byHref) return link;
    }
    return null;
  }

  function findCiteButton(footer) {
    const direct = footer.querySelector("a.gs_or_cit, a[aria-controls='gs_cit']");
    if (direct) return direct;

    const links = footer.querySelectorAll("a");
    for (const link of links) {
      const text = normalizeText(link.textContent);
      if (/^cite$/i.test(text) || text === "引用") {
        return link;
      }
    }

    return null;
  }

  function findResultContainer(footer) {
    return footer.closest(".gs_r, .gs_or, .gs_ri, .gs_scl") || footer.parentElement;
  }

  function normalizeText(text) {
    return (text || "").replace(/\s+/g, " ").trim();
  }

  async function onShowBibClicked(result, showBibButton, citeButton, importBibLink, versionsLink) {
    const existingPanel = result.querySelector(`.${PANEL_CLASS}`);
    if (existingPanel) {
      const isHidden = existingPanel.classList.toggle(HIDDEN_CLASS);
      showBibButton.textContent = isHidden ? "Show Bib" : "Hide Bib";
      return;
    }

    if (popupLock) {
      temporaryText(showBibButton, "Busy...");
      return;
    }

    popupLock = true;
    showBibButton.classList.add("tm-disabled");
    showBibButton.textContent = "Loading...";

    try {
      const bibtex = await fetchBestBibtex(showBibButton, citeButton, importBibLink, versionsLink);
      const panel = createBibPanel(bibtex);
      const footer = showBibButton.closest(".gs_fl");
      if (footer && footer.parentElement) {
        footer.insertAdjacentElement("afterend", panel);
      } else {
        result.appendChild(panel);
      }
      showBibButton.textContent = "Hide Bib";
    } catch (error) {
      console.error("[Scholar Show BibTeX] Failed to fetch BibTeX:", error);
      showBibButton.textContent = "Show Bib";
      const reason = getUserFacingErrorReason(error);
      alert(`Failed to fetch BibTeX.\nReason: ${reason}`);
    } finally {
      showBibButton.classList.remove("tm-disabled");
      popupLock = false;
    }
  }

  async function fetchBestBibtex(showBibButton, citeButton, importBibLink, versionsLink) {
    const bibUrl = await getBibUrl(showBibButton, citeButton, importBibLink);
    const rawText = await requestTextFromUrl(bibUrl);
    const originalBibtex = rawText.trim();
    if (!originalBibtex) {
      throw new Error("Empty BibTeX response.");
    }
    if (isFormalPublicationBibtex(originalBibtex)) {
      return originalBibtex;
    }

    const formalBibtex = await findFormalBibtexFromVersions(versionsLink, bibUrl);
    return formalBibtex || originalBibtex;
  }

  async function getBibUrl(showBibButton, citeButton, importBibLink) {
    const cached = showBibButton.dataset.tmBibUrl || (citeButton ? citeButton.dataset.tmBibUrl : "");
    if (cached) return cached;

    if (importBibLink) {
      const importHref = importBibLink.getAttribute("href") || "";
      if (importHref && importHref !== "javascript:void(0)") {
        const directBibUrl = new URL(importHref, location.origin).toString();
        showBibButton.dataset.tmBibUrl = directBibUrl;
        if (citeButton) citeButton.dataset.tmBibUrl = directBibUrl;
        return directBibUrl;
      }
    }

    // Prefer direct request path: fetch "output=cite" HTML, then parse BibTeX URL.
    const infoId = citeButton ? extractInfoId(citeButton) : "";
    if (infoId) {
      try {
        const bibUrlFromInfo = await getBibUrlFromInfoId(infoId);
        showBibButton.dataset.tmBibUrl = bibUrlFromInfo;
        if (citeButton) citeButton.dataset.tmBibUrl = bibUrlFromInfo;
        return bibUrlFromInfo;
      } catch (error) {
        console.warn("[Scholar Show BibTeX] Direct cite fetch failed, fallback to popup:", error);
      }
    }

    return await getBibUrlFromCitePopup(citeButton);
  }

  function extractInfoId(citeButton) {
    const attrCandidates = [
      citeButton.getAttribute("onclick"),
      citeButton.getAttribute("data-clk"),
      citeButton.getAttribute("href")
    ].filter(Boolean);

    for (const raw of attrCandidates) {
      const matched = raw.match(/info:([A-Za-z0-9_-]+):scholar\.google\.com/i);
      if (matched && matched[1]) return matched[1];

      const gsMatched = raw.match(/gs_ocit\([^)]*['"]([A-Za-z0-9_-]+)['"]\)/i);
      if (gsMatched && gsMatched[1]) return gsMatched[1];
    }

    return "";
  }

  async function getBibUrlFromInfoId(infoId) {
    const hl = new URLSearchParams(location.search).get("hl") || "en";
    const citeUrl = `${location.origin}/scholar?output=cite&q=info:${encodeURIComponent(infoId)}:scholar.google.com/&hl=${encodeURIComponent(hl)}`;
    const citeHtml = await requestTextFromUrl(citeUrl);
    const parsed = parseBibUrlFromHtml(citeHtml, location.origin);
    if (!parsed) {
      throw new Error("BibTeX URL not found in output=cite response.");
    }
    return parsed;
  }

  async function getBibUrlFromCitePopup(citeButton) {
    if (!citeButton) {
      throw new Error("Cite button not found.");
    }

    closeCitePopup();
    await sleep(80);
    citeButton.click();

    const bibHref = await waitForValue(() => {
      const popup = document.getElementById("gs_cit");
      if (!popup) return null;
      const links = popup.querySelectorAll("a");
      for (const link of links) {
        const text = normalizeText(link.textContent);
        const href = link.getAttribute("href") || "";
        if (/bibtex/i.test(text) || /scholar\.bib/i.test(href)) {
          return href;
        }
      }
      return null;
    }, 6000);

    closeCitePopup();

    if (!bibHref) {
      throw new Error("BibTeX link not found in citation popup.");
    }

    const bibUrl = new URL(bibHref, location.origin).toString();
    citeButton.dataset.tmBibUrl = bibUrl;
    return bibUrl;
  }

  async function findFormalBibtexFromVersions(versionsLink, originalBibUrl) {
    const versionsUrl = getAbsoluteHref(versionsLink);
    if (!versionsUrl) return "";

    const candidateBibUrls = await collectVersionBibUrls(versionsUrl);
    for (const candidateUrl of candidateBibUrls) {
      if (!candidateUrl || candidateUrl === originalBibUrl) continue;
      try {
        const bibtex = (await requestTextFromUrl(candidateUrl)).trim();
        if (bibtex && isFormalPublicationBibtex(bibtex)) {
          return bibtex;
        }
      } catch (error) {
        console.warn("[Scholar Show BibTeX] Failed to read version bib:", candidateUrl, error);
      }
    }
    return "";
  }

  async function collectVersionBibUrls(versionsUrl) {
    const html = await requestTextFromUrl(versionsUrl);
    const doc = new DOMParser().parseFromString(html || "", "text/html");
    const urls = [];
    const seen = new Set();

    const footers = doc.querySelectorAll(".gs_fl");
    for (const footer of footers) {
      if (urls.length >= MAX_VERSION_CANDIDATES) break;

      const importBibLink = findImportBibLink(footer);
      const importHref = getAbsoluteHref(importBibLink, versionsUrl);
      if (importHref && !seen.has(importHref)) {
        seen.add(importHref);
        urls.push(importHref);
        if (urls.length >= MAX_VERSION_CANDIDATES) break;
      }

      const citeLink = findCiteButton(footer);
      if (!citeLink) continue;
      const infoId = extractInfoId(citeLink);
      if (!infoId) continue;

      try {
        const bibUrl = await getBibUrlFromInfoId(infoId);
        if (bibUrl && !seen.has(bibUrl)) {
          seen.add(bibUrl);
          urls.push(bibUrl);
        }
      } catch (error) {
        console.warn("[Scholar Show BibTeX] Failed to parse version cite link:", error);
      }
    }

    return urls;
  }

  function isFormalPublicationBibtex(bibtex) {
    const journal = getBibFieldValue(bibtex, "journal");
    const booktitle = getBibFieldValue(bibtex, "booktitle");
    const publisher = getBibFieldValue(bibtex, "publisher");
    const preprintPattern = /(arxiv|preprint|corr|biorxiv|medrxiv|ssrn|openreview)/i;

    if (journal && !preprintPattern.test(journal)) return true;
    if (booktitle && !preprintPattern.test(booktitle)) return true;
    if (publisher && !preprintPattern.test(publisher)) {
      if (/\bdoi\s*=|\bpages\s*=|\bvolume\s*=/i.test(bibtex || "")) return true;
    }

    const lower = (bibtex || "").toLowerCase();
    if (preprintPattern.test(lower)) return false;
    return /\bjournal\s*=|\bbooktitle\s*=/.test(lower);
  }

  function getBibFieldValue(bibtex, fieldName) {
    if (!bibtex || !fieldName) return "";
    const escapedField = fieldName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = new RegExp(`${escapedField}\\s*=\\s*\\{([^}]*)\\}`, "i");
    const matched = bibtex.match(pattern);
    return matched && matched[1] ? matched[1].trim() : "";
  }

  function getAbsoluteHref(linkEl, baseHref = location.origin) {
    if (!linkEl) return "";
    const href = linkEl.getAttribute("href") || "";
    if (!href || href === "javascript:void(0)") return "";
    try {
      return new URL(href, baseHref).toString();
    } catch (error) {
      return "";
    }
  }

  function parseBibUrlFromHtml(html, base) {
    const doc = new DOMParser().parseFromString(html || "", "text/html");
    const links = doc.querySelectorAll("a");
    for (const link of links) {
      const text = normalizeText(link.textContent);
      const href = link.getAttribute("href") || "";
      if (/bibtex/i.test(text) || /scholar\.bib/i.test(href)) {
        return new URL(href, base).toString();
      }
    }
    return "";
  }

  async function requestTextFromUrl(url) {
    const target = new URL(url, location.href);
    if (target.origin === location.origin) {
      const sameOriginResponse = await fetch(target.toString(), { credentials: "include" });
      if (!sameOriginResponse.ok) {
        const errorBody = await sameOriginResponse.text();
        throw buildHttpError(sameOriginResponse.status, errorBody);
      }
      return await sameOriginResponse.text();
    }

    if (typeof GM_xmlhttpRequest === "function") {
      return new Promise((resolve, reject) => {
        GM_xmlhttpRequest({
          method: "GET",
          url,
          anonymous: false,
          onload: (response) => {
            if (response.status >= 200 && response.status < 300) {
              resolve(response.responseText || "");
            } else {
              reject(buildHttpError(response.status, response.responseText || ""));
            }
          },
          onerror: () => reject(new Error("Network error when loading BibTeX.")),
          ontimeout: () => reject(new Error("Timed out when loading BibTeX."))
        });
      });
    }

    const response = await fetch(url, { credentials: "include" });
    if (!response.ok) {
      const errorBody = await response.text();
      throw buildHttpError(response.status, errorBody);
    }
    return await response.text();
  }

  function buildHttpError(status, responseText = "") {
    const bodyText = normalizeText(responseText);
    if (status === 403) {
      if (/your client does not have permission to get url/i.test(bodyText)) {
        return new Error("HTTP 403 Forbidden. Google Scholar denied permission to access this citation URL.");
      }
      return new Error("HTTP 403 Forbidden. Google Scholar denied this request.");
    }

    if (status === 429) {
      return new Error("HTTP 429 Too Many Requests. Google Scholar rate-limited this request.");
    }

    if (status === 404) {
      return new Error("HTTP 404 Not Found. The citation endpoint could not be found.");
    }

    return new Error(`HTTP ${status}`);
  }

  function getUserFacingErrorReason(error) {
    if (error && typeof error.message === "string" && error.message.trim()) {
      return error.message.trim();
    }
    if (typeof error === "string" && error.trim()) {
      return error.trim();
    }
    return "Unknown error.";
  }

  function createBibPanel(bibtex) {
    const panel = document.createElement("div");
    panel.className = PANEL_CLASS;

    const box = document.createElement("div");
    box.className = "tm-scholar-bib-box";

    const copyButton = document.createElement("button");
    copyButton.type = "button";
    copyButton.className = "tm-scholar-copy-btn";
    copyButton.textContent = "Copy";

    const textarea = document.createElement("textarea");
    textarea.className = "tm-scholar-bib-text";
    textarea.value = bibtex;
    textarea.spellcheck = false;
    textarea.readOnly = true;

    copyButton.addEventListener("click", async () => {
      const copied = await copyTextToClipboard(textarea.value);
      if (copied) {
        copyButton.textContent = "Copied";
        copyButton.classList.add("tm-copied");
      } else {
        copyButton.textContent = "Copy failed";
      }
    });

    box.appendChild(copyButton);
    box.appendChild(textarea);
    panel.appendChild(box);
    return panel;
  }

  async function copyTextToClipboard(text) {
    try {
      if (typeof GM_setClipboard === "function") {
        GM_setClipboard(text, "text");
        return true;
      }
    } catch (error) {
      console.warn("[Scholar Show BibTeX] GM_setClipboard failed:", error);
    }

    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch (error) {
      console.warn("[Scholar Show BibTeX] navigator.clipboard failed:", error);
    }

    const fallback = document.createElement("textarea");
    fallback.value = text;
    fallback.setAttribute("readonly", "");
    fallback.style.position = "fixed";
    fallback.style.left = "-9999px";
    document.body.appendChild(fallback);
    fallback.select();

    let success = false;
    try {
      success = document.execCommand("copy");
    } catch (error) {
      success = false;
    }

    fallback.remove();
    return success;
  }

  function closeCitePopup() {
    const closeButton = document.getElementById("gs_cit-x");
    if (closeButton) closeButton.click();
  }

  function observeDomChanges() {
    const root = document.querySelector("#gs_res_ccl_mid") || document.body;
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.addedNodes && mutation.addedNodes.length > 0) {
          attachButtons(root);
          break;
        }
      }
    });

    observer.observe(root, { childList: true, subtree: true });
  }

  function temporaryText(el, text) {
    const old = el.textContent;
    el.textContent = text;
    setTimeout(() => {
      el.textContent = old || "Show Bib";
    }, 900);
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function waitForValue(getter, timeoutMs) {
    return new Promise((resolve, reject) => {
      const startedAt = Date.now();
      const timer = setInterval(() => {
        try {
          const value = getter();
          if (value) {
            clearInterval(timer);
            resolve(value);
            return;
          }

          if (Date.now() - startedAt >= timeoutMs) {
            clearInterval(timer);
            reject(new Error("Timed out waiting for value."));
          }
        } catch (error) {
          clearInterval(timer);
          reject(error);
        }
      }, 120);
    });
  }
})();
