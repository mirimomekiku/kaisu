import { isAdvanced, outputOptions } from "./extra";
import { LAYOUT_LABEL, NAME_LABEL } from "./output";
import { describeSiteRule, matchSiteRule } from "./siteRules";
import type { Settings } from "./storage";

export interface DownloadPlan {
  /** The site rule that will change this download, in words, or null. */
  rule: string | null;
  /** How the finished file will be organised and named. */
  output: string;
}

/**
 * What will shape a download before it starts: the site rule that applies to this link (Advanced mode) and the folder
 * layout and file naming from Settings. Mirrors what `submitDownloads` applies, so the card does not surprise anyone.
 */
export function downloadPlan(settings: Settings, link: string, channel: string | null | undefined): DownloadPlan {
  const rule = isAdvanced(settings) ? matchSiteRule(settings.siteRules, link, channel) : null;
  const out = outputOptions(settings);
  const naming = out.custom ? `custom name "${out.custom}"` : NAME_LABEL[out.name];
  return {
    rule: rule ? `${describeSiteRule(rule)} It overrides the choices on this card.` : null,
    output: `${LAYOUT_LABEL[out.layout]} · ${naming}`,
  };
}
