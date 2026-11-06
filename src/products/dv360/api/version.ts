/** Isolated Display & Video 360 REST API version. Upgrade this constant when adopting a newer official release. */
export const DV360_API_VERSION = "v4";

export const DV360_API_BASE = `https://displayvideo.googleapis.com/${DV360_API_VERSION}`;

/**
 * Reporting (Bid Manager / spend, impressions, conversions) is the next phase.
 * Discovery and live resource reads belong in this module; do not add Bid Manager here.
 */
export const DV360_REPORTING_STATUS = "not_implemented" as const;
