import { PAGE_TEXTS } from "./config-web-page-i18n.js";
import { PAGE_SCRIPT } from "./config-web-page-script.js";
import { PAGE_HTML_PREFIX, PAGE_HTML_SUFFIX } from "./config-web-page-template.js";

const serializedTexts = JSON.stringify(PAGE_TEXTS).replace(/</g, "\u003c");

export const PAGE_HTML = `${PAGE_HTML_PREFIX}${PAGE_SCRIPT.replace("__PAGE_TEXTS__", serializedTexts)}${PAGE_HTML_SUFFIX}`;
