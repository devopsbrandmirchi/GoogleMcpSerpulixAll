import { AppError } from "@/lib/errors";
import { normalizeCustomerId } from "@/lib/customer-id";

export const MAX_MUTATE_OPERATIONS = 100;

const MICROS_PATTERN = /^[1-9][0-9]{0,15}$/;
const CUSTOMER_RESOURCE_PATTERN = /^customers\/([^/]+)\//;
const AD_GROUP_CRITERION_PATTERN = /^customers\/\d+\/adGroupCriteria\/\d+~\d+$/;

// Removing one of these detaches a link or targeting criterion; the linked entities are kept.
export const DETACHABLE_OPERATION_TYPES = new Set([
  "campaignCriterionOperation",
  "adGroupCriterionOperation",
  "customerNegativeCriterionOperation",
  "sharedCriterionOperation",
  "campaignSharedSetOperation",
  "campaignAssetOperation",
  "adGroupAssetOperation",
  "customerAssetOperation",
  "assetGroupAssetOperation",
  "assetGroupSignalOperation",
  "assetGroupListingGroupFilterOperation",
  "campaignAssetSetOperation",
  "assetSetAssetOperation",
  "campaignBidModifierOperation",
  "adGroupBidModifierOperation",
  "campaignLabelOperation",
  "adGroupLabelOperation",
  "adGroupAdLabelOperation",
  "adGroupCriterionLabelOperation",
  "customerLabelOperation",
  "campaignCustomizerOperation",
  "adGroupCustomizerOperation",
  "adGroupCriterionCustomizerOperation",
  "customerCustomizerOperation",
]);

export type MutateAction = "create" | "update" | "remove";

export type MutateOperation = Record<string, Record<string, unknown>>;

export interface OperationSummary {
  type: string;
  action: MutateAction;
  resourceName: string | null;
}

export interface CheckedMutate {
  operations: MutateOperation[];
  summary: OperationSummary[];
  adGroupCriterionRemovals: string[];
}

function micros(name: string, required: boolean): bigint | null {
  const value = process.env[name]?.trim() ?? "";
  if (!value) {
    if (required) {
      throw new AppError(`Set ${name} to a positive integer.`, "configuration_error", 400);
    }
    return null;
  }
  if (!MICROS_PATTERN.test(value)) {
    throw new AppError(`Set ${name} to a positive integer.`, "configuration_error", 400);
  }
  return BigInt(value);
}

export function assertWriteAllowed(rawCustomerId: string): string {
  const customerId = normalizeCustomerId(rawCustomerId);
  if (process.env.GOOGLE_ADS_WRITES_ENABLED !== "true") {
    throw new AppError("Google Ads writes are disabled. Set GOOGLE_ADS_WRITES_ENABLED=true.", "configuration_error", 403);
  }
  const entries = (process.env.GOOGLE_ADS_WRITE_CUSTOMER_IDS ?? "")
    .split(",").map((id) => id.trim()).filter(Boolean);
  const allowAny = entries.includes("*");
  const allowed = entries.filter((id) => id !== "*").map(normalizeCustomerId);
  if (!allowAny && !allowed.includes(customerId)) {
    throw new AppError("Customer is not in GOOGLE_ADS_WRITE_CUSTOMER_IDS.", "resource_not_accessible", 403);
  }
  micros("GOOGLE_ADS_MAX_DAILY_BUDGET_MICROS", true);
  return customerId;
}

export function assertClientAccount(access: { isManager: boolean }): void {
  if (access.isManager) {
    throw new AppError("Select a client account, not an MCC manager account.", "validation", 400);
  }
}

function invalid(message: string, index: number): AppError {
  return new AppError(`Operation ${index + 1}: ${message}`, "validation", 400);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function visit(value: unknown, onEntry: (key: string, entry: unknown) => void): void {
  if (Array.isArray(value)) {
    value.forEach((item) => visit(item, onEntry));
    return;
  }
  if (isRecord(value)) {
    for (const [key, entry] of Object.entries(value)) {
      onEntry(key, entry);
      visit(entry, onEntry);
    }
  }
}

function assertSameCustomer(value: unknown, customerId: string, index: number): void {
  const check = (entry: unknown) => {
    if (typeof entry !== "string") {
      return;
    }
    const match = entry.match(CUSTOMER_RESOURCE_PATTERN);
    if (match && match[1] !== customerId) {
      throw invalid(`resource "${entry}" belongs to a different customer than ${customerId}.`, index);
    }
  };
  check(value);
  visit(value, (_key, entry) => check(entry));
}

function assertNotRemovedStatus(resource: unknown, index: number): void {
  visit(resource, (key, entry) => {
    if (key === "status" && entry === "REMOVED") {
      throw invalid("setting status to REMOVED is not allowed. Use PAUSED instead.", index);
    }
  });
}

function assertBudgetWithinCaps(resource: Record<string, unknown>, index: number): void {
  if (resource.amountMicros !== undefined) {
    const daily = micros("GOOGLE_ADS_MAX_DAILY_BUDGET_MICROS", true)!;
    const amount = String(resource.amountMicros);
    if (!MICROS_PATTERN.test(amount) || BigInt(amount) > daily) {
      throw invalid("budget amountMicros is not a positive integer or exceeds GOOGLE_ADS_MAX_DAILY_BUDGET_MICROS.", index);
    }
  }
  if (resource.totalAmountMicros !== undefined) {
    const total = micros("GOOGLE_ADS_MAX_TOTAL_BUDGET_MICROS", false);
    if (total === null) {
      throw invalid("total budgets are disabled. Set GOOGLE_ADS_MAX_TOTAL_BUDGET_MICROS to allow them.", index);
    }
    const amount = String(resource.totalAmountMicros);
    if (!MICROS_PATTERN.test(amount) || BigInt(amount) > total) {
      throw invalid("budget totalAmountMicros is not a positive integer or exceeds GOOGLE_ADS_MAX_TOTAL_BUDGET_MICROS.", index);
    }
  }
}

export function checkMutateOperations(rawCustomerId: string, operations: unknown[]): CheckedMutate {
  const customerId = normalizeCustomerId(rawCustomerId);
  if (!Array.isArray(operations) || operations.length === 0 || operations.length > MAX_MUTATE_OPERATIONS) {
    throw new AppError(`Provide between 1 and ${MAX_MUTATE_OPERATIONS} operations.`, "validation", 400);
  }

  const checked: MutateOperation[] = [];
  const summary: OperationSummary[] = [];
  const adGroupCriterionRemovals: string[] = [];

  operations.forEach((raw, index) => {
    if (!isRecord(raw)) {
      throw invalid("each operation must be an object such as { campaignOperation: { create: {...} } }.", index);
    }
    const keys = Object.keys(raw);
    if (keys.length !== 1 || !keys[0]!.endsWith("Operation")) {
      throw invalid("each operation must have exactly one key ending in Operation.", index);
    }
    const type = keys[0]!;
    const body = raw[type];
    if (!isRecord(body)) {
      throw invalid(`${type} must be an object.`, index);
    }
    const actions = (["create", "update", "remove"] as const).filter((action) => body[action] !== undefined);
    if (actions.length !== 1) {
      throw invalid(`${type} must contain exactly one of create, update or remove.`, index);
    }
    const action = actions[0]!;
    assertSameCustomer(body, customerId, index);

    if (action === "remove") {
      const target = body.remove;
      if (typeof target !== "string" || !target.startsWith(`customers/${customerId}/`)) {
        throw invalid("remove must be a resource name in this customer.", index);
      }
      if (!DETACHABLE_OPERATION_TYPES.has(type)) {
        throw invalid(
          `removing via ${type} would delete an entity, which this connector does not allow. Pause it instead.`,
          index,
        );
      }
      if (type === "adGroupCriterionOperation") {
        if (!AD_GROUP_CRITERION_PATTERN.test(target)) {
          throw invalid("ad group criterion resource name is malformed.", index);
        }
        adGroupCriterionRemovals.push(target);
      }
      checked.push({ [type]: { ...body } });
      summary.push({ type, action, resourceName: target });
      return;
    }

    const resource = body[action];
    if (!isRecord(resource)) {
      throw invalid(`${action} must be an object.`, index);
    }
    if (action === "update" && (typeof body.updateMask !== "string" || !body.updateMask.trim())) {
      throw invalid("update requires updateMask, such as \"status\" or \"name,status\".", index);
    }
    assertNotRemovedStatus(resource, index);

    let next = resource;
    if (type === "campaignOperation" && action === "create") {
      if (resource.status !== undefined && resource.status !== "PAUSED") {
        throw invalid("new campaigns must be created PAUSED. Enable them later with a status update.", index);
      }
      next = { ...resource, status: "PAUSED" };
    }
    if (type === "campaignBudgetOperation") {
      assertBudgetWithinCaps(resource, index);
    }

    checked.push({ [type]: { ...body, [action]: next } });
    summary.push({
      type,
      action,
      resourceName: typeof resource.resourceName === "string" ? resource.resourceName : null,
    });
  });

  return { operations: checked, summary, adGroupCriterionRemovals };
}
